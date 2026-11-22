import React, { useState, useEffect, useRef } from 'react';
import { 
  PhoneOff, Mic, MicOff, Video, VideoOff, 
  Users, UserPlus, Sparkles 
} from 'lucide-react';
import { getLocalUserMedia, stopMediaStream } from '../services/webrtc';

export default function GroupCallModal({ 
  groupSession, 
  onEndCall, 
  currentUser,
  socket 
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(groupSession.isVideo);
  const [callDuration, setCallDuration] = useState(0);
  const [participants, setParticipants] = useState([]);
  
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomId = `call_room_${groupSession.groupId}`;

  // Initialize group call stream and join room over socket
  useEffect(() => {
    let streamInstance = null;

    async function initGroupMedia() {
      try {
        const stream = await getLocalUserMedia(groupSession.isVideo, true);
        streamInstance = stream;
        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Join room over socket
        socket.emit('join-group-call', {
          groupId: groupSession.groupId,
          user: currentUser,
          isVideo: groupSession.isVideo
        });
      } catch (err) {
        console.error('Error starting group media:', err);
      }
    }

    initGroupMedia();

    // Default simulated participants from group members for interactive demo
    const demoMembers = [
      {
        socketId: 'demo_1',
        userId: 'user_1',
        name: 'Sarah Miller',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
        isVideo: groupSession.isVideo,
        isMuted: false
      },
      {
        socketId: 'demo_2',
        userId: 'user_2',
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
        isVideo: groupSession.isVideo,
        isMuted: true
      },
      {
        socketId: 'demo_4',
        userId: 'user_4',
        name: 'David Chen',
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
        isVideo: false,
        isMuted: false
      }
    ];

    setParticipants(demoMembers);

    // Socket event listeners
    const handleExistingParticipants = ({ participants: existing }) => {
      if (existing && existing.length > 0) {
        setParticipants(prev => {
          const ids = new Set(prev.map(p => p.userId));
          const toAdd = existing.filter(p => !ids.has(p.userId) && p.userId !== currentUser.id);
          return [...prev, ...toAdd];
        });
      }
    };

    const handleUserJoined = ({ participant }) => {
      setParticipants(prev => [...prev.filter(p => p.socketId !== participant.socketId), participant]);
    };

    const handleUserLeft = ({ socketId }) => {
      setParticipants(prev => prev.filter(p => p.socketId !== socketId));
    };

    socket.on('group-call-existing-participants', handleExistingParticipants);
    socket.on('group-call-user-joined', handleUserJoined);
    socket.on('group-call-user-left', handleUserLeft);

    return () => {
      socket.emit('leave-group-call', { roomId });
      socket.off('group-call-existing-participants', handleExistingParticipants);
      socket.off('group-call-user-joined', handleUserJoined);
      socket.off('group-call-user-left', handleUserLeft);
      stopMediaStream(streamInstance);
      stopMediaStream(localStreamRef.current);
    };
  }, [groupSession.groupId, groupSession.isVideo, currentUser, socket, roomId]);

  // Duration timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      socket.emit('group-call-toggle-media', {
        roomId,
        isMuted: newMuted,
        isVideoOff: !isVideoEnabled
      });
    }
  };

  const handleToggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !t.enabled);
      const newVideo = !isVideoEnabled;
      setIsVideoEnabled(newVideo);
      socket.emit('group-call-toggle-media', {
        roomId,
        isMuted,
        isVideoOff: !newVideo
      });
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 100,
      backgroundColor: 'rgba(235, 244, 255, 0.92)',
      backdropFilter: 'blur(32px) saturate(190%)',
      WebkitBackdropFilter: 'blur(32px) saturate(190%)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '20px 16px',
      overflow: 'hidden'
    }}>
      {/* Top Glass Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
              {groupSession.groupName}
            </h2>
            <span className="glass-pill" style={{
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: '700',
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Users size={12} /> {participants.length + 1}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            {groupSession.isVideo ? 'Group Video Call' : 'Group Audio Call'}
          </p>
        </div>

        <div className="glass-pill" style={{
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ width: '8px', height: '8px', backgroundColor: '#22c55e', borderRadius: '50%' }} />
          <span style={{ fontSize: '12px', fontWeight: '700' }}>
            {formatDuration(callDuration)}
          </span>
        </div>
      </div>

      {/* Multi-party Participant Grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '12px',
        margin: '16px 0',
        overflowY: 'auto',
        alignContent: 'center'
      }}>
        {/* Local user tile */}
        <div className="glass-panel" style={{
          borderRadius: '20px',
          overflow: 'hidden',
          position: 'relative',
          aspectRatio: '1',
          border: '2px solid rgba(255, 255, 255, 0.85)',
          boxShadow: 'var(--glass-shadow)'
        }}>
          {groupSession.isVideo ? (
            <video 
              ref={localVideoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)'
              }}
            />
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img 
                src={currentUser.avatar} 
                alt="You" 
                style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover' }}
              />
            </div>
          )}

          {/* You badge */}
          <div style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span className="glass-pill" style={{ padding: '2px 8px', fontSize: '11px', fontWeight: '700' }}>
              You {isMuted && '(Muted)'}
            </span>
            {isMuted && (
              <span className="glass-pill" style={{ padding: '4px', backgroundColor: 'rgba(239, 68, 68, 0.4)' }}>
                <MicOff size={11} color="#ffffff" />
              </span>
            )}
          </div>
        </div>

        {/* Other participants */}
        {participants.map((p, idx) => (
          <div key={p.socketId || idx} className="glass-panel" style={{
            borderRadius: '20px',
            overflow: 'hidden',
            position: 'relative',
            aspectRatio: '1',
            border: idx === 0 ? '2px solid rgba(56, 189, 248, 0.8)' : '2px solid rgba(255, 255, 255, 0.75)',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(240, 249, 255, 0.4) 100%)'
          }}>
            <img 
              src={p.avatar} 
              alt={p.name}
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid rgba(255, 255, 255, 0.9)'
              }}
            />

            {/* Bottom info tag */}
            <div style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              right: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span className="glass-pill" style={{
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: '600',
                maxWidth: '80px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {p.name}
              </span>
              {p.isMuted && (
                <span className="glass-pill" style={{ padding: '3px', backgroundColor: 'rgba(239, 68, 68, 0.4)' }}>
                  <MicOff size={10} color="#ffffff" />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Frosted Glass Action Controls */}
      <div style={{ display: 'flex', justifyContent: 'center', zIndex: 10 }}>
        <div className="glass-panel" style={{
          borderRadius: '32px',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          border: '1px solid rgba(255, 255, 255, 0.85)',
          boxShadow: 'var(--glass-shadow-lg)'
        }}>
          {/* Mute */}
          <button 
            onClick={handleToggleMute}
            className="glass-btn"
            style={{
              width: '50px',
              height: '50px',
              backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.65)'
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff size={20} color="#ef4444" /> : <Mic size={20} color="var(--text-primary)" />}
          </button>

          {/* Toggle Video */}
          {groupSession.isVideo && (
            <button 
              onClick={handleToggleVideo}
              className="glass-btn"
              style={{
                width: '50px',
                height: '50px',
                backgroundColor: !isVideoEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.65)'
              }}
              title={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {isVideoEnabled ? <Video size={20} color="var(--text-primary)" /> : <VideoOff size={20} color="#ef4444" />}
            </button>
          )}

          {/* Leave Call Button */}
          <button 
            onClick={() => {
              stopMediaStream(localStreamRef.current);
              onEndCall();
            }}
            className="glass-btn glass-btn-danger"
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '28px'
            }}
            title="Leave Group Call"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

