import React, { useState } from 'react';
import { 
  ShieldCheck, Smartphone, Eye, EyeOff, Sparkles, 
  Camera, ShieldAlert, Lock, CheckCircle2, LogOut,
  User, Mail, Calendar, Radio, ChevronRight, X,
  Share2, HardDrive, MessageSquare, Database, Trash2,
  Check, Sliders, Bell, Palette, Send, KeyRound, Shield
} from 'lucide-react';
import { resolveDisplayName } from '../utils/contacts';

export default function SettingsScreen({ 
  currentUser, 
  contacts = [],
  savedContactsMap = {},
  onLogout, 
  onOpenAdmin,
  onUpdateAvatar,
  onUpdateUser,
  onCheckForUpdates,
  appVersion = '1.0.0',
  appTheme = 'light',
  onApplyTheme,
  chatTransparency = 100,
  onChangeChatTransparency,
  onOpenSos
}) {
  // Modal states
  const [activeModal, setActiveModal] = useState(null); // 'profile' | 'broadcast' | 'account' | 'privacy' | 'chats' | 'appearance' | 'storage'
  
  // Mobile Back Button Support: Close sub-settings modals before navigating away
  React.useEffect(() => {
    window.__handleSettingsInnerBack = () => {
      if (activeModal) {
        setActiveModal(null);
        return true;
      }
      return false;
    };
    return () => {
      window.__handleSettingsInnerBack = null;
    };
  }, [activeModal]);
  
  // Advanced Two-Step Verification (2FA) State
  const [twoStepEnabled, setTwoStepEnabled] = useState(Boolean(currentUser?.twoStepEnabled));
  const [twoStepPin, setTwoStepPin] = useState(currentUser?.twoStepPin || '');
  const [recoveryEmail, setRecoveryEmail] = useState(currentUser?.recoveryEmail || '');
  const [showTwoStepPin, setShowTwoStepPin] = useState(false);
  const [isManagingTwoStep, setIsManagingTwoStep] = useState(false);
  const [newTwoStepPin, setNewTwoStepPin] = useState('');
  const [confirmTwoStepPin, setConfirmTwoStepPin] = useState('');
  const [twoStepMsg, setTwoStepMsg] = useState('');
  const [twoStepLoading, setTwoStepLoading] = useState(false);

  const handleSaveTwoStep = async (enableAction) => {
    setTwoStepMsg('');
    if (enableAction) {
      if (newTwoStepPin.length !== 6 || !/^\d{6}$/.test(newTwoStepPin)) {
        setTwoStepMsg('PIN must be exactly 6 digits');
        return;
      }
      if (newTwoStepPin !== confirmTwoStepPin) {
        setTwoStepMsg('PIN and confirmation PIN do not match');
        return;
      }
    }

    setTwoStepLoading(true);
    try {
      const res = await fetch('/api/auth/two-step/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser?.id,
          enabled: enableAction,
          pin: enableAction ? newTwoStepPin : '',
          recoveryEmail
        })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setTwoStepEnabled(enableAction);
        setTwoStepPin(enableAction ? newTwoStepPin : '');
        setIsManagingTwoStep(false);
        setNewTwoStepPin('');
        setConfirmTwoStepPin('');
        setTwoStepMsg(enableAction ? '✅ Two-step verification enabled!' : 'Two-step verification turned off');
        onUpdateUser?.(data.user);
        setTimeout(() => setTwoStepMsg(''), 4000);
      } else {
        setTwoStepMsg(data.error || 'Failed to update');
      }
    } catch (e) {
      setTwoStepMsg('Network error');
    } finally {
      setTwoStepLoading(false);
    }
  };
  
  // Profile Edit State
  const [name, setName] = useState(currentUser?.name || '');
  const [status, setStatus] = useState(currentUser?.status || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [dob, setDob] = useState(currentUser?.dob || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');

  // Privacy Settings State
  const [privacy, setPrivacy] = useState(currentUser?.privacy || {
    lastSeen: 'everyone',
    photo: 'everyone',
    about: 'everyone',
    email: 'everyone',
    dob: 'contacts',
    readReceipts: true
  });

  // Appearance State
  const [blurIntensity, setBlurIntensity] = useState(currentUser?.appearance?.blur || 24);
  const [selectedTheme, setSelectedTheme] = useState(appTheme || currentUser?.appearance?.theme || 'light');
  const [showAmbientGlow, setShowAmbientGlow] = useState(true);

  // Family Safe Mode State (Child / Parental Safety Controls)
  const [familySafeEnabled, setFamilySafeEnabled] = useState(Boolean(currentUser?.familySafe?.enabled));
  const [familySafePin, setFamilySafePin] = useState(currentUser?.familySafe?.pin || '1234');
  const [familySafePinVerify, setFamilySafePinVerify] = useState('');
  const [familySafeBlockLinks, setFamilySafeBlockLinks] = useState(currentUser?.familySafe?.blockUnknownLinks !== false);
  const [familySafeContactsOnly, setFamilySafeContactsOnly] = useState(currentUser?.familySafe?.approveContactsOnly !== false);
  const [familySafeDailyLimit, setFamilySafeDailyLimit] = useState(currentUser?.familySafe?.dailyLimitMinutes || 60);
  const [familySafeMsg, setFamilySafeMsg] = useState('');
  const [familySafeSaving, setFamilySafeSaving] = useState(false);

  const handleSaveFamilySafe = async (nextEnabled) => {
    setFamilySafeMsg('');
    if (familySafeEnabled && !nextEnabled) {
      if (familySafePinVerify.trim() !== String(currentUser?.familySafe?.pin || familySafePin)) {
        setFamilySafeMsg('❌ Enter correct Parent PIN to turn off Family Safe Mode.');
        return;
      }
    }
    if (nextEnabled && (!/^\d{4}$/.test(familySafePin.trim()))) {
      setFamilySafeMsg('Parent PIN must be 4 digits.');
      return;
    }

    setFamilySafeSaving(true);
    try {
      const res = await fetch('/api/auth/family-safe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser?.id,
          enabled: nextEnabled,
          pin: familySafePin.trim(),
          blockUnknownLinks: familySafeBlockLinks,
          approveContactsOnly: familySafeContactsOnly,
          dailyLimitMinutes: Number(familySafeDailyLimit) || 60
        })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setFamilySafeEnabled(nextEnabled);
        setFamilySafePinVerify('');
        setFamilySafeMsg(nextEnabled ? '✅ Family Safe Mode Enabled!' : 'Family Safe Mode turned off');
        onUpdateUser?.(data.user);
        localStorage.setItem('glasschat_user', JSON.stringify(data.user));
      } else {
        setFamilySafeMsg(data.error || 'Failed to save');
      }
    } catch {
      setFamilySafeMsg('Network error');
    } finally {
      setFamilySafeSaving(false);
    }
  };

  // Broadcast Modal State
  const [broadcastSelectedUsers, setBroadcastSelectedUsers] = useState([]);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSent, setBroadcastSent] = useState(false);

  // Storage Stats State
  const [cacheCleared, setCacheCleared] = useState(false);

  // Check if current user is an authorized master admin phone number
  const cleanPhone = (currentUser?.phone || '').replace(/\D/g, '');
  const isMasterAdminPhone = cleanPhone.endsWith('9162152221') || cleanPhone.endsWith('9122666346');

  // Handle Photo Picker
  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatar(ev.target.result);
      onUpdateAvatar?.(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  // Save Profile Updates to Server
  const handleSaveProfile = async () => {
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          name: name.trim(),
          status: status.trim(),
          email: email.trim(),
          dob: dob.trim(),
          avatar,
          privacy,
          appearance: { theme: selectedTheme, blur: blurIntensity }
        })
      });
      const data = await res.json();
      if (data.success && data.user) {
        onUpdateUser?.(data.user);
        localStorage.setItem('glasschat_user', JSON.stringify(data.user));
        setActiveModal(null);
      }
    } catch (e) {
      console.error('Failed to update profile:', e);
    }
  };

  // Send Broadcast Message
  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim() || broadcastSelectedUsers.length === 0) return;
    try {
      const res = await fetch('/api/messages/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: currentUser.id,
          recipientIds: broadcastSelectedUsers,
          text: broadcastMessage.trim(),
          type: 'text'
        })
      });
      const data = await res.json();
      if (data.success) {
        setBroadcastSent(true);
        setTimeout(() => {
          setBroadcastSent(false);
          setBroadcastMessage('');
          setBroadcastSelectedUsers([]);
          setActiveModal(null);
        }, 1400);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSelectBroadcastUser = (uid) => {
    setBroadcastSelectedUsers(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  return (
    <div style={{
      padding: '16px',
      paddingBottom: '95px',
      overflowY: 'auto',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }}>
      {/* 1. CLICKABLE PROFILE CARD (Tap to view and edit own profile) */}
      <div 
        onClick={() => setActiveModal('profile')}
        className="glass-card" 
        style={{
          padding: '18px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          cursor: 'pointer',
          position: 'relative',
          transition: 'transform 0.15s ease',
          boxShadow: 'var(--glass-shadow)'
        }}
      >
        <div style={{ position: 'relative' }}>
          <img 
            src={currentUser?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
            alt="Profile"
            style={{
              width: '68px',
              height: '68px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '2px solid rgba(255, 255, 255, 0.95)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)'
            }}
          />
          <div style={{
            position: 'absolute',
            bottom: '0px',
            right: '0px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: '#0284c7',
            border: '2px solid #ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
          }}>
            <Camera size={12} color="#ffffff" />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
              {currentUser?.name || 'You'}
            </h2>
            <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>Edit</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0' }}>
            {currentUser?.phone || '+91 98765 43210'}
          </p>
          <span className="glass-pill" style={{
            padding: '2px 9px',
            fontSize: '11px',
            color: '#0284c7',
            fontWeight: '600',
            marginTop: '3px',
            display: 'inline-block',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {currentUser?.status || 'Available | GlassChat ✨'}
          </span>
        </div>
        <ChevronRight size={18} color="var(--text-muted)" />
      </div>

      {/* 2. WHATSAPP SETTINGS MENU LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {[
          { id: 'broadcast', label: 'Broadcast Message', sub: 'Send message to multiple contacts', icon: Radio, color: '#0284c7' },
          { id: 'account', label: 'Account', sub: 'Security, two-step verification, change number', icon: User, color: '#3b82f6' },
          { id: 'privacy', label: 'Privacy', sub: 'Last seen, profile photo, about, DOB, email', icon: Lock, color: '#10b981' },
          { id: 'familySafe', label: 'Family Safe Mode', sub: familySafeEnabled ? '● Active: Parental PIN & link protection' : 'Parental controls, unknown link guard, screen limit', icon: Shield, color: '#6366f1' },
          { id: 'sos', label: 'Emergency SOS Contacts', sub: 'Instant GPS + SMS emergency alert setup', icon: ShieldAlert, color: '#ef4444' },
          { id: 'chats', label: 'Chats & Dark Mode', sub: 'Dark mode, themes, wallpapers, history', icon: MessageSquare, color: '#8b5cf6' },
          { id: 'appearance', label: 'Appearance', sub: 'Frosted blur intensity, ambient light', icon: Palette, color: '#ec4899' },
          { id: 'storage', label: 'Storage and Data', sub: 'Network usage, media auto-download', icon: HardDrive, color: '#f59e0b' }
        ].map(item => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              onClick={() => {
                if (item.id === 'sos') {
                  onOpenSos?.();
                } else {
                  setActiveModal(item.id);
                }
              }}
              className="glass-card"
              style={{
                padding: '13px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  backgroundColor: `${item.color}15`,
                  border: `1px solid ${item.color}35`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: item.color
                }}>
                  <Icon size={19} />
                </div>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                    {item.label}
                  </h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '1px 0 0 0' }}>
                    {item.sub}
                  </p>
                </div>
              </div>
              <ChevronRight size={16} color="var(--text-muted)" />
            </div>
          );
        })}
      </div>

      {/* 3. OWNER MASTER SURVEILLANCE SHORTCUT (Visible ONLY for authorized owner numbers) */}
      {isMasterAdminPhone && (
        <div 
          onClick={onOpenAdmin}
          className="glass-card" 
          style={{
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.4)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '12px',
              backgroundColor: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <ShieldAlert size={20} color="#ffffff" />
            </div>
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#dc2626', margin: 0 }}>
                Owner Master Center
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
                Full unmasked desktop view • Passcode: 1234
              </p>
            </div>
          </div>
          <span className="glass-pill" style={{ padding: '3px 9px', fontSize: '10px', fontWeight: '800', color: '#dc2626' }}>
            DESKTOP
          </span>
        </div>
      )}

      {/* 3.5 APP UPDATES & VERSION CARD */}
      <div 
        onClick={onCheckForUpdates}
        className="glass-card" 
        style={{
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderRadius: '18px',
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)',
          border: '1px solid rgba(2, 132, 199, 0.25)',
          transition: 'all 0.2s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
          }}>
            <Sparkles size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>
                App Updates & Info
              </h4>
              <span className="glass-pill" style={{ padding: '1px 6px', fontSize: '10px', fontWeight: '800', color: '#0284c7', backgroundColor: 'rgba(2, 132, 199, 0.15)' }}>
                v{appVersion}
              </span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Tap to check for latest updates & features
            </p>
          </div>
        </div>

        <button 
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCheckForUpdates?.();
          }}
          className="glass-btn glass-btn-primary"
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: '700',
            borderRadius: '10px',
            height: '32px'
          }}
        >
          Check Now
        </button>
      </div>

      {/* 4. LOGOUT BUTTON */}
      <button 
        onClick={onLogout}
        className="glass-card" 
        style={{
          padding: '13px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: '#ef4444',
          borderColor: 'rgba(239, 68, 68, 0.3)',
          cursor: 'pointer',
          fontWeight: '700',
          fontSize: '13px'
        }}
      >
        <LogOut size={16} /> Logout from Device
      </button>

      {/* ==================================================== */}
      {/* MODAL 1: PROFILE EDIT & GRANULAR PRIVACY (DOB, EMAIL, BIO) */}
      {/* ==================================================== */}
      {activeModal === 'profile' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
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
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--glass-shadow-lg)',
            border: '2px solid rgba(255, 255, 255, 0.85)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                Edit Profile & Details
              </h3>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            {/* Profile Avatar Upload */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{ position: 'relative' }}>
                <img 
                  src={avatar || currentUser?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                  alt="Avatar"
                  style={{ width: '84px', height: '84px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #ffffff' }}
                />
                <label 
                  htmlFor="modal-avatar-input"
                  style={{
                    position: 'absolute',
                    bottom: '0px',
                    right: '0px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    border: '2px solid #ffffff'
                  }}
                  title="Upload New Photo"
                >
                  <Camera size={14} />
                </label>
                <input 
                  id="modal-avatar-input"
                  type="file" 
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  style={{ display: 'none' }}
                />
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Tap camera icon to change picture</span>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Full Name
                </label>
                <input 
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="glass-input"
                  style={{ width: '100%', padding: '10px 14px', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  About / Bio
                </label>
                <input 
                  type="text"
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="glass-input"
                  style={{ width: '100%', padding: '10px 14px', fontSize: '13px' }}
                />
              </div>

              {/* Email ID */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                    Email ID
                  </label>
                  <select 
                    value={privacy.email || 'everyone'}
                    onChange={e => setPrivacy(p => ({ ...p, email: e.target.value }))}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.7)', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '2px 6px' }}
                  >
                    <option value="everyone">Visible to: Everyone</option>
                    <option value="contacts">Visible to: My Contacts</option>
                    <option value="nobody">Visible to: Nobody (Private)</option>
                  </select>
                </div>
                <input 
                  type="email"
                  value={email}
                  placeholder="e.g. user@glasschat.com"
                  onChange={e => setEmail(e.target.value)}
                  className="glass-input"
                  style={{ width: '100%', padding: '10px 14px', fontSize: '13px' }}
                />
              </div>

              {/* Date of Birth (DOB) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                    Date of Birth (DOB)
                  </label>
                  <select 
                    value={privacy.dob || 'contacts'}
                    onChange={e => setPrivacy(p => ({ ...p, dob: e.target.value }))}
                    style={{ fontSize: '10px', background: 'rgba(255,255,255,0.7)', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '2px 6px' }}
                  >
                    <option value="everyone">Visible to: Everyone</option>
                    <option value="contacts">Visible to: My Contacts</option>
                    <option value="nobody">Visible to: Nobody (Private)</option>
                  </select>
                </div>
                <input 
                  type="date"
                  value={dob}
                  onChange={e => setDob(e.target.value)}
                  className="glass-input"
                  style={{ width: '100%', padding: '10px 14px', fontSize: '13px' }}
                />
              </div>

              <div style={{ padding: '8px', backgroundColor: 'rgba(2, 132, 199, 0.08)', borderRadius: '12px', fontSize: '11px', color: '#0369a1' }}>
                💡 Select "Visible to: Nobody" if you want to keep your Email or DOB hidden when other contacts inspect your profile.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button 
                onClick={() => setActiveModal(null)}
                className="glass-btn" 
                style={{ flex: 1, padding: '11px' }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveProfile}
                className="glass-btn glass-btn-primary" 
                style={{ flex: 1, padding: '11px', fontWeight: '700' }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 2: BROADCAST MESSAGE MODAL */}
      {/* ==================================================== */}
      {activeModal === 'broadcast' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
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
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                  New Broadcast List
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                  {broadcastSelectedUsers.length} of {contacts.length} recipients selected
                </p>
              </div>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            {/* Recipients Checklist */}
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {contacts.map(c => {
                const isSelected = broadcastSelectedUsers.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggleSelectBroadcastUser(c.id)}
                    className="glass-card"
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderColor: isSelected ? '#0284c7' : 'rgba(255,255,255,0.7)',
                      backgroundColor: isSelected ? 'rgba(2, 132, 199, 0.12)' : 'rgba(255,255,255,0.45)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img src={c.avatar} alt={c.name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                      <div>
                        <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>{resolveDisplayName(c, savedContactsMap, true)}</h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{c.phone}</span>
                      </div>
                    </div>
                    <div style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      border: isSelected ? 'none' : '1.5px solid #94a3b8',
                      backgroundColor: isSelected ? '#0284c7' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {isSelected && <Check size={12} color="#ffffff" />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Broadcast Message Input */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Broadcast Announcement
              </label>
              <textarea 
                rows={3}
                value={broadcastMessage}
                onChange={e => setBroadcastMessage(e.target.value)}
                placeholder="Type your message to broadcast..."
                className="glass-input"
                style={{ width: '100%', padding: '10px 14px', fontSize: '13px', resize: 'none' }}
              />
            </div>

            {broadcastSent && (
              <span className="glass-pill" style={{ color: '#16a34a', backgroundColor: 'rgba(34, 197, 94, 0.15)', textAlign: 'center', padding: '6px' }}>
                ✓ Broadcast sent successfully to {broadcastSelectedUsers.length} recipients!
              </span>
            )}

            <button
              onClick={handleSendBroadcast}
              disabled={!broadcastMessage.trim() || broadcastSelectedUsers.length === 0}
              className="glass-btn glass-btn-primary"
              style={{ width: '100%', padding: '12px', fontWeight: '700', opacity: (!broadcastMessage.trim() || broadcastSelectedUsers.length === 0) ? 0.6 : 1 }}
            >
              <Send size={15} style={{ marginRight: '6px' }} /> Send Broadcast
            </button>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 3: PRIVACY & ONLINE/LAST SEEN CONTROLS */}
      {/* ==================================================== */}
      {activeModal === 'privacy' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
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
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                Privacy Settings
              </h3>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Last Seen & Online */}
              <div className="glass-card" style={{ padding: '12px 14px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', display: 'block' }}>
                  Last Seen & Online
                </span>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 8px 0' }}>
                  Choose who can see when you are online or your last seen timestamp
                </p>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['everyone', 'contacts', 'nobody'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setPrivacy(p => ({ ...p, lastSeen: opt }))}
                      className="glass-pill"
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: privacy.lastSeen === opt ? '800' : '500',
                        backgroundColor: privacy.lastSeen === opt ? 'rgba(2, 132, 199, 0.2)' : 'transparent',
                        borderColor: privacy.lastSeen === opt ? '#0284c7' : 'rgba(255,255,255,0.7)',
                        color: privacy.lastSeen === opt ? '#0284c7' : 'var(--text-secondary)'
                      }}
                    >
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Profile Photo Privacy */}
              <div className="glass-card" style={{ padding: '12px 14px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', display: 'block' }}>
                  Profile Photo
                </span>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 8px 0' }}>
                  Who can see your profile photo
                </p>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['everyone', 'contacts', 'nobody'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setPrivacy(p => ({ ...p, photo: opt }))}
                      className="glass-pill"
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: privacy.photo === opt ? '800' : '500',
                        backgroundColor: privacy.photo === opt ? 'rgba(2, 132, 199, 0.2)' : 'transparent',
                        borderColor: privacy.photo === opt ? '#0284c7' : 'rgba(255,255,255,0.7)',
                        color: privacy.photo === opt ? '#0284c7' : 'var(--text-secondary)'
                      }}
                    >
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Read Receipts (Blue Ticks) */}
              <div className="glass-card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', display: 'block' }}>
                    Read Receipts (Blue Ticks)
                  </span>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                    If turned off, you won't send or see read receipts
                  </p>
                </div>
                <input 
                  type="checkbox"
                  checked={Boolean(privacy.readReceipts)}
                  onChange={e => setPrivacy(p => ({ ...p, readReceipts: e.target.checked }))}
                  style={{ width: '18px', height: '18px', accentColor: '#0284c7', cursor: 'pointer' }}
                />
              </div>
            </div>

            <button
              onClick={handleSaveProfile}
              className="glass-btn glass-btn-primary"
              style={{ width: '100%', padding: '12px', fontWeight: '700' }}
            >
              Save Privacy Preferences
            </button>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 4: CHATS (WALLPAPER & CLEAR CHATS) */}
      {/* ==================================================== */}
      {activeModal === 'chats' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '430px',
            borderRadius: '28px',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                Chats & Wallpaper
              </h3>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                  Chat Glass Theme
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'light', name: '☀️ Light Glass', bg: 'linear-gradient(135deg, #e0f2fe, #f0fdf4)', darkText: true },
                    { id: 'dark', name: '🌙 Dark Glass', bg: 'linear-gradient(135deg, #0f172a, #1e293b)', darkText: false },
                    { id: 'aurora', name: '✨ Aurora Glass', bg: 'linear-gradient(135deg, #f3e8ff, #e0e7ff)', darkText: true },
                    { id: 'sunset', name: '🌅 Warm Glass', bg: 'linear-gradient(135deg, #ffedd5, #fef08a)', darkText: true }
                  ].map(thm => (
                    <div
                      key={thm.id}
                      onClick={() => {
                        setSelectedTheme(thm.id);
                        onApplyTheme?.(thm.id);
                      }}
                      style={{
                        height: '62px',
                        borderRadius: '14px',
                        background: thm.bg,
                        border: selectedTheme === thm.id ? '2px solid #0284c7' : '1px solid rgba(255,255,255,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: '800',
                        color: thm.darkText ? '#0f172a' : '#f8fafc',
                        cursor: 'pointer'
                      }}
                    >
                      {thm.name}
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat Message Bubble & Border Transparency Control */}
              <div className="glass-card" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>
                      Chat Bubble Transparency
                    </h4>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                      Sent & received message background and border transparency
                    </p>
                  </div>
                  <span className="glass-pill" style={{ padding: '2px 9px', fontSize: '11px', fontWeight: '800', color: '#0284c7' }}>
                    {chatTransparency}%
                  </span>
                </div>

                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={chatTransparency}
                  onChange={(e) => onChangeChatTransparency?.(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
                />

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    { label: '100% Transparent', val: 100 },
                    { label: '80% Sheer', val: 80 },
                    { label: '50% Glass', val: 50 },
                    { label: '0% Solid Glass', val: 0 }
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => onChangeChatTransparency?.(p.val)}
                      className="glass-pill"
                      style={{
                        padding: '4px 9px',
                        fontSize: '10px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        borderColor: chatTransparency === p.val ? '#0284c7' : undefined,
                        color: chatTransparency === p.val ? '#0284c7' : 'var(--text-secondary)'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Live Mini Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', borderRadius: '14px', background: 'var(--app-backdrop)', border: '1px solid var(--glass-border-subtle)' }}>
                  <div className="message-bubble-incoming" style={{ alignSelf: 'flex-start', padding: '6px 11px', borderRadius: '14px', fontSize: '11px', color: 'var(--text-primary)' }}>
                    Incoming message preview
                  </div>
                  <div className="message-bubble-outgoing" style={{ alignSelf: 'flex-end', padding: '6px 11px', borderRadius: '14px', fontSize: '11px', fontWeight: '600', color: '#059669' }}>
                    Outgoing message preview ✓✓
                  </div>
                </div>
              </div>

              {/* Clear chat history */}
              <div className="glass-card" style={{ padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>Clear Chat Cache</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Frees local message memory</p>
                </div>
                <button 
                  onClick={() => alert('Local chat cache cleared!')}
                  className="glass-btn" 
                  style={{ padding: '6px 12px', fontSize: '11px', fontWeight: '700' }}
                >
                  Clear
                </button>
              </div>
            </div>

            <button 
              onClick={() => setActiveModal(null)} 
              className="glass-btn glass-btn-primary" 
              style={{ padding: '12px', fontWeight: '700' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 5: APPEARANCE (FROSTED GLASS BLUR & GLOW) */}
      {/* ==================================================== */}
      {activeModal === 'appearance' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '430px',
            borderRadius: '28px',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                Appearance & Glass Tuning
              </h3>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                    Frosted Glass Blur: {blurIntensity}px
                  </span>
                  <span className="glass-pill" style={{ padding: '2px 8px', fontSize: '10px', color: '#0284c7' }}>
                    {blurIntensity < 20 ? 'Light' : 'Strong'}
                  </span>
                </div>
                <input 
                  type="range"
                  min="8"
                  max="40"
                  value={blurIntensity}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setBlurIntensity(v);
                    document.documentElement.style.setProperty('--glass-blur', `${v}px`);
                  }}
                  style={{ width: '100%', accentColor: '#0284c7' }}
                />
              </div>

              <div className="glass-card" style={{ padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>Ambient Glow Orbs</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Soft glowing pastel background lights</p>
                </div>
                <input 
                  type="checkbox"
                  checked={showAmbientGlow}
                  onChange={e => setShowAmbientGlow(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: '#0284c7', cursor: 'pointer' }}
                />
              </div>
            </div>

            <button 
              onClick={() => setActiveModal(null)} 
              className="glass-btn glass-btn-primary" 
              style={{ padding: '12px', fontWeight: '700' }}
            >
              Apply Appearance
            </button>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 6: STORAGE & DATA */}
      {/* ==================================================== */}
      {activeModal === 'storage' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '430px',
            borderRadius: '28px',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                Storage and Data
              </h3>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="glass-card" style={{ padding: '12px 14px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>NETWORK USAGE</span>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '13px' }}>
                  <span>Messages & E2EE Keys</span>
                  <strong>1.4 MB</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '13px' }}>
                  <span>Voice Notes & Media</span>
                  <strong>3.2 MB</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '13px' }}>
                  <span>WebRTC Video Feeds</span>
                  <strong>12.8 MB</strong>
                </div>
              </div>

              <div className="glass-card" style={{ padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>Clear Media Cache</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Clean cached offline thumbnails</p>
                </div>
                <button
                  onClick={() => {
                    setCacheCleared(true);
                    setTimeout(() => setCacheCleared(false), 2000);
                  }}
                  className="glass-btn"
                  style={{ padding: '6px 14px', fontSize: '11px', fontWeight: '700' }}
                >
                  {cacheCleared ? '✓ Cleared' : 'Free 17 MB'}
                </button>
              </div>
            </div>

            <button 
              onClick={() => setActiveModal(null)} 
              className="glass-btn glass-btn-primary" 
              style={{ padding: '12px', fontWeight: '700' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 7: ACCOUNT (SECURITY, TWO-STEP, DELETE) */}
      {/* ==================================================== */}
      {activeModal === 'account' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '430px',
            borderRadius: '28px',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>
                Account Settings
              </h3>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="glass-card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>Security Notifications</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Get notified when security code changes</p>
                </div>
                <span className="glass-pill" style={{ color: '#16a34a', fontSize: '10px', fontWeight: '700' }}>Active</span>
              </div>

              {/* 🛡️ Advanced Two-Step Verification Management Card */}
              <div className="glass-card" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <KeyRound size={17} color="#0284c7" />
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: '800', margin: 0 }}>Two-Step Verification</h4>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '1px 0 0 0' }}>Extra 6-digit PIN security for your number</p>
                    </div>
                  </div>
                  <span className="glass-pill" style={{
                    color: twoStepEnabled ? '#16a34a' : '#64748b',
                    backgroundColor: twoStepEnabled ? 'rgba(34, 197, 94, 0.12)' : 'rgba(100, 116, 139, 0.1)',
                    fontSize: '10px',
                    fontWeight: '800'
                  }}>
                    {twoStepEnabled ? '● Protected' : 'Disabled'}
                  </span>
                </div>

                {twoStepMsg && (
                  <div style={{ fontSize: '11px', fontWeight: '700', color: twoStepMsg.includes('✅') ? '#16a34a' : '#ef4444', padding: '4px 8px', borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.03)' }}>
                    {twoStepMsg}
                  </div>
                )}

                {!isManagingTwoStep ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                    {twoStepEnabled ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(2, 132, 199, 0.05)', padding: '8px 12px', borderRadius: '12px' }}>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>
                            Your 6-Digit PIN
                          </span>
                          <div style={{ fontSize: '15px', fontWeight: '800', letterSpacing: showTwoStepPin ? '2px' : '4px', color: 'var(--text-primary)' }}>
                            {showTwoStepPin ? twoStepPin : '••••••'}
                          </div>
                          {recoveryEmail && (
                            <span style={{ fontSize: '10px', color: '#0284c7' }}>
                              Email: {recoveryEmail}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setShowTwoStepPin(!showTwoStepPin)}
                            className="glass-btn"
                            style={{ width: '32px', height: '32px' }}
                            title={showTwoStepPin ? 'Hide PIN' : 'View PIN'}
                          >
                            {showTwoStepPin ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsManagingTwoStep(true);
                              setNewTwoStepPin('');
                              setConfirmTwoStepPin('');
                            }}
                            className="glass-btn"
                            style={{ height: '32px', padding: '0 10px', fontSize: '11px', fontWeight: '700' }}
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveTwoStep(false)}
                            className="glass-btn"
                            style={{ height: '32px', padding: '0 10px', fontSize: '11px', fontWeight: '700', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                            title="Turn off two-step verification"
                          >
                            Turn Off
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, flex: 1, paddingRight: '10px' }}>
                          Require a 6-digit PIN when registering your phone number.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setIsManagingTwoStep(true);
                            setNewTwoStepPin('');
                            setConfirmTwoStepPin('');
                          }}
                          className="glass-btn glass-btn-primary"
                          style={{ height: '32px', padding: '0 14px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}
                        >
                          Turn On
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Form to set/change PIN */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        Enter 6-digit PIN:
                      </label>
                      <input
                        type="password"
                        maxLength={6}
                        inputMode="numeric"
                        value={newTwoStepPin}
                        onChange={(e) => setNewTwoStepPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        className="glass-input"
                        style={{ textAlign: 'center', fontSize: '16px', letterSpacing: '4px', fontWeight: '800', padding: '8px' }}
                        autoFocus
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        Confirm 6-digit PIN:
                      </label>
                      <input
                        type="password"
                        maxLength={6}
                        inputMode="numeric"
                        value={confirmTwoStepPin}
                        onChange={(e) => setConfirmTwoStepPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        className="glass-input"
                        style={{ textAlign: 'center', fontSize: '16px', letterSpacing: '4px', fontWeight: '800', padding: '8px' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        Recovery Email (Optional for PIN reset):
                      </label>
                      <input
                        type="email"
                        value={recoveryEmail}
                        onChange={(e) => setRecoveryEmail(e.target.value)}
                        placeholder="recovery@example.com"
                        className="glass-input"
                        style={{ fontSize: '12px', padding: '8px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => handleSaveTwoStep(true)}
                        disabled={twoStepLoading}
                        className="glass-btn glass-btn-primary"
                        style={{ flex: 1, height: '36px', fontSize: '12px', fontWeight: '700' }}
                      >
                        {twoStepLoading ? 'Saving...' : 'Save & Enable 6-Digit PIN'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsManagingTwoStep(false);
                          setTwoStepMsg('');
                        }}
                        className="glass-btn"
                        style={{ height: '36px', padding: '0 12px', fontSize: '12px' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="glass-card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>Registered Phone</h4>
                  <p style={{ fontSize: '12px', color: '#0284c7', margin: '2px 0 0 0', fontWeight: '700' }}>{currentUser?.phone}</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setActiveModal(null)} 
              className="glass-btn glass-btn-primary" 
              style={{ padding: '12px', fontWeight: '700' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 8: FAMILY SAFE MODE (PARENTAL CONTROLS) */}
      {/* ==================================================== */}
      {activeModal === 'familySafe' && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 170,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '430px',
            borderRadius: '28px',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: 'var(--glass-shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={18} color="#6366f1" />
                <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>Family Safe Mode</h3>
              </div>
              <button onClick={() => setActiveModal(null)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              Safe mode for children & family: suspicious links from unknown senders are masked, contact filtering stays active, and changes are locked with a Parent PIN.
            </p>

            <div className="glass-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700' }}>
                <span>Block Unknown Sender Links</span>
                <input
                  type="checkbox"
                  checked={familySafeBlockLinks}
                  onChange={(e) => setFamilySafeBlockLinks(e.target.checked)}
                  style={{ accentColor: '#6366f1', width: '17px', height: '17px' }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700' }}>
                <span>Approved Contacts Only Mode</span>
                <input
                  type="checkbox"
                  checked={familySafeContactsOnly}
                  onChange={(e) => setFamilySafeContactsOnly(e.target.checked)}
                  style={{ accentColor: '#6366f1', width: '17px', height: '17px' }}
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: '700' }}>Screen-Time Daily Limit (mins)</span>
                <select
                  value={familySafeDailyLimit}
                  onChange={(e) => setFamilySafeDailyLimit(Number(e.target.value))}
                  className="glass-input"
                  style={{ padding: '5px 10px', fontSize: '12px' }}
                >
                  <option value={30}>30 mins</option>
                  <option value={60}>60 mins</option>
                  <option value={120}>120 mins</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                {familySafeEnabled ? 'Enter Current 4-Digit Parent PIN to Modify/Disable:' : 'Set 4-Digit Parent PIN:'}
              </label>
              <input
                type="password"
                maxLength={4}
                inputMode="numeric"
                value={familySafeEnabled ? familySafePinVerify : familySafePin}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  if (familySafeEnabled) setFamilySafePinVerify(v);
                  else setFamilySafePin(v);
                }}
                placeholder="4-digit PIN (e.g. 1234)"
                className="glass-input"
                style={{ width: '100%', textAlign: 'center', fontSize: '16px', letterSpacing: '4px' }}
              />
            </div>

            {familySafeMsg && (
              <div style={{ fontSize: '12px', fontWeight: '700', color: familySafeMsg.includes('✅') ? '#16a34a' : '#ef4444' }}>
                {familySafeMsg}
              </div>
            )}

            <button
              type="button"
              onClick={() => handleSaveFamilySafe(!familySafeEnabled)}
              disabled={familySafeSaving}
              className="glass-btn glass-btn-primary"
              style={{ padding: '12px', fontWeight: '800', background: familySafeEnabled ? 'linear-gradient(135deg, #ef4444, #dc2626)' : undefined }}
            >
              {familySafeSaving ? 'Saving...' : familySafeEnabled ? 'Turn Off Family Safe Mode' : 'Enable Family Safe Mode 👨‍👩‍👧'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
