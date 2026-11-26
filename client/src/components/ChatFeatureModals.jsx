import React, { useState } from 'react';
import {
  X, Sparkles, ShieldAlert, Languages, Clock, Palette,
  Star, Forward, Send, IndianRupee, Handshake, Trash2,
  ExternalLink, CheckCircle2, AlertTriangle, Search, Calendar
} from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../utils/aiHelpers';
import { resolveDisplayName } from '../utils/contacts';

const WALLPAPER_PRESETS = [
  { id: 'default', label: 'Glass Default', bg: 'transparent' },
  { id: 'sky', label: 'Sky Mist', bg: 'linear-gradient(135deg, rgba(224,242,254,0.65), rgba(186,230,253,0.45))' },
  { id: 'mint', label: 'Emerald Leaf', bg: 'linear-gradient(135deg, rgba(209,250,229,0.65), rgba(167,243,208,0.45))' },
  { id: 'violet', label: 'Twilight Neon', bg: 'linear-gradient(135deg, rgba(237,233,254,0.6), rgba(199,210,254,0.45))' },
  { id: 'midnight', label: 'Midnight Slate', bg: 'linear-gradient(135deg, rgba(15,23,42,0.85), rgba(30,41,59,0.9))' }
];

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 185,
  backgroundColor: 'rgba(15, 23, 42, 0.65)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px'
};

const cardStyle = {
  width: '100%',
  maxWidth: '410px',
  maxHeight: '88vh',
  overflowY: 'auto',
  borderRadius: '26px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  border: '1.5px solid var(--glass-border)'
};

export default function ChatFeatureModals({
  chat,
  chatId,
  currentUser,
  contacts = [],
  savedContactsMap = {},
  // Options Modal
  showOptionsModal,
  setShowOptionsModal,
  chatSettings,
  onUpdateDisappearTimer,
  autoTranslateLang,
  onChangeAutoTranslate,
  chatWallpaper,
  onChangeWallpaper,
  moodGuardEnabled,
  onToggleMoodGuard,
  showStarredOnly,
  onToggleStarredOnly,
  onRunAiSummary,
  scheduledList = [],
  onCancelScheduled,
  onOpenSos,
  // AI Summary Modal
  summaryModal,
  setSummaryModal,
  // Truth Check Modal
  truthCheckModal,
  setTruthCheckModal,
  // Forward Modal
  forwardMsg,
  setForwardMsg,
  onConfirmForward,
  // Schedule Modal
  showScheduleModal,
  setShowScheduleModal,
  onConfirmSchedule,
  // UPI Modal
  showUpiModal,
  setShowUpiModal,
  onConfirmUpi,
  // Contract Modal
  showContractModal,
  setShowContractModal,
  onConfirmContract
}) {
  const [forwardSearch, setForwardSearch] = useState('');

  // Schedule state
  const defaultSchedTime = new Date(Date.now() + 15 * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const [schedDate, setSchedDate] = useState(defaultSchedTime.toISOString().slice(0, 10));
  const [schedTime, setSchedTime] = useState(`${pad(defaultSchedTime.getHours())}:${pad(defaultSchedTime.getMinutes())}`);
  const [schedText, setSchedText] = useState('');

  // UPI state
  const [upiMode, setUpiMode] = useState('request'); // 'request' | 'send'
  const [upiVpa, setUpiVpa] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [upiNote, setUpiNote] = useState('');

  // Contract state
  const [contractTitle, setContractTitle] = useState('');
  const [contractDue, setContractDue] = useState('');
  const [contractAmount, setContractAmount] = useState('');

  const forwardTargets = contacts.filter(c => {
    if (c.id === currentUser?.id) return false;
    const name = resolveDisplayName(c, savedContactsMap, true).toLowerCase();
    const q = forwardSearch.trim().toLowerCase();
    return !q || name.includes(q) || (c.phone || '').includes(q);
  });

  return (
    <>
      {/* 1. CHAT OPTIONS / SMART CONTROLS MODAL */}
      {showOptionsModal && (
        <div style={overlayStyle} onClick={() => setShowOptionsModal(false)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>
                Smart Chat Controls ✨
              </h3>
              <button onClick={() => setShowOptionsModal(false)} className="glass-btn" style={{ width: '32px', height: '32px' }}>
                <X size={15} />
              </button>
            </div>

            {/* AI Summary Shortcut */}
            <button
              type="button"
              onClick={() => {
                setShowOptionsModal(false);
                onRunAiSummary();
              }}
              className="glass-btn glass-btn-primary"
              style={{
                width: '100%',
                height: '42px',
                borderRadius: '14px',
                gap: '8px',
                fontSize: '13px',
                fontWeight: '800'
              }}
            >
              <Sparkles size={16} />
              AI Chat Summary ("What was decided today?")
            </button>

            {/* Per-Chat Auto-Translate */}
            <div className="glass-card" style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Languages size={17} color="#0284c7" />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>Auto-Translate Chat</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Incoming messages auto-convert</div>
                </div>
              </div>
              <select
                value={autoTranslateLang}
                onChange={(e) => onChangeAutoTranslate(e.target.value)}
                className="glass-input"
                style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '12px' }}
              >
                <option value="off">Off</option>
                {SUPPORTED_LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </div>

            {/* Disappearing Messages */}
            <div className="glass-card" style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={17} color="#8b5cf6" />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>Disappearing Messages</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Auto-delete new messages</div>
                </div>
              </div>
              <select
                value={String(chatSettings?.disappearDurationMs || 0)}
                onChange={(e) => onUpdateDisappearTimer(Number(e.target.value))}
                className="glass-input"
                style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '12px' }}
              >
                <option value="0">Off</option>
                <option value="86400000">24 Hours</option>
                <option value="604800000">7 Days</option>
              </select>
            </div>

            {/* Per-Chat Wallpaper & Color */}
            <div className="glass-card" style={{ padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Palette size={16} color="#ec4899" />
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>Chat Wallpaper</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {WALLPAPER_PRESETS.map(wp => (
                  <button
                    key={wp.id}
                    type="button"
                    onClick={() => onChangeWallpaper(wp.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      border: chatWallpaper === wp.id ? '2px solid #0284c7' : '1px solid var(--glass-border)',
                      background: wp.id === 'default' ? 'var(--glass-bg)' : wp.bg,
                      color: wp.id === 'midnight' ? '#ffffff' : 'var(--text-primary)'
                    }}
                  >
                    {wp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles: Mood Chat Mode & Starred Filter */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onToggleMoodGuard}
                className="glass-card"
                style={{
                  flex: 1,
                  padding: '10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderColor: moodGuardEnabled ? '#0284c7' : undefined,
                  backgroundColor: moodGuardEnabled ? 'rgba(2,132,199,0.1)' : undefined
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  😊 Mood Guard: {moodGuardEnabled ? 'ON' : 'OFF'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Polite tone coach</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onToggleStarredOnly();
                  setShowOptionsModal(false);
                }}
                className="glass-card"
                style={{
                  flex: 1,
                  padding: '10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderColor: showStarredOnly ? '#eab308' : undefined,
                  backgroundColor: showStarredOnly ? 'rgba(234,179,8,0.12)' : undefined
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Star size={13} color="#eab308" /> Starred: {showStarredOnly ? 'Showing' : 'All'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Filter saved messages</div>
              </button>
            </div>

            {/* Scheduled Messages Queue */}
            {scheduledList.length > 0 && (
              <div className="glass-card" style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#0284c7' }}>
                  ⏰ SCHEDULED MESSAGES ({scheduledList.length})
                </span>
                {scheduledList.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.payload?.text}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Due: {item.sendAtFormatted}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCancelScheduled(item.id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                      title="Cancel scheduled message"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Emergency SOS Trigger */}
            {onOpenSos && (
              <button
                type="button"
                onClick={() => {
                  setShowOptionsModal(false);
                  onOpenSos();
                }}
                className="glass-btn"
                style={{
                  width: '100%',
                  height: '38px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: '800',
                  color: '#ef4444',
                  borderColor: 'rgba(239,68,68,0.4)',
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  gap: '6px'
                }}
              >
                <ShieldAlert size={15} /> Emergency SOS Alert
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. AI CHAT SUMMARY MODAL */}
      {summaryModal && (
        <div style={overlayStyle} onClick={() => setSummaryModal(null)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  AI Chat Summary
                </h3>
              </div>
              <button onClick={() => setSummaryModal(null)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            {summaryModal.loading ? (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Analyzing conversation...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
                <div className="glass-card" style={{ padding: '12px', color: 'var(--text-primary)', lineHeight: 1.45 }}>
                  <strong>Overview:</strong> {summaryModal.summary}
                </div>

                {summaryModal.decisions?.length > 0 && (
                  <div className="glass-card" style={{ padding: '10px 12px' }}>
                    <strong style={{ color: '#16a34a', display: 'block', marginBottom: '4px' }}>✅ Key Decisions:</strong>
                    {summaryModal.decisions.map((d, i) => <div key={i} style={{ color: 'var(--text-primary)', marginBottom: '2px' }}>• {d}</div>)}
                  </div>
                )}

                {summaryModal.actionItems?.length > 0 && (
                  <div className="glass-card" style={{ padding: '10px 12px' }}>
                    <strong style={{ color: '#0284c7', display: 'block', marginBottom: '4px' }}>📌 Action Items / Reminders:</strong>
                    {summaryModal.actionItems.map((a, i) => <div key={i} style={{ color: 'var(--text-primary)', marginBottom: '2px' }}>• {a}</div>)}
                  </div>
                )}

                {summaryModal.questions?.length > 0 && (
                  <div className="glass-card" style={{ padding: '10px 12px' }}>
                    <strong style={{ color: '#d97706', display: 'block', marginBottom: '4px' }}>❓ Open Questions:</strong>
                    {summaryModal.questions.map((q, i) => <div key={i} style={{ color: 'var(--text-primary)', marginBottom: '2px' }}>• {q}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. TRUTH CHECK / FACT-CHECK MODAL */}
      {truthCheckModal && (
        <div style={overlayStyle} onClick={() => setTruthCheckModal(null)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {truthCheckModal.level === 'danger' ? (
                  <AlertTriangle size={18} color="#ef4444" />
                ) : truthCheckModal.level === 'safe' ? (
                  <CheckCircle2 size={18} color="#16a34a" />
                ) : (
                  <ShieldAlert size={18} color="#d97706" />
                )}
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  Truth Check (Fact-Check)
                </h3>
              </div>
              <button onClick={() => setTruthCheckModal(null)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            {truthCheckModal.loading ? (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Scanning links, claims & Wikipedia references...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
                <div className="glass-card" style={{
                  padding: '12px',
                  borderColor: truthCheckModal.level === 'danger' ? '#ef4444' : truthCheckModal.level === 'safe' ? '#16a34a' : '#f59e0b',
                  backgroundColor: truthCheckModal.level === 'danger' ? 'rgba(239,68,68,0.1)' : truthCheckModal.level === 'safe' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'
                }}>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                    {truthCheckModal.verdict}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                    Risk Score: {truthCheckModal.riskScore || 0}/100
                  </div>
                </div>

                {truthCheckModal.reasons?.length > 0 && (
                  <div className="glass-card" style={{ padding: '10px 12px' }}>
                    <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>Findings:</strong>
                    {truthCheckModal.reasons.map((r, i) => (
                      <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>• {r}</div>
                    ))}
                  </div>
                )}

                {truthCheckModal.references?.length > 0 && (
                  <div className="glass-card" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <strong style={{ color: '#0284c7' }}>Wikipedia Context:</strong>
                    {truthCheckModal.references.map((ref, i) => (
                      <a key={i} href={ref.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'var(--text-primary)' }}>
                        <div style={{ fontWeight: '700', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {ref.title} <ExternalLink size={11} />
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{ref.snippet}</div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. FORWARD MESSAGE MODAL */}
      {forwardMsg && (
        <div style={overlayStyle} onClick={() => setForwardMsg(null)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Forward size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>Forward To...</h3>
              </div>
              <button onClick={() => setForwardMsg(null)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Search saved contact..."
                value={forwardSearch}
                onChange={(e) => setForwardSearch(e.target.value)}
                className="glass-input"
                style={{ width: '100%', paddingLeft: '32px', fontSize: '12px' }}
              />
            </div>

            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {forwardTargets.map(target => (
                <div
                  key={target.id}
                  onClick={() => onConfirmForward(target, forwardMsg)}
                  className="glass-card"
                  style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img
                      src={target.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'}
                      alt=""
                      style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {resolveDisplayName(target, savedContactsMap, true)}
                    </span>
                  </div>
                  <Send size={14} color="#0284c7" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 5. SCHEDULE MESSAGE MODAL */}
      {showScheduleModal && (
        <div style={overlayStyle} onClick={() => setShowScheduleModal(false)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={18} color="#8b5cf6" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>Schedule Message</h3>
              </div>
              <button onClick={() => setShowScheduleModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!schedText.trim()) return;
                const ts = new Date(`${schedDate}T${schedTime}`).getTime();
                if (!ts || Number.isNaN(ts) || ts <= Date.now()) {
                  alert('Please pick a future date and time.');
                  return;
                }
                onConfirmSchedule({ text: schedText.trim(), sendAtMs: ts });
                setSchedText('');
                setShowScheduleModal(false);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className="glass-input" style={{ flex: 1, fontSize: '12px' }} required />
                <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} className="glass-input" style={{ flex: 1, fontSize: '12px' }} required />
              </div>
              <textarea
                rows={3}
                value={schedText}
                onChange={(e) => setSchedText(e.target.value)}
                placeholder="Type message to auto-send later..."
                className="glass-input"
                style={{ width: '100%', fontSize: '13px', borderRadius: '16px' }}
                required
              />
              <button type="submit" className="glass-btn glass-btn-primary" style={{ width: '100%', height: '40px', borderRadius: '14px', fontSize: '13px', fontWeight: '800' }}>
                Schedule Auto-Send ⏰
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 6. UPI SEND / REQUEST MODAL */}
      {showUpiModal && (
        <div style={overlayStyle} onClick={() => setShowUpiModal(false)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IndianRupee size={18} color="#16a34a" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>In-Chat UPI Pay</h3>
              </div>
              <button onClick={() => setShowUpiModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: 'request', label: 'Request Money' },
                { id: 'send', label: 'Share Pay Link' }
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setUpiMode(m.id)}
                  className="glass-btn"
                  style={{
                    flex: 1,
                    height: '34px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: '700',
                    backgroundColor: upiMode === m.id ? 'rgba(22,163,74,0.16)' : undefined,
                    borderColor: upiMode === m.id ? '#16a34a' : undefined,
                    color: upiMode === m.id ? '#16a34a' : 'var(--text-secondary)'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!upiVpa.trim() || !upiAmount) return;
                onConfirmUpi({
                  vpa: upiVpa.trim(),
                  amount: Number(upiAmount),
                  note: upiNote.trim() || `GlassChat payment`,
                  mode: upiMode
                });
                setUpiAmount('');
                setUpiNote('');
                setShowUpiModal(false);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <input
                type="text"
                placeholder="UPI ID (e.g. rahul@okicici)"
                value={upiVpa}
                onChange={(e) => setUpiVpa(e.target.value)}
                className="glass-input"
                required
                style={{ fontSize: '13px' }}
              />
              <input
                type="number"
                min="1"
                placeholder="Amount in ₹"
                value={upiAmount}
                onChange={(e) => setUpiAmount(e.target.value)}
                className="glass-input"
                required
                style={{ fontSize: '14px', fontWeight: '800' }}
              />
              <input
                type="text"
                placeholder="Note (e.g. Dinner split)"
                value={upiNote}
                onChange={(e) => setUpiNote(e.target.value)}
                className="glass-input"
                style={{ fontSize: '12px' }}
              />
              <button type="submit" className="glass-btn glass-btn-primary" style={{ width: '100%', height: '40px', borderRadius: '14px', fontSize: '13px', fontWeight: '800', background: 'linear-gradient(135deg, #16a34a, #059669)' }}>
                {upiMode === 'request' ? `Request ₹${upiAmount || '0'}` : `Send ₹${upiAmount || '0'} Card`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 7. CHAT CONTRACT / PROMISE TRACKER MODAL */}
      {showContractModal && (
        <div style={overlayStyle} onClick={() => setShowContractModal(false)}>
          <div className="glass-panel" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Handshake size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  Chat Contract / Promise
                </h3>
              </div>
              <button onClick={() => setShowContractModal(false)} className="glass-btn" style={{ width: '30px', height: '30px' }}>
                <X size={14} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!contractTitle.trim()) return;
                onConfirmContract({
                  title: contractTitle.trim(),
                  dueText: contractDue.trim() || 'No deadline set',
                  amount: contractAmount.trim()
                });
                setContractTitle('');
                setContractDue('');
                setContractAmount('');
                setShowContractModal(false);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <input
                type="text"
                placeholder='Promise (e.g. "Return payment by the 10th")'
                value={contractTitle}
                onChange={(e) => setContractTitle(e.target.value)}
                className="glass-input"
                required
                style={{ fontSize: '13px' }}
              />
              <input
                type="text"
                placeholder="Due date/time (e.g. 10th Dec, 6 PM)"
                value={contractDue}
                onChange={(e) => setContractDue(e.target.value)}
                className="glass-input"
                style={{ fontSize: '12px' }}
              />
              <input
                type="text"
                placeholder="Amount / Item (optional, e.g. ₹2000)"
                value={contractAmount}
                onChange={(e) => setContractAmount(e.target.value)}
                className="glass-input"
                style={{ fontSize: '12px' }}
              />
              <button type="submit" className="glass-btn glass-btn-primary" style={{ width: '100%', height: '40px', borderRadius: '14px', fontSize: '13px', fontWeight: '800' }}>
                Create & Record Promise 🤝
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export { WALLPAPER_PRESETS };
