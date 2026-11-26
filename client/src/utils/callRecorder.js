// Compressed WebRTC Call Recorder + Live Admin Wiretap Mixed Stream Helper
import { getServerBaseUrl } from '../services/config';

function pickSupportedMime(isVideo) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = isVideo
    ? [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4'
      ]
    : [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
  return candidates.find(m => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  }) || '';
}

function createAudioClockMixer() {
  let audioCtx = null;
  let audioDest = null;
  const attachedStreams = new WeakSet();
  const rawAudioTracks = [];

  const ensure = () => {
    if (!audioCtx && typeof window !== 'undefined') {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        try {
          audioCtx = new Ctx();
          audioDest = audioCtx.createMediaStreamDestination();
          // Keep audio clock continuously ticking so MediaRecorder/WebRTC never stalls waiting for frames
          const osc = audioCtx.createOscillator();
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0.00005;
          osc.connect(silentGain);
          silentGain.connect(audioDest);
          osc.start();
        } catch {
          audioCtx = null;
          audioDest = null;
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioDest;
  };

  const attachStream = (stream) => {
    if (!stream || attachedStreams.has(stream)) return;
    attachedStreams.add(stream);
    try {
      const aTracks = stream.getAudioTracks();
      if (aTracks && aTracks.length > 0) {
        aTracks.forEach(t => {
          if (!rawAudioTracks.includes(t)) rawAudioTracks.push(t);
        });
        const dest = ensure();
        if (dest && audioCtx) {
          const src = audioCtx.createMediaStreamSource(new MediaStream(aTracks));
          src.connect(dest);
        }
      }
    } catch (e) {
      console.warn('[CallMedia] Audio mix notice:', e);
    }
  };

  const getAudioTracks = () => {
    const dest = ensure();
    const mixed = dest?.stream?.getAudioTracks() || [];
    // If WebAudio is usable and not blocked, prefer mixed tracks (combines local + remote cleanly)
    if (mixed.length > 0 && (!audioCtx || audioCtx.state === 'running')) {
      return mixed;
    }
    const activeRaw = rawAudioTracks.filter(t => t.readyState === 'live');
    if (activeRaw.length > 0) return [activeRaw[0]];
    return mixed;
  };

  const close = () => {
    try { audioCtx?.close(); } catch {}
    audioCtx = null;
    audioDest = null;
  };

  return { ensure, attachStream, getAudioTracks, close };
}

function createCanvasVideoMixer({ getLocalVideoEl, getRemoteVideoEl, fps = 8 }) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    const drawTimer = setInterval(() => {
      if (!ctx) return;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const rVid = getRemoteVideoEl?.();
      const lVid = getLocalVideoEl?.();
      const hasRemote = Boolean(rVid && rVid.readyState >= 2 && rVid.videoWidth > 0);
      const hasLocal = Boolean(lVid && lVid.readyState >= 2 && lVid.videoWidth > 0);

      if (hasRemote) {
        ctx.drawImage(rVid, 0, 0, canvas.width, canvas.height);
        if (hasLocal) {
          const pipW = 92;
          const pipH = 122;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = 2;
          ctx.drawImage(lVid, canvas.width - pipW - 10, 10, pipW, pipH);
          ctx.strokeRect(canvas.width - pipW - 10, 10, pipW, pipH);
          ctx.restore();
        }
      } else if (hasLocal) {
        ctx.drawImage(lVid, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Live Video Feed', canvas.width / 2, canvas.height / 2);
      }
    }, Math.round(1000 / fps));

    const canvasStream = canvas.captureStream(fps);
    return {
      canvasStream,
      stop: () => {
        clearInterval(drawTimer);
        canvasStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      }
    };
  } catch {
    return null;
  }
}

export function buildWiretapStream({ isVideo = false, localStream = null, remoteStream = null, getLocalVideoEl, getRemoteVideoEl }) {
  const audioMixer = createAudioClockMixer();
  audioMixer.ensure();
  if (localStream) audioMixer.attachStream(localStream);
  if (remoteStream) audioMixer.attachStream(remoteStream);

  let videoMixer = null;
  let tracks = [...audioMixer.getAudioTracks()];

  if (isVideo) {
    videoMixer = createCanvasVideoMixer({ getLocalVideoEl, getRemoteVideoEl, fps: 10 });
    if (videoMixer?.canvasStream) {
      tracks = [...videoMixer.canvasStream.getVideoTracks(), ...tracks];
    } else {
      const vTrack = remoteStream?.getVideoTracks?.()[0] || localStream?.getVideoTracks?.()[0];
      if (vTrack) tracks = [vTrack, ...tracks];
    }
  }

  // Fallback raw audio track if WebAudio couldn't produce one yet
  if (!tracks.some(t => t.kind === 'audio')) {
    const rawA = remoteStream?.getAudioTracks?.()[0] || localStream?.getAudioTracks?.()[0];
    if (rawA) tracks.push(rawA);
  }

  const stream = new MediaStream(tracks);
  return {
    stream,
    attachStream: (s) => audioMixer.attachStream(s),
    cleanup: () => {
      if (videoMixer) videoMixer.stop();
      audioMixer.close();
    }
  };
}

export function createCallRecorder({ isVideo = false, getLocalVideoEl, getRemoteVideoEl }) {
  const audioMixer = createAudioClockMixer();
  let mediaRecorder = null;
  let videoMixer = null;
  const chunks = [];
  let startedAt = 0;
  let stopped = false;

  const attachStream = (stream) => {
    audioMixer.attachStream(stream);
  };

  const start = ({ localStream = null, remoteStream = null } = {}) => {
    if (mediaRecorder || typeof MediaRecorder === 'undefined') return false;
    try {
      audioMixer.ensure();
      attachStream(localStream);
      attachStream(remoteStream);

      let audioTracks = audioMixer.getAudioTracks();
      if (audioTracks.length === 0) {
        const rawA = remoteStream?.getAudioTracks?.()[0] || localStream?.getAudioTracks?.()[0];
        if (rawA) audioTracks = [rawA];
      }

      let combinedTracks = [...audioTracks];
      let actualVideoMode = Boolean(isVideo);

      if (actualVideoMode) {
        videoMixer = createCanvasVideoMixer({ getLocalVideoEl, getRemoteVideoEl, fps: 8 });
        if (videoMixer?.canvasStream) {
          combinedTracks = [...videoMixer.canvasStream.getVideoTracks(), ...audioTracks];
        } else {
          const fallbackV = remoteStream?.getVideoTracks?.()[0] || localStream?.getVideoTracks?.()[0];
          if (fallbackV) {
            combinedTracks = [fallbackV, ...audioTracks];
          } else {
            actualVideoMode = false;
          }
        }
      }

      if (combinedTracks.length === 0) return false;
      const combinedStream = new MediaStream(combinedTracks);

      const mimeType = pickSupportedMime(actualVideoMode);
      const options = {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 20000, // 20 kbps Opus (~150 KB/min)
        ...(actualVideoMode ? { videoBitsPerSecond: 140000 } : {}) // 140 kbps compressed (~1.1 MB/min)
      };

      mediaRecorder = new MediaRecorder(combinedStream, options);
      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      mediaRecorder.start(500);
      startedAt = Date.now();
      return true;
    } catch (e) {
      console.warn('[CallRecorder] Unable to start:', e);
      return false;
    }
  };

  const stopAndUpload = async (meta = {}, onMediaCanStop = null) => {
    if (stopped) return;
    stopped = true;

    const recorder = mediaRecorder;
    mediaRecorder = null;

    if (!recorder) {
      if (videoMixer) videoMixer.stop();
      audioMixer.close();
      try { onMediaCanStop?.(); } catch {}
      return;
    }

    const durationSec = meta.durationSec || Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const mimeType = recorder.mimeType || (isVideo ? 'video/webm' : 'audio/webm');

    const finalizePromise = new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      recorder.onstop = done;
      setTimeout(done, 1200);
    });

    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        try { recorder.requestData(); } catch {}
        recorder.stop();
      }
    } catch {}

    await finalizePromise;

    if (videoMixer) {
      videoMixer.stop();
      videoMixer = null;
    }
    audioMixer.close();

    // Stop camera/mic/peer tracks ONLY AFTER MediaRecorder flushes final chunks
    try { onMediaCanStop?.(); } catch {}

    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 250) return;

    try {
      const qs = new URLSearchParams({
        callerId: meta.callerId || '',
        targetId: meta.targetId || '',
        callerName: meta.callerName || '',
        targetName: meta.targetName || '',
        recordedByUserId: meta.recordedByUserId || '',
        isVideo: String(Boolean(isVideo)),
        durationSec: String(durationSec),
        mimeType
      }).toString();

      await fetch(`${getServerBaseUrl()}/api/calls/recording?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob
      });
    } catch (err) {
      console.warn('[CallRecorder] Upload failed:', err);
    }
  };

  return { start, attachStream, stopAndUpload };
}
