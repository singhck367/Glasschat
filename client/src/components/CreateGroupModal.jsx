import React, { useState } from 'react';
import { X, Users, Check, Megaphone } from 'lucide-react';
import { resolveDisplayName } from '../utils/contacts';

export default function CreateGroupModal({ 
  contacts, 
  onClose, 
  onCreateGroup,
  savedContactsMap = {}
}) {
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [isChannel, setIsChannel] = useState(false);

  const toggleContact = (userId) => {
    setSelectedContacts(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId) 
        : [...prev, userId]
    );
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    onCreateGroup({
      name: groupName.trim(),
      description: groupDesc.trim(),
      members: selectedContacts,
      isChannel
    });
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 110,
      backgroundColor: 'rgba(235, 244, 255, 0.85)',
      backdropFilter: 'blur(24px) saturate(160%)',
      WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '420px',
        borderRadius: '26px',
        padding: '22px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        border: '1px solid rgba(255, 255, 255, 0.85)',
        boxShadow: 'var(--glass-shadow-lg)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '12px',
              backgroundColor: 'rgba(2, 132, 199, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Users size={18} color="#0284c7" />
            </div>
            <div>
              <h3 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                New Group
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
                Select members to add
              </p>
            </div>
          </div>

          <button onClick={onClose} className="glass-btn" style={{ width: '32px', height: '32px' }}>
            <X size={16} color="var(--text-secondary)" />
          </button>
        </div>

        {/* Inputs */}
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input 
            type="text" 
            value={groupName} 
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group Name (e.g., Tech Innovators)"
            className="glass-input"
            required
            style={{ fontSize: '13px', padding: '10px 14px' }}
          />

          <input 
            type="text" 
            value={groupDesc} 
            onChange={(e) => setGroupDesc(e.target.value)}
            placeholder={isChannel ? "Channel Description (optional)" : "Group Description (optional)"}
            className="glass-input"
            style={{ fontSize: '13px', padding: '10px 14px' }}
          />

          {/* Announcement Channel Toggle */}
          <label
            onClick={() => setIsChannel(!isChannel)}
            className="glass-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 12px',
              cursor: 'pointer',
              backgroundColor: isChannel ? 'rgba(139, 92, 246, 0.12)' : undefined,
              borderColor: isChannel ? '#8b5cf6' : undefined
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Megaphone size={16} color="#8b5cf6" />
              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  Announcement Channel Mode
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                  Only admins can post messages; members can read and react
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isChannel}
              onChange={(e) => setIsChannel(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#8b5cf6' }}
            />
          </label>

          {/* Members Selection List */}
          <div style={{ marginTop: '8px' }}>
            <p style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Select Participants ({selectedContacts.length} selected):
            </p>
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {contacts.map((contact) => {
                const isSelected = selectedContacts.includes(contact.id);
                return (
                  <div 
                    key={contact.id}
                    onClick={() => toggleContact(contact.id)}
                    className="glass-card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      border: isSelected ? '1px solid rgba(2, 132, 199, 0.6)' : '1px solid var(--glass-border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <img 
                        src={contact.avatar} 
                        alt={contact.name}
                        style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div>
                        <h4 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                          {resolveDisplayName(contact, savedContactsMap, true)}
                        </h4>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
                          {contact.phone || contact.status}
                        </p>
                      </div>
                    </div>

                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      border: isSelected ? 'none' : '2px solid rgba(148, 163, 184, 0.6)',
                      backgroundColor: isSelected ? '#0284c7' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {isSelected && <Check size={13} color="#ffffff" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button 
            type="submit"
            disabled={!groupName.trim()}
            className="glass-btn glass-btn-primary"
            style={{
              borderRadius: '16px',
              height: '42px',
              marginTop: '10px',
              fontSize: '14px',
              fontWeight: '700',
              opacity: groupName.trim() ? 1 : 0.6
            }}
          >
            Create Glass Group
          </button>
        </form>
      </div>
    </div>
  );
}

