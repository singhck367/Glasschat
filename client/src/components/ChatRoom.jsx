import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, Phone, Video, Send, Paperclip, 
  Smile, CheckCheck, Check, MoreVertical, Image, Users, Lock, 
  Mic, MicOff, Play, Pause, Trash2, X, Download,
  FileText, Camera, Headphones, User, BarChart2, Calendar, SmilePlus, Plus,
  PhoneMissed, Search, Copy, Languages, Zap,
  Reply, Forward, Pin, Star, Pencil, ShieldCheck, MapPin, IndianRupee,
  Clock, Handshake, Sparkles, Megaphone, ExternalLink, AlertTriangle
} from 'lucide-react';
import SecurityVerificationModal from './SecurityVerificationModal';
import UserProfileModal from './UserProfileModal';
import ChatFeatureModals, { WALLPAPER_PRESETS } from './ChatFeatureModals';
import { playNotificationSound, addSmartReminder } from '../services/notifications';
import { formatISTTime, formatLastSeen } from '../utils/time';
import { resolveDisplayName, isSavedNumber } from '../utils/contacts';
import {
  getCachedChatMessages,
  saveCachedChatMessages,
  enqueueOfflineMessage,
  removeOfflineQueuedMessage
} from '../utils/offlineQueue';
import {
  SUPPORTED_LANGUAGES,
  translateText,
  generateSmartReplies,
  analyzeMoodTone,
  extractSmartAction,
  maskUnknownLinks
} from '../utils/aiHelpers';

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
  onSaveContact,
  onOpenSos
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [remoteTypingUser, setRemoteTypingUser] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeMessageMenu, setActiveMessageMenu] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUrgentMode, setIsUrgentMode] = useState(false);
  const [translatedMessages, setTranslatedMessages] = useState({});

  // Saved contact name resolution
  const cleanPhoneDigits = (chat.phone || '').replace(/\D/g, '');
  const last10Digits = cleanPhoneDigits.slice(-10);
  const savedContactName = !chat.isGroup ? (savedContactsMap[last10Digits] || savedContactsMap[cleanPhoneDigits] || '') : '';
  const resolvedHeaderName = chat.isGroup ? chat.name : resolveDisplayName(chat, savedContactsMap, true);
  const [previewImage, setPreviewImage] = useState(null);

  // WhatsApp Attachment Menu & Modals State
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showStickerModal, setShowStickerModal] = useState(false);

  // Advanced Chat Features State
  const [chatSettings, setChatSettings] = useState({ disappearDurationMs: 0, pinnedMessageId: null, pinnedMessage: null });
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [summaryModal, setSummaryModal] = useState(null);
  const [truthCheckModal, setTruthCheckModal] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [scheduledList, setScheduledList] = useState([]);
  const [showTranscripts, setShowTranscripts] = useState({});
  const [reminderSavedIds, setReminderSavedIds] = useState({});
  const [rejectionToast, setRejectionToast] = useState('');
  const [isAnonPoll, setIsAnonPoll] = useState(false);
  const [anonVotes, setAnonVotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`glasschat_anon_votes_${currentUser?.id}`) || '{}');
    } catch {
      return {};
    }
  });

  const roomKey = chat.isGroup
    ? (chat.id.startsWith('group_') ? chat.id : `group_${chat.id}`)
    : ['chat', ...[currentUser.id, chat.id].sort()].join('_');

  const [autoTranslateLang, setAutoTranslateLang] = useState(() => localStorage.getItem(`glasschat_autotrans_${roomKey}`) || 'off');
  const [chatWallpaper, setChatWallpaper] = useState(() => localStorage.getItem(`glasschat_wallpaper_${roomKey}`) || 'default');
  const [moodGuardEnabled, setMoodGuardEnabled] = useState(() => localStorage.getItem('glasschat_mood_guard') !== 'off');

  const isChannelRestricted = Boolean(chat.isChannel) && chat.admin !== currentUser.id && !(Array.isArray(chat.admins) && chat.admins.includes(currentUser.id));
  const speechRecRef = useRef(null);
  const liveTranscriptRef = useRef('');

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

  // Mobile Back Button Support: Close inner popups (preview, attachments, etc.) before closing chat
  useEffect(() => {
    window.__handleChatInnerBack = () => {
      if (previewImage) {
        setPreviewImage(null);
        return true;
      }
      if (showEmojiPicker) {
        setShowEmojiPicker(false);
        return true;
      }
      if (showAttachmentMenu) {
        setShowAttachmentMenu(false);
        return true;
      }
      if (showProfileModal) {
        setShowProfileModal(false);
        return true;
      }
      if (showSecurityModal) {
        setShowSecurityModal(false);
        return true;
      }
      if (showContactModal) {
        setShowContactModal(false);
        return true;
      }
      if (showPollModal) {
        setShowPollModal(false);
        return true;
      }
      if (showEventModal) {
        setShowEventModal(false);
        return true;
      }
      if (showStickerModal) {
        setShowStickerModal(false);
        return true;
      }
      if (showOptionsModal) {
        setShowOptionsModal(false);
        return true;
      }
      if (summaryModal || truthCheckModal || forwardMsg || showScheduleModal || showUpiModal || showContractModal) {
        setSummaryModal(null);
        setTruthCheckModal(null);
        setForwardMsg(null);
        setShowScheduleModal(false);
        setShowUpiModal(false);
        setShowContractModal(false);
        return true;
      }
      if (activeMessageMenu) {
        setActiveMessageMenu(null);
        return true;
      }
      return false;
    };

    return () => {
      window.__handleChatInnerBack = null;
    };
  }, [
    previewImage, showEmojiPicker, showAttachmentMenu, 
    showProfileModal, showSecurityModal, showContactModal, 
    showPollModal, showEventModal, showStickerModal, activeMessageMenu,
    showOptionsModal, summaryModal, truthCheckModal, forwardMsg,
    showScheduleModal, showUpiModal, showContractModal
  ]);
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

  // Sync offline cache asynchronously (debounced so live messaging never blocks main thread)
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      saveCachedChatMessages(chatId, messages);
    }, 450);
    return () => clearTimeout(t);
  }, [messages, chatId]);

  // Auto-translate incoming messages when chat Auto-Translate is active
  useEffect(() => {
    if (autoTranslateLang === 'off') return;
    const recentIncoming = messages
      .filter(m => m.senderId !== currentUser.id && m.text && !translatedMessages[m.id] && m.type === 'text')
      .slice(-6);
    if (recentIncoming.length === 0) return;

    recentIncoming.forEach(async (m) => {
      try {
        const res = await translateText(m.text, autoTranslateLang);
        setTranslatedMessages(prev => ({
          ...prev,
          [m.id]: { text: res.translatedText, lang: res.langLabel }
        }));
      } catch {}
    });
  }, [messages, autoTranslateLang, currentUser.id]);

  // Fetch initial messages (offline cache first, then server) & Join Socket room
  useEffect(() => {
    setAutoTranslateLang(localStorage.getItem(`glasschat_autotrans_${chatId}`) || 'off');
    setChatWallpaper(localStorage.getItem(`glasschat_wallpaper_${chatId}`) || 'default');
    const cached = getCachedChatMessages(chatId);
    if (cached.length > 0) {
      setMessages(cached);
    } else {
      setMessages([]);
    }

    fetch(`/api/chats/${chatId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setMessages(data);
          saveCachedChatMessages(chatId, data);
        }
        socket.emit('mark-chat-seen', { chatId, readerId: currentUser.id });
      })
      .catch(err => console.error('Offline/Fetch chat history notice:', err));

    fetch(`/api/chats/${chatId}/settings?userId=${currentUser.id}`)
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) setChatSettings(data);
      })
      .catch(() => {});

    fetch(`/api/scheduled-messages?chatId=${chatId}&userId=${currentUser.id}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setScheduledList(data);
      })
      .catch(() => {});

    socket.emit('join-chat', { chatId });
    socket.emit('mark-chat-seen', { chatId, readerId: currentUser.id });

    const handleNewMessage = (payload) => {
      if (payload.chatId === chatId) {
        if (payload.tempId) {
          removeOfflineQueuedMessage(payload.tempId);
        }
        if (payload.message.senderId !== currentUser.id) {
          playNotificationSound();
          if (payload.message.isUrgent && typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate([300, 150, 300, 150, 400]); } catch (e) {}
          }
          socket.emit('mark-chat-seen', { chatId, readerId: currentUser.id });
        }

        setMessages(prev => {
          if (prev.some(m => m.id === payload.message.id)) return prev;

          if (payload.tempId && prev.some(m => m.id === payload.tempId)) {
            return prev.map(m => m.id === payload.tempId ? payload.message : m);
          }

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

    const handleUserTyping = (payload) => {
      if (payload.chatId === chatId && payload.userId !== currentUser.id) {
        setRemoteTypingUser(payload.isTyping ? (resolveDisplayName({ name: payload.userName, phone: chat.phone }, savedContactsMap, true)) : null);
      }
    };

    const handleChatMessagesSeen = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => 
          m.senderId === currentUser.id ? { ...m, status: 'seen' } : m
        ));
      }
    };

    const handleMessagesDelivered = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => 
          (!payload.deliveredIds || payload.deliveredIds.includes(m.id)) && m.senderId === currentUser.id && m.status === 'sent'
            ? { ...m, status: 'delivered' } 
            : m
        ));
      }
    };

    const handleMessageStatusUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, status: payload.status } : m));
      }
    };

    const handleReactionUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m));
      }
    };

    const handleMessageDeleted = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.filter(m => m.id !== payload.messageId));
      }
    };

    const handleMessageEdited = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, text: payload.newText, isEdited: true, editedAt: payload.editedAt } : m));
      }
    };

    const handleStarUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, starredBy: payload.starredBy } : m));
      }
    };

    const handlePinUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setChatSettings(prev => ({
          ...prev,
          pinnedMessageId: payload.pinnedMessageId,
          pinnedMessage: payload.pinnedMessage
        }));
      }
    };

    const handlePollUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, pollData: payload.pollData } : m));
      }
    };

    const handleContractUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, contractData: payload.contractData } : m));
      }
    };

    const handleUpiUpdated = (payload) => {
      if (payload.chatId === chatId) {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, upiData: payload.upiData } : m));
      }
    };

    const handleMessagesExpired = (payload) => {
      if (payload.chatId === chatId && Array.isArray(payload.expiredIds)) {
        setMessages(prev => prev.filter(m => !payload.expiredIds.includes(m.id)));
      }
    };

    const handleChatSettingsUpdated = (payload) => {
      if (payload.chatId === chatId && payload.settings) {
        setChatSettings(prev => ({ ...prev, ...payload.settings }));
      }
    };

    const handleScheduledSent = (payload) => {
      if (payload.chatId === chatId) {
        setScheduledList(prev => prev.filter(s => s.id !== payload.scheduledId));
      }
    };

    const handleMessageRejected = (payload) => {
      if (payload.chatId === chatId) {
        if (payload.tempId) {
          setMessages(prev => prev.filter(m => m.id !== payload.tempId));
        }
        setRejectionToast(payload.reason || 'Message could not be sent.');
        setTimeout(() => setRejectionToast(''), 4000);
      }
    };

    socket.on('new-message', handleNewMessage);
    socket.on('user-typing', handleUserTyping);
    socket.on('chat-messages-seen', handleChatMessagesSeen);
    socket.on('messages-delivered', handleMessagesDelivered);
    socket.on('message-status-updated', handleMessageStatusUpdated);
    socket.on('message-reaction-updated', handleReactionUpdated);
    socket.on('message-deleted', handleMessageDeleted);
    socket.on('message-edited', handleMessageEdited);
    socket.on('message-star-updated', handleStarUpdated);
    socket.on('chat-pin-updated', handlePinUpdated);
    socket.on('poll-updated', handlePollUpdated);
    socket.on('contract-updated', handleContractUpdated);
    socket.on('upi-updated', handleUpiUpdated);
    socket.on('messages-expired', handleMessagesExpired);
    socket.on('chat-settings-updated', handleChatSettingsUpdated);
    socket.on('scheduled-message-sent', handleScheduledSent);
    socket.on('message-rejected', handleMessageRejected);

    return () => {
      socket.emit('leave-chat', { chatId });
      socket.off('new-message', handleNewMessage);
      socket.off('user-typing', handleUserTyping);
      socket.off('chat-messages-seen', handleChatMessagesSeen);
      socket.off('messages-delivered', handleMessagesDelivered);
      socket.off('message-status-updated', handleMessageStatusUpdated);
      socket.off('message-reaction-updated', handleReactionUpdated);
      socket.off('message-deleted', handleMessageDeleted);
      socket.off('message-edited', handleMessageEdited);
      socket.off('message-star-updated', handleStarUpdated);
      socket.off('chat-pin-updated', handlePinUpdated);
      socket.off('poll-updated', handlePollUpdated);
      socket.off('contract-updated', handleContractUpdated);
      socket.off('upi-updated', handleUpiUpdated);
      socket.off('messages-expired', handleMessagesExpired);
      socket.off('chat-settings-updated', handleChatSettingsUpdated);
      socket.off('scheduled-message-sent', handleScheduledSent);
      socket.off('message-rejected', handleMessageRejected);
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
        recipientId: isGroup ? null : chat.id,
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
        recipientId: isGroup ? null : chat.id,
        isTyping: false
      });
    }, 1500);
  };

  // Helper to send message payload (supports reply quote & offline queue)
  const emitMessage = (msgData) => {
    const tempId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const timeStr = formatISTTime();
    const replySnapshot = replyingTo
      ? {
          id: replyingTo.id,
          senderName: resolveDisplayName(
            { name: replyingTo.senderName, phone: replyingTo.senderPhone },
            savedContactsMap,
            true
          ),
          text: replyingTo.text || (replyingTo.type !== 'text' ? `[${replyingTo.type}]` : '')
        }
      : null;

    const isSocketReady = Boolean(socket?.connected);

    const optimisticMsg = {
      id: tempId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderPhone: currentUser.phone || '',
      senderAvatar: currentUser.avatar || '',
      timestamp: timeStr,
      status: !isSocketReady ? 'queued' : (chat.online ? 'delivered' : 'sent'),
      encrypted: true,
      isUrgent: isUrgentMode,
      replyTo: replySnapshot,
      ...msgData
    };

    setMessages(prev => [...prev, optimisticMsg]);

    const payload = {
      tempId,
      chatId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderPhone: currentUser.phone || '',
      senderAvatar: currentUser.avatar || '',
      encrypted: true,
      recipientId: isGroup ? null : chat.id,
      isUrgent: isUrgentMode,
      replyTo: replySnapshot,
      ...msgData
    };

    if (isSocketReady) {
      socket.emit('send-message', payload);
    } else {
      enqueueOfflineMessage(payload);
    }

    if (isUrgentMode) setIsUrgentMode(false);
    if (replyingTo) setReplyingTo(null);
  };

  // Instant In-Chat & Multi-Language Translator
  const handleTranslateMessage = async (msgId, text) => {
    if (translatedMessages[msgId]) {
      setTranslatedMessages(prev => {
        const next = { ...prev };
        delete next[msgId];
        return next;
      });
      setActiveMessageMenu(null);
      return;
    }
    const hasDevanagari = /[\u0900-\u097F]/.test(text || '');
    const targetLang = autoTranslateLang !== 'off' ? autoTranslateLang : (hasDevanagari ? 'en' : 'hi');
    try {
      const res = await translateText(text, targetLang);
      setTranslatedMessages(prev => ({
        ...prev,
        [msgId]: { text: res.translatedText, lang: res.langLabel }
      }));
    } catch (e) {
      console.warn('Translation failed:', e);
    }
    setActiveMessageMenu(null);
  };

  // Handle Send OR Edit Text Message
  const handleSendMessage = (e) => {
    e?.preventDefault();
    const textToSend = inputText.trim();
    if (!textToSend) return;

    if (editingMsg) {
      socket.emit('edit-message', {
        chatId,
        messageId: editingMsg.id,
        newText: textToSend,
        userId: currentUser.id
      });
      setEditingMsg(null);
      setInputText('');
      return;
    }

    emitMessage({ text: textToSend, type: 'text' });
    setInputText('');
    setShowEmojiPicker(false);
  };

  // Share Current Location Card
  const handleShareLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      alert('Location sharing is not supported on this browser/device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        emitMessage({
          text: `📍 Shared Location: https://maps.google.com/?q=${lat},${lng}`,
          type: 'location',
          locationData: { lat, lng, accuracy: Math.round(pos.coords.accuracy || 0), label: 'Current Location' }
        });
      },
      () => {
        alert('Location permission denied or unavailable. Please allow GPS access.');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  // Run AI Truth Check (Fact-Check)
  const handleRunTruthCheck = async (msg) => {
    setActiveMessageMenu(null);
    setTruthCheckModal({ loading: true });
    try {
      const res = await fetch('/api/ai/truth-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.text || msg.transcript || '' })
      });
      const data = await res.json();
      setTruthCheckModal(data);
    } catch {
      setTruthCheckModal({
        verdict: 'Unable to reach Truth Check server',
        level: 'caution',
        riskScore: 0,
        reasons: ['Check your internet connection and try again.'],
        references: []
      });
    }
  };

  // Run AI Chat Summary
  const handleRunAiSummary = async () => {
    setSummaryModal({ loading: true });
    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId })
      });
      const data = await res.json();
      setSummaryModal(data);
    } catch {
      setSummaryModal({ summary: 'Summary unavailable offline.', decisions: [], questions: [], actionItems: [] });
    }
  };

  const handleUpdateDisappearTimer = async (durationMs) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disappearDurationMs: durationMs, userId: currentUser.id })
      });
      const data = await res.json();
      if (data.success && data.settings) {
        setChatSettings(prev => ({ ...prev, ...data.settings }));
      }
    } catch {}
  };

  const handleConfirmForward = (targetUser, msg) => {
    const targetChatId = targetUser.isGroup
      ? (targetUser.id.startsWith('group_') ? targetUser.id : `group_${targetUser.id}`)
      : ['chat', ...[currentUser.id, targetUser.id].sort()].join('_');
    socket.emit('send-message', {
      tempId: 'fwd_' + Date.now(),
      chatId: targetChatId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderPhone: currentUser.phone || '',
      senderAvatar: currentUser.avatar || '',
      recipientId: targetUser.isGroup ? null : targetUser.id,
      text: msg.text || '',
      mediaUrl: msg.mediaUrl || null,
      type: msg.type || 'text',
      fileName: msg.fileName || null,
      fileSize: msg.fileSize || null,
      locationData: msg.locationData || null,
      isForwarded: true,
      encrypted: true
    });
    setForwardMsg(null);
    setRejectionToast(`Forwarded to ${resolveDisplayName(targetUser, savedContactsMap, true)} ✅`);
    setTimeout(() => setRejectionToast(''), 2500);
  };

  const handleConfirmSchedule = async ({ text, sendAtMs }) => {
    try {
      const res = await fetch('/api/scheduled-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sendAtMs,
          payload: {
            chatId,
            senderId: currentUser.id,
            senderName: currentUser.name,
            senderPhone: currentUser.phone || '',
            senderAvatar: currentUser.avatar || '',
            recipientId: isGroup ? null : chat.id,
            text,
            type: 'text',
            encrypted: true
          }
        })
      });
      const data = await res.json();
      if (data.success && data.scheduled) {
        setScheduledList(prev => [...prev, data.scheduled]);
        setRejectionToast(`⏰ Scheduled for ${data.scheduled.sendAtFormatted}`);
        setTimeout(() => setRejectionToast(''), 3000);
      }
    } catch {}
  };

  const handleCancelScheduled = async (schedId) => {
    try {
      await fetch(`/api/scheduled-messages/${schedId}`, { method: 'DELETE' });
      setScheduledList(prev => prev.filter(s => s.id !== schedId));
    } catch {}
  };

  const handleConfirmUpi = ({ vpa, amount, note, mode }) => {
    emitMessage({
      text: `💸 UPI ${mode === 'request' ? 'Payment Request' : 'Pay Card'}: ₹${amount} (${note})`,
      type: 'upi',
      upiData: { vpa, amount, note, mode, status: 'pending' }
    });
  };

  const handleConfirmContract = ({ title, dueText, amount }) => {
    emitMessage({
      text: `🤝 Chat Contract: ${title}${dueText ? ` (Due: ${dueText})` : ''}`,
      type: 'contract',
      contractData: { title, dueText, amount, status: 'pending' }
    });
  };

  const handleCreateQuickReminder = (msgId, title, triggerAtMs, sourceText) => {
    addSmartReminder({
      title,
      triggerAtMs,
      chatName: resolvedHeaderName,
      sourceText
    });
    setReminderSavedIds(prev => ({ ...prev, [msgId]: true }));
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
      text: `${isAnonPoll ? '🕵️ Anonymous Poll' : '📊 Poll'}: ${cleanQuestion}`,
      type: 'poll',
      pollData: {
        question: cleanQuestion,
        isAnonymous: isAnonPoll,
        options: cleanOptions.map((optText, idx) => ({
          id: String(idx + 1),
          text: optText,
          votes: []
        }))
      }
    });

    setPollQuestion('');
    setPollOptions(['', '']);
    setIsAnonPoll(false);
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
      liveTranscriptRef.current = '';

      // Start Voice-to-Text live speech recognition when browser/WebView supports it
      try {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRec) {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-IN';
          rec.onresult = (event) => {
            let textOut = '';
            for (let i = 0; i < event.results.length; i++) {
              textOut += event.results[i][0].transcript + ' ';
            }
            liveTranscriptRef.current = textOut.trim();
          };
          rec.onerror = () => {};
          rec.start();
          speechRecRef.current = rec;
        }
      } catch {}

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
    try { speechRecRef.current?.stop(); } catch {}
    speechRecRef.current = null;
    liveTranscriptRef.current = '';
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
    try { speechRecRef.current?.stop(); } catch {}
    const capturedTranscript = liveTranscriptRef.current;
    speechRecRef.current = null;
    liveTranscriptRef.current = '';

    const durationStr = `${Math.floor(recordingSeconds / 60)}:${(recordingSeconds % 60).toString().padStart(2, '0')}`;
    const tempId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const timeStr = formatISTTime();

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
          transcript: capturedTranscript || '',
          mediaUrl: reader.result,
          type: 'audio',
          encrypted: true,
          timestamp: timeStr,
          status: socket?.connected ? 'delivered' : 'queued'
        };
        setMessages(prev => [...prev, optimisticMsg]);

        const payload = {
          tempId,
          chatId,
          senderId: currentUser.id,
          senderName: currentUser.name,
          senderPhone: currentUser.phone || '',
          senderAvatar: currentUser.avatar || '',
          text: `🎤 Voice message (${durationStr})`,
          transcript: capturedTranscript || '',
          mediaUrl: reader.result,
          type: 'audio',
          encrypted: true,
          recipientId: isGroup ? null : chat.id
        };
        if (socket?.connected) {
          socket.emit('send-message', payload);
        } else {
          enqueueOfflineMessage(payload);
        }
      };
      reader.readAsDataURL(audioBlob);
    };

    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const [audioPlaybackRate, setAudioPlaybackRate] = useState(1);

  const handleToggleAudioSpeed = () => {
    const nextSpeed = audioPlaybackRate === 1 ? 1.5 : audioPlaybackRate === 1.5 ? 2 : 1;
    setAudioPlaybackRate(nextSpeed);
    if (currentAudioRef.current) {
      currentAudioRef.current.playbackRate = nextSpeed;
    }
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
      audio.playbackRate = audioPlaybackRate;
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
      id: 'location',
      label: 'Location',
      icon: MapPin,
      color: '#16a34a',
      action: () => handleShareLocation()
    },
    {
      id: 'upi',
      label: 'UPI Pay / Request',
      icon: IndianRupee,
      color: '#059669',
      action: () => setShowUpiModal(true)
    },
    {
      id: 'schedule',
      label: 'Schedule Message',
      icon: Clock,
      color: '#8b5cf6',
      action: () => setShowScheduleModal(true)
    },
    {
      id: 'contract',
      label: 'Chat Contract',
      icon: Handshake,
      color: '#0284c7',
      action: () => setShowContractModal(true)
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
        borderBottom: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-bg-header)',
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
                    <>
                      {chat.isChannel && <Megaphone size={13} color="#0284c7" />}
                      <span>{chat.name}</span>
                    </>
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
                      <span>{resolvedHeaderName}</span>
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
                    resolvedHeaderName
                  )}
                </h2>
                {chatSettings?.disappearDurationMs > 0 && (
                  <span className="glass-pill" style={{ padding: '1px 6px', fontSize: '9px', fontWeight: '800', color: '#8b5cf6' }}>
                    ⏱️ {chatSettings.disappearDurationMs >= 604800000 ? '7d' : '24h'}
                  </span>
                )}
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
                {remoteTypingUser ? `${remoteTypingUser} is typing...` : (chat.online ? 'Online' : (chat.lastSeen ? formatLastSeen(chat.lastSeen) : 'Tap for contact info'))}
              </span>
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button 
            onClick={() => {
              setIsSearchOpen(prev => !prev);
              if (isSearchOpen) setSearchQuery('');
            }}
            className="glass-btn" 
            style={{ 
              width: '36px', 
              height: '36px',
              backgroundColor: isSearchOpen ? 'rgba(2, 132, 199, 0.12)' : undefined,
              borderColor: isSearchOpen ? '#0284c7' : undefined
            }}
            title="Search Messages"
          >
            <Search size={17} color={isSearchOpen ? '#0284c7' : 'var(--text-secondary)'} />
          </button>
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
            onClick={() => handleRunAiSummary()}
            className="glass-btn" 
            style={{ width: '34px', height: '34px' }}
            title="AI Chat Summary"
          >
            <Sparkles size={16} color="#0284c7" />
          </button>
          <button 
            onClick={() => setShowOptionsModal(true)}
            className="glass-btn" 
            style={{ width: '34px', height: '34px' }}
            title="Smart Chat Controls & Settings"
          >
            <MoreVertical size={16} color="var(--text-secondary)" />
          </button>
        </div>
      </header>

      {/* IN-CHAT MESSAGE SEARCH BAR */}
      {isSearchOpen && (
        <div style={{
          padding: '8px 16px',
          backgroundColor: 'var(--glass-bg-header)',
          borderBottom: '1px solid var(--glass-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
          zIndex: 35
        }}>
          <Search size={16} color="var(--text-muted)" />
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages in chat..."
            autoFocus
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '13px',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)'
            }}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex' }}
            >
              <X size={15} color="var(--text-muted)" />
            </button>
          )}
        </div>
      )}

      {/* PINNED MESSAGE BANNER */}
      {chatSettings?.pinnedMessage && (
        <div style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(2, 132, 199, 0.1)',
          borderBottom: '1px solid rgba(2, 132, 199, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            <Pin size={13} color="#0284c7" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: '700', color: '#0284c7', flexShrink: 0 }}>Pinned:</span>
            <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {chatSettings.pinnedMessage.text || `[${chatSettings.pinnedMessage.type}]`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => socket.emit('pin-message', { chatId, messageId: chatSettings.pinnedMessage.id, userId: currentUser.id })}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            title="Unpin message"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* STARRED FILTER / TRANSLATE / REJECTION TOAST BANNER */}
      {(showStarredOnly || autoTranslateLang !== 'off' || rejectionToast) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 14px', backgroundColor: 'var(--glass-bg-subtle)', borderBottom: '1px solid var(--glass-border-subtle)' }}>
          {showStarredOnly && (
            <button type="button" onClick={() => setShowStarredOnly(false)} className="glass-pill" style={{ padding: '2px 10px', fontSize: '11px', fontWeight: '700', color: '#eab308', cursor: 'pointer' }}>
              ⭐ Showing Starred Only (Clear ✕)
            </button>
          )}
          {autoTranslateLang !== 'off' && (
            <span className="glass-pill" style={{ padding: '2px 10px', fontSize: '11px', fontWeight: '700', color: '#0284c7' }}>
              🌐 Auto-Translate: {SUPPORTED_LANGUAGES.find(l => l.code === autoTranslateLang)?.name || autoTranslateLang}
            </span>
          )}
          {rejectionToast && (
            <span className="glass-pill" style={{ padding: '2px 10px', fontSize: '11px', fontWeight: '700', color: '#059669' }}>
              {rejectionToast}
            </span>
          )}
        </div>
      )}

      {/* CHAT MESSAGES THREAD */}
      <div 
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: (WALLPAPER_PRESETS.find(w => w.id === chatWallpaper)?.bg) || 'transparent'
        }}
      >

        {(() => {
          const baseList = showStarredOnly
            ? messages.filter(m => Array.isArray(m.starredBy) && m.starredBy.includes(currentUser.id))
            : messages;
          const displayedMessages = searchQuery.trim() 
            ? baseList.filter(m => (m.text || '').toLowerCase().includes(searchQuery.toLowerCase()))
            : baseList;

          if (displayedMessages.length === 0 && (searchQuery.trim() || showStarredOnly)) {
            return (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                {showStarredOnly ? 'No starred messages in this chat yet.' : <>No messages found matching "<strong>{searchQuery}</strong>"</>}
              </div>
            );
          }

          return displayedMessages.map((msg, index) => {
            const isMe = msg.senderId === currentUser.id;
            const isAudio = msg.type === 'audio';
            const isMenuActive = activeMessageMenu === msg.id;

            return (
              <div 
                key={msg.id || index}
                style={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  position: 'relative',
                  marginBottom: msg.reactions && Object.keys(msg.reactions).length > 0 ? '8px' : '0'
                }}
              >
                {/* Floating Emoji & Full Message Action Bar */}
                {isMenuActive && (
                  <div 
                    className="glass-panel"
                    style={{
                      position: 'absolute',
                      top: '-54px',
                      right: isMe ? '4px' : 'auto',
                      left: isMe ? 'auto' : '4px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '5px',
                      maxWidth: '295px',
                      padding: '4px 9px',
                      borderRadius: '18px',
                      backgroundColor: 'var(--glass-bg-header)',
                      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)',
                      border: '1px solid var(--glass-border)',
                      zIndex: 35
                    }}
                  >
                    {['❤️', '👍', '😂', '😮', '😢', '🙏'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReact(msg.id, emoji);
                        }}
                        style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', padding: '1px', lineHeight: 1 }}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setReplyingTo(msg);
                        setEditingMsg(null);
                        setActiveMessageMenu(null);
                      }}
                      title="Reply"
                      style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    >
                      <Reply size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setForwardMsg(msg);
                        setActiveMessageMenu(null);
                      }}
                      title="Forward"
                      style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    >
                      <Forward size={14} />
                    </button>
                    {msg.text && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard?.writeText(msg.text).catch(() => {});
                          setActiveMessageMenu(null);
                        }}
                        title="Copy"
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                      >
                        <Copy size={14} />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        socket.emit('star-message', { chatId, messageId: msg.id, userId: currentUser.id });
                        setActiveMessageMenu(null);
                      }}
                      title="Star / Save Message"
                      style={{ background: 'none', border: 'none', color: '#eab308', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    >
                      <Star size={14} fill={Array.isArray(msg.starredBy) && msg.starredBy.includes(currentUser.id) ? '#eab308' : 'none'} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        socket.emit('pin-message', { chatId, messageId: msg.id, userId: currentUser.id });
                        setActiveMessageMenu(null);
                      }}
                      title="Pin / Unpin Message"
                      style={{ background: 'none', border: 'none', color: '#8b5cf6', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    >
                      <Pin size={14} />
                    </button>
                    {isMe && msg.type === 'text' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingMsg(msg);
                          setReplyingTo(null);
                          setInputText(msg.text || '');
                          setActiveMessageMenu(null);
                        }}
                        title="Edit Message"
                        style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', padding: '2px', display: 'flex' }}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {(msg.text || msg.transcript) && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTranslateMessage(msg.id, msg.text || msg.transcript);
                          }}
                          title="Translate"
                          style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', padding: '2px', display: 'flex' }}
                        >
                          <Languages size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRunTruthCheck(msg);
                          }}
                          title="Truth Check (Fact-Check Forwarded Claims)"
                          style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', padding: '2px', display: 'flex' }}
                        >
                          <ShieldCheck size={14} />
                        </button>
                      </>
                    )}
                    {isMe && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMessage(msg.id);
                        }}
                        title="Delete for everyone"
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px', display: 'flex' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}

                <div 
                  onClick={() => setActiveMessageMenu(isMenuActive ? null : msg.id)}
                  className={isMe ? 'message-bubble-outgoing' : 'message-bubble-incoming'}
                  style={{
                    maxWidth: '82%',
                    padding: isAudio ? '8px 12px' : '10px 14px',
                    borderRadius: isMe ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                    boxShadow: msg.isUrgent ? '0 0 14px rgba(239, 68, 68, 0.45)' : undefined,
                    border: msg.isUrgent ? '1.5px solid #ef4444' : undefined,
                    position: 'relative',
                    cursor: 'pointer'
                  }}
                >
                {/* Forwarded Tag */}
                {msg.isForwarded && (
                  <div style={{ fontSize: '10px', fontStyle: 'italic', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '3px' }}>
                    <Forward size={10} /> Forwarded
                  </div>
                )}

                {/* Replied-To Quote Preview */}
                {msg.replyTo && (
                  <div style={{
                    padding: '4px 8px',
                    marginBottom: '5px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(2, 132, 199, 0.1)',
                    borderLeft: '3px solid #0284c7',
                    fontSize: '11px'
                  }}>
                    <div style={{ fontWeight: '800', color: '#0284c7' }}>{msg.replyTo.senderName}</div>
                    <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>
                      {msg.replyTo.text}
                    </div>
                  </div>
                )}

                {/* Urgent Priority Alert Badge */}
                {msg.isUrgent && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 7px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    color: '#ef4444',
                    fontSize: '10px',
                    fontWeight: '800',
                    marginBottom: '4px'
                  }}>
                    <Zap size={11} fill="#ef4444" /> URGENT BUZZ
                  </div>
                )}
                {/* Group sender tag resolved from Saved Contacts */}
                {isGroup && !isMe && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: '#0284c7',
                    display: 'block',
                    marginBottom: '2px',
                    padding: msg.type === 'image' ? '4px 6px' : '0'
                  }}>
                    {resolveDisplayName({ name: msg.senderName, phone: msg.senderPhone }, savedContactsMap, true)}
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

                {/* 4. AUDIO / VOICE NOTE MESSAGE + SPEECH-TO-TEXT + ACTION */}
                {msg.type === 'audio' && msg.mediaUrl && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '4px 0',
                      minWidth: '185px'
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px', gap: '4px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                            {msg.text || 'Voice Note'}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {msg.transcript && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowTranscripts(p => ({ ...p, [msg.id]: !p[msg.id] }));
                                }}
                                className="glass-pill"
                                style={{ padding: '1px 6px', fontSize: '9px', fontWeight: '800', color: '#059669', cursor: 'pointer' }}
                              >
                                📝 Text
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleAudioSpeed();
                              }}
                              className="glass-pill"
                              style={{
                                padding: '1px 7px',
                                fontSize: '10px',
                                fontWeight: '800',
                                backgroundColor: 'rgba(2, 132, 199, 0.15)',
                                color: '#0284c7',
                                border: '1px solid rgba(2, 132, 199, 0.3)',
                                cursor: 'pointer'
                              }}
                              title="Change playback speed (1x, 1.5x, 2x)"
                            >
                              {audioPlaybackRate}x
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {msg.transcript && showTranscripts[msg.id] && (
                      <div style={{ fontSize: '11px', padding: '5px 8px', borderRadius: '8px', backgroundColor: 'rgba(2,132,199,0.08)', color: 'var(--text-primary)' }}>
                        <strong>Voice → Text:</strong> "{msg.transcript}"
                      </div>
                    )}

                    {msg.transcript && (() => {
                      const voiceAct = extractSmartAction(msg.transcript);
                      if (!voiceAct) return null;
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateQuickReminder(msg.id, voiceAct.title, voiceAct.suggestedTimeMs, msg.transcript);
                          }}
                          className="glass-pill"
                          style={{ alignSelf: 'flex-start', padding: '3px 9px', fontSize: '10px', fontWeight: '800', color: reminderSavedIds[msg.id] ? '#16a34a' : '#8b5cf6', cursor: 'pointer' }}
                        >
                          {reminderSavedIds[msg.id] ? '✅ Reminder Saved' : `⏰ ${voiceAct.label}`}
                        </button>
                      );
                    })()}
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

                {/* 6. POLL / ANONYMOUS VOTE CARD MESSAGE */}
                {msg.type === 'poll' && msg.pollData && (
                  <div style={{
                    padding: '8px 4px',
                    minWidth: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <BarChart2 size={16} color="#eab308" />
                        <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                          {msg.pollData.question}
                        </strong>
                      </div>
                      {msg.pollData.isAnonymous && (
                        <span className="glass-pill" style={{ padding: '1px 6px', fontSize: '9px', fontWeight: '800', color: '#8b5cf6' }}>
                          🕵️ Secret
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {msg.pollData.options?.map(opt => {
                        const totalVotes = msg.pollData.options.reduce((acc, o) => acc + (o.votes?.length || 0), 0);
                        const optVotes = opt.votes?.length || 0;
                        const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
                        const hasVoted = opt.votes?.includes(currentUser.id) || (msg.pollData.isAnonymous && anonVotes[msg.id] === opt.id);

                        return (
                          <div 
                            key={opt.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (msg.pollData.isAnonymous) {
                                const nextAnon = { ...anonVotes, [msg.id]: anonVotes[msg.id] === opt.id ? null : opt.id };
                                setAnonVotes(nextAnon);
                                localStorage.setItem(`glasschat_anon_votes_${currentUser.id}`, JSON.stringify(nextAnon));
                              }
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
                              border: hasVoted ? '1.5px solid #0284c7' : '1px solid var(--glass-border)',
                              backgroundColor: 'var(--glass-bg-subtle)',
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
                              backgroundColor: hasVoted ? 'rgba(2, 132, 199, 0.22)' : 'rgba(148, 163, 184, 0.2)',
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

                {/* 9. CALL EVENT MESSAGE (WhatsApp Style) */}
                {msg.type === 'call_log' && (
                  <div 
                    onClick={() => {
                      const isVid = (msg.text || '').includes('Video') || (msg.text || '').includes('📹');
                      onStartCall && onStartCall(chat, isVid);
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '14px',
                      backgroundColor: isMe ? 'rgba(2, 132, 199, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                      minWidth: '200px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      cursor: 'pointer'
                    }}
                    title="Tap to call back"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: (msg.text || '').includes('Missed') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: (msg.text || '').includes('Missed') ? '#ef4444' : '#16a34a',
                        flexShrink: 0
                      }}>
                        {(msg.text || '').includes('Missed') ? (
                          <PhoneMissed size={18} />
                        ) : ((msg.text || '').includes('Video') || (msg.text || '').includes('📹')) ? (
                          <Video size={18} />
                        ) : (
                          <Phone size={18} />
                        )}
                      </div>
                      <div>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: '700',
                          color: (msg.text || '').includes('Missed') ? '#ef4444' : 'var(--text-primary)'
                        }}>
                          {msg.text || 'Call'}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                          {(msg.text || '').includes('Missed') ? 'Tap to call back' : (isMe ? 'Outgoing call' : 'Incoming call')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 10. LOCATION SHARE CARD */}
                {msg.type === 'location' && msg.locationData && (
                  <a
                    href={`https://maps.google.com/?q=${msg.locationData.lat},${msg.locationData.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '14px',
                      backgroundColor: isMe ? 'rgba(2,132,199,0.1)' : 'rgba(16,185,129,0.1)',
                      textDecoration: 'none',
                      minWidth: '210px'
                    }}
                  >
                    <div style={{ width: '38px', height: '38px', borderRadius: '10px', backgroundColor: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <MapPin size={19} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-primary)' }}>
                        {msg.locationData.label || 'Live GPS Location'}
                      </div>
                      <div style={{ fontSize: '11px', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {msg.locationData.lat.toFixed(4)}, {msg.locationData.lng.toFixed(4)} <ExternalLink size={10} />
                      </div>
                    </div>
                  </a>
                )}

                {/* 11. IN-CHAT UPI PAYMENT CARD */}
                {msg.type === 'upi' && msg.upiData && (
                  <div style={{
                    padding: '10px 12px',
                    borderRadius: '14px',
                    backgroundColor: msg.upiData.status === 'paid' ? 'rgba(22,163,74,0.12)' : 'rgba(2,132,199,0.09)',
                    border: `1px solid ${msg.upiData.status === 'paid' ? '#16a34a' : 'rgba(2,132,199,0.35)'}`,
                    minWidth: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', fontWeight: '800', color: '#16a34a', textTransform: 'uppercase' }}>
                        💸 UPI {msg.upiData.mode === 'request' ? 'Payment Request' : 'Payment'}
                      </span>
                      <span className="glass-pill" style={{ padding: '1px 7px', fontSize: '10px', fontWeight: '800', color: msg.upiData.status === 'paid' ? '#16a34a' : '#d97706' }}>
                        {msg.upiData.status === 'paid' ? '✅ PAID' : 'Pending'}
                      </span>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: 'var(--text-primary)' }}>
                      ₹{msg.upiData.amount}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      UPI: <strong>{msg.upiData.vpa}</strong> • {msg.upiData.note}
                    </div>
                    {msg.upiData.status !== 'paid' && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <a
                          href={`upi://pay?pa=${encodeURIComponent(msg.upiData.vpa)}&pn=${encodeURIComponent(resolvedHeaderName)}&am=${msg.upiData.amount}&cu=INR&tn=${encodeURIComponent(msg.upiData.note || 'GlassChat')}`}
                          onClick={(e) => e.stopPropagation()}
                          className="glass-btn glass-btn-primary"
                          style={{ flex: 1, height: '30px', borderRadius: '10px', fontSize: '11px', fontWeight: '800', textDecoration: 'none' }}
                        >
                          Pay via UPI App
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            socket.emit('upi-action', { chatId, messageId: msg.id, status: 'paid', userId: currentUser.id });
                          }}
                          className="glass-btn"
                          style={{ height: '30px', padding: '0 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', color: '#16a34a' }}
                        >
                          Mark Paid
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 12. CHAT CONTRACT / PROMISE CARD */}
                {msg.type === 'contract' && msg.contractData && (
                  <div style={{
                    padding: '10px 12px',
                    borderRadius: '14px',
                    backgroundColor: msg.contractData.status === 'completed' ? 'rgba(22,163,74,0.12)' : 'rgba(14,165,233,0.1)',
                    border: '1px solid rgba(2,132,199,0.35)',
                    minWidth: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: '800', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Handshake size={14} /> CHAT CONTRACT
                      </span>
                      <span className="glass-pill" style={{ padding: '1px 7px', fontSize: '10px', fontWeight: '800', color: msg.contractData.status === 'completed' ? '#16a34a' : '#0284c7' }}>
                        {msg.contractData.status === 'completed' ? '✅ Fulfilled' : msg.contractData.status === 'accepted' ? '🤝 Accepted' : '⏳ Proposed'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-primary)' }}>
                      {msg.contractData.title}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Due: <strong>{msg.contractData.dueText}</strong>{msg.contractData.amount ? ` • ${msg.contractData.amount}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                      {msg.contractData.status === 'pending' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            socket.emit('contract-action', { chatId, messageId: msg.id, action: 'accept', userId: currentUser.id, userName: currentUser.name });
                          }}
                          className="glass-btn glass-btn-primary"
                          style={{ height: '28px', padding: '0 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}
                        >
                          Accept Promise 🤝
                        </button>
                      )}
                      {msg.contractData.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            socket.emit('contract-action', { chatId, messageId: msg.id, action: 'complete', userId: currentUser.id, userName: currentUser.name });
                          }}
                          className="glass-btn"
                          style={{ height: '28px', padding: '0 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', color: '#16a34a' }}
                        >
                          Mark Done ✅
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateQuickReminder(msg.id, `Promise: ${msg.contractData.title}`, Date.now() + 3600000, msg.contractData.dueText);
                        }}
                        className="glass-btn"
                        style={{ height: '28px', padding: '0 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', color: reminderSavedIds[msg.id] ? '#16a34a' : '#8b5cf6' }}
                      >
                        {reminderSavedIds[msg.id] ? '✅ Reminded' : '⏰ Remind'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 13. STANDARD TEXT (with Family Safe unknown link protection + Smart Action detector) */}
                {(!['audio', 'poll', 'event', 'document', 'sticker', 'contact', 'image', 'video', 'call_log', 'location', 'upi', 'contract'].includes(msg.type) || (['image', 'video', 'document'].includes(msg.type) && msg.text && !msg.text.startsWith('📷') && !msg.text.startsWith('📄') && !msg.text.startsWith('🎥'))) && (() => {
                  const shouldMaskLinks = Boolean(
                    currentUser?.familySafe?.enabled &&
                    currentUser?.familySafe?.blockUnknownLinks &&
                    !isMe &&
                    !isSavedNumber(msg.senderPhone || chat.phone, savedContactsMap)
                  );
                  const displayText = shouldMaskLinks ? maskUnknownLinks(msg.text || '') : (msg.text || '');
                  const smartAction = msg.type === 'text' ? extractSmartAction(msg.text || '') : null;
                  return (
                    <>
                      <p style={{
                        fontSize: '14px',
                        lineHeight: '1.45',
                        color: !isMe ? 'var(--text-primary)' : (
                          msg.status === 'seen' || msg.status === 'read' ? '#0284c7' :
                          msg.status === 'delivered' ? '#059669' : '#ef4444'
                        ),
                        fontWeight: isMe ? '500' : '400',
                        margin: 0,
                        wordBreak: 'break-word',
                        padding: msg.type === 'image' ? '2px 6px' : '0'
                      }}>
                        {displayText}
                      </p>
                      {shouldMaskLinks && displayText !== msg.text && (
                        <div style={{ fontSize: '10px', color: '#d97706', fontWeight: '700', marginTop: '3px' }}>
                          👨‍👩‍👧 Link masked by Family Safe Mode
                        </div>
                      )}
                      {smartAction && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateQuickReminder(msg.id, smartAction.title, smartAction.suggestedTimeMs, msg.text);
                          }}
                          className="glass-pill"
                          style={{ marginTop: '4px', padding: '2px 9px', fontSize: '10px', fontWeight: '800', color: reminderSavedIds[msg.id] ? '#16a34a' : '#0284c7', cursor: 'pointer' }}
                        >
                          {reminderSavedIds[msg.id] ? '✅ Smart Reminder Active' : `⏰ ${smartAction.label}`}
                        </button>
                      )}
                    </>
                  );
                })()}

                {/* Inline Instant Translation Result */}
                {translatedMessages[msg.id] && (
                  <div style={{
                    marginTop: '5px',
                    padding: '5px 8px',
                    borderRadius: '8px',
                    backgroundColor: isMe ? 'rgba(255, 255, 255, 0.25)' : 'rgba(2, 132, 199, 0.08)',
                    borderLeft: '3px solid #0284c7',
                    fontSize: '13px',
                    color: 'var(--text-primary)'
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: '800', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                      <Languages size={11} /> Translated ({translatedMessages[msg.id].lang}):
                    </div>
                    {translatedMessages[msg.id].text}
                  </div>
                )}

                {/* Timestamp, Edited/Starred Badges & Status Ticks */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '4px',
                  marginTop: '3px',
                  padding: msg.type === 'image' ? '0 6px 2px 0' : '0'
                }}>
                  {Array.isArray(msg.starredBy) && msg.starredBy.includes(currentUser.id) && (
                    <Star size={10} color="#eab308" fill="#eab308" />
                  )}
                  {msg.isEdited && (
                    <span style={{ fontSize: '9px', fontStyle: 'italic', color: 'var(--text-muted)' }}>edited</span>
                  )}
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {(msg.rawTime || msg.createdAt) ? formatISTTime(msg.rawTime || msg.createdAt) : (msg.timestamp || 'Now')}
                  </span>
                  {isMe && (
                    <span style={{ display: 'flex', alignItems: 'center', marginLeft: '2px' }}>
                      {msg.status === 'queued' ? (
                        <Clock size={12} color="#f59e0b" title="Queued offline — will send once online" />
                      ) : msg.status === 'seen' || msg.status === 'read' ? (
                        <CheckCheck size={15} color="#34B7F1" title="Seen (Blue Double Tick)" />
                      ) : msg.status === 'delivered' ? (
                        <CheckCheck size={15} color="#10b981" title="Delivered (Green Double Tick - Data ON)" />
                      ) : (
                        <Check size={14} color="#ef4444" title="Sent only (Red Single Tick - recipient offline/data off)" />
                      )}
                    </span>
                  )}
                </div>

                {/* Emoji Reactions Pill */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div 
                    style={{
                      position: 'absolute',
                      bottom: '-9px',
                      right: isMe ? '8px' : 'auto',
                      left: isMe ? 'auto' : '8px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      backgroundColor: 'rgba(255, 255, 255, 0.96)',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.12)',
                      border: '1px solid rgba(0, 0, 0, 0.08)',
                      zIndex: 10
                    }}
                  >
                    {Array.from(new Set(Object.values(msg.reactions))).map((emoji, i) => (
                      <span key={i}>{emoji}</span>
                    ))}
                    {Object.keys(msg.reactions).length > 1 && (
                      <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)' }}>
                        {Object.keys(msg.reactions).length}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        });
      })()}

        <div ref={messagesEndRef} />
      </div>

      {/* SMART REPLIES + MOOD CHAT GUARD + REPLY/EDIT BANNER */}
      {!isChannelRestricted && (() => {
        const lastMsg = messages[messages.length - 1];
        const smartReplies = (!editingMsg && !inputText.trim() && lastMsg)
          ? generateSmartReplies(lastMsg, currentUser.id)
          : [];
        const moodAdvice = (moodGuardEnabled && inputText.trim().length >= 5)
          ? analyzeMoodTone(inputText)
          : null;

        if (!smartReplies.length && !moodAdvice && !replyingTo && !editingMsg) return null;
        return (
          <div style={{
            padding: '6px 12px',
            backgroundColor: 'var(--glass-bg-header)',
            borderTop: '1px solid var(--glass-border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            zIndex: 41
          }}>
            {smartReplies.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
                <span style={{ fontSize: '10px', fontWeight: '800', color: '#0284c7', alignSelf: 'center', whiteSpace: 'nowrap' }}>
                  ✨ AI Reply:
                </span>
                {smartReplies.map((sr, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => emitMessage({ text: sr, type: 'text' })}
                    className="glass-pill"
                    style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {sr}
                  </button>
                ))}
              </div>
            )}

            {moodAdvice && moodAdvice.isHarsh && (
              <div style={{
                padding: '6px 10px',
                borderRadius: '12px',
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: '11px'
              }}>
                <span style={{ color: '#d97706', fontWeight: '700' }}>
                  😊 {moodAdvice.reason}
                </span>
                <button
                  type="button"
                  onClick={() => setInputText(moodAdvice.politeSuggestion)}
                  className="glass-btn glass-btn-primary"
                  style={{ height: '24px', padding: '0 10px', borderRadius: '10px', fontSize: '10px', fontWeight: '800', whiteSpace: 'nowrap' }}
                >
                  Polite Version ✨
                </button>
              </div>
            )}

            {(replyingTo || editingMsg) && (
              <div style={{
                padding: '5px 10px',
                borderRadius: '10px',
                backgroundColor: 'rgba(2, 132, 199, 0.1)',
                borderLeft: '3px solid #0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px'
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: '800', color: '#0284c7' }}>
                    {editingMsg ? '✏️ Editing Message' : `↩️ Replying to ${resolveDisplayName({ name: replyingTo.senderName, phone: replyingTo.senderPhone }, savedContactsMap, true)}`}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(editingMsg || replyingTo)?.text}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplyingTo(null);
                    if (editingMsg) {
                      setEditingMsg(null);
                      setInputText('');
                    }
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* BOTTOM INPUT BAR & ATTACHMENT MENU */}
      <div 
        className="glass-panel" 
        style={{
          padding: '8px 12px',
          paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
          borderTop: '1px solid var(--glass-border)',
          backgroundColor: 'var(--glass-bg-header)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          position: 'relative',
          zIndex: 40
        }}
      >
        {isChannelRestricted ? (
          <div style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '16px',
            backgroundColor: 'rgba(2, 132, 199, 0.1)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            fontWeight: '700',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}>
            <Megaphone size={15} color="#0284c7" />
            Only Channel Admins can post in this announcement channel
          </div>
        ) : (
        <>
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

            {/* Emergency Buzz Toggle Button */}
            <button
              type="button"
              onClick={() => setIsUrgentMode(prev => !prev)}
              className="glass-btn" 
              style={{
                width: '32px',
                height: '32px',
                flexShrink: 0,
                padding: 0,
                backgroundColor: isUrgentMode ? 'rgba(239, 68, 68, 0.18)' : undefined,
                borderColor: isUrgentMode ? '#ef4444' : undefined
              }}
              title={isUrgentMode ? "Emergency Priority Alert ON (Recipient will receive loud vibrating alert)" : "Send as Urgent Priority Alert"}
            >
              <Zap size={16} color={isUrgentMode ? '#ef4444' : 'var(--text-secondary)'} fill={isUrgentMode ? '#ef4444' : 'none'} />
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
                placeholder={isUrgentMode ? "🚨 Send urgent priority buzz..." : editingMsg ? "Edit your message..." : "Message..."}
                className="glass-input"
                style={{
                  flex: 1,
                  minWidth: 0,
                  width: '100%',
                  fontSize: '15px',
                  fontWeight: '600',
                  padding: '9px 12px',
                  boxSizing: 'border-box',
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

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '12px', backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.25)', cursor: 'pointer', fontSize: '12px' }}>
                <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>
                  🕵️ Anonymous Voting (Secret Poll)
                </span>
                <input
                  type="checkbox"
                  checked={isAnonPoll}
                  onChange={(e) => setIsAnonPoll(e.target.checked)}
                  style={{ accentColor: '#8b5cf6', width: '16px', height: '16px' }}
                />
              </label>

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

      {/* SMART FEATURE MODALS (Options, AI Summary, Truth Check, Forward, Schedule, UPI, Contracts) */}
      <ChatFeatureModals
        chat={chat}
        chatId={chatId}
        currentUser={currentUser}
        contacts={contacts}
        savedContactsMap={savedContactsMap}
        showOptionsModal={showOptionsModal}
        setShowOptionsModal={setShowOptionsModal}
        chatSettings={chatSettings}
        onUpdateDisappearTimer={handleUpdateDisappearTimer}
        autoTranslateLang={autoTranslateLang}
        onChangeAutoTranslate={(lang) => {
          setAutoTranslateLang(lang);
          localStorage.setItem(`glasschat_autotrans_${chatId}`, lang);
        }}
        chatWallpaper={chatWallpaper}
        onChangeWallpaper={(wp) => {
          setChatWallpaper(wp);
          localStorage.setItem(`glasschat_wallpaper_${chatId}`, wp);
        }}
        moodGuardEnabled={moodGuardEnabled}
        onToggleMoodGuard={() => {
          const next = !moodGuardEnabled;
          setMoodGuardEnabled(next);
          localStorage.setItem('glasschat_mood_guard', next ? 'on' : 'off');
        }}
        showStarredOnly={showStarredOnly}
        onToggleStarredOnly={() => setShowStarredOnly(p => !p)}
        onRunAiSummary={handleRunAiSummary}
        scheduledList={scheduledList}
        onCancelScheduled={handleCancelScheduled}
        onOpenSos={onOpenSos}
        summaryModal={summaryModal}
        setSummaryModal={setSummaryModal}
        truthCheckModal={truthCheckModal}
        setTruthCheckModal={setTruthCheckModal}
        forwardMsg={forwardMsg}
        setForwardMsg={setForwardMsg}
        onConfirmForward={handleConfirmForward}
        showScheduleModal={showScheduleModal}
        setShowScheduleModal={setShowScheduleModal}
        onConfirmSchedule={handleConfirmSchedule}
        showUpiModal={showUpiModal}
        setShowUpiModal={setShowUpiModal}
        onConfirmUpi={handleConfirmUpi}
        showContractModal={showContractModal}
        setShowContractModal={setShowContractModal}
        onConfirmContract={handleConfirmContract}
      />

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
