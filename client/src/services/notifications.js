// Real-time Sound, Vibration, Native/PWA Push Notification & Smart Reminder Service
let audioCtx = null;
const REMINDERS_KEY = 'glasschat_smart_reminders';

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
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.08);

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

export function vibrateDevice(pattern = [100, 50, 100]) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch (e) {}
}

export async function requestNotificationPermission() {
  try {
    if (typeof window !== 'undefined' && window.AndroidNotifications?.requestPermission) {
      window.AndroidNotifications.requestPermission();
    }
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      return await Notification.requestPermission();
    }
    return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  } catch (e) {
    return 'denied';
  }
}

export async function showSystemNotification(title, body, tag = 'glasschat-msg') {
  try {
    // 1. Native Android Notification Channel Bridge (works even when Web Notification API isn't mounted in WebView)
    if (typeof window !== 'undefined' && window.AndroidNotifications?.showNotification) {
      window.AndroidNotifications.showNotification(title, body || 'New notification', tag);
      return;
    }

    // 2. Service Worker Notification (works reliably when PWA is backgrounded/minimized)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body: body || 'New message received',
          icon: '/logo192.png',
          badge: '/favicon.png',
          tag,
          renotify: true,
          vibrate: [120, 60, 120]
        });
        return;
      }
    }

    // 3. Standard Web Notification API fallback
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body || 'New message received',
        icon: '/logo192.png',
        tag,
        renotify: true
      });
    }
  } catch (e) {}
}

export function notifyIncomingMessage(senderName, text, chatId = 'glasschat-msg') {
  playNotificationSound();
  vibrateDevice();
  showSystemNotification(`GlassChat • ${senderName}`, text || 'New message received', `chat-${chatId}`);
}

export function notifyUrgentSos(senderName, text) {
  playNotificationSound();
  vibrateDevice([300, 120, 300, 120, 400]);
  showSystemNotification(`🆘 SOS EMERGENCY • ${senderName}`, text, 'glasschat-sos');
}

// ======================================================
// SMART REMINDERS SCHEDULER (Chat & Voice Note Actions)
// ======================================================
export function getReminders() {
  try {
    return JSON.parse(localStorage.getItem(REMINDERS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addSmartReminder({ title, triggerAtMs, chatName, sourceText }) {
  const list = getReminders();
  const reminder = {
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: title || 'Smart Reminder',
    triggerAtMs: Number(triggerAtMs) || (Date.now() + 3600000),
    chatName: chatName || '',
    sourceText: sourceText || '',
    fired: false,
    createdAt: Date.now()
  };
  list.push(reminder);
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(list));
  } catch {}
  return reminder;
}

export function dismissReminder(id) {
  const list = getReminders().filter(r => r.id !== id);
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(list));
  } catch {}
}

export function startReminderWatcher(onDueCallback) {
  const check = () => {
    const now = Date.now();
    const list = getReminders();
    let changed = false;
    const updated = list.map(rem => {
      if (!rem.fired && rem.triggerAtMs <= now) {
        changed = true;
        playNotificationSound();
        vibrateDevice([180, 80, 180]);
        showSystemNotification(`⏰ Reminder: ${rem.title}`, rem.sourceText || rem.chatName || 'Scheduled chat reminder', `rem-${rem.id}`);
        onDueCallback?.(rem);
        return { ...rem, fired: true };
      }
      return rem;
    });
    if (changed) {
      try {
        localStorage.setItem(REMINDERS_KEY, JSON.stringify(updated));
      } catch {}
    }
  };
  const id = setInterval(check, 5000);
  check();
  return () => clearInterval(id);
}
