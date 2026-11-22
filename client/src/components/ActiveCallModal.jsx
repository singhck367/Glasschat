import React, { useState, useEffect, useRef } from 'react';
import { 
  PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, Volume1,
  SwitchCamera, ScreenShare, UserPlus, ArrowLeftRight, X, Search, Check, Sparkles,
  ChevronDown, Wifi
} from 'lucide-react';
import { ICE_SERVERS, getLocalUserMedia, switchCameraStream, getDisplayMediaStream, stopMediaStream } from '../services/webrtc';
import { socket as globalSocket } from '../services/socket';
import { 
  startOutgoingRingbackTone, stopCallAudio, playCallEndedTone, triggerHaptic 
} from '../services/callAudio';

export default function ActiveCallModal({ 
  callSession, 
  onEndCall, 
  currentUser,
  socket = globalSocket,
  contacts = []
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(Boolean(callSession.isVideo));
  const [isSpeakerOn, setIsSpeakerOn] = useState(true); // Default to Loudspeaker for both audio & video calls
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState(callSession.isInitiator ? 'Ringing...' : 'Connecting...');
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  // Advance features state
  const [facingMode, setFacingMode] = useState('user'); // 'user' | 'environment'
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSwappedView, setIsSwappedView] = useState(false); // false: Remote main, Local PiP | true: Local main, Remote PiP
  const [isMinimized, setIsMinimized] = useState(false); // Floating bubble when browsing app during active call
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [invitedUsers, setInvitedUsers] = useState(new Set());
  const [toastMessage, setToastMessage] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pcRef = useRef(null);
  const cameraVideoTrackRef = useRef(null);

  const sessionRef = useRef(callSession);
  const currentUserRef = useRef(currentUser);
  const onEndCallRef = useRef(onEndCall);
  onEndCallRef.current = onEndCall;

  const isVideo = Boolean(callSession.isVideo);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Initialize WebRTC PeerConnection & Media Streams ONCE on modal mount
  useEffect(() => {
    let isMounted = true;
    let remoteDescriptionSet = false;
    const candidateQueue = [];
    const session = sessionRef.current;
    const user = currentUserRef.current;

    console.log(`[WebRTC] Initializing ${isVideo ? 'video' : 'audio'} call with ${session.targetName} (initiator: ${session.isInitiator})`);

    // Route audio via native Android audio manager if inside Capacitor / WebView
    try {
      if (window.AndroidAudio) {
        window.AndroidAudio.setCallMode(true);
      }
    } catch (e) {}

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    // Drain queued ICE candidates once remote description is set
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

      // 1. Video element stream binding (Muted to eliminate duplicate echo)
      if (remoteVideoRef.current) {
        if (remoteVideoRef.current.srcObject !== stream) {
          remoteVideoRef.current.srcObject = stream;
        }
        remoteVideoRef.current.play().catch(e => console.log('Remote video autoplay notice:', e));
      }

      // 2. Dedicated Audio element stream binding (Single source = zero echo/reverb)
      if (remoteAudioRef.current) {
        if (remoteAudioRef.current.srcObject !== stream) {
          remoteAudioRef.current.srcObject = stream;
        }
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(e => console.log('Remote audio autoplay notice:', e));
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
        // 1. Get local user camera/microphone media with echo-cancellation
        const localStream = await getLocalUserMedia(isVideo, true, 'user');
        if (!isMounted) {
          stopMediaStream(localStream);
          return;
        }
        localStreamRef.current = localStream;
        cameraVideoTrackRef.current = localStream.getVideoTracks()[0];

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(e => console.log('Local video play notice:', e));
        }

        // Add local tracks to peer connection
        localStream.getTracks().forEach(track => {
          track.enabled = true;
          pc.addTrack(track, localStream);
          console.log(`[WebRTC] Added local track ${track.kind} (enabled: ${track.enabled})`);
        });

        // 2. Offer / Answer SDP negotiation
        if (session.isInitiator) {
          setCallStatus('Ringing...');
          startOutgoingRingbackTone();
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
        stopCallAudio();
        if (isMounted) setCallStatus('Error connecting media');
      }
    }

    initCall();

    // Socket Event Listeners for Call Signaling
    const handleCallAccepted = async (data) => {
      console.log('[WebRTC] Remote user answered call, applying remote SDP answer');
      stopCallAudio();
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
      stopCallAudio();
      playCallEndedTone();
      if (isMounted) {
        setCallStatus('Call ended');
        setTimeout(() => onEndCallRef.current?.(), 400);
      }
    };

    const handleCallRejected = ({ reason }) => {
      console.log('[WebRTC] Call declined by peer');
      stopCallAudio();
      playCallEndedTone();
      if (isMounted) {
        setCallStatus(`Declined: ${reason || 'User busy'}`);
        setTimeout(() => onEndCallRef.current?.(), 800);
      }
    };

    const handleCallFailed = ({ reason }) => {
      console.log('[WebRTC] Call failed');
      stopCallAudio();
      playCallEndedTone();
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
      try {
        if (window.AndroidAudio) {
          window.AndroidAudio.endCallAudio();
        }
      } catch (e) {}
    };
  }, []);

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
    }
  };

  // 1. CAMERA FLIP (Front <-> Back Camera)
  const handleFlipCamera = async () => {
    if (!isVideo || isScreenSharing || isFlippingCamera) return;
    setIsFlippingCamera(true);
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';

    try {
      const newVideoTrack = await switchCameraStream(localStreamRef.current, nextFacing);
      setFacingMode(nextFacing);
      cameraVideoTrackRef.current = newVideoTrack;

      if (localStreamRef.current) {
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
        }
        localStreamRef.current.addTrack(newVideoTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }

      // Replace video track in RTCPeerConnection sender
      if (pcRef.current) {
        const videoSender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          console.log('[WebRTC] Swapped video sender track to:', nextFacing);
        }
      }

      showToast(nextFacing === 'environment' ? '📷 Back Camera Active' : '🤳 Front Camera Active');
    } catch (err) {
      console.error('[WebRTC] Camera flip error:', err);
      showToast('Camera switch not available on this device');
    } finally {
      setIsFlippingCamera(false);
    }
  };

  // 2. SCREEN SHARING / SCREEN CAST
  const handleToggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await getDisplayMediaStream();
        const screenTrack = screenStream.getVideoTracks()[0];

        // Store original camera track
        cameraVideoTrackRef.current = localStreamRef.current?.getVideoTracks()[0] || null;

        if (localStreamRef.current) {
          if (cameraVideoTrackRef.current) {
            localStreamRef.current.removeTrack(cameraVideoTrackRef.current);
          }
          localStreamRef.current.addTrack(screenTrack);
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }

        // Replace track on WebRTC peer connection
        if (pcRef.current) {
          const videoSender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          }
        }

        setIsScreenSharing(true);
        showToast('🖥️ Screen Sharing Started');

        // Automatically restore camera when screen share is ended via native OS UI
        screenTrack.onended = () => {
          handleStopScreenShare();
        };
      } catch (err) {
        console.warn('Screen share canceled or not permitted:', err);
      }
    } else {
      await handleStopScreenShare();
    }
  };

  const handleStopScreenShare = async () => {
    try {
      // Re-fetch or restore camera track
      let cameraTrack = cameraVideoTrackRef.current;
      if (!cameraTrack || cameraTrack.readyState === 'ended') {
        const newCameraStream = await getLocalUserMedia(true, false, facingMode);
        cameraTrack = newCameraStream.getVideoTracks()[0];
        cameraVideoTrackRef.current = cameraTrack;
      }

      if (localStreamRef.current) {
        const activeTracks = localStreamRef.current.getVideoTracks();
        activeTracks.forEach(t => {
          t.stop();
          localStreamRef.current.removeTrack(t);
        });
        localStreamRef.current.addTrack(cameraTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }

      if (pcRef.current) {
        const videoSender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
        }
      }

      setIsScreenSharing(false);
      showToast('📷 Returned to Camera');
    } catch (err) {
      console.error('Error stopping screen share:', err);
      setIsScreenSharing(false);
    }
  };

  // 3. IN-CALL PARTICIPANT INVITATION
  const handleInviteUser = (contact) => {
    if (invitedUsers.has(contact.id)) return;

    socket.emit('invite-to-call', {
      targetUserId: contact.id,
      fromUser: currentUser,
      isVideo,
      currentParticipants: [currentUser.id, callSession.targetId]
    });

    setInvitedUsers(prev => new Set([...prev, contact.id]));
    showToast(`📞 Invitation sent to ${contact.name}!`);
  };

  // Filter contacts for in-call invitation
  const filteredContacts = contacts.filter(c => {
    if (c.id === currentUser?.id || c.id === callSession.targetId) return false;
    if (!addSearchQuery) return true;
    const q = addSearchQuery.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
  });

  return (
    <>
      {/* Floating Minimized Call Pill (Allows multitasking and chatting while in call) */}
      {isMinimized && (
        <div 
          onClick={() => {
            triggerHaptic(15);
            setIsMinimized(false);
          }}
          className="glass-panel glow-active"
          style={{
            position: 'fixed',
            top: 'max(16px, env(safe-area-inset-top, 16px))',
            right: '16px',
            zIndex: 9999,
            padding: '8px 16px',
            borderRadius: '26px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#ffffff',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            animation: 'glassModalEnter 0.25s ease'
          }}
        >
          <span style={{
            width: '9px',
            height: '9px',
            borderRadius: '50%',
            backgroundColor: '#22c55e',
            boxShadow: '0 0 8px #22c55e'
          }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: '800' }}>{callSession.targetName}</span>
            <span style={{ fontSize: '10px', color: '#38bdf8' }}>{formatDuration(callDuration)} • Tap to return</span>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic(40);
              playCallEndedTone();
              stopCallAudio();
              socket.emit('end-call', { to: callSession.targetId });
              stopMediaStream(localStreamRef.current);
              stopMediaStream(remoteStreamRef.current);
              if (pcRef.current) pcRef.current.close();
              onEndCall();
            }}
            className="glass-btn glass-btn-danger"
            style={{ width: '32px', height: '32px', borderRadius: '50%', marginLeft: '6px' }}
            title="End Call"
          >
            <PhoneOff size={14} />
          </button>
        </div>
      )}

      {/* Main Call View Container (hidden when minimized, keeping audio/video streams alive) */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 140,
        backgroundColor: isVideo ? '#020617' : 'rgba(235, 244, 255, 0.96)',
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        display: isMinimized ? 'none' : 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden'
      }}>
        {/* Dedicated audio element for remote stream (Single output = 100% echo & reverb free) */}
        <audio ref={remoteAudioRef} autoPlay playsInline />

        {/* Toast Feedback Notification */}
        {toastMessage && (
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            padding: '8px 18px',
            borderRadius: '20px',
            backgroundColor: 'rgba(15, 23, 42, 0.88)',
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: '700',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none'
          }}>
            <Sparkles size={14} color="#38bdf8" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Top Floating Glass Info Bar with Minimize Button & HD Indicator */}
        <div style={{
          position: 'absolute',
          top: 'max(20px, env(safe-area-inset-top, 20px))',
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          zIndex: 35,
          pointerEvents: 'none'
        }}>
          {/* Top-Left Minimize Button */}
          <button 
            onClick={() => {
              triggerHaptic(15);
              setIsMinimized(true);
            }}
            className="glass-btn"
            style={{
              position: 'absolute',
              left: '20px',
              top: '2px',
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: isVideo ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto'
            }}
            title="Minimize Call to browse chats"
          >
            <ChevronDown size={22} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />
          </button>

          {/* Top-Right HD Quality Badge */}
          <div style={{
            position: 'absolute',
            right: '20px',
            top: '4px',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'auto'
          }}>
            <span className="glass-pill" style={{
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: '700',
              color: '#10b981',
              backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.9)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}>
              <Wifi size={12} /> HD
            </span>
          </div>

          <div className="glass-pill" style={{
            padding: '6px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.88)',
            border: isVideo ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.08)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
            pointerEvents: 'auto'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              backgroundColor: callStatus === 'Connected' ? '#22c55e' : '#f59e0b',
              borderRadius: '50%',
              boxShadow: callStatus === 'Connected' ? '0 0 8px #22c55e' : 'none'
            }} />
            <span style={{ fontSize: '13px', fontWeight: '800', color: isVideo ? '#ffffff' : 'var(--text-primary)' }}>
              {callStatus === 'Connected' ? formatDuration(callDuration) : callStatus}
            </span>
            {isScreenSharing && (
              <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: '700', marginLeft: '4px' }}>
                • 🖥️ Screen
              </span>
            )}
          </div>

          <h2 style={{
            fontSize: '18px',
            fontWeight: '800',
            color: isVideo ? '#ffffff' : 'var(--text-primary)',
            marginTop: '4px',
            margin: 0,
            textShadow: isVideo ? '0 2px 8px rgba(0,0,0,0.6)' : 'none'
          }}>
            {callSession.targetName}
          </h2>
          <p style={{
            fontSize: '11px',
            color: isVideo ? 'rgba(255, 255, 255, 0.8)' : 'var(--text-secondary)',
            margin: 0,
            textShadow: isVideo ? '0 1px 4px rgba(0,0,0,0.6)' : 'none'
          }}>
            {isVideo ? 'GlassChat HD Video' : 'GlassChat HD Voice'}
          </p>
        </div>

      {/* ======================================================= */}
      {/* MAIN VIEW AREA: TRUE EDGE-TO-EDGE FULLSCREEN VIDEO */}
      {/* ======================================================= */}
      <div style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 10,
        backgroundColor: isVideo ? '#020617' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}>
        {isVideo ? (
          <>
            {/* 1. MAIN FULLSCREEN VIDEO VIEW */}
            {/* If !isSwappedView: Main is Remote Video. If isSwappedView: Main is Local Video */}
            <div style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              backgroundColor: '#000000',
              overflow: 'hidden'
            }}>
              {/* Remote Video Stream (Main when !isSwappedView) */}
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                webkit-playsinline="true"
                muted={true}
                onLoadedMetadata={() => remoteVideoRef.current?.play().catch(() => {})}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: isSwappedView ? 'none' : 'block',
                  backgroundColor: '#000000'
                }}
              />

              {/* Local Video Stream (Main when isSwappedView) */}
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted={true}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: isSwappedView ? 'block' : 'none',
                  transform: (!isScreenSharing && facingMode === 'user') ? 'scaleX(-1)' : 'none',
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
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%)',
                opacity: hasRemoteVideo ? 0 : 1,
                pointerEvents: hasRemoteVideo ? 'none' : 'auto',
                transition: 'opacity 0.4s ease'
              }}>
                <img 
                  src={callSession.targetAvatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'} 
                  alt={callSession.targetName}
                  style={{
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '4px solid rgba(255, 255, 255, 0.85)',
                    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)'
                  }}
                />
                <span className="glass-pill" style={{ padding: '6px 18px', fontSize: '13px', fontWeight: '700', color: '#ffffff', backgroundColor: 'rgba(255, 255, 255, 0.15)' }}>
                  {callStatus}
                </span>
              </div>
            </div>

            {/* 2. FLOATING PIP (TAP-TO-SWAP VIEWS) */}
            {/* If !isSwappedView: PiP shows Local (Selfie). If isSwappedView: PiP shows Remote */}
            <div 
              onClick={() => setIsSwappedView(!isSwappedView)}
              className="glass-panel" 
              title="Tap to switch fullscreen view"
              style={{
                position: 'absolute',
                top: 'max(80px, env(safe-area-inset-top, 80px))',
                right: '16px',
                width: '105px',
                height: '155px',
                borderRadius: '20px',
                overflow: 'hidden',
                border: '2px solid rgba(255, 255, 255, 0.85)',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
                zIndex: 25,
                cursor: 'pointer',
                backgroundColor: '#020617',
                transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
              {/* Remote in PiP if isSwappedView */}
              {isSwappedView ? (
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <img
                    src={callSession.targetAvatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'}
                    alt="Peer"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '6px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.65)',
                    color: '#ffffff',
                    fontSize: '9px',
                    fontWeight: '800',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <ArrowLeftRight size={10} />
                    <span>{callSession.targetName?.split(' ')[0] || 'Caller'}</span>
                  </div>
                </div>
              ) : (
                /* Local in PiP if !isSwappedView */
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <img
                    src={currentUser?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}
                    alt="You"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: isVideoEnabled ? 0.3 : 1
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '6px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.65)',
                    color: '#ffffff',
                    fontSize: '9px',
                    fontWeight: '800',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <ArrowLeftRight size={10} />
                    <span>You (Tap to swap)</span>
                  </div>

                  {!isVideoEnabled && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: 'rgba(15, 23, 42, 0.92)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff'
                    }}>
                      <VideoOff size={20} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Pure Audio Call Avatar Visualizer */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px'
          }}>
            <div className="glow-active" style={{
              position: 'relative',
              borderRadius: '50%',
              padding: '10px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.5) 0%, rgba(192, 132, 252, 0.5) 100%)'
            }}>
              <img 
                src={callSession.targetAvatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'} 
                alt={callSession.targetName}
                style={{
                  width: '140px',
                  height: '140px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '4px solid rgba(255, 255, 255, 0.95)',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.15)'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <span className="glass-pill" style={{
                padding: '6px 20px',
                fontSize: '13px',
                fontWeight: '700',
                color: '#0284c7',
                backgroundColor: 'rgba(255, 255, 255, 0.9)'
              }}>
                GlassChat HD Voice • Studio Quality
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Echo & Noise Cancellation Active
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================= */}
      {/* FLOATING ACTION CONTROL BAR (GLASS DOCK) */}
      {/* ======================================================= */}
      <div style={{
        position: 'absolute',
        bottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 35,
        padding: '0 16px'
      }}>
        <div className="glass-panel" style={{
          borderRadius: '36px',
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          border: isVideo ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgba(255, 255, 255, 0.9)',
          backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.9)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.35)',
          maxWidth: '100%',
          overflowX: 'auto'
        }}>
          {/* 1. Mute toggle */}
          <button 
            onClick={handleToggleMute}
            className="glass-btn"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '22px',
              backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.15)',
              borderColor: isMuted ? '#ef4444' : 'transparent'
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff size={19} color="#ef4444" /> : <Mic size={19} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />}
          </button>

          {/* 2. Speakerphone / Earpiece Toggle */}
          <button 
            onClick={handleToggleSpeaker}
            className="glass-btn"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '22px',
              backgroundColor: isSpeakerOn ? '#0284c7' : 'rgba(255, 255, 255, 0.15)',
              borderColor: isSpeakerOn ? '#0284c7' : 'transparent',
              boxShadow: isSpeakerOn ? '0 4px 14px rgba(2, 132, 199, 0.45)' : 'none'
            }}
            title={isSpeakerOn ? 'Speaker ON (Loudspeaker)' : 'Speaker OFF (Earpiece mode)'}
          >
            {isSpeakerOn ? <Volume2 size={19} color="#ffffff" /> : <Volume1 size={19} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />}
          </button>

          {/* 3. Toggle Video Camera */}
          {isVideo && (
            <button 
              onClick={handleToggleVideo}
              className="glass-btn"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '22px',
                backgroundColor: !isVideoEnabled ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.15)',
                borderColor: !isVideoEnabled ? '#ef4444' : 'transparent'
              }}
              title={isVideoEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
            >
              {isVideoEnabled ? <Video size={19} color="#ffffff" /> : <VideoOff size={19} color="#ef4444" />}
            </button>
          )}

          {/* 4. Flip Camera (Front <-> Back) */}
          {isVideo && (
            <button 
              onClick={handleFlipCamera}
              disabled={isFlippingCamera || isScreenSharing}
              className="glass-btn"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '22px',
                backgroundColor: facingMode === 'environment' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.15)',
                borderColor: facingMode === 'environment' ? '#8b5cf6' : 'transparent',
                boxShadow: facingMode === 'environment' ? '0 4px 14px rgba(139, 92, 246, 0.45)' : 'none',
                opacity: isScreenSharing ? 0.4 : 1
              }}
              title={`Switch to ${facingMode === 'user' ? 'Back' : 'Front'} Camera`}
            >
              <SwitchCamera size={19} color="#ffffff" />
            </button>
          )}

          {/* 5. Screen Cast / Screen Share */}
          {isVideo && (
            <button 
              onClick={handleToggleScreenShare}
              className="glass-btn"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '22px',
                backgroundColor: isScreenSharing ? '#10b981' : 'rgba(255, 255, 255, 0.15)',
                borderColor: isScreenSharing ? '#10b981' : 'transparent',
                boxShadow: isScreenSharing ? '0 4px 14px rgba(16, 185, 129, 0.45)' : 'none'
              }}
              title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Device Screen'}
            >
              <ScreenShare size={19} color="#ffffff" />
            </button>
          )}

          {/* 6. Add Participant (+ Invite User) */}
          <button 
            onClick={() => setShowAddUserModal(true)}
            className="glass-btn"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '22px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)'
            }}
            title="Invite another person to this call"
          >
            <UserPlus size={19} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />
          </button>

          {/* 7. Swap Views Button (also tapped on PiP) */}
          {isVideo && (
            <button 
              onClick={() => setIsSwappedView(!isSwappedView)}
              className="glass-btn"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '22px',
                backgroundColor: isSwappedView ? '#f59e0b' : 'rgba(255, 255, 255, 0.15)',
                borderColor: isSwappedView ? '#f59e0b' : 'transparent'
              }}
              title="Swap main & floating video"
            >
              <ArrowLeftRight size={18} color="#ffffff" />
            </button>
          )}

          {/* 8. End Call Button */}
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
              width: '48px',
              height: '48px',
              borderRadius: '24px',
              marginLeft: '4px'
            }}
            title="End Call"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>

      {/* ======================================================= */}
      {/* IN-CALL ADD PARTICIPANTS MODAL SHEET */}
      {/* ======================================================= */}
      {showAddUserModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 150,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
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
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              padding: '22px 20px',
              boxShadow: '0 -16px 40px rgba(0, 0, 0, 0.3)',
              maxHeight: '75vh',
              display: 'flex',
              flexDirection: 'column',
              animation: 'glassModalEnter 0.25s ease'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>
                  Add People to Call
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                  Invite registered contacts to join this active call
                </p>
              </div>
              <button 
                onClick={() => setShowAddUserModal(false)}
                className="glass-btn"
                style={{ width: '32px', height: '32px', borderRadius: '50%' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Search Input */}
            <div className="glass-search" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '14px' }}>
              <Search size={16} color="var(--text-secondary)" />
              <input
                type="text"
                placeholder="Search name or phone..."
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '13px' }}
              />
            </div>

            {/* Contact List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredContacts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No other contacts found to invite.
                </div>
              ) : (
                filteredContacts.map(contact => {
                  const isInvited = invitedUsers.has(contact.id);
                  return (
                    <div 
                      key={contact.id} 
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
                        <div style={{ position: 'relative' }}>
                          <img 
                            src={contact.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'} 
                            alt={contact.name}
                            style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover' }}
                          />
                          {contact.online && (
                            <span style={{
                              position: 'absolute',
                              bottom: 0,
                              right: 0,
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: '#22c55e',
                              border: '2px solid #ffffff'
                            }} />
                          )}
                        </div>

                        <div>
                          <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>
                            {contact.name}
                          </h4>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                            {contact.phone || (contact.online ? 'Online' : 'Offline')}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleInviteUser(contact)}
                        disabled={isInvited}
                        className={`glass-btn ${isInvited ? '' : 'glass-btn-primary'}`}
                        style={{
                          height: '34px',
                          padding: '0 14px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '700',
                          backgroundColor: isInvited ? 'rgba(34, 197, 94, 0.15)' : undefined,
                          color: isInvited ? '#16a34a' : undefined
                        }}
                      >
                        {isInvited ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Check size={14} /> Invited
                          </span>
                        ) : (
                          'Invite'
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
