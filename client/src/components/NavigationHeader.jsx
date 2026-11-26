import React from 'react';
import { Search, UserPlus, MessageSquarePlus, ShieldAlert } from 'lucide-react';

export default function NavigationHeader({ 
  currentUser, 
  searchQuery, 
  setSearchQuery, 
  onOpenCreateGroup,
  onOpenNewChat,
  onOpenAdmin,
  onOpenSettings,
  onOpenSos,
  activeTab 
}) {
  return (
    <header className="glass-panel" style={{
      padding: '12px 16px',
      paddingTop: 'max(14px, env(safe-area-inset-top, 14px))',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      borderBottom: '1px solid var(--glass-border)',
      backgroundColor: 'var(--glass-bg-header)',
      position: 'relative',
      zIndex: 20
    }}>
      {/* Top Row: Brand & Profile & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div 
            onClick={onOpenSettings}
            style={{ position: 'relative', cursor: 'pointer' }}
            title="Click to view & edit your profile"
          >
            <img 
              src={currentUser?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'} 
              alt="Profile" 
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid rgba(255, 255, 255, 0.85)',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)'
              }}
            />
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
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img 
              src="/favicon.png" 
              alt="Logo" 
              style={{ 
                width: '24px', 
                height: '24px', 
                borderRadius: '7px', 
                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)' 
              }} 
            />
            <h1 style={{ 
              fontSize: '22px', 
              fontWeight: '800', 
              letterSpacing: '-0.4px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              margin: 0
            }}>
              GlassChat
            </h1>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Emergency SOS Quick Button */}
          {onOpenSos && (
            <button
              onClick={onOpenSos}
              className="glass-btn"
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                borderColor: 'rgba(239, 68, 68, 0.45)'
              }}
              title="Emergency SOS Alert"
            >
              <ShieldAlert size={16} color="#ef4444" />
            </button>
          )}
          {/* New Chat / Contacts Directory */}
          <button 
            onClick={onOpenNewChat}
            className="glass-btn" 
            style={{ width: '36px', height: '36px', backgroundColor: 'rgba(2, 132, 199, 0.12)', borderColor: '#0284c7' }}
            title="Start New Chat (All Contacts)"
          >
            <MessageSquarePlus size={16} color="#0284c7" />
          </button>

          {/* New Group */}
          <button 
            onClick={onOpenCreateGroup}
            className="glass-btn" 
            style={{ width: '36px', height: '36px' }}
            title="Create New Group"
          >
            <UserPlus size={16} color="var(--text-primary)" />
          </button>
        </div>
      </div>

      {/* Search Input Bar */}
      <div style={{ position: 'relative' }}>
        <Search 
          size={15} 
          color="var(--text-muted)" 
          style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} 
        />
        <input 
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={
            activeTab === 'calls' 
              ? 'Search calls...' 
              : activeTab === 'groups'
              ? 'Search groups...'
              : 'Search chats, contacts...'
          }
          className="glass-input"
          style={{
            width: '100%',
            paddingLeft: '34px',
            fontSize: '13px'
          }}
        />
      </div>
    </header>
  );
}
