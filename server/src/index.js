import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import { setupChatHandlers, dispatchChatMessage } from './socket/chatHandler.js';
import { setupCallHandlers } from './socket/callHandler.js';
import { users, messages, statuses, scheduledMessages, chatSettings, activeSessions, saveDatabase, saveDatabaseSync } from './data/store.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Trust Cloudflare tunnel and reverse proxies for client IP rate limiting
app.set('trust proxy', 1);

// 🛡️ SECURITY 1: Helmet HTTP Security Headers (Anti-Clickjacking, Anti-XSS, MIME-sniffing protection)
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for local development & Capacitor assets
  crossOriginEmbedderPolicy: false
}));

// 🛡️ SECURITY 2: Anti-DDoS & Brute-Force Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});
app.use('/api/', apiLimiter);

// Strict Rate Limiting on OTP Authentication (Anti-SMS Flooding & OTP Guessing)
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // Max 15 attempts per 10 minutes
  message: { error: 'Too many login attempts. Please wait 10 minutes before trying again.' }
});
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);

// Allow CORS for local development across Expo Web, Mobile, and Emulators
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e7 // 10MB max socket payload (prevents memory-exhaustion DoS attacks)
});

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// 🛡️ SECURITY 3: Input Sanitization Middleware (Anti-XSS script injection)
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const [key, val] of Object.entries(req.body)) {
      if (typeof val === 'string') {
        // Strip out dangerous HTML <script> and <iframe> tags
        req.body[key] = val.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                           .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
      }
    }
  }
  next();
});

// Attach Socket.io to request for REST controllers
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Download APK route for easy mobile installation
app.get('/download-apk', (req, res) => {
  const apkPath = path.resolve(__dirname, '../../GlassChat.apk');
  if (fs.existsSync(apkPath)) {
    return res.download(apkPath, 'GlassChat.apk');
  }
  res.status(404).send('APK file not hosted directly on this instance.');
});

// Download iOS IPA package route
app.get('/download-ipa', (req, res) => {
  const ipaPath = path.resolve(__dirname, '../../GlassChat.ipa');
  if (fs.existsSync(ipaPath)) {
    return res.download(ipaPath, 'GlassChat.ipa');
  }
  res.status(404).send('IPA file not hosted directly on this instance.');
});

// Over-The-Air (OTA) iOS manifest for native in-browser installation
app.get('/ios-manifest.plist', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const ipaUrl = `${protocol}://${host}/download-ipa`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${ipaUrl}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>com.glasschat.app</string>
                <key>bundle-version</key>
                <string>1.3.4</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>GlassChat</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;
  res.set('Content-Type', 'text/xml');
  res.send(plist);
});

// One-click Apple iOS WebClip Configuration Profile (.mobileconfig)
// Installs GlassChat with custom 3D icon directly onto iPhone Home Screen (no Apple Developer account required)
app.get('/ios-install.mobileconfig', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const appUrl = `${protocol}://${host}/`;

  // Read apple-touch-icon.png as base64 for iPhone Home Screen icon
  let iconBase64 = '';
  const iconCandidates = [
    path.resolve(__dirname, '../public/apple-touch-icon.png'),
    path.resolve(__dirname, '../../client/public/apple-touch-icon.png')
  ];
  for (const candidate of iconCandidates) {
    if (fs.existsSync(candidate)) {
      iconBase64 = fs.readFileSync(candidate).toString('base64');
      break;
    }
  }

  const iconXml = iconBase64
    ? `            <key>Icon</key>\n            <data>${iconBase64}</data>`
    : '';

  const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>FullScreen</key>
            <true/>
            <key>IgnoreManifestScope</key>
            <false/>
            <key>IsRemovable</key>
            <true/>
            <key>Label</key>
            <string>GlassChat</string>
            <key>PayloadDescription</key>
            <string>Installs GlassChat Web App on iPhone Home Screen</string>
            <key>PayloadDisplayName</key>
            <string>GlassChat App</string>
            <key>PayloadIdentifier</key>
            <string>com.glasschat.app.webclip</string>
            <key>PayloadType</key>
            <string>com.apple.webClip.managed</string>
            <key>PayloadUUID</key>
            <string>B7A4F2C1-8D3E-4A91-9E2B-112233445566</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>Precomposed</key>
            <true/>
            <key>URL</key>
            <string>${appUrl}</string>
${iconXml}
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Tap Install to add GlassChat with full-screen HD calling and 3D icon to your iPhone Home Screen.</string>
    <key>PayloadDisplayName</key>
    <string>GlassChat for iPhone</string>
    <key>PayloadIdentifier</key>
    <string>com.glasschat.app.profile</string>
    <key>PayloadOrganization</key>
    <string>GlassChat Messenger</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>A1B2C3D4-E5F6-4789-ABCD-EF0123456789</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

  res.set({
    'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
    'Content-Disposition': 'attachment; filename="GlassChat.mobileconfig"'
  });
  res.send(mobileconfig);
});

// API Routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    appName: 'GlassChat Server',
    features: ['1-on-1 Chat', 'Group Chat', 'WebRTC 1-on-1 Audio/Video', 'WebRTC Group Calling'],
    timestamp: new Date().toISOString()
  });
});

// Serve static client build (Vite dist or bundled server/public) if available
const clientDistPath = path.resolve(__dirname, '../../client/dist');
const serverPublicPath = path.resolve(__dirname, '../public');
const activeStaticPath = fs.existsSync(path.join(clientDistPath, 'index.html'))
  ? clientDistPath
  : (fs.existsSync(path.join(serverPublicPath, 'index.html')) ? serverPublicPath : null);

if (activeStaticPath) {
  app.use(express.static(activeStaticPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/download-apk' || req.path === '/download-ipa' || req.path === '/ios-manifest.plist' || req.path === '/ios-install.mobileconfig' || req.path === '/health' || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(activeStaticPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      status: 'online',
      appName: 'GlassChat Server',
      message: 'GlassChat 24/7 Cloud Backend is running successfully! 🚀',
      timestamp: new Date().toISOString()
    });
  });
}

// Map of userId -> socketId
const userSocketMap = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket] New connection established: ${socket.id}`);

  // Register user ID with socket & record active session metadata for Admin inspector
  socket.on('register-user', (payload) => {
    const userId = typeof payload === 'string' ? payload : payload?.userId;
    if (!userId) return;
    socket.userId = userId;
    userSocketMap.set(userId, socket.id);
    socket.join(userId); // Join personal room for direct events

    const clientIp = (socket.handshake?.headers?.['x-forwarded-for'] || socket.handshake?.address || '').toString().split(',')[0].trim();
    const userAgent = (typeof payload === 'object' && payload?.userAgent) || socket.handshake?.headers?.['user-agent'] || 'Unknown';
    const platform = (typeof payload === 'object' && payload?.platform) || 'Web';
    const nowIso = new Date().toISOString();

    activeSessions.set(userId, {
      socketId: socket.id,
      status: 'Active',
      platform,
      userAgent,
      ip: clientIp,
      connectedAt: nowIso
    });

    const u = users.find(usr => usr.id === userId);
    if (u) {
      u.online = true;
      u.lastLoginAt = nowIso;
      u.lastDevice = platform;
      saveDatabase();
    }

    // Broadcast online status immediately
    io.emit('user-status-changed', { userId, online: true });

    // When recipient comes online (data ON): update pending 'sent' messages to 'delivered'
    try {
      let anyDelivered = false;
      Object.keys(messages).forEach(cId => {
        let chatUpdated = false;
        const deliveredIds = [];
        messages[cId].forEach(m => {
          if ((m.recipientId === userId || (!m.recipientId && cId.includes(userId))) && m.senderId !== userId && m.status === 'sent') {
            m.status = 'delivered';
            deliveredIds.push(m.id);
            chatUpdated = true;
            anyDelivered = true;
          }
        });
        if (chatUpdated) {
          io.to(cId).emit('messages-delivered', { chatId: cId, deliveredIds });
        }
      });
      if (anyDelivered) {
        saveDatabase();
      }
    } catch (e) {
      console.warn('[Message Delivery Sync Error]:', e);
    }
  });

  // Attach specialized event handlers
  setupChatHandlers(io, socket, userSocketMap);
  setupCallHandlers(io, socket, userSocketMap);

  socket.on('disconnect', () => {
    if (socket.userId) {
      if (userSocketMap.get(socket.userId) === socket.id) {
        userSocketMap.delete(socket.userId);
        const nowIso = new Date().toISOString();
        const prevSession = activeSessions.get(socket.userId) || {};
        activeSessions.set(socket.userId, {
          ...prevSession,
          status: 'Disconnected',
          disconnectedAt: nowIso
        });
        const u = users.find(usr => usr.id === socket.userId);
        if (u) {
          u.online = false;
          u.lastSeen = nowIso;
          saveDatabase();
        }
        io.emit('user-status-changed', { userId: socket.userId, online: false, lastSeen: nowIso });
      }
    }
  });
});

// Background worker every 5s: Scheduled Messages, Disappearing Messages TTL, 24h Status cleanup
setInterval(() => {
  const nowMs = Date.now();
  let modified = false;

  // 1. Dispatch due scheduled messages
  for (let i = scheduledMessages.length - 1; i >= 0; i--) {
    const item = scheduledMessages[i];
    if (item && item.sendAtMs <= nowMs) {
      scheduledMessages.splice(i, 1);
      modified = true;
      dispatchChatMessage(io, userSocketMap, item.payload);
      if (item.payload?.senderId) {
        io.to(item.payload.senderId).emit('scheduled-message-sent', {
          id: item.id,
          chatId: item.payload.chatId
        });
      }
    }
  }

  // 2. Permanent history preservation: messages are NEVER auto-removed unless deleted manually

  // 3. Clean 24-hour expired statuses
  const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
  for (let i = statuses.length - 1; i >= 0; i--) {
    const st = statuses[i];
    if (st?.createdAt && (nowMs - new Date(st.createdAt).getTime()) > STATUS_TTL_MS) {
      const removed = statuses.splice(i, 1)[0];
      modified = true;
      if (removed?.id) {
        io.emit('status-deleted', { id: removed.id });
      }
    }
  }

  if (modified) {
    saveDatabase();
  }
}, 5000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 GlassChat Node.js Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

process.on('SIGINT', () => {
  saveDatabaseSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveDatabaseSync();
  process.exit(0);
});

