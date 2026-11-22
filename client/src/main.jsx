import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { getServerBaseUrl } from './services/config.js';

// Automatically configure API routing for native APK and web
const originalFetch = window.fetch;
window.fetch = (url, options) => {
  if (typeof url === 'string' && url.startsWith('/api')) {
    const base = getServerBaseUrl();
    return originalFetch(`${base}${url}`, options);
  }
  return originalFetch(url, options);
};

// Lock window and body scroll to 0 to prevent keyboard displacement on Android WebView
window.addEventListener('scroll', () => {
  if (window.scrollY !== 0 || window.scrollX !== 0) {
    window.scrollTo(0, 0);
  }
}, { passive: false });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

