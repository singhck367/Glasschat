// Firebase Client Configuration
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';

// User's Firebase Configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAf6TrUxoDIgXTWnnarWMJ9F22PtoBOtxE",
  authDomain: "glasschat-4332d.firebaseapp.com",
  projectId: "glasschat-4332d",
  storageBucket: "glasschat-4332d.firebasestorage.app",
  messagingSenderId: "33728908289",
  appId: "1:33728908289:web:6f58a92e63b5b6965e0400",
  measurementId: "G-1Z8G37J784"
};

export const isFirebaseConfigured = () => {
  return Boolean(
    firebaseConfig.apiKey && 
    firebaseConfig.apiKey.length > 10 && 
    firebaseConfig.projectId
  );
};

let authInstance = null;

try {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  authInstance = getAuth(app);
  // Configure language to English or Hindi
  authInstance.languageCode = 'en';
} catch (err) {
  console.error('[Firebase] Init error:', err);
}

export const auth = authInstance;

/**
 * Setup Invisible reCAPTCHA verifier for Phone Auth
 * @param {string} containerId - Element ID for the invisible reCAPTCHA container
 */
export const initRecaptchaVerifier = (containerId = 'recaptcha-container') => {
  if (!authInstance) return null;
  
  if (window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch (e) {
      console.warn('Recaptcha clear error:', e);
    }
    window.recaptchaVerifier = null;
  }

  // Ensure container exists in DOM
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  }

  window.recaptchaVerifier = new RecaptchaVerifier(authInstance, containerId, {
    size: 'invisible',
    callback: () => {
      console.log('[Firebase] reCAPTCHA verified successfully');
    },
    'expired-callback': () => {
      console.warn('[Firebase] reCAPTCHA expired');
    }
  });

  return window.recaptchaVerifier;
};

/**
 * Send real SMS OTP to phone number using Firebase Auth
 * @param {string} fullPhoneNumber - Phone number with country code, e.g. "+919876543210" (no spaces)
 */
export const sendFirebasePhoneOtp = async (fullPhoneNumber) => {
  if (!authInstance) {
    throw new Error('Firebase Auth is not initialized');
  }

  // Format phone number: remove all spaces, hyphens, keep leading +
  const cleanPhone = fullPhoneNumber.replace(/[^\d+]/g, '');
  const verifier = initRecaptchaVerifier('recaptcha-container');
  
  console.log(`[Firebase] Sending real SMS OTP to: ${cleanPhone}`);
  const confirmationResult = await signInWithPhoneNumber(authInstance, cleanPhone, verifier);
  window.confirmationResult = confirmationResult;
  return confirmationResult;
};

/**
 * Verify received SMS OTP code
 * @param {string} otpCode - 6-digit OTP code received via SMS
 */
export const verifyFirebasePhoneOtp = async (otpCode) => {
  if (!window.confirmationResult) {
    throw new Error('No active SMS OTP session found.');
  }
  const result = await window.confirmationResult.confirm(otpCode.trim());
  return result.user;
};
