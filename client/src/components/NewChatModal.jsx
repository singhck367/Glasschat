import React, { useState, useRef } from 'react';
import { X, Search, UserPlus, Phone, Video, MessageSquare, Info, UserX, Sparkles, Smartphone, Upload, CheckCircle2 } from 'lucide-react';
import UserProfileModal from './UserProfileModal';

export default function NewChatModal({ 
  contacts = [], 
  onClose, 
  onSelectContact, 
  onStartCall,
  currentUserId,
  chatSummaries = {},
  savedContactsMap = {},
  onSaveContact,
  onSyncContacts
}) {
  const [search, setSearch] = useState('');
  const [inspectUser, setInspectUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('');
  const fileInputRef = useRef(null);

  const cleanSearch = search.trim().toLowerCase();
  const cleanDigits = search.replace(/\D/g, '');

  // Helper to resolve saved contact name
  const getDisplayName = (userObj) => {
    if (!userObj) return 'User';
    const uPhone = userObj.phone || '';
    const uDigits = uPhone.replace(/\D/g, '');
    const last10 = uDigits.slice(-10);
    const savedName = savedContactsMap[last10] || savedContactsMap[uDigits];
    return savedName || userObj.name || uPhone || 'User';
  };

  // Sync Phone Contacts using modern Web Contact Picker API (Chrome on Android)
  const handleSyncNativeContacts = async () => {
    setSyncStatus('Reading contacts...');
    try {
      if ('contacts' in navigator && 'select' in navigator.contacts) {
        const props = ['name', 'tel'];
        const selected = await navigator.contacts.select(props, { multiple: true });
        if (selected && selected.length > 0) {
          const formatted = selected.map(c => ({
            name: Array.isArray(c.name) ? c.name[0] : c.name,
            phone: Array.isArray(c.tel) ? c.tel[0] : c.tel
          })).filter(c => c.phone);

          if (formatted.length > 0 && onSyncContacts) {
            await onSyncContacts(formatted);
            setSyncStatus(`✅ Synced ${formatted.length} contacts to server!`);
            setTimeout(() => setSyncStatus(''), 4000);
            return;
          }
        }
      }
      // If native contact picker not available or returned empty, trigger VCF file picker
      fileInputRef.current?.click();
    } catch (e) {
      console.warn('Native contact sync notice:', e);
      fileInputRef.current?.click();
    }
  };

  // VCF / vCard file upload parser
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
        setSyncStatus(`✅ Synced ${parsedContacts.length} contacts from file to server!`);
      } else {
        setSyncStatus('No valid contacts found in file.');
      }
      setTimeout(() => setSyncStatus(''), 4000);
    };
    reader.readAsText(file);
  };

  // Filter contacts with whom the user already has an active conversation
  const recentContacts = contacts.filter(c => {
    if (c.id === currentUserId) return false;
    const cChatId = `chat_${[currentUserId, c.id].sort().join('_')}`;
    return Boolean(chatSummaries[cChatId]?.lastMessage);
  });

  // When searching: search across all registered users (excluding current user)
  const searchResults = cleanSearch ? contacts.filter(c => {
    if (c.id === currentUserId) return false;
    const resolvedName = getDisplayName(c).toLowerCase();
    const rawName = (c.name || '').toLowerCase();
    const nameMatch = resolvedName.includes(cleanSearch) || rawName.includes(cleanSearch);
    const phoneRawMatch = c.phone?.toLowerCase().includes(cleanSearch);
    const cDigits = (c.phone || '').replace(/\D/g, '');
    const phoneDigitsMatch = cleanDigits.length > 0 && cDigits.includes(cleanDigits);
    return nameMatch || phoneRawMatch || phoneDigitsMatch;
  }) : [];

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
        height: '82vh',
        maxHeight: '640px',
        borderRadius: '28px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        boxShadow: 'var(--glass-shadow-lg)'
      }}>
        {/* Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
              Start New Chat
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Search by Name or 10-digit Number
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
            placeholder="Search name or mobile number (e.g. 9162152221)..."
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

        {/* 📲 Sync Phone Contacts Quick Action */}
        <input 
          type="file" 
          ref={fileInputRef} 
          accept=".vcf,.vcard,text/vcard" 
          onChange={handleVcfUpload} 
          style={{ display: 'none' }} 
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
          <button
            onClick={handleSyncNativeContacts}
            className="glass-btn"
            style={{
              flex: 1,
              height: '34px',
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
            title="Import/Sync contacts from your mobile address book to server"
          >
            <Smartphone size={14} /> Sync Device Contacts
          </button>
        </div>
        {syncStatus && (
          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: '700', textAlign: 'center', padding: '2px 0' }}>
            {syncStatus}
          </div>
        )}

        {/* Modal Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          paddingRight: '2px'
        }}>
          {/* STATE 1: ACTIVE SEARCH */}
          {cleanSearch ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', padding: '0 4px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                  Search Results ({searchResults.length})
                </span>
                <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '600' }}>
                  matching "{search}"
                </span>
              </div>

              {searchResults.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-secondary)' }}>
                  <UserX size={36} color="#94a3b8" style={{ marginBottom: '10px' }} />
                  <p style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                    No User Found
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0 0' }}>
                    No registered user matching "{search}". Please check the name or 10-digit mobile number.
                  </p>
                </div>
              ) : (
                searchResults.map(contact => (
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectUser(contact);
                      }}
                      title="View Profile"
                    >
                      <img 
                        src={contact.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                        alt={contact.name}
                        style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255, 255, 255, 0.9)' }}
                      />
                      {contact.online && (
                        <span style={{
                          position: 'absolute',
                          bottom: '1px',
                          right: '1px',
                          width: '10px',
                          height: '10px',
                          backgroundColor: '#22c55e',
                          border: '2px solid #ffffff',
                          borderRadius: '50%'
                        }} />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                        {getDisplayName(contact)}
                      </h4>
                      <p style={{ fontSize: '12px', color: 'var(--text-accent)', fontWeight: '600', margin: '1px 0' }}>
                        {contact.phone}
                        {contact.name && contact.name !== getDisplayName(contact) && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                            (~{contact.name})
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {contact.status || 'Available'}
                      </p>
                    </div>

                    {/* Quick Action Buttons */}
                    <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setInspectUser(contact)}
                        className="glass-btn"
                        style={{ width: '32px', height: '32px' }}
                        title="View Profile"
                      >
                        <Info size={14} color="#64748b" />
                      </button>
                      <button
                        onClick={() => {
                          onClose();
                          onStartCall(contact, false);
                        }}
                        className="glass-btn"
                        style={{ width: '32px', height: '32px' }}
                        title="Audio Call"
                      >
                        <Phone size={14} color="#0284c7" />
                      </button>
                      <button
                        onClick={() => {
                          onClose();
                          onStartCall(contact, true);
                        }}
                        className="glass-btn"
                        style={{ width: '32px', height: '32px' }}
                        title="Video Call"
                      >
                        <Video size={14} color="#0284c7" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* STATE 2: EMPTY SEARCH (Privacy Protection - No strangers exposed) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Privacy Guideline Card */}
              <div style={{
                padding: '16px 14px',
                borderRadius: '18px',
                background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.08) 0%, rgba(56, 189, 248, 0.04) 100%)',
                border: '1px solid rgba(2, 132, 199, 0.25)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px'
              }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'rgba(2, 132, 199, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '2px'
                }}>
                  <Search size={18} color="#0284c7" />
                </div>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '800', color: '#0369a1' }}>
                  Private Contact Discovery
                </h4>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  To protect user privacy, new profiles are not shown publicly. Type a contact's <strong>Name</strong> or <strong>Mobile Number</strong> in the search bar above to connect.
                </p>
              </div>

              {/* Recent Active Conversations (if any) */}
              {recentContacts.length > 0 && (
                <div>
                  <div style={{ padding: '0 4px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                      Recent Conversations ({recentContacts.length})
                    </span>
                  </div>

                  {recentContacts.map(contact => (
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setInspectUser(contact);
                        }}
                        title="View Profile"
                      >
                        <img 
                          src={contact.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                          alt={contact.name}
                          style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255, 255, 255, 0.9)' }}
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
                        <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                          {getDisplayName(contact)}
                        </h4>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '1px 0' }}>
                          {contact.phone}
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          onSelectContact(contact);
                          onClose();
                        }}
                        className="glass-btn"
                        style={{ width: '32px', height: '32px', backgroundColor: 'rgba(2, 132, 199, 0.1)', borderColor: '#0284c7' }}
                        title="Chat"
                      >
                        <MessageSquare size={14} color="#0284c7" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Inspect User Profile Modal */}
      {inspectUser && (
        <UserProfileModal
          user={inspectUser}
          currentUser={{ id: currentUserId }}
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
