import React, { useState, useEffect, useRef } from 'react';
import { Download, X, CheckCircle2, ArrowUpCircle, ShieldCheck, RefreshCw, AlertCircle, Apple, Smartphone, Share2, HelpCircle } from 'lucide-react';
import { getServerBaseUrl } from '../services/config';

export default function AppUpdateModal({ updateInfo, onClose, currentVersion = '1.0.0' }) {
  if (!updateInfo) return null;

  // Platform detection
  const isIOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
  const isNativeAndroid = typeof window !== 'undefined' && !!window.AndroidInstaller;

  // 'idle' | 'downloading' | 'ready' | 'error'
  const [downloadStatus, setDownloadStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [downloadedMb, setDownloadedMb] = useState('0');
  const [totalMb, setTotalMb] = useState(isIOS ? '1.0' : '5.5');
  const [errorMsg, setErrorMsg] = useState('');
  const [showIosGuide, setShowIosGuide] = useState(false);
  const downloadedBlobRef = useRef(null);

  // Clean up global callbacks on unmount
  useEffect(() => {
    return () => {
      window.__onApkDownloadProgress = null;
      window.__onApkDownloadComplete = null;
      window.__onApkDownloadError = null;
    };
  }, []);

  const resolveDownloadUrl = () => {
    const rawUrl = isIOS 
      ? (updateInfo.iosDownloadUrl || '/download-ipa')
      : (updateInfo.downloadUrl || '/download-apk');
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return rawUrl;
    }
    const base = getServerBaseUrl().replace(/\/+$/, '');
    const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    return `${base}${path}`;
  };

  const handleStartDownload = async () => {
    setDownloadStatus('downloading');
    setProgress(0);
    setErrorMsg('');

    const targetUrl = resolveDownloadUrl();

    // 1. Native Android Capacitor App via AndroidInstaller Bridge
    if (isNativeAndroid) {
      window.__onApkDownloadProgress = (percent, curBytes, totBytes) => {
        setProgress(Math.min(100, Math.max(0, percent)));
        if (totBytes > 0) {
          setDownloadedMb((curBytes / (1024 * 1024)).toFixed(1));
          setTotalMb((totBytes / (1024 * 1024)).toFixed(1));
        }
      };

      window.__onApkDownloadComplete = () => {
        setProgress(100);
        setDownloadStatus('ready');
      };

      window.__onApkDownloadError = (err) => {
        console.error('Native APK download error:', err);
        setDownloadStatus('error');
        setErrorMsg(err || 'Failed to download update package.');
      };

      try {
        window.AndroidInstaller.startDownload(targetUrl);
      } catch (e) {
        console.error('AndroidInstaller call failed:', e);
        setDownloadStatus('error');
        setErrorMsg(e.message || 'Could not start background downloader.');
      }
      return;
    }

    // 2. iOS or Web browser fallback with in-app streaming download
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const contentLength = +response.headers.get('Content-Length') || (isIOS ? 1000000 : 5580000);
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

      const mimeType = isIOS ? 'application/octet-stream' : 'application/vnd.android.package-archive';
      const blob = new Blob(chunks, { type: mimeType });
      downloadedBlobRef.current = blob;
      setProgress(100);
      setDownloadStatus('ready');

    } catch (err) {
      console.error('Download error:', err);
      setDownloadStatus('error');
      setErrorMsg(err.message || 'Network error while downloading.');
    }
  };

  const handleInstallNow = () => {
    // 1. Native Android APK Installer
    if (isNativeAndroid) {
      try {
        window.AndroidInstaller.installDownloadedApk();
      } catch (e) {
        console.error('Install call error:', e);
        alert('Could not launch system installer: ' + e.message);
      }
      return;
    }

    // 2. iOS Specific Handling
    if (isIOS) {
      if (downloadedBlobRef.current) {
        const url = URL.createObjectURL(downloadedBlobRef.current);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'GlassChat.ipa';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      } else {
        window.open(resolveDownloadUrl(), '_blank');
      }
      setShowIosGuide(true);
      return;
    }

    // 3. Android Web browser fallback: trigger save APK file
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
      window.open(resolveDownloadUrl(), '_blank');
    }
  };

  const handleIosOtaInstall = () => {
    const base = getServerBaseUrl().replace(/\/+$/, '');
    const manifestUrl = `${base}/ios-manifest.plist`;
    window.location.href = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
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
      padding: '20px'
    }}>
      <div 
        className="glass-panel" 
        style={{
          width: '100%',
          maxWidth: '430px',
          borderRadius: '30px',
          padding: '26px 22px',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          boxShadow: '0 28px 70px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.9)',
          position: 'relative',
          overflow: 'hidden',
          animation: 'glassModalEnter 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Glow ambient background inside modal */}
        <div style={{
          position: 'absolute',
          top: '-60px',
          right: '-60px',
          width: '160px',
          height: '160px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
          filter: 'blur(50px)',
          opacity: 0.35,
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

        {/* Header with Icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
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
            boxShadow: downloadStatus === 'ready'
              ? '0 8px 24px rgba(16, 185, 129, 0.35)'
              : '0 8px 24px rgba(2, 132, 199, 0.35)',
            transition: 'all 0.3s ease'
          }}>
            {downloadStatus === 'ready' ? (
              <CheckCircle2 size={28} color="#ffffff" />
            ) : (
              <ArrowUpCircle size={28} color="#ffffff" />
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="glass-pill" style={{
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: '800',
                color: downloadStatus === 'ready' ? '#059669' : '#0284c7',
                backgroundColor: downloadStatus === 'ready' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(2, 132, 199, 0.12)'
              }}>
                {downloadStatus === 'ready' ? 'READY TO INSTALL' : (downloadStatus === 'downloading' ? 'DOWNLOADING UPDATE' : 'UPDATE AVAILABLE')}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                v{updateInfo.latestVersion || '1.3.0'}
              </span>
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: '4px 0 0 0' }}>
              {isIOS ? 'GlassChat for iOS Update' : (updateInfo.title || 'New GlassChat Update')}
            </h3>
          </div>
        </div>

        {/* Current vs New Version Pill */}
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
            Package: <strong>{isIOS ? 'GlassChat.ipa' : 'GlassChat.apk'}</strong> ({isIOS ? '1 MB' : '5.5 MB'})
          </span>
        </div>

        {/* iOS Specific Guidance Card */}
        {isIOS && (
          <div style={{
            padding: '12px 14px',
            borderRadius: '16px',
            backgroundColor: 'rgba(2, 132, 199, 0.06)',
            border: '1px solid rgba(2, 132, 199, 0.2)',
            marginBottom: '14px',
            fontSize: '12px',
            lineHeight: '1.4'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800', color: '#0284c7', marginBottom: '6px' }}>
              <Apple size={15} />
              <span>iOS Installation Methods:</span>
            </div>
            <div style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>
              <strong>1. Instant Safari Update (Recommended):</strong> Safari me <strong>Share [↑] ➔ 'Add to Home Screen'</strong> tap karein. Bina kisi certificate ke instant update ho jayega!
            </div>
            <div style={{ color: 'var(--text-primary)' }}>
              <strong>2. Sideloading:</strong> Niche se <strong>Download iOS (.ipa)</strong> karke AltStore, Scarlet, TrollStore ya Sideloadly se install karein.
            </div>
          </div>
        )}

        {/* Android Play Protect Guidance Card */}
        {isAndroid && (
          <div style={{
            padding: '10px 12px',
            borderRadius: '14px',
            backgroundColor: 'rgba(16, 185, 129, 0.06)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            marginBottom: '14px',
            fontSize: '11px',
            lineHeight: '1.35',
            color: '#065f46'
          }}>
            <strong>🛡️ Play Protect / Safe Install Notice:</strong><br />
            Yeh APK official release key se signed hai. Install ke time agar 'Blocked by Play Protect' ya 'Unsafe app' prompt aaye, to <strong>'More details' ➔ 'Install anyway'</strong> select karein.
          </div>
        )}

        {/* Dynamic Body: Release Notes or Download Progress */}
        {downloadStatus === 'idle' && (
          <div style={{ marginBottom: '18px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              What's New in this Release:
            </h4>
            <div style={{
              maxHeight: '140px',
              overflowY: 'auto',
              padding: '10px 12px',
              borderRadius: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              border: '1px solid rgba(0, 0, 0, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {Array.isArray(updateInfo.releaseNotes) ? (
                updateInfo.releaseNotes.map((note, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                    <CheckCircle2 size={14} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>{note}</span>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: '12px', color: 'var(--text-primary)', margin: 0 }}>
                  {updateInfo.releaseNotes || 'Performance improvements, bug fixes and new advance call features.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* DOWNLOADING STATE UI */}
        {downloadStatus === 'downloading' && (
          <div style={{
            padding: '18px 16px',
            borderRadius: '20px',
            backgroundColor: 'rgba(2, 132, 199, 0.04)',
            border: '1px solid rgba(2, 132, 199, 0.12)',
            marginBottom: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RefreshCw size={15} color="#0284c7" style={{ animation: 'spin 1.2s linear infinite' }} />
                <span style={{ fontSize: '13px', fontWeight: '800', color: '#0284c7' }}>Downloading {isIOS ? 'GlassChat.ipa' : 'GlassChat.apk'}...</span>
              </div>
              <span style={{ fontSize: '13px', fontWeight: '800', color: '#0284c7' }}>{progress}%</span>
            </div>

            {/* Sleek Progress Bar */}
            <div style={{
              width: '100%',
              height: '8px',
              borderRadius: '999px',
              backgroundColor: 'rgba(0, 0, 0, 0.08)',
              overflow: 'hidden',
              marginBottom: '10px'
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
              <span>Downloading package...</span>
            </div>
          </div>
        )}

        {/* READY / COMPLETED STATE UI */}
        {downloadStatus === 'ready' && (
          <div style={{
            padding: '16px',
            borderRadius: '20px',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            marginBottom: '18px',
            textAlign: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '4px' }}>
              <CheckCircle2 size={18} color="#10b981" />
              <span style={{ fontSize: '14px', fontWeight: '800', color: '#065f46' }}>Download Completed!</span>
            </div>
            <p style={{ fontSize: '12px', color: '#047857', margin: 0 }}>
              {isIOS 
                ? 'GlassChat.ipa download ho gaya hai! Isse AltStore ya Scarlet se install karein, ya Safari Add to Home Screen use karein.' 
                : 'The update is ready to install directly without leaving the app.'}
            </p>
          </div>
        )}

        {/* ERROR STATE UI */}
        {downloadStatus === 'error' && (
          <div style={{
            padding: '14px',
            borderRadius: '16px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            marginBottom: '18px',
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

        {/* Security badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '18px', fontSize: '11px', color: '#10b981' }}>
          <ShieldCheck size={14} />
          <span>Official Signed Release • 100% Safe & Direct</span>
        </div>

        {/* Actions Button Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            {!updateInfo.forceUpdate && downloadStatus !== 'downloading' && (
              <button
                onClick={onClose}
                className="glass-btn"
                style={{
                  flex: 1,
                  height: '46px',
                  borderRadius: '16px',
                  fontWeight: '700',
                  fontSize: '13px',
                  color: 'var(--text-secondary)'
                }}
              >
                Later
              </button>
            )}

            {downloadStatus === 'idle' && (
              <button
                onClick={handleStartDownload}
                className="glass-btn glass-btn-primary"
                style={{
                  flex: 2,
                  height: '46px',
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
                {isIOS ? 'Download iOS (.ipa)' : 'Download Update (APK)'}
              </button>
            )}

            {downloadStatus === 'downloading' && (
              <button
                disabled
                style={{
                  flex: 1,
                  height: '46px',
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

            {downloadStatus === 'ready' && (
              <button
                onClick={handleInstallNow}
                className="glass-btn glass-btn-primary"
                style={{
                  flex: 2,
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
                <CheckCircle2 size={16} />
                {isIOS ? 'Open / Save GlassChat.ipa 📲' : 'Install & Update Now 🚀'}
              </button>
            )}

            {downloadStatus === 'error' && (
              <button
                onClick={handleStartDownload}
                className="glass-btn glass-btn-primary"
                style={{
                  flex: 2,
                  height: '46px',
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

          {/* Secondary iOS Direct OTA Button */}
          {isIOS && downloadStatus === 'idle' && (
            <button
              onClick={handleIosOtaInstall}
              className="glass-btn"
              style={{
                width: '100%',
                height: '40px',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: '700',
                fontSize: '12px',
                color: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.08)',
                border: '1px solid rgba(2, 132, 199, 0.2)'
              }}
            >
              <Apple size={14} />
              Try Direct iOS OTA Install (Safari)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
