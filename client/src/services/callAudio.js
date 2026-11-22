// GlassChat Web Audio Synthesized Ringtones & Calling Tones
// Works 100% offline, zero external audio file dependencies, instant playback

let ringAudioCtx = null;
let outgoingInterval = null;
let incomingInterval = null;
let vibrationInterval = null;

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!ringAudioCtx || ringAudioCtx.state === 'closed') {
    ringAudioCtx = new AudioContextClass();
  }
  if (ringAudioCtx.state === 'suspended') {
    ringAudioCtx.resume().catch(() => {});
  }
  return ringAudioCtx;
}

// 1. OUTGOING CALL RINGBACK TONE (Trrring... Trrring...)
export function startOutgoingRingbackTone() {
  stopCallAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  const playTone = () => {
    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, now); // Standard 440Hz
      osc2.frequency.setValueAtTime(480, now); // 480Hz ring tone

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gainNode.gain.setValueAtTime(0.12, now + 1.2);
      gainNode.gain.linearRampToValueAtTime(0, now + 1.4);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.4);
      osc2.stop(now + 1.4);
    } catch (e) {
      console.warn('Tone notice:', e);
    }
  };

  playTone();
  outgoingInterval = setInterval(playTone, 3500);
}

// 2. INCOMING CALL MUSICAL RINGTONE & VIBRATION
export function startIncomingRingtone() {
  stopCallAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  const chords = [
    [523.25, 659.25], // C5, E5
    [587.33, 698.46], // D5, F5
    [659.25, 783.99], // E5, G5
    [783.99, 1046.50] // G5, C6
  ];

  const playChimeSequence = () => {
    try {
      chords.forEach((chord, i) => {
        const time = ctx.currentTime + i * 0.28;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(chord[0], time);
        osc2.frequency.setValueAtTime(chord[1], time);

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.2, time + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(time);
        osc2.start(time);
        osc1.stop(time + 0.55);
        osc2.stop(time + 0.55);
      });
    } catch (e) {
      console.warn('Ringtone notice:', e);
    }
  };

  playChimeSequence();
  incomingInterval = setInterval(playChimeSequence, 2400);

  // Trigger Phone Vibration
  if (navigator.vibrate) {
    try {
      navigator.vibrate([500, 250, 500, 250, 800]);
      vibrationInterval = setInterval(() => {
        navigator.vibrate([500, 250, 500, 250, 800]);
      }, 3000);
    } catch (e) {}
  }
}

// 3. STOP ALL CALL SOUNDS & VIBRATIONS
export function stopCallAudio() {
  if (outgoingInterval) {
    clearInterval(outgoingInterval);
    outgoingInterval = null;
  }
  if (incomingInterval) {
    clearInterval(incomingInterval);
    incomingInterval = null;
  }
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
  }
  if (navigator.vibrate) {
    try {
      navigator.vibrate(0);
    } catch (e) {}
  }
}

// 4. CALL ENDED / BUSY BEEP TONE
export function playCallEndedTone() {
  stopCallAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const time = now + i * 0.22;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, time);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.15, time + 0.02);
      gain.gain.linearRampToValueAtTime(0, time + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.16);
    }
  } catch (e) {}
}

// 5. HAPTIC FEEDBACK (Single crisp tick for UI interactions)
export function triggerHaptic(duration = 20) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(duration);
    } catch (e) {}
  }
}
