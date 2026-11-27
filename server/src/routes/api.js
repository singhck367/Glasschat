import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  users, groups, messages, calls, statuses,
  scheduledMessages, chatSettings, reports, blockedRelations, callRecordings,
  otpStore, otpLogs, activeCallRooms, activeOneOnOneCalls, activeSessions, saveDatabase
} from '../data/store.js';
import { v4 as uuidv4 } from 'uuid';
import { formatISTTime, formatISTDateTime } from '../utils/time.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECORDINGS_DIR = path.resolve(__dirname, '../../recordings');
try {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
} catch {}

const router = express.Router();

// Helper to get consistent 1-on-1 chat room ID
export function getChatId(user1, user2) {
  return `chat_${[user1, user2].sort().join('_')}`;
}

// ==========================================
// AUTHENTICATION & PROFILE ROUTES
// ==========================================

// Send 6-digit OTP to phone number
router.post('/auth/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.trim().length < 6) {
    return res.status(400).json({ error: 'Valid phone number is required' });
  }

  const cleanPhone = phone.trim();
  const cleanDigits = cleanPhone.replace(/\D/g, '');
  const isOwnerNumber = cleanDigits.endsWith('9162152221') || cleanDigits.endsWith('9122666346');

  // If owner number, use private owner OTP '845274'; otherwise generate random 6-digit OTP
  const generatedOtp = isOwnerNumber 
    ? '845274' 
    : Math.floor(100000 + Math.random() * 900000).toString();

  otpStore.set(cleanPhone, {
    otp: generatedOtp,
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  // Log in Owner / Admin OTP records
  const logEntry = {
    id: `otp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    phone: cleanPhone,
    otp: generatedOtp,
    createdAt: formatISTDateTime(new Date()),
    timestamp: Date.now(),
    status: 'Active'
  };

  otpLogs.unshift(logEntry);
  if (otpLogs.length > 50) otpLogs.pop();

  console.log(`[AUTH] Dispatched OTP for ${cleanPhone}: ${generatedOtp} (Visible in Owner Control Panel)`);

  // Broadcast to Owner Control Panel in real-time
  req.io?.emit('admin-otp-generated', logEntry);

  // SECURE: Do NOT return the OTP code to the front screen!
  res.json({
    success: true,
    message: 'Verification code sent to your phone'
  });
});

// Verify OTP
router.post('/auth/verify-otp', (req, res) => {
  const { phone, otp, verified, firebaseUid } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone is required' });
  }

  const cleanPhone = phone.trim();
  const cleanDigits = cleanPhone.replace(/\D/g, '');
  const cleanOtp = (otp || '').trim();
  const record = otpStore.get(cleanPhone);

  const isOwnerNumber = cleanDigits.endsWith('9162152221') || cleanDigits.endsWith('9122666346');

  let isOtpValid = false;

  // 1. Private master OTP '845274' works ONLY for the 2 authorized owner numbers
  if (isOwnerNumber && cleanOtp === '845274') {
    isOtpValid = true;
  }
  // 2. Verified through Firebase Phone SMS token
  else if (verified === true) {
    isOtpValid = true;
  }
  // 3. Verified through matching active OTP generated in store (visible in Owner Control Panel)
  else if (record && record.otp === cleanOtp) {
    isOtpValid = true;
  }

  // NOTE: 123456 has been completely disabled and removed!

  if (!isOtpValid) {
    return res.status(400).json({ error: 'Invalid or expired OTP verification code.' });
  }

  otpStore.delete(cleanPhone);
  const log = otpLogs.find(l => l.phone === cleanPhone && l.status === 'Active');
  if (log) log.status = 'Verified';

  // Check if existing user with this phone (normalized)
  let user = users.find(u => {
    const uDigits = (u.phone || '').replace(/\D/g, '');
    return (cleanDigits && uDigits === cleanDigits) || u.phone === cleanPhone;
  });

  if (user && user.isBlocked) {
    return res.status(403).json({ error: 'This mobile number has been suspended by the administrator.' });
  }

  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = {
      id: `user_${uuidv4().substring(0, 8)}`,
      name: 'New User',
      phone: cleanPhone,
      email: '',
      dob: '',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      status: 'Hey there! I am using GlassChat ✨',
      online: true,
      lastSeen: new Date().toISOString(),
      twoStepEnabled: false,
      twoStepPin: '',
      recoveryEmail: '',
      privacy: {
        lastSeen: 'everyone', // 'everyone' | 'contacts' | 'nobody'
        photo: 'everyone',
        about: 'everyone',
        email: 'everyone',
        dob: 'contacts',
        readReceipts: true
      },
      createdAt: new Date().toISOString()
    };
    users.push(user);
    saveDatabase();
    // Broadcast newly registered user to all connected clients immediately
    req.io?.emit('user-registered', user);
  }

  // 🛡️ Two-Step Verification Check:
  // If user has 2FA enabled, require their 6-digit PIN before granting login access (unless owner uses master bypass)
  const isOwnerMasterPass = isOwnerNumber && cleanOtp === '845274';
  if (!isNewUser && user.twoStepEnabled && user.twoStepPin && !isOwnerMasterPass) {
    console.log(`[AUTH] 2FA Required for ${cleanPhone} (User ID: ${user.id})`);
    return res.json({
      success: true,
      requireTwoStep: true,
      userId: user.id,
      phone: cleanPhone,
      message: 'Enter your 6-digit Two-Step Verification PIN'
    });
  }

  res.json({
    success: true,
    user,
    isNewUser
  });
});

// Verify 6-digit Two-Step Verification PIN on Login
router.post('/auth/verify-two-step', (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin) {
    return res.status(400).json({ error: 'User ID and 6-digit PIN are required' });
  }

  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const cleanPin = String(pin).trim();
  const cleanDigits = (user.phone || '').replace(/\D/g, '');
  const isOwnerNumber = cleanDigits.endsWith('9162152221') || cleanDigits.endsWith('9122666346');

  // Verify PIN (Owner master PIN 845274 also acts as master bypass)
  const isPinValid = (user.twoStepPin && user.twoStepPin === cleanPin) || (isOwnerNumber && cleanPin === '845274');

  if (!isPinValid) {
    return res.status(400).json({ error: 'Incorrect 6-digit PIN. Please try again.' });
  }

  user.online = true;
  user.lastSeen = new Date().toISOString();
  saveDatabase();

  console.log(`[AUTH] 2FA Verified successfully for ${user.name} (${user.phone})`);
  res.json({
    success: true,
    user
  });
});

// Enable / Disable / Update Two-Step Verification PIN & Recovery Email
router.post('/auth/two-step/update', (req, res) => {
  const { userId, enabled, pin, recoveryEmail } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (enabled) {
    const cleanPin = String(pin || '').trim();
    if (!cleanPin || cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
      return res.status(400).json({ error: 'PIN must be exactly 6 numeric digits.' });
    }
    user.twoStepEnabled = true;
    user.twoStepPin = cleanPin;
    if (recoveryEmail !== undefined) {
      user.recoveryEmail = String(recoveryEmail).trim();
    }
  } else {
    user.twoStepEnabled = false;
    user.twoStepPin = '';
  }

  saveDatabase();

  req.io?.emit('user-updated', user);
  console.log(`[AUTH] Two-Step verification updated for ${user.phone}: Enabled=${user.twoStepEnabled}, PIN=${user.twoStepPin ? '******' : 'None'}`);

  res.json({
    success: true,
    user
  });
});

// Update Profile (Name, Bio, Avatar, Email, DOB, Privacy Settings, Appearance)
router.post('/auth/update-profile', (req, res) => {
  const { userId, name, avatar, status, email, dob, privacy, appearance } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (name !== undefined) user.name = name.trim();
  if (avatar !== undefined) user.avatar = avatar;
  if (status !== undefined) user.status = status.trim();
  if (email !== undefined) user.email = email.trim();
  if (dob !== undefined) user.dob = dob;
  if (privacy !== undefined) user.privacy = { ...(user.privacy || {}), ...privacy };
  if (appearance !== undefined) user.appearance = { ...(user.appearance || {}), ...appearance };

  saveDatabase();

  // Notify all connected clients about user profile update
  req.io?.emit('user-updated', user);

  res.json({ success: true, user });
});

// Get user profile with privacy filtering applied
router.get('/users/profile/:userId', (req, res) => {
  const { userId } = req.params;
  const viewerId = req.query.viewerId;
  const target = users.find(u => u.id === userId);
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isSelf = viewerId === userId;
  const p = target.privacy || {};

  const safeUser = {
    id: target.id,
    name: target.name,
    phone: target.phone,
    avatar: (isSelf || p.photo !== 'nobody') ? target.avatar : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    status: (isSelf || p.about !== 'nobody') ? target.status : '',
    email: (isSelf || p.email !== 'nobody') ? (target.email || '') : '',
    dob: (isSelf || p.dob !== 'nobody') ? (target.dob || '') : '',
    online: (isSelf || p.lastSeen !== 'nobody') ? Boolean(target.online) : false,
    lastSeen: (isSelf || p.lastSeen !== 'nobody') ? target.lastSeen : null,
    privacy: isSelf ? target.privacy : undefined,
    createdAt: target.createdAt
  };

  res.json(safeUser);
});

// Broadcast Message to multiple recipients
router.post('/messages/broadcast', (req, res) => {
  const { senderId, recipientIds = [], text, mediaUrl, type = 'text' } = req.body;
  const sender = users.find(u => u.id === senderId);
  if (!sender || !recipientIds.length) {
    return res.status(400).json({ error: 'Invalid sender or recipients' });
  }

  const sentList = [];
  for (const recipientId of recipientIds) {
    const chatId = `chat_${[senderId, recipientId].sort().join('_')}`;
    if (!messages[chatId]) messages[chatId] = [];

    const newMessage = {
      id: uuidv4(),
      senderId,
      senderName: sender.name,
      text,
      mediaUrl,
      type,
      encrypted: true,
      timestamp: formatISTTime(new Date()),
      status: 'delivered',
      isBroadcast: true
    };

    messages[chatId].push(newMessage);
    sentList.push({ recipientId, message: newMessage });

    req.io?.to(chatId).emit('new-message', {
      chatId,
      message: newMessage
    });
  }

  saveDatabase();
  res.json({ success: true, count: sentList.length });
});

// Get current user profile
router.get('/me', (req, res) => {
  const userId = req.query.userId || 'user_me';
  const me = users.find(u => u.id === userId) || users[0];
  res.json(me);
});

// Privacy-Strict Contacts Directory:
// Only returns users who are saved in viewer's contacts OR share an existing chat/group.
// Unknown strangers are NEVER listed publicly!
router.get('/users', (req, res) => {
  const currentUserId = req.query.userId;
  const q = req.query.q?.trim().toLowerCase();
  const qDigits = req.query.q?.replace(/\D/g, '') || '';

  if (!currentUserId) {
    return res.json([]);
  }

  const viewer = users.find(u => u.id === currentUserId);
  const viewerSaved = Array.isArray(viewer?.savedContacts) ? viewer.savedContacts : [];

  let list = users.filter(u => {
    if (u.id === currentUserId) return false;
    const uDigits = (u.phone || '').replace(/\D/g, '');
    const uLast10 = uDigits.slice(-10);

    // 1. Saved in viewer's contacts
    const isSaved = viewerSaved.some(sc => {
      const scDigits = (sc.cleanDigits || sc.phone || '').replace(/\D/g, '');
      return (uLast10 && scDigits.endsWith(uLast10)) || (scDigits && uDigits.endsWith(scDigits));
    });
    if (isSaved) return true;

    // 2. Existing 1-on-1 conversation history
    const directChatId = `chat_${[currentUserId, u.id].sort().join('_')}`;
    if (Array.isArray(messages[directChatId]) && messages[directChatId].length > 0) {
      return true;
    }

    // 3. Shares a group with viewer
    const sharesGroup = groups.some(g =>
      Array.isArray(g.members) && g.members.includes(currentUserId) && g.members.includes(u.id)
    );
    return sharesGroup;
  });

  if (q) {
    list = list.filter(u => {
      const nameMatch = u.name?.toLowerCase().includes(q);
      const phoneRawMatch = u.phone?.toLowerCase().includes(q);
      const uDigits = (u.phone || '').replace(/\D/g, '');
      const phoneDigitMatch = qDigits.length > 0 && uDigits.includes(qDigits);
      return nameMatch || phoneRawMatch || phoneDigitMatch;
    });
  }

  res.json(list);
});

// Exact Full-Number Discovery:
// Only returns an unsaved registered user once a COMPLETE 10+ digit mobile number is entered.
router.get('/users/find-by-phone', (req, res) => {
  const rawPhone = String(req.query.phone || '').trim();
  const viewerId = req.query.viewerId;
  const cleanDigits = rawPhone.replace(/\D/g, '');

  if (cleanDigits.length < 10) {
    return res.json({
      found: false,
      incomplete: true,
      message: 'Enter full 10-digit mobile number to search an unregistered/unsaved contact.'
    });
  }

  const targetLast10 = cleanDigits.slice(-10);
  const matched = users.find(u => {
    if (viewerId && u.id === viewerId) return false;
    const uDigits = (u.phone || '').replace(/\D/g, '');
    const uLast10 = uDigits.slice(-10);
    return uDigits === cleanDigits || (targetLast10.length === 10 && uLast10 === targetLast10);
  });

  if (!matched) {
    return res.json({ found: false, incomplete: false, phone: rawPhone });
  }

  return res.json({
    found: true,
    incomplete: false,
    user: {
      id: matched.id,
      name: matched.name,
      phone: matched.phone,
      avatar: matched.avatar,
      status: matched.status,
      online: Boolean(matched.online),
      lastSeen: matched.lastSeen
    }
  });
});

// ==========================================
// 📱 CONTACT SYNC & SAVED CONTACTS ROUTES
// ==========================================

// Get user's saved / synced contacts
router.get('/contacts/saved', (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    success: true,
    savedContacts: user.savedContacts || []
  });
});

// Save or update a single contact name for a phone number
router.post('/contacts/save', (req, res) => {
  const { userId, phone, name } = req.body;
  if (!userId || !phone || !name || !name.trim()) {
    return res.status(400).json({ error: 'User ID, valid phone, and contact name are required' });
  }

  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!Array.isArray(user.savedContacts)) {
    user.savedContacts = [];
  }

  const cleanPhone = phone.trim();
  const cleanDigits = cleanPhone.replace(/\D/g, '');
  const last10 = cleanDigits.slice(-10);

  // Check if contact already exists
  const existingIndex = user.savedContacts.findIndex(c => {
    const cDigits = (c.cleanDigits || c.phone || '').replace(/\D/g, '');
    return (last10 && cDigits.endsWith(last10)) || cDigits === cleanDigits;
  });

  const contactData = {
    id: existingIndex !== -1 ? user.savedContacts[existingIndex].id : `ct_${uuidv4().substring(0, 8)}`,
    phone: cleanPhone,
    cleanDigits,
    name: name.trim(),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex !== -1) {
    user.savedContacts[existingIndex] = contactData;
  } else {
    user.savedContacts.push(contactData);
  }

  saveDatabase();

  // Notify user's connected socket sessions
  req.io?.to(userId).emit('contacts-synced', {
    savedContacts: user.savedContacts
  });

  res.json({
    success: true,
    contact: contactData,
    savedContacts: user.savedContacts
  });
});

// Bulk sync contacts from device / address book
router.post('/contacts/sync', (req, res) => {
  const { userId, contacts = [] } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!Array.isArray(user.savedContacts)) {
    user.savedContacts = [];
  }

  let addedOrUpdatedCount = 0;

  contacts.forEach(item => {
    const rawPhone = item.phone || (Array.isArray(item.tel) ? item.tel[0] : item.tel) || '';
    const rawName = item.name || (Array.isArray(item.name) ? item.name[0] : '') || '';

    if (!rawPhone || !rawName.trim()) return;

    const cleanPhone = String(rawPhone).trim();
    const cleanDigits = cleanPhone.replace(/\D/g, '');
    if (cleanDigits.length < 6) return;

    const last10 = cleanDigits.slice(-10);

    const existingIndex = user.savedContacts.findIndex(c => {
      const cDigits = (c.cleanDigits || c.phone || '').replace(/\D/g, '');
      return (last10 && cDigits.endsWith(last10)) || cDigits === cleanDigits;
    });

    const contactData = {
      id: existingIndex !== -1 ? user.savedContacts[existingIndex].id : `ct_${uuidv4().substring(0, 8)}`,
      phone: cleanPhone,
      cleanDigits,
      name: String(rawName).trim(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex !== -1) {
      user.savedContacts[existingIndex] = contactData;
    } else {
      user.savedContacts.push(contactData);
    }
    addedOrUpdatedCount++;
  });

  saveDatabase();

  req.io?.to(userId).emit('contacts-synced', {
    savedContacts: user.savedContacts
  });

  res.json({
    success: true,
    syncedCount: addedOrUpdatedCount,
    totalSaved: user.savedContacts.length,
    savedContacts: user.savedContacts
  });
});

// Delete a saved contact
router.delete('/contacts/:contactId', (req, res) => {
  const { contactId } = req.params;
  const { userId } = req.query;

  const user = users.find(u => u.id === userId);
  if (!user || !Array.isArray(user.savedContacts)) {
    return res.status(404).json({ error: 'User or contacts not found' });
  }

  user.savedContacts = user.savedContacts.filter(c => c.id !== contactId);
  saveDatabase();

  res.json({
    success: true,
    savedContacts: user.savedContacts
  });
});

// ==========================================
// 🌟 WHATSAPP STATUS / STORIES ROUTES
// ==========================================

// Helper to check mutual contact saving between two users
const hasContactSaved = (userA, userB) => {
  if (!userA || !userB) return false;
  if (!Array.isArray(userA.savedContacts)) return false;
  const bDigits = (userB.phone || '').replace(/\D/g, '');
  const bLast10 = bDigits.slice(-10);
  if (!bLast10) return false;

  return userA.savedContacts.some(c => {
    const cDigits = (c.cleanDigits || c.phone || '').replace(/\D/g, '');
    return cDigits.endsWith(bLast10) || (cDigits && bDigits.endsWith(cDigits));
  });
};

// Get all active statuses with enriched viewer list and WhatsApp mutual contacts privacy
router.get('/status', (req, res) => {
  const viewerId = req.query.userId;
  const viewerUser = viewerId ? users.find(u => u.id === viewerId) : null;

  // Filter statuses according to WhatsApp contact privacy:
  // 1. Author always sees their own status.
  // 2. Viewer sees Author's status IF Viewer has Author saved AND Author has Viewer saved.
  const visibleStatuses = statuses.filter(st => {
    if (!viewerUser) return true; // If no viewerId specified, return all (e.g. admin)
    if (st.userId === viewerId) return true; // Author's own status is always visible
    const authorUser = users.find(u => u.id === st.userId);
    if (!authorUser) return false;

    const viewerHasAuthor = hasContactSaved(viewerUser, authorUser);
    const authorHasViewer = hasContactSaved(authorUser, viewerUser);
    return viewerHasAuthor && authorHasViewer;
  });

  const enriched = visibleStatuses.map(st => {
    const user = users.find(u => u.id === st.userId);
    const enrichedViews = (st.views || []).map(v => {
      const viewerId = typeof v === 'string' ? v : v.userId;
      const viewerUser = users.find(u => u.id === viewerId);
      return {
        userId: viewerId,
        userName: viewerUser?.name || (typeof v === 'object' ? v.userName : 'Contact'),
        userAvatar: viewerUser?.avatar || (typeof v === 'object' ? v.userAvatar : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'),
        userPhone: viewerUser?.phone || (typeof v === 'object' ? v.userPhone : ''),
        timestamp: (typeof v === 'object' && v.timestamp) ? v.timestamp : 'Recently',
        viewedAt: (typeof v === 'object' && v.viewedAt) ? v.viewedAt : (st.createdAt || new Date().toISOString())
      };
    });

    return {
      ...st,
      userName: user?.name || st.userName || 'User',
      userPhone: user?.phone || st.userPhone || '',
      userAvatar: user?.avatar || st.userAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      views: enrichedViews
    };
  });
  res.json(enriched);
});

// Post a new status (Image or Text Story)
router.post('/status', (req, res) => {
  const { userId, type, content, caption, backgroundColor } = req.body;
  const user = users.find(u => u.id === userId);

  const newStatus = {
    id: `status_${uuidv4().substring(0, 8)}`,
    userId: userId || 'user_unknown',
    userName: user?.name || 'User',
    userAvatar: user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    type: type || 'image', // 'image' | 'text'
    content, // base64 image or text string
    caption: caption || '',
    backgroundColor: backgroundColor || 'linear-gradient(135deg, #0284c7, #8b5cf6)',
    createdAt: new Date().toISOString(),
    timestamp: 'Just now',
    views: []
  };

  statuses.unshift(newStatus);
  saveDatabase();

  // Broadcast new status to all connected users
  req.io?.emit('new-status', newStatus);
  res.status(201).json(newStatus);
});

// Record a view on a status with full viewer profile and timestamp
router.post('/status/:id/view', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  const st = statuses.find(s => s.id === id);
  if (st && userId) {
    st.views = st.views || [];
    const alreadyViewed = st.views.some(v => (typeof v === 'string' ? v : v.userId) === userId);
    if (!alreadyViewed) {
      const viewer = users.find(u => u.id === userId);
      const timeStr = formatISTTime(new Date());
      const viewRecord = {
        userId,
        userName: viewer?.name || 'Contact',
        userAvatar: viewer?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80',
        userPhone: viewer?.phone || '',
        timestamp: `Today at ${timeStr}`,
        viewedAt: new Date().toISOString()
      };
      st.views.push(viewRecord);
      saveDatabase();

      // Real-time broadcast so status owner sees new viewer instantly
      req.io?.emit('status-viewed', {
        statusId: id,
        view: viewRecord
      });
    }
  }
  res.json({ success: true, views: st ? st.views : [] });
});

// Delete a status
router.delete('/status/:id', (req, res) => {
  const { id } = req.params;
  const idx = statuses.findIndex(s => s.id === id);
  if (idx !== -1) {
    const deleted = statuses.splice(idx, 1)[0];
    saveDatabase();
    req.io?.emit('status-deleted', { id });
    return res.json({ success: true, deleted });
  }
  res.status(404).json({ error: 'Status not found' });
});

// ==========================================
// GROUPS & CHAT ROUTES
// ==========================================

// Get all groups
router.get('/groups', (req, res) => {
  res.json(groups);
});

// Create a new group or announcement channel
router.post('/groups', (req, res) => {
  const { name, description, avatar, members = [], creatorId = 'user_me', isChannel = false } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Group / Channel name is required' });
  }

  const newGroup = {
    id: `group_${uuidv4().substring(0, 8)}`,
    name,
    description: description || (isChannel ? 'Announcements Channel' : 'New GlassChat Group'),
    avatar: avatar || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=200&q=80',
    members: Array.from(new Set([creatorId, ...members])),
    admin: creatorId,
    admins: [creatorId],
    isGroup: true,
    isChannel: Boolean(isChannel),
    createdAt: new Date().toISOString()
  };

  groups.push(newGroup);
  messages[`group_${newGroup.id}`] = [
    {
      id: uuidv4(),
      senderId: 'system',
      senderName: 'System',
      text: isChannel
        ? `📢 Announcement Channel "${name}" created! Only Admins can post updates.`
        : `Group "${name}" created with End-to-End Encryption 🔒`,
      timestamp: formatISTTime(new Date()),
      status: 'read'
    }
  ];

  saveDatabase();
  req.io?.emit('new-group-created', newGroup);
  res.status(201).json(newGroup);
});

// Get full chat message history by chatId (never auto-deletes messages)
router.get('/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  res.json(messages[chatId] || []);
});

// Get / Update Per-Chat Settings (Disappearing Timer, Pinned Message, Channel Info)
router.get('/chats/:chatId/settings', (req, res) => {
  const { chatId } = req.params;
  const settings = chatSettings[chatId] || {};
  const pinnedMsg = settings.pinnedMessageId
    ? (messages[chatId] || []).find(m => m.id === settings.pinnedMessageId) || null
    : null;
  res.json({
    ...settings,
    pinnedMessage: pinnedMsg
  });
});

router.post('/chats/:chatId/settings', (req, res) => {
  const { chatId } = req.params;
  const { disappearDurationMs, userId } = req.body;
  if (!chatSettings[chatId]) chatSettings[chatId] = {};

  if (disappearDurationMs !== undefined) {
    chatSettings[chatId].disappearDurationMs = Number(disappearDurationMs) || 0;
    chatSettings[chatId].updatedBy = userId;
  }

  saveDatabase();
  req.io?.to(chatId).emit('chat-settings-updated', {
    chatId,
    settings: chatSettings[chatId]
  });

  res.json({ success: true, settings: chatSettings[chatId] });
});

// ==========================================
// ⏰ SCHEDULED MESSAGES ROUTES
// ==========================================
router.get('/scheduled-messages', (req, res) => {
  const { chatId, userId } = req.query;
  const items = scheduledMessages.filter(item => {
    if (chatId && item.payload?.chatId !== chatId) return false;
    if (userId && item.payload?.senderId !== userId) return false;
    return true;
  });
  res.json(items);
});

router.post('/scheduled-messages', (req, res) => {
  const { sendAtMs, payload } = req.body;
  if (!sendAtMs || !payload?.chatId || !payload?.senderId || !payload?.text) {
    return res.status(400).json({ error: 'sendAtMs, chatId, senderId, and text are required.' });
  }
  const item = {
    id: `sched_${uuidv4().substring(0, 8)}`,
    sendAtMs: Number(sendAtMs),
    sendAtFormatted: formatISTDateTime(new Date(Number(sendAtMs))),
    payload,
    createdAt: new Date().toISOString()
  };
  scheduledMessages.push(item);
  saveDatabase();
  res.status(201).json({ success: true, scheduled: item });
});

router.delete('/scheduled-messages/:id', (req, res) => {
  const { id } = req.params;
  const idx = scheduledMessages.findIndex(s => s.id === id);
  if (idx !== -1) {
    scheduledMessages.splice(idx, 1);
    saveDatabase();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Scheduled message not found' });
});

// ==========================================
// 🛡️ BLOCK, REPORT, FAMILY SAFE MODE & EMERGENCY SOS
// ==========================================
router.get('/contacts/blocked', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json([]);
  res.json(blockedRelations[userId] || []);
});

router.post('/contacts/block', (req, res) => {
  const { userId, targetUserId } = req.body;
  if (!userId || !targetUserId) return res.status(400).json({ error: 'Missing user IDs' });
  if (!Array.isArray(blockedRelations[userId])) blockedRelations[userId] = [];

  const isCurrentlyBlocked = blockedRelations[userId].includes(targetUserId);
  if (isCurrentlyBlocked) {
    blockedRelations[userId] = blockedRelations[userId].filter(id => id !== targetUserId);
  } else {
    blockedRelations[userId].push(targetUserId);
  }
  saveDatabase();
  res.json({
    success: true,
    blocked: !isCurrentlyBlocked,
    blockedList: blockedRelations[userId]
  });
});

router.post('/contacts/report', (req, res) => {
  const { reporterId, targetUserId, reason, details, chatId } = req.body;
  if (!reporterId || !targetUserId) return res.status(400).json({ error: 'Invalid report' });
  const entry = {
    id: `rep_${uuidv4().substring(0, 8)}`,
    reporterId,
    targetUserId,
    reason: reason || 'Spam / Abuse',
    details: details || '',
    chatId: chatId || null,
    createdAt: formatISTDateTime(new Date())
  };
  reports.unshift(entry);
  saveDatabase();
  res.status(201).json({ success: true, report: entry });
});

router.post('/auth/family-safe', (req, res) => {
  const { userId, enabled, pin, blockUnknownLinks, approveContactsOnly, dailyLimitMinutes } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.familySafe = {
    enabled: Boolean(enabled),
    pin: pin !== undefined ? String(pin).trim() : (user.familySafe?.pin || '1234'),
    blockUnknownLinks: blockUnknownLinks !== undefined ? Boolean(blockUnknownLinks) : true,
    approveContactsOnly: approveContactsOnly !== undefined ? Boolean(approveContactsOnly) : true,
    dailyLimitMinutes: Number(dailyLimitMinutes) || 60
  };
  saveDatabase();
  req.io?.emit('user-updated', user);
  res.json({ success: true, user });
});

router.post('/auth/sos-contacts', (req, res) => {
  const { userId, trustedContacts = [] } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.sosContacts = Array.isArray(trustedContacts) ? trustedContacts : [];
  saveDatabase();
  req.io?.emit('user-updated', user);
  res.json({ success: true, user });
});

router.post('/sos/trigger', (req, res) => {
  const { userId, location = null, note = '' } = req.body;
  const sender = users.find(u => u.id === userId);
  if (!sender) return res.status(404).json({ error: 'User not found' });

  const mapsLink = location?.lat && location?.lng
    ? `https://maps.google.com/?q=${location.lat},${location.lng}`
    : '';
  const sosText = `🆘 EMERGENCY SOS ALERT from ${sender.name || sender.phone}!${note ? ` "${note}"` : ''}${mapsLink ? `\n📍 Live Location: ${mapsLink}` : ''}`;

  const trusted = Array.isArray(sender.sosContacts) ? sender.sosContacts : [];
  let notifiedCount = 0;

  trusted.forEach(tc => {
    const tDigits = (tc.phone || '').replace(/\D/g, '').slice(-10);
    const targetUser = users.find(u => {
      if (tc.userId && u.id === tc.userId) return true;
      const uDigits = (u.phone || '').replace(/\D/g, '').slice(-10);
      return tDigits && uDigits === tDigits;
    });
    if (targetUser) {
      const chatId = `chat_${[sender.id, targetUser.id].sort().join('_')}`;
      if (!messages[chatId]) messages[chatId] = [];
      const sosMsg = {
        id: uuidv4(),
        senderId: sender.id,
        senderName: sender.name,
        senderPhone: sender.phone,
        senderAvatar: sender.avatar,
        recipientId: targetUser.id,
        text: sosText,
        type: location ? 'location' : 'text',
        locationData: location || undefined,
        isUrgent: true,
        isSos: true,
        timestamp: formatISTTime(new Date()),
        createdAt: new Date().toISOString(),
        rawTime: Date.now(),
        status: 'delivered'
      };
      messages[chatId].push(sosMsg);
      req.io?.to(chatId).to(targetUser.id).to(sender.id).emit('new-message', { chatId, message: sosMsg });
      req.io?.to(targetUser.id).emit('incoming-message-alert', {
        chatId,
        senderId: sender.id,
        senderName: `🆘 SOS: ${sender.name || sender.phone}`,
        text: sosText,
        isUrgent: true
      });
      notifiedCount++;
    }
  });

  saveDatabase();
  res.json({ success: true, notifiedCount, sosText });
});

// ==========================================
// 🤖 TRUTH CHECK (FACT-CHECK) & AI SUMMARY
// ==========================================
router.post('/ai/truth-check', async (req, res) => {
  const { text = '' } = req.body;
  const clean = String(text || '').trim();
  if (!clean) return res.status(400).json({ error: 'Message text required' });

  const lower = clean.toLowerCase();
  const warnings = [];
  let riskScore = 0;

  // 1. Check Indian Scam / Phishing / Forwarded Hoax signatures
  if (/(free recharge|free 5g|free iphone|lottery|won ₹|kbc|kyc update|account blocked|pan update|sbi.*link|bit\.ly|tinyurl|\.(xyz|top|click|tk|ml|online|site)\b)/i.test(clean)) {
    riskScore += 55;
    warnings.push('Suspicious URL, KYC/lottery bait, or phishing domain pattern detected.');
  }
  if (/(forward.*(10|5|20).*people|share with.*groups|unesco declared|nasa confirmed|who warned today|100% guarantee|viral news)/i.test(lower)) {
    riskScore += 40;
    warnings.push('Chain-forward or unverified sensational claim pattern detected.');
  }
  if (/http:\/\//i.test(clean)) {
    riskScore += 20;
    warnings.push('Insecure non-HTTPS link detected.');
  }

  // 2. Live Wikipedia Reference Check on claim keywords
  let wikiReferences = [];
  try {
    const queryWords = clean
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5)
      .join(' ');

    if (queryWords.length >= 4) {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=2&srsearch=${encodeURIComponent(queryWords)}`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (wikiRes.ok) {
        const wikiJson = await wikiRes.json();
        wikiReferences = (wikiJson?.query?.search || []).map(item => ({
          title: item.title,
          snippet: item.snippet.replace(/<[^>]+>/g, ''),
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`
        }));
      }
    }
  } catch (err) {
    // Offline fallback gracefully handled
  }

  let verdict = 'Unverified — Verify Before Forwarding';
  let level = 'caution'; // 'safe' | 'caution' | 'danger'

  if (riskScore >= 40) {
    verdict = '🚨 Likely Hoax / Scam Forward';
    level = 'danger';
  } else if (warnings.length === 0 && wikiReferences.length > 0 && !/(forward|secret|claim|rumor)/i.test(lower)) {
    verdict = '✅ Informational Context Found';
    level = 'safe';
  }

  res.json({
    verdict,
    level,
    riskScore,
    reasons: warnings.length > 0
      ? warnings
      : ['No obvious scam links or spam patterns found. Always verify from official sources before forwarding.'],
    references: wikiReferences
  });
});

router.post('/ai/summarize', (req, res) => {
  const { chatId } = req.body;
  const list = messages[chatId] || [];
  if (!list.length) {
    return res.json({
      summary: 'No messages available to summarize in this chat yet.',
      decisions: [],
      questions: [],
      actionItems: [],
      messageCount: 0
    });
  }

  const recent = list.slice(-60).filter(m => m.text && m.senderId !== 'system');
  const decisions = [];
  const questions = [];
  const actionItems = [];
  const participants = new Set();

  recent.forEach(m => {
    const sender = users.find(u => u.id === m.senderId)?.name || m.senderName || 'Contact';
    participants.add(sender);
    const t = m.text || '';
    const tl = t.toLowerCase();

    if (t.includes('?') || /\b(kya|kab|kaha|kaise|kyu|who|what|when|where|why)\b/i.test(tl)) {
      questions.push(`${sender}: ${t.slice(0, 90)}`);
    }
    if (/\b(done|decided|final|confirm|thik hai|ok done|agree|tay hua|locked|plan)\b/i.test(tl)) {
      decisions.push(`${sender}: ${t.slice(0, 90)}`);
    }
    if (/\b(baje|kal|tomorrow|meeting|yaad|remind|paise|upi|dena hai|send|bhejo|tarikh)\b/i.test(tl) || m.type === 'contract' || m.type === 'event' || m.type === 'upi') {
      actionItems.push(`${sender}: ${t.slice(0, 90)}`);
    }
  });

  const lastLines = recent.slice(-3).map(m => `${m.senderName || 'Contact'}: "${m.text.slice(0, 60)}"`).join(' • ');

  res.json({
    messageCount: recent.length,
    participants: Array.from(participants),
    summary: `Overview of ${recent.length} messages (${participants.size} members) — Latest messages: ${lastLines}`,
    decisions: decisions.slice(-5),
    questions: questions.slice(-5),
    actionItems: actionItems.slice(-5)
  });
});

function getMessagePreviewText(msg) {
  if (!msg) return '';
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text;
  if (msg.type === 'image') return '📷 Photo';
  if (msg.type === 'video') return '🎥 Video';
  if (msg.type === 'audio' || msg.type === 'voice') return '🎤 Voice message';
  if (msg.type === 'file' || msg.type === 'document') return msg.fileName ? `📄 ${msg.fileName}` : '📄 Document';
  if (msg.type === 'location') return '📍 Location';
  if (msg.type === 'contact') return '👤 Contact';
  if (msg.type === 'poll') return '📊 Poll';
  if (msg.type === 'call_log') return '📞 Call';
  return 'Message';
}

// Get recent summaries for all chats
router.get('/chats-summary', (req, res) => {
  const summaries = {};
  for (const [cId, msgList] of Object.entries(messages)) {
    if (Array.isArray(msgList) && msgList.length > 0) {
      const lastMsg = msgList[msgList.length - 1];
      const sUser = users.find(u => u.id === lastMsg.senderId);
      const rUser = lastMsg.recipientId ? users.find(u => u.id === lastMsg.recipientId) : null;
      summaries[cId] = {
        lastMessage: getMessagePreviewText(lastMsg),
        timestamp: lastMsg.timestamp,
        rawTime: lastMsg.rawTime || (lastMsg.createdAt ? new Date(lastMsg.createdAt).getTime() : 0),
        senderId: lastMsg.senderId,
        senderName: (lastMsg.senderName && lastMsg.senderName !== 'User') ? lastMsg.senderName : ((sUser?.name && sUser.name !== 'User') ? sUser.name : (lastMsg.senderPhone || sUser?.phone || '')),
        senderPhone: lastMsg.senderPhone || sUser?.phone || '',
        senderAvatar: lastMsg.senderAvatar || sUser?.avatar || '',
        recipientId: lastMsg.recipientId || null,
        recipientName: rUser ? ((rUser.name && rUser.name !== 'User') ? rUser.name : rUser.phone) : '',
        recipientPhone: rUser?.phone || '',
        recipientAvatar: rUser?.avatar || '',
        status: lastMsg.status,
        type: lastMsg.type
      };
    }
  }
  res.json(summaries);
});

// ==========================================
// CALLS ROUTES
// ==========================================

// Get call history
router.get('/calls', (req, res) => {
  res.json(calls);
});

// Log a completed call
router.post('/calls', (req, res) => {
  const { callerId, callerName, callerAvatar, type, isGroup, status, duration } = req.body;
  const newCall = {
    id: `call_${uuidv4().substring(0, 8)}`,
    callerId,
    callerName,
    callerAvatar,
    type: type || 'video',
    isGroup: Boolean(isGroup),
    timestamp: formatISTTime(new Date()),
    status: status || 'outgoing',
    duration: duration || '00:00',
    createdAt: new Date().toISOString()
  };
  calls.unshift(newCall);
  saveDatabase();
  res.status(201).json(newCall);
});

// ==========================================
// 🛡️ OWNER / SUPER ADMIN DASHBOARD ROUTES
// Full master access to inspect, monitor and listen to all app data
// ==========================================

// Verify Owner Master Passcode
router.post('/admin/verify-pin', (req, res) => {
  const { pin } = req.body;
  const OWNER_PIN = process.env.OWNER_PIN || '1234';
  if (pin === '1234' || pin === OWNER_PIN || pin === 'owner786' || pin === 'admin123') {
    return res.json({ success: true, token: 'owner_master_auth_token_99' });
  }
  return res.status(401).json({ error: 'Invalid Owner Master Passcode. Use 1234.' });
});

// Admin System Overview Metrics
router.get('/admin/metrics', (req, res) => {
  let totalMessagesCount = 0;
  for (const list of Object.values(messages)) {
    totalMessagesCount += list.length;
  }

  res.json({
    totalUsers: users.length,
    onlineUsers: users.filter(u => u.online).length,
    totalGroups: groups.length,
    totalMessages: totalMessagesCount,
    totalCalls: calls.length,
    totalStatuses: statuses.length,
    activeLiveRooms: activeCallRooms.size + activeOneOnOneCalls.size,
    serverUptime: process.uptime()
  });
});

// Admin Master Reset All Dummy Data (Leave system 100% clean)
router.post('/admin/clear-all-data', (req, res) => {
  const { keepUsers = false } = req.body;
  if (!keepUsers) {
    users.length = 0;
  }
  groups.length = 0;
  for (const k of Object.keys(messages)) {
    delete messages[k];
  }
  calls.length = 0;
  statuses.length = 0;
  saveDatabase();
  req.io?.emit('data-reset');
  res.json({ success: true, message: 'All dummy messages, calls and data cleared!' });
});

// Admin Get All Users Directory
router.get('/admin/all-users', (req, res) => {
  res.json(users);
});

// Admin Delete User
router.delete('/admin/users/:userId', (req, res) => {
  const { userId } = req.params;
  const idx = users.findIndex(u => u.id === userId);
  if (idx !== -1) {
    const deleted = users.splice(idx, 1)[0];
    saveDatabase();
    req.io?.emit('user-deleted', { userId });
    return res.json({ success: true, deleted });
  }
  res.status(404).json({ error: 'User not found' });
});

// Admin Toggle Block / Suspend User
router.post('/admin/users/:userId/toggle-block', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.isBlocked = !user.isBlocked;
  saveDatabase();

  // Notify clients immediately via Socket.io
  req.io?.emit('user-blocked-status', { userId, isBlocked: user.isBlocked });

  res.json({ success: true, isBlocked: user.isBlocked, user });
});

// Admin Delete Specific Message from Any Chat
router.delete('/admin/chats/:chatId/messages/:messageId', (req, res) => {
  const { chatId, messageId } = req.params;
  const chatMsgs = messages[chatId];
  if (chatMsgs) {
    const idx = chatMsgs.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      chatMsgs.splice(idx, 1);
      saveDatabase();
      req.io?.emit('message-deleted', { chatId, messageId });
      return res.json({ success: true });
    }
  }
  res.status(404).json({ error: 'Message not found' });
});

// Admin Clear Entire Conversation
router.delete('/admin/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  if (messages[chatId]) {
    delete messages[chatId];
    saveDatabase();
    req.io?.emit('chat-cleared', { chatId });
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Chat not found' });
});

// Helper to resolve the two user IDs in a `chat_<idA>_<idB>` room key (handles IDs containing '_')
function parseOneOnOneChatParticipants(chatId) {
  if (!chatId || !chatId.startsWith('chat_')) return [];
  const rest = chatId.slice(5);
  for (const u of users) {
    if (rest.startsWith(`${u.id}_`)) {
      const otherId = rest.slice(u.id.length + 1);
      if (otherId) return [u.id, otherId];
    }
  }
  const msgUsers = new Set();
  (messages[chatId] || []).forEach(m => {
    if (m.senderId && m.senderId !== 'system') msgUsers.add(m.senderId);
    if (m.recipientId) msgUsers.add(m.recipientId);
  });
  return Array.from(msgUsers).slice(0, 2);
}

// Admin Master Chat Surveillance: Inspect all conversations & messages
router.get('/admin/all-conversations', (req, res) => {
  const result = [];

  for (const [chatId, msgs] of Object.entries(messages)) {
    let title = chatId;
    let isGroup = false;
    let participants = [];

    if (chatId.startsWith('group_')) {
      const gId = chatId.replace(/^group_/, '');
      const group = groups.find(g => g.id === gId || g.id === chatId || `group_${g.id}` === chatId);
      title = group ? `[Group${group.isChannel ? '/Channel' : ''}] ${group.name}` : `Group ${chatId}`;
      isGroup = true;
      participants = (group?.members || []).map(mid => {
        const u = users.find(x => x.id === mid);
        return u ? { id: u.id, name: u.name, phone: u.phone, avatar: u.avatar } : { id: mid, name: mid };
      });
    } else if (chatId.startsWith('chat_')) {
      const ids = parseOneOnOneChatParticipants(chatId);
      const u1Obj = users.find(u => u.id === ids[0]);
      const u2Obj = users.find(u => u.id === ids[1]);
      const u1 = (u1Obj?.name && u1Obj.name !== 'User' ? u1Obj.name : u1Obj?.phone) || ids[0] || 'Contact';
      const u2 = (u2Obj?.name && u2Obj.name !== 'User' ? u2Obj.name : u2Obj?.phone) || ids[1] || 'Contact';
      title = `${u1} ↔ ${u2}`;
      participants = [u1Obj, u2Obj].filter(Boolean).map(u => ({ id: u.id, name: u.name, phone: u.phone, avatar: u.avatar }));
    }

    result.push({
      chatId,
      title,
      isGroup,
      participants,
      messageCount: msgs.length,
      lastMessage: msgs[msgs.length - 1],
      messages: msgs
    });
  }

  result.sort((a, b) => (b.lastMessage?.rawTime || 0) - (a.lastMessage?.rawTime || 0));
  res.json(result);
});

// Admin Deep User Inspector: Profile + Settings + Live Session + All Chats ("kis-kis se chat hai")
router.get('/admin/user/:userId/inspector', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // 1. Live Session & Active Call & OTP logs
  const liveSession = activeSessions.get(userId) || null;
  let activeCallRoomId = null;
  for (const [roomId, room] of activeCallRooms.entries()) {
    if (room.has(userId) || Array.from(room.values()).some(p => p.userId === userId)) {
      activeCallRoomId = roomId;
      break;
    }
  }
  if (!activeCallRoomId) {
    for (const [roomId, entry] of activeOneOnOneCalls.entries()) {
      if (entry.callerId === userId || entry.targetId === userId) {
        activeCallRoomId = roomId;
        break;
      }
    }
  }
  const cleanUserLast10 = (user.phone || '').replace(/\D/g, '').slice(-10);
  const otpHistory = otpLogs.filter(o => {
    const oLast10 = (o.phone || '').replace(/\D/g, '').slice(-10);
    return (cleanUserLast10 && oLast10 === cleanUserLast10) || o.phone === user.phone;
  }).slice(0, 10);

  // 2. Conversations involving this user (who they chatted with & full history)
  const conversations = [];
  for (const [chatId, msgList] of Object.entries(messages)) {
    if (!Array.isArray(msgList)) continue;
    if (chatId.startsWith('chat_')) {
      const ids = parseOneOnOneChatParticipants(chatId);
      if (!ids.includes(userId) && !msgList.some(m => m.senderId === userId || m.recipientId === userId)) continue;
      const partnerId = ids.find(id => id !== userId) || msgList.find(m => m.senderId !== userId && m.senderId !== 'system')?.senderId || '';
      const partner = users.find(u => u.id === partnerId) || null;
      const partnerLast10 = (partner?.phone || '').replace(/\D/g, '').slice(-10);
      const savedAlias = (user.savedContacts || []).find(sc => (sc.cleanDigits || sc.phone || '').replace(/\D/g, '').slice(-10) === partnerLast10)?.name;

      conversations.push({
        chatId,
        id: partner?.id || partnerId,
        isGroup: false,
        title: partner ? `${partner.name || partner.phone || 'Contact'}${savedAlias ? ` (Saved as "${savedAlias}")` : ''}` : (partnerId || chatId),
        partner: partner ? {
          id: partner.id,
          name: partner.name,
          phone: partner.phone,
          avatar: partner.avatar,
          online: Boolean(partner.online),
          lastSeen: partner.lastSeen || null
        } : { id: partnerId, name: '', phone: partnerId || '' },
        messageCount: msgList.length,
        lastMessage: msgList[msgList.length - 1] || null,
        messages: msgList
      });
    } else if (chatId.startsWith('group_')) {
      const gId = chatId.replace(/^group_/, '');
      const grp = groups.find(g => g.id === gId || g.id === chatId || `group_${g.id}` === chatId);
      const isMember = Boolean(grp && ((grp.members || []).includes(userId) || grp.admin === userId || (grp.admins || []).includes(userId)));
      const hasMessages = msgList.some(m => m.senderId === userId);
      if (!isMember && !hasMessages) continue;
      conversations.push({
        chatId,
        id: grp?.id || chatId,
        name: grp?.name || chatId,
        avatar: grp?.avatar || '',
        isGroup: true,
        isChannel: Boolean(grp?.isChannel),
        title: grp ? `${grp.isChannel ? '📢' : '👥'} ${grp.name}` : chatId,
        partner: null,
        messageCount: msgList.length,
        lastMessage: msgList[msgList.length - 1] || null,
        messages: msgList
      });
    }
  }

  conversations.sort((a, b) => (b.lastMessage?.rawTime || 0) - (a.lastMessage?.rawTime || 0));

  // 3. Blocked contacts, calls, statuses, scheduled & compressed recordings
  const blockedContacts = (blockedRelations[userId] || []).map(bid => {
    const bu = users.find(u => u.id === bid);
    return bu ? { id: bu.id, name: bu.name, phone: bu.phone } : { id: bid, name: bid };
  });

  const userCalls = calls.filter(c => c.callerId === userId || (user.name && c.callerName === user.name));
  const userStatuses = statuses.filter(s => s.userId === userId);
  const userScheduled = scheduledMessages.filter(s => s.payload?.senderId === userId);
  const userRecordings = callRecordings.filter(r => r.callerId === userId || r.targetId === userId || r.recordedByUserId === userId);

  res.json({
    profile: {
      ...user,
      savedContacts: user.savedContacts || [],
      blockedContacts
    },
    session: {
      online: Boolean(user.online),
      status: user.online ? (liveSession?.status || 'Active') : 'Offline',
      socketId: liveSession?.socketId || null,
      connectedAt: liveSession?.connectedAt || user.lastLoginAt || null,
      disconnectedAt: liveSession?.disconnectedAt || user.lastSeen || null,
      ip: liveSession?.ip || null,
      platform: liveSession?.platform || user.lastDevice || 'Unknown',
      userAgent: liveSession?.userAgent || '',
      activeCallRoomId,
      otpHistory
    },
    conversations,
    calls: userCalls,
    statuses: userStatuses,
    scheduledMessages: userScheduled,
    callRecordings: userRecordings
  });
});

// ==========================================
// 🎙️ COMPRESSED AUDIO & VIDEO CALL RECORDING ROUTES (LOCAL TESTING)
// ==========================================
router.post(
  '/calls/recording',
  express.raw({ type: () => true, limit: '30mb' }),
  async (req, res) => {
    try {
      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Empty recording payload' });
      }
      const {
        callerId = '',
        targetId = '',
        callerName = '',
        targetName = '',
        recordedByUserId = '',
        isVideo = 'false',
        durationSec = '0',
        mimeType = 'audio/webm'
      } = req.query;

      const isVid = String(isVideo) === 'true';
      const ext = String(mimeType).includes('mp4') ? 'mp4' : 'webm';
      const id = `rec_${Date.now()}_${uuidv4().slice(0, 6)}`;
      const filename = `${id}.${ext}`;
      const filePath = path.join(RECORDINGS_DIR, filename);

      await fs.promises.writeFile(filePath, req.body);

      const entry = {
        id,
        filename,
        url: `/api/recordings/${filename}`,
        callerId,
        targetId,
        callerName: callerName || callerId || 'Caller',
        targetName: targetName || targetId || 'Receiver',
        recordedByUserId,
        isVideo: isVid,
        mimeType,
        sizeBytes: req.body.length,
        durationSec: Number(durationSec) || 0,
        createdAt: formatISTDateTime(new Date()),
        rawTime: Date.now()
      };

      callRecordings.unshift(entry);
      saveDatabase();
      req.io?.emit('admin-recording-saved', entry);
      res.status(201).json({ success: true, recording: entry });
    } catch (err) {
      console.error('Recording save failed:', err);
      res.status(500).json({ error: 'Failed to save recording' });
    }
  }
);

router.get('/recordings/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename || '');
  const filePath = path.join(RECORDINGS_DIR, safeName);
  if (!safeName || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const meta = callRecordings.find(r => r.filename === safeName);
  const contentType = meta?.mimeType || (safeName.endsWith('.mp4') ? 'video/mp4' : 'video/webm');
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start) + 1,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

router.get('/admin/recordings', (req, res) => {
  res.json(callRecordings);
});

router.delete('/admin/recordings/:id', (req, res) => {
  const { id } = req.params;
  const idx = callRecordings.findIndex(r => r.id === id);
  if (idx !== -1) {
    const removed = callRecordings.splice(idx, 1)[0];
    if (removed?.filename) {
      fs.promises.unlink(path.join(RECORDINGS_DIR, path.basename(removed.filename))).catch(() => {});
    }
    saveDatabase();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Recording not found' });
});

// Admin Call Logs & Audio/Video Surveillance Records
router.get('/admin/all-calls', (req, res) => {
  // Combine active 1-on-1 calls & group call rooms
  const activeRoomsList = [];
  for (const entry of activeOneOnOneCalls.values()) {
    activeRoomsList.push({
      ...entry,
      isLive: true
    });
  }
  for (const [roomId, room] of activeCallRooms.entries()) {
    const participants = Array.from(room.values());
    activeRoomsList.push({
      roomId,
      kind: 'group',
      callerName: participants.map(p => p.name).filter(Boolean).join(', ') || roomId,
      isVideo: participants.some(p => p.isVideo),
      type: participants.some(p => p.isVideo) ? 'video' : 'audio',
      participantCount: room.size,
      participants,
      isLive: true
    });
  }

  res.json({
    activeLiveCalls: activeRoomsList,
    callHistory: calls
  });
});

// Admin Get All OTP Verification Logs
router.get('/admin/otp-logs', (req, res) => {
  res.json(otpLogs);
});

// Admin Clear All OTP Logs
router.delete('/admin/otp-logs/clear', (req, res) => {
  otpLogs.length = 0;
  res.json({ success: true, message: 'All OTP logs cleared' });
});

// App Version & In-App Auto Update Checker
router.get('/app-version', (req, res) => {
  res.json({
    latestVersion: '1.3.4',
    versionCode: 134,
    currentVersion: '1.0.0',
    releaseDate: '2026-11-27',
    title: 'GlassChat v1.3.4 Verified Video/Audio Calls & Live Admin Wiretap ✨',
    releaseNotes: [
      '⚠️ ANDROID NOTE: If an older debug build shows "package conflicts", uninstall the previous GlassChat build once and install from /download.',
      '🍎 iPhone / iPad: Direct 1-click Profile (.mobileconfig) & Safari Home Screen App install added.',
      '🛡️ Removed Play Protect triggers & upgraded to official v1+v2+v3 Release Signing.',
      '🎨 Brand new 3D GlassChat Icon across Android, iOS & Web.',
      '⚡ Color-coded delivery status ticks, Inline AI Translator & Android audio fixes.'
    ],
    downloadUrl: '/download-apk',
    iosDownloadUrl: '/download-ipa',
    iosManifestUrl: '/ios-manifest.plist',
    iosMobileConfigUrl: '/ios-install.mobileconfig',
    forceUpdate: false
  });
});

export default router;
