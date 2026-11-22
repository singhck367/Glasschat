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
import { setupChatHandlers } from './socket/chatHandler.js';
import { setupCallHandlers } from './socket/callHandler.js';
import { users, saveDatabase } from './data/store.js';

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

// Serve static client build (Vite dist) if available
const clientDistPath = path.resolve(__dirname, '../../client/dist');
const indexPath = path.join(clientDistPath, 'index.html');
if (fs.existsSync(indexPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/download-apk' || req.path === '/health' || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(indexPath);
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

  // Register user ID with socket
  socket.on('register-user', ({ userId }) => {
    if (!userId) return;
    socket.userId = userId;
    userSocketMap.set(userId, socket.id);
    socket.join(userId); // Join personal room for direct events
    console.log(`[Socket] Registered User ${userId} -> Socket ${socket.id} (joined personal room)`);

    const u = users.find(usr => usr.id === userId);
    if (u) {
      u.online = true;
      saveDatabase();
    }

    // Broadcast online status
    io.emit('user-status-changed', { userId, online: true });
  });

  // Attach specialized event handlers
  setupChatHandlers(io, socket, userSocketMap);
  setupCallHandlers(io, socket, userSocketMap);

  socket.on('disconnect', () => {
    if (socket.userId) {
      userSocketMap.delete(socket.userId);
      const nowIso = new Date().toISOString();
      const u = users.find(usr => usr.id === socket.userId);
      if (u) {
        u.online = false;
        u.lastSeen = nowIso;
        saveDatabase();
      }
      console.log(`[Socket] Disconnected: User ${socket.userId}`);
      io.emit('user-status-changed', { userId: socket.userId, online: false, lastSeen: nowIso });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 GlassChat Node.js Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

