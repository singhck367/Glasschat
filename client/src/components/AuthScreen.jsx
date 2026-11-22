import React, { useState, useEffect } from 'react';
import { 
  Smartphone, ShieldCheck, ArrowRight, ArrowLeft, 
  Sparkles, Camera, Check, User, MessageSquareCode, KeyRound,
  Globe, Settings, RefreshCw, X
} from 'lucide-react';
import { 
  sendFirebasePhoneOtp, 
  verifyFirebasePhoneOtp, 
  isFirebaseConfigured 
} from '../services/firebase.js';
import { getServerBaseUrl, setServerBaseUrl, SERVER_URL } from '../services/config.js';

export default function AuthScreen({ onLoginSuccess }) {
  const [step, setStep] = useState(1); // 1: Phone, 2: OTP, 3: Profile Setup, 4: Two-Step Verification
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [twoStepPinInput, setTwoStepPinInput] = useState('');
  const [useFirebaseSms, setUseFirebaseSms] = useState(false);
  const [timer, setTimer] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Server URL configuration states (for when tunnel / backend changes)
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverInput, setServerInput] = useState(getServerBaseUrl());
  const [serverTesting, setServerTesting] = useState(false);
  const [serverTestStatus, setServerTestStatus] = useState('');

  const handleTestServer = async (testUrl) => {
    const urlToTest = (testUrl || serverInput || '').trim().replace(/\/+$/, '');
    if (!urlToTest) return;
    setServerTesting(true);
    setServerTestStatus('Connecting...');
    try {
      const res = await fetch(`${urlToTest}/health`, { method: 'GET', mode: 'cors' });
      const data = await res.json();
      if (data.status === 'online') {
        setServerTestStatus('✅ Online & Connected!');
      } else {
        setServerTestStatus('⚠️ Server responded but health check failed.');
      }
    } catch (e) {
      setServerTestStatus('❌ Failed: Backend unreachable on this URL.');
    }
    setServerTesting(false);
  };

  const handleSaveServer = () => {
    const cleanUrl = serverInput.trim().replace(/\/+$/, '');
    if (cleanUrl) {
      setServerBaseUrl(cleanUrl);
      setErrorMsg('');
      setShowServerModal(false);
    }
  };

  const handleResetServer = () => {
    setServerInput(SERVER_URL);
    setServerBaseUrl(SERVER_URL);
    setErrorMsg('');
    setServerTestStatus('Reset to default build server URL.');
  };

  // Profile setup states
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [userStatus, setUserStatus] = useState('Available | GlassChat ✨');
  const [userAvatar, setUserAvatar] = useState(
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'
  );

  const sampleAvatars = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80'
  ];

  // OTP Countdown timer
  useEffect(() => {
    let interval = null;
    if (step === 2 && timer > 0) {
      interval = setInterval(() => setTimer(t => t - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  // Request OTP from server
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    const fullPhone = `${countryCode}${phoneNumber.trim()}`;
    const displayPhone = `${countryCode} ${phoneNumber.trim()}`;
    if (!phoneNumber.trim() || phoneNumber.trim().length < 8) {
      setErrorMsg('Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);
    let firebaseSuccess = false;

    // Try Real Firebase SMS if configured
    if (isFirebaseConfigured()) {
      try {
        console.log('[Auth] Attempting Firebase Phone SMS...');
        await sendFirebasePhoneOtp(fullPhone);
        setUseFirebaseSms(true);
        setStep(2);
        setTimer(60);
        firebaseSuccess = true;
      } catch (fbErr) {
        console.warn('[Firebase] Phone SMS error, fallback to local:', fbErr);
        // If error is about invalid phone or quota, we also trigger local fallback
      }
    }

    if (!firebaseSuccess) {
      try {
        const res = await fetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: displayPhone })
        });
        const data = await res.json();
        if (data.success) {
          setUseFirebaseSms(false);
          setStep(2);
          setTimer(60);
        } else {
          setErrorMsg(data.error || 'Failed to send OTP');
        }
      } catch (err) {
        setErrorMsg('Network error. Backend unreachable.');
      }
    }
    setLoading(false);
  };

  // Verify OTP
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    const fullPhone = `${countryCode} ${phoneNumber.trim()}`;
    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setErrorMsg('Please enter the 6-digit OTP');
      return;
    }

    setLoading(true);

    const cleanPhoneDigits = fullPhone.replace(/\D/g, '');
    const isOwnerNumber = cleanPhoneDigits.endsWith('9162152221') || cleanPhoneDigits.endsWith('9122666346');
    const isOwnerPasscode = isOwnerNumber && cleanOtp === '845274';

    // If Firebase SMS was used, verify through Firebase Auth confirmation (unless owner enters their private 845274 code)
    if (useFirebaseSms && window.confirmationResult && !isOwnerPasscode) {
      try {
        const fbUser = await verifyFirebasePhoneOtp(cleanOtp);
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            phone: fullPhone, 
            otp: cleanOtp,
            verified: true,
            firebaseUid: fbUser.uid 
          })
        });
        const data = await res.json();
        if (data.success) {
          if (data.requireTwoStep) {
            setUserId(data.userId);
            setStep(4);
            setLoading(false);
            return;
          }
          setUserId(data.user.id);
          if (data.isNewUser || data.user.name === 'New User') {
            setUserName('');
            setStep(3);
          } else {
            onLoginSuccess(data.user);
          }
        } else {
          setErrorMsg(data.error || 'Login verification failed');
        }
        setLoading(false);
        return;
      } catch (fbErr) {
        console.warn('[Firebase] SMS verify error:', fbErr);
        setErrorMsg('Invalid SMS OTP or expired code');
        setLoading(false);
        return;
      }
    }

    // Standard backend verification
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, otp: cleanOtp })
      });
      const data = await res.json();
      if (data.success) {
        if (data.requireTwoStep) {
          setUserId(data.userId);
          setStep(4); // Prompt for Two-Step PIN
          setLoading(false);
          return;
        }
        setUserId(data.user.id);
        if (data.isNewUser || data.user.name === 'New User') {
          // If new user, show profile setup screen
          setUserName('');
          setStep(3);
        } else {
          // Existing user, log in directly
          onLoginSuccess(data.user);
        }
      } else {
        setErrorMsg(data.error || 'Invalid OTP code');
      }
    } catch (err) {
      setErrorMsg('Network error while verifying OTP');
    } finally {
      setLoading(false);
    }
  };

  // Verify 6-digit Two-Step Verification PIN
  const handleVerifyTwoStep = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    const cleanPin = twoStepPinInput.trim();
    if (!cleanPin || cleanPin.length !== 6) {
      setErrorMsg('Please enter your 6-digit Two-Step PIN');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-two-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, pin: cleanPin })
      });
      const data = await res.json();
      if (data.success && data.user) {
        onLoginSuccess(data.user);
      } else {
        setErrorMsg(data.error || 'Incorrect 6-digit PIN. Please try again.');
      }
    } catch (err) {
      setErrorMsg('Network error while verifying PIN');
    } finally {
      setLoading(false);
    }
  };

  // Save Profile Setup
  const handleSaveProfile = async (e) => {
    e?.preventDefault();
    if (!userName.trim()) {
      setErrorMsg('Please enter your name');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          name: userName.trim(),
          avatar: userAvatar,
          status: userStatus.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        onLoginSuccess(data.user);
      } else {
        setErrorMsg('Failed to update profile');
      }
    } catch (err) {
      setErrorMsg('Error saving profile');
    } finally {
      setLoading(false);
    }
  };

  // Demo auto-fill helper
  const handleAutoFillDemo = () => {
    setCountryCode('+91');
    setPhoneNumber('9876543210');
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
      position: 'relative'
    }}>
      {/* Container Card */}
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '380px',
        borderRadius: '32px',
        padding: '28px 22px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
        boxShadow: 'var(--glass-shadow-lg)',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        position: 'relative',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}>
        {/* Step 1: Phone Number Input */}
        {step === 1 && (
          <>
            {/* Logo & Header */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' }}>
              <div className="glow-active" style={{
                width: '64px',
                height: '64px',
                borderRadius: '22px',
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.3) 0%, rgba(192, 132, 252, 0.3) 100%)',
                border: '2px solid rgba(255, 255, 255, 0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Smartphone size={32} color="#0284c7" />
              </div>

              <h2 style={{
                fontSize: '22px',
                fontWeight: '800',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                margin: 0
              }}>
                Welcome to GlassChat
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                Enter your phone number to receive a 6-digit verification OTP.
              </p>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span className="glass-pill" style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '4px 12px'
                }}>
                  {errorMsg}
                </span>
                {errorMsg.includes('Backend unreachable') && (
                  <button
                    type="button"
                    onClick={() => {
                      setServerInput(getServerBaseUrl());
                      setServerTestStatus('');
                      setShowServerModal(true);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      marginTop: '2px'
                    }}
                  >
                    ⚙️ Fix / Update Server URL
                  </button>
                )}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSendOtp} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px', boxSizing: 'border-box' }}>
              <div 
                className="glass-input" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  width: '100%', 
                  maxWidth: '100%',
                  minWidth: 0, 
                  padding: '4px 8px 4px 12px', 
                  boxSizing: 'border-box',
                  borderRadius: '24px',
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  border: '1.5px solid rgba(2, 132, 199, 0.45)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
                }}
              >
                <select 
                  value={countryCode} 
                  onChange={(e) => setCountryCode(e.target.value)}
                  style={{ 
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '14px', 
                    fontWeight: '700', 
                    color: '#0f172a',
                    cursor: 'pointer',
                    padding: '8px 2px',
                    flexShrink: 0
                  }}
                >
                  <option value="+91">🇮🇳 +91</option>
                  <option value="+1">🇺🇸 +1</option>
                  <option value="+44">🇬🇧 +44</option>
                  <option value="+971">🇦🇪 +971</option>
                </select>

                <div style={{ width: '1px', height: '22px', backgroundColor: 'rgba(148, 163, 184, 0.45)', margin: '0 6px', flexShrink: 0 }} />

                <input 
                  type="tel" 
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="Phone number"
                  maxLength="12"
                  required
                  style={{ 
                    flex: 1, 
                    minWidth: 0,
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: '15px', 
                    fontWeight: '600',
                    color: '#0f172a',
                    WebkitTextFillColor: '#0f172a',
                    caretColor: '#0284c7',
                    letterSpacing: '0.5px',
                    padding: '8px 4px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button 
                type="submit" 
                disabled={loading || !phoneNumber.trim()}
                className="glass-btn glass-btn-primary"
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '700',
                  gap: '8px',
                  marginTop: '4px',
                  opacity: phoneNumber.trim() ? 1 : 0.6
                }}
              >
                {loading ? 'Sending OTP...' : 'Next'} <ArrowRight size={16} />
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setServerInput(getServerBaseUrl());
                    setServerTestStatus('');
                    setShowServerModal(true);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Globe size={12} color="#0284c7" />
                  <span>Server Connection Settings</span>
                </button>
              </div>
            </form>
          </>
        )}

        {/* Step 2: OTP Verification */}
        {step === 2 && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' }}>
              <button 
                onClick={() => setStep(1)}
                className="glass-btn" 
                style={{ position: 'absolute', top: '18px', left: '18px', width: '32px', height: '32px' }}
              >
                <ArrowLeft size={16} color="var(--text-secondary)" />
              </button>

              <div className="glow-active" style={{
                width: '60px',
                height: '60px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(56, 189, 248, 0.25) 100%)',
                border: '2px solid rgba(255, 255, 255, 0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <ShieldCheck size={30} color="#16a34a" />
              </div>

              <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                Enter Verification Code
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                {useFirebaseSms ? '📩 Real SMS sent to ' : 'Sent to '} {countryCode} {phoneNumber}
              </p>
              {useFirebaseSms && (
                <span className="glass-pill" style={{
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: '#16a34a',
                  fontSize: '11px',
                  fontWeight: '700',
                  padding: '3px 10px',
                  marginTop: '2px'
                }}>
                  ✨ Check your phone Messages for 6-digit OTP
                </span>
              )}
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span className="glass-pill" style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '4px 12px'
                }}>
                  {errorMsg}
                </span>
                {errorMsg.includes('Backend unreachable') && (
                  <button
                    type="button"
                    onClick={() => {
                      setServerInput(getServerBaseUrl());
                      setServerTestStatus('');
                      setShowServerModal(true);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      marginTop: '2px'
                    }}
                  >
                    ⚙️ Fix / Update Server URL
                  </button>
                )}
              </div>
            )}

            {/* OTP Input Form */}
            <form onSubmit={handleVerifyOtp} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input 
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').substring(0, 6))}
                placeholder="• • • • • •"
                maxLength="6"
                className="glass-input"
                autoFocus
                style={{
                  fontSize: '24px',
                  fontWeight: '800',
                  textAlign: 'center',
                  letterSpacing: '10px',
                  padding: '12px 16px'
                }}
              />

              {/* Resend Timer */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {timer > 0 ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Resend code in {timer}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: '700',
                      color: '#0284c7',
                      cursor: 'pointer'
                    }}
                  >
                    Resend OTP
                  </button>
                )}
              </div>

              <button 
                type="submit" 
                disabled={loading || otp.length < 6}
                className="glass-btn glass-btn-primary"
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '700',
                  marginTop: '6px',
                  opacity: otp.length === 6 ? 1 : 0.6
                }}
              >
                {loading ? 'Verifying...' : 'Verify OTP'}
              </button>
            </form>
          </>
        )}

        {/* Step 3: New User Profile Setup */}
        {step === 3 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                Profile Setup
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Please provide your name and an avatar
              </p>
            </div>

            {/* Avatar Selection with Custom Upload */}
            <div style={{ position: 'relative' }}>
              <img 
                src={userAvatar} 
                alt="Profile"
                style={{
                  width: '88px',
                  height: '88px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid rgba(255, 255, 255, 0.95)',
                  boxShadow: '0 6px 22px rgba(0, 0, 0, 0.1)'
                }}
              />
              <label 
                htmlFor="avatar-upload-auth"
                style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '2px',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  backgroundColor: '#0284c7',
                  border: '2px solid #ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                }}
                title="Upload Photo from Phone/PC"
              >
                <Camera size={15} color="#ffffff" />
              </label>
              <input 
                id="avatar-upload-auth"
                type="file" 
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setUserAvatar(ev.target.result);
                  reader.readAsDataURL(file);
                }}
                style={{ display: 'none' }}
              />
            </div>

            <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '600' }}>
              Tap camera icon to upload custom photo or pick below:
            </span>

            {/* Quick Avatar options */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {sampleAvatars.map((av, idx) => (
                <img 
                  key={idx}
                  src={av} 
                  alt={`avatar-${idx}`}
                  onClick={() => setUserAvatar(av)}
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    cursor: 'pointer',
                    border: userAvatar === av ? '2px solid #0284c7' : '2px solid rgba(255, 255, 255, 0.8)'
                  }}
                />
              ))}
            </div>

            {/* Name and Status Form */}
            <form onSubmit={handleSaveProfile} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input 
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Type your name here..."
                required
                className="glass-input"
                style={{ fontSize: '14px' }}
              />

              <input 
                type="text" 
                value={userStatus}
                onChange={(e) => setUserStatus(e.target.value)}
                placeholder="Status / About (e.g., Available | GlassChat)"
                className="glass-input"
                style={{ fontSize: '13px' }}
              />

              <button 
                type="submit" 
                disabled={loading || !userName.trim()}
                className="glass-btn glass-btn-primary"
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '700',
                  marginTop: '8px',
                  opacity: userName.trim() ? 1 : 0.6
                }}
              >
                {loading ? 'Saving...' : 'Start Chatting'}
              </button>
            </form>
          </>
        )}

        {/* STEP 4: TWO-STEP VERIFICATION 6-DIGIT PIN */}
        {step === 4 && (
          <>
            <button 
              onClick={() => {
                setStep(1);
                setOtp('');
                setTwoStepPinInput('');
                setErrorMsg('');
              }}
              className="glass-btn"
              style={{ position: 'absolute', top: '16px', left: '16px', width: '34px', height: '34px' }}
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div className="glow-active" style={{
                width: '60px',
                height: '60px',
                borderRadius: '18px',
                backgroundColor: 'rgba(2, 132, 199, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0284c7',
                border: '1px solid rgba(2, 132, 199, 0.3)',
                boxShadow: '0 8px 24px rgba(2, 132, 199, 0.2)'
              }}>
                <KeyRound size={30} />
              </div>

              <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                Two-Step Verification
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, maxWidth: '280px' }}>
                This phone number is protected with a 6-digit PIN. Enter your PIN to continue.
              </p>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span className="glass-pill" style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '4px 12px'
                }}>
                  {errorMsg}
                </span>
                {errorMsg.includes('Backend unreachable') && (
                  <button
                    type="button"
                    onClick={() => {
                      setServerInput(getServerBaseUrl());
                      setServerTestStatus('');
                      setShowServerModal(true);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      marginTop: '2px'
                    }}
                  >
                    ⚙️ Fix / Update Server URL
                  </button>
                )}
              </div>
            )}

            {/* PIN Input Form */}
            <form onSubmit={handleVerifyTwoStep} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input 
                type="password"
                inputMode="numeric"
                value={twoStepPinInput}
                onChange={(e) => setTwoStepPinInput(e.target.value.replace(/\D/g, '').substring(0, 6))}
                placeholder="• • • • • •"
                maxLength="6"
                className="glass-input"
                autoFocus
                style={{
                  fontSize: '26px',
                  fontWeight: '800',
                  textAlign: 'center',
                  letterSpacing: '10px',
                  padding: '12px 16px'
                }}
              />

              <button 
                type="submit" 
                disabled={loading || twoStepPinInput.length !== 6}
                className="glass-btn glass-btn-primary"
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  opacity: twoStepPinInput.length === 6 ? 1 : 0.6
                }}
              >
                {loading ? 'Verifying...' : 'Verify PIN & Continue'}
                <ArrowRight size={16} />
              </button>
            </form>
          </>
        )}
        {/* SERVER CONNECTION MODAL */}
        {showServerModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(16px)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}>
            <div className="glass-panel" style={{
              width: '100%',
              maxWidth: '380px',
              borderRadius: '24px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              backgroundColor: '#ffffff'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Globe size={18} color="#0284c7" />
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                    Server URL Settings
                  </h3>
                </div>
                <button onClick={() => setShowServerModal(false)} className="glass-btn" style={{ width: '28px', height: '28px' }}>
                  <X size={14} />
                </button>
              </div>

              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.4 }}>
                If you restarted the PC or changed the Cloudflare tunnel, enter the active tunnel URL below:
              </p>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '4px' }}>
                  Backend Server URL
                </label>
                <input
                  type="text"
                  value={serverInput}
                  onChange={(e) => setServerInput(e.target.value)}
                  placeholder="https://xxx.trycloudflare.com"
                  className="glass-input"
                  style={{ width: '100%', fontSize: '12px', padding: '8px 10px' }}
                />
              </div>

              {serverTestStatus && (
                <div style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  color: serverTestStatus.includes('✅') ? '#16a34a' : '#ef4444',
                  padding: '6px 10px',
                  borderRadius: '10px',
                  backgroundColor: serverTestStatus.includes('✅') ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.1)'
                }}>
                  {serverTestStatus}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => handleTestServer()}
                  disabled={serverTesting || !serverInput.trim()}
                  className="glass-btn"
                  style={{ flex: 1, padding: '9px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                >
                  <RefreshCw size={13} className={serverTesting ? 'spin-anim' : ''} />
                  {serverTesting ? 'Testing...' : 'Test'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveServer}
                  className="glass-btn glass-btn-primary"
                  style={{ flex: 1, padding: '9px', fontSize: '12px', fontWeight: '700' }}
                >
                  Save & Connect
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetServer}
                style={{ background: 'none', border: 'none', fontSize: '11px', color: '#94a3b8', cursor: 'pointer', textAlign: 'center' }}
              >
                Reset to Default Tunnel URL
              </button>
            </div>
          </div>
        )}

        {/* Invisible Firebase reCAPTCHA Container */}
        <div id="recaptcha-container"></div>
      </div>
    </div>
  );
}

