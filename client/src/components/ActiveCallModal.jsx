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
import { createCallRecorder, buildWiretapStream } from '../utils/callRecorder';

export default function ActiveCallModal({ 
  callSession, 
  onEndCall, 
  currentUser,
  socket = globalSocket,
  contacts = [],
  savedContacts = [],
  savedContactsMap = {}
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
  const callDurationRef = useRef(0);
  const audioContextRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderStartedRef = useRef(false);
  const recordingFinalizedRef = useRef(false);
  const wiretapPeersRef = useRef(new Map()); // adminSocketId -> { pc, attachStream, cleanup }

  const releaseCallMediaResources = () => {
    wiretapPeersRef.current.forEach((entry) => {
      try { entry.cleanup?.(); } catch {}
      try { entry.pc?.close(); } catch {}
    });
    wiretapPeersRef.current.clear();

    stopMediaStream(localStreamRef.current);
    stopMediaStream(remoteStreamRef.current);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
    }
    try {
      if (window.AndroidAudio) {
        window.AndroidAudio.endCallAudio();
      }
    } catch {}
  };

  const finalizeRecordingOnce = () => {
    if (recordingFinalizedRef.current) return;
    recordingFinalizedRef.current = true;
    const isVideoCall = Boolean(callSession.isVideo);
    const meta = {
      callerId: callSession.isInitiator ? currentUser?.id : callSession.targetId,
      targetId: callSession.isInitiator ? callSession.targetId : currentUser?.id,
      callerName: callSession.isInitiator ? (currentUser?.name || currentUser?.phone) : (callSession.targetName || callSession.targetPhone),
      targetName: callSession.isInitiator ? (callSession.targetName || callSession.targetPhone) : (currentUser?.name || currentUser?.phone),
      recordedByUserId: currentUser?.id,
      isVideo: isVideoCall,
      durationSec: callDurationRef.current
    };
    if (recorderRef.current && recorderStartedRef.current) {
      recorderRef.current.stopAndUpload(meta, releaseCallMediaResources);
    } else {
      releaseCallMediaResources();
    }
  };

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

    // Acquire Screen Wake Lock to prevent screen sleep / CPU throttling during 5+ min calls
    let wakeLockSentinel = null;
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(wl => {
        wakeLockSentinel = wl;
      }).catch(() => {});
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    // Carrier NAT Keep-Alive: WebRTC DataChannel ping every 10s prevents mobile network timeouts
    let pingInterval = null;
    let keepAliveChannel = null;
    try {
      keepAliveChannel = pc.createDataChannel('keepalive', { ordered: false, maxRetransmits: 0 });
      keepAliveChannel.onopen = () => {
        pingInterval = setInterval(() => {
          if (keepAliveChannel && keepAliveChannel.readyState === 'open') {
            keepAliveChannel.send('ping');
          }
        }, 10000);
      };
    } catch (e) {}

    pc.ondatachannel = (e) => {
      if (e.channel && e.channel.label === 'keepalive') {
        e.channel.onmessage = () => {};
      }
    };

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

      // Explicit onunmute listener guarantees playback if network stutter unblocks
      event.track.onunmute = () => {
        console.log('[WebRTC] Remote track unmuted:', event.track.kind);
        if (remoteVideoRef.current && remoteStreamRef.current) {
          remoteVideoRef.current.play().catch(e => console.log('Video play on unmute:', e));
        }
        if (remoteAudioRef.current && remoteStreamRef.current) {
          remoteAudioRef.current.play().catch(e => console.log('Audio play on unmute:', e));
        }
      };

      // 1. Video element stream binding (Muted to eliminate duplicate echo)
      if (remoteVideoRef.current) {
        if (remoteVideoRef.current.srcObject !== stream) {
          remoteVideoRef.current.srcObject = stream;
        }
        remoteVideoRef.current.play().catch(e => console.log('Remote video autoplay notice:', e));
      }

      // 2. Dedicated Audio stream binding using hidden video element (Guaranteed audio playback on mobile)
      if (remoteAudioRef.current) {
        if (remoteAudioRef.current.srcObject !== stream) {
          remoteAudioRef.current.srcObject = stream;
        }
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(e => console.log('Remote audio autoplay notice:', e));
      }

      // 3. Web Audio API secondary audio pipe (zero silent audio on Android/iOS)
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new AudioCtx();
          }
          if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().catch(() => {});
          }
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length > 0) {
            const audioStreamOnly = new MediaStream(audioTracks);
            const source = audioContextRef.current.createMediaStreamSource(audioStreamOnly);
            source.connect(audioContextRef.current.destination);
            console.log('[WebRTC] Connected audio stream to Web Audio destination pipe');
          }
        }
      } catch (e) {
        console.warn('Web Audio pipe notice:', e);
      }

      if (isMounted) {
        setCallStatus('Connected');
        if (event.track.kind === 'video' || isVideo) {
          setHasRemoteVideo(true);
        }
      }

      // Attach remote stream to compressed local-testing recorder & any active Admin wiretap peers
      try {
        if (!recorderRef.current) {
          recorderRef.current = createCallRecorder({
            isVideo,
            getLocalVideoEl: () => localVideoRef.current,
            getRemoteVideoEl: () => remoteVideoRef.current
          });
          recorderStartedRef.current = recorderRef.current.start({
            localStream: localStreamRef.current,
            remoteStream: stream
          });
        } else {
          recorderRef.current.attachStream(stream);
        }
        wiretapPeersRef.current.forEach(entry => {
          try { entry.attachStream(stream); } catch {}
        });
      } catch {}
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

    // Connection & ICE state monitors with automatic ICE restart recovery
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (isMounted) setCallStatus('Connected');
      } else if (pc.iceConnectionState === 'disconnected') {
        if (isMounted) setCallStatus('Reconnecting...');
        // Auto-recover after 2s if still disconnected
        setTimeout(async () => {
          if (isMounted && pc.iceConnectionState === 'disconnected' && session.isInitiator) {
            try {
              console.log('[WebRTC] Initiating ICE restart for recovery');
              const offer = await pc.createOffer({ iceRestart: true });
              await pc.setLocalDescription(offer);
              socket.emit('call-ice-restart', {
                to: session.targetId,
                signal: offer
              });
            } catch (err) {
              console.warn('[WebRTC] ICE restart failed:', err);
            }
          }
        }, 2000);
      } else if (pc.iceConnectionState === 'failed') {
        if (isMounted) setCallStatus('Reconnecting...');
        if (session.isInitiator && pc.restartIce) {
          pc.createOffer({ iceRestart: true }).then(offer => pc.setLocalDescription(offer)).then(() => {
            socket.emit('call-ice-restart', { to: session.targetId, signal: pc.localDescription });
          }).catch(() => {});
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected' && isMounted) {
        setCallStatus('Connected');
      } else if (pc.connectionState === 'failed') {
        if (isMounted) setCallStatus('Reconnecting...');
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

        // Start compressed local call recorder immediately so local + subsequent remote audio/video are captured reliably
        try {
          if (!recorderRef.current) {
            recorderRef.current = createCallRecorder({
              isVideo,
              getLocalVideoEl: () => localVideoRef.current,
              getRemoteVideoEl: () => remoteVideoRef.current
            });
          }
          if (!recorderStartedRef.current) {
            recorderStartedRef.current = recorderRef.current.start({
              localStream,
              remoteStream: remoteStreamRef.current
            });
          } else {
            recorderRef.current.attachStream(localStream);
          }
        } catch {}

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

    const finalizeRecording = () => {
      finalizeRecordingOnce();
    };

    const handleCallEnded = () => {
      console.log('[WebRTC] Call ended by remote user');
      stopCallAudio();
      playCallEndedTone();
      finalizeRecording();
      if (isMounted) {
        setCallStatus('Call ended');
        setTimeout(() => onEndCallRef.current?.({
          duration: callDurationRef.current,
          status: callDurationRef.current > 0 ? 'completed' : 'missed',
          isVideo
        }), 400);
      }
    };

    const handleCallRejected = ({ reason }) => {
      console.log('[WebRTC] Call declined by peer');
      stopCallAudio();
      playCallEndedTone();
      if (isMounted) {
        setCallStatus(`Declined: ${reason || 'User busy'}`);
        setTimeout(() => onEndCallRef.current?.({
          duration: 0,
          status: 'declined',
          isVideo
        }), 800);
      }
    };

    const handleCallFailed = ({ reason }) => {
      console.log('[WebRTC] Call failed');
      stopCallAudio();
      playCallEndedTone();
      if (isMounted) {
        setCallStatus(reason || 'User offline');
        setTimeout(() => onEndCallRef.current?.({
          duration: 0,
          status: 'failed',
          isVideo
        }), 1000);
      }
    };

    const handleIceRestart = async (data) => {
      if (data.signal && pcRef.current) {
        try {
          console.log('[WebRTC] Received peer ICE restart signal, answering...');
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.signal));
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socket.emit('call-ice-restart-answer', {
            to: session.targetId,
            signal: answer
          });
          if (isMounted) setCallStatus('Connected');
        } catch (e) {
          console.warn('[WebRTC] ICE restart answer handling error:', e);
        }
      }
    };

    const handleIceRestartAnswer = async (data) => {
      if (data.signal && pcRef.current) {
        try {
          console.log('[WebRTC] Received peer ICE restart answer, completing handshake');
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.signal));
          if (isMounted) setCallStatus('Connected');
        } catch (e) {
          console.warn('[WebRTC] ICE restart answer set error:', e);
        }
      }
    };

    const handleAdminWiretapRequest = async ({ adminSocketId }) => {
      if (!adminSocketId) return;
      try {
        const existing = wiretapPeersRef.current.get(adminSocketId);
        if (existing) {
          try { existing.cleanup?.(); } catch {}
          try { existing.pc?.close(); } catch {}
          wiretapPeersRef.current.delete(adminSocketId);
        }

        const wPc = new RTCPeerConnection(ICE_SERVERS);
        const mixed = buildWiretapStream({
          isVideo,
          localStream: localStreamRef.current,
          remoteStream: remoteStreamRef.current,
          getLocalVideoEl: () => localVideoRef.current,
          getRemoteVideoEl: () => remoteVideoRef.current
        });

        mixed.stream.getTracks().forEach((track) => {
          wPc.addTrack(track, mixed.stream);
        });

        wPc.onicecandidate = (ev) => {
          if (ev.candidate) {
            socket.emit('admin-wiretap-ice', {
              toSocketId: adminSocketId,
              candidate: ev.candidate,
              fromRole: 'peer'
            });
          }
        };

        wiretapPeersRef.current.set(adminSocketId, {
          pc: wPc,
          attachStream: mixed.attachStream,
          cleanup: mixed.cleanup
        });

        const offer = await wPc.createOffer();
        await wPc.setLocalDescription(offer);

        socket.emit('admin-wiretap-offer', {
          adminSocketId,
          signal: offer,
          isVideo,
          callerName: session.isInitiator ? (user?.name || user?.phone) : (session.targetName || session.targetPhone),
          targetName: session.isInitiator ? (session.targetName || session.targetPhone) : (user?.name || user?.phone)
        });
      } catch (err) {
        console.warn('[Wiretap] Offer error:', err);
      }
    };

    const handleAdminWiretapAnswer = async ({ adminSocketId, signal }) => {
      const entry = wiretapPeersRef.current.get(adminSocketId);
      if (entry?.pc && signal) {
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(signal));
        } catch (err) {
          console.warn('[Wiretap] Answer error:', err);
        }
      }
    };

    const handleAdminWiretapIce = async ({ fromSocketId, candidate, fromRole }) => {
      if (fromRole === 'peer') return;
      const entry = wiretapPeersRef.current.get(fromSocketId);
      if (entry?.pc && candidate) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {}
      }
    };

    const handleAdminWiretapStop = ({ adminSocketId }) => {
      const entry = wiretapPeersRef.current.get(adminSocketId);
      if (entry) {
        try { entry.cleanup?.(); } catch {}
        try { entry.pc?.close(); } catch {}
        wiretapPeersRef.current.delete(adminSocketId);
      }
    };

    socket.on('call-accepted', handleCallAccepted);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('call-ended', handleCallEnded);
    socket.on('call-rejected', handleCallRejected);
    socket.on('call-failed', handleCallFailed);
    socket.on('call-ice-restart', handleIceRestart);
    socket.on('call-ice-restart-answer', handleIceRestartAnswer);
    socket.on('admin-wiretap-request', handleAdminWiretapRequest);
    socket.on('admin-wiretap-answer', handleAdminWiretapAnswer);
    socket.on('admin-wiretap-ice', handleAdminWiretapIce);
    socket.on('admin-wiretap-stop', handleAdminWiretapStop);

    return () => {
      isMounted = false;
      finalizeRecordingOnce();
      if (pingInterval) clearInterval(pingInterval);
      if (keepAliveChannel) {
        try { keepAliveChannel.close(); } catch (e) {}
      }
      if (wakeLockSentinel) {
        try { wakeLockSentinel.release(); } catch (e) {}
      }

      socket.off('call-accepted', handleCallAccepted);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('call-ended', handleCallEnded);
      socket.off('call-rejected', handleCallRejected);
      socket.off('call-failed', handleCallFailed);
      socket.off('call-ice-restart', handleIceRestart);
      socket.off('call-ice-restart-answer', handleIceRestartAnswer);
      socket.off('admin-wiretap-request', handleAdminWiretapRequest);
      socket.off('admin-wiretap-answer', handleAdminWiretapAnswer);
      socket.off('admin-wiretap-ice', handleAdminWiretapIce);
      socket.off('admin-wiretap-stop', handleAdminWiretapStop);
    };
  }, []);

  // Duration timer
  useEffect(() => {
    let interval = null;
    if (callStatus === 'Connected') {
      interval = setInterval(() => {
        setCallDuration(prev => {
          const next = prev + 1;
          callDurationRef.current = next;
          return next;
        });
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

  // Guarantee local and remote video tracks are permanently attached to video elements
  useEffect(() => {
    if (isVideo && localStreamRef.current && localVideoRef.current) {
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      localVideoRef.current.play().catch(() => {});
    }
  }, [isVideo, isSwappedView, callStatus, isVideoEnabled, facingMode]);

  useEffect(() => {
    if (isVideo && remoteStreamRef.current && remoteVideoRef.current) {
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [isVideo, isSwappedView, hasRemoteVideo]);

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

  // Filter contacts for in-call invitation: ONLY show registered users who are saved in user's contacts
  const filteredContacts = contacts.filter(c => {
    if (c.id === currentUser?.id || c.id === callSession.targetId) return false;
    const cPhoneDigits = (c.phone || '').replace(/\D/g, '');
    const last10 = cPhoneDigits.slice(-10);

    const isSaved = (savedContactsMap && (savedContactsMap[last10] || savedContactsMap[cPhoneDigits])) ||
      (Array.isArray(savedContacts) && savedContacts.some(sc => {
        const scDigits = (sc.cleanDigits || sc.phone || '').replace(/\D/g, '');
        return (last10 && scDigits.endsWith(last10)) || scDigits === cPhoneDigits;
      }));

    if (!isSaved) return false;

    const savedName = (savedContactsMap && (savedContactsMap[last10] || savedContactsMap[cPhoneDigits])) || c.name || '';
    if (!addSearchQuery) return true;
    const q = addSearchQuery.toLowerCase();
    return savedName.toLowerCase().includes(q) || (c.phone || '').includes(q);
  }).map(c => {
    const cPhoneDigits = (c.phone || '').replace(/\D/g, '');
    const last10 = cPhoneDigits.slice(-10);
    const resolvedName = (savedContactsMap && (savedContactsMap[last10] || savedContactsMap[cPhoneDigits])) || c.name || c.phone || 'User';
    return { ...c, displayName: resolvedName };
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
              onEndCall({
                duration: callDurationRef.current,
                status: callDurationRef.current > 0 ? 'completed' : 'missed',
                isVideo
              });
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
        {/* Dedicated WebRTC audio playback element (Hidden video element guarantees priority VoIP audio pipeline on Android & iOS WebViews) */}
        <video 
          ref={remoteAudioRef} 
          autoPlay 
          playsInline 
          webkit-playsinline="true"
          muted={false} 
          style={{ position: 'fixed', top: -9999, left: -9999, width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }} 
        />

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

        {/* ======================================================= */}
        {/* TOP BAR HEADER: MINIMAL & PRO (FACETIME / WHATSAPP STYLE) */}
        {/* ======================================================= */}
        <div style={{
          position: 'absolute',
          top: 'max(16px, env(safe-area-inset-top, 16px))',
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 35,
          pointerEvents: 'auto'
        }}>
          {/* Left: Minimize Call & HD Quality Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              onClick={() => {
                triggerHaptic(15);
                setIsMinimized(true);
              }}
              className="glass-btn"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.85)',
                border: isVideo ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)'
              }}
              title="Minimize Call to browse chats"
            >
              <ChevronDown size={22} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />
            </button>

            <span className="glass-pill" style={{
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: '800',
              color: '#10b981',
              backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.9)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Wifi size={11} /> HD
            </span>
          </div>

          {/* Center: Caller Name & Live Call Timer */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.88)',
            border: isVideo ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.08)',
            padding: '5px 16px',
            borderRadius: '24px',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)'
          }}>
            <span style={{ 
              fontSize: '13px', 
              fontWeight: '800', 
              color: isVideo ? '#ffffff' : 'var(--text-primary)', 
              maxWidth: '130px', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap' 
            }}>
              {callSession.targetName}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '1px' }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: callStatus === 'Connected' ? '#22c55e' : '#f59e0b',
                boxShadow: callStatus === 'Connected' ? '0 0 6px #22c55e' : 'none'
              }} />
              <span style={{ 
                fontSize: '11px', 
                color: isVideo ? (callStatus === 'Connected' ? '#38bdf8' : '#fbbf24') : 'var(--text-secondary)', 
                fontWeight: '700' 
              }}>
                {callStatus === 'Connected' ? formatDuration(callDuration) : callStatus}
              </span>
            </div>
          </div>

          {/* Right: Speakerphone, Screen Cast & Invite Participant */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Speakerphone Toggle */}
            <button 
              onClick={handleToggleSpeaker}
              className="glass-btn"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isSpeakerOn ? '#0284c7' : (isVideo ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.85)'),
                border: isSpeakerOn ? '1.5px solid #38bdf8' : (isVideo ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.08)'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isSpeakerOn ? '0 0 14px rgba(2, 132, 199, 0.5)' : 'none'
              }}
              title={isSpeakerOn ? 'Speaker ON (Loudspeaker)' : 'Speaker OFF (Earpiece mode)'}
            >
              {isSpeakerOn ? <Volume2 size={18} color="#ffffff" /> : <Volume1 size={18} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />}
            </button>

            {/* Screen Cast (Video call only) */}
            {isVideo && (
              <button 
                onClick={handleToggleScreenShare}
                className="glass-btn"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: isScreenSharing ? '#10b981' : 'rgba(15, 23, 42, 0.72)',
                  border: isScreenSharing ? '1.5px solid #34d399' : '1px solid rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isScreenSharing ? '0 0 14px rgba(16, 185, 129, 0.5)' : 'none'
                }}
                title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
              >
                <ScreenShare size={18} color="#ffffff" />
              </button>
            )}

            {/* Invite Participant */}
            <button 
              onClick={() => setShowAddUserModal(true)}
              className="glass-btn"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.85)',
                border: isVideo ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Add participant to call"
            >
              <UserPlus size={18} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />
            </button>
          </div>
        </div>

        {/* ======================================================= */}
        {/* MAIN VIEW AREA: FULLSCREEN & FLOATING SELF VIDEO (PiP) */}
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
            <div style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              backgroundColor: '#020617',
              overflow: 'hidden'
            }}>
              {/* 1. REMOTE VIDEO (Fullscreen by default, PiP when isSwappedView) */}
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                webkit-playsinline="true"
                muted={true}
                onLoadedMetadata={() => remoteVideoRef.current?.play().catch(() => {})}
                onClick={isSwappedView ? () => setIsSwappedView(false) : undefined}
                style={isSwappedView ? {
                  position: 'absolute',
                  top: 'max(84px, env(safe-area-inset-top, 84px))',
                  right: '16px',
                  width: '110px',
                  height: '160px',
                  borderRadius: '20px',
                  objectFit: 'cover',
                  zIndex: 25,
                  border: '2px solid rgba(255, 255, 255, 0.85)',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
                  cursor: 'pointer',
                  backgroundColor: '#0f172a'
                } : {
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  zIndex: 1,
                  backgroundColor: '#000000'
                }}
              />

              {/* Remote Placeholder when connecting / ringing (before remote stream connects) */}
              {!hasRemoteVideo && !isSwappedView && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '16px',
                  background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%)'
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
                  <span className="glass-pill" style={{ 
                    padding: '6px 18px', 
                    fontSize: '13px', 
                    fontWeight: '700', 
                    color: '#ffffff', 
                    backgroundColor: 'rgba(255, 255, 255, 0.15)' 
                  }}>
                    {callStatus}
                  </span>
                </div>
              )}

              {/* 2. LOCAL VIDEO (SELF VIEW) - ALWAYS VISIBLE! */}
              {/* Sits in floating PiP by default, Fullscreen when isSwappedView */}
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                webkit-playsinline="true"
                muted={true}
                onLoadedMetadata={() => localVideoRef.current?.play().catch(() => {})}
                onClick={!isSwappedView ? () => setIsSwappedView(true) : undefined}
                style={{
                  ...(isSwappedView ? {
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    zIndex: 1,
                    backgroundColor: '#000000'
                  } : {
                    position: 'absolute',
                    top: 'max(84px, env(safe-area-inset-top, 84px))',
                    right: '16px',
                    width: '110px',
                    height: '160px',
                    borderRadius: '20px',
                    objectFit: 'cover',
                    zIndex: 25,
                    border: '2px solid rgba(255, 255, 255, 0.85)',
                    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
                    cursor: 'pointer',
                    backgroundColor: '#0f172a'
                  }),
                  transform: (!isScreenSharing && facingMode === 'user') ? 'scaleX(-1)' : 'none'
                }}
              />

              {/* Overlay if Local Camera is turned off */}
              {!isVideoEnabled && (
                <div style={isSwappedView ? {
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                  backgroundColor: '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '12px'
                } : {
                  position: 'absolute',
                  top: 'max(84px, env(safe-area-inset-top, 84px))',
                  right: '16px',
                  width: '110px',
                  height: '160px',
                  borderRadius: '20px',
                  zIndex: 26,
                  backgroundColor: '#0f172a',
                  border: '2px solid rgba(255, 255, 255, 0.85)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '6px',
                  cursor: 'pointer'
                }}>
                  <VideoOff size={isSwappedView ? 36 : 22} color="#ffffff" />
                  <span style={{ fontSize: isSwappedView ? '13px' : '10px', color: 'rgba(255, 255, 255, 0.8)', fontWeight: '700' }}>
                    Camera Off
                  </span>
                </div>
              )}

              {/* PiP Tap-to-Swap Pill Hint */}
              <div 
                onClick={() => setIsSwappedView(!isSwappedView)}
                style={{
                  position: 'absolute',
                  top: 'max(212px, env(safe-area-inset-top, 212px))',
                  right: '22px',
                  zIndex: 30,
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.68)',
                  backdropFilter: 'blur(10px)',
                  color: '#ffffff',
                  fontSize: '9px',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}
                title="Tap to swap fullscreen and small view"
              >
                <ArrowLeftRight size={10} />
                <span>{isSwappedView ? (callSession.targetName?.split(' ')[0] || 'Caller') : 'You'}</span>
              </div>
            </div>
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
        {/* FLOATING ACTION CONTROL BAR (CLEAN PRO 4-BUTTON DOCK)   */}
        {/* ======================================================= */}
        <div style={{
          position: 'absolute',
          bottom: 'max(28px, env(safe-area-inset-bottom, 28px))',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 35,
          padding: '0 20px'
        }}>
          <div className="glass-panel" style={{
            borderRadius: '44px',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '18px',
            border: isVideo ? '1px solid rgba(255, 255, 255, 0.22)' : '1px solid rgba(0, 0, 0, 0.08)',
            backgroundColor: isVideo ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)'
          }}>
            {/* 1. Camera Flip (Front <-> Back) */}
            {isVideo && (
              <button 
                onClick={handleFlipCamera}
                disabled={isFlippingCamera || isScreenSharing}
                className="glass-btn"
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: facingMode === 'environment' ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.14)',
                  border: facingMode === 'environment' ? '1.5px solid #a78bfa' : '1px solid rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: facingMode === 'environment' ? '0 0 16px rgba(139, 92, 246, 0.5)' : 'none',
                  transition: 'all 0.2s ease',
                  opacity: isScreenSharing ? 0.4 : 1
                }}
                title={`Flip to ${facingMode === 'user' ? 'Back' : 'Front'} Camera`}
              >
                <SwitchCamera size={22} color="#ffffff" />
              </button>
            )}

            {/* 2. Video Camera Toggle */}
            {isVideo && (
              <button 
                onClick={handleToggleVideo}
                className="glass-btn"
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: !isVideoEnabled ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255, 255, 255, 0.14)',
                  border: !isVideoEnabled ? '1.5px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: !isVideoEnabled ? '0 0 16px rgba(239, 68, 68, 0.5)' : 'none',
                  transition: 'all 0.2s ease'
                }}
                title={isVideoEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
              >
                {isVideoEnabled ? <Video size={22} color="#ffffff" /> : <VideoOff size={22} color="#ef4444" />}
              </button>
            )}

            {/* 3. Microphone Mute Toggle */}
            <button 
              onClick={handleToggleMute}
              className="glass-btn"
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.35)' : (isVideo ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.06)'),
                border: isMuted ? '1.5px solid #ef4444' : (isVideo ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(0, 0, 0, 0.08)'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isMuted ? '0 0 16px rgba(239, 68, 68, 0.5)' : 'none',
                transition: 'all 0.2s ease'
              }}
              title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            >
              {isMuted ? <MicOff size={22} color="#ef4444" /> : <Mic size={22} color={isVideo ? '#ffffff' : 'var(--text-primary)'} />}
            </button>

            {/* 4. End Call Button (Big Red Ruby Button) */}
            <button 
              onClick={() => {
                triggerHaptic([30, 40, 50]);
                playCallEndedTone();
                finalizeRecordingOnce();
                socket.emit('end-call', { to: callSession.targetId });
                onEndCall({
                  duration: callDurationRef.current,
                  status: callDurationRef.current > 0 ? 'completed' : 'missed',
                  isVideo
                });
              }}
              className="glass-btn"
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(239, 68, 68, 0.55)',
                marginLeft: '4px',
                transition: 'transform 0.15s ease'
              }}
              title="End Call"
            >
              <PhoneOff size={24} color="#ffffff" />
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
                            {contact.displayName || contact.name}
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
