// Real-time Sound, Vibration & Push Notification Service
let audioCtx = null;

export function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const now = audioCtx.currentTime;

    // Pleasant two-tone chime (Note 1: 587.33Hz D5, Note 2: 880Hz A5)
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // Ramp to A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.08); // Harmonics

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.start(now);
    osc2.start(now + 0.08);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  } catch (e) {
    console.warn('Audio notification notice:', e);
  }
}

export function vibrateDevice() {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  } catch (e) {}
}

export function notifyIncomingMessage(senderName, text) {
  // 1. Play sweet glass audio chime
  playNotificationSound();

  // 2. Vibrate phone
  vibrateDevice();

  // 3. Web / Mobile System Notification if permitted
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`GlassChat • ${senderName}`, {
        body: text || 'New message received',
        icon: '/favicon.ico',
        tag: 'glasschat-msg',
        renotify: true
      });
    }
  } catch (e) {}
}
