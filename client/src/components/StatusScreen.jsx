import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Plus, Eye, X, Image as ImageIcon, Type, Send, ChevronRight, 
  Trash2, Clock, Check, Sparkles, ChevronUp, CheckCheck
} from 'lucide-react';
import { formatChatTimestamp, formatISTTime } from '../utils/time';
import { resolveDisplayName } from '../utils/contacts';

export default function StatusScreen({ currentUser, socket, savedContactsMap = {}, contacts = [] }) {
  const getAuthorName = (id, rawName, rawPhone) => {
    const matched = contacts.find(c => c.id === id);
    return resolveDisplayName(
      { name: matched?.name || rawName, phone: matched?.phone || rawPhone },
      savedContactsMap,
      true
    );
  };
  const [statuses, setStatuses] = useState([]);
  const [activeStoryGroup, setActiveStoryGroup] = useState(null); // array of stories for selected user
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [storyProgress, setStoryProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Status Viewers Modal State (Who saw your status)
  const [showViewersModal, setShowViewersModal] = useState(false);
  const [selectedStatusForViewers, setSelectedStatusForViewers] = useState(null);

  // New Status Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState('photo'); // 'photo' | 'text'
  const [photoPreview, setPhotoPreview] = useState(null);
  const [statusText, setStatusText] = useState('');
  const [statusCaption, setStatusCaption] = useState('');
  const [bgColorIndex, setBgColorIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef(null);
  const progressTimerRef = useRef(null);

  const bgGradients = [
    'linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
    'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
  ];

  // Fetch statuses with WhatsApp mutual contact privacy
  const loadStatuses = () => {
    const url = currentUser?.id ? `/api/status?userId=${currentUser.id}` : '/api/status';
    fetch(url)
      .then(r => r.json())
      .then(data => setStatuses(data || []))
      .catch(e => console.error('Failed to load statuses:', e));
  };

  useEffect(() => {
    loadStatuses();

    const handleNewStatus = () => {
      loadStatuses();
    };
    const handleDeleteStatus = ({ id }) => {
      setStatuses(prev => prev.filter(s => s.id !== id));
    };
    const handleStatusViewed = ({ statusId, view }) => {
      setStatuses(prev => prev.map(s => {
        if (s.id === statusId) {
          const currentViews = s.views || [];
          if (!currentViews.some(v => v.userId === view.userId)) {
            return { ...s, views: [...currentViews, view] };
          }
        }
        return s;
      }));
    };

    socket?.on('new-status', handleNewStatus);
    socket?.on('status-deleted', handleDeleteStatus);
    socket?.on('status-viewed', handleStatusViewed);

    return () => {
      socket?.off('new-status', handleNewStatus);
      socket?.off('status-deleted', handleDeleteStatus);
      socket?.off('status-viewed', handleStatusViewed);
    };
  }, [socket]);

  // Group statuses by user
  const myStatuses = statuses.filter(s => s.userId === currentUser?.id);
  const otherStatusesByUser = statuses
    .filter(s => s.userId !== currentUser?.id)
    .reduce((acc, st) => {
      if (!acc[st.userId]) {
        acc[st.userId] = {
          userId: st.userId,
          userName: getAuthorName(st.userId, st.userName, st.userPhone),
          userAvatar: st.userAvatar,
          stories: []
        };
      }
      acc[st.userId].stories.push(st);
      return acc;
    }, {});

  const contactStatusGroups = Object.values(otherStatusesByUser);

  // File Picker Handler
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result);
      setCreateMode('photo');
      setIsCreateOpen(true);
    };
    reader.readAsDataURL(file);
  };

  // Submit New Status
  const handleCreateStatus = async () => {
    if (createMode === 'photo' && !photoPreview) return;
    if (createMode === 'text' && !statusText.trim()) return;

    setIsSubmitting(true);
    try {
      const payload = {
        userId: currentUser.id,
        type: createMode,
        content: createMode === 'photo' ? photoPreview : statusText.trim(),
        caption: statusCaption.trim(),
        backgroundColor: bgGradients[bgColorIndex]
      };

      const res = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.id) {
        setStatuses(prev => [data, ...prev]);
        setIsCreateOpen(false);
        setPhotoPreview(null);
        setStatusText('');
        setStatusCaption('');
      }
    } catch (err) {
      console.error('Failed to post status:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Story Viewer Timer Logic (5 seconds per story)
  useEffect(() => {
    if (!activeStoryGroup) {
      setStoryProgress(0);
      return;
    }

    if (isPaused) return;

    const currentStory = activeStoryGroup[activeStoryIndex];
    if (currentStory && currentUser?.id && currentStory.userId !== currentUser.id) {
      // Mark as viewed
      fetch(`/api/status/${currentStory.id}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      }).catch(e => console.error(e));
    }

    const interval = 50; // 50ms ticks
    const step = 100 / (5000 / interval);

    progressTimerRef.current = setInterval(() => {
      setStoryProgress(prev => {
        if (prev >= 100) {
          // Go to next slide
          if (activeStoryIndex < activeStoryGroup.length - 1) {
            setActiveStoryIndex(i => i + 1);
            return 0;
          } else {
            // End of stories
            setActiveStoryGroup(null);
            return 0;
          }
        }
        return prev + step;
      });
    }, interval);

    return () => clearInterval(progressTimerRef.current);
  }, [activeStoryGroup, activeStoryIndex, isPaused, currentUser?.id]);

  const openStoryViewer = (storiesList, startIndex = 0) => {
    setActiveStoryGroup(storiesList);
    setActiveStoryIndex(startIndex);
    setStoryProgress(0);
  };

  const handleNextStory = () => {
    if (!activeStoryGroup) return;
    if (activeStoryIndex < activeStoryGroup.length - 1) {
      setActiveStoryIndex(i => i + 1);
      setStoryProgress(0);
    } else {
      setActiveStoryGroup(null);
    }
  };

  const handlePrevStory = () => {
    if (!activeStoryGroup) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex(i => i - 1);
      setStoryProgress(0);
    }
  };

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: '16px 14px',
      paddingBottom: '95px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }}>
      {/* Hidden File Input for uploading status picture */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handlePhotoSelect} 
        accept="image/*" 
        style={{ display: 'none' }} 
      />

      {/* MY STATUS CARD */}
      <div className="glass-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div 
          onClick={() => {
            if (myStatuses.length > 0) {
              openStoryViewer(myStatuses);
            } else {
              fileInputRef.current?.click();
            }
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', flex: 1 }}
        >
          <div style={{ position: 'relative' }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              padding: myStatuses.length > 0 ? '3px' : '0px',
              background: myStatuses.length > 0 ? 'linear-gradient(135deg, #0284c7, #22c55e)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img 
                src={currentUser?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                alt="My Status" 
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid #ffffff'
                }} 
              />
            </div>

            {myStatuses.length === 0 ? (
              <div style={{
                position: 'absolute',
                bottom: '0px',
                right: '0px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #ffffff'
              }}>
                <Plus size={14} strokeWidth={3} />
              </div>
            ) : (
              <div style={{
                position: 'absolute',
                bottom: '0px',
                right: '0px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: '#22c55e',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #ffffff',
                fontSize: '10px',
                fontWeight: '800'
              }}>
                {myStatuses.length}
              </div>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
              My Status
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              {myStatuses.length > 0 
                ? `${myStatuses.length} update${myStatuses.length > 1 ? 's' : ''} • Tap to view` 
                : 'Tap to add status update'}
            </p>
          </div>
        </div>

        {/* Quick Actions: Viewers, Camera & Text status */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {myStatuses.length > 0 && (
            <button
              onClick={() => {
                setSelectedStatusForViewers(myStatuses[0]);
                setShowViewersModal(true);
              }}
              className="glass-btn"
              style={{
                height: '38px',
                padding: '0 12px',
                borderRadius: '19px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: '700',
                color: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.12)'
              }}
              title="See who viewed your status updates"
            >
              <Eye size={15} />
              <span>{myStatuses.reduce((acc, s) => acc + (s.views?.length || 0), 0)} views</span>
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="glass-btn"
            style={{ width: '38px', height: '38px', borderRadius: '50%' }}
            title="Add Photo Status"
          >
            <Camera size={18} color="#0284c7" />
          </button>
          <button
            onClick={() => {
              setCreateMode('text');
              setPhotoPreview(null);
              setIsCreateOpen(true);
            }}
            className="glass-btn"
            style={{ width: '38px', height: '38px', borderRadius: '50%' }}
            title="Add Text Status"
          >
            <Type size={18} color="#0284c7" />
          </button>
        </div>
      </div>

      {/* RECENT UPDATES SECTION */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px 4px' }}>
          <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Recent Updates ({contactStatusGroups.length})
          </span>
          <Sparkles size={14} color="#0284c7" />
        </div>

        {contactStatusGroups.length === 0 ? (
          <div className="glass-card" style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '13px', margin: 0, fontWeight: '600' }}>No recent updates from contacts</p>
            <p style={{ fontSize: '11px', margin: '4px 0 0 0', opacity: 0.8 }}>
              Status updates from registered users will appear here for 24 hours.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {contactStatusGroups.map(group => {
              const latestStory = group.stories[0];
              const hasUnviewed = group.stories.some(s => !s.views?.includes(currentUser?.id));

              return (
                <div 
                  key={group.userId}
                  onClick={() => openStoryViewer(group.stories)}
                  className="glass-card"
                  style={{
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    padding: '2.5px',
                    background: hasUnviewed 
                      ? 'linear-gradient(135deg, #0284c7 0%, #22c55e 100%)' 
                      : 'rgba(148, 163, 184, 0.4)',
                    boxShadow: hasUnviewed ? '0 0 12px rgba(2, 132, 199, 0.35)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <img 
                      src={group.userAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                      alt={group.userName}
                      style={{
                        width: '45px',
                        height: '45px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '2px solid #ffffff'
                      }}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                        {group.userName}
                      </h4>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {formatChatTimestamp(latestStory.createdAt || latestStory.timestamp)}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {latestStory.caption || (latestStory.type === 'text' ? latestStory.content : 'Photo status')}
                    </p>
                  </div>

                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CREATE STATUS MODAL */}
      {isCreateOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 140,
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '16px'
        }}>
          {/* Top Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#ffffff' }}>
            <button 
              onClick={() => setIsCreateOpen(false)}
              className="glass-btn"
              style={{ width: '38px', height: '38px', backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }}
            >
              <X size={18} />
            </button>

            {createMode === 'text' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                {bgGradients.map((g, idx) => (
                  <button
                    key={idx}
                    onClick={() => setBgColorIndex(idx)}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: g,
                      border: bgColorIndex === idx ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.4)',
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Main Content Area */}
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            position: 'relative'
          }}>
            {createMode === 'photo' && photoPreview ? (
              <img 
                src={photoPreview} 
                alt="Status Preview" 
                style={{
                  maxHeight: '60vh',
                  maxWidth: '100%',
                  borderRadius: '20px',
                  objectFit: 'contain',
                  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
                }} 
              />
            ) : (
              <div style={{
                width: '100%',
                maxWidth: '380px',
                height: '340px',
                borderRadius: '24px',
                background: bgGradients[bgColorIndex],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)'
              }}>
                <textarea
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  placeholder="Type a status..."
                  autoFocus
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '22px',
                    fontWeight: '700',
                    textAlign: 'center',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                  rows={4}
                />
              </div>
            )}
          </div>

          {/* Bottom Bar: Caption & Send */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input 
              type="text"
              value={statusCaption}
              onChange={(e) => setStatusCaption(e.target.value)}
              placeholder="Add a caption..."
              className="glass-input"
              style={{
                flex: 1,
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                padding: '12px 18px',
                fontSize: '14px'
              }}
            />

            <button
              onClick={handleCreateStatus}
              disabled={isSubmitting || (createMode === 'text' && !statusText.trim())}
              className="glass-btn glass-btn-primary"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                flexShrink: 0,
                opacity: (createMode === 'text' && !statusText.trim()) ? 0.6 : 1
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}

      {/* FULL SCREEN WHATSAPP STORY VIEWER */}
      {activeStoryGroup && (
        <div 
          onMouseDown={() => setIsPaused(true)}
          onMouseUp={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setIsPaused(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 150,
            backgroundColor: '#000000',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflow: 'hidden'
          }}
        >
          {/* Top Progress Bars */}
          <div style={{
            padding: '12px 14px 6px 14px',
            paddingTop: 'max(14px, env(safe-area-inset-top))',
            display: 'flex',
            gap: '4px',
            zIndex: 30
          }}>
            {activeStoryGroup.map((story, idx) => (
              <div 
                key={story.id} 
                style={{
                  flex: 1,
                  height: '3px',
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}
              >
                <div style={{
                  height: '100%',
                  width: idx < activeStoryIndex ? '100%' : idx === activeStoryIndex ? `${storyProgress}%` : '0%',
                  backgroundColor: '#ffffff',
                  transition: idx === activeStoryIndex ? 'width 0.05s linear' : 'none'
                }} />
              </div>
            ))}
          </div>

          {/* Top User Info Bar */}
          <div style={{
            padding: '4px 14px 12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#ffffff',
            zIndex: 30
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img 
                src={activeStoryGroup[activeStoryIndex]?.userAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                alt="User" 
                style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #ffffff' }}
              />
              <div>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>
                  {activeStoryGroup[activeStoryIndex]?.userId === currentUser?.id
                    ? 'My Status'
                    : getAuthorName(
                        activeStoryGroup[activeStoryIndex]?.userId,
                        activeStoryGroup[activeStoryIndex]?.userName,
                        activeStoryGroup[activeStoryIndex]?.userPhone
                      )}
                </h4>
                <span style={{ fontSize: '11px', opacity: 0.75 }}>
                  {formatChatTimestamp(activeStoryGroup[activeStoryIndex]?.createdAt || activeStoryGroup[activeStoryIndex]?.timestamp || 'Recent')}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeStoryGroup[activeStoryIndex]?.userId === currentUser?.id && (
                <button
                  onClick={() => {
                    const stId = activeStoryGroup[activeStoryIndex]?.id;
                    if (stId) {
                      fetch(`/api/status/${stId}`, { method: 'DELETE' });
                      setActiveStoryGroup(null);
                    }
                  }}
                  className="glass-btn"
                  style={{ width: '34px', height: '34px', color: '#ffffff', backgroundColor: 'rgba(239, 68, 68, 0.3)' }}
                  title="Delete Story"
                >
                  <Trash2 size={16} />
                </button>
              )}

              <button 
                onClick={() => setActiveStoryGroup(null)}
                className="glass-btn"
                style={{ width: '34px', height: '34px', color: '#ffffff', backgroundColor: 'rgba(255, 255, 255, 0.15)' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Story Viewer Center: Tap Left to go prev, Tap Right to go next */}
          <div style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
          }}>
            {/* Left Tap Zone */}
            <div 
              onClick={handlePrevStory}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: '35%',
                zIndex: 20,
                cursor: 'pointer'
              }} 
            />

            {/* Right Tap Zone */}
            <div 
              onClick={handleNextStory}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: '65%',
                zIndex: 20,
                cursor: 'pointer'
              }} 
            />

            {/* Media Presentation */}
            {activeStoryGroup[activeStoryIndex]?.type === 'text' ? (
              <div style={{
                width: '100%',
                height: '100%',
                background: activeStoryGroup[activeStoryIndex]?.backgroundColor || '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '30px'
              }}>
                <p style={{
                  color: '#ffffff',
                  fontSize: '26px',
                  fontWeight: '800',
                  textAlign: 'center',
                  lineHeight: '1.4',
                  margin: 0,
                  wordBreak: 'break-word'
                }}>
                  {activeStoryGroup[activeStoryIndex]?.content}
                </p>
              </div>
            ) : (
              <img 
                src={activeStoryGroup[activeStoryIndex]?.content} 
                alt="Story Media" 
                style={{
                  maxHeight: '100%',
                  maxWidth: '100%',
                  objectFit: 'contain'
                }} 
              />
            )}
          </div>

          {/* Bottom Caption & Views */}
          <div style={{
            padding: '16px 20px',
            paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(16px)',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            zIndex: 30
          }}>
            {activeStoryGroup[activeStoryIndex]?.caption && (
              <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', textAlign: 'center', lineHeight: '1.4' }}>
                {activeStoryGroup[activeStoryIndex]?.caption}
              </p>
            )}

            {activeStoryGroup[activeStoryIndex]?.userId === currentUser?.id && (
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPaused(true);
                  setSelectedStatusForViewers(activeStoryGroup[activeStoryIndex]);
                  setShowViewersModal(true);
                }}
                className="glass-pill glow-active"
                style={{
                  padding: '7px 20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.22)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  border: '1px solid rgba(255, 255, 255, 0.4)',
                  boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)',
                  pointerEvents: 'auto'
                }}
                title="Tap to see who viewed this status"
              >
                <Eye size={16} color="#38bdf8" />
                <span style={{ fontSize: '13px', fontWeight: '800' }}>
                  {activeStoryGroup[activeStoryIndex]?.views?.length || 0} views • Who viewed
                </span>
                <ChevronUp size={15} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* STATUS VIEWERS BOTTOM SHEET (WHO VIEWED YOUR STATUS) */}
      {/* ======================================================= */}
      {showViewersModal && selectedStatusForViewers && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 160,
          backgroundColor: 'rgba(15, 23, 42, 0.72)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center'
        }}>
          <div 
            className="glass-panel" 
            style={{
              width: '100%',
              maxWidth: '480px',
              borderTopLeftRadius: '28px',
              borderTopRightRadius: '28px',
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              padding: '22px 20px',
              boxShadow: '0 -16px 40px rgba(0, 0, 0, 0.35)',
              maxHeight: '75vh',
              display: 'flex',
              flexDirection: 'column',
              animation: 'glassModalEnter 0.25s ease'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(2, 132, 199, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Eye size={19} color="#0284c7" />
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>
                    Viewed by {selectedStatusForViewers.views?.length || 0}
                  </h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    Contacts who viewed this status update
                  </p>
                </div>
              </div>

              <button 
                onClick={() => {
                  setShowViewersModal(false);
                  setIsPaused(false);
                }}
                className="glass-btn"
                style={{ width: '32px', height: '32px', borderRadius: '50%' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Viewer List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(!selectedStatusForViewers.views || selectedStatusForViewers.views.length === 0) ? (
                <div style={{
                  textAlign: 'center',
                  padding: '36px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-secondary)'
                }}>
                  <Eye size={36} color="#94a3b8" />
                  <p style={{ fontSize: '14px', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>No views yet</p>
                  <span style={{ fontSize: '12px' }}>When someone views your status update, they will appear here.</span>
                </div>
              ) : (
                selectedStatusForViewers.views.map((viewer, index) => (
                  <div 
                    key={viewer.userId || index}
                    className="glass-card"
                    style={{
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderRadius: '16px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <img 
                        src={viewer.userAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'} 
                        alt={viewer.userName}
                        style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div>
                        <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>
                          {getAuthorName(viewer.userId, viewer.userName, viewer.userPhone)}
                        </h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginTop: '2px' }}>
                          {viewer.userPhone || 'Registered contact'}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>
                        <Clock size={12} />
                        <span>{viewer.viewedAt ? `Today at ${formatISTTime(viewer.viewedAt)}` : (viewer.timestamp || 'Recently')}</span>
                      </div>
                      <CheckCheck size={15} color="#0284c7" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

