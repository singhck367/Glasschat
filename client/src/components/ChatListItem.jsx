import React from 'react';
import { Phone, Video, CheckCheck, Check, Users } from 'lucide-react';

export default function ChatListItem({ 
  chat, 
  onSelectChat, 
  onStartCall, 
  currentUser,
  savedContactsMap = {}
}) {
  const isGroup = Boolean(chat.isGroup);
  const lastMessage = chat.lastMessage || 'Tap to start conversation';
  const timestamp = chat.timestamp || 'Today';
  const isOnline = Boolean(chat.online);

  const cleanPhoneDigits = (chat.phone || '').replace(/\D/g, '');
  const last10Digits = cleanPhoneDigits.slice(-10);
  const savedContactName = !isGroup ? (savedContactsMap[last10Digits] || savedContactsMap[cleanPhoneDigits] || '') : '';

  return (
    <div 
      onClick={() => onSelectChat(chat)}
      className="glass-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 14px',
        marginBottom: '10px',
        cursor: 'pointer',
        gap: '12px',
        position: 'relative'
      }}
    >
      {/* Avatar Container */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img 
          src={chat.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
          alt={chat.name}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: isGroup ? '18px' : '50%',
            objectFit: 'cover',
            border: '2px solid rgba(255, 255, 255, 0.85)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)'
          }}
        />
        {isGroup ? (
          <span style={{
            position: 'absolute',
            bottom: '-2px',
            right: '-2px',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            borderRadius: '50%',
            padding: '3px',
            display: 'flex',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
          }}>
            <Users size={12} color="#0284c7" />
          </span>
        ) : isOnline && (
          <span style={{
            position: 'absolute',
            bottom: '2px',
            right: '2px',
            width: '12px',
            height: '12px',
            backgroundColor: '#22c55e',
            border: '2px solid #ffffff',
            borderRadius: '50%',
            boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)'
          }} />
        )}
      </div>

      {/* Middle info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
          <h3 style={{
            fontSize: '15px',
            fontWeight: chat.unreadCount > 0 ? '700' : '600',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            {isGroup ? (
              chat.name
            ) : savedContactName ? (
              <span style={{ fontWeight: '800', color: 'var(--text-primary)' }}>{savedContactName}</span>
            ) : chat.phone ? (
              <>
                <span style={{ fontWeight: '800', color: 'var(--text-primary)' }}>{chat.phone}</span>
                {chat.name && chat.name !== chat.phone && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>
                    ~{chat.name}
                  </span>
                )}
              </>
            ) : (
              chat.name || 'User'
            )}
          </h3>
          <span style={{ 
            fontSize: '11px', 
            color: chat.unreadCount > 0 ? '#0284c7' : 'var(--text-muted)',
            fontWeight: chat.unreadCount > 0 ? '700' : '400'
          }}>
            {timestamp}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1 }}>
            <CheckCheck size={14} color="#0284c7" />
            <p style={{
              fontSize: '13px',
              color: chat.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: chat.unreadCount > 0 ? '600' : '400',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              margin: 0
            }}>
              {lastMessage}
            </p>
          </div>

          {/* Unread Message Badge */}
          {chat.unreadCount > 0 && (
            <span style={{
              backgroundColor: '#0284c7',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: '800',
              minWidth: '20px',
              height: '20px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 6px',
              marginLeft: '6px',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.45)'
            }}>
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* Quick Call Actions */}
      <div 
        style={{ display: 'flex', gap: '6px', marginLeft: '6px' }}
        onClick={(e) => e.stopPropagation()} // Prevent opening chat when tapping call
      >
        <button
          onClick={() => onStartCall(chat, false)} // Audio Call
          className="glass-btn"
          style={{ width: '34px', height: '34px' }}
          title={isGroup ? "Start Group Audio Call" : "Start Audio Call"}
        >
          <Phone size={15} color="#0284c7" />
        </button>

        <button
          onClick={() => onStartCall(chat, true)} // Video Call
          className="glass-btn"
          style={{ width: '34px', height: '34px' }}
          title={isGroup ? "Start Group Video Call" : "Start Video Call"}
        >
          <Video size={15} color="#0284c7" />
        </button>
      </div>
    </div>
  );
}

