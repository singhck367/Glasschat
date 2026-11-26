import { io } from 'socket.io-client';
import { getSocketBaseUrl, isNativeApp } from './config.js';

const SOCKET_URL = getSocketBaseUrl();

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  upgrade: true,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2500,
  timeout: 10000
});

function buildDevicePayload(userId) {
  let platform = 'Web Browser';
  if (isNativeApp()) {
    platform = 'Android App';
  } else if (typeof navigator !== 'undefined') {
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) platform = 'iOS Web/PWA';
    else if (/Android/i.test(navigator.userAgent)) platform = 'Android Browser';
    else if (/Windows|Mac|Linux/i.test(navigator.userAgent)) platform = 'Desktop Web';
  }
  return {
    userId,
    platform,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  };
}

export function registerSocketUser(userId) {
  if (userId && socket.connected) {
    socket.emit('register-user', buildDevicePayload(userId));
  }
}

socket.on('connect', () => {
  console.log('✅ Connected to GlassChat WebSocket server:', socket.id, SOCKET_URL);
  try {
    const saved = localStorage.getItem('glasschat_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) {
        socket.emit('register-user', buildDevicePayload(parsed.id));
      }
    }
  } catch (e) {}
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from GlassChat WebSocket server');
});
