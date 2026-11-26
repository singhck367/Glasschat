import React, { useState, useEffect, useRef } from 'react';
import { socket } from './services/socket';
import { notifyIncomingMessage } from './services/notifications';
import NavigationHeader from './components/NavigationHeader';
import BottomTabBar from './components/BottomTabBar';
import ChatListItem from './components/ChatListItem';
import ChatRoom from './components/ChatRoom';
import CallsList from './components/CallsList';
import ActiveCallModal from './components/ActiveCallModal';
import GroupCallModal from './components/GroupCallModal';
import IncomingCallModal from './components/IncomingCallModal';
import CreateGroupModal from './components/CreateGroupModal';
import NewChatModal from './components/NewChatModal';
import AdminPortal from './components/AdminPortal';
import SettingsScreen from './components/SettingsScreen';
import StatusScreen from './components/StatusScreen';
import AuthScreen from './components/AuthScreen';
import AppUpdateModal from './components/AppUpdateModal';
import { Smartphone, Monitor } from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';
import { formatISTTime } from './utils/time';

export const APP_VERSION = '1.2.0';
export const APP_VERSION_CODE = 120;

// Compares semver 'x.y.z' to ensure popup ONLY triggers when remote > local
function isVersionGreater(remoteVer, currentVer) {
  if (!remoteVer || !currentVer) return false;
  const rParts = String(remoteVer).split('.').map(n => parseInt(n, 10) || 0);
  const cParts = String(currentVer).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(rParts.length, cParts.length); i++) {
    const r = rParts[i] || 0;
    const c = cParts[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [calls, setCalls] = useState([]);
  const [chatSummaries, setChatSummaries] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const [incomingAlert, setIncomingAlert] = useState(null);
  
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'status' | 'calls' | 'settings'
  const [chatFilter, setChatFilter] = useState('all'); // 'all' | 'unread' | 'groups'
  const [selectedChat, setSelectedChat] = useState(null);
  const selectedChatRef = useRef(selectedChat);
  const [searchQuery, setSearchQuery] = useState('');

  // Call States
  const [active1on1Call, setActive1on1Call] = useState(null);
  const [activeGroupCall, setActiveGroupCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  
  // Modals & In-App Updates
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(window.location.hash === '#admin');
  const [updateInfo, setUpdateInfo] = useState(null);

  // Navigation & Back-Button Safety Refs
  const activeTabRef = useRef(activeTab);
  const isNewChatOpenRef = useRef(isNewChatOpen);
  const isCreateGroupOpenRef = useRef(isCreateGroupOpen);
  const isAdminOpenRef = useRef(isAdminOpen);
  const updateInfoRef = useRef(updateInfo);
  const active1on1CallRef = useRef(active1on1Call);
  const activeGroupCallRef = useRef(activeGroupCall);
  const lastBackPressTimeRef = useRef(0);
  const [exitToast, setExitToast] = useState(false);

  useEffect(() => {
    selectedChatRef.current = selectedChat;
    if (selectedChat) {
      window.history.pushState({ screen: 'chat' }, '');
    }
  }, [selectedChat]);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { isNewChatOpenRef.current = isNewChatOpen; }, [isNewChatOpen]);
  useEffect(() => { isCreateGroupOpenRef.current = isCreateGroupOpen; }, [isCreateGroupOpen]);
  useEffect(() => { isAdminOpenRef.current = isAdminOpen; }, [isAdminOpen]);
  useEffect(() => { updateInfoRef.current = updateInfo; }, [updateInfo]);
  useEffect(() => { active1on1CallRef.current = active1on1Call; }, [active1on1Call]);
  useEffect(() => { activeGroupCallRef.current = activeGroupCall; }, [activeGroupCall]);

  // Core Mobile Hardware & Gesture Back Button Handler
  const handleBackAction = () => {
    // 1. If active 1-on-1 or group call is ongoing, do NOT close app
    if (active1on1CallRef.current || activeGroupCallRef.current) {
      return true; // Keep call alive
    }

    // 2. If update modal is open, close it
    if (updateInfoRef.current) {
      setUpdateInfo(null);
      return true;
    }

    // 3. If new chat modal is open, close it
    if (isNewChatOpenRef.current) {
      setIsNewChatOpen(false);
      return true;
    }

    // 4. If create group modal is open, close it
    if (isCreateGroupOpenRef.current) {
      setIsCreateGroupOpen(false);
      return true;
    }

    // 5. If admin portal is open, close it
    if (isAdminOpenRef.current) {
      setIsAdminOpen(false);
      window.location.hash = '';
      return true;
    }

    // 6. Check inner modals in SettingsScreen
    if (window.__handleSettingsInnerBack && window.__handleSettingsInnerBack()) {
      return true;
    }

    // 7. Check inner popups in ChatRoom (Image preview, attachments, emojis, etc.)
    if (window.__handleChatInnerBack && window.__handleChatInnerBack()) {
      return true;
    }

    // 8. CRITICAL: If inside a Chat Room, close chat and return to Chat List!
    if (selectedChatRef.current) {
      setSelectedChat(null);
      return true; // Successfully navigated back to chats list
    }

    // 9. If on another tab (Status, Calls, Settings), switch back to 'chats' tab
    if (activeTabRef.current !== 'chats') {
      setActiveTab('chats');
      return true;
    }

    // 10. Already on main chats list: Double-tap back to exit
    const now = Date.now();
    if (now - lastBackPressTimeRef.current < 2000) {
      return false; // Exit app
    } else {
      lastBackPressTimeRef.current = now;
      setExitToast(true);
      setTimeout(() => setExitToast(false), 2000);
      return true; // Handled toast, prevent accidental exit
    }
  };

  // Mobile Android Hardware Back Button + Browser PopState Interceptor
  useEffect(() => {
    window.__handleAndroidBack = handleBackAction;

    // 1. Capacitor Native Back Button Listener (for APK)
    let backListener = null;
    try {
      backListener = CapacitorApp.addListener('backButton', () => {
        const handled = handleBackAction();
        if (!handled) {
          CapacitorApp.exitApp();
        }
      });
    } catch (e) {
      console.warn('Capacitor backButton init notice:', e);
    }

    // 2. HTML5 History PopState Listener (for Mobile Browser & PWA)
    window.history.pushState(null, '');
    const handlePopState = () => {
      const handled = handleBackAction();
      if (handled) {
        window.history.pushState(null, '');
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.__handleAndroidBack = null;
      if (backListener && backListener.remove) {
        backListener.remove();
      }
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Check for app updates against backend /api/app-version
  const checkForAppUpdates = async (manual = false) => {
    try {
      const res = await fetch('/api/app-version');
      const data = await res.json();
      if (data && data.latestVersion) {
        // ONLY considered newer if remote versionCode > local versionCode OR semver remote > local
        const isNewer = (data.versionCode && data.versionCode > APP_VERSION_CODE) || 
                        isVersionGreater(data.latestVersion, APP_VERSION);
        const dismissed = localStorage.getItem('glasschat_update_dismissed') === data.latestVersion;
        if (isNewer && (!dismissed || manual)) {
          setUpdateInfo(data);
        } else if (manual) {
          alert(`✨ GlassChat is up to date (v${APP_VERSION})`);
        }
      }
    } catch (e) {
      console.warn('App update check notice:', e);
      if (manual) alert('Could not reach update server. Check your connection.');
    }
  };
  
  // Responsive mode: auto-detect real mobile phones and Capacitor APK
  const isActualMobile = typeof window !== 'undefined' && (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'file:' ||
    window.innerWidth <= 768
  );
  const [isMobileFrame, setIsMobileFrame] = useState(false);

  // Saved / Synced Contacts state for Custom Names
  const [savedContacts, setSavedContacts] = useState([]);
  const [savedContactsMap, setSavedContactsMap] = useState({});

  const buildSavedContactsMap = (list) => {
    const map = {};
    if (Array.isArray(list)) {
      list.forEach(c => {
        const digits = (c.cleanDigits || c.phone || '').replace(/\D/g, '');
        if (digits) {
          map[digits] = c.name;
          const last10 = digits.slice(-10);
          if (last10) map[last10] = c.name;
        }
      });
    }
    setSavedContactsMap(map);
  };

  const loadUserData = (userId) => {
    // Contacts
    fetch(`/api/users?userId=${userId}`)
      .then(res => res.json())
      .then(data => setContacts(data || []))
      .catch(err => console.error('Failed to load contacts:', err));

    // Saved Contacts from server
    fetch(`/api/contacts/saved?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data?.success && data?.savedContacts) {
          setSavedContacts(data.savedContacts);
          buildSavedContactsMap(data.savedContacts);
        }
      })
      .catch(err => console.error('Failed to load saved contacts:', err));

    // Groups
    fetch('/api/groups')
      .then(res => res.json())
      .then(data => setGroups(data || []))
      .catch(err => console.error('Failed to load groups:', err));

    // Calls
    fetch('/api/calls')
      .then(res => res.json())
      .then(data => setCalls(data || []))
      .catch(err => console.error('Failed to load calls:', err));

    // Chat summaries for real-time last message
    fetch('/api/chats-summary')
      .then(res => res.json())
      .then(data => setChatSummaries(data || {}))
      .catch(err => console.error('Failed to load chat summaries:', err));
  };

  // Check login & listen for #admin hash on mount
  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash === '#admin') {
        setIsAdminOpen(true);
      }
    };
    window.addEventListener('hashchange', handleHash);

    const savedUser = localStorage.getItem('glasschat_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setCurrentUser(parsed);
        socket.emit('register-user', { userId: parsed.id });
        loadUserData(parsed.id);
      } catch (e) {
        localStorage.removeItem('glasschat_user');
      }
    }

    // Check for in-app updates on startup
    checkForAppUpdates(false);

    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Multi-Device Auto-Sync: Refresh contacts periodically and when window is focused
  useEffect(() => {
    if (!currentUser?.id) return;
    const interval = setInterval(() => {
      loadUserData(currentUser.id);
    }, 20000);

    const handleFocus = () => loadUserData(currentUser.id);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentUser?.id]);

  // Socket Calling & Real-Time Contact Directory Listeners
  useEffect(() => {
    // Incoming 1-on-1 Call
    const handleIncomingCall = (data) => {
      console.log('Incoming call received:', data);
      setIncomingCall(data);
      if (data?.from) {
        setContacts(prev => {
          if (!prev.some(c => c.id === data.from)) {
            return [{
              id: data.from,
              name: data.fromName || 'User',
              avatar: data.fromAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
              phone: data.fromPhone || '',
              online: true
            }, ...prev];
          }
          return prev;
        });
      }
    };

    // User online status updates
    const handleUserStatus = ({ userId, online }) => {
      setContacts(prev => prev.map(c => c.id === userId ? { ...c, online } : c));
    };

    // When someone creates a second account or updates their profile
    const handleNewUser = (newUser) => {
      if (newUser.id !== currentUser?.id) {
        setContacts(prev => {
          if (prev.some(u => u.id === newUser.id)) {
            return prev.map(u => u.id === newUser.id ? newUser : u);
          }
          return [newUser, ...prev];
        });
      }
    };

    const handleUserUpdated = (updatedUser) => {
      if (currentUser?.id === updatedUser.id) {
        setCurrentUser(updatedUser);
      }
      setContacts(prev => {
        const exists = prev.some(u => u.id === updatedUser.id);
        if (exists) {
          return prev.map(u => u.id === updatedUser.id ? updatedUser : u);
        }
        return [updatedUser, ...prev];
      });
    };

    const handleNewGroup = (newGroup) => {
      setGroups(prev => {
        if (prev.some(g => g.id === newGroup.id)) return prev;
        return [newGroup, ...prev];
      });
    };

    // Global real-time message handler
    const handleGlobalMessage = (payload) => {
      if (!payload?.chatId || !payload?.message) return;
      const { chatId, message, senderUser } = payload;
      const rawTime = message.rawTime || (message.createdAt ? new Date(message.createdAt).getTime() : Date.now());

      setChatSummaries(prev => ({
        ...prev,
        [chatId]: {
          lastMessage: message.text,
          timestamp: message.timestamp,
          rawTime,
          senderId: message.senderId,
          senderName: message.senderName,
          senderPhone: message.senderPhone,
          senderAvatar: message.senderAvatar,
          status: message.status,
          type: message.type
        }
      }));

      // Incoming message from another user
      if (message.senderId !== currentUser?.id) {
        // 1. Immediately ensure sender is in contacts so their conversation is shown right in the Chats list!
        const newContactInfo = senderUser || {
          id: message.senderId,
          name: message.senderName,
          phone: message.senderPhone,
          avatar: message.senderAvatar,
          online: true
        };

        setContacts(prev => {
          if (!prev.some(c => c.id === message.senderId)) {
            return [newContactInfo, ...prev];
          }
          return prev.map(c => c.id === message.senderId ? { ...c, ...newContactInfo } : c);
        });

        const activeChat = selectedChatRef.current;
        const activeChatKey = activeChat 
          ? (activeChat.isGroup 
              ? (activeChat.id.startsWith('group_') ? activeChat.id : `group_${activeChat.id}`)
              : `chat_${[currentUser?.id, activeChat.id].sort().join('_')}`)
          : null;

        const isViewingThisChat = activeChatKey === chatId || activeChat?.id === message.senderId;

        // Display sender phone prominently
        const senderDisplay = message.senderPhone 
          ? (message.senderName && message.senderName !== message.senderPhone 
              ? `${message.senderPhone} (~${message.senderName})` 
              : message.senderPhone)
          : message.senderName;

        // If user is NOT viewing this chat right now: increment unread & notify!
        if (!isViewingThisChat) {
          setUnreadCounts(prev => ({
            ...prev,
            [chatId]: (prev[chatId] || 0) + 1,
            [message.senderId]: (prev[message.senderId] || 0) + 1
          }));

          // Play message sound chime, vibrate, and show system notification
          notifyIncomingMessage(senderDisplay, message.text);

          setIncomingAlert({
            senderName: senderDisplay,
            senderPhone: message.senderPhone,
            senderId: message.senderId,
            senderUser: newContactInfo,
            text: message.text,
            chatId
          });
          setTimeout(() => setIncomingAlert(null), 4000);
        }
      }
    };

    const handleMessageAlert = (alertData) => {
      if (alertData.senderId !== currentUser?.id) {
        const activeChat = selectedChatRef.current;
        if (!activeChat || activeChat.id !== alertData.senderId) {
          setIncomingAlert({
            senderName: alertData.senderName,
            text: alertData.text,
            chatId: alertData.chatId
          });
          setTimeout(() => setIncomingAlert(null), 4000);
        }
      }
    };

    const handleContactsSynced = (data) => {
      if (data?.savedContacts) {
        setSavedContacts(data.savedContacts);
        buildSavedContactsMap(data.savedContacts);
      }
    };

    const handleCallInvitation = (data) => {
      console.log('Incoming call invitation received:', data);
      setIncomingAlert({
        id: `invite_${Date.now()}`,
        senderName: data.fromName || 'Contact',
        text: `📞 Invited you to join their live ${data.isVideo ? 'video' : 'audio'} call!`,
        action: () => {
          handleStartCall({ id: data.from, name: data.fromName, avatar: data.fromAvatar }, data.isVideo);
        }
      });
    };

    socket.on('incoming-call', handleIncomingCall);
    socket.on('incoming-call-invitation', handleCallInvitation);
    socket.on('user-status-changed', handleUserStatus);
    socket.on('user-registered', handleNewUser);
    socket.on('user-updated', handleUserUpdated);
    socket.on('new-group-created', handleNewGroup);
    socket.on('new-message', handleGlobalMessage);
    socket.on('incoming-message-alert', handleMessageAlert);
    socket.on('contacts-synced', handleContactsSynced);

    return () => {
      socket.off('incoming-call', handleIncomingCall);
      socket.off('incoming-call-invitation', handleCallInvitation);
      socket.off('user-status-changed', handleUserStatus);
      socket.off('user-registered', handleNewUser);
      socket.off('user-updated', handleUserUpdated);
      socket.off('new-group-created', handleNewGroup);
      socket.off('new-message', handleGlobalMessage);
      socket.off('incoming-message-alert', handleMessageAlert);
      socket.off('contacts-synced', handleContactsSynced);
    };
  }, [currentUser?.id]);

  // Handle Save / Edit Contact Name to server
  const handleSaveContact = async (phone, name) => {
    if (!currentUser?.id || !phone || !name) return;
    try {
      const res = await fetch('/api/contacts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, phone, name })
      });
      const data = await res.json();
      if (data.success && data.savedContacts) {
        setSavedContacts(data.savedContacts);
        buildSavedContactsMap(data.savedContacts);
      }
      return data;
    } catch (e) {
      console.error('Failed to save contact:', e);
    }
  };

  // Handle Bulk Sync Contacts from device address book to server
  const handleSyncContacts = async (contactsToSync) => {
    if (!currentUser?.id || !contactsToSync?.length) return;
    try {
      const res = await fetch('/api/contacts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, contacts: contactsToSync })
      });
      const data = await res.json();
      if (data.success && data.savedContacts) {
        setSavedContacts(data.savedContacts);
        buildSavedContactsMap(data.savedContacts);
      }
      return data;
    } catch (e) {
      console.error('Failed to sync contacts:', e);
    }
  };

  // Handle Login
  const handleLoginSuccess = (user) => {
    localStorage.setItem('glasschat_user', JSON.stringify(user));
    setCurrentUser(user);
    socket.emit('register-user', { userId: user.id });
    loadUserData(user.id);
  };

  // Handle Logout
  const handleLogout = () => {
    localStorage.removeItem('glasschat_user');
    setCurrentUser(null);
    setSelectedChat(null);
  };

  // Handle Avatar Update from Settings
  const handleUpdateAvatar = (newAvatar) => {
    if (!currentUser) return;
    fetch('/api/auth/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        avatar: newAvatar
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setCurrentUser(data.user);
          localStorage.setItem('glasschat_user', JSON.stringify(data.user));
        }
      })
      .catch(e => console.error(e));
  };

  // Initiate Call (1-on-1 or Group)
  const handleStartCall = (chat, isVideo = false) => {
    if (chat.isGroup) {
      setActiveGroupCall({
        groupId: chat.id,
        groupName: chat.name,
        groupAvatar: chat.avatar,
        isVideo
      });
    } else {
      // ActiveCallModal handles WebRTC SDP offer and emits 'call-user'
      setActive1on1Call({
        targetId: chat.id,
        targetName: chat.name,
        targetAvatar: chat.avatar,
        isVideo,
        isInitiator: true
      });
    }

    // Log call to backend
    fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerId: chat.id,
        callerName: chat.name,
        callerAvatar: chat.avatar,
        type: isVideo ? 'video' : 'audio',
        isGroup: Boolean(chat.isGroup),
        status: 'outgoing',
        duration: '01:30'
      })
    })
      .then(res => res.json())
      .then(newCall => setCalls(prev => [newCall, ...prev]))
      .catch(e => console.error(e));
  };

  const handleEnd1on1Call = (callSummary) => {
    if (active1on1Call) {
      socket.emit('end-call', { to: active1on1Call.targetId });

      const durationSec = callSummary?.duration || 0;
      const isVideoCall = typeof callSummary?.isVideo === 'boolean' ? callSummary.isVideo : Boolean(active1on1Call.isVideo);
      const formattedDuration = durationSec > 0 
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : null;

      const callText = isVideoCall 
        ? (formattedDuration ? `📹 Video call • ${formattedDuration}` : '📹 Missed video call')
        : (formattedDuration ? `📞 Voice call • ${formattedDuration}` : '📞 Missed voice call');

      const targetId = active1on1Call.targetId;
      const chatId = `chat_${[currentUser?.id, targetId].sort().join('_')}`;

      // Insert Call Event Message directly into 1-on-1 Chat Room (WhatsApp style)
      socket.emit('send-message', {
        chatId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        recipientId: targetId,
        type: 'call_log',
        text: callText,
        mediaUrl: null,
        timestamp: formatISTTime(new Date()),
        encrypted: true
      });

      // Also ensure target is in contacts list so chat box is immediately visible
      setContacts(prev => {
        if (!prev.some(c => c.id === targetId)) {
          return [{
            id: targetId,
            name: active1on1Call.targetName || 'User',
            avatar: active1on1Call.targetAvatar,
            phone: '',
            online: true
          }, ...prev];
        }
        return prev;
      });

      // Save to server calls history
      fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerId: targetId,
          callerName: active1on1Call.targetName,
          callerAvatar: active1on1Call.targetAvatar,
          type: isVideoCall ? 'video' : 'audio',
          isGroup: false,
          status: durationSec > 0 ? 'outgoing' : 'missed',
          duration: formattedDuration || '00:00'
        })
      })
        .then(res => res.json())
        .then(newCall => setCalls(prev => [newCall, ...prev]))
        .catch(e => console.error(e));
    }
    setActive1on1Call(null);
  };

  const handleEndGroupCall = () => {
    setActiveGroupCall(null);
  };

  const handleAcceptIncomingCall = () => {
    if (!incomingCall) return;
    // ActiveCallModal handles WebRTC SDP answer and emits 'answer-call'
    setActive1on1Call({
      targetId: incomingCall.from,
      targetName: incomingCall.fromName,
      targetAvatar: incomingCall.fromAvatar,
      isVideo: incomingCall.isVideo,
      isInitiator: false,
      signal: incomingCall.signal
    });
    setIncomingCall(null);
  };

  const handleDeclineIncomingCall = () => {
    if (!incomingCall) return;
    socket.emit('reject-call', { to: incomingCall.from });

    const targetId = incomingCall.from;
    const chatId = `chat_${[currentUser?.id, targetId].sort().join('_')}`;
    const callText = incomingCall.isVideo ? '📹 Missed video call' : '📞 Missed voice call';

    socket.emit('send-message', {
      chatId,
      senderId: targetId,
      senderName: incomingCall.fromName,
      recipientId: currentUser?.id,
      type: 'call_log',
      text: callText,
      mediaUrl: null,
      timestamp: formatISTTime(new Date()),
      encrypted: true
    });

    setIncomingCall(null);
  };

  const handleCreateGroup = (groupData) => {
    fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...groupData, creatorId: currentUser?.id })
    })
      .then(res => res.json())
      .then(createdGroup => {
        setGroups(prev => [createdGroup, ...prev]);
        setIsCreateGroupOpen(false);
        setSelectedChat(createdGroup);
      })
      .catch(err => console.error('Failed to create group:', err));
  };

  const handleSelectChat = (chat) => {
    const cChatId = chat.isGroup
      ? (chat.id.startsWith('group_') ? chat.id : `group_${chat.id}`)
      : `chat_${[currentUser?.id, chat.id].sort().join('_')}`;

    // Reset unread count for this chat
    setUnreadCounts(prev => ({
      ...prev,
      [cChatId]: 0,
      [chat.id]: 0
    }));
    setIncomingAlert(null);
    setSelectedChat(chat);
  };

  // Search query normalization (moved before allChats to avoid reference error)
  const cleanSearch = searchQuery.trim().toLowerCase();
  const cleanDigits = searchQuery.replace(/\D/g, '');

  // 1. Collect all active 1-on-1 chat participants from chatSummaries and unread counts
  const activeChatUsersMap = new Map();
  Object.entries(chatSummaries).forEach(([cId, summary]) => {
    if (cId.startsWith('chat_') && cId.includes(currentUser?.id) && Boolean(summary?.lastMessage)) {
      const parts = cId.replace('chat_', '').split('_');
      const otherId = parts.find(id => id !== currentUser?.id);
      if (otherId) {
        activeChatUsersMap.set(otherId, { cChatId: cId, summary });
      }
    }
  });

  Object.entries(unreadCounts).forEach(([key, count]) => {
    if (count > 0 && key !== currentUser?.id) {
      if (key.startsWith('chat_') && key.includes(currentUser?.id)) {
        const parts = key.replace('chat_', '').split('_');
        const otherId = parts.find(id => id !== currentUser?.id);
        if (otherId && !activeChatUsersMap.has(otherId)) {
          activeChatUsersMap.set(otherId, { cChatId: key, summary: chatSummaries[key] });
        }
      } else if (!key.startsWith('group_')) {
        const cChatId = `chat_${[currentUser?.id, key].sort().join('_')}`;
        if (!activeChatUsersMap.has(key)) {
          activeChatUsersMap.set(key, { cChatId, summary: chatSummaries[cChatId] });
        }
      }
    }
  });

  // 2. Build full 1-on-1 candidate list: contacts PLUS any other user with an active conversation thread!
  const all1on1Candidates = [...contacts];
  activeChatUsersMap.forEach(({ cChatId, summary }, otherId) => {
    if (!all1on1Candidates.some(c => c.id === otherId)) {
      all1on1Candidates.push({
        id: otherId,
        name: summary?.senderId === otherId ? summary?.senderName : 'User',
        phone: summary?.senderPhone || '',
        avatar: summary?.senderAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        status: 'Available',
        online: true
      });
    }
  });

  // Combined list for Chats tab with real last messages, dynamic recency sorting and unread counts
  const allChats = [
    ...groups.map(g => {
      const gChatId = g.id.startsWith('group_') ? g.id : `group_${g.id}`;
      const summary = chatSummaries[gChatId] || chatSummaries[g.id];
      const unread = unreadCounts[gChatId] || unreadCounts[g.id] || 0;
      return {
        ...g,
        isGroup: true,
        lastMessage: summary?.lastMessage || 'Group room',
        timestamp: summary?.timestamp || 'Today',
        rawTime: summary?.rawTime || 0,
        unreadCount: unread
      };
    }),
    ...all1on1Candidates
      .filter(c => {
        // If searching in top bar, allow finding any matching user
        if (cleanSearch) return true;
        // On home screen: ONLY show users who have an active conversation history or unread messages
        const cChatId = `chat_${[currentUser?.id, c.id].sort().join('_')}`;
        const summary = chatSummaries[cChatId];
        const unread = unreadCounts[cChatId] || unreadCounts[c.id] || 0;
        return activeChatUsersMap.has(c.id) || Boolean(summary?.lastMessage) || unread > 0;
      })
      .map(c => {
        const cChatId = `chat_${[currentUser?.id, c.id].sort().join('_')}`;
        const summary = chatSummaries[cChatId] || activeChatUsersMap.get(c.id)?.summary;
        const unread = unreadCounts[cChatId] || unreadCounts[c.id] || 0;
        return {
          ...c,
          phone: c.phone || summary?.senderPhone || '',
          isGroup: false,
          lastMessage: summary?.lastMessage || 'Tap to chat',
          lastMessageStatus: summary?.status,
          lastMessageSenderId: summary?.senderId,
          timestamp: summary?.timestamp || (c.online ? 'Online' : 'Available'),
          rawTime: summary?.rawTime || 0,
          unreadCount: unread
        };
      })
  ].sort((a, b) => {
    // 1. Sort by newest message time (most recent message at the very top)
    const timeA = a.rawTime || 0;
    const timeB = b.rawTime || 0;
    if (timeA !== timeB) return timeB - timeA;

    // 2. Fallback: online contacts first
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const totalUnread = Object.values(unreadCounts).reduce((acc, count) => acc + (Number(count) || 0), 0);

  const baseChats = chatFilter === 'groups'
    ? allChats.filter(c => c.isGroup)
    : chatFilter === 'unread'
    ? allChats.filter(c => (c.unreadCount || 0) > 0)
    : allChats;

  const filteredChats = baseChats.filter(chat => {
    if (!cleanSearch) return true;
    const nameMatch = chat.name?.toLowerCase().includes(cleanSearch);
    const phoneRawMatch = chat.phone?.toLowerCase().includes(cleanSearch);
    const chatDigits = (chat.phone || '').replace(/\D/g, '');
    const phoneDigitsMatch = cleanDigits.length > 0 && chatDigits.includes(cleanDigits);
    return nameMatch || phoneRawMatch || phoneDigitsMatch;
  });

  // If Master Owner Portal is open, render in full Desktop View!
  if (isAdminOpen) {
    return (
      <AdminPortal 
        onClose={() => {
          setIsAdminOpen(false);
          window.location.hash = '';
        }} 
      />
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: (!isActualMobile && isMobileFrame) ? 'center' : 'stretch',
      justifyContent: (!isActualMobile && isMobileFrame) ? 'center' : 'flex-start',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Real-time Message Notification Banner - only shown when outside chat room */}
      {incomingAlert && !selectedChat && (
        <div 
          onClick={() => {
            let target = contacts.find(c => c.id === incomingAlert.senderId || (incomingAlert.senderPhone && c.phone === incomingAlert.senderPhone) || incomingAlert.chatId?.includes(c.id));
            if (!target && incomingAlert.senderUser) {
              target = incomingAlert.senderUser;
            } else if (!target && incomingAlert.senderId) {
              target = {
                id: incomingAlert.senderId,
                name: incomingAlert.senderName,
                phone: incomingAlert.senderPhone || '',
                avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
                online: true
              };
            }
            if (target) setSelectedChat(target);
            setIncomingAlert(null);
          }}
          className="glass-pill glow-active"
          style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 150,
            padding: '10px 18px',
            backgroundColor: 'rgba(255, 255, 255, 0.96)',
            border: '1.5px solid #0284c7',
            boxShadow: 'var(--glass-shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            maxWidth: '92%'
          }}
        >
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#0284c7', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              {incomingAlert.senderName}
            </p>
            <p style={{ fontSize: '12px', color: '#475569', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {incomingAlert.text}
            </p>
          </div>
        </div>
      )}

      {/* Background Soft Glow Orbs */}
      <div style={{
        position: 'absolute',
        width: '380px',
        height: '380px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(56, 189, 248, 0.45) 0%, rgba(56, 189, 248, 0) 70%)',
        top: '-60px',
        left: '-60px',
        pointerEvents: 'none',
        filter: 'blur(35px)'
      }} />
      <div style={{
        position: 'absolute',
        width: '420px',
        height: '420px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(192, 132, 252, 0.4) 0%, rgba(192, 132, 252, 0) 70%)',
        bottom: '-80px',
        right: '-80px',
        pointerEvents: 'none',
        filter: 'blur(45px)'
      }} />

      {/* Frame Toggle Button (Desktop Preview Helper - hidden on actual mobile phones) */}
      {!isActualMobile && (
        <button
          onClick={() => setIsMobileFrame(!isMobileFrame)}
          className="glass-pill mobile-hide-on-phone"
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 90,
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
            border: '1px solid rgba(255, 255, 255, 0.85)',
            boxShadow: 'var(--glass-shadow)'
          }}
          title="Toggle between Mobile Bezel & Full View"
        >
          {isMobileFrame ? <Monitor size={15} color="#0284c7" /> : <Smartphone size={15} color="#0284c7" />}
          <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)' }}>
            {isMobileFrame ? 'Expand Full' : 'Mobile View (iOS/Android)'}
          </span>
        </button>
      )}

      {/* App Container */}
      <main 
        className={`glass-panel ${isActualMobile ? 'app-container-phone' : ''}`}
        style={{
          width: '100%',
          maxWidth: (!isActualMobile && isMobileFrame) ? '430px' : '100%',
          height: '100%',
          maxHeight: (!isActualMobile && isMobileFrame) ? '880px' : '100%',
          borderRadius: (!isActualMobile && isMobileFrame) ? '40px' : '0px',
          display: 'flex',
          flexDirection: 'column',
          position: isActualMobile ? 'absolute' : 'relative',
          top: isActualMobile ? 0 : 'auto',
          left: isActualMobile ? 0 : 'auto',
          right: isActualMobile ? 0 : 'auto',
          bottom: isActualMobile ? 0 : 'auto',
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
          boxShadow: (!isActualMobile && isMobileFrame) ? 'var(--glass-shadow-lg)' : 'none',
          border: (!isActualMobile && isMobileFrame) ? '3px solid rgba(255, 255, 255, 0.75)' : 'none'
        }}
      >
        {/* Fake notch only on desktop bezel simulator */}
        {!isActualMobile && isMobileFrame && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            zIndex: 40
          }}>
            <div style={{
              width: '110px',
              height: '24px',
              backgroundColor: 'rgba(30, 41, 59, 0.65)',
              borderRadius: '16px',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0284c7' }} />
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'rgba(255, 255, 255, 0.6)' }} />
            </div>
          </div>
        )}

        {/* Auth / Login Screen (If user not logged in) */}
        {!currentUser ? (
          <AuthScreen onLoginSuccess={handleLoginSuccess} />
        ) : selectedChat ? (
          /* Active Chat Room View */
          <ChatRoom
            chat={selectedChat}
            onBack={() => setSelectedChat(null)}
            onStartCall={handleStartCall}
            currentUser={currentUser}
            contacts={contacts}
            socket={socket}
            savedContactsMap={savedContactsMap}
            onSaveContact={handleSaveContact}
          />
        ) : (
          /* Main Navigation View */
          <>
            <NavigationHeader 
              currentUser={currentUser}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onOpenCreateGroup={() => setIsCreateGroupOpen(true)}
              onOpenNewChat={() => setIsNewChatOpen(true)}
              onOpenAdmin={() => setIsAdminOpen(true)}
              onOpenSettings={() => setActiveTab('settings')}
              activeTab={activeTab}
            />

            {/* Tab Contents */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              {activeTab === 'chats' && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden'
                }}>
                  {/* WhatsApp Filter Pills: All, Unread, Groups */}
                  <div style={{
                    padding: '8px 16px 4px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexShrink: 0
                  }}>
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'unread', label: totalUnread > 0 ? `Unread (${totalUnread})` : 'Unread' },
                      { id: 'groups', label: `Groups (${groups.length})` }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setChatFilter(f.id)}
                        className="glass-pill"
                        style={{
                          padding: '5px 14px',
                          fontSize: '12px',
                          fontWeight: chatFilter === f.id ? '800' : '600',
                          backgroundColor: chatFilter === f.id ? 'rgba(2, 132, 199, 0.2)' : 'rgba(255, 255, 255, 0.45)',
                          borderColor: chatFilter === f.id ? '#0284c7' : 'rgba(255, 255, 255, 0.65)',
                          color: chatFilter === f.id ? '#0284c7' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div style={{
                    padding: '10px 16px',
                    paddingBottom: '90px',
                    overflowY: 'auto',
                    flex: 1
                  }}>
                    {filteredChats.map((chat) => (
                      <ChatListItem
                        key={chat.id}
                        chat={chat}
                        onSelectChat={handleSelectChat}
                        onStartCall={handleStartCall}
                        currentUser={currentUser}
                        savedContactsMap={savedContactsMap}
                      />
                    ))}
                    {filteredChats.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
                        <p style={{ fontSize: '14px', fontWeight: '500' }}>No conversations found</p>
                        <button 
                          onClick={() => setIsNewChatOpen(true)}
                          className="glass-pill"
                          style={{
                            padding: '8px 18px',
                            color: '#0284c7',
                            fontWeight: '700',
                            fontSize: '12px',
                            cursor: 'pointer',
                            marginTop: '8px'
                          }}
                        >
                          Find Registered Users & Chat
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'status' && (
                <StatusScreen 
                  currentUser={currentUser}
                  socket={socket}
                />
              )}

              {activeTab === 'calls' && (
                <CallsList 
                  calls={calls}
                  contacts={contacts}
                  onStartCall={handleStartCall}
                  searchQuery={searchQuery}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsScreen 
                  currentUser={currentUser} 
                  contacts={contacts}
                  onLogout={handleLogout}
                  onOpenAdmin={() => setIsAdminOpen(true)}
                  onUpdateAvatar={handleUpdateAvatar}
                  onUpdateUser={setCurrentUser}
                  onCheckForUpdates={() => checkForAppUpdates(true)}
                  appVersion={APP_VERSION}
                />
              )}
            </div>

            {/* Bottom Glass Navigation Bar */}
            <BottomTabBar 
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              unreadCount={totalUnread}
              missedCallsCount={0}
            />
          </>
        )}

        {/* 1-on-1 Audio/Video Call Screen */}
        {active1on1Call && (
          <ActiveCallModal 
            callSession={active1on1Call}
            onEndCall={handleEnd1on1Call}
            currentUser={currentUser}
            socket={socket}
            contacts={contacts}
            savedContacts={savedContacts}
            savedContactsMap={savedContactsMap}
          />
        )}

        {/* Group Audio/Video Call Screen */}
        {activeGroupCall && (
          <GroupCallModal
            groupSession={activeGroupCall}
            onEndCall={handleEndGroupCall}
            currentUser={currentUser}
            socket={socket}
          />
        )}

        {/* Incoming Call Alert Modal */}
        {incomingCall && (
          <IncomingCallModal
            incomingCall={incomingCall}
            onAccept={handleAcceptIncomingCall}
            onDecline={handleDeclineIncomingCall}
          />
        )}

        {/* Create Group Modal */}
        {isCreateGroupOpen && (
          <CreateGroupModal
            contacts={contacts}
            onClose={() => setIsCreateGroupOpen(false)}
            onCreateGroup={handleCreateGroup}
          />
        )}

        {/* New Chat / All Contacts Directory Modal */}
        {isNewChatOpen && (
          <NewChatModal
            contacts={contacts}
            currentUserId={currentUser?.id}
            chatSummaries={chatSummaries}
            onClose={() => setIsNewChatOpen(false)}
            onSelectContact={(contact) => {
              setIncomingAlert(null);
              setSelectedChat(contact);
              setIsNewChatOpen(false);
            }}
            onStartCall={handleStartCall}
            savedContacts={savedContacts}
            savedContactsMap={savedContactsMap}
            onSaveContact={handleSaveContact}
            onSyncContacts={handleSyncContacts}
          />
        )}

        {/* In-App Auto Update Checker Modal */}
        {updateInfo && (
          <AppUpdateModal
            updateInfo={updateInfo}
            currentVersion={APP_VERSION}
            onClose={() => {
              localStorage.setItem('glasschat_update_dismissed', updateInfo.latestVersion);
              setUpdateInfo(null);
            }}
          />
        )}

        {/* Double-Tap Back To Exit Glass Toast Alert */}
        {exitToast && (
          <div style={{
            position: 'fixed',
            bottom: '76px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            padding: '9px 22px',
            borderRadius: '26px',
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: '700',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            backdropFilter: 'blur(16px)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'glassModalEnter 0.2s ease'
          }}>
            <span>Press back again to exit GlassChat</span>
          </div>
        )}
      </main>
    </div>
  );
}
