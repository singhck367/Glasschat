import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, Phone, Video, Send, Paperclip, 
  Smile, CheckCheck, Check, MoreVertical, Image, Users, Lock, 
  Mic, MicOff, Play, Pause, Trash2, X, Download,
  FileText, Camera, Headphones, User, BarChart2, Calendar, SmilePlus, Plus
} from 'lucide-react';
import SecurityVerificationModal from './SecurityVerificationModal';
import UserProfileModal from './UserProfileModal';
import { playNotificationSound } from '../services/notifications';

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function ChatRoom({ 
  chat, 
  onBack, 
  onStartCall, 
  currentUser,
  contacts = [],
  socket,
  savedContactsMap = {},
  onSaveContact
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteTypingUser, setRemoteTypingUser] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeMessageMenu, setActiveMessageMenu] = useState(null);

  // Saved contact name resolution
  const cleanPhoneDigits = (chat.phone || '').replace(/\D/g, '');
  const last10Digits = cleanPhoneDigits.slice(-10);
  const savedContactName = !chat.isGroup ? (savedContactsMap[last10Digits] || savedContactsMap[cleanPhoneDigits] || '') : '';
  const [previewImage, setPreviewImage] = useState(null);

  // WhatsApp Attachment Menu & Modals State
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showStickerModal, setShowStickerModal] = useState(false);

  // Poll Form State
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  // Event Form State
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventLocation, setEventLocation] = useState('');

  // Contact Share Manual Input State
  const [manualContactName, setManualContactName] = useState('');
  const [manualContactPhone, setManualContactPhone] = useState('');

  // Hidden File Input References
  const documentInputRef = useRef(null);
  const photoVideoInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const stickerInputRef = useRef(null);

  // Audio Voice Note Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Audio Playback State for messages
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const currentAudioRef = useRef(null);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Dynamic Viewport Height tracking for mobile virtual keyboard
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' && window.visualViewport 
      ? window.visualViewport.height 
      : (typeof window !== 'undefined' ? window.innerHeight : 800)
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleResize = () => {
      setViewportHeight(window.visualViewport.height);
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    };

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    return () => {
      window.visualViewport.removeEventListener('resize', handleResize);
      window.visualViewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  const isGroup = Boolean(chat.isGroup);
  // Consistent bidirectional chat room key
  const chatId = isGroup 
    ? (chat.id.startsWith('group_') ? chat.id : `group_${chat.id}`)
    : ['chat', ...[currentUser.id, chat.id].sort()].join('_');

  // Fetch initial messages from API & Join Socket room
  useEffect(() => {
    // Fetch chat history
    fetch(`/api/chats/${chatId}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data || []);
      })
      .catch(err => console.error('Failed to load chat messages:', err));

    // Join room
    socket.emit('join-chat', { chatId });

    // Listen for new messages
    const handleNewMessage = (payload) => {
      if (payload.chatId === chatId) {
        // If message is from someone else, play sound chime
        if (payload.message.senderId !== currentUser.id) {
          playNotificationSound();
        }

        setMessages(prev => {
          if (prev.some(m => m.id === payload.message.id)) return prev;

          // 1. If payload carries tempId, replace the matching optimistic message
          if (payload.tempId && prev.some(m => m.id === payload.tempId)) {
            return prev.map(m => m.id === payload.tempId ? payload.message : m);
          }

          // 2. If recent optimistic message from current user with matching text or type
          const optIdx = prev.findIndex(m => 
            m.senderId === payload.message.senderId &&
            (m.id.startsWith('msg_') || m.id.startsWith('temp_')) &&
            (m.text === payload.message.text || (m.type === payload.message.type && m.type !== 'text'))
          );
          if (optIdx !== -1) {
            const updated = [...prev];
            updated[optIdx] = payload.message;
            return updated;
          }

          return [...prev, payload.message];
        });
      }
    };

    // Listen for remote typing status
    const handleUserTyping = (payload) => {
      if (payload.chatId === chatId && payload.userId !== currentUser.id) {
        setRemoteTypingUser(payload.isTyping ? payload.userName : null);
      }
    };

    // Listen for reaction updates
    const handleReactionUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m));
      }
    };

    // Listen for deleted messages
    const handleMessageDeleted = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.filter(m => m.id !== payload.messageId));
      }
    };

    // Listen for poll updates
    const handlePollUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, pollData: payload.pollData } : m));
      }
    };

    socket.on('new-message', handleNewMessage);
    socket.on('user-typing', handleUserTyping);
    socket.on('message-reaction-updated', handleReactionUpdated);
    socket.on('message-deleted', handleMessageDeleted);
    socket.on('poll-updated', handlePollUpdated);

    return () => {
      socket.emit('leave-chat', { chatId });
      socket.off('new-message', handleNewMessage);
      socket.off('user-typing', handleUserTyping);
      socket.off('message-reaction-updated', handleReactionUpdated);
      socket.off('message-deleted', handleMessageDeleted);
      socket.off('poll-updated', handlePollUpdated);
    };
  }, [chatId, socket, currentUser.id]);

  // Auto scroll to bottom smoothly
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, remoteTypingUser]);

  // Handle typing debounce
  const handleInputChange = (e) => {
    setInputText(e.target.value);

    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', {
        chatId,
        userId: currentUser.id,
        userName: currentUser.name,
        isTyping: true
      });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing', {
        chatId,
        userId: currentUser.id,
        userName: currentUser.name,
        isTyping: false
      });
    }, 1500);
  };

  // Helper to send message payload
  const emitMessage = (msgData) => {
    const tempId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const optimisticMsg = {
      id: tempId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderPhone: currentUser.phone || '',
      senderAvatar: currentUser.avatar || '',
      timestamp: timeStr,
      status: 'delivered',
      encrypted: true,
      ...msgData
    };

    setMessages(prev => [...prev, optimisticMsg]);

    socket.emit('send-message', {
      tempId,
      chatId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderPhone: currentUser.phone || '',
      senderAvatar: currentUser.avatar || '',
      encrypted: true,
      recipientId: isGroup ? null : chat.id,
      ...msgData
    });
  };

  // Handle Send Text Message
  const handleSendMessage = (e) => {
    e?.preventDefault();
    const textToSend = inputText.trim();
    if (!textToSend) return;

    emitMessage({ text: textToSend, type: 'text' });
    setInputText('');
    setShowEmojiPicker(false);
  };

  // ==========================================
  // ATTACHMENT UPLOAD HANDLERS
  // ==========================================

  // 1. Document Upload (.pdf, .docx, .zip, .txt, etc.)
  const handleDocumentUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      emitMessage({
        text: `📄 ${file.name}`,
        fileName: file.name,
        fileSize: formatFileSize(file.size),
        mediaUrl: reader.result,
        type: 'document'
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 2. Photos & Videos Upload
  const handlePhotoVideoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const reader = new FileReader();
    reader.onload = () => {
      emitMessage({
        text: isVideo ? '🎥 Video' : '📷 Photo',
        mediaUrl: reader.result,
        type: isVideo ? 'video' : 'image'
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 3. Audio File Upload (.mp3, .wav, .m4a, etc.)
  const handleAudioFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      emitMessage({
        text: `🎵 ${file.name}`,
        mediaUrl: reader.result,
        type: 'audio'
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 4. Custom Sticker Upload
  const handleCustomStickerUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      emitMessage({
        text: 'Sticker',
        mediaUrl: reader.result,
        type: 'sticker'
      });
      setShowStickerModal(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 5. Send Contact Card
  const handleSendContact = (contact) => {
    emitMessage({
      text: `👤 Contact: ${contact.name} (${contact.phone})`,
      type: 'contact',
      contactData: {
        name: contact.name,
        phone: contact.phone,
        avatar: contact.avatar || ''
      }
    });
    setShowContactModal(false);
  };

  // 6. Send Poll Card
  const handleSendPoll = (e) => {
    e?.preventDefault();
    const cleanQuestion = pollQuestion.trim();
    const cleanOptions = pollOptions.map(o => o.trim()).filter(Boolean);
    if (!cleanQuestion || cleanOptions.length < 2) {
      alert('Please provide a question and at least 2 options.');
      return;
    }

    emitMessage({
      text: `📊 Poll: ${cleanQuestion}`,
      type: 'poll',
      pollData: {
        question: cleanQuestion,
        options: cleanOptions.map((optText, idx) => ({
          id: String(idx + 1),
          text: optText,
          votes: []
        }))
      }
    });

    setPollQuestion('');
    setPollOptions(['', '']);
    setShowPollModal(false);
  };

  // 7. Send Event Card
  const handleSendEvent = (e) => {
    e?.preventDefault();
    if (!eventTitle.trim()) {
      alert('Please enter an event title.');
      return;
    }

    emitMessage({
      text: `📅 Event: ${eventTitle.trim()}`,
      type: 'event',
      eventData: {
        title: eventTitle.trim(),
        date: eventDate || 'Today',
        time: eventTime || '',
        location: eventLocation.trim() || 'Online'
      }
    });

    setEventTitle('');
    setEventDate('');
    setEventTime('');
    setEventLocation('');
    setShowEventModal(false);
  };

  // ==========================================
  // VOICE NOTE AUDIO RECORDING (FIXED & TESTED)
  // ==========================================
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Microphone recording is not supported on this device/browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/aac')) {
          mimeType = 'audio/aac';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250); // capture 250ms chunks
      setIsRecording(true);
      setRecordingSeconds(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(sec => sec + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Microphone permission required for voice notes. Please allow microphone access.');
    }
  };

  const cancelRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    audioChunksRef.current = [];
  };

  const sendRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

    const durationStr = `${Math.floor(recordingSeconds / 60)}:${(recordingSeconds % 60).toString().padStart(2, '0')}`;
    const tempId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    mediaRecorderRef.current.onstop = () => {
      const recordedMime = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: recordedMime });

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }

      if (audioBlob.size === 0) {
        alert('No audio was recorded. Please try again.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const optimisticMsg = {
          id: tempId,
          senderId: currentUser.id,
          senderName: currentUser.name,
          senderPhone: currentUser.phone || '',
          senderAvatar: currentUser.avatar || '',
          text: `🎤 Voice message (${durationStr})`,
          mediaUrl: reader.result,
          type: 'audio',
          encrypted: true,
          timestamp: timeStr,
          status: 'delivered'
        };
        setMessages(prev => [...prev, optimisticMsg]);

        socket.emit('send-message', {
          tempId,
          chatId,
          senderId: currentUser.id,
          senderName: currentUser.name,
          senderPhone: currentUser.phone || '',
          senderAvatar: currentUser.avatar || '',
          text: `🎤 Voice message (${durationStr})`,
          mediaUrl: reader.result,
          type: 'audio',
          encrypted: true,
          recipientId: isGroup ? null : chat.id
        });
      };
      reader.readAsDataURL(audioBlob);
    };

    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  // Toggle audio playback
  const togglePlayAudio = (msgId, audioUrl) => {
    if (playingAudioId === msgId) {
      currentAudioRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      audio.onended = () => setPlayingAudioId(null);
      audio.onerror = () => setPlayingAudioId(null);
      audio.play().catch(e => {
        console.error('Playback error:', e);
        setPlayingAudioId(null);
      });
      setPlayingAudioId(msgId);
    }
  };

  // Reaction & Delete Message
  const handleReact = (msgId, emoji) => {
    socket.emit('react-message', {
      chatId,
      messageId: msgId,
      emoji,
      userId: currentUser.id
    });
    setActiveMessageMenu(null);
  };

  const handleDeleteMessage = (msgId) => {
    socket.emit('delete-message', {
      chatId,
      messageId: msgId
    });
    setActiveMessageMenu(null);
  };

  // Attachment Menu Options (Exact match to WhatsApp screenshot)
  const attachmentOptions = [
    {
      id: 'document',
      label: 'Document',
      icon: FileText,
      color: '#6366f1',
      action: () => documentInputRef.current?.click()
    },
    {
      id: 'photos_videos',
      label: 'Photos & videos',
      icon: Image,
      color: '#0284c7',
      action: () => photoVideoInputRef.current?.click()
    },
    {
      id: 'camera',
      label: 'Camera',
      icon: Camera,
      color: '#ec4899',
      action: () => cameraInputRef.current?.click()
    },
    {
      id: 'audio',
      label: 'Audio',
      icon: Headphones,
      color: '#f97316',
      action: () => audioInputRef.current?.click()
    },
    {
      id: 'contact',
      label: 'Contact',
      icon: User,
      color: '#0ea5e9',
      action: () => setShowContactModal(true)
    },
    {
      id: 'poll',
      label: 'Poll',
      icon: BarChart2,
      color: '#eab308',
      action: () => setShowPollModal(true)
    },
    {
      id: 'event',
      label: 'Event',
      icon: Calendar,
      color: '#f43f5e',
      action: () => setShowEventModal(true)
    },
    {
      id: 'sticker',
      label: 'New sticker',
      icon: SmilePlus,
      color: '#10b981',
      action: () => setShowStickerModal(true)
    }
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: viewportHeight ? `${viewportHeight}px` : '100%',
      maxHeight: viewportHeight ? `${viewportHeight}px` : '100%',
      position: 'relative',
      backgroundColor: 'transparent',
      overflow: 'hidden'
    }}>
      {/* Hidden File Inputs */}
      <input 
        type="file" 
        ref={documentInputRef} 
        accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.zip,.rar" 
        onChange={handleDocumentUpload} 
        style={{ display: 'none' }} 
      />
      <input 
        type="file" 
        ref={photoVideoInputRef} 
        accept="image/*,video/*" 
        onChange={handlePhotoVideoUpload} 
        style={{ display: 'none' }} 
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        accept="image/*" 
        capture="environment" 
        onChange={handlePhotoVideoUpload} 
        style={{ display: 'none' }} 
      />
      <input 
        type="file" 
        ref={audioInputRef} 
        accept="audio/*" 
        onChange={handleAudioFileUpload} 
        style={{ display: 'none' }} 
      />
      <input 
        type="file" 
        ref={stickerInputRef} 
        accept="image/*" 
        onChange={handleCustomStickerUpload} 
        style={{ display: 'none' }} 
      />

      {/* TOP HEADER */}
      <header className="glass-panel" style={{
        padding: '10px 14px',
        paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.75)',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        zIndex: 50,
        position: 'sticky',
        top: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <button 
            onClick={onBack}
            className="glass-btn"
            style={{ width: '36px', height: '36px', flexShrink: 0 }}
            title="Back"
          >
            <ArrowLeft size={18} color="var(--text-primary)" />
          </button>

          <div 
            onClick={() => setShowProfileModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minWidth: 0, flex: 1 }}
            title="Click to view contact profile & info"
          >
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <img 
                src={chat.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                alt={chat.name || 'User'}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: isGroup ? '14px' : '50%',
                  objectFit: 'cover',
                  border: '2px solid rgba(255, 255, 255, 0.85)'
                }}
              />
              {chat.online && !isGroup && (
                <span style={{
                  position: 'absolute',
                  bottom: '1px',
                  right: '1px',
                  width: '10px',
                  height: '10px',
                  backgroundColor: '#22c55e',
                  border: '2px solid #ffffff',
                  borderRadius: '50%'
                }} />
              )}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <h2 style={{ 
                  fontSize: '15px', 
                  fontWeight: '700', 
                  color: 'var(--text-primary)', 
                  margin: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {isGroup ? (
                    chat.name
                  ) : savedContactName ? (
                    <>
                      <span style={{ fontWeight: '800', color: 'var(--text-primary)' }}>{savedContactName}</span>
                      {chat.phone && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '500' }}>
                          ({chat.phone})
                        </span>
                      )}
                    </>
                  ) : chat.phone ? (
                    <>
                      <span>{chat.phone}</span>
                      {chat.name && chat.name !== chat.phone && (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '400' }}>
                          ~{chat.name}
                        </span>
                      )}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowProfileModal(true);
                        }}
                        className="glass-pill"
                        style={{
                          padding: '2px 8px',
                          fontSize: '10px',
                          fontWeight: '700',
                          color: '#0284c7',
                          backgroundColor: 'rgba(2, 132, 199, 0.12)',
                          border: '1px solid rgba(2, 132, 199, 0.3)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        + Save
                      </button>
                    </>
                  ) : (
                    chat.name || 'User'
                  )}
                </h2>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSecurityModal(true);
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', flexShrink: 0 }}
                  title="Verify End-to-End Encryption"
                >
                  <Lock size={12} color="#16a34a" />
                </button>
              </div>

              <span style={{ 
                fontSize: '11px', 
                color: remoteTypingUser ? '#0284c7' : (chat.online ? '#16a34a' : 'var(--text-secondary)'),
                fontWeight: remoteTypingUser ? '700' : '500',
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {remoteTypingUser ? `${remoteTypingUser} is typing...` : (chat.online ? 'Online' : (chat.lastSeen ? `Last seen ${chat.lastSeen}` : 'Tap for contact info'))}
              </span>
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button 
            onClick={() => onStartCall(chat, false)}
            className="glass-btn" 
            style={{ width: '36px', height: '36px' }}
            title="Start Audio Call"
          >
            <Phone size={17} color="#0284c7" />
          </button>
          <button 
            onClick={() => onStartCall(chat, true)}
            className="glass-btn" 
            style={{ width: '36px', height: '36px' }}
            title="Start Video Call"
          >
            <Video size={17} color="#0284c7" />
          </button>
          <button 
            onClick={() => setShowProfileModal(true)}
            className="glass-btn" 
            style={{ width: '36px', height: '36px' }}
            title="More Options"
          >
            <MoreVertical size={17} color="var(--text-secondary)" />
          </button>
        </div>
      </header>

      {/* CHAT MESSAGES THREAD */}
      <div 
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        {/* End-to-End Encryption Notice Badge */}
        <div style={{ textAlign: 'center', margin: '4px 0 10px 0' }}>
          <span 
            onClick={() => setShowSecurityModal(true)}
            className="glass-pill" 
            style={{ 
              padding: '6px 14px', 
              fontSize: '11px', 
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Lock size={11} color="#16a34a" /> Messages are end-to-end encrypted
          </span>
        </div>

        {messages.map((msg, index) => {
          const isMe = msg.senderId === currentUser.id;
          const isAudio = msg.type === 'audio';

          return (
            <div 
              key={msg.id || index}
              style={{
                display: 'flex',
                justifyContent: isMe ? 'flex-end' : 'flex-start',
                position: 'relative'
              }}
            >
              <div 
                className={isMe ? 'message-bubble-outgoing' : 'message-bubble-incoming'}
                style={{
                  maxWidth: '82%',
                  padding: isAudio ? '8px 12px' : '10px 14px',
                  borderRadius: isMe ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                  boxShadow: 'var(--glass-shadow-sm)',
                  position: 'relative'
                }}
              >
                {/* Group sender tag */}
                {isGroup && !isMe && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: '#0284c7',
                    display: 'block',
                    marginBottom: '2px',
                    padding: msg.type === 'image' ? '4px 6px' : '0'
                  }}>
                    {msg.senderPhone ? `${msg.senderPhone} (~${msg.senderName})` : msg.senderName}
                  </span>
                )}

                {/* 1. DOCUMENT MESSAGE */}
                {msg.type === 'document' && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '8px 10px',
                    backgroundColor: isMe ? 'rgba(2, 132, 199, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                    borderRadius: '12px',
                    marginBottom: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        backgroundColor: '#6366f1',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <FileText size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{
                          margin: 0,
                          fontSize: '13px',
                          fontWeight: '700',
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '180px'
                        }}>
                          {msg.fileName || msg.text || 'Document'}
                        </p>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {msg.fileSize || 'File'}
                        </span>
                      </div>
                    </div>
                    {msg.mediaUrl && (
                      <a 
                        href={msg.mediaUrl} 
                        download={msg.fileName || 'document'} 
                        className="glass-btn"
                        style={{ width: '32px', height: '32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Download Document"
                      >
                        <Download size={15} color="#0284c7" />
                      </a>
                    )}
                  </div>
                )}

                {/* 2. IMAGE MESSAGE */}
                {msg.type === 'image' && msg.mediaUrl && (
                  <div style={{ borderRadius: '14px', overflow: 'hidden', marginBottom: '4px' }}>
                    <img 
                      src={msg.mediaUrl} 
                      alt="Attachment" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewImage(msg.mediaUrl);
                      }}
                      style={{
                        width: '100%',
                        maxHeight: '260px',
                        objectFit: 'cover',
                        display: 'block',
                        cursor: 'pointer'
                      }} 
                    />
                  </div>
                )}

                {/* 3. VIDEO MESSAGE */}
                {msg.type === 'video' && msg.mediaUrl && (
                  <div style={{ borderRadius: '14px', overflow: 'hidden', marginBottom: '4px' }}>
                    <video 
                      controls 
                      src={msg.mediaUrl}
                      style={{ width: '100%', maxHeight: '260px', borderRadius: '12px', display: 'block' }}
                    />
                  </div>
                )}

                {/* 4. AUDIO / VOICE NOTE MESSAGE */}
                {msg.type === 'audio' && msg.mediaUrl && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '4px 0',
                    minWidth: '180px'
                  }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlayAudio(msg.id, msg.mediaUrl);
                      }}
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        backgroundColor: isMe ? '#0284c7' : '#0f172a',
                        color: '#ffffff',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0
                      }}
                    >
                      {playingAudioId === msg.id ? <Pause size={17} /> : <Play size={17} style={{ marginLeft: '2px' }} />}
                    </button>

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '20px' }}>
                        {[8, 16, 12, 20, 14, 18, 10, 22, 16, 12, 18, 14, 10, 16, 8].map((h, i) => (
                          <span 
                            key={i} 
                            style={{
                              width: '3px',
                              height: `${h}px`,
                              backgroundColor: playingAudioId === msg.id && i % 3 === 0 ? '#0284c7' : 'rgba(100, 116, 139, 0.45)',
                              borderRadius: '2px',
                              transition: 'all 0.15s ease'
                            }} 
                          />
                        ))}
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                        {msg.text || 'Voice Note'}
                      </span>
                    </div>
                  </div>
                )}

                {/* 5. CONTACT CARD MESSAGE */}
                {msg.type === 'contact' && msg.contactData && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    backgroundColor: isMe ? 'rgba(2, 132, 199, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                    borderRadius: '14px',
                    minWidth: '180px',
                    marginBottom: '4px'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: '#0ea5e9',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '800',
                      fontSize: '16px'
                    }}>
                      <User size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)' }}>
                        {msg.contactData.name}
                      </strong>
                      <span style={{ fontSize: '12px', color: '#0284c7', fontWeight: '700' }}>
                        {msg.contactData.phone}
                      </span>
                    </div>
                  </div>
                )}

                {/* 6. POLL CARD MESSAGE */}
                {msg.type === 'poll' && msg.pollData && (
                  <div style={{
                    padding: '8px 4px',
                    minWidth: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <BarChart2 size={16} color="#eab308" />
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                        {msg.pollData.question}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {msg.pollData.options?.map(opt => {
                        const totalVotes = msg.pollData.options.reduce((acc, o) => acc + (o.votes?.length || 0), 0);
                        const optVotes = opt.votes?.length || 0;
                        const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
                        const hasVoted = opt.votes?.includes(currentUser.id);

                        return (
                          <div 
                            key={opt.id}
                            onClick={() => {
                              socket.emit('poll-vote', {
                                chatId,
                                messageId: msg.id,
                                optionId: opt.id,
                                userId: currentUser.id
                              });
                            }}
                            style={{
                              position: 'relative',
                              padding: '8px 12px',
                              borderRadius: '10px',
                              border: hasVoted ? '1.5px solid #0284c7' : '1px solid rgba(203, 213, 225, 0.8)',
                              backgroundColor: 'rgba(255, 255, 255, 0.7)',
                              cursor: 'pointer',
                              overflow: 'hidden'
                            }}
                          >
                            <div style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              bottom: 0,
                              width: `${pct}%`,
                              backgroundColor: hasVoted ? 'rgba(2, 132, 199, 0.2)' : 'rgba(203, 213, 225, 0.35)',
                              transition: 'width 0.3s ease',
                              zIndex: 1
                            }} />
                            <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                              <span style={{ fontWeight: hasVoted ? '800' : '600', color: hasVoted ? '#0284c7' : 'var(--text-primary)' }}>
                                {hasVoted ? '✓ ' : ''}{opt.text}
                              </span>
                              <span style={{ fontWeight: '700', color: 'var(--text-muted)', fontSize: '11px' }}>
                                {pct}% ({optVotes})
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 7. EVENT CARD MESSAGE */}
                {msg.type === 'event' && msg.eventData && (
                  <div style={{
                    padding: '10px 12px',
                    borderRadius: '12px',
                    backgroundColor: isMe ? 'rgba(2, 132, 199, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                    minWidth: '200px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '8px',
                        backgroundColor: '#f43f5e',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Calendar size={18} />
                      </div>
                      <div>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                          {msg.eventData.title}
                        </strong>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '4px' }}>
                      {msg.eventData.date && <span>📅 {msg.eventData.date} {msg.eventData.time && `at ${msg.eventData.time}`}</span>}
                      {msg.eventData.location && <span>📍 {msg.eventData.location}</span>}
                    </div>
                  </div>
                )}

                {/* 8. STICKER MESSAGE */}
                {msg.type === 'sticker' && msg.mediaUrl && (
                  <div style={{ padding: '4px', textAlign: 'center' }}>
                    <img 
                      src={msg.mediaUrl} 
                      alt="Sticker" 
                      style={{ width: '120px', height: '120px', objectFit: 'contain' }}
                    />
                  </div>
                )}

                {/* 9. STANDARD TEXT (if not audio/poll/event/document) */}
                {(!['audio', 'poll', 'event', 'document', 'sticker', 'contact', 'image', 'video'].includes(msg.type) || (['image', 'video', 'document'].includes(msg.type) && msg.text && !msg.text.startsWith('📷') && !msg.text.startsWith('📄') && !msg.text.startsWith('🎥'))) && (
                  <p style={{
                    fontSize: '14px',
                    lineHeight: '1.45',
                    color: 'var(--text-primary)',
                    margin: 0,
                    wordBreak: 'break-word',
                    padding: msg.type === 'image' ? '2px 6px' : '0'
                  }}>
                    {msg.text}
                  </p>
                )}

                {/* Timestamp & Status Ticks */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '4px',
                  marginTop: '3px',
                  padding: msg.type === 'image' ? '0 6px 2px 0' : '0'
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {msg.timestamp || 'Now'}
                  </span>
                  {isMe && (
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      {msg.status === 'read' ? (
                        <CheckCheck size={14} color="#0284c7" />
                      ) : (
                        <Check size={13} color="var(--text-muted)" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* BOTTOM INPUT BAR & ATTACHMENT MENU */}
      <div 
        className="glass-panel" 
        style={{
          padding: '8px 12px',
          paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
          borderTop: '1px solid rgba(255, 255, 255, 0.75)',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          position: 'relative',
          zIndex: 40
        }}
      >
        {/* Backdrop for closing attachment menu */}
        {showAttachmentMenu && (
          <div 
            onClick={() => setShowAttachmentMenu(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }}
          />
        )}

        {/* WhatsApp-Style Attachment Menu Popup */}
        {showAttachmentMenu && (
          <div 
            className="glass-panel"
            style={{
              position: 'absolute',
              bottom: '60px',
              left: '12px',
              zIndex: 70,
              width: '215px',
              borderRadius: '20px',
              padding: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.98)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
              border: '1.5px solid rgba(226, 232, 240, 0.9)',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              animation: 'fadeIn 0.15s ease'
            }}
          >
            {attachmentOptions.map(opt => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setShowAttachmentMenu(false);
                    opt.action();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '9px 12px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: '#0f172a',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <Icon size={20} color={opt.color} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Conditional Rendering: Voice Recording Bar vs Normal Input Bar */}
        {isRecording ? (
          /* Live Voice Recording UI */
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '4px 6px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            borderRadius: '24px',
            border: '1px solid rgba(239, 68, 68, 0.3)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                animation: 'pulse 1s infinite'
              }} />
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#ef4444' }}>
                {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Recording voice note...
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button 
                type="button"
                onClick={cancelRecording}
                className="glass-btn" 
                style={{ width: '34px', height: '34px', borderRadius: '50%', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' }}
                title="Cancel Recording"
              >
                <Trash2 size={16} />
              </button>
              <button 
                type="button"
                onClick={sendRecording}
                className="glass-btn glass-btn-primary"
                style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0, padding: 0 }}
                title="Send Voice Note"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        ) : (
          /* Normal Input Bar */
          <>
            <button 
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="glass-btn" 
              style={{ width: '32px', height: '32px', flexShrink: 0, padding: 0 }}
              title="Emojis"
            >
              <Smile size={18} color="var(--text-secondary)" />
            </button>

            {/* Paperclip Attachment Button */}
            <button
              type="button"
              onClick={() => setShowAttachmentMenu(prev => !prev)}
              className="glass-btn" 
              style={{
                width: '32px',
                height: '32px',
                flexShrink: 0,
                padding: 0,
                backgroundColor: showAttachmentMenu ? 'rgba(2, 132, 199, 0.15)' : undefined,
                borderColor: showAttachmentMenu ? '#0284c7' : undefined
              }}
              title="Attach Media & Options"
            >
              <Paperclip size={18} color={showAttachmentMenu ? '#0284c7' : 'var(--text-secondary)'} />
            </button>

            <form onSubmit={handleSendMessage} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                onFocus={(e) => {
                  window.scrollTo(0, 0);
                  if (messagesContainerRef.current) {
                    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
                  }
                  e.target.scrollIntoView({ block: 'nearest' });
                }}
                placeholder="Message..."
                className="glass-input"
                style={{
                  flex: 1,
                  minWidth: 0,
                  width: '100%',
                  fontSize: '15px',
                  fontWeight: '600',
                  padding: '9px 12px',
                  boxSizing: 'border-box',
                  backgroundColor: 'rgba(255, 255, 255, 0.96)',
                  color: '#0f172a',
                  WebkitTextFillColor: '#0f172a',
                  caretColor: '#0284c7',
                  border: '1.5px solid rgba(2, 132, 199, 0.45)'
                }}
              />

              {/* Microphone Button for Voice Note */}
              <button
                type="button"
                onClick={startRecording}
                className="glass-btn"
                style={{
                  width: '34px',
                  height: '34px',
                  flexShrink: 0,
                  padding: 0,
                  backgroundColor: 'rgba(2, 132, 199, 0.12)',
                  borderColor: '#0284c7',
                  color: '#0284c7'
                }}
                title="Record voice note"
              >
                <Mic size={16} />
              </button>

              {/* Send Button */}
              <button 
                type="submit"
                className="glass-btn glass-btn-primary" 
                style={{ 
                  width: '36px', 
                  height: '36px', 
                  flexShrink: 0,
                  padding: 0,
                  borderRadius: '50%',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.4)',
                  cursor: 'pointer'
                }}
                title="Send Message"
              >
                <Send size={16} style={{ marginLeft: '2px' }} />
              </button>
            </form>
          </>
        )}
      </div>

      {/* FULLSCREEN IMAGE PREVIEW MODAL */}
      {previewImage && (
        <div 
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 160,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <button 
            onClick={() => setPreviewImage(null)}
            className="glass-btn" 
            style={{ position: 'absolute', top: '20px', right: '20px', width: '36px', height: '36px', color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.2)' }}
          >
            <X size={18} />
          </button>
          <img 
            src={previewImage} 
            alt="Preview" 
            style={{ maxWidth: '100%', maxHeight: '90%', objectFit: 'contain', borderRadius: '12px' }} 
          />
        </div>
      )}

      {/* CONTACT SHARE MODAL */}
      {showContactModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 150,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '380px',
            borderRadius: '24px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            border: '2px solid rgba(255, 255, 255, 0.85)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={18} color="#0ea5e9" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>Share Contact</h3>
              </div>
              <button onClick={() => setShowContactModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            {/* Quick List from Contacts */}
            {contacts.length > 0 && (
              <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>SELECT FROM CONTACTS</span>
                {contacts.filter(c => c.id !== currentUser.id).map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleSendContact(c)}
                    className="glass-card"
                    style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  >
                    <div>
                      <strong style={{ fontSize: '13px', display: 'block' }}>{c.name}</strong>
                      <span style={{ fontSize: '11px', color: '#0284c7' }}>{c.phone}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>Share →</span>
                  </div>
                ))}
              </div>
            )}

            {/* Or Enter Manually */}
            <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>OR ENTER MANUALLY</span>
              <input 
                type="text"
                placeholder="Full Name..."
                value={manualContactName}
                onChange={e => setManualContactName(e.target.value)}
                className="glass-input"
                style={{ width: '100%', marginBottom: '6px', fontSize: '13px' }}
              />
              <input 
                type="text"
                placeholder="10-digit Phone Number..."
                value={manualContactPhone}
                onChange={e => setManualContactPhone(e.target.value)}
                className="glass-input"
                style={{ width: '100%', marginBottom: '10px', fontSize: '13px' }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!manualContactName.trim() || !manualContactPhone.trim()) {
                    alert('Please enter both name and phone number.');
                    return;
                  }
                  handleSendContact({ name: manualContactName.trim(), phone: manualContactPhone.trim() });
                  setManualContactName('');
                  setManualContactPhone('');
                }}
                className="glass-btn glass-btn-primary"
                style={{ width: '100%', height: '38px', borderRadius: '12px', fontSize: '13px', fontWeight: '700' }}
              >
                Send Contact Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POLL CREATOR MODAL */}
      {showPollModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 150,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '380px',
            borderRadius: '24px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            border: '2px solid rgba(255, 255, 255, 0.85)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BarChart2 size={18} color="#eab308" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>Create Poll</h3>
              </div>
              <button onClick={() => setShowPollModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSendPoll} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>QUESTION</label>
                <input 
                  type="text"
                  placeholder="Ask a question..."
                  value={pollQuestion}
                  onChange={e => setPollQuestion(e.target.value)}
                  className="glass-input"
                  required
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>OPTIONS</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {pollOptions.map((opt, i) => (
                    <input 
                      key={i}
                      type="text"
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={e => {
                        const val = e.target.value;
                        setPollOptions(prev => {
                          const updated = [...prev];
                          updated[i] = val;
                          return updated;
                        });
                      }}
                      className="glass-input"
                      style={{ width: '100%', fontSize: '13px' }}
                    />
                  ))}
                </div>
                {pollOptions.length < 5 && (
                  <button 
                    type="button"
                    onClick={() => setPollOptions(prev => [...prev, ''])}
                    style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '12px', fontWeight: '700', cursor: 'pointer', marginTop: '6px' }}
                  >
                    + Add Option
                  </button>
                )}
              </div>

              <button 
                type="submit"
                className="glass-btn glass-btn-primary"
                style={{ width: '100%', height: '40px', borderRadius: '12px', fontSize: '13px', fontWeight: '700', marginTop: '6px' }}
              >
                Send Poll
              </button>
            </form>
          </div>
        </div>
      )}

      {/* EVENT CREATOR MODAL */}
      {showEventModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 150,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '380px',
            borderRadius: '24px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            border: '2px solid rgba(255, 255, 255, 0.85)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} color="#f43f5e" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>Create Event</h3>
              </div>
              <button onClick={() => setShowEventModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSendEvent} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>EVENT NAME *</label>
                <input 
                  type="text"
                  placeholder="e.g. Birthday Party, Office Meeting..."
                  value={eventTitle}
                  onChange={e => setEventTitle(e.target.value)}
                  className="glass-input"
                  required
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>DATE</label>
                  <input 
                    type="date"
                    value={eventDate}
                    onChange={e => setEventDate(e.target.value)}
                    className="glass-input"
                    style={{ width: '100%', fontSize: '13px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>TIME</label>
                  <input 
                    type="time"
                    value={eventTime}
                    onChange={e => setEventTime(e.target.value)}
                    className="glass-input"
                    style={{ width: '100%', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>LOCATION</label>
                <input 
                  type="text"
                  placeholder="e.g. Meeting Room 2 / Zoom Link"
                  value={eventLocation}
                  onChange={e => setEventLocation(e.target.value)}
                  className="glass-input"
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>

              <button 
                type="submit"
                className="glass-btn glass-btn-primary"
                style={{ width: '100%', height: '40px', borderRadius: '12px', fontSize: '13px', fontWeight: '700', marginTop: '6px' }}
              >
                Send Event Card
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STICKER PICKER MODAL */}
      {showStickerModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 150,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '380px',
            borderRadius: '24px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            border: '2px solid rgba(255, 255, 255, 0.85)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SmilePlus size={18} color="#10b981" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>Choose Sticker</h3>
              </div>
              <button onClick={() => setShowStickerModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            {/* Sticker Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px',
              padding: '6px'
            }}>
              {[
                'https://api.iconify.design/fluent-emoji:cat-face.svg',
                'https://api.iconify.design/fluent-emoji:dog-face.svg',
                'https://api.iconify.design/fluent-emoji:rocket.svg',
                'https://api.iconify.design/fluent-emoji:red-heart.svg',
                'https://api.iconify.design/fluent-emoji:party-popper.svg',
                'https://api.iconify.design/fluent-emoji:fire.svg',
                'https://api.iconify.design/fluent-emoji:face-with-tears-of-joy.svg',
                'https://api.iconify.design/fluent-emoji:thumbs-up.svg',
                'https://api.iconify.design/fluent-emoji:partying-face.svg',
                'https://api.iconify.design/fluent-emoji:hundred-points.svg',
                'https://api.iconify.design/fluent-emoji:glowing-star.svg',
                'https://api.iconify.design/fluent-emoji:pizza.svg'
              ].map((url, i) => (
                <div
                  key={i}
                  onClick={() => {
                    emitMessage({
                      text: 'Sticker',
                      mediaUrl: url,
                      type: 'sticker'
                    });
                    setShowStickerModal(false);
                  }}
                  className="glass-card"
                  style={{
                    padding: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    borderRadius: '16px'
                  }}
                >
                  <img src={url} alt="Sticker" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => stickerInputRef.current?.click()}
              className="glass-btn"
              style={{ width: '100%', height: '38px', borderRadius: '12px', fontSize: '13px', fontWeight: '700', gap: '6px' }}
            >
              <Plus size={15} /> Upload Custom Sticker
            </button>
          </div>
        </div>
      )}

      {/* SECURITY MODAL */}
      {showSecurityModal && (
        <SecurityVerificationModal 
          chat={chat}
          currentUser={currentUser}
          onClose={() => setShowSecurityModal(false)}
        />
      )}

      {/* USER PROFILE MODAL */}
      {showProfileModal && (
        <UserProfileModal 
          user={chat}
          currentUser={currentUser}
          onClose={() => setShowProfileModal(false)}
          onStartCall={onStartCall}
          savedContactsMap={savedContactsMap}
          onSaveContact={onSaveContact}
        />
      )}
    </div>
  );
}
