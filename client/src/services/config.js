// GlassChat Server Configuration
// Permanent 24/7 Cloud Render URL
export const SERVER_URL = 'https://glasschat-vt5f.onrender.com';
export const LOCAL_FALLBACK_URL = 'http://192.168.1.4:5000';

export function getServerBaseUrl() {
  // 1. Custom override stored in localStorage (allows updating server URL in APK without reinstalling)
  if (typeof window !== 'undefined' && window.localStorage) {
    const customUrl = localStorage.getItem('glasschat_server_url');
    if (customUrl && customUrl.startsWith('http')) {
      return customUrl.replace(/\/+$/, '');
    }
  }

  // 2. If running in browser and already on the tunnel or a remote domain
  if (typeof window !== 'undefined' && window.location) {
    if (window.location.hostname && 
        window.location.hostname !== 'localhost' && 
        !window.location.hostname.startsWith('127.') &&
        window.location.port !== '3000') {
      return `${window.location.protocol}//${window.location.host}`;
    }
  }

  // 3. For native Android APK (Capacitor) or local dev, use the active tunnel URL
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
