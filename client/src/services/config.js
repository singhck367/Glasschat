// GlassChat Server Configuration
// Permanent 24/7 Cloud Render URL for hosted / native APK builds
export const SERVER_URL = 'https://glasschat-vt5f.onrender.com';
export const LOCAL_FALLBACK_URL = 'http://192.168.1.4:5000';

export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    window.location?.protocol === 'capacitor:' ||
    window.location?.protocol === 'file:'
  );
}

export function getServerBaseUrl() {
  // 1. Custom override stored in localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    const customUrl = localStorage.getItem('glasschat_server_url');
    if (customUrl && customUrl.startsWith('http')) {
      return customUrl.replace(/\/+$/, '');
    }
  }

  // 2. When running inside browser (local dev Vite :3000, local Node :5000, or deployed domain), use same-origin so REST stays local/fast
  if (typeof window !== 'undefined' && window.location && !isNativeApp()) {
    return `${window.location.protocol}//${window.location.host}`;
  }

  // 3. Native Android APK (Capacitor) uses cloud SERVER_URL
  return SERVER_URL;
}

export function getSocketBaseUrl() {
  if (typeof window !== 'undefined' && window.localStorage) {
    const customUrl = localStorage.getItem('glasschat_server_url');
    if (customUrl && customUrl.startsWith('http')) {
      return customUrl.replace(/\/+$/, '');
    }
  }

  // On local Vite dev server (:3000), connect WebSocket directly to local backend :5000 to avoid proxy latency
  if (typeof window !== 'undefined' && window.location && !isNativeApp()) {
    if (window.location.port === '3000') {
      return `${window.location.protocol}//${window.location.hostname}:5000`;
    }
    return `${window.location.protocol}//${window.location.host}`;
  }

  return SERVER_URL;
}

export function setServerBaseUrl(url) {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (url && url.startsWith('http')) {
      localStorage.setItem('glasschat_server_url', url.replace(/\/+$/, ''));
    } else {
      localStorage.removeItem('glasschat_server_url');
    }
  }
}
