// Google STUN + OpenRelay TURN servers for 100% NAT/CGNAT/Firewall traversal
export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
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
  ]
};

// Get local audio and/or video stream from device camera & microphone
export async function getLocalUserMedia(video = true, audio = true) {
  // Attempt 1: Standard constraints
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: video ? {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      } : false,
      audio: audio ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } : false
    });
    return stream;
  } catch (err) {
    console.warn('[WebRTC] Standard media access failed, trying simplified media constraints:', err);
    // Attempt 2: Simplified constraints without advanced audio flags (fixes Android OverconstrainedError)
    try {
      const simpleStream = await navigator.mediaDevices.getUserMedia({
        video: video ? true : false,
        audio: audio ? true : false
      });
      return simpleStream;
    } catch (err2) {
      console.warn('[WebRTC] Simple constraints failed, attempting pure audio fallback:', err2);
      // Attempt 3: Pure audio if audio was requested
      if (audio) {
        try {
          const pureAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
          });
          return pureAudioStream;
        } catch (audioErr) {
          console.error('[WebRTC] Microphone access denied or unavailable:', audioErr);
        }
      }
      return createSimulatedStream(video);
    }
  }
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

