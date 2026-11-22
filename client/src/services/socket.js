import { io } from 'socket.io-client';
import { getServerBaseUrl } from './config.js';

const SOCKET_URL = getServerBaseUrl();

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling']
});

export function registerSocketUser(userId) {
  if (userId && socket.connected) {
    socket.emit('register-user', { userId });
  }
}

socket.on('connect', () => {
  console.log('✅ Connected to GlassChat WebSocket server:', socket.id);
  try {
    const saved = localStorage.getItem('glasschat_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) {
        socket.emit('register-user', { userId: parsed.id });
      }
    }
  } catch (e) {}
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from GlassChat WebSocket server');
});

