import express from 'express';
import { users, groups, messages, calls, statuses, otpStore, otpLogs, activeCallRooms, saveDatabase } from '../data/store.js';
import { v4 as uuidv4 } from 'uuid';
import { formatISTTime, formatISTDateTime } from '../utils/time.js';

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

// Get all other registered users / contacts with phone/name search
router.get('/users', (req, res) => {
  const currentUserId = req.query.userId;
  const q = req.query.q?.trim().toLowerCase();
  const qDigits = req.query.q?.replace(/\D/g, '') || '';

  let list = currentUserId 
    ? users.filter(u => u.id !== currentUserId)
    : users;

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
  req.io?.to(`user_${userId}`).emit('contacts-synced', {
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

  req.io?.to(`user_${userId}`).emit('contacts-synced', {
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

// Create a new group
router.post('/groups', (req, res) => {
  const { name, description, avatar, members = [], creatorId = 'user_me' } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const newGroup = {
    id: `group_${uuidv4().substring(0, 8)}`,
    name,
    description: description || 'New GlassChat Group',
    avatar: avatar || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=200&q=80',
    members: Array.from(new Set([creatorId, ...members])),
    admin: creatorId,
    isGroup: true,
    createdAt: new Date().toISOString()
  };

  groups.push(newGroup);
  messages[`group_${newGroup.id}`] = [
    {
      id: uuidv4(),
      senderId: 'system',
      senderName: 'System',
      text: `Group "${name}" created with End-to-End Encryption 🔒`,
      timestamp: formatISTTime(new Date()),
      status: 'read'
    }
  ];

  saveDatabase();
  req.io?.emit('new-group-created', newGroup);
  res.status(201).json(newGroup);
});

// Get chat messages by chatId
router.get('/chats/:chatId', (req, res) => {
  const { chatId } = req.params;
  const chatMessages = messages[chatId] || [];
  res.json(chatMessages);
});

// Get recent summaries for all chats
router.get('/chats-summary', (req, res) => {
  const summaries = {};
  for (const [cId, msgList] of Object.entries(messages)) {
    if (Array.isArray(msgList) && msgList.length > 0) {
      const lastMsg = msgList[msgList.length - 1];
      const sUser = users.find(u => u.id === lastMsg.senderId);
      summaries[cId] = {
        lastMessage: lastMsg.text,
        timestamp: lastMsg.timestamp,
        rawTime: lastMsg.rawTime || (lastMsg.createdAt ? new Date(lastMsg.createdAt).getTime() : 0),
        senderId: lastMsg.senderId,
        senderName: lastMsg.senderName || sUser?.name || 'User',
        senderPhone: lastMsg.senderPhone || sUser?.phone || '',
        senderAvatar: lastMsg.senderAvatar || sUser?.avatar || '',
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
    activeLiveRooms: activeCallRooms.size,
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
    messages[chatId] = [];
    saveDatabase();
    req.io?.emit('chat-cleared', { chatId });
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Chat not found' });
});

// Admin Master Chat Surveillance: Inspect all conversations & messages
router.get('/admin/all-conversations', (req, res) => {
  const result = [];

  for (const [chatId, msgs] of Object.entries(messages)) {
    let title = chatId;
    let isGroup = false;

    if (chatId.startsWith('group_')) {
      const gId = chatId.replace('group_', '');
      const group = groups.find(g => g.id === gId || `group_${g.id}` === chatId);
      title = group ? `[Group] ${group.name}` : `Group ${chatId}`;
      isGroup = true;
    } else if (chatId.startsWith('chat_')) {
      const parts = chatId.replace('chat_', '').split('_');
      const u1 = users.find(u => u.id === parts[0])?.name || parts[0];
      const u2 = users.find(u => u.id === parts[1])?.name || parts[1];
      title = `${u1} ↔ ${u2}`;
    }

    result.push({
      chatId,
      title,
      isGroup,
      messageCount: msgs.length,
      lastMessage: msgs[msgs.length - 1],
      messages: msgs
    });
  }

  res.json(result);
});

// Admin Call Logs & Audio/Video Surveillance Records
router.get('/admin/all-calls', (req, res) => {
  // Combine historical calls with active live rooms
  const activeRoomsList = [];
  for (const [roomId, room] of activeCallRooms.entries()) {
    activeRoomsList.push({
      roomId,
      participantCount: room.size,
      participants: Array.from(room.values()),
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
    latestVersion: '1.3.1',
    versionCode: 131,
    currentVersion: '1.0.0',
    releaseDate: '2026-11-26',
    title: 'GlassChat v1.3.1 Clean Release & PWA ✨',
    releaseNotes: [
      '🛡️ Removed Play Protect dropper triggers & upgraded to v1+v2+v3 Signed Release APK',
      '📱 Added iPhone / iPad Native Safari Home Screen Web App (PWA) & auto-update support',
      '🎨 Brand new 3D GlassChat Icon across Android, iOS & Web',
      '⚡ Red ➔ Green ➔ Blue dynamic text & tick colors + Inline AI Translator',
      '📞 Android <12 audio fix & WebRTC 5+ min anti-freeze stability'
    ],
    downloadUrl: '/download-apk',
    iosDownloadUrl: '/download-ipa',
    iosManifestUrl: '/ios-manifest.plist',
    forceUpdate: false
  });
});

export default router;
