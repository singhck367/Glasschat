import React, { useState, useEffect, useRef } from 'react';
import {
  Download, X, CheckCircle2, ArrowUpCircle, ShieldCheck,
  RefreshCw, AlertCircle, Apple, Smartphone, Share, Copy, Check, ChevronDown, ChevronUp, Sparkles
} from 'lucide-react';
import { getServerBaseUrl } from '../services/config';

export default function AppUpdateModal({ updateInfo, onClose, currentVersion = '1.0.0' }) {
  if (!updateInfo) return null;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  const isAndroid = /Android/i.test(ua);
  const isCapacitorNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
  const isStandalone = typeof window !== 'undefined' && (
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches
  );
  const isNonSafariIos = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|WhatsApp|FBAN|FBAV|Instagram|Line/i.test(ua);

  // 'idle' | 'downloading' | 'ready' | 'error'
  const [downloadStatus, setDownloadStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [downloadedMb, setDownloadedMb] = useState('0');
  const [totalMb, setTotalMb] = useState(isIOS ? '1.0' : '4.4');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showDeveloperIpa, setShowDeveloperIpa] = useState(false);
  const [pwaPrompt, setPwaPrompt] = useState(() => (typeof window !== 'undefined' ? window.__pwaInstallPrompt : null));
  const downloadedBlobRef = useRef(null);

  useEffect(() => {
    const onPwaReady = () => {
      setPwaPrompt(window.__pwaInstallPrompt);
    };
    window.addEventListener('glasschat-pwa-ready', onPwaReady);
    return () => {
      window.removeEventListener('glasschat-pwa-ready', onPwaReady);
    };
  }, []);

  const appWebUrl = getServerBaseUrl().replace(/\/+$/, '');

  const resolveDownloadUrl = (overridePath = null) => {
    const rawUrl = overridePath || (isIOS
      ? (updateInfo.iosDownloadUrl || '/download-ipa')
      : (updateInfo.downloadUrl || '/download-apk'));
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return rawUrl;
    }
    const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    return `${appWebUrl}${path}`;
  };

  const handleInstallPwa = async () => {
    if (!pwaPrompt) return;
    try {
      pwaPrompt.prompt();
      const { outcome } = await pwaPrompt.userChoice;
      if (outcome === 'accepted') {
        window.__pwaInstallPrompt = null;
        setPwaPrompt(null);
        onClose?.();
      }
    } catch (err) {
      console.warn('PWA install prompt error:', err);
    }
  };

  const handleInstantRefreshUpdate = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
    } catch (e) {
      console.warn('Cache refresh warning:', e);
    }
    window.location.reload();
  };

  const handleCopyWebUrl = async () => {
    try {
      await navigator.clipboard.writeText(appWebUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      alert(`Open in Safari:\n${appWebUrl}`);
    }
  };

  const handleStartApkDownload = async () => {
    const targetUrl = resolveDownloadUrl(updateInfo.downloadUrl || '/download-apk');

    // Inside Capacitor native shell: open Chrome/system browser cleanly (avoids REQUEST_INSTALL_PACKAGES dropper flags)
    if (isCapacitorNative) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      setDownloadStatus('ready');
      return;
    }

    setDownloadStatus('downloading');
    setProgress(0);
    setErrorMsg('');

    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const contentLength = +response.headers.get('Content-Length') || 4428000;
      setTotalMb((contentLength / (1024 * 1024)).toFixed(1));

      const reader = response.body.getReader();
      let receivedLength = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;

        const pct = Math.min(99, Math.round((receivedLength / contentLength) * 100));
        setProgress(pct);
        setDownloadedMb((receivedLength / (1024 * 1024)).toFixed(1));
      }

      const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
      downloadedBlobRef.current = blob;
      setProgress(100);
      setDownloadStatus('ready');
    } catch (err) {
      console.error('APK download error:', err);
      setDownloadStatus('error');
      setErrorMsg(err.message || 'Network error while downloading.');
    }
  };

  const handleSaveApk = () => {
    if (downloadedBlobRef.current) {
      const url = URL.createObjectURL(downloadedBlobRef.current);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'GlassChat.apk';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } else {
      window.open(resolveDownloadUrl(updateInfo.downloadUrl || '/download-apk'), '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 200,
      backgroundColor: 'rgba(15, 23, 42, 0.78)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '430px',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: '30px',
          padding: '24px 20px',
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          boxShadow: '0 28px 70px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.9)',
          position: 'relative',
          animation: 'glassModalEnter 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Glow accent */}
        <div style={{
          position: 'absolute',
          top: '-60px',
          right: '-60px',
          width: '160px',
          height: '160px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
          filter: 'blur(50px)',
          opacity: 0.32,
          pointerEvents: 'none'
        }} />

        {/* Close Button */}
        {!updateInfo.forceUpdate && downloadStatus !== 'downloading' && (
          <button
            onClick={onClose}
            className="glass-btn"
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'rgba(0, 0, 0, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={16} color="var(--text-secondary)" />
          </button>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '18px',
            background: downloadStatus === 'ready'
              ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
              : 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: downloadStatus === 'ready'
              ? '0 8px 24px rgba(16, 185, 129, 0.35)'
              : '0 8px 24px rgba(2, 132, 199, 0.35)'
          }}>
            {downloadStatus === 'ready' ? (
              <CheckCircle2 size={28} color="#ffffff" />
            ) : isIOS ? (
              <Apple size={28} color="#ffffff" />
            ) : (
              <ArrowUpCircle size={28} color="#ffffff" />
            )}
          </div>

          <div style={{ paddingRight: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="glass-pill" style={{
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: '800',
                color: downloadStatus === 'ready' ? '#059669' : '#0284c7',
                backgroundColor: downloadStatus === 'ready' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(2, 132, 199, 0.12)'
              }}>
                {isIOS
                  ? 'iPHONE / iPAD'
                  : (downloadStatus === 'ready'
                    ? 'READY TO INSTALL'
                    : (updateInfo.alreadyLatest ? 'UP TO DATE' : 'UPDATE AVAILABLE'))}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                v{updateInfo.latestVersion || '1.3.1'}
              </span>
            </div>
            <h3 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--text-primary)', margin: '4px 0 0 0' }}>
              {isIOS
                ? 'GlassChat for iPhone'
                : (updateInfo.alreadyLatest ? `GlassChat v${currentVersion} Active ✨` : (updateInfo.title || 'New GlassChat Update'))}
            </h3>
          </div>
        </div>

        {/* Version Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderRadius: '14px',
          backgroundColor: 'rgba(0, 0, 0, 0.03)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          marginBottom: '14px',
          fontSize: '12px'
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>Installed: <strong>v{currentVersion}</strong></span>
          <span style={{ color: '#0284c7', fontWeight: '800' }}>
            {isIOS ? 'iOS Web App / PWA' : `GlassChat.apk (v${updateInfo.latestVersion || '1.3.1'})`}
          </span>
        </div>

        {/* ========================================= */}
        {/* iOS SPECIFIC SECTION (HONEST & WORKING!) */}
        {/* ========================================= */}
        {isIOS && (
          <div style={{ marginBottom: '14px' }}>
            {isStandalone ? (
              <div style={{
                padding: '14px',
                borderRadius: '18px',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '13px', fontWeight: '800', color: '#065f46', marginBottom: '4px' }}>
                  ⚡ iPhone Instant Live Update Ready
                </div>
                <p style={{ fontSize: '12px', color: '#047857', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                  Aap iPhone Home Screen app par hain. Koi `.ipa` download karne ki zarurat nahi — niche button dabate hi naya version load ho jayega!
                </p>
                <button
                  onClick={handleInstantRefreshUpdate}
                  className="glass-btn glass-btn-primary"
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontWeight: '800',
                    fontSize: '13px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                  }}
                >
                  <RefreshCw size={16} />
                  Update & Reload App Now
                </button>
              </div>
            ) : (
              <div style={{
                padding: '14px',
                borderRadius: '18px',
                backgroundColor: 'rgba(2, 132, 199, 0.06)',
                border: '1px solid rgba(2, 132, 199, 0.22)',
                marginBottom: '12px',
                fontSize: '12px',
                lineHeight: '1.45'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800', color: '#0284c7', marginBottom: '8px', fontSize: '13px' }}>
                  <Sparkles size={15} />
                  <span>iPhone par Install kaise karein (100% Working)</span>
                </div>

                {isNonSafariIos && (
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(245, 158, 11, 0.14)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: '#92400e',
                    fontSize: '11px',
                    fontWeight: '700',
                    marginBottom: '10px'
                  }}>
                    ⚠️ Aap Safari browser mein nahi hain! iPhone par app install karne ke liye link copy karke <strong>Safari</strong> browser me kholein.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--text-primary)' }}>
                  <div><strong>Step 1:</strong> Safari browser mein <code>{appWebUrl}</code> kholein.</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    <strong>Step 2:</strong> Niche Safari ke <strong>Share</strong> icon (<Share size={13} style={{ display: 'inline', verticalAlign: 'middle' }} />) par tap karein.
                  </div>
                  <div><strong>Step 3:</strong> Scroll karke <strong>"Add to Home Screen" ➔ "Add"</strong> tap karein.</div>
                </div>

                <p style={{ fontSize: '11px', color: '#0369a1', margin: '8px 0 10px 0', fontWeight: '600' }}>
                  ✅ Isse GlassChat icon ke saath Home Screen par install ho jayegi, bina Apple certificate error ke aur har update automatic milega!
                </p>

                <button
                  onClick={handleCopyWebUrl}
                  className="glass-btn"
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    fontWeight: '700',
                    fontSize: '12px',
                    color: '#0284c7',
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(2, 132, 199, 0.25)'
                  }}
                >
                  {copiedUrl ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  {copiedUrl ? 'Link Copied! Paste in Safari' : 'Copy Link for Safari'}
                </button>
              </div>
            )}

            {/* Collapsible Developer IPA notice */}
            <div style={{
              borderRadius: '14px',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              backgroundColor: 'rgba(0, 0, 0, 0.02)',
              overflow: 'hidden'
            }}>
              <button
                type="button"
                onClick={() => setShowDeveloperIpa(!showDeveloperIpa)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: '700',
                  color: 'var(--text-secondary)'
                }}
              >
                <span>Developer Option: Download .IPA (PC / AltStore / Sideloadly)</span>
                {showDeveloperIpa ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showDeveloperIpa && (
                <div style={{ padding: '0 12px 12px 12px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  <p style={{ margin: '0 0 8px 0', color: '#b45309' }}>
                    ⚠️ Apple bina paid Developer Certificate ke Safari/Files se direct `.ipa` install allow nahi karta. `.ipa` file sirf PC (Sideloadly / AltStore) ke through sign karke install karne ke liye hai.
                  </p>
                  <button
                    onClick={() => window.open(resolveDownloadUrl(updateInfo.iosDownloadUrl || '/download-ipa'), '_blank', 'noopener,noreferrer')}
                    className="glass-btn"
                    style={{
                      width: '100%',
                      height: '36px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#0284c7'
                    }}
                  >
                    Download Raw GlassChat.ipa (For Sideloadly/AltStore)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================= */}
        {/* ANDROID SPECIFIC SECTION                  */}
        {/* ========================================= */}
        {!isIOS && (
          <>
            {isAndroid && (
              <div style={{
                padding: '10px 12px',
                borderRadius: '14px',
                backgroundColor: 'rgba(16, 185, 129, 0.07)',
                border: '1px solid rgba(16, 185, 129, 0.24)',
                marginBottom: '12px',
                fontSize: '11px',
                lineHeight: '1.4',
                color: '#065f46'
              }}>
                <strong>🛡️ Android Clean Update (v{updateInfo.latestVersion || '1.3.1'}):</strong><br />
                1. Sabhi Play Protect warning triggers (<code>REQUEST_INSTALL_PACKAGES</code>) hata diye gaye hain.<br />
                2. Agar phone me purana debug build hai, to conflict se bachne ke liye pehle purana app uninstall karke install karein.<br />
                3. Sideload APK par agar Play Protect <strong>"Unknown developer"</strong> puche to <strong>More details ➔ Install anyway</strong> tap karein.
              </div>
            )}

            {/* Release Notes */}
            {downloadStatus === 'idle' && (
              <div style={{ marginBottom: '14px' }}>
                <h4 style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  What's New in this Release:
                </h4>
                <div style={{
                  maxHeight: '130px',
                  overflowY: 'auto',
                  padding: '10px 12px',
                  borderRadius: '16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.75)',
                  border: '1px solid rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '7px'
                }}>
                  {Array.isArray(updateInfo.releaseNotes) ? (
                    updateInfo.releaseNotes.map((note, index) => (
                      <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.35' }}>
                        <CheckCircle2 size={14} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>{note}</span>
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: '12px', color: 'var(--text-primary)', margin: 0 }}>
                      {updateInfo.releaseNotes || 'Play Protect clean release signing, performance & call stability fixes.'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Downloading Progress */}
            {downloadStatus === 'downloading' && (
              <div style={{
                padding: '16px',
                borderRadius: '20px',
                backgroundColor: 'rgba(2, 132, 199, 0.04)',
                border: '1px solid rgba(2, 132, 199, 0.12)',
                marginBottom: '14px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <RefreshCw size={15} color="#0284c7" style={{ animation: 'spin 1.2s linear infinite' }} />
                    <span style={{ fontSize: '13px', fontWeight: '800', color: '#0284c7' }}>Downloading GlassChat.apk...</span>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#0284c7' }}>{progress}%</span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(0, 0, 0, 0.08)',
                  overflow: 'hidden',
                  marginBottom: '8px'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, #0284c7 0%, #6366f1 100%)',
                    borderRadius: '999px',
                    transition: 'width 0.25s ease'
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  <span>{downloadedMb} MB of {totalMb} MB</span>
                  <span>Signed Release Package</span>
                </div>
              </div>
            )}

            {/* Ready Notice */}
            {downloadStatus === 'ready' && (
              <div style={{
                padding: '14px',
                borderRadius: '18px',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                marginBottom: '14px',
                textAlign: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '4px' }}>
                  <CheckCircle2 size={18} color="#10b981" />
                  <span style={{ fontSize: '14px', fontWeight: '800', color: '#065f46' }}>
                    {isCapacitorNative ? 'Browser Download Started!' : 'APK Download Ready!'}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#047857', margin: 0 }}>
                  {isCapacitorNative
                    ? 'Browser se download complete hone par notification ya Downloads me APK tap karke install karein.'
                    : 'Niche button par tap karke GlassChat.apk save & install karein.'}
                </p>
              </div>
            )}

            {/* Error State */}
            {downloadStatus === 'error' && (
              <div style={{
                padding: '12px',
                borderRadius: '14px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <AlertCircle size={20} color="#ef4444" style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#b91c1c' }}>Download Failed</div>
                  <div style={{ fontSize: '11px', color: '#dc2626' }}>{errorMsg || 'Please check your internet connection.'}</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Security Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', fontSize: '11px', color: '#10b981' }}>
          <ShieldCheck size={14} />
          <span>Official v1+v2+v3 Signed Release • Clean HTTPS Build</span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Zero-Warning Chrome PWA Install Button (Android Browser) */}
          {pwaPrompt && !isCapacitorNative && !isStandalone && (
            <button
              onClick={handleInstallPwa}
              className="glass-btn glass-btn-primary"
              style={{
                width: '100%',
                height: '46px',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: '800',
                fontSize: '13px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 8px 24px rgba(16, 185, 129, 0.35)'
              }}
            >
              <Smartphone size={16} />
              Install Web App (0 Warnings • Auto-Updates)
            </button>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            {!updateInfo.forceUpdate && downloadStatus !== 'downloading' && (
              <button
                onClick={onClose}
                className="glass-btn"
                style={{
                  flex: 1,
                  height: '44px',
                  borderRadius: '16px',
                  fontWeight: '700',
                  fontSize: '13px',
                  color: 'var(--text-secondary)'
                }}
              >
                {isIOS ? 'Close' : 'Later'}
              </button>
            )}

            {!isIOS && downloadStatus === 'idle' && (
              <button
                onClick={handleStartApkDownload}
                className="glass-btn glass-btn-primary"
                style={{
                  flex: 2,
                  height: '44px',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: '800',
                  fontSize: '13px',
                  background: 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)',
                  boxShadow: '0 8px 24px rgba(2, 132, 199, 0.35)'
                }}
              >
                <Download size={16} />
                Download Clean APK (4.4 MB)
              </button>
            )}

            {!isIOS && downloadStatus === 'downloading' && (
              <button
                disabled
                style={{
                  flex: 1,
                  height: '44px',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: '800',
                  fontSize: '13px',
                  color: '#ffffff',
                  backgroundColor: 'rgba(2, 132, 199, 0.5)',
                  cursor: 'not-allowed',
                  border: 'none'
                }}
              >
                <RefreshCw size={16} style={{ animation: 'spin 1.2s linear infinite' }} />
                Downloading ({progress}%)...
              </button>
            )}

            {!isIOS && downloadStatus === 'ready' && !isCapacitorNative && (
              <button
                onClick={handleSaveApk}
                className="glass-btn glass-btn-primary"
                style={{
                  flex: 2,
                  height: '44px',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: '800',
                  fontSize: '13px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  boxShadow: '0 8px 24px rgba(16, 185, 129, 0.35)'
                }}
              >
                <CheckCircle2 size={16} />
                Save & Install GlassChat.apk
              </button>
            )}

            {!isIOS && downloadStatus === 'error' && (
              <button
                onClick={handleStartApkDownload}
                className="glass-btn glass-btn-primary"
                style={{
                  flex: 2,
                  height: '44px',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: '800',
                  fontSize: '13px'
                }}
              >
                <RefreshCw size={16} />
                Retry Download
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
