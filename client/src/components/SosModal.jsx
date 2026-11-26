import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, X, ShieldAlert, Phone, MapPin, Check,
  Send, Users, MessageSquare, Clock, Plus
} from 'lucide-react';
import { lookupSavedName, getLast10 } from '../utils/contacts';

/**
 * Emergency SOS Modal:
 * - Configure up to 5 trusted emergency contacts from saved phonebook
 * - 3-second cancelable countdown before dispatching SOS
 * - Shares live GPS location + urgent socket alert + SMS fallback if offline/slow
 */
export default function SosModal({
  currentUser,
  savedContacts = [],
  savedContactsMap = {},
  onClose,
  onUserUpdate
}) {
  const [trustedContacts, setTrustedContacts] = useState(currentUser?.sosContacts || []);
  const [note, setNote] = useState('Emergency! Need immediate help.');
  const [countdown, setCountdown] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [locationInfo, setLocationInfo] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [savingContacts, setSavingContacts] = useState(false);

  const timerRef = useRef(null);

  useEffect(() => {
    setTrustedContacts(currentUser?.sosContacts || []);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentUser]);

  const toggleTrustedContact = async (phone, name) => {
    const clean10 = getLast10(phone);
    if (!clean10) return;

    const exists = trustedContacts.some(c => getLast10(c.phone || c) === clean10);
    const updated = exists
      ? trustedContacts.filter(c => getLast10(c.phone || c) !== clean10)
      : [...trustedContacts, { phone, name }].slice(0, 5);

    setTrustedContacts(updated);
    setSavingContacts(true);
    try {
      const res = await fetch('/api/auth/sos-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.id, trustedContacts: updated })
      });
      const data = await res.json();
      if (data.success && data.user) {
        onUserUpdate?.(data.user);
        localStorage.setItem('glasschat_user', JSON.stringify(data.user));
      }
    } catch (e) {
      console.error('SOS save error:', e);
    } finally {
      setSavingContacts(false);
    }
  };

  const getCurrentPositionAsync = () =>
    new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0)
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 15000 }
      );
    });

  const dispatchSosNow = async () => {
    setSending(true);
    const loc = await getCurrentPositionAsync();
    if (loc) setLocationInfo(loc);

    const locLink = loc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : 'Location unavailable';
    const fallbackSmsBody = `🆘 SOS EMERGENCY from ${currentUser?.name || currentUser?.phone}! ${note} Location: ${locLink}`;

    try {
      const res = await fetch('/api/sos/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser?.id,
          location: loc,
          note: note.trim()
        })
      });
      const data = await res.json();
      setResult({
        success: Boolean(data.success),
        notifiedCount: data.notifiedCount || 0,
        sosText: data.sosText || fallbackSmsBody
      });
    } catch (e) {
      setResult({
        success: false,
        notifiedCount: 0,
        sosText: fallbackSmsBody,
        offline: true
      });
    } finally {
      setSending(false);
    }
  };

  const startCountdown = () => {
    if (sending || countdown !== null) return;
    setResult(null);
    setCountdown(3);
    let sec = 3;
    timerRef.current = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setCountdown(null);
        dispatchSosNow();
      } else {
        setCountdown(sec);
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
  };

  const smsRecipients = trustedContacts.map(c => c.phone || c).filter(Boolean).join(',');
  const buildSmsHref = (bodyText) => {
    const encoded = encodeURIComponent(bodyText || result?.sosText || note);
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    return `sms:${smsRecipients}${isIos ? '&' : '?'}body=${encoded}`;
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 260,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '430px',
        maxHeight: '90vh',
        overflowY: 'auto',
        borderRadius: '28px',
        padding: '22px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        border: '1px solid rgba(239, 68, 68, 0.45)',
        boxShadow: '0 24px 54px rgba(220, 38, 38, 0.25)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '12px',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#ef4444' }}>
                Emergency SOS
              </h3>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
                Instant GPS + Alert to Trusted Contacts (with SMS fallback)
              </p>
            </div>
          </div>
          <button onClick={onClose} className="glass-btn" style={{ width: '34px', height: '34px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Emergency Note */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            Alert Message:
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="glass-input"
            placeholder="Describe emergency briefly..."
            style={{ width: '100%', fontSize: '13px', padding: '10px 12px' }}
          />
        </div>

        {/* Trusted Contacts Section */}
        <div className="glass-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-primary)' }}>
              Trusted Contacts ({trustedContacts.length}/5)
            </span>
            <button
              type="button"
              onClick={() => setShowPicker(!showPicker)}
              className="glass-btn"
              style={{ height: '28px', padding: '0 10px', fontSize: '11px', fontWeight: '700', color: '#0284c7', gap: '4px' }}
            >
              <Plus size={12} /> {showPicker ? 'Done' : 'Edit List'}
            </button>
          </div>

          {trustedContacts.length === 0 ? (
            <p style={{ fontSize: '11px', color: '#d97706', margin: 0 }}>
              No trusted contacts selected yet. Add trusted family/friends from your phonebook below.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {trustedContacts.map((tc, i) => {
                const phone = tc.phone || tc;
                const display = lookupSavedName(phone, savedContactsMap) || tc.name || phone;
                return (
                  <span key={i} className="glass-pill" style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '700',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--text-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {display}
                    {showPicker && (
                      <X size={12} style={{ cursor: 'pointer', color: '#ef4444' }} onClick={() => toggleTrustedContact(phone, display)} />
                    )}
                  </span>
                );
              })}
            </div>
          )}

          {showPicker && (
            <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', borderTop: '1px solid var(--glass-border-subtle)', paddingTop: '8px' }}>
              {savedContacts.length === 0 ? (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Sync phone contacts in New Chat first to pick trusted contacts.
                </span>
              ) : (
                savedContacts.map((sc, idx) => {
                  const clean10 = getLast10(sc.phone);
                  const selected = trustedContacts.some(t => getLast10(t.phone || t) === clean10);
                  return (
                    <div
                      key={clean10 || idx}
                      onClick={() => toggleTrustedContact(sc.phone, sc.name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        backgroundColor: selected ? 'rgba(239, 68, 68, 0.12)' : 'transparent'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>{sc.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{sc.phone}</div>
                      </div>
                      {selected && <Check size={14} color="#ef4444" />}
                    </div>
                  );
                })
              )}
              {savingContacts && <span style={{ fontSize: '10px', color: '#0284c7' }}>Saving...</span>}
            </div>
          )}
        </div>

        {/* Countdown or Trigger Button */}
        {countdown !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', padding: '14px', borderRadius: '18px', backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
            <span style={{ fontSize: '28px', fontWeight: '900', color: '#ef4444' }}>{countdown}</span>
            <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
              Sending SOS with GPS location...
            </span>
            <button
              type="button"
              onClick={cancelCountdown}
              className="glass-btn"
              style={{ width: '100%', padding: '10px', fontWeight: '800', color: 'var(--text-primary)' }}
            >
              Cancel SOS
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startCountdown}
            disabled={sending}
            style={{
              width: '100%',
              padding: '15px',
              borderRadius: '18px',
              border: 'none',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              color: '#ffffff',
              fontSize: '15px',
              fontWeight: '900',
              letterSpacing: '0.4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 8px 24px rgba(239, 68, 68, 0.4)'
            }}
          >
            <AlertTriangle size={18} />
            {sending ? 'Dispatching SOS Alert...' : 'HOLD ON — SEND SOS ALERT NOW'}
          </button>
        )}

        {/* SMS Offline / Slow Network Fallback */}
        {trustedContacts.length > 0 && (
          <a
            href={buildSmsHref()}
            className="glass-btn"
            style={{
              padding: '11px',
              borderRadius: '14px',
              fontSize: '12px',
              fontWeight: '700',
              textDecoration: 'none',
              color: '#0284c7',
              gap: '6px'
            }}
          >
            <MessageSquare size={15} />
            <span>Internet Slow? Send Offline SMS Alert</span>
          </a>
        )}

        {/* Result Box */}
        {result && (
          <div className="glass-card" style={{
            padding: '12px',
            backgroundColor: result.offline ? 'rgba(245, 158, 11, 0.12)' : 'rgba(34, 197, 94, 0.12)',
            borderColor: result.offline ? 'rgba(245, 158, 11, 0.4)' : 'rgba(34, 197, 94, 0.4)',
            fontSize: '12px'
          }}>
            <div style={{ fontWeight: '800', color: result.offline ? '#d97706' : '#16a34a', marginBottom: '4px' }}>
              {result.offline
                ? '⚠️ Internet slow/offline — Use Offline SMS button above!'
                : `✅ SOS Dispatched! (${result.notifiedCount} active trusted contacts alerted)`}
            </div>
            {locationInfo && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={12} color="#ef4444" />
                GPS: {locationInfo.lat.toFixed(5)}, {locationInfo.lng.toFixed(5)} (±{locationInfo.accuracy}m)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
