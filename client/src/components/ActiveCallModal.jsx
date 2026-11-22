import React, { useState, useEffect, useRef } from 'react';
import { 
  PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, Volume1 
} from 'lucide-react';
import { ICE_SERVERS, getLocalUserMedia, stopMediaStream } from '../services/webrtc';
import { socket as globalSocket } from '../services/socket';

export default function ActiveCallModal({ 
  callSession, 
  onEndCall, 
  currentUser,
  socket = globalSocket
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(Boolean(callSession.isVideo));
  const [isSpeakerOn, setIsSpeakerOn] = useState(true); // Default to Loudspeaker for both audio & video calls
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState(callSession.isInitiator ? 'Ringing...' : 'Connecting...');
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteAudioVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pcRef = useRef(null);
  const audioCtxRef = useRef(null);

  const sessionRef = useRef(callSession);
  const currentUserRef = useRef(currentUser);
  const onEndCallRef = useRef(onEndCall);
  onEndCallRef.current = onEndCall;

  const isVideo = Boolean(callSession.isVideo);

  // Initialize WebRTC PeerConnection & Media Streams ONCE on modal mount
  useEffect(() => {
    let isMounted = true;
    let remoteDescriptionSet = false;
    const candidateQueue = [];
    const session = sessionRef.current;
    const user = currentUserRef.current;

    console.log(`[WebRTC] Initializing ${isVideo ? 'video' : 'audio'} call with ${session.targetName} (initiator: ${session.isInitiator})`);

    // Pre-unlock Web Audio API immediately on user action
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        audioCtxRef.current = ctx;
      }
    } catch (e) {
      console.warn('[WebRTC] AudioContext init notice:', e);
    }

    // Route audio via native Android audio manager (Loudspeaker default for both audio & video so sound is heard clearly)
    try {
      if (window.AndroidAudio) {
        window.AndroidAudio.setCallMode(true);
      }
    } catch (e) {}

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    // Helper to drain queued ICE candidates once remote description is set
    const drainCandidateQueue = async () => {
      while (candidateQueue.length > 0) {
        const cand = candidateQueue.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
          console.log('[WebRTC] Drained queued ICE candidate');
        } catch (e) {
          console.warn('[WebRTC] Failed to add queued ICE candidate:', e);
        }
      }
    };

    // Handle incoming remote media tracks (Audio & Video)
    pc.ontrack = (event) => {
      console.log('[WebRTC] Received remote track:', event.track.kind, event.streams);
      let stream = event.streams && event.streams[0];
      if (!stream) {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        remoteStreamRef.current.addTrack(event.track);
        stream = remoteStreamRef.current;
      } else {
        remoteStreamRef.current = stream;
      }

      // Ensure remote tracks are explicitly unmuted and enabled
      stream.getTracks().forEach(t => {
        t.enabled = true;
      });

      // 1. Direct Web Audio API Hardware Speaker Routing
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContextClass();
          }
          if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {});
          }
          const source = audioCtxRef.current.createMediaStreamSource(stream);
          source.connect(audioCtxRef.current.destination);
          console.log('[WebRTC] Audio successfully wired to Web Audio destination');
        }
      } catch (err) {
        console.warn('[WebRTC] Web Audio routing notice:', err);
      }

      // 2. Video element stream binding
      if (remoteVideoRef.current) {
        if (remoteVideoRef.current.srcObject !== stream) {
          remoteVideoRef.current.srcObject = stream;
        }
        remoteVideoRef.current.play().catch(e => console.log('Remote video autoplay notice:', e));
      }

      // 3. Audio element stream binding
      if (remoteAudioRef.current) {
        if (remoteAudioRef.current.srcObject !== stream) {
          remoteAudioRef.current.srcObject = stream;
        }
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(e => console.log('Remote audio autoplay notice:', e));
      }

      // 4. Secondary hidden video element stream binding for reliable mobile audio pipeline
      if (remoteAudioVideoRef.current) {
        if (remoteAudioVideoRef.current.srcObject !== stream) {
          remoteAudioVideoRef.current.srcObject = stream;
        }
        remoteAudioVideoRef.current.volume = 1.0;
        remoteAudioVideoRef.current.play().catch(e => console.log('Remote audio video autoplay notice:', e));
      }

      if (isMounted) {
        setCallStatus('Connected');
        if (event.track.kind === 'video' || isVideo) {
          setHasRemoteVideo(true);
        }
      }
    };

    // Send local ICE candidates to peer through signaling server
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          to: session.targetId,
          candidate: event.candidate
        });
      }
    };

    // Connection state monitor
    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected' && isMounted) {
        setCallStatus('Connected');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (isMounted) setCallStatus('Disconnected');
      }
    };

    async function initCall() {
      try {
        // 1. Get local user camera/microphone media
        const localStream = await getLocalUserMedia(isVideo, true);
        if (!isMounted) {
          stopMediaStream(localStream);
          return;
        }
        localStreamRef.current = localStream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(e => console.log('Local video play notice:', e));
        }

        // Add local tracks to peer connection - explicitly enable audio
        localStream.getTracks().forEach(track => {
          track.enabled = true;
          pc.addTrack(track, localStream);
          console.log(`[WebRTC] Added local track ${track.kind} (enabled: ${track.enabled})`);
        });

        // 2. Offer / Answer SDP negotiation
        if (session.isInitiator) {
          // Caller creates SDP offer
          setCallStatus('Ringing...');
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideo ? true : false
          });
          await pc.setLocalDescription(offer);

          socket.emit('call-user', {
            userToCall: session.targetId,
            signalData: offer,
            from: user.id,
            fromName: user.name || 'User',
            fromAvatar: user.avatar,
            isVideo
          });
        } else {
          // Callee received offer in session.signal -> creates answer
          setCallStatus('Connecting...');
          if (session.signal) {
            await pc.setRemoteDescription(new RTCSessionDescription(session.signal));
            remoteDescriptionSet = true;
            await drainCandidateQueue();

            const answer = await pc.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: isVideo ? true : false
            });
            await pc.setLocalDescription(answer);

            socket.emit('answer-call', {
              to: session.targetId,
              signal: answer
            });
          }
        }
      } catch (err) {
        console.error('[WebRTC] Call setup error:', err);
        if (isMounted) setCallStatus('Error connecting media');
      }
    }

    initCall();

    // Socket Event Listeners for Call Signaling
    const handleCallAccepted = async (data) => {
      console.log('[WebRTC] Remote user answered call, applying remote SDP answer');
      if (data.signal && pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.signal));
          remoteDescriptionSet = true;
          await drainCandidateQueue();
          if (isMounted) setCallStatus('Connected');
        } catch (e) {
          console.error('[WebRTC] Error setting remote description:', e);
        }
      }
    };

    const handleIceCandidate = async (data) => {
      if (data.candidate && pcRef.current) {
        if (!remoteDescriptionSet) {
          candidateQueue.push(data.candidate);
        } else {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.error('[WebRTC] Error adding ICE candidate:', e);
          }
        }
      }
    };

    const handleCallEnded = () => {
      console.log('[WebRTC] Call ended by remote user');
      if (isMounted) {
        setCallStatus('Call ended');
        setTimeout(() => onEndCallRef.current?.(), 400);
      }
    };

    const handleCallRejected = ({ reason }) => {
      console.log('[WebRTC] Call declined by peer');
      if (isMounted) {
        setCallStatus(`Declined: ${reason || 'User busy'}`);
        setTimeout(() => onEndCallRef.current?.(), 800);
      }
    };

    const handleCallFailed = ({ reason }) => {
      console.log('[WebRTC] Call failed');
      if (isMounted) {
        setCallStatus(reason || 'User offline');
        setTimeout(() => onEndCallRef.current?.(), 1000);
      }
    };

    socket.on('call-accepted', handleCallAccepted);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('call-ended', handleCallEnded);
    socket.on('call-rejected', handleCallRejected);
    socket.on('call-failed', handleCallFailed);

    return () => {
      isMounted = false;
      socket.off('call-accepted', handleCallAccepted);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('call-ended', handleCallEnded);
      socket.off('call-rejected', handleCallRejected);
      socket.off('call-failed', handleCallFailed);

      stopMediaStream(localStreamRef.current);
      stopMediaStream(remoteStreamRef.current);
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

      if (pcRef.current) {
        try { pcRef.current.close(); } catch (e) {}
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
      try {
        if (window.AndroidAudio) {
          window.AndroidAudio.endCallAudio();
        }
      } catch (e) {}
    };
  }, []); // Run ONCE on mount, preventing camera/connection auto cycling on re-render

  // Duration timer
  useEffect(() => {
    let interval = null;
    if (callStatus === 'Connected') {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle Mute
  const handleToggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle Speaker / Earpiece
  const handleToggleSpeaker = () => {
    const nextSpeakerState = !isSpeakerOn;
    setIsSpeakerOn(nextSpeakerState);
    try {
      if (window.AndroidAudio) {
        window.AndroidAudio.setSpeakerphoneOn(nextSpeakerState);
      }
    } catch (e) {}
  };

  // Toggle Video (Camera on/off)
  const handleToggleVideo = () => {
    if (localStreamRef.current) {
      const nextVideoState = !isVideoEnabled;
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = nextVideoState;
      });
      setIsVideoEnabled(nextVideoState);
      // Keep speaker state unchanged: if on loudspeaker, stay on loudspeaker!
      // User can tap the Speaker button anytime if they wish to switch to earpiece
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 140,
      backgroundColor: isVideo ? '#0f172a' : 'rgba(235, 244, 255, 0.94)',
      backdropFilter: 'blur(30px) saturate(180%)',
      WebkitBackdropFilter: 'blur(30px) saturate(180%)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '16px 16px',
      paddingTop: 'max(52px, env(safe-area-inset-top, 52px))',
      paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
      overflow: 'hidden'
    }}>
      {/* Audio element for voice calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Hidden video element for audio calls to guarantee hardware audio decoding pipeline on mobile */}
      <video 
        ref={remoteAudioVideoRef} 
        autoPlay 
        playsInline 
        webkit-playsinline="true"
        style={{ display: 'none', position: 'fixed', pointerEvents: 'none', opacity: 0 }} 
      />

      {/* Top Glass Info Bar */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        zIndex: 30
      }}>
        <div className="glass-pill" style={{
          padding: '6px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.85)',
          boxShadow: 'var(--glass-shadow)'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            backgroundColor: callStatus === 'Connected' ? '#22c55e' : '#f59e0b',
            borderRadius: '50%'
          }} />
          <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
            {callStatus === 'Connected' ? formatDuration(callDuration) : callStatus}
          </span>
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: '800', color: isVideo ? '#ffffff' : 'var(--text-primary)', marginTop: '6px', margin: 0 }}>
          {callSession.targetName}
        </h2>
        <p style={{ fontSize: '12px', color: isVideo ? 'rgba(255, 255, 255, 0.7)' : 'var(--text-secondary)', margin: 0 }}>
          {isVideo ? 'GlassChat HD Video Call' : 'GlassChat Audio Call'}
        </p>
      </div>

      {/* Main Call View Area - Tap anywhere to resume media if paused */}
      <div 
        onClick={() => {
          remoteVideoRef.current?.play().catch(() => {});
          remoteAudioRef.current?.play().catch(() => {});
        }}
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '12px 0',
          minHeight: 0
        }}
      >
        {isVideo ? (
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '24px',
            overflow: 'hidden',
            position: 'relative',
            backgroundColor: '#020617',
            border: '2px solid rgba(255, 255, 255, 0.2)'
          }}>
            {/* Live Remote Peer Video Stream - ALWAYS ACTIVE IN DOM to prevent Android pause/play-icon */}
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              webkit-playsinline="true"
              muted
              onLoadedMetadata={() => remoteVideoRef.current?.play().catch(() => {})}
              onCanPlay={() => remoteVideoRef.current?.play().catch(() => {})}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                backgroundColor: '#000000'
              }}
            />

            {/* Placeholder overlay when waiting for remote video connection */}
            <div style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
              opacity: hasRemoteVideo ? 0 : 1,
              pointerEvents: hasRemoteVideo ? 'none' : 'auto',
              transition: 'opacity 0.4s ease'
            }}>
              <img 
                src={callSession.targetAvatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'} 
                alt={callSession.targetName}
                style={{
                  width: '110px',
                  height: '110px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid rgba(255, 255, 255, 0.85)',
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)'
                }}
              />
              <span className="glass-pill" style={{ padding: '6px 16px', fontSize: '13px', fontWeight: '600', color: '#ffffff', backgroundColor: 'rgba(255, 255, 255, 0.15)' }}>
                {callStatus}
              </span>
            </div>

            {/* Local Camera Floating PiP (Selfie Preview) */}
            <div className="glass-panel" style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              width: '95px',
              height: '135px',
              borderRadius: '16px',
              overflow: 'hidden',
              border: '2px solid rgba(255, 255, 255, 0.9)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              zIndex: 30
            }}>
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)' // Mirror selfie view
                }}
              />
              {!isVideoEnabled && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff'
                }}>
                  <VideoOff size={18} />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Audio Call Visualizer */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px'
          }}>
            <div className="glow-active" style={{
              position: 'relative',
              borderRadius: '50%',
              padding: '8px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.4) 0%, rgba(192, 132, 252, 0.4) 100%)'
            }}>
              <img 
                src={callSession.targetAvatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'} 
                alt={callSession.targetName}
                style={{
                  width: '130px',
                  height: '130px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '4px solid rgba(255, 255, 255, 0.95)',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.12)'
                }}
              />
            </div>

            <span className="glass-pill" style={{
              padding: '6px 20px',
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--text-secondary)'
            }}>
              GlassChat HD Voice
            </span>
          </div>
        )}
      </div>

      {/* Floating Action Controls */}
      <div style={{ display: 'flex', justifyContent: 'center', zIndex: 30 }}>
        <div className="glass-panel" style={{
          borderRadius: '32px',
          padding: '10px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          border: '1px solid rgba(255, 255, 255, 0.85)',
          backgroundColor: 'rgba(255, 255, 255, 0.85)',
          boxShadow: 'var(--glass-shadow-lg)'
        }}>
          {/* Mute toggle */}
          <button 
            onClick={handleToggleMute}
            className="glass-btn"
            style={{
              width: '46px',
              height: '46px',
              backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.75)'
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff size={19} color="#ef4444" /> : <Mic size={19} color="var(--text-primary)" />}
          </button>

          {/* Speakerphone / Earpiece Toggle Button */}
          <button 
            onClick={handleToggleSpeaker}
            className="glass-btn"
            style={{
              width: '46px',
              height: '46px',
              backgroundColor: isSpeakerOn ? '#0284c7' : 'rgba(255, 255, 255, 0.75)',
              borderColor: isSpeakerOn ? '#0284c7' : 'var(--glass-border)',
              boxShadow: isSpeakerOn ? '0 4px 14px rgba(2, 132, 199, 0.45)' : 'none',
              transition: 'all 0.2s ease'
            }}
            title={isSpeakerOn ? 'Speaker ON (Loudspeaker)' : 'Speaker OFF (Normal Earpiece mode)'}
          >
            {isSpeakerOn ? <Volume2 size={20} color="#ffffff" /> : <Volume1 size={20} color="var(--text-primary)" />}
          </button>

          {/* Toggle Video */}
          {isVideo && (
            <button 
              onClick={handleToggleVideo}
              className="glass-btn"
              style={{
                width: '46px',
                height: '46px',
                backgroundColor: !isVideoEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.75)'
              }}
              title={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {isVideoEnabled ? <Video size={19} color="var(--text-primary)" /> : <VideoOff size={19} color="#ef4444" />}
            </button>
          )}

          {/* End Call Button */}
          <button 
            onClick={() => {
              socket.emit('end-call', { to: callSession.targetId });
              stopMediaStream(localStreamRef.current);
              stopMediaStream(remoteStreamRef.current);
              if (pcRef.current) pcRef.current.close();
              onEndCall();
            }}
            className="glass-btn glass-btn-danger"
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '26px'
            }}
            title="End Call"
          >
            <PhoneOff size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
