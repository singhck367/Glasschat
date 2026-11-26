import React from 'react';
import { Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, Users } from 'lucide-react';
import { formatChatTimestamp } from '../utils/time';
import { resolveDisplayName } from '../utils/contacts';

export default function CallsList({ 
  calls = [], 
  contacts = [], 
  onStartCall, 
  searchQuery,
  savedContactsMap = {}
}) {
  const resolveCaller = (call) => {
    if (call.isGroup) return call.callerName || 'Group';
    const matched = contacts.find(c => c.id === call.callerId);
    if (matched) return resolveDisplayName(matched, savedContactsMap, false);
    return resolveDisplayName({
      name: call.callerName,
      phone: call.callerPhone || ''
    }, savedContactsMap, false);
  };

  const filteredCalls = calls.filter(call => {
    const dName = resolveCaller(call);
    const q = (searchQuery || '').toLowerCase();
    return !q || dName.toLowerCase().includes(q) || (call.callerPhone || '').toLowerCase().includes(q);
  });

  return (
    <div style={{
      padding: '14px 16px',
      paddingBottom: '90px',
      overflowY: 'auto',
      height: '100%'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '14px'
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
          Recent Calls
        </h2>
        <span className="glass-pill" style={{ padding: '2px 10px', fontSize: '11px', fontWeight: '600' }}>
          {filteredCalls.length} logs
        </span>
      </div>

      {filteredCalls.map((call) => {
        const isVideo = call.type === 'video';
        const isMissed = call.status === 'missed';
        const isIncoming = call.status === 'incoming';
        const displayCallerName = resolveCaller(call);
        const matchedContact = contacts.find(c => c.id === call.callerId);

        return (
          <div
            key={call.id}
            className="glass-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 14px',
              marginBottom: '10px',
              gap: '12px'
            }}
          >
            {/* Avatar */}
            <div style={{ position: 'relative' }}>
              <img 
                src={matchedContact?.avatar || call.callerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
                alt={displayCallerName}
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: call.isGroup ? '16px' : '50%',
                  objectFit: 'cover',
                  border: '2px solid rgba(255, 255, 255, 0.85)'
                }}
              />
              {call.isGroup && (
                <span style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  borderRadius: '50%',
                  padding: '3px'
                }}>
                  <Users size={11} color="#0284c7" />
                </span>
              )}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{
                fontSize: '15px',
                fontWeight: '700',
                color: isMissed ? '#ef4444' : 'var(--text-primary)',
                marginBottom: '2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {displayCallerName}
              </h3>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isMissed ? (
                  <PhoneMissed size={13} color="#ef4444" />
                ) : isIncoming ? (
                  <PhoneIncoming size={13} color="#22c55e" />
                ) : (
                  <PhoneOutgoing size={13} color="#0284c7" />
                )}
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {formatChatTimestamp(call.createdAt || call.timestamp)} • {call.duration || (isVideo ? 'Video' : 'Audio')}
                </span>
              </div>
            </div>

            {/* Redial Action */}
            <button
              onClick={() => onStartCall(
                {
                  id: call.callerId,
                  name: displayCallerName,
                  phone: matchedContact?.phone || call.callerPhone || '',
                  avatar: matchedContact?.avatar || call.callerAvatar,
                  isGroup: call.isGroup
                }, 
                isVideo
              )}
              className="glass-btn"
              style={{ width: '38px', height: '38px' }}
              title={`Call back (${isVideo ? 'Video' : 'Audio'})`}
            >
              {isVideo ? <Video size={16} color="#0284c7" /> : <Phone size={16} color="#0284c7" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
