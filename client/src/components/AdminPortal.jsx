import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, Lock, Users, MessageSquare, PhoneCall, 
  Trash2, Eye, Radio, Volume2, Activity, RefreshCw, X, ArrowLeft, CheckCircle2,
  Server, HardDrive, Wifi, Clock, Search, Ban, Megaphone, AlertCircle, KeyRound, Copy,
  ChevronRight, ArrowRight, Video, Download
} from 'lucide-react';
import { socket } from '../services/socket.js';
import { getServerBaseUrl } from '../services/config.js';
import { ICE_SERVERS } from '../services/webrtc.js';
import AdminUserInspectorModal from './AdminUserInspectorModal.jsx';

export default function AdminPortal({ onClose }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  const [activeTab, setActiveTab] = useState('metrics'); // 'metrics' | 'otplogs' | 'users' | 'chats' | 'calls' | 'statuses' | 'broadcast'
  const [metrics, setMetrics] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [allConversations, setAllConversations] = useState([]);
  const [allCalls, setAllCalls] = useState({ activeLiveCalls: [], callHistory: [] });
  const [allRecordings, setAllRecordings] = useState([]);
  const [allStatuses, setAllStatuses] = useState([]);
  const [otpLogsList, setOtpLogsList] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [monitoringCall, setMonitoringCall] = useState(null);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchChatQuery, setSearchChatQuery] = useState('');
  const [copiedOtpId, setCopiedOtpId] = useState(null);
  const [inspectedUserId, setInspectedUserId] = useState(null);
  const [wiretapStatus, setWiretapStatus] = useState('idle'); // 'idle' | 'connecting' | 'live' | 'ended'
  const [wiretapNote, setWiretapNote] = useState('');
  const [wiretapHasVideo, setWiretapHasVideo] = useState(false);

  const wiretapPcRef = useRef(null);
  const wiretapPeerSocketRef = useRef(null);
  const wiretapStreamRef = useRef(null);
  const wiretapVideoRef = useRef(null);
  const wiretapAudioRef = useRef(null);
  const wiretapIceQueueRef = useRef([]);
  const wiretapRemoteSetRef = useRef(false);

  // Mobile responsiveness & mobile chat view state
  const checkIsMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 840 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  };
  const [isMobile, setIsMobile] = useState(checkIsMobileDevice);
  const [mobileChatView, setMobileChatView] = useState('list'); // 'list' | 'chat'

  useEffect(() => {
    const handleResize = () => setIsMobile(checkIsMobileDevice());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Broadcast Announcement State
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState('');

  // Auto-login if previously authenticated (persists across page refresh!)
  useEffect(() => {
    if (localStorage.getItem('glasschat_admin_authenticated') === 'true') {
      setIsAuthenticated(true);
      loadAdminData();
    }
  }, []);

  const stopLiveWiretap = () => {
    if (wiretapPeerSocketRef.current) {
      socket.emit('admin-wiretap-stop', { toSocketId: wiretapPeerSocketRef.current });
      wiretapPeerSocketRef.current = null;
    }
    if (wiretapPcRef.current) {
      try { wiretapPcRef.current.close(); } catch {}
      wiretapPcRef.current = null;
    }
    wiretapStreamRef.current = null;
    if (wiretapVideoRef.current) wiretapVideoRef.current.srcObject = null;
    if (wiretapAudioRef.current) wiretapAudioRef.current.srcObject = null;
    setWiretapStatus('idle');
    setWiretapNote('');
    setWiretapHasVideo(false);
  };

  const attachWiretapMediaToElements = (stream) => {
    if (!stream) return;
    const vTracks = stream.getVideoTracks();
    const aTracks = stream.getAudioTracks();
    setWiretapHasVideo(vTracks.length > 0);

    if (wiretapVideoRef.current && vTracks.length > 0) {
      wiretapVideoRef.current.srcObject = stream;
      wiretapVideoRef.current.play().catch(() => {});
    }
    if (wiretapAudioRef.current && aTracks.length > 0) {
      wiretapAudioRef.current.srcObject = new MediaStream(aTracks);
      wiretapAudioRef.current.play().catch(() => {});
    }
  };

  const findMatchingRecording = (callObj) => {
    if (!callObj || allRecordings.length === 0) return null;
    const wantVideo = callObj.type === 'video' || Boolean(callObj.isVideo);
    const idMatches = allRecordings.filter(r =>
      (callObj.callerId && (r.callerId === callObj.callerId || r.targetId === callObj.callerId || r.recordedByUserId === callObj.callerId)) ||
      (callObj.targetId && (r.callerId === callObj.targetId || r.targetId === callObj.targetId))
    );
    const nameMatches = idMatches.length > 0 ? idMatches : allRecordings.filter(r =>
      callObj.callerName && (r.callerName === callObj.callerName || r.targetName === callObj.callerName)
    );
    if (nameMatches.length === 0) return null;
    return nameMatches.find(r => Boolean(r.isVideo) === wantVideo) || nameMatches[0];
  };

  const startWiretapForCall = (callObj) => {
    stopLiveWiretap();
    setMonitoringCall(callObj);

    const liveList = allCalls.activeLiveCalls || [];
    const liveMatch = callObj?.isLive
      ? callObj
      : liveList.find(lc =>
          (callObj.roomId && lc.roomId === callObj.roomId) ||
          (callObj.callerId && (lc.callerId === callObj.callerId || lc.targetId === callObj.callerId)) ||
          (callObj.callerName && (lc.callerName === callObj.callerName || lc.targetName === callObj.callerName))
        );

    if (liveMatch) {
      console.log('[Admin Wiretap] Starting live tap:', liveMatch.roomId, liveMatch.callerSocketId);
      setWiretapStatus('connecting');
      setWiretapNote('Connecting live audio/video WebRTC stream...');
      socket.emit('admin-wiretap-start', {
        roomId: liveMatch.roomId,
        targetSocketId: liveMatch.callerSocketId || liveMatch.targetSocketId || liveMatch.participants?.[0]?.socketId,
        userId: liveMatch.callerId || callObj.callerId,
        targetId: liveMatch.targetId || callObj.targetId
      });
    } else {
      setWiretapStatus('ended');
      setWiretapNote('');
    }
  };

  // Real-time socket listeners for OTP logs, recordings, active calls & live WebRTC wiretap
  useEffect(() => {
    const handleOtpGenerated = (newEntry) => {
      setOtpLogsList(prev => [newEntry, ...prev.filter(x => x.id !== newEntry.id)]);
    };

    const handleRecordingSaved = (entry) => {
      if (entry?.id) {
        setAllRecordings(prev => [entry, ...prev.filter(x => x.id !== entry.id)]);
      }
    };

    const handleActiveCallsUpdated = () => {
      fetch('/api/admin/all-calls')
        .then(r => r.json())
        .then(d => setAllCalls(d || { activeLiveCalls: [], callHistory: [] }))
        .catch(() => {});
    };

    const waitWiretapIce = (pc, maxMs = 700) => new Promise((resolve) => {
      if (!pc || pc.iceGatheringState === 'complete') { resolve(); return; }
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        pc.removeEventListener('icegatheringstatechange', onState);
        pc.removeEventListener('icecandidate', onCand);
        clearTimeout(hard);
        if (timer) clearTimeout(timer);
        resolve();
      };
      const onState = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const onCand = (ev) => {
        const c = ev?.candidate?.candidate || '';
        if (c.includes(' srflx ') || c.includes(' relay ') || c.includes(' typ host ')) {
          if (!timer) timer = setTimeout(finish, 150);
        }
      };
      const hard = setTimeout(finish, maxMs);
      pc.addEventListener('icegatheringstatechange', onState);
      pc.addEventListener('icecandidate', onCand);
    });

    const handleWiretapOffer = async ({ fromSocketId, signal, isVideo }) => {
      if (!fromSocketId || !signal) return;
      console.log('[Admin Wiretap] Received offer from:', fromSocketId, 'isVideo:', isVideo);
      try {
        if (wiretapPcRef.current) {
          try { wiretapPcRef.current.close(); } catch {}
        }
        wiretapRemoteSetRef.current = false;
        wiretapIceQueueRef.current = [];
        wiretapPeerSocketRef.current = fromSocketId;
        const pc = new RTCPeerConnection(ICE_SERVERS);
        wiretapPcRef.current = pc;

        const stream = new MediaStream();
        wiretapStreamRef.current = stream;

        pc.ontrack = (ev) => {
          const incomingTracks = ev.streams?.[0]?.getTracks?.() || [ev.track];
          incomingTracks.forEach(t => {
            t.enabled = true;
            if (!stream.getTracks().some(existing => existing.id === t.id)) {
              stream.addTrack(t);
            }
          });
          ev.track.onunmute = () => {
            attachWiretapMediaToElements(wiretapStreamRef.current);
          };
          setWiretapStatus('live');
          setWiretapNote(isVideo ? 'Live audio & video stream active' : 'Live audio stream active');
          attachWiretapMediaToElements(stream);
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            socket.emit('admin-wiretap-ice', {
              toSocketId: fromSocketId,
              candidate: ev.candidate,
              fromRole: 'admin'
            });
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log('[Admin Wiretap] ICE state:', pc.iceConnectionState);
        };

        pc.onconnectionstatechange = () => {
          console.log('[Admin Wiretap] Connection state:', pc.connectionState);
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            setWiretapStatus('ended');
            setWiretapNote('Live call ended. Checking saved recordings...');
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        wiretapRemoteSetRef.current = true;
        while (wiretapIceQueueRef.current.length > 0) {
          const cand = wiretapIceQueueRef.current.shift();
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitWiretapIce(pc, 700);
        socket.emit('admin-wiretap-answer', { toSocketId: fromSocketId, signal: pc.localDescription || answer });
      } catch (err) {
        console.warn('[Admin Wiretap] Offer failed:', err);
        setWiretapStatus('ended');
        setWiretapNote('Unable to establish live WebRTC feed.');
      }
    };

    const handleWiretapIce = async ({ candidate, fromRole }) => {
      if (fromRole === 'admin' || !candidate) return;
      if (!wiretapPcRef.current || !wiretapRemoteSetRef.current) {
        wiretapIceQueueRef.current.push(candidate);
        return;
      }
      try {
        await wiretapPcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    };

    const handleWiretapUnavailable = ({ reason }) => {
      setWiretapStatus('ended');
      setWiretapNote(reason || 'Live call session has already ended.');
    };

    socket.on('admin-otp-generated', handleOtpGenerated);
    socket.on('admin-recording-saved', handleRecordingSaved);
    socket.on('admin-active-calls-updated', handleActiveCallsUpdated);
    socket.on('admin-wiretap-offer', handleWiretapOffer);
    socket.on('admin-wiretap-ice', handleWiretapIce);
    socket.on('admin-wiretap-unavailable', handleWiretapUnavailable);

    return () => {
      socket.off('admin-otp-generated', handleOtpGenerated);
      socket.off('admin-recording-saved', handleRecordingSaved);
      socket.off('admin-active-calls-updated', handleActiveCallsUpdated);
      socket.off('admin-wiretap-offer', handleWiretapOffer);
      socket.off('admin-wiretap-ice', handleWiretapIce);
      socket.off('admin-wiretap-unavailable', handleWiretapUnavailable);
      stopLiveWiretap();
    };
  }, []);

  useEffect(() => {
    if (monitoringCall && wiretapStatus === 'live' && wiretapStreamRef.current) {
      attachWiretapMediaToElements(wiretapStreamRef.current);
    }
  }, [monitoringCall, wiretapStatus, wiretapHasVideo]);

  // Authenticate with Master PIN (1234)
  const handleLogin = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
        localStorage.setItem('glasschat_admin_authenticated', 'true');
        loadAdminData();
      } else {
        setErrorMsg('Invalid Master PIN. Passcode is 1234');
      }
    } catch (err) {
      setErrorMsg('Failed to connect to backend server');
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem('glasschat_admin_authenticated');
    setIsAuthenticated(false);
  };

  const loadAdminData = () => {
    fetch('/api/admin/metrics')
      .then(r => r.json())
      .then(d => setMetrics(d))
      .catch(e => console.error(e));

    fetch('/api/admin/all-users')
      .then(r => r.json())
      .then(d => setAllUsers(d || []))
      .catch(e => console.error(e));

    fetch('/api/admin/all-conversations')
      .then(r => r.json())
      .then(d => {
        setAllConversations(d || []);
        if (d && d.length > 0 && !selectedChat) {
          setSelectedChat(d[0]);
        }
      })
      .catch(e => console.error(e));

    fetch('/api/admin/all-calls')
      .then(r => r.json())
      .then(d => setAllCalls(d || { activeLiveCalls: [], callHistory: [] }))
      .catch(e => console.error(e));

    fetch('/api/admin/recordings')
      .then(r => r.json())
      .then(d => setAllRecordings(Array.isArray(d) ? d : []))
      .catch(e => console.error(e));

    fetch('/api/status')
      .then(r => r.json())
      .then(d => setAllStatuses(d || []))
      .catch(e => console.error(e));

    fetch('/api/admin/otp-logs')
      .then(r => r.json())
      .then(d => setOtpLogsList(d || []))
      .catch(e => console.error(e));
  };

  const handleClearOtpLogs = () => {
    if (!window.confirm('Are you sure you want to clear all OTP dispatch history?')) return;
    fetch('/api/admin/otp-logs/clear', { method: 'DELETE' })
      .then(r => r.json())
      .then(() => setOtpLogsList([]))
      .catch(e => console.error(e));
  };

  const handleDeleteUser = (userId) => {
    if (!window.confirm(`Are you sure you want to permanently delete user ${userId}?`)) return;
    fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setAllUsers(prev => prev.filter(u => u.id !== userId));
        }
      })
      .catch(e => console.error(e));
  };

  const handleToggleBlockUser = (userId) => {
    fetch(`/api/admin/users/${userId}/toggle-block`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, isBlocked: d.isBlocked } : u));
        }
      })
      .catch(e => console.error(e));
  };

  const handleDeleteAdminMessage = (chatId, messageId) => {
    if (!window.confirm('Delete this message permanently from the chat?')) return;
    fetch(`/api/admin/chats/${chatId}/messages/${messageId}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          if (selectedChat?.chatId === chatId) {
            setSelectedChat(prev => ({
              ...prev,
              messages: prev.messages.filter(m => m.id !== messageId),
              messageCount: Math.max(0, (prev.messageCount || 1) - 1)
            }));
          }
          loadAdminData();
        }
      })
      .catch(e => console.error(e));
  };

  const handleClearEntireChat = (chatId) => {
    if (!window.confirm('Permanently wipe all messages in this conversation thread?')) return;
    fetch(`/api/admin/chats/${chatId}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          if (selectedChat?.chatId === chatId) {
            setSelectedChat(prev => ({ ...prev, messages: [], messageCount: 0 }));
          }
          loadAdminData();
        }
      })
      .catch(e => console.error(e));
  };

  const handleSendBroadcast = (e) => {
    e?.preventDefault();
    if (!broadcastMessage.trim()) return;
    setBroadcastStatus('Sending announcement...');
    fetch('/api/messages/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: broadcastTitle ? `📢 [ANNOUNCEMENT: ${broadcastTitle}]\n${broadcastMessage}` : `📢 [ANNOUNCEMENT]\n${broadcastMessage}`
      })
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setBroadcastStatus('✅ Announcement broadcasted to all users successfully!');
          setBroadcastTitle('');
          setBroadcastMessage('');
          setTimeout(() => setBroadcastStatus(''), 4000);
          loadAdminData();
        } else {
          setBroadcastStatus('Failed to broadcast');
        }
      })
      .catch(e => setBroadcastStatus('Error: ' + e));
  };

  const filteredUsers = allUsers.filter(u => 
    u.name?.toLowerCase().includes(searchUserQuery.toLowerCase()) ||
    u.phone?.includes(searchUserQuery)
  );

  const navItems = [
    { id: 'metrics', label: 'Overview', icon: Activity },
    { id: 'otplogs', label: 'OTP Logs', icon: KeyRound, count: otpLogsList.length },
    { id: 'users', label: 'Users', icon: Users, count: allUsers.length },
    { id: 'chats', label: 'Chat History', icon: MessageSquare, count: allConversations.length },
    { id: 'calls', label: 'Calls', icon: PhoneCall, count: allCalls.callHistory?.length || 0 },
    { id: 'statuses', label: 'Stories', icon: Eye, count: allStatuses.length },
    { id: 'broadcast', label: 'Broadcast', icon: Megaphone }
  ];

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#f8fafc',
      color: '#0f172a',
      overflow: 'hidden',
      fontFamily: 'var(--font-family)',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      paddingTop: 'max(36px, env(safe-area-inset-top, 36px))',
      paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))'
    }}>
      {/* Passcode Gate if not authenticated */}
      {!isAuthenticated ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at 50% 50%, rgba(224, 242, 254, 0.8) 0%, rgba(241, 245, 249, 0.95) 100%)',
          padding: '20px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '390px',
            borderRadius: '28px',
            padding: '32px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '18px',
            boxShadow: 'var(--glass-shadow-lg)',
            border: '2px solid rgba(255, 255, 255, 0.85)',
            position: 'relative'
          }}>
            <button 
              onClick={onClose}
              className="glass-btn" 
              style={{ position: 'absolute', top: '16px', right: '16px', width: '34px', height: '34px' }}
              title="Close and Return to Messenger"
            >
              <X size={16} />
            </button>

            <div className="glow-active" style={{
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              backgroundColor: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(220, 38, 38, 0.35)'
            }}>
              <ShieldAlert size={32} />
            </div>

            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>
                Owner Master Center
              </h2>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                Full Surveillance & Data Interception Suite
              </p>
            </div>

            {errorMsg && (
              <span className="glass-pill" style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#dc2626',
                fontSize: '12px',
                fontWeight: '600',
                padding: '4px 14px'
              }}>
                {errorMsg}
              </span>
            )}

            <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input 
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter Passcode (1234)"
                className="glass-input"
                autoFocus
                style={{ textAlign: 'center', fontSize: '18px', letterSpacing: '4px', fontWeight: '800', padding: '12px' }}
              />

              <button 
                type="submit"
                className="glass-btn glass-btn-primary"
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '700'
                }}
              >
                Access Owner Dashboard
              </button>
            </form>

            <span style={{ fontSize: '12px', color: '#0284c7', fontWeight: '600' }}>
              Master Passcode: <strong>1234</strong>
            </span>
          </div>
        </div>
      ) : (
        /* Authenticated View: Responsive Mobile & Desktop Layout */
        <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', width: '100%', height: '100%', overflow: 'hidden' }}>
          
          {/* ========================================================= */}
          {/* 1. MOBILE TOP APP BAR & HORIZONTAL TABS (When on Mobile)  */}
          {/* ========================================================= */}
          {isMobile ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'rgba(255, 255, 255, 0.94)',
              borderBottom: '1px solid rgba(226, 232, 240, 0.9)',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
            }}>
              {/* Mobile Header Row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '10px',
                    backgroundColor: '#dc2626',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)'
                  }}>
                    <ShieldAlert size={18} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                        Owner Center
                      </h3>
                      <span style={{
                        padding: '1px 5px',
                        fontSize: '9px',
                        fontWeight: '800',
                        color: '#dc2626',
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        borderRadius: '6px'
                      }}>
                        MASTER
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      ● Server Engine Online
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button 
                    onClick={loadAdminData}
                    className="glass-btn" 
                    style={{ width: '32px', height: '32px' }}
                    title="Reload Data"
                  >
                    <RefreshCw size={14} color="#0284c7" />
                  </button>
                  <button 
                    onClick={handleAdminLogout}
                    className="glass-btn" 
                    style={{ width: '32px', height: '32px', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                    title="Lock / Logout"
                  >
                    <Lock size={14} color="#ef4444" />
                  </button>
                  <button 
                    onClick={onClose}
                    className="glass-btn glass-btn-primary" 
                    style={{ height: '32px', padding: '0 10px', fontSize: '11px', fontWeight: '700', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title="Exit to Messenger"
                  >
                    <ArrowLeft size={13} /> Exit
                  </button>
                </div>
              </div>

              {/* Mobile Horizontal Scrollable Tabs */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                overflowX: 'auto',
                padding: '6px 12px 10px 12px',
                scrollbarWidth: 'none',
                WebkitOverflowScrolling: 'touch'
              }}>
                {navItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        if (item.id === 'chats') setMobileChatView('list');
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '16px',
                        border: isActive ? '1px solid #0284c7' : '1px solid rgba(226, 232, 240, 0.9)',
                        backgroundColor: isActive ? '#0284c7' : 'rgba(255, 255, 255, 0.85)',
                        color: isActive ? '#ffffff' : '#475569',
                        fontWeight: isActive ? '700' : '600',
                        fontSize: '12px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        boxShadow: isActive ? '0 2px 8px rgba(2, 132, 199, 0.3)' : 'none',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                      {item.count !== undefined && (
                        <span style={{
                          backgroundColor: isActive ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0',
                          color: isActive ? '#ffffff' : '#475569',
                          fontSize: '10px',
                          fontWeight: '800',
                          borderRadius: '10px',
                          padding: '1px 6px'
                        }}>
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ========================================================= */
            /* 2. DESKTOP SIDEBAR (When on Widescreen Desktop / Tablet)   */
            /* ========================================================= */
            <aside className="glass-panel" style={{
              width: '260px',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              borderRight: '1px solid rgba(255, 255, 255, 0.75)',
              backgroundColor: 'rgba(255, 255, 255, 0.65)',
              padding: '20px 16px',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Brand */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    backgroundColor: '#dc2626',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)'
                  }}>
                    <ShieldAlert size={22} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                      Owner Center
                    </h3>
                    <span className="glass-pill" style={{
                      padding: '1px 6px',
                      fontSize: '10px',
                      fontWeight: '700',
                      color: '#dc2626',
                      backgroundColor: 'rgba(239, 68, 68, 0.12)'
                    }}>
                      FULL DESKTOP
                    </span>
                  </div>
                </div>

                {/* Navigation Menu */}
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {navItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '11px 14px',
                          borderRadius: '14px',
                          border: isActive ? '1px solid #0284c7' : '1px solid transparent',
                          backgroundColor: isActive ? 'rgba(2, 132, 199, 0.12)' : 'transparent',
                          color: isActive ? '#0284c7' : '#475569',
                          fontWeight: isActive ? '700' : '600',
                          fontSize: '13px',
                          cursor: 'pointer',
                          transition: 'all 0.18s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <Icon size={18} />
                          <span>{item.label}</span>
                        </div>
                        {item.count !== undefined && (
                          <span style={{
                            backgroundColor: isActive ? '#0284c7' : '#e2e8f0',
                            color: isActive ? '#ffffff' : '#475569',
                            fontSize: '11px',
                            fontWeight: '700',
                            borderRadius: '12px',
                            padding: '1px 8px'
                          }}>
                            {item.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Bottom Sidebar Info & Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="glass-card" style={{ padding: '10px', fontSize: '11px', color: '#64748b' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontWeight: '700', marginBottom: '3px' }}>
                    <Wifi size={12} /> Server Engine Online
                  </div>
                  Port: 5000 • Persistence: database.json
                </div>

                <button
                  onClick={handleAdminLogout}
                  className="glass-card"
                  style={{
                    padding: '9px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    fontSize: '12px',
                    color: '#dc2626',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    borderColor: 'rgba(239, 68, 68, 0.25)'
                  }}
                >
                  <Lock size={14} /> Logout Admin Session
                </button>

                <button
                  onClick={onClose}
                  className="glass-card"
                  style={{
                    padding: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontWeight: '700',
                    fontSize: '13px',
                    color: '#0f172a'
                  }}
                >
                  <ArrowLeft size={16} /> Exit to Messenger
                </button>
              </div>
            </aside>
          )}

          {/* ========================================================= */}
          {/* 3. MAIN CONTENT AREA (Takes 100% width on Mobile/Desktop) */}
          {/* ========================================================= */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            width: '100%',
            height: '100%'
          }}>
            {/* Desktop Top Header Bar (Only shown on Desktop) */}
            {!isMobile && (
              <header className="glass-panel" style={{
                padding: '14px 28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255, 255, 255, 0.75)',
                backgroundColor: 'rgba(255, 255, 255, 0.55)',
                flexShrink: 0
              }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                    {activeTab === 'metrics' && 'System Analytics & Health'}
                    {activeTab === 'otplogs' && 'Live OTP & Verification Code Dispatch Records'}
                    {activeTab === 'users' && 'Master User Directory & Records'}
                    {activeTab === 'chats' && 'Live Chat Surveillance & Logs'}
                    {activeTab === 'calls' && 'Audio/Video Wiretap & Call Surveillance'}
                    {activeTab === 'statuses' && 'Status Stories & Ephemeral Media Spy'}
                    {activeTab === 'broadcast' && 'Global Broadcast & Owner Announcements'}
                  </h2>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
                    Full unmasked data inspection for GlassChat platform
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="glass-pill" style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '700', color: '#0284c7' }}>
                    ● Live Socket Feeds Active
                  </span>
                  <button 
                    onClick={loadAdminData}
                    className="glass-btn" 
                    style={{ width: '38px', height: '38px' }}
                    title="Reload Latest Data"
                  >
                    <RefreshCw size={16} color="#0284c7" />
                  </button>
                </div>
              </header>
            )}

            {/* Tab Contents Scroll View */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: isMobile ? '12px' : '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              
              {/* ==================================================== */}
              {/* TAB 1: OVERVIEW METRICS                              */}
              {/* ==================================================== */}
              {activeTab === 'metrics' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '14px' : '20px' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: isMobile ? '10px' : '16px'
                  }}>
                    <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px' }}>
                      <span style={{ fontSize: isMobile ? '10px' : '12px', fontWeight: '700', color: '#64748b' }}>TOTAL USERS</span>
                      <h3 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '800', color: '#0284c7', margin: '4px 0' }}>
                        {metrics?.totalUsers || allUsers.length}
                      </h3>
                      <p style={{ fontSize: isMobile ? '10px' : '12px', color: '#16a34a', margin: 0, fontWeight: '600' }}>
                        ● {metrics?.onlineUsers || 1} Online
                      </p>
                    </div>

                    <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px' }}>
                      <span style={{ fontSize: isMobile ? '10px' : '12px', fontWeight: '700', color: '#64748b' }}>TOTAL MESSAGES</span>
                      <h3 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '800', color: '#0f172a', margin: '4px 0' }}>
                        {metrics?.totalMessages || 0}
                      </h3>
                      <p style={{ fontSize: isMobile ? '10px' : '12px', color: '#64748b', margin: 0 }}>
                        All conversations
                      </p>
                    </div>

                    <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px' }}>
                      <span style={{ fontSize: isMobile ? '10px' : '12px', fontWeight: '700', color: '#64748b' }}>CALL LOGS</span>
                      <h3 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '800', color: '#0f172a', margin: '4px 0' }}>
                        {metrics?.totalCalls || allCalls.callHistory?.length || 0}
                      </h3>
                      <p style={{ fontSize: isMobile ? '10px' : '12px', color: '#64748b', margin: 0 }}>
                        Audio & Video calls
                      </p>
                    </div>

                    <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px' }}>
                      <span style={{ fontSize: isMobile ? '10px' : '12px', fontWeight: '700', color: '#64748b' }}>ACTIVE WEBRTC</span>
                      <h3 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '800', color: '#16a34a', margin: '4px 0' }}>
                        {metrics?.activeLiveRooms || 0}
                      </h3>
                      <p style={{ fontSize: isMobile ? '10px' : '12px', color: '#16a34a', margin: 0, fontWeight: '600' }}>
                        Live peer rooms
                      </p>
                    </div>
                  </div>

                  {/* Registered Users Table / Cards */}
                  <div className="glass-card" style={{ padding: isMobile ? '14px' : '22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: '800', margin: 0 }}>
                        Platform Registered Users ({allUsers.length})
                      </h3>
                      <span className="glass-pill" style={{ padding: '2px 8px', fontSize: '11px', color: '#0284c7' }}>
                        Live
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      <table style={{ width: '100%', minWidth: '480px', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#64748b' }}>
                            <th style={{ padding: '8px 10px' }}>User</th>
                            <th style={{ padding: '8px 10px' }}>Phone</th>
                            <th style={{ padding: '8px 10px' }}>State</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allUsers.map(u => (
                            <tr
                              key={u.id}
                              onClick={() => setInspectedUserId(u.id)}
                              style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}
                              title="Click to inspect Profile, Sessions & Chats"
                            >
                              <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <img src={u.avatar} alt={u.name} style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }} />
                                <div>
                                  <strong style={{ display: 'block', fontSize: '13px', color: '#0284c7' }}>{u.name}</strong>
                                  <span style={{ fontSize: '11px', color: '#64748b' }}>{u.status || 'Available'}</span>
                                </div>
                              </td>
                              <td style={{ padding: '10px', color: '#0284c7', fontWeight: '600', fontSize: '12px' }}>{u.phone}</td>
                              <td style={{ padding: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                  <span style={{
                                    padding: '2px 6px',
                                    borderRadius: '8px',
                                    fontSize: '10px',
                                    fontWeight: '700',
                                    backgroundColor: u.online ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                                    color: u.online ? '#16a34a' : '#64748b'
                                  }}>
                                    {u.online ? 'Online' : 'Offline'}
                                  </span>
                                  {u.twoStepEnabled ? (
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: '8px',
                                      fontSize: '10px',
                                      fontWeight: '800',
                                      backgroundColor: 'rgba(2, 132, 199, 0.15)',
                                      color: '#0284c7'
                                    }} title={u.recoveryEmail ? `Email: ${u.recoveryEmail}` : '2FA Active'}>
                                      🛡️ PIN: {u.twoStepPin || 'Active'}
                                    </span>
                                  ) : (
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: '8px',
                                      fontSize: '10px',
                                      fontWeight: '600',
                                      backgroundColor: 'rgba(148, 163, 184, 0.12)',
                                      color: '#94a3b8'
                                    }}>
                                      2FA Off
                                    </span>
                                  )}
                                  {u.isBlocked && (
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: '8px',
                                      fontSize: '9px',
                                      fontWeight: '800',
                                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                      color: '#ef4444'
                                    }}>
                                      BLOCKED
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: '10px', textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleBlockUser(u.id);
                                    }}
                                    className="glass-btn" 
                                    style={{
                                      padding: '3px 8px',
                                      height: '28px',
                                      fontSize: '11px',
                                      fontWeight: '700',
                                      backgroundColor: u.isBlocked ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                                      borderColor: u.isBlocked ? '#22c55e' : '#ef4444',
                                      color: u.isBlocked ? '#16a34a' : '#ef4444',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px'
                                    }}
                                    title={u.isBlocked ? "Unblock user" : "Block user"}
                                  >
                                    <Ban size={11} />
                                    {u.isBlocked ? 'Unblock' : 'Block'}
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteUser(u.id);
                                    }}
                                    className="glass-btn" 
                                    style={{ width: '28px', height: '28px', display: 'inline-flex', backgroundColor: 'rgba(239,68,68,0.1)' }}
                                    title="Delete user"
                                  >
                                    <Trash2 size={12} color="#ef4444" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Danger Zone: Wipe All Dummy Data */}
                  <div className="glass-card" style={{
                    padding: isMobile ? '14px' : '20px',
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    backgroundColor: 'rgba(254, 242, 242, 0.65)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap'
                  }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '800', color: '#991b1b' }}>
                        Wipe All Dummy / Test Data
                      </h4>
                      <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#b91c1c' }}>
                        Delete all test messages, call logs, and dummy items. Real registered accounts will be kept.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm('Are you sure you want to wipe all dummy data? This will reset all messages, call logs and statuses!')) {
                          fetch('/api/admin/clear-all-data', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ keepUsers: true })
                          })
                            .then(r => r.json())
                            .then(() => {
                              alert('Dummy data wiped successfully!');
                              loadAdminData();
                            })
                            .catch(e => alert('Failed to clear data: ' + e));
                        }
                      }}
                      className="glass-btn glass-btn-danger"
                      style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '800', borderRadius: '12px', cursor: 'pointer' }}
                    >
                      <Trash2 size={14} style={{ marginRight: '4px' }} />
                      Wipe Dummy Data
                    </button>
                  </div>
                </div>
              )}

              {/* ==================================================== */}
              {/* TAB: REAL-TIME OTP DISPATCH LOGS                     */}
              {/* ==================================================== */}
              {activeTab === 'otplogs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <h3 style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                        Live OTP Dispatch Records
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                        Real-time 6-digit codes sent to users during login.
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="glass-pill" style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '800', color: '#0284c7' }}>
                        {otpLogsList.length} Total
                      </span>
                      {otpLogsList.length > 0 && (
                        <button
                          onClick={handleClearOtpLogs}
                          className="glass-btn glass-btn-danger"
                          style={{ padding: '5px 12px', fontSize: '11px', fontWeight: '700', borderRadius: '10px' }}
                        >
                          <Trash2 size={12} style={{ marginRight: '4px' }} /> Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {otpLogsList.length === 0 ? (
                    <div className="glass-card" style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
                      <KeyRound size={36} color="#94a3b8" style={{ marginBottom: '8px' }} />
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>
                        No OTP Codes Requested Yet
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px' }}>
                        When users enter their number to log in, their OTP appears here live.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {otpLogsList.map((item) => (
                        <div key={item.id} className="glass-card" style={{
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          flexWrap: isMobile ? 'wrap' : 'nowrap'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '10px',
                              backgroundColor: 'rgba(2, 132, 199, 0.12)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#0284c7'
                            }}>
                              <KeyRound size={18} />
                            </div>
                            <div>
                              <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block' }}>
                                {item.phone}
                              </strong>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {item.createdAt} • <strong style={{ color: item.status === 'Verified' ? '#16a34a' : '#d97706' }}>{item.status}</strong>
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: isMobile ? 'auto' : undefined }}>
                            <span style={{
                              padding: '6px 14px',
                              borderRadius: '10px',
                              fontSize: '17px',
                              fontWeight: '900',
                              letterSpacing: '3px',
                              fontFamily: 'monospace',
                              backgroundColor: 'rgba(2, 132, 199, 0.15)',
                              color: '#0284c7',
                              border: '1.5px solid rgba(2, 132, 199, 0.4)'
                            }}>
                              {item.otp}
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(item.otp);
                                setCopiedOtpId(item.id);
                                setTimeout(() => setCopiedOtpId(null), 2000);
                              }}
                              className="glass-btn"
                              style={{
                                padding: '6px 12px',
                                fontSize: '11px',
                                fontWeight: '700',
                                color: copiedOtpId === item.id ? '#16a34a' : '#0284c7',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              {copiedOtpId === item.id ? (
                                <>
                                  <CheckCircle2 size={13} /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy size={13} /> Copy
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ==================================================== */}
              {/* TAB 2: USERS DIRECTORY                               */}
              {/* ==================================================== */}
              {activeTab === 'users' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: isMobile ? '100%' : '320px' }}>
                      <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                      <input 
                        type="text"
                        value={searchUserQuery}
                        onChange={(e) => setSearchUserQuery(e.target.value)}
                        placeholder="Search users by name or phone..."
                        className="glass-input"
                        style={{ width: '100%', paddingLeft: '36px', fontSize: '13px' }}
                      />
                    </div>
                    <span className="glass-pill" style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '700' }}>
                      {filteredUsers.length} Users
                    </span>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '12px'
                  }}>
                    {filteredUsers.map(u => (
                      <div
                        key={u.id}
                        onClick={() => setInspectedUserId(u.id)}
                        className="glass-card"
                        style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', cursor: 'pointer', border: u.isBlocked ? '1.5px solid rgba(239, 68, 68, 0.4)' : undefined }}
                        title="Click to open Full Profile, Chat History & Live Session"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <img src={u.avatar} alt={u.name} style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' }} />
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: '800', margin: 0, color: '#0284c7' }}>{u.name}</h4>
                                {u.isBlocked && (
                                  <span className="glass-pill" style={{ padding: '1px 5px', fontSize: '9px', fontWeight: '800', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.15)' }}>
                                    BLOCKED
                                  </span>
                                )}
                              </div>
                              <p style={{ fontSize: '12px', color: '#0284c7', fontWeight: '600', margin: '2px 0' }}>{u.phone}</p>
                            </div>
                          </div>
                          <span style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: u.online ? '#22c55e' : '#cbd5e1'
                          }} />
                        </div>
                        <p style={{ fontSize: '12px', color: '#64748b', margin: 0, fontStyle: 'italic' }}>"{u.status || 'Available'}"</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          {u.twoStepEnabled ? (
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '8px',
                              fontSize: '10px',
                              fontWeight: '800',
                              backgroundColor: 'rgba(2, 132, 199, 0.15)',
                              color: '#0284c7',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }} title={u.recoveryEmail ? `Recovery: ${u.recoveryEmail}` : 'PIN active'}>
                              🛡️ 2FA PIN: {u.twoStepPin || 'Active'}
                            </span>
                          ) : (
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '8px',
                              fontSize: '10px',
                              fontWeight: '600',
                              backgroundColor: 'rgba(148, 163, 184, 0.12)',
                              color: '#94a3b8'
                            }}>
                              2FA: Off
                            </span>
                          )}
                          {u.recoveryEmail && (
                            <span style={{ fontSize: '10px', color: '#64748b' }}>
                              ✉️ {u.recoveryEmail}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>Tap to inspect Profile, Chats & Session →</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleBlockUser(u.id);
                              }}
                              className="glass-btn" 
                              style={{
                                padding: '4px 10px',
                                height: '30px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: u.isBlocked ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                                borderColor: u.isBlocked ? '#22c55e' : '#ef4444',
                                color: u.isBlocked ? '#16a34a' : '#ef4444',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              title={u.isBlocked ? "Unblock user" : "Block user"}
                            >
                              <Ban size={12} />
                              {u.isBlocked ? 'Unblock' : 'Block'}
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteUser(u.id);
                              }}
                              className="glass-btn" 
                              style={{ width: '30px', height: '30px', backgroundColor: 'rgba(239,68,68,0.1)' }}
                              title="Delete user"
                            >
                              <Trash2 size={13} color="#ef4444" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ==================================================== */}
              {/* TAB 3: LIVE CHAT SPY (RESPONSIVE SPLIT / DRILL-DOWN) */}
              {/* ==================================================== */}
              {activeTab === 'chats' && (
                <div style={{
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  height: isMobile ? '70vh' : '72vh',
                  gap: '12px'
                }}>
                  {/* Left Chat Threads List (On mobile, only show if mobileChatView === 'list') */}
                  {(!isMobile || mobileChatView === 'list') && (
                    <div className="glass-card" style={{
                      width: isMobile ? '100%' : '320px',
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '12px',
                      overflowY: 'auto',
                      gap: '8px',
                      flexShrink: 0,
                      height: isMobile ? '100%' : undefined
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>
                          Chat History ({allConversations.length})
                        </span>
                        {isMobile && <span style={{ fontSize: '11px', color: '#0284c7' }}>Tap thread</span>}
                      </div>

                      <input
                        type="text"
                        value={searchChatQuery}
                        onChange={(e) => setSearchChatQuery(e.target.value)}
                        placeholder="Search chat history..."
                        className="glass-input"
                        style={{ width: '100%', padding: '7px 12px', fontSize: '12px', marginBottom: '4px' }}
                      />

                      {allConversations
                        .filter(conv => !searchChatQuery.trim() || (conv.title || '').toLowerCase().includes(searchChatQuery.toLowerCase()) || (conv.lastMessage?.text || '').toLowerCase().includes(searchChatQuery.toLowerCase()))
                        .map(conv => (
                        <div 
                          key={conv.chatId}
                          onClick={() => {
                            setSelectedChat(conv);
                            if (isMobile) setMobileChatView('chat');
                          }}
                          className="glass-card"
                          style={{
                            padding: '10px 12px',
                            cursor: 'pointer',
                            border: selectedChat?.chatId === conv.chatId ? '2px solid #0284c7' : '1px solid var(--glass-border-subtle)',
                            backgroundColor: selectedChat?.chatId === conv.chatId ? 'rgba(2, 132, 199, 0.14)' : 'rgba(255, 255, 255, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>{conv.title}</strong>
                            <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {conv.lastMessage?.text || 'No messages'}
                            </p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
                            <span className="glass-pill" style={{ padding: '2px 6px', fontSize: '10px', fontWeight: '700' }}>
                              {conv.messageCount}
                            </span>
                            {isMobile && <ChevronRight size={14} color="#94a3b8" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Right Chat Messages Inspector (On mobile, only show if mobileChatView === 'chat') */}
                  {(!isMobile || mobileChatView === 'chat') && (
                    <div className="glass-card" style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      padding: isMobile ? '12px' : '16px',
                      height: isMobile ? '100%' : undefined
                    }}>
                      {selectedChat ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: '10px', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {isMobile && (
                                <button
                                  onClick={() => setMobileChatView('list')}
                                  className="glass-btn"
                                  style={{ width: '32px', height: '32px' }}
                                  title="Back to conversation list"
                                >
                                  <ArrowLeft size={16} />
                                </button>
                              )}
                              <div>
                                <h3 style={{ fontSize: '15px', fontWeight: '800', margin: 0 }}>
                                  {selectedChat.title}
                                </h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '3px' }}>
                                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                                    {selectedChat.messages?.length || 0} msgs
                                  </span>
                                  {selectedChat.participants?.map(p => (
                                    <button
                                      key={p.id}
                                      onClick={() => setInspectedUserId(p.id)}
                                      className="glass-pill"
                                      style={{ padding: '2px 8px', fontSize: '10px', fontWeight: '700', color: '#0284c7', cursor: 'pointer' }}
                                    >
                                      👤 {p.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <button 
                              onClick={() => handleClearEntireChat(selectedChat.chatId)}
                              className="glass-btn glass-btn-danger"
                              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700', borderRadius: '10px' }}
                              title="Delete all messages"
                            >
                              <Trash2 size={11} style={{ marginRight: '3px' }} /> Clear
                            </button>
                          </div>

                          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                            {selectedChat.messages?.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '30px', color: '#64748b', fontSize: '13px' }}>
                                No messages in this chat thread
                              </div>
                            ) : (
                              selectedChat.messages?.map((msg, i) => (
                                <div key={msg.id || i} className="glass-card" style={{ padding: '8px 12px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                    <button
                                      type="button"
                                      onClick={() => msg.senderId !== 'system' && setInspectedUserId(msg.senderId)}
                                      style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', fontWeight: '700', color: '#0284c7', cursor: msg.senderId !== 'system' ? 'pointer' : 'default' }}
                                    >
                                      {msg.senderName} ({msg.senderId})
                                    </button>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                                        {msg.timestamp}
                                      </span>
                                      <button 
                                        onClick={() => handleDeleteAdminMessage(selectedChat.chatId, msg.id)}
                                        className="glass-btn" 
                                        style={{ width: '22px', height: '22px', padding: 0, backgroundColor: 'rgba(239,68,68,0.1)' }}
                                        title="Delete this message"
                                      >
                                        <Trash2 size={11} color="#ef4444" />
                                      </button>
                                    </div>
                                  </div>
                                  {msg.type === 'image' && msg.mediaUrl && (
                                    <img src={msg.mediaUrl} alt="media" style={{ maxWidth: '180px', borderRadius: '8px', margin: '4px 0', display: 'block' }} />
                                  )}
                                  <p style={{ fontSize: '13px', margin: 0, color: '#0f172a' }}>
                                    {msg.text || `[${msg.type || 'message'}]`}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '13px' }}>
                          Select a conversation thread to spy
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ==================================================== */}
              {/* TAB 4: CALL SURVEILLANCE & AUDIO WIRETAP             */}
              {/* ==================================================== */}
              {activeTab === 'calls' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {monitoringCall && (() => {
                    const matchedRec = wiretapStatus !== 'live' ? findMatchingRecording(monitoringCall) : null;
                    return (
                      <div className="glass-panel" style={{
                        padding: isMobile ? '12px 16px' : '18px 24px',
                        borderRadius: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        border: '2px solid rgba(2, 132, 199, 0.8)',
                        background: 'linear-gradient(135deg, rgba(224, 242, 254, 0.9) 0%, rgba(243, 232, 255, 0.9) 100%)'
                      }}>
                        <div style={{
                          display: 'flex',
                          flexDirection: isMobile ? 'column' : 'row',
                          alignItems: isMobile ? 'flex-start' : 'center',
                          justifyContent: 'space-between',
                          gap: '12px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div className="glow-active" style={{
                              width: '42px',
                              height: '42px',
                              borderRadius: '50%',
                              backgroundColor: wiretapStatus === 'live' ? '#dc2626' : '#0284c7',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#ffffff'
                            }}>
                              <Radio size={20} />
                            </div>
                            <div>
                              <span style={{ fontSize: '14px', fontWeight: '800', color: wiretapStatus === 'live' ? '#dc2626' : '#0284c7' }}>
                                {wiretapStatus === 'live'
                                  ? 'LIVE AUDIO / VIDEO WIRETAP IN PROGRESS'
                                  : wiretapStatus === 'connecting'
                                  ? 'CONNECTING LIVE CALL STREAM...'
                                  : matchedRec
                                  ? 'PLAYING RECORDED CALL STREAM'
                                  : 'CALL MONITORING STATUS'}
                              </span>
                              <p style={{ fontSize: '12px', color: '#334155', margin: '2px 0 0 0' }}>
                                Target Stream: <strong>{monitoringCall.callerName}</strong> ({(monitoringCall.type || (monitoringCall.isVideo ? 'video' : 'audio')).toUpperCase()})
                                {wiretapNote ? ` • ${wiretapNote}` : ''}
                              </p>
                            </div>
                          </div>

                          <button 
                            onClick={() => {
                              stopLiveWiretap();
                              setMonitoringCall(null);
                            }}
                            className="glass-btn glass-btn-danger"
                            style={{ padding: '6px 14px', borderRadius: '12px', fontSize: '12px', fontWeight: '700', width: isMobile ? '100%' : undefined }}
                          >
                            Disconnect Audio Feed
                          </button>
                        </div>

                        {(wiretapStatus === 'live' || wiretapStatus === 'connecting') && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <video
                              ref={wiretapVideoRef}
                              autoPlay
                              playsInline
                              muted
                              controls
                              onLoadedMetadata={() => wiretapVideoRef.current?.play().catch(() => {})}
                              onCanPlay={() => wiretapVideoRef.current?.play().catch(() => {})}
                              style={{
                                display: wiretapHasVideo ? 'block' : 'none',
                                width: '100%',
                                maxHeight: '280px',
                                borderRadius: '12px',
                                backgroundColor: '#0f172a'
                              }}
                            />
                            <audio
                              ref={wiretapAudioRef}
                              autoPlay
                              playsInline
                              controls
                              onCanPlay={() => wiretapAudioRef.current?.play().catch(() => {})}
                              style={{ width: '100%', height: '38px' }}
                            />
                          </div>
                        )}

                        {wiretapStatus !== 'live' && wiretapStatus !== 'connecting' && matchedRec && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: '#0369a1' }}>
                              Matched Recording: {matchedRec.callerName} ↔ {matchedRec.targetName} • {matchedRec.durationSec || 0}s ({matchedRec.createdAt})
                            </span>
                            {matchedRec.isVideo ? (
                              <video
                                key={matchedRec.id}
                                src={`${getServerBaseUrl()}${matchedRec.url}`}
                                controls
                                autoPlay
                                playsInline
                                style={{ width: '100%', maxHeight: '260px', borderRadius: '12px', backgroundColor: '#000' }}
                              />
                            ) : (
                              <audio
                                key={matchedRec.id}
                                src={`${getServerBaseUrl()}${matchedRec.url}`}
                                controls
                                autoPlay
                                style={{ width: '100%', height: '38px' }}
                              />
                            )}
                          </div>
                        )}

                        {wiretapStatus === 'ended' && !matchedRec && (
                          <p style={{ margin: 0, fontSize: '12px', color: '#475569', backgroundColor: 'rgba(255,255,255,0.65)', padding: '10px 12px', borderRadius: '10px' }}>
                            This call has already ended — no live WebRTC session is currently active, and no compressed recording was saved for this older call entry. Live audio/video playback works whenever a call is active, and finished calls appear below automatically.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {allCalls.activeLiveCalls?.length > 0 && (
                    <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px', border: '1px solid rgba(220, 38, 38, 0.35)' }}>
                      <h3 style={{ fontSize: isMobile ? '15px' : '16px', fontWeight: '800', marginBottom: '10px', marginTop: 0, color: '#dc2626' }}>
                        🔴 Active Live Calls ({allCalls.activeLiveCalls.length})
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {allCalls.activeLiveCalls.map(liveCall => (
                          <div key={liveCall.roomId} className="glass-card" style={{
                            display: 'flex',
                            flexDirection: isMobile ? 'column' : 'row',
                            alignItems: isMobile ? 'flex-start' : 'center',
                            justifyContent: 'space-between',
                            padding: '12px 14px',
                            gap: '10px'
                          }}>
                            <div>
                              <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0 }}>
                                {liveCall.callerName} {liveCall.targetName ? `↔ ${liveCall.targetName}` : ''}
                              </h4>
                              <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0 0' }}>
                                Live {(liveCall.type || (liveCall.isVideo ? 'video' : 'audio')).toUpperCase()} • Status: {liveCall.status || 'Active'}
                              </p>
                            </div>
                            <button
                              onClick={() => startWiretapForCall(liveCall)}
                              className="glass-btn"
                              style={{
                                padding: '6px 14px',
                                borderRadius: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                backgroundColor: 'rgba(220, 38, 38, 0.12)',
                                borderColor: '#dc2626',
                                color: '#dc2626',
                                fontSize: '12px',
                                fontWeight: '700',
                                width: isMobile ? '100%' : undefined
                              }}
                            >
                              <Radio size={15} />
                              Watch / Listen Live
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: isMobile ? '15px' : '16px', fontWeight: '800', marginBottom: '10px', marginTop: 0 }}>
                      🎙️ Compressed Audio & Video Call Recordings ({allRecordings.length})
                    </h3>
                    {allRecordings.length === 0 ? (
                      <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                        Compressed audio and video recordings appear here automatically when a call ends.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {allRecordings.map(rec => (
                          <div key={rec.id} className="glass-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {rec.isVideo ? <Video size={16} color="#8b5cf6" /> : <Volume2 size={16} color="#0284c7" />}
                                <div>
                                  <strong style={{ fontSize: '13px' }}>{rec.callerName} ↔ {rec.targetName}</strong>
                                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                                    {rec.isVideo ? 'Video Call (Compressed)' : 'Audio Call (Compressed)'} • {rec.durationSec || 0}s • {Math.max(1, Math.round((rec.sizeBytes || 0) / 1024))} KB • {rec.createdAt}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <a href={`${getServerBaseUrl()}${rec.url}`} download={rec.filename} className="glass-btn" style={{ width: '28px', height: '28px', textDecoration: 'none' }} title="Download">
                                  <Download size={13} color="#0284c7" />
                                </a>
                                <button
                                  onClick={() => {
                                    fetch(`/api/admin/recordings/${rec.id}`, { method: 'DELETE' })
                                      .then(() => setAllRecordings(prev => prev.filter(x => x.id !== rec.id)));
                                  }}
                                  className="glass-btn"
                                  style={{ width: '28px', height: '28px', backgroundColor: 'rgba(239,68,68,0.1)' }}
                                  title="Delete recording"
                                >
                                  <Trash2 size={12} color="#ef4444" />
                                </button>
                              </div>
                            </div>
                            {rec.isVideo ? (
                              <video src={`${getServerBaseUrl()}${rec.url}`} controls style={{ width: '100%', maxHeight: '220px', borderRadius: '10px', backgroundColor: '#000' }} />
                            ) : (
                              <audio src={`${getServerBaseUrl()}${rec.url}`} controls style={{ width: '100%', height: '36px' }} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="glass-card" style={{ padding: isMobile ? '14px' : '20px' }}>
                    <h3 style={{ fontSize: isMobile ? '15px' : '16px', fontWeight: '800', marginBottom: '12px' }}>
                      Recorded Calls & Wiretap Audio Logs
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {allCalls.callHistory?.map(call => (
                        <div key={call.id} className="glass-card" style={{
                          display: 'flex',
                          flexDirection: isMobile ? 'column' : 'row',
                          alignItems: isMobile ? 'flex-start' : 'center',
                          justifyContent: 'space-between',
                          padding: '12px 14px',
                          gap: '10px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <img src={call.callerAvatar} alt={call.callerName} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                            <div>
                              <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0 }}>{call.callerName}</h4>
                              <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0' }}>
                                Mode: {call.type?.toUpperCase()} • Duration: {call.duration || '01:30'} • Status: {call.status}
                              </p>
                              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Session: {call.id}</span>
                            </div>
                          </div>

                          <button 
                            onClick={() => startWiretapForCall(call)}
                            className="glass-btn"
                            style={{
                              padding: '6px 14px',
                              borderRadius: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              backgroundColor: 'rgba(2, 132, 199, 0.12)',
                              borderColor: '#0284c7',
                              color: '#0284c7',
                              fontSize: '12px',
                              fontWeight: '700',
                              width: isMobile ? '100%' : undefined
                            }}
                          >
                            <Volume2 size={15} />
                            Listen / Wiretap Call
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ==================================================== */}
              {/* TAB 5: STATUS STORIES SURVEILLANCE                   */}
              {/* ==================================================== */}
              {activeTab === 'statuses' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <h3 style={{ fontSize: isMobile ? '15px' : '16px', fontWeight: '800', margin: 0 }}>
                      Live Status Stories Surveillance ({allStatuses.length})
                    </h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                      Active 24-hour photo and text stories posted by users
                    </p>
                  </div>

                  {allStatuses.length === 0 ? (
                    <div className="glass-card" style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                      <Eye size={36} color="#94a3b8" style={{ marginBottom: '8px' }} />
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>No active user statuses posted yet</p>
                    </div>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))',
                      gap: '14px'
                    }}>
                      {allStatuses.map(st => (
                        <div key={st.id} className="glass-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <img src={st.userAvatar} alt={st.userName} style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} />
                              <div>
                                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700' }}>{st.userName}</h4>
                                <span style={{ fontSize: '10px', color: '#64748b' }}>{st.timestamp || 'Recent'}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                if (window.confirm('Delete this status story permanently?')) {
                                  fetch(`/api/status/${st.id}`, { method: 'DELETE' })
                                    .then(r => r.json())
                                    .then(() => setAllStatuses(prev => prev.filter(s => s.id !== st.id)));
                                }
                              }}
                              className="glass-btn"
                              style={{ width: '26px', height: '26px', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                              title="Delete status"
                            >
                              <Trash2 size={12} color="#ef4444" />
                            </button>
                          </div>

                          <div style={{
                            width: '100%',
                            height: '160px',
                            borderRadius: '12px',
                            overflow: 'hidden',
                            background: st.type === 'text' ? (st.backgroundColor || '#0284c7') : '#000000',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            padding: '10px'
                          }}>
                            {st.type === 'text' ? (
                              <p style={{ color: '#ffffff', fontSize: '14px', fontWeight: '700', textAlign: 'center', margin: 0, wordBreak: 'break-word' }}>
                                {st.content}
                              </p>
                            ) : (
                              <img src={st.content} alt="Story" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            )}
                          </div>

                          {st.caption && (
                            <p style={{ margin: 0, fontSize: '11px', color: '#334155', fontWeight: '600' }}>
                              {st.caption}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ==================================================== */}
              {/* TAB 6: GLOBAL BROADCAST ANNOUNCEMENTS                */}
              {/* ==================================================== */}
              {activeTab === 'broadcast' && (
                <div style={{ maxWidth: '640px', width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="glass-card" style={{ padding: isMobile ? '16px' : '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '12px',
                        backgroundColor: 'rgba(2, 132, 199, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#0284c7'
                      }}>
                        <Megaphone size={20} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                          Broadcast Message to All Users
                        </h3>
                        <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                          Send official announcement directly into everyone's chat box.
                        </p>
                      </div>
                    </div>

                    {broadcastStatus && (
                      <span className="glass-pill" style={{
                        padding: '8px 12px',
                        fontSize: '11px',
                        fontWeight: '700',
                        color: broadcastStatus.includes('✅') ? '#16a34a' : '#ef4444',
                        backgroundColor: broadcastStatus.includes('✅') ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'
                      }}>
                        {broadcastStatus}
                      </span>
                    )}

                    <form onSubmit={handleSendBroadcast} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '4px' }}>
                          Announcement Title (Optional)
                        </label>
                        <input 
                          type="text"
                          value={broadcastTitle}
                          onChange={(e) => setBroadcastTitle(e.target.value)}
                          placeholder="e.g., Scheduled Maintenance or New Update"
                          className="glass-input"
                          style={{ width: '100%', fontSize: '13px' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '4px' }}>
                          Announcement Message Body *
                        </label>
                        <textarea 
                          rows="4"
                          value={broadcastMessage}
                          onChange={(e) => setBroadcastMessage(e.target.value)}
                          placeholder="Type your official announcement here..."
                          required
                          className="glass-input"
                          style={{ width: '100%', fontSize: '13px', resize: 'vertical' }}
                        />
                      </div>

                      <button 
                        type="submit"
                        disabled={!broadcastMessage.trim()}
                        className="glass-btn glass-btn-primary"
                        style={{
                          height: '42px',
                          borderRadius: '14px',
                          fontSize: '13px',
                          fontWeight: '800',
                          gap: '6px',
                          marginTop: '4px'
                        }}
                      >
                        <Megaphone size={15} /> Broadcast to All {allUsers.length} Users Now
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Bottom Footer Strip */}
            {isMobile && (
              <div style={{
                padding: '8px 14px',
                backgroundColor: 'rgba(255, 255, 255, 0.92)',
                borderTop: '1px solid rgba(226, 232, 240, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#64748b',
                flexShrink: 0
              }}>
                <span>Port: 5000 • Persistence: database.json</span>
                <button
                  onClick={onClose}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0284c7',
                    fontWeight: '700',
                    cursor: 'pointer',
                    fontSize: '11px'
                  }}
                >
                  Exit to Messenger →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Full User Inspector Modal (Profile + Chats + Live Session) */}
      {inspectedUserId && (
        <AdminUserInspectorModal
          userId={inspectedUserId}
          onClose={() => setInspectedUserId(null)}
          onToggleBlock={handleToggleBlockUser}
          onDeleteUser={handleDeleteUser}
          onDeleteMessage={async (chatId, messageId) => {
            await fetch(`/api/admin/chats/${chatId}/messages/${messageId}`, { method: 'DELETE' });
            loadAdminData();
          }}
          onSelectUserProfile={(uid) => setInspectedUserId(uid)}
        />
      )}
    </div>
  );
}
