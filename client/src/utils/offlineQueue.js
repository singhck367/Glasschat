// Offline message history cache & outbox sync queue with tempId deduplication

const QUEUE_KEY = 'glasschat_offline_queue_global';
const CACHE_PREFIX = 'glasschat_chat_cache_';
const MAX_CACHED_MESSAGES = 80;

export function getCachedChatMessages(chatId) {
  if (!chatId || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${chatId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedChatMessages(chatId, list) {
  if (!chatId || !Array.isArray(list) || typeof localStorage === 'undefined') return;
  try {
    // Strip large inline base64 blobs before persisting to avoid blocking main thread / hitting storage quota
    const sliced = list.slice(-MAX_CACHED_MESSAGES).map(m => {
      if (m.mediaUrl && typeof m.mediaUrl === 'string' && m.mediaUrl.length > 60000) {
        return { ...m, mediaUrl: null, _cachedMediaOmitted: true };
      }
      return m;
    });
    localStorage.setItem(`${CACHE_PREFIX}${chatId}`, JSON.stringify(sliced));
  } catch (err) {
    console.warn('Chat cache write skipped (quota):', err);
  }
}

export function getOfflineQueue() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineMessage(payload) {
  if (!payload?.tempId || typeof localStorage === 'undefined') return;
  try {
    const existing = getOfflineQueue();
    if (existing.some(item => item.tempId === payload.tempId)) return;
    existing.push({ ...payload, queuedAt: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(existing));
  } catch (err) {
    console.warn('Offline queue write error:', err);
  }
}

export function removeOfflineQueuedMessage(tempId) {
  if (!tempId || typeof localStorage === 'undefined') return;
  try {
    const existing = getOfflineQueue();
    const filtered = existing.filter(item => item.tempId !== tempId);
    if (filtered.length !== existing.length) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
    }
  } catch {}
}

export function flushOfflineQueue(socket) {
  if (!socket || !socket.connected) return 0;
  const queue = getOfflineQueue();
  if (!queue.length) return 0;

  let flushed = 0;
  queue.forEach(item => {
    try {
      socket.emit('send-message', item);
      flushed++;
    } catch {}
  });
  return flushed;
}
