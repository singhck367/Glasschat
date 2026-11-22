import React from 'react';
import { MessageSquare, CircleDashed, PhoneCall, SlidersHorizontal } from 'lucide-react';

export default function BottomTabBar({ activeTab, setActiveTab, unreadCount = 0, missedCallsCount = 0, hasNewStatus = false }) {
  const tabs = [
    { id: 'chats', label: 'Chats', icon: MessageSquare, badge: unreadCount },
    { id: 'status', label: 'Status', icon: CircleDashed, hasDot: hasNewStatus },
    { id: 'calls', label: 'Calls', icon: PhoneCall, badge: missedCallsCount },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal }
  ];

  return (
    <nav className="glass-panel" style={{
      position: 'absolute',
      bottom: 'max(14px, env(safe-area-inset-bottom, 14px))',
      left: '14px',
      right: '14px',
      borderRadius: '26px',
      padding: '7px 12px',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      border: '1px solid rgba(255, 255, 255, 0.75)',
      backgroundColor: 'rgba(255, 255, 255, 0.92)',
      boxShadow: '0 10px 30px rgba(100, 116, 139, 0.16)',
      zIndex: 30
    }}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: isActive 
                ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.45) 100%)' 
                : 'transparent',
              border: isActive ? '1px solid rgba(255, 255, 255, 0.85)' : 'none',
              borderRadius: '20px',
              padding: '8px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              position: 'relative',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              boxShadow: isActive ? '0 4px 14px rgba(0, 0, 0, 0.05)' : 'none'
            }}
          >
            <div style={{ position: 'relative' }}>
              <Icon 
                size={20} 
                color={isActive ? '#0284c7' : '#64748b'} 
                strokeWidth={isActive ? 2.3 : 1.8}
              />
              {tab.hasDot && !tab.badge && (
                <span style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                  border: '1.5px solid #ffffff'
                }} />
              )}
              {Boolean(tab.badge) && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-8px',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: '700',
                  borderRadius: '10px',
                  padding: '1px 5px',
                  minWidth: '16px',
                  textAlign: 'center'
                }}>
                  {tab.badge}
                </span>
              )}
            </div>
            <span style={{
              fontSize: '11px',
              fontWeight: isActive ? '700' : '500',
              color: isActive ? '#0284c7' : '#64748b'
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

