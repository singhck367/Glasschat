import React from 'react';
import { Sparkles, Download, X, CheckCircle2, ArrowUpCircle, ShieldCheck } from 'lucide-react';

export default function AppUpdateModal({ updateInfo, onClose, currentVersion = '1.0.0' }) {
  if (!updateInfo) return null;

  const handleDownload = () => {
    if (updateInfo.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank');
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
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div 
        className="glass-panel" 
        style={{
          width: '100%',
          maxWidth: '440px',
          borderRadius: '28px',
          padding: '26px 22px',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.9)',
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
        {!updateInfo.forceUpdate && (
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
            background: 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(2, 132, 199, 0.35)'
          }}>
            <ArrowUpCircle size={28} color="#ffffff" />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="glass-pill" style={{
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: '800',
                color: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.12)'
              }}>
                UPDATE AVAILABLE
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                v{updateInfo.latestVersion || '1.2.0'}
              </span>
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: '4px 0 0 0' }}>
              {updateInfo.title || 'New GlassChat Update'}
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
          marginBottom: '16px',
          fontSize: '12px'
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>Installed: <strong>v{currentVersion}</strong></span>
          <span style={{ color: '#0284c7', fontWeight: '800' }}>Latest: <strong>v{updateInfo.latestVersion || '1.2.0'}</strong></span>
        </div>

        {/* Release Notes */}
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            What's New in this Release:
          </h4>
          <div style={{
            maxHeight: '180px',
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

        {/* Security badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '18px', fontSize: '11px', color: '#10b981' }}>
          <ShieldCheck size={14} />
          <span>Official Verified Release • Safe to Install</span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {!updateInfo.forceUpdate && (
            <button
              onClick={onClose}
              className="glass-btn"
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '14px',
                fontWeight: '700',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}
            >
              Later
            </button>
          )}

          <button
            onClick={handleDownload}
            className="glass-btn glass-btn-primary"
            style={{
              flex: 2,
              height: '44px',
              borderRadius: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontWeight: '800',
              fontSize: '13px',
              boxShadow: '0 8px 20px rgba(2, 132, 199, 0.35)'
            }}
          >
            <Download size={16} />
            Update Now (Download APK)
          </button>
        </div>
      </div>
    </div>
  );
}
