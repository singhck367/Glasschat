import React from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';

export default function IncomingCallModal({ 
  incomingCall, 
  onAccept, 
  onDecline 
}) {
  if (!incomingCall) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 120,
      backgroundColor: 'rgba(240, 249, 255, 0.92)',
      backdropFilter: 'blur(28px) saturate(180%)',
      WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '48px 24px',
      overflow: 'hidden'
    }}>
      {/* Top Status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <span className="glass-pill" style={{
          padding: '6px 18px',
          fontSize: '12px',
          fontWeight: '700',
          color: '#0284c7',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          {incomingCall.isVideo ? <Video size={14} /> : <Phone size={14} />}
          Incoming {incomingCall.isVideo ? 'Video' : 'Audio'} Call
        </span>
        <h2 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '6px' }}>
          {incomingCall.fromName}
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          GlassChat Ringing...
        </p>
      </div>

      {/* Pulsing Avatar */}
      <div className="glow-active" style={{
        borderRadius: '50%',
        padding: '10px',
        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.3) 0%, rgba(147, 197, 253, 0.3) 100%)'
      }}>
        <img 
          src={incomingCall.fromAvatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80'} 
          alt={incomingCall.fromName}
          style={{
            width: '130px',
            height: '130px',
            borderRadius: '50%',
            objectFit: 'cover',
            border: '4px solid rgba(255, 255, 255, 0.95)',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.12)'
          }}
        />
      </div>

      {/* Action Buttons: Decline & Accept */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '48px' }}>
        {/* Decline */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <button 
            onClick={onDecline}
            className="glass-btn glass-btn-danger"
            style={{ width: '64px', height: '64px', borderRadius: '50%' }}
          >
            <PhoneOff size={26} />
          </button>
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
            Decline
          </span>
        </div>

        {/* Accept */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <button 
            onClick={onAccept}
            className="glass-btn"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              color: '#ffffff',
              boxShadow: '0 4px 18px rgba(34, 197, 94, 0.45)'
            }}
          >
            {incomingCall.isVideo ? <Video size={26} /> : <Phone size={26} />}
          </button>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#16a34a' }}>
            Accept
          </span>
        </div>
      </div>
    </div>
  );
}

