import React, { useState, useEffect, useRef } from 'react';
import {
  X, User, MessageSquare, Wifi, Shield, Ban, Trash2, ArrowLeft,
  RefreshCw, Search, CheckCheck, Check, Play, Pause, MapPin,
  Download, Volume2, Video, Users, Megaphone, Forward, Zap, Calendar, BarChart2
} from 'lucide-react';
import ChatListItem from './ChatListItem';
import { formatISTDate, formatISTTime, formatLastSeen } from '../utils/time';
import { normalizeDigits, getLast10, resolveDisplayName } from '../utils/contacts';

const formatISTDateTime = (d) => `${formatISTDate(d)} ${formatISTTime(d)}`;

const formatBytes = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatSecDuration = (sec) => {
  const s = Number(sec) || 0;
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};

/**
 * Admin User Full Inspector Modal:
 * - Default view mirrors the user's exact GlassChat Home Chat List (Screenshot 2)
 *   and clicking any chat mirrors the user's exact ChatRoom view (WITHOUT any Audio/Video Call or Lock icons).
 * - Also inspects Live Session, OTP logs, Compressed Call Recordings, and Full Profile & Settings.
 */
export default function AdminUserInspectorModal({
  userId,
  onClose,
  onToggleBlock,
  onDeleteUser,
  onDeleteMessage,
  onSelectUserProfile
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('chats'); // 'chats' | 'session' | 'recordings' | 'profile'
  const [activeConv, setActiveConv] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatFilter, setChatFilter] = useState('all'); // 'all' | 'unread' | 'groups'

  // Inline voice note playback inside mirrored chat
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const audioRef = useRef(null);

  const togglePlayAudio = (msgId, url) => {
    if (playingAudioId === msgId) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      audioRef.current?.pause();
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => setPlayingAudioId(null);
      a.onerror = () => setPlayingAudioId(null);
      a.play().catch(() => setPlayingAudioId(null));
      setPlayingAudioId(msgId);
    }
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const fetchInspector = () => {
    if (!userId) return;
    setLoading(true);
    fetch(`/api/admin/user/${userId}/inspector`)
      .then(r => r.json())
      .then(res => {
        if (!res.error) {
          setData(res);
          if (activeConv) {
            const refreshed = res.conversations?.find(c => c.chatId === activeConv.chatId);
            setActiveConv(refreshed || null);
          }
        }
      })
      .catch(e => console.error('Inspector fetch failed:', e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setActiveConv(null);
    setSearchQuery('');
    setChatFilter('all');
    fetchInspector();
  }, [userId]);

  if (!userId) return null;

  const profile = data?.profile;
  const session = data?.session;
  const conversations = data?.conversations || [];
  const callRecordings = data?.callRecordings || [];

  // Build savedContactsMap matching how this user sees contact names
  const userSavedMap = {};
  (profile?.savedContacts || []).forEach(sc => {
    const digits = normalizeDigits(sc.cleanDigits || sc.phone);
    if (digits && sc.name) {
      userSavedMap[digits] = sc.name;
      const last10 = getLast10(digits);
      if (last10) userSavedMap[last10] = sc.name;
    }
  });

  // Map server conversations into exact ChatListItem shape
  const mappedChats = conversations.map(conv => {
    const lm = conv.lastMessage;
    const isGroup = Boolean(conv.isGroup);
    return {
      id: isGroup ? (conv.id || conv.chatId) : (conv.partner?.id || conv.id || conv.chatId),
      isGroup,
      isChannel: Boolean(conv.isChannel),
      name: isGroup
        ? (conv.name || conv.title)
        : (conv.partner?.name && conv.partner.name !== 'User' ? conv.partner.name : ''),
      phone: isGroup ? '' : (conv.partner?.phone || ''),
      avatar: isGroup ? conv.avatar : conv.partner?.avatar,
      online: Boolean(conv.partner?.online),
      lastSeen: conv.partner?.lastSeen || null,
      lastMessage: lm?.text || (lm?.type ? `[${lm.type}]` : 'Tap to view chat'),
      lastMessageStatus: lm?.status,
      lastMessageSenderId: lm?.senderId,
      rawTime: lm?.rawTime || 0,
      createdAt: lm?.createdAt || '',
      timestamp: lm?.timestamp || '',
      unreadCount: 0,
      _rawConv: conv
    };
  });

  const groupCount = mappedChats.filter(c => c.isGroup).length;
  const cleanSearch = searchQuery.trim().toLowerCase();
  const cleanDigits = searchQuery.replace(/\D/g, '');

  const visibleChats = mappedChats.filter(c => {
    if (chatFilter === 'groups' && !c.isGroup) return false;
    if (chatFilter === 'unread' && !(c.unreadCount > 0)) return false;
    if (!cleanSearch) return true;
    const resolved = resolveDisplayName(c, userSavedMap, true).toLowerCase();
    return (
      resolved.includes(cleanSearch) ||
      (c.name || '').toLowerCase().includes(cleanSearch) ||
      (c.phone || '').toLowerCase().includes(cleanSearch) ||
      (cleanDigits && normalizeDigits(c.phone).includes(cleanDigits))
    );
  });

  const activeConvTitle = activeConv
    ? (activeConv.isGroup
        ? (activeConv.name || activeConv.title)
        : resolveDisplayName(activeConv.partner, userSavedMap, true))
    : '';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10050,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '10px'
    }} onClick={onClose}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '520px',
        height: '92vh',
        borderRadius: '28px',
        background: 'var(--app-backdrop)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.38)',
        border: '1.5px solid var(--glass-border)'
      }} onClick={(e) => e.stopPropagation()}>

        {/* Admin User Bar */}
        <div style={{
          padding: '10px 14px',
          backgroundColor: 'var(--glass-bg-header)',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <img
              src={profile?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'}
              alt={profile?.name || ''}
              style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #0284c7' }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <strong style={{ fontSize: '14px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {profile?.name && profile.name !== 'User' ? profile.name : (profile?.phone || 'Contact')}
                </strong>
                <span style={{
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '9px',
                  fontWeight: '800',
                  backgroundColor: session?.online ? 'rgba(34,197,94,0.16)' : 'rgba(148,163,184,0.2)',
                  color: session?.online ? '#16a34a' : '#64748b'
                }}>
                  {session?.online ? '● Online' : 'Offline'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>
                {profile?.phone} • {session?.platform || 'Web'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
            <button onClick={fetchInspector} className="glass-btn" style={{ width: '30px', height: '30px' }} title="Refresh">
              <RefreshCw size={13} color="#0284c7" />
            </button>
            {profile && (
              <>
                <button
                  onClick={() => {
                    onToggleBlock?.(userId);
                    setTimeout(fetchInspector, 250);
                  }}
                  className="glass-btn"
                  style={{ width: '30px', height: '30px', backgroundColor: profile.isBlocked ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.1)' }}
                  title={profile.isBlocked ? 'Unblock user' : 'Block user'}
                >
                  <Ban size={13} color={profile.isBlocked ? '#16a34a' : '#ef4444'} />
                </button>
                <button
                  onClick={() => {
                    onDeleteUser?.(userId);
                    onClose?.();
                  }}
                  className="glass-btn"
                  style={{ width: '30px', height: '30px', backgroundColor: 'rgba(239,68,68,0.1)' }}
                  title="Delete user"
                >
                  <Trash2 size={13} color="#ef4444" />
                </button>
              </>
            )}
            <button onClick={onClose} className="glass-btn" style={{ width: '30px', height: '30px' }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Sub-Tabs Strip */}
        <div style={{
          display: 'flex',
          gap: '6px',
          padding: '8px 14px',
          backgroundColor: 'var(--glass-bg-subtle)',
          borderBottom: '1px solid var(--glass-border-subtle)',
          overflowX: 'auto',
          flexShrink: 0
        }}>
          {[
            { id: 'chats', label: `💬 Chats (${conversations.length})` },
            { id: 'session', label: `📡 Session` },
            { id: 'recordings', label: `🎙️ Calls (${callRecordings.length})` },
            { id: 'profile', label: '👤 Profile & Settings' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="glass-pill"
              style={{
                padding: '5px 12px',
                fontSize: '11px',
                fontWeight: '700',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                backgroundColor: tab === t.id ? '#0284c7' : undefined,
                borderColor: tab === t.id ? '#0284c7' : undefined,
                color: tab === t.id ? '#ffffff' : 'var(--text-secondary)'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Main Mirror Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontWeight: '700', fontSize: '13px' }}>
              Loading mirrored user interface...
            </div>
          ) : !profile ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#ef4444' }}>User not found.</div>
          ) : tab === 'chats' ? (
            !activeConv ? (
              /* ============================================================== */
              /* SCREEN A: EXACT MIRROR OF USER HOME CHAT LIST (SCREENSHOT 2)  */
              /* NO AUDIO/VIDEO CALL BUTTONS                                    */
              /* ============================================================== */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Mirrored Search Bar */}
                <div style={{ padding: '10px 14px 4px 14px', flexShrink: 0 }}>
                  <div style={{ position: 'relative' }}>
                    <Search
                      size={15}
                      color="var(--text-muted)"
                      style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search chats, contacts..."
                      className="glass-input"
                      style={{ width: '100%', paddingLeft: '34px', fontSize: '13px' }}
                    />
                  </div>
                </div>

                {/* Mirrored Filter Pills: All, Unread, Groups (N) */}
                <div style={{
                  padding: '6px 14px 4px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexShrink: 0
                }}>
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'unread', label: 'Unread' },
                    { id: 'groups', label: `Groups (${groupCount})` }
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
                        cursor: 'pointer'
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Mirrored ChatListItem Stack (hideCallButtons={true}) */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                  {visibleChats.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      No conversations found
                    </div>
                  ) : (
                    visibleChats.map(chat => (
                      <ChatListItem
                        key={chat._rawConv.chatId}
                        chat={chat}
                        currentUser={profile}
                        savedContactsMap={userSavedMap}
                        hideCallButtons={true}
                        onSelectChat={(c) => setActiveConv(c._rawConv)}
                      />
                    ))
                  )}
                </div>
              </div>
            ) : (
              /* ============================================================== */
              /* SCREEN B: EXACT MIRROR OF USER CHAT ROOM (NO CALL/LOCK ICONS) */
              /* ============================================================== */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Mirrored ChatRoom Header (No Phone, No Video, No Lock) */}
                <div className="glass-panel" style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--glass-border)',
                  backgroundColor: 'var(--glass-bg-header)',
                  flexShrink: 0
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <button
                      onClick={() => setActiveConv(null)}
                      className="glass-btn"
                      style={{ width: '34px', height: '34px', flexShrink: 0 }}
                      title="Back to User Chats"
                    >
                      <ArrowLeft size={17} color="var(--text-primary)" />
                    </button>

                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <img
                        src={(activeConv.isGroup ? activeConv.avatar : activeConv.partner?.avatar) || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}
                        alt={activeConvTitle}
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: activeConv.isGroup ? '12px' : '50%',
                          objectFit: 'cover',
                          border: '2px solid rgba(255, 255, 255, 0.85)'
                        }}
                      />
                      {!activeConv.isGroup && activeConv.partner?.online && (
                        <span style={{
                          position: 'absolute',
                          bottom: '1px',
                          right: '1px',
                          width: '9px',
                          height: '9px',
                          backgroundColor: '#22c55e',
                          border: '2px solid #ffffff',
                          borderRadius: '50%'
                        }} />
                      )}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{
                        fontSize: '14px',
                        fontWeight: '800',
                        color: 'var(--text-primary)',
                        margin: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}>
                        {activeConv.isChannel && <Megaphone size={13} color="#0284c7" />}
                        <span>{activeConvTitle}</span>
                      </h3>
                      <span style={{ fontSize: '11px', color: activeConv.partner?.online ? '#16a34a' : 'var(--text-secondary)', fontWeight: '500' }}>
                        {activeConv.isGroup
                          ? `${activeConv.messages.length} messages`
                          : activeConv.partner?.online
                            ? 'Online'
                            : (activeConv.partner?.lastSeen ? formatLastSeen(activeConv.partner.lastSeen) : activeConv.partner?.phone || 'Offline')}
                      </span>
                    </div>
                  </div>

                  {!activeConv.isGroup && activeConv.partner?.id && onSelectUserProfile && (
                    <button
                      onClick={() => onSelectUserProfile(activeConv.partner.id)}
                      className="glass-pill"
                      style={{ padding: '4px 9px', fontSize: '10px', fontWeight: '700', color: '#0284c7', cursor: 'pointer' }}
                    >
                      Inspect Partner →
                    </button>
                  )}
                </div>

                {/* Mirrored Message Thread */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {activeConv.messages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No messages in this conversation yet.
                    </div>
                  ) : (
                    activeConv.messages.map((msg, idx) => {
                      const isMe = msg.senderId === userId;
                      const isAudio = msg.type === 'audio';
                      return (
                        <div
                          key={msg.id || idx}
                          style={{
                            display: 'flex',
                            justifyContent: isMe ? 'flex-end' : 'flex-start',
                            position: 'relative',
                            marginBottom: msg.reactions && Object.keys(msg.reactions).length > 0 ? '8px' : '0'
                          }}
                        >
                          <div
                            className={isMe ? 'message-bubble-outgoing' : 'message-bubble-incoming'}
                            style={{
                              maxWidth: '82%',
                              padding: isAudio ? '8px 12px' : '10px 14px',
                              borderRadius: isMe ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                              border: msg.isUrgent ? '1.5px solid #ef4444' : undefined,
                              position: 'relative'
                            }}
                          >
                            {msg.isForwarded && (
                              <div style={{ fontSize: '10px', fontStyle: 'italic', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '3px' }}>
                                <Forward size={10} /> Forwarded
                              </div>
                            )}

                            {msg.replyTo && (
                              <div style={{ padding: '4px 8px', marginBottom: '5px', borderRadius: '8px', backgroundColor: 'rgba(2,132,199,0.1)', borderLeft: '3px solid #0284c7', fontSize: '11px' }}>
                                <div style={{ fontWeight: '800', color: '#0284c7' }}>{msg.replyTo.senderName}</div>
                                <div style={{ color: 'var(--text-secondary)', maxWidth: '210px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {msg.replyTo.text}
                                </div>
                              </div>
                            )}

                            {activeConv.isGroup && !isMe && (
                              <span style={{ fontSize: '11px', fontWeight: '700', color: '#0284c7', display: 'block', marginBottom: '2px' }}>
                                {resolveDisplayName({ name: msg.senderName, phone: msg.senderPhone }, userSavedMap, true)}
                              </span>
                            )}

                            {msg.type === 'image' && msg.mediaUrl && (
                              <img src={msg.mediaUrl} alt="media" style={{ maxWidth: '210px', borderRadius: '12px', display: 'block', marginBottom: '4px' }} />
                            )}

                            {msg.type === 'video' && msg.mediaUrl && (
                              <video src={msg.mediaUrl} controls style={{ maxWidth: '220px', borderRadius: '12px', display: 'block', marginBottom: '4px' }} />
                            )}

                            {msg.type === 'audio' && msg.mediaUrl && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '175px' }}>
                                <button
                                  type="button"
                                  onClick={() => togglePlayAudio(msg.id, msg.mediaUrl)}
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    backgroundColor: isMe ? '#0284c7' : '#0f172a',
                                    color: '#ffffff',
                                    border: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer'
                                  }}
                                >
                                  {playingAudioId === msg.id ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                                  {msg.text || 'Voice Note'}
                                </span>
                              </div>
                            )}

                            {msg.type === 'location' && msg.locationData && (
                              <div style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <MapPin size={13} /> {msg.locationData.lat.toFixed(4)}, {msg.locationData.lng.toFixed(4)}
                              </div>
                            )}

                            {msg.type === 'poll' && msg.pollData && (
                              <div style={{ fontSize: '12px' }}>
                                <strong style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <BarChart2 size={13} color="#eab308" /> {msg.pollData.question}
                                </strong>
                                {msg.pollData.options?.map(o => (
                                  <div key={o.id} style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    • {o.text} ({o.votes?.length || 0} votes)
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.type !== 'audio' && msg.type !== 'poll' && msg.text && (
                              <p style={{
                                fontSize: '14px',
                                lineHeight: '1.45',
                                color: !isMe ? 'var(--text-primary)' : (
                                  msg.status === 'seen' || msg.status === 'read' ? '#0284c7' :
                                  msg.status === 'delivered' ? '#059669' : '#ef4444'
                                ),
                                fontWeight: isMe ? '500' : '400',
                                margin: 0,
                                wordBreak: 'break-word'
                              }}>
                                {msg.text}
                              </p>
                            )}

                            {msg.transcript && (
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                                📝 "{msg.transcript}"
                              </div>
                            )}

                            {/* Timestamp, Ticks & Subtle Admin Delete */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '5px', marginTop: '3px' }}>
                              {msg.isEdited && <span style={{ fontSize: '9px', fontStyle: 'italic', color: 'var(--text-muted)' }}>edited</span>}
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                {(msg.rawTime || msg.createdAt) ? formatISTTime(msg.rawTime || msg.createdAt) : (msg.timestamp || '')}
                              </span>
                              {isMe && (
                                msg.status === 'seen' || msg.status === 'read' ? (
                                  <CheckCheck size={14} color="#34B7F1" />
                                ) : msg.status === 'delivered' ? (
                                  <CheckCheck size={14} color="#10b981" />
                                ) : (
                                  <Check size={13} color="#ef4444" />
                                )
                              )}
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteMessage?.(activeConv.chatId, msg.id);
                                  fetchInspector();
                                }}
                                style={{ background: 'none', border: 'none', color: '#ef4444', opacity: 0.65, cursor: 'pointer', padding: '0 2px', display: 'flex' }}
                                title="Delete message as Admin"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>

                            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                              <div style={{
                                position: 'absolute',
                                bottom: '-8px',
                                right: isMe ? '8px' : 'auto',
                                left: isMe ? 'auto' : '8px',
                                padding: '1px 6px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                backgroundColor: 'rgba(255,255,255,0.92)',
                                border: '1px solid rgba(0,0,0,0.08)'
                              }}>
                                {Array.from(new Set(Object.values(msg.reactions))).join(' ')}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Read-Only Mirror Footer */}
                <div style={{
                  padding: '8px 14px',
                  backgroundColor: 'var(--glass-bg-header)',
                  borderTop: '1px solid var(--glass-border-subtle)',
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: '700',
                  color: 'var(--text-secondary)',
                  flexShrink: 0
                }}>
                  Mirrored Read-Only View • No Calls / No Lock UI
                </div>
              </div>
            )
          ) : tab === 'session' ? (
            /* TAB 2: LIVE SESSION & OTP */
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
                <div className="glass-card" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--text-muted)' }}>SESSION STATE</div>
                  <div style={{ fontSize: '16px', fontWeight: '800', color: session?.online ? '#16a34a' : '#64748b', marginTop: '4px' }}>
                    {session?.status || 'Offline'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Socket: <code>{session?.socketId || 'None'}</code>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--text-muted)' }}>DEVICE & IP</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#0284c7', marginTop: '4px' }}>
                    {session?.platform || 'Unknown'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    IP: <strong>{session?.ip || 'N/A'}</strong>
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--text-muted)' }}>TIMELINE</div>
                  <div style={{ fontSize: '11px', fontWeight: '700', marginTop: '4px' }}>
                    Login: {session?.connectedAt ? formatISTDateTime(new Date(session.connectedAt)) : 'N/A'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Last Seen: {session?.disconnectedAt ? formatISTDateTime(new Date(session.disconnectedAt)) : (session?.online ? 'Active Now' : 'N/A')}
                  </div>
                </div>

                <div className="glass-card" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--text-muted)' }}>ACTIVE CALL & QUEUE</div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: session?.activeCallRoomId ? '#16a34a' : 'var(--text-secondary)', marginTop: '4px' }}>
                    {session?.activeCallRoomId ? `📞 Room: ${session.activeCallRoomId}` : 'No active live call'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Scheduled Msgs: {data?.scheduledMessages?.length || 0}
                  </div>
                </div>
              </div>

              {session?.userAgent && (
                <div className="glass-card" style={{ padding: '12px', fontSize: '11px' }}>
                  <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>USER-AGENT</strong>
                  <code style={{ wordBreak: 'break-all' }}>{session.userAgent}</code>
                </div>
              )}

              <div className="glass-card" style={{ padding: '12px' }}>
                <strong style={{ fontSize: '12px', display: 'block', marginBottom: '8px' }}>
                  🔑 Recent OTP Login Sessions ({session?.otpHistory?.length || 0})
                </strong>
                {(!session?.otpHistory || session.otpHistory.length === 0) ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>No OTP login history recorded since boot.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {session.otpHistory.map((o, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 10px', borderRadius: '10px', backgroundColor: 'var(--glass-bg-subtle)' }}>
                        <span>OTP: <strong style={{ color: '#0284c7', fontFamily: 'monospace' }}>{o.otp}</strong></span>
                        <span style={{ color: o.status === 'Verified' ? '#16a34a' : '#d97706', fontWeight: '700' }}>{o.status}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{o.createdAt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'recordings' ? (
            /* TAB 3: COMPRESSED AUDIO & VIDEO CALL RECORDINGS */
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-secondary)' }}>
                Compressed Call Recordings ({callRecordings.length})
              </div>
              {callRecordings.length === 0 ? (
                <div className="glass-card" style={{ padding: '28px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                  No compressed audio or video call recordings captured for this user yet. Recordings appear automatically once calls finish.
                </div>
              ) : (
                callRecordings.map(rec => (
                  <div key={rec.id} className="glass-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {rec.isVideo ? <Video size={16} color="#8b5cf6" /> : <Volume2 size={16} color="#0284c7" />}
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '800' }}>{rec.callerName} ↔ {rec.targetName}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                            {rec.createdAt} • {formatSecDuration(rec.durationSec)} • {formatBytes(rec.sizeBytes)}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <a href={rec.url} download={rec.filename} className="glass-btn" style={{ width: '28px', height: '28px', textDecoration: 'none' }} title="Download">
                          <Download size={13} color="#0284c7" />
                        </a>
                        <button
                          onClick={async () => {
                            await fetch(`/api/admin/recordings/${rec.id}`, { method: 'DELETE' });
                            fetchInspector();
                          }}
                          className="glass-btn"
                          style={{ width: '28px', height: '28px', backgroundColor: 'rgba(239,68,68,0.1)' }}
                          title="Delete recording"
                        >
                          <Trash2 size={13} color="#ef4444" />
                        </button>
                      </div>
                    </div>
                    {rec.isVideo ? (
                      <video src={rec.url} controls style={{ width: '100%', maxHeight: '220px', borderRadius: '12px', backgroundColor: '#000' }} />
                    ) : (
                      <audio src={rec.url} controls style={{ width: '100%', height: '36px' }} />
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            /* TAB 4: PROFILE, SAVED CONTACTS & SETTINGS */
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
                <div className="glass-card" style={{ padding: '12px', fontSize: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--text-muted)', marginBottom: '4px' }}>PERSONAL DETAILS</div>
                  <div><strong>Bio:</strong> {profile.status || 'Available'}</div>
                  <div><strong>Email:</strong> {profile.email || 'Not set'}</div>
                  <div><strong>DOB:</strong> {profile.dob || 'Not set'}</div>
                  <div><strong>Joined:</strong> {profile.createdAt ? formatISTDateTime(new Date(profile.createdAt)) : 'N/A'}</div>
                </div>
                <div className="glass-card" style={{ padding: '12px', fontSize: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: 'var(--text-muted)', marginBottom: '4px' }}>SECURITY & FAMILY SAFE</div>
                  <div><strong>Two-Step PIN:</strong> {profile.twoStepEnabled ? `ON (${profile.twoStepPin})` : 'Disabled'}</div>
                  <div><strong>Recovery Email:</strong> {profile.recoveryEmail || 'None'}</div>
                  <div><strong>Family Safe:</strong> {profile.familySafe?.enabled ? `ON (PIN ${profile.familySafe.pin})` : 'Off'}</div>
                  <div><strong>SOS Contacts:</strong> {profile.sosContacts?.length || 0}</div>
                </div>
              </div>

              <div className="glass-card" style={{ padding: '12px' }}>
                <strong style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  📒 User's Saved Phonebook ({profile.savedContacts?.length || 0})
                </strong>
                {(!profile.savedContacts || profile.savedContacts.length === 0) ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>No saved phonebook contacts.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {profile.savedContacts.map((sc, i) => (
                      <span key={i} className="glass-pill" style={{ padding: '3px 9px', fontSize: '11px' }}>
                        <strong>{sc.name}</strong> ({sc.phone})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
