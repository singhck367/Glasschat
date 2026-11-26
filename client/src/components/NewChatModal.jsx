import React, { useState, useRef, useEffect } from 'react';
import {
  X, Search, UserPlus, Phone, Video, MessageSquare, Info,
  UserX, Smartphone, Send, Share2, Lock, CheckCircle2
} from 'lucide-react';
import UserProfileModal from './UserProfileModal';
import {
  normalizeDigits,
  getLast10,
  lookupSavedName,
  resolveDisplayName,
  openSmsInvite
} from '../utils/contacts';

export default function NewChatModal({
  contacts = [],
  onClose,
  onSelectContact,
  onStartCall,
  currentUserId,
  currentUser = null,
  chatSummaries = {},
  savedContacts = [],
  savedContactsMap = {},
  onSaveContact,
  onSyncContacts
}) {
  const [search, setSearch] = useState('');
  const [inspectUser, setInspectUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Strict exact-number lookup state for unsaved registered numbers
  const [exactLookupResult, setExactLookupResult] = useState(null);
  const [exactLookupLoading, setExactLookupLoading] = useState(false);

  const fileInputRef = useRef(null);

  const cleanSearch = search.trim().toLowerCase();
  const cleanDigits = normalizeDigits(search);
  const isFamilyContactLock = Boolean(currentUser?.familySafe?.enabled && currentUser?.familySafe?.approveContactsOnly);

  // Run exact server phone lookup ONLY when user types full 10+ digit number
  useEffect(() => {
    if (cleanDigits.length < 10) {
      setExactLookupResult(null);
      setExactLookupLoading(false);
      return;
    }

    let cancelled = false;
    setExactLookupLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/users/find-by-phone?phone=${encodeURIComponent(cleanDigits)}&viewerId=${encodeURIComponent(currentUserId || '')}`
        );
        const data = await res.json();
        if (!cancelled) {
          setExactLookupResult(data);
        }
      } catch (err) {
        if (!cancelled) setExactLookupResult(null);
      } finally {
        if (!cancelled) setExactLookupLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cleanDigits, currentUserId]);

  const handleAddNewContact = async (e) => {
    e.preventDefault();
    if (!addName.trim() || !addPhone.trim()) return;
    setIsSaving(true);
    try {
      if (onSaveContact) {
        await onSaveContact(addPhone.trim(), addName.trim());
        setSyncStatus(`✅ Saved "${addName.trim()}" to contacts!`);
        setTimeout(() => setSyncStatus(''), 3500);
      }

      const last10 = getLast10(addPhone);
      let matched = contacts.find(c => {
        const cDigits = normalizeDigits(c.phone);
        return (last10 && cDigits.endsWith(last10)) || cDigits === normalizeDigits(addPhone);
      });

      if (!matched && last10.length >= 10) {
        try {
          const r = await fetch(`/api/users/find-by-phone?phone=${encodeURIComponent(last10)}&viewerId=${encodeURIComponent(currentUserId || '')}`);
          const d = await r.json();
          if (d?.found && d.user) matched = d.user;
        } catch {}
      }

      setShowAddContact(false);
      setAddName('');
      setAddPhone('');

      if (matched) {
        onSelectContact(matched);
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Sync Native Android Phonebook / Web Contact Picker / VCF
  const handleSyncNativeContacts = async () => {
    setSyncStatus('Syncing phonebook contacts...');
    try {
      // 1. Native Android APK Bridge (reads phonebook directly when granted)
      if (typeof window !== 'undefined' && window.AndroidContacts?.readDeviceContacts) {
        const rawJson = window.AndroidContacts.readDeviceContacts();
        const parsed = JSON.parse(rawJson || '[]');
        if (parsed === 'PERMISSION_REQUESTED') {
          setSyncStatus('📱 Please allow Contacts permission, then tap Sync Phonebook again.');
          return;
        }
        if (Array.isArray(parsed) && parsed.length > 0 && onSyncContacts) {
          await onSyncContacts(parsed);
          setSyncStatus(`✅ Synced ${parsed.length} saved phone contacts!`);
          setTimeout(() => setSyncStatus(''), 4000);
          return;
        }
      }

      // 2. Web Contact Picker API (Android Chrome)
      if ('contacts' in navigator && 'select' in navigator.contacts) {
        const selected = await navigator.contacts.select(['name', 'tel'], { multiple: true });
        if (selected && selected.length > 0) {
          const formatted = selected
            .map(c => ({
              name: Array.isArray(c.name) ? c.name[0] : c.name,
              phone: Array.isArray(c.tel) ? c.tel[0] : c.tel
            }))
            .filter(c => c.phone);

          if (formatted.length > 0 && onSyncContacts) {
            await onSyncContacts(formatted);
            setSyncStatus(`✅ Synced ${formatted.length} phone contacts!`);
            setTimeout(() => setSyncStatus(''), 4000);
            return;
          }
        }
      }

      // 3. Fallback: .vcf contacts file import
      fileInputRef.current?.click();
    } catch (e) {
      console.warn('Contact sync notice:', e);
      fileInputRef.current?.click();
    }
  };

  const handleVcfUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSyncStatus('Importing contacts file...');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const parsedContacts = [];
      const lines = text.split(/\r?\n/);
      let currentName = '';
      let currentPhone = '';

      for (const line of lines) {
        if (line.startsWith('FN:') || line.startsWith('N:')) {
          currentName = line.substring(line.indexOf(':') + 1).replace(/;/g, ' ').trim();
        } else if (line.startsWith('TEL')) {
          currentPhone = line.substring(line.indexOf(':') + 1).trim();
        } else if (line.startsWith('END:VCARD')) {
          if (currentPhone) {
            parsedContacts.push({ name: currentName || currentPhone, phone: currentPhone });
          }
          currentName = '';
          currentPhone = '';
        }
      }

      if (parsedContacts.length > 0 && onSyncContacts) {
        await onSyncContacts(parsedContacts);
        setSyncStatus(`✅ Imported ${parsedContacts.length} contacts from VCF!`);
      } else {
        setSyncStatus('No valid contacts found in file.');
      }
      setTimeout(() => setSyncStatus(''), 4000);
    };
    reader.readAsText(file);
  };

  // Match saved phonebook entries against registered GlassChat users
  const registeredSavedUsers = [];
  const unregisteredSavedContacts = [];
  const matchedRegisteredIds = new Set();

  savedContacts.forEach(sc => {
    const scLast10 = getLast10(sc.cleanDigits || sc.phone);
    const scDigits = normalizeDigits(sc.cleanDigits || sc.phone);
    const regUser = contacts.find(u => {
      if (u.id === currentUserId) return false;
      const uDigits = normalizeDigits(u.phone);
      const uLast10 = getLast10(u.phone);
      return (scLast10 && uLast10 === scLast10) || (scDigits && uDigits === scDigits);
    });

    if (regUser) {
      if (!matchedRegisteredIds.has(regUser.id)) {
        matchedRegisteredIds.add(regUser.id);
        registeredSavedUsers.push({
          ...regUser,
          displayName: sc.name
        });
      }
    } else {
      unregisteredSavedContacts.push(sc);
    }
  });

  registeredSavedUsers.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  unregisteredSavedContacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Recent chats with unsaved numbers (not in savedContacts)
  const unsavedRecentUsers = contacts.filter(c => {
    if (c.id === currentUserId || matchedRegisteredIds.has(c.id)) return false;
    const cChatId = `chat_${[currentUserId, c.id].sort().join('_')}`;
    return Boolean(chatSummaries[cChatId]?.lastMessage);
  });

  // Filtered lists during search (ONLY searches YOUR saved contacts + active chats — NEVER leaks strangers!)
  const filteredRegisteredSaved = cleanSearch
    ? registeredSavedUsers.filter(c => {
        const dName = (c.displayName || '').toLowerCase();
        const digits = normalizeDigits(c.phone);
        return dName.includes(cleanSearch) ||
          (c.phone || '').toLowerCase().includes(cleanSearch) ||
          (cleanDigits.length > 0 && digits.includes(cleanDigits));
      })
    : registeredSavedUsers;

  const filteredUnregisteredSaved = cleanSearch
    ? unregisteredSavedContacts.filter(sc => {
        const name = (sc.name || '').toLowerCase();
        const digits = normalizeDigits(sc.cleanDigits || sc.phone);
        return name.includes(cleanSearch) ||
          (sc.phone || '').toLowerCase().includes(cleanSearch) ||
          (cleanDigits.length > 0 && digits.includes(cleanDigits));
      })
    : unregisteredSavedContacts;

  // Exact match user for full 10-digit search (when not already in saved registered list)
  const exactFoundUser = (!isFamilyContactLock && exactLookupResult?.found && exactLookupResult.user && !matchedRegisteredIds.has(exactLookupResult.user.id))
    ? exactLookupResult.user
    : null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 130,
      backgroundColor: 'rgba(235, 244, 255, 0.88)',
      backdropFilter: 'blur(28px) saturate(180%)',
      WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '430px',
        height: '85vh',
        maxHeight: '680px',
        borderRadius: '28px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        boxShadow: 'var(--glass-shadow-lg)'
      }}>
        {/* Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
              Select Contact
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              {registeredSavedUsers.length} on GlassChat • {unregisteredSavedContacts.length} invite
            </p>
          </div>

          <button onClick={onClose} className="glass-btn" style={{ width: '34px', height: '34px' }}>
            <X size={16} color="var(--text-secondary)" />
          </button>
        </div>

        {/* Search Input Box */}
        <div style={{ position: 'relative' }}>
          <Search size={16} color="#0284c7" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Enter saved contact name or full 10-digit number..."
            className="glass-input"
            autoFocus
            style={{ width: '100%', paddingLeft: '38px', fontSize: '13px', borderColor: cleanSearch ? '#0284c7' : undefined }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Quick Actions: New Contact & Sync Phonebook */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".vcf,.vcard,text/vcard"
          onChange={handleVcfUpload}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setShowAddContact(!showAddContact)}
            className="glass-btn glass-btn-primary"
            style={{
              flex: 1,
              height: '36px',
              borderRadius: '14px',
              fontSize: '12px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <UserPlus size={14} /> Add Contact
          </button>

          <button
            onClick={handleSyncNativeContacts}
            className="glass-btn"
            style={{
              flex: 1,
              height: '36px',
              borderRadius: '14px',
              fontSize: '12px',
              fontWeight: '700',
              color: '#0284c7',
              backgroundColor: 'rgba(2, 132, 199, 0.08)',
              borderColor: 'rgba(2, 132, 199, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Smartphone size={14} /> Sync Phonebook
          </button>
        </div>

        {/* Add Contact Inline Form */}
        {showAddContact && (
          <form
            onSubmit={handleAddNewContact}
            className="glass-panel"
            style={{
              padding: '12px 14px',
              borderRadius: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              border: '1.5px solid rgba(2, 132, 199, 0.35)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '800', color: '#0369a1' }}>
                Save Contact to Phonebook
              </span>
              <button
                type="button"
                onClick={() => setShowAddContact(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={14} />
              </button>
            </div>

            <input
              type="text"
              placeholder="Contact Name (e.g. Rahul Sharma)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="glass-input"
              style={{ fontSize: '12px', padding: '7px 10px', width: '100%' }}
              required
            />

            <input
              type="tel"
              placeholder="10-Digit Mobile Number"
              value={addPhone}
              onChange={(e) => setAddPhone(e.target.value)}
              className="glass-input"
              style={{ fontSize: '12px', padding: '7px 10px', width: '100%' }}
              required
            />

            <button
              type="submit"
              disabled={isSaving || !addName.trim() || !addPhone.trim()}
              className="glass-btn glass-btn-primary"
              style={{ height: '34px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}
            >
              {isSaving ? 'Saving...' : 'Save Contact'}
            </button>
          </form>
        )}

        {syncStatus && (
          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: '700', textAlign: 'center', padding: '2px 0' }}>
            {syncStatus}
          </div>
        )}

        {isFamilyContactLock && (
          <div style={{
            padding: '8px 10px',
            borderRadius: '12px',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            fontSize: '11px',
            fontWeight: '700',
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Lock size={13} />
            <span>Family Safe Mode ON: Unsaved numbers search locked.</span>
          </div>
        )}

        {/* Scrollable Contacts Area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          paddingRight: '2px'
        }}>
          {/* EXACT FULL-NUMBER REGISTERED DISCOVERY RESULT */}
          {cleanDigits.length > 0 && cleanDigits.length < 10 && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '14px',
              backgroundColor: 'rgba(2, 132, 199, 0.08)',
              border: '1px solid rgba(2, 132, 199, 0.25)',
              fontSize: '11px',
              color: '#0369a1',
              fontWeight: '600'
            }}>
              🔒 Enter the full <strong>10-digit mobile number</strong> to find a new unsaved registered contact ({cleanDigits.length}/10 digits).
            </div>
          )}

          {cleanDigits.length >= 10 && !isFamilyContactLock && (
            <div>
              <div style={{ padding: '0 4px', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#0284c7' }}>
                  Exact Number Lookup
                </span>
              </div>

              {exactLookupLoading ? (
                <div className="glass-card" style={{ padding: '12px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Checking exact number on GlassChat...
                </div>
              ) : exactFoundUser ? (
                <div
                  onClick={() => {
                    onSelectContact(exactFoundUser);
                    onClose();
                  }}
                  className="glass-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    gap: '12px',
                    border: '1.5px solid #0284c7',
                    backgroundColor: 'rgba(2, 132, 199, 0.06)'
                  }}
                >
                  <img
                    src={exactFoundUser.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}
                    alt={exactFoundUser.phone}
                    style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                      {resolveDisplayName(exactFoundUser, savedContactsMap, true)}
                    </h4>
                    <p style={{ fontSize: '11px', color: '#16a34a', fontWeight: '700', margin: '1px 0 0 0' }}>
                      ✓ Registered on GlassChat • Tap to Chat
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { onClose(); onStartCall(exactFoundUser, false); }}
                      className="glass-btn"
                      style={{ width: '32px', height: '32px' }}
                      title="Audio Call"
                    >
                      <Phone size={14} color="#0284c7" />
                    </button>
                    <button
                      onClick={() => { onSelectContact(exactFoundUser); onClose(); }}
                      className="glass-btn glass-btn-primary"
                      style={{ width: '32px', height: '32px' }}
                      title="Start Chat"
                    >
                      <MessageSquare size={14} />
                    </button>
                  </div>
                </div>
              ) : (exactLookupResult && !exactLookupResult.found && !filteredRegisteredSaved.length) ? (
                <div className="glass-card" style={{
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {search}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Not registered on GlassChat yet
                    </div>
                  </div>
                  <button
                    onClick={() => openSmsInvite(cleanDigits)}
                    className="glass-btn"
                    style={{
                      padding: '0 12px',
                      height: '32px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: '800',
                      color: '#0284c7',
                      backgroundColor: 'rgba(2, 132, 199, 0.12)',
                      borderColor: '#0284c7',
                      gap: '5px'
                    }}
                  >
                    <Send size={12} /> Invite
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* 1. REGISTERED SAVED CONTACTS ON TOP */}
          <div>
            <div style={{ padding: '0 4px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#0369a1' }}>
                Contacts on GlassChat ({filteredRegisteredSaved.length})
              </span>
            </div>

            {filteredRegisteredSaved.length === 0 ? (
              !cleanSearch && (
                <div style={{
                  padding: '16px 14px',
                  borderRadius: '16px',
                  backgroundColor: 'rgba(2, 132, 199, 0.06)',
                  border: '1px solid rgba(2, 132, 199, 0.2)',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--text-secondary)'
                }}>
                  Phonebook contacts will appear here. Tap <strong>"Sync Phonebook"</strong> or <strong>"Add Contact"</strong> above.
                </div>
              )
            ) : (
              filteredRegisteredSaved.map(contact => {
                const displayName = lookupSavedName(contact.phone, savedContactsMap) || contact.displayName || contact.phone;
                return (
                  <div
                    key={contact.id}
                    onClick={() => {
                      onSelectContact(contact);
                      onClose();
                    }}
                    className="glass-card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 14px',
                      cursor: 'pointer',
                      gap: '12px',
                      marginBottom: '8px'
                    }}
                  >
                    <div
                      style={{ position: 'relative' }}
                      onClick={(e) => { e.stopPropagation(); setInspectUser(contact); }}
                    >
                      <img
                        src={contact.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}
                        alt={displayName}
                        style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.9)' }}
                      />
                      {contact.online && (
                        <span style={{
                          position: 'absolute',
                          bottom: '1px',
                          right: '1px',
                          width: '9px',
                          height: '9px',
                          backgroundColor: '#22c55e',
                          border: '2px solid #ffffff',
                          borderRadius: '50%'
                        }} />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                        {displayName}
                      </h4>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '1px 0 0 0' }}>
                        {contact.phone}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '5px' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setInspectUser(contact)}
                        className="glass-btn"
                        style={{ width: '30px', height: '30px' }}
                        title="Profile"
                      >
                        <Info size={13} color="#64748b" />
                      </button>
                      <button
                        onClick={() => { onClose(); onStartCall(contact, false); }}
                        className="glass-btn"
                        style={{ width: '30px', height: '30px' }}
                        title="Audio Call"
                      >
                        <Phone size={13} color="#0284c7" />
                      </button>
                      <button
                        onClick={() => { onClose(); onStartCall(contact, true); }}
                        className="glass-btn"
                        style={{ width: '30px', height: '30px' }}
                        title="Video Call"
                      >
                        <Video size={13} color="#0284c7" />
                      </button>
                      <button
                        onClick={() => { onSelectContact(contact); onClose(); }}
                        className="glass-btn"
                        style={{ width: '30px', height: '30px', backgroundColor: 'rgba(2, 132, 199, 0.12)', borderColor: '#0284c7' }}
                        title="Chat"
                      >
                        <MessageSquare size={13} color="#0284c7" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 2. UNSAVED RECENT CHATS (if not saved, show number only) */}
          {!cleanSearch && unsavedRecentUsers.length > 0 && (
            <div>
              <div style={{ padding: '0 4px', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                  Recent Unsaved Chats ({unsavedRecentUsers.length})
                </span>
              </div>
              {unsavedRecentUsers.map(contact => (
                <div
                  key={contact.id}
                  onClick={() => { onSelectContact(contact); onClose(); }}
                  className="glass-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    gap: '12px',
                    marginBottom: '8px'
                  }}
                >
                  <img
                    src={contact.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}
                    alt={contact.phone}
                    style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                      {contact.phone || contact.name}
                    </h4>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                      Not saved in phonebook
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setInspectUser(contact);
                    }}
                    className="glass-pill"
                    style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700', color: '#0284c7', border: '1px solid #0284c7', cursor: 'pointer' }}
                  >
                    + Save
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 3. INVITE TO GLASSCHAT (UNREGISTERED SAVED PHONEBOOK CONTACTS) */}
          {filteredUnregisteredSaved.length > 0 && (
            <div>
              <div style={{ padding: '0 4px', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b' }}>
                  Invite to GlassChat ({filteredUnregisteredSaved.length})
                </span>
              </div>

              {filteredUnregisteredSaved.map(sc => (
                <div
                  key={sc.id || sc.phone}
                  className="glass-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 14px',
                    gap: '12px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '800',
                    fontSize: '15px',
                    flexShrink: 0
                  }}>
                    {(sc.name || '?').charAt(0).toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                      {sc.name}
                    </h4>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '1px 0 0 0' }}>
                      {sc.phone}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => openSmsInvite(sc.phone, sc.name)}
                    className="glass-pill"
                    style={{
                      padding: '6px 14px',
                      fontSize: '11px',
                      fontWeight: '800',
                      color: '#0284c7',
                      backgroundColor: 'rgba(2, 132, 199, 0.1)',
                      border: '1px solid rgba(2, 132, 199, 0.35)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      flexShrink: 0
                    }}
                    title="Send normal SMS with GlassChat download link"
                  >
                    <Share2 size={12} /> Invite
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Inspect User Profile Modal */}
      {inspectUser && (
        <UserProfileModal
          user={inspectUser}
          currentUser={currentUser || { id: currentUserId }}
          onClose={() => setInspectUser(null)}
          savedContactsMap={savedContactsMap}
          onSaveContact={onSaveContact}
          onStartChat={(u) => {
            setInspectUser(null);
            onSelectContact(u);
            onClose();
          }}
          onStartCall={(u, isVideo) => {
            setInspectUser(null);
            onClose();
            onStartCall(u, isVideo);
          }}
        />
      )}
    </div>
  );
}
