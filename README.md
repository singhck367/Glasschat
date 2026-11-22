# 🔮 GlassChat - Pure Light Glassmorphism Messenger (WhatsApp Style)

Cross-platform messaging & calling application built with **React**, **Node.js**, **Socket.IO**, and **WebRTC**, featuring an ultra-modern **light frosted glass (Glassmorphism)** design for **iOS and Android**.

---

## ✨ Features Implemented

### 💬 Messaging & Social
- **1-on-1 Real-time Chat**: Instant messaging powered by WebSockets, message delivery timestamps, read receipts (blue double-checkmarks), and real-time typing indicators.
- **Group Chat**: Create custom groups, select participants, group info, real-time multi-user message broadcast, and member tags.
- **Emoji Support**: Floating quick glass emoji selector.

### 📞 Audio & Video Calling (1-on-1 & Group)
- **1-on-1 Audio & Video Calling**:
  - WebRTC peer-to-peer real-time media streams with Google STUN servers.
  - Floating Picture-in-Picture (PiP) local camera selfie mirror.
  - Controls: Mic Mute, Video On/Off, and End Call with frosted glass action dock.
  - Call timer and connection status indicator.
- **Group Audio & Group Video Calling**:
  - Multi-party video grid (2x2 / dynamic tiles) with glassmorphic cards.
  - Participant status badges (muted, speaking, camera status).
  - Room-based WebRTC signaling (`join-group-call`, `leave-group-call`).
- **Incoming Call Ringing Screen**:
  - Ambient glass blur overlay with animated pulsing caller avatar.
  - One-tap Accept and Decline buttons.
- **Calls Log Tab**:
  - Recent call history with icons for Incoming, Outgoing, and Missed calls.
  - One-tap redial directly from the call log.

### 🎨 Pure Light Glassmorphism UI
- **Light Pastel Palette**: Subtle ice blue (`#E0F2FE`), lavender (`#F3E8FF`), and mint (`#ECFDF5`) ambient aura.
- **Frosted Translucent Blur**: `backdrop-filter: blur(24px)` with delicate white borders (`rgba(255, 255, 255, 0.65)`).
- **Glass Message Bubbles**: Frosted white incoming bubbles and translucent sky-blue outgoing bubbles.
- **Mobile Device Frame**: Built-in toggle to preview the app in a realistic mobile bezel (iPhone / Android) or expand to full-screen.

---

## 🚀 Running the App

### 1. Backend Server (Node.js + Socket.IO)
```bash
cd server
npm install
npm run dev
```
- Server runs on: `http://localhost:5000`
- Health check: `http://localhost:5000/health`

### 2. Client Application (React + Vite)
```bash
cd client
npm install
npm run dev
```
- Web & Mobile preview: `http://localhost:3000`
- On your phone over Wi-Fi: `http://<YOUR_LOCAL_IP>:3000` (e.g. `http://192.168.1.4:3000`)

---

## 📱 Building Native iOS & Android Apps (Capacitor)

The project includes `@capacitor/core` and `@capacitor/cli` preconfigured in `client/capacitor.config.json`.

To build native mobile binaries:

### Build for Android:
```bash
cd client
npm run build
npx cap add android
npx cap open android
```
*This opens the project in Android Studio, where you can click "Run" or "Build APK".*

### Build for iOS:
```bash
cd client
npm run build
npx cap add ios
npx cap open ios
```
*This opens the project in Xcode (on macOS), where you can run on an iPhone or simulator.*

