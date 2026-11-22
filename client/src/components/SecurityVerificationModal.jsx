import React from 'react';
import { ShieldCheck, Lock, X, QrCode } from 'lucide-react';
import { generateSecurityCode } from '../services/crypto';

export default function SecurityVerificationModal({ 
  currentUserId, 
  targetUser, 
  onClose 
}) {
  const securityCode = generateSecurityCode(currentUserId, targetUser?.id || 'target');

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 150,
      backgroundColor: 'rgba(235, 244, 255, 0.88)',
      backdropFilter: 'blur(28px) saturate(180%)',
      WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '380px',
        borderRadius: '28px',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        boxShadow: 'var(--glass-shadow-lg)',
        position: 'relative'
      }}>
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="glass-btn" 
          style={{ position: 'absolute', top: '16px', right: '16px', width: '32px', height: '32px' }}
        >
          <X size={16} color="var(--text-secondary)" />
        </button>

        {/* Lock Icon */}
        <div className="glow-active" style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          backgroundColor: 'rgba(2, 132, 199, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid rgba(255, 255, 255, 0.9)'
        }}>
          <Lock size={26} color="#0284c7" />
        </div>

        <div style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
            Verify Security Code
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
            Messages and calls with <strong>{targetUser?.name || 'this contact'}</strong> are end-to-end encrypted. No third party can read or listen to them.
          </p>
        </div>

        {/* QR Code representation */}
        <div className="glass-card" style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(255, 255, 255, 0.75)'
        }}>
          <QrCode size={110} color="#0f172a" strokeWidth={1.5} />
          <span style={{ fontSize: '10px', color: '#64748b', fontWeight: '600' }}>
            SCAN CODE TO VERIFY
          </span>
        </div>

        {/* 60-digit code */}
        <div className="glass-card" style={{
          padding: '12px',
          width: '100%',
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.5)'
        }}>
          <p style={{
            fontFamily: 'monospace',
            fontSize: '13px',
            fontWeight: '700',
            letterSpacing: '1px',
            color: '#0f172a',
            lineHeight: 1.6,
            margin: 0
          }}>
            {securityCode}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShieldCheck size={16} color="#16a34a" />
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#16a34a' }}>
            End-to-End Encryption Active
          </span>
        </div>
      </div>
    </div>
  );
}

