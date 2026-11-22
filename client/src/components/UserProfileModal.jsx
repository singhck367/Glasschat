import React, { useState, useEffect } from 'react';
import { 
  X, Phone, Video, MessageSquare, ShieldCheck, 
  Calendar, Mail, Phone as PhoneIcon, User, Info, 
  Lock, Eye, EyeOff, CheckCircle2, UserPlus, Edit3, Check
} from 'lucide-react';

export default function UserProfileModal({ 
  user, 
  currentUser, 
  onClose, 
  onStartCall, 
  onStartChat,
  onVerifySecurity,
  savedContactsMap = {},
  onSaveContact
}) {
  const [profileData, setProfileData] = useState(user);
  const [loading, setLoading] = useState(true);
  const [showFullPhoto, setShowFullPhoto] = useState(false);

  // Contact name save state
  const cleanDigits = (profileData?.phone || user?.phone || '').replace(/\D/g, '');
  const last10 = cleanDigits.slice(-10);
  const existingSavedName = savedContactsMap[last10] || savedContactsMap[cleanDigits] || '';
  
  const [customNameInput, setCustomNameInput] = useState(existingSavedName || (profileData?.name && profileData.name !== profileData.phone ? profileData.name : ''));
  const [isEditingContact, setIsEditingContact] = useState(!existingSavedName);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    if (existingSavedName) {
      setCustomNameInput(existingSavedName);
    }
  }, [existingSavedName]);

  const handleSaveContactName = async (e) => {
    e?.preventDefault();
    if (!customNameInput.trim() || !profileData?.phone) return;
    setSaveStatus('Saving...');
    try {
      if (onSaveContact) {
        await onSaveContact(profileData.phone, customNameInput.trim());
      } else {
        await fetch('/api/contacts/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser?.id,
            phone: profileData.phone,
            name: customNameInput.trim()
          })
        });
      }
      setSaveStatus('Saved!');
      setIsEditingContact(false);
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      setSaveStatus('Failed to save');
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    fetch(`/api/users/profile/${user.id}?viewerId=${currentUser?.id}`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setProfileData(data);
        }
      })
      .catch(e => console.error('Failed to fetch user profile:', e))
      .finally(() => setLoading(false));
  }, [user?.id, currentUser?.id]);

  const formatLastSeen = (isoStr) => {
    if (!isoStr) return 'Offline';
    try {
      const d = new Date(isoStr);
      return `Last seen ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return 'Offline';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 160,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(24px) saturate(160%)',
      WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '420px',
        maxHeight: '90vh',
        overflowY: 'auto',
        borderRadius: '32px',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: 'var(--glass-shadow-lg)',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        position: 'relative'
      }}>
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="glass-btn"
          style={{ position: 'absolute', top: '16px', right: '16px', width: '34px', height: '34px', zIndex: 10 }}
        >
          <X size={16} />
        </button>

        {/* User Hero: Avatar & Name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <img 
              src={profileData?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
              alt={profileData?.name}
              onClick={() => setShowFullPhoto(true)}
              style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid #ffffff',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
                cursor: 'pointer'
              }}
              title="Click to zoom photo"
            />
            {profileData?.online && (
              <span style={{
                position: 'absolute',
                bottom: '4px',
                right: '4px',
                width: '16px',
                height: '16px',
                backgroundColor: '#22c55e',
                border: '3px solid #ffffff',
                borderRadius: '50%'
              }} />
            )}
          </div>

          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
              {existingSavedName || profileData?.name || 'User'}
            </h2>
            {existingSavedName && profileData?.name && profileData.name !== existingSavedName && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>
                ~{profileData.name}
              </span>
            )}
            <p style={{
              fontSize: '12px',
              fontWeight: '600',
              color: profileData?.online ? '#16a34a' : 'var(--text-secondary)',
              margin: '3px 0 0 0'
            }}>
              {profileData?.online ? 'Online Right Now' : formatLastSeen(profileData?.lastSeen)}
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
            <button
              onClick={() => {
                onClose?.();
                onStartChat?.(profileData);
              }}
              className="glass-btn glass-btn-primary"
              style={{ width: '42px', height: '42px', borderRadius: '50%' }}
              title="Message"
            >
              <MessageSquare size={18} />
            </button>

            <button
              onClick={() => {
                onClose?.();
                onStartCall?.(profileData, false);
              }}
              className="glass-btn"
              style={{ width: '42px', height: '42px', borderRadius: '50%' }}
              title="Audio Call"
            >
              <Phone size={18} color="#0284c7" />
            </button>

            <button
              onClick={() => {
                onClose?.();
                onStartCall?.(profileData, true);
              }}
              className="glass-btn"
              style={{ width: '42px', height: '42px', borderRadius: '50%' }}
              title="Video Call"
            >
              <Video size={18} color="#0284c7" />
            </button>
          </div>
        </div>

        {/* User Details Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* 🌟 Save / Edit Contact Name in Server Phonebook */}
          <div className="glass-card" style={{
            padding: '14px 16px',
            backgroundColor: existingSavedName ? 'rgba(2, 132, 199, 0.05)' : 'rgba(245, 158, 11, 0.08)',
            borderColor: existingSavedName ? 'rgba(2, 132, 199, 0.3)' : 'rgba(245, 158, 11, 0.4)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={18} color="#0284c7" />
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#0284c7', textTransform: 'uppercase' }}>
                  {existingSavedName ? 'Saved Contact in Phonebook' : 'Save to Contact List'}
                </span>
              </div>
              {existingSavedName && !isEditingContact && (
                <button 
                  onClick={() => setIsEditingContact(true)}
                  className="glass-btn"
                  style={{ height: '24px', padding: '0 8px', fontSize: '11px', gap: '4px' }}
                >
                  <Edit3 size={11} /> Edit Name
                </button>
              )}
            </div>

            {isEditingContact || !existingSavedName ? (
              <form onSubmit={handleSaveContactName} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                  Enter a name to save this number on the server. Whenever they chat or call, this name will be shown:
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text"
                    value={customNameInput}
                    onChange={(e) => setCustomNameInput(e.target.value)}
                    placeholder="Enter custom name (e.g. Papa, Ramesh, Bhai)..."
                    className="glass-input"
                    style={{ flex: 1, fontSize: '13px', padding: '8px 12px' }}
                    autoFocus={isEditingContact}
                  />
                  <button 
                    type="submit"
                    className="glass-btn glass-btn-primary"
                    style={{ padding: '0 14px', fontSize: '12px', fontWeight: '700', borderRadius: '12px' }}
                  >
                    Save
                  </button>
                  {existingSavedName && (
                    <button 
                      type="button"
                      onClick={() => setIsEditingContact(false)}
                      className="glass-btn"
                      style={{ padding: '0 10px', fontSize: '12px' }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {saveStatus && (
                  <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: '700' }}>
                    {saveStatus}
                  </span>
                )}
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                    {existingSavedName}
                  </h4>
                  <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: '600' }}>
                    ✓ Synced to server under your account
                  </span>
                </div>
                {saveStatus && (
                  <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: '700' }}>
                    {saveStatus}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Bio / About */}
          <div className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Info size={18} color="#0284c7" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                About / Bio
              </span>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '1px 0 0 0', fontWeight: '500' }}>
                {profileData?.status || 'No status available'}
              </p>
            </div>
          </div>

          {/* Phone Number */}
          <div className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <PhoneIcon size={18} color="#0284c7" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Phone Number
              </span>
              <p style={{ fontSize: '14px', color: '#0284c7', margin: '1px 0 0 0', fontWeight: '700' }}>
                {profileData?.phone || 'Not available'}
              </p>
            </div>
          </div>

          {/* Email ID (with Privacy badge) */}
          <div className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Mail size={18} color="#0284c7" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Email ID
                </span>
                {!profileData?.email && (
                  <span style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Lock size={10} /> Hidden by Privacy
                  </span>
                )}
              </div>
              <p style={{ fontSize: '13px', color: profileData?.email ? 'var(--text-primary)' : 'var(--text-secondary)', margin: '1px 0 0 0', fontWeight: '500' }}>
                {profileData?.email || 'Hidden or not added'}
              </p>
            </div>
          </div>

          {/* Date of Birth (DOB) (with Privacy badge) */}
          <div className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Calendar size={18} color="#0284c7" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Date of Birth (DOB)
                </span>
                {!profileData?.dob && (
                  <span style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Lock size={10} /> Hidden by Privacy
                  </span>
                )}
              </div>
              <p style={{ fontSize: '13px', color: profileData?.dob ? 'var(--text-primary)' : 'var(--text-secondary)', margin: '1px 0 0 0', fontWeight: '500' }}>
                {profileData?.dob || 'Hidden or not added'}
              </p>
            </div>
          </div>

          {/* End-to-End Encryption Banner */}
          <div 
            onClick={onVerifySecurity}
            className="glass-card" 
            style={{ 
              padding: '12px 16px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px',
              cursor: 'pointer',
              backgroundColor: 'rgba(34, 197, 94, 0.08)',
              borderColor: 'rgba(34, 197, 94, 0.3)'
            }}
          >
            <ShieldCheck size={20} color="#16a34a" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#16a34a', margin: 0 }}>
                  End-to-End Encryption
                </h4>
                <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: '700' }}>
                  VERIFY
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Messages and calls are secured with 60-digit E2EE safety numbers. Tap to verify.
              </p>
            </div>
          </div>
        </div>

        {/* Full Image Zoom Modal */}
        {showFullPhoto && (
          <div 
            onClick={() => setShowFullPhoto(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              backdropFilter: 'blur(20px)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px'
            }}
          >
            <button
              onClick={() => setShowFullPhoto(false)}
              className="glass-btn"
              style={{ position: 'absolute', top: '20px', right: '20px', width: '38px', height: '38px', color: '#ffffff', backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
            >
              <X size={18} />
            </button>
            <img 
              src={profileData?.avatar} 
              alt={profileData?.name}
              style={{ maxWidth: '90%', maxHeight: '80%', borderRadius: '24px', objectFit: 'contain' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

