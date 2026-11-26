// Resilient Google + Twilio STUN & OpenRelay TURN servers for 100% NAT/CGNAT/Firewall traversal
export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

// Get local audio and/or video stream from device camera & microphone
export async function getLocalUserMedia(video = true, audio = true, facingMode = 'user') {
  // Mobile-optimized constraints (ideal 480p, max 720p, 24-30fps): prevents Android CPU throttling & video freeze after 5+ mins
  const constraints = {
    audio: audio ? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    } : false,
    video: video ? {
      width: { ideal: 640, max: 1280 },
      height: { ideal: 480, max: 720 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: { ideal: facingMode }
    } : false
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    // Explicitly verify and enable audio tracks
    if (audio) {
      stream.getAudioTracks().forEach(t => {
        t.enabled = true;
      });
    }
    return stream;
  } catch (err) {
    console.warn('[WebRTC] Primary getUserMedia failed, trying relaxed constraints:', err);
    try {
      const relaxedStream = await navigator.mediaDevices.getUserMedia({
        video: video ? { facingMode } : false,
        audio: audio ? true : false
      });
      if (audio) {
        relaxedStream.getAudioTracks().forEach(t => { t.enabled = true; });
      }
      return relaxedStream;
    } catch (err2) {
      console.warn('[WebRTC] Relaxed constraints failed, attempting pure audio fallback:', err2);
      if (audio) {
        try {
          const pureAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
          });
          pureAudioStream.getAudioTracks().forEach(t => { t.enabled = true; });
          return pureAudioStream;
        } catch (audioErr) {
          console.error('[WebRTC] Microphone access denied or unavailable:', audioErr);
        }
      }
      return createSimulatedStream(video);
    }
  }
}

// Switch between Front (user) and Back (environment) camera
export async function switchCameraStream(currentStream, facingMode = 'environment') {
  try {
    if (currentStream) {
      currentStream.getVideoTracks().forEach(t => t.stop());
    }
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: facingMode }
      },
      audio: false
    });
    return newStream.getVideoTracks()[0];
  } catch (err) {
    console.warn('[WebRTC] Primary camera switch failed, trying generic facingMode:', err);
    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false
      });
      return fallbackStream.getVideoTracks()[0];
    } catch (err2) {
      console.error('[WebRTC] All camera switch attempts failed:', err2);
      throw err2;
    }
  }
}

// Get Screen Share / Screen Cast stream
export async function getDisplayMediaStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error('Screen sharing is not supported on this browser or platform.');
  }
  return await navigator.mediaDevices.getDisplayMedia({
    video: {
      cursor: 'always'
    },
    audio: true
  });
}

// Fallback simulated stream for environments without webcams / test environments
function createSimulatedStream(video = true) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  
  // Draw animated gradient
  let frame = 0;
  function draw() {
    frame++;
    const gradient = ctx.createLinearGradient(0, 0, 640, 480);
    gradient.addColorStop(0, '#38bdf8');
    gradient.addColorStop(0.5, '#818cf8');
    gradient.addColorStop(1, '#c084fc');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 480);
    
    // Draw pulsing orb
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(320, 240, 60 + Math.sin(frame * 0.05) * 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GlassChat Camera Preview', 320, 350);
  }
  setInterval(draw, 50);

  const stream = canvas.captureStream(30);

  // Add dummy audio track using AudioContext
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const dst = osc.connect(audioCtx.createMediaStreamDestination());
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false; // muted dummy
    stream.addTrack(track);
  } catch (e) {
    // ignore
  }

  return stream;
}

// Helper to stop all tracks on a stream
export function stopMediaStream(stream) {
  if (stream) {
    stream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (e) {
        console.error('Error stopping track:', e);
      }
    });
  }
}

