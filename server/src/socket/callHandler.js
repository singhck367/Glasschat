import { activeCallRooms } from '../data/store.js';

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

    const targetSocketId = userSocketMap.get(userToCall);
    console.log(`[Call] ${fromName} (${from}) calling ${userToCall} [Video: ${isVideo}] TargetSocket: ${targetSocketId}`);

    const destination = targetSocketId || userToCall;
    if (destination) {
      io.to(destination).emit('incoming-call', {
        signal: signalData,
        from,
        fromName,
        fromAvatar,
        isVideo,
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

    const destination = callerSocketId || to;
    if (destination) {
      io.to(destination).emit('call-accepted', {
        signal,
        from: socket.userId
      });
    }
  });

  // Reject / Decline call
  socket.on('reject-call', ({ to, reason = 'declined' }) => {
    const callerSocketId = userSocketMap.get(to);
    console.log(`[Call] Call declined by ${socket.id} to ${to}`);

    const destination = callerSocketId || to;
    if (destination) {
      io.to(destination).emit('call-rejected', { reason });
    }
  });

  // ICE Candidate exchange for 1-on-1
  socket.on('ice-candidate', ({ to, candidate }) => {
    const targetSocketId = userSocketMap.get(to);
    const destination = targetSocketId || to;
    if (destination && candidate) {
      io.to(destination).emit('ice-candidate', {
        candidate,
        from: socket.userId
      });
    }
  });

  // End call
  socket.on('end-call', ({ to }) => {
    const targetSocketId = userSocketMap.get(to);
    console.log(`[Call] Call ended between ${socket.id} and ${to}`);
    const destination = targetSocketId || to;
    if (destination) {
      io.to(destination).emit('call-ended');
    }
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

  // Disconnect handler for calls
  socket.on('disconnect', () => {
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
  }
}

