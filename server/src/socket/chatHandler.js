import { messages, users, groups, chatSettings, blockedRelations, saveDatabase } from '../data/store.js';
import { v4 as uuidv4 } from 'uuid';
import { formatISTTime } from '../utils/time.js';
import crypto from 'crypto';

// Shared message dispatcher used by both live socket messages and scheduled message delivery
export function dispatchChatMessage(io, userSocketMap, payload) {
  const {
    tempId = null,
    chatId,
    senderId,
    senderName,
    text,
    mediaUrl,
    type = 'text',
    encrypted = true,
    recipientId = null,
    isUrgent = false,
    replyTo = null,
    isForwarded = false,
    pollData = null,
    eventData = null,
    contactData = null,
    locationData = null,
    upiData = null,
    contractData = null,
    transcript = null,
    fileName = null,
    fileSize = null
  } = payload;

  if (!chatId || !senderId) return null;

  // Enforce 1-on-1 block check
  if (recipientId && Array.isArray(blockedRelations[recipientId]) && blockedRelations[recipientId].includes(senderId)) {
    return { blocked: true, reason: 'You cannot send messages to this contact.' };
  }

  // Enforce Announcement-only Channel rule
  if (chatId.startsWith('group_')) {
    const gId = chatId.replace(/^group_/, '');
    const grp = groups.find(g => g.id === gId || g.id === chatId || `group_${g.id}` === chatId);
    if (grp && grp.isChannel && grp.admin !== senderId && !(Array.isArray(grp.admins) && grp.admins.includes(senderId))) {
      return { channelRestricted: true, reason: 'Only Channel Admins can post in this announcement channel.' };
    }
  }

  if (!messages[chatId]) {
    messages[chatId] = [];
  }

  // Offline Sync Idempotency: if tempId already delivered, return existing message cleanly without duplicating
  if (tempId) {
    const existing = messages[chatId].find(m => m.tempId === tempId);
    if (existing) {
      return { duplicate: true, message: existing };
    }
  }

  const safeText = typeof text === 'string'
    ? text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim()
    : text;

  const senderUser = users.find(u => u.id === senderId);
  const senderPhone = senderUser?.phone || '';
  const senderAvatar = senderUser?.avatar || '';
  const resolvedSenderName = senderUser?.name || senderName;

  const isRecipientOnline = recipientId ? userSocketMap.has(recipientId) : false;
  const initialStatus = isRecipientOnline ? 'delivered' : 'sent';

  const now = new Date();
  const settings = chatSettings[chatId] || {};
  const disappearMs = Number(settings.disappearDurationMs) || 0;
  const expiresAt = disappearMs > 0 ? now.getTime() + disappearMs : null;

  const newMessage = {
    id: uuidv4(),
    tempId,
    senderId,
    senderName: resolvedSenderName,
    senderPhone,
    senderAvatar,
    text: safeText,
    mediaUrl,
    type,
    encrypted,
    recipientId,
    isUrgent: Boolean(isUrgent),
    isForwarded: Boolean(isForwarded),
    replyTo: replyTo || null,
    pollData: pollData || undefined,
    eventData: eventData || undefined,
    contactData: contactData || undefined,
    locationData: locationData || undefined,
    upiData: upiData || undefined,
    contractData: contractData || undefined,
    transcript: transcript || undefined,
    fileName: fileName || undefined,
    fileSize: fileSize || undefined,
    expiresAt,
    timestamp: formatISTTime(now),
    createdAt: now.toISOString(),
    rawTime: now.getTime(),
    status: initialStatus
  };

  messages[chatId].push(newMessage);
  saveDatabase();

  let broadcaster = io.to(chatId);
  if (recipientId) broadcaster = broadcaster.to(recipientId);
  if (senderId) broadcaster = broadcaster.to(senderId);

  broadcaster.emit('new-message', {
    chatId,
    message: newMessage,
    tempId,
    senderUser: senderUser ? {
      id: senderUser.id,
      name: senderUser.name,
      phone: senderUser.phone,
      avatar: senderUser.avatar,
      status: senderUser.status
    } : null
  });

  if (recipientId) {
    io.to(recipientId).emit('incoming-message-alert', {
      chatId,
      senderId,
      senderName: resolvedSenderName,
      senderPhone,
      senderAvatar,
      text: safeText,
      type,
      isUrgent: Boolean(isUrgent),
      timestamp: newMessage.timestamp,
      createdAt: newMessage.createdAt,
      rawTime: newMessage.rawTime,
      senderUser: senderUser ? {
        id: senderUser.id,
        name: senderUser.name,
        phone: senderUser.phone,
        avatar: senderUser.avatar,
        status: senderUser.status
      } : null
    });
  }

  return { success: true, message: newMessage };
}

export function setupChatHandlers(io, socket, userSocketMap) {
  socket.on('join-chat', ({ chatId }) => {
    socket.join(chatId);
  });

  socket.on('leave-chat', ({ chatId }) => {
    socket.leave(chatId);
  });

  // Real-time 1-on-1 or group/channel message
  socket.on('send-message', (payload) => {
    if (socket.userId && payload.senderId && socket.userId !== payload.senderId) {
      console.warn(`[Security Alert] Blocked spoofed message from socket ${socket.id} claiming to be ${payload.senderId}`);
      return;
    }

    const result = dispatchChatMessage(io, userSocketMap, payload);
    if (result?.blocked || result?.channelRestricted) {
      socket.emit('message-rejected', {
        chatId: payload.chatId,
        tempId: payload.tempId,
        reason: result.reason
      });
    } else if (result?.duplicate && payload.tempId) {
      socket.emit('new-message', {
        chatId: payload.chatId,
        message: result.message,
        tempId: payload.tempId
      });
    }
  });

  // Typing indicator (broadcast to chat room AND direct recipient for Home list preview)
  socket.on('typing', ({ chatId, userId, userName, isTyping, recipientId }) => {
    const typingPayload = { chatId, userId, userName, isTyping };
    socket.to(chatId).emit('user-typing', typingPayload);
    if (recipientId) {
      socket.to(recipientId).emit('user-typing', typingPayload);
    }
  });

  socket.on('mark-read', ({ chatId, messageId }) => {
    if (messages[chatId]) {
      messages[chatId] = messages[chatId].map(msg =>
        msg.id === messageId ? { ...msg, status: 'seen' } : msg
      );
      saveDatabase();
    }
    io.to(chatId).emit('message-status-updated', {
      chatId,
      messageId,
      status: 'seen'
    });
  });

  socket.on('mark-chat-seen', ({ chatId, readerId }) => {
    if (messages[chatId]) {
      let anySeen = false;
      const seenIds = [];
      messages[chatId].forEach(msg => {
        if (msg.senderId !== readerId && msg.status !== 'seen' && msg.status !== 'read') {
          msg.status = 'seen';
          seenIds.push(msg.id);
          anySeen = true;
        }
      });
      if (anySeen) {
        saveDatabase();
        io.to(chatId).emit('chat-messages-seen', {
          chatId,
          readerId,
          seenIds
        });
      }
    }
  });

  // Edit sent text message
  socket.on('edit-message', ({ chatId, messageId, newText, userId }) => {
    if (!messages[chatId] || !newText?.trim()) return;
    const msg = messages[chatId].find(m => m.id === messageId);
    if (!msg || msg.senderId !== userId) return;

    const clean = newText.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();
    msg.text = clean;
    msg.isEdited = true;
    msg.editedAt = formatISTTime(new Date());
    saveDatabase();

    io.to(chatId).emit('message-edited', {
      chatId,
      messageId,
      newText: clean,
      editedAt: msg.editedAt
    });
  });

  // Star / Bookmark message per user
  socket.on('star-message', ({ chatId, messageId, userId }) => {
    if (!messages[chatId] || !userId) return;
    const msg = messages[chatId].find(m => m.id === messageId);
    if (!msg) return;

    msg.starredBy = Array.isArray(msg.starredBy) ? msg.starredBy : [];
    if (msg.starredBy.includes(userId)) {
      msg.starredBy = msg.starredBy.filter(id => id !== userId);
    } else {
      msg.starredBy.push(userId);
    }
    saveDatabase();

    io.to(chatId).emit('message-star-updated', {
      chatId,
      messageId,
      starredBy: msg.starredBy
    });
  });

  // Pin / Unpin message in chat
  socket.on('pin-message', ({ chatId, messageId, userId }) => {
    if (!chatId) return;
    if (!chatSettings[chatId]) chatSettings[chatId] = {};

    const currentlyPinned = chatSettings[chatId].pinnedMessageId === messageId;
    chatSettings[chatId].pinnedMessageId = currentlyPinned ? null : messageId;
    chatSettings[chatId].pinnedBy = currentlyPinned ? null : userId;
    saveDatabase();

    const pinnedMsg = currentlyPinned ? null : (messages[chatId] || []).find(m => m.id === messageId);
    io.to(chatId).emit('chat-pin-updated', {
      chatId,
      pinnedMessageId: chatSettings[chatId].pinnedMessageId,
      pinnedMessage: pinnedMsg || null
    });
  });

  // Emoji Reaction
  socket.on('react-message', ({ chatId, messageId, emoji, userId }) => {
    if (messages[chatId]) {
      const msg = messages[chatId].find(m => m.id === messageId);
      if (msg) {
        msg.reactions = msg.reactions || {};
        if (msg.reactions[userId] === emoji) {
          delete msg.reactions[userId];
        } else {
          msg.reactions[userId] = emoji;
        }
        saveDatabase();
        io.to(chatId).emit('message-reaction-updated', {
          chatId,
          messageId,
          reactions: msg.reactions
        });
      }
    }
  });

  // Interactive & Anonymous Poll Voting
  socket.on('poll-vote', ({ chatId, messageId, optionId, userId }) => {
    if (!messages[chatId] || !userId) return;
    const msg = messages[chatId].find(m => m.id === messageId);
    if (!msg || !msg.pollData || !Array.isArray(msg.pollData.options)) return;

    const isAnon = Boolean(msg.pollData.isAnonymous);
    // For anonymous polls, track opaque salted tokens so voter identity cannot be inspected by clients
    const voterToken = isAnon
      ? crypto.createHash('sha256').update(`${messageId}:${userId}`).digest('hex').slice(0, 12)
      : userId;

    msg.pollData.options.forEach(opt => {
      if (!Array.isArray(opt.votes)) opt.votes = [];
      if (opt.id === optionId) {
        if (opt.votes.includes(voterToken)) {
          opt.votes = opt.votes.filter(v => v !== voterToken);
        } else {
          opt.votes.push(voterToken);
        }
      }
    });

    saveDatabase();
    io.to(chatId).emit('poll-updated', {
      chatId,
      messageId,
      pollData: msg.pollData
    });
  });

  // Contract Promise Action (Accept / Complete)
  socket.on('contract-action', ({ chatId, messageId, action, userId, userName }) => {
    if (!messages[chatId]) return;
    const msg = messages[chatId].find(m => m.id === messageId);
    if (!msg || !msg.contractData) return;

    if (action === 'accept') {
      msg.contractData.status = 'accepted';
      msg.contractData.acceptedBy = userName || userId;
      msg.contractData.acceptedAt = formatISTTime(new Date());
    } else if (action === 'complete') {
      msg.contractData.status = 'completed';
      msg.contractData.completedAt = formatISTTime(new Date());
    }
    saveDatabase();
    io.to(chatId).emit('contract-updated', {
      chatId,
      messageId,
      contractData: msg.contractData
    });
  });

  // UPI Payment Status Update
  socket.on('upi-action', ({ chatId, messageId, status, userId }) => {
    if (!messages[chatId]) return;
    const msg = messages[chatId].find(m => m.id === messageId);
    if (!msg || !msg.upiData) return;

    msg.upiData.status = status || 'paid';
    msg.upiData.updatedAt = formatISTTime(new Date());
    msg.upiData.paidBy = userId;
    saveDatabase();
    io.to(chatId).emit('upi-updated', {
      chatId,
      messageId,
      upiData: msg.upiData
    });
  });

  // Delete message for everyone
  socket.on('delete-message', ({ chatId, messageId }) => {
    if (messages[chatId]) {
      const idx = messages[chatId].findIndex(m => m.id === messageId);
      if (idx !== -1) {
        messages[chatId].splice(idx, 1);
        if (chatSettings[chatId]?.pinnedMessageId === messageId) {
          chatSettings[chatId].pinnedMessageId = null;
        }
        saveDatabase();
        io.to(chatId).emit('message-deleted', {
          chatId,
          messageId
        });
      }
    }
  });
}
