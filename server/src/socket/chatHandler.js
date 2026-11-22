import { messages, users, groups, saveDatabase } from '../data/store.js';
import { v4 as uuidv4 } from 'uuid';
import { formatISTTime } from '../utils/time.js';

export function setupChatHandlers(io, socket, userSocketMap) {
  // Join a personal or group chat room
  socket.on('join-chat', ({ chatId }) => {
    socket.join(chatId);
    console.log(`[Socket] User ${socket.id} joined room ${chatId}`);
  });

  // Leave a chat room
  socket.on('leave-chat', ({ chatId }) => {
    socket.leave(chatId);
    console.log(`[Socket] User ${socket.id} left room ${chatId}`);
  });

  // Send real-time 1-on-1 or group message
  socket.on('send-message', ({ 
    tempId = null,
    chatId, 
    senderId, 
    senderName, 
    text, 
    mediaUrl, 
    type = 'text',
    encrypted = true,
    recipientId = null
  }) => {
    // 🛡️ SECURITY: Identity verification (Anti-Impersonation)
    if (socket.userId && senderId && socket.userId !== senderId) {
      console.warn(`[Security Alert] Blocked spoofed message from socket ${socket.id} claiming to be ${senderId}`);
      return;
    }

    const safeText = typeof text === 'string' 
      ? text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim()
      : text;

    const senderUser = users.find(u => u.id === senderId);
    const senderPhone = senderUser?.phone || '';
    const senderAvatar = senderUser?.avatar || '';
    const resolvedSenderName = senderUser?.name || senderName;

    const now = new Date();
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
      timestamp: formatISTTime(now),
      createdAt: now.toISOString(),
      rawTime: now.getTime(),
      status: 'delivered'
    };

    if (!messages[chatId]) {
      messages[chatId] = [];
    }
    messages[chatId].push(newMessage);
    saveDatabase();

    // Broadcast EXACTLY ONCE to chatId room, recipient personal room, and sender personal room
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

    // Alert recipient if not in chat room
    if (recipientId) {
      const alertPayload = {
        chatId,
        senderId,
        senderName: resolvedSenderName,
        senderPhone,
        senderAvatar,
        text,
        type,
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
      };
      socket.to(recipientId).emit('incoming-message-alert', alertPayload);
    }

    console.log(`[Message] [E2EE: ${encrypted}] Sent in ${chatId} by ${senderName}: ${text?.substring(0, 30)}...`);
  });

  // Typing status indicator
  socket.on('typing', ({ chatId, userId, userName, isTyping }) => {
    socket.to(chatId).emit('user-typing', {
      chatId,
      userId,
      userName,
      isTyping
    });
  });

  // Mark message as read
  socket.on('mark-read', ({ chatId, messageId, readerId }) => {
    if (messages[chatId]) {
      messages[chatId] = messages[chatId].map(msg => 
        msg.id === messageId ? { ...msg, status: 'read' } : msg
      );
    }
    io.to(chatId).emit('message-status-updated', {
      chatId,
      messageId,
      status: 'read'
    });
  });

  // Emoji Reaction on a message
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

  // Interactive Poll Voting
  socket.on('poll-vote', ({ chatId, messageId, optionId, userId }) => {
    if (messages[chatId]) {
      const msg = messages[chatId].find(m => m.id === messageId);
      if (msg && msg.pollData && Array.isArray(msg.pollData.options)) {
        msg.pollData.options.forEach(opt => {
          if (!Array.isArray(opt.votes)) opt.votes = [];
          if (opt.id === optionId) {
            if (opt.votes.includes(userId)) {
              opt.votes = opt.votes.filter(id => id !== userId);
            } else {
              opt.votes.push(userId);
            }
          }
        });
        saveDatabase();
        io.to(chatId).emit('poll-updated', {
          chatId,
          messageId,
          pollData: msg.pollData
        });
      }
    }
  });

  // Delete message for everyone
  socket.on('delete-message', ({ chatId, messageId }) => {
    if (messages[chatId]) {
      const idx = messages[chatId].findIndex(m => m.id === messageId);
      if (idx !== -1) {
        messages[chatId].splice(idx, 1);
        saveDatabase();
        io.to(chatId).emit('message-deleted', {
          chatId,
          messageId
        });
      }
    }
  });
}
