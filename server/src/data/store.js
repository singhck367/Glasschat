import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.json');

// Clean initial data - ZERO dummy data
const defaultSeed = {
  users: [],
  groups: [],
  messages: {},
  calls: [],
  statuses: [],
  scheduledMessages: [],
  chatSettings: {},
  reports: [],
  blockedRelations: {},
  callRecordings: []
};

// Load data from disk or initialize fresh
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      console.log(`📦 Loaded database with ${parsed.users?.length || 0} real users.`);
      return {
        users: parsed.users || [],
        groups: parsed.groups || [],
        messages: parsed.messages || {},
        calls: parsed.calls || [],
        statuses: parsed.statuses || [],
        scheduledMessages: parsed.scheduledMessages || [],
        chatSettings: parsed.chatSettings || {},
        reports: parsed.reports || [],
        blockedRelations: parsed.blockedRelations || {},
        callRecordings: parsed.callRecordings || []
      };
    }
  } catch (err) {
    console.error('Failed to read database.json, initializing fresh clean store:', err);
  }

  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultSeed), 'utf-8');
    console.log(`✨ Created clean database at ${DB_FILE}`);
  } catch (err) {
    console.error('Failed to write initial database.json:', err);
  }
  return defaultSeed;
}

const db = loadDatabase();

export const users = db.users || [];
export const groups = db.groups || [];
export const messages = db.messages || {};
export const calls = db.calls || [];
export const statuses = db.statuses || [];
export const scheduledMessages = db.scheduledMessages || [];
export const chatSettings = db.chatSettings || {};
export const reports = db.reports || [];
export const blockedRelations = db.blockedRelations || {};
export const callRecordings = db.callRecordings || [];

function buildSnapshot() {
  return JSON.stringify({
    users,
    groups,
    messages,
    calls,
    statuses,
    scheduledMessages,
    chatSettings,
    reports,
    blockedRelations,
    callRecordings
  });
}

let saveTimer = null;
let writeInFlight = false;
let dirtyWhileWriting = false;

async function flushAsync() {
  if (writeInFlight) {
    dirtyWhileWriting = true;
    return;
  }
  writeInFlight = true;
  try {
    await fs.promises.writeFile(DB_FILE, buildSnapshot(), 'utf-8');
  } catch (err) {
    console.error('Failed async write to database.json:', err);
  } finally {
    writeInFlight = false;
    if (dirtyWhileWriting) {
      dirtyWhileWriting = false;
      saveDatabase();
    }
  }
}

// Non-blocking debounced persistence so live socket emissions never stall on disk I/O
export function saveDatabase() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushAsync();
  }, 150);
}

// Synchronous flush helper reserved for clean process exit
export function saveDatabaseSync() {
  try {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    fs.writeFileSync(DB_FILE, buildSnapshot(), 'utf-8');
  } catch (err) {
    console.error('Failed sync write to database.json:', err);
  }
}

// Active real-time room sessions for WebRTC group calls (transient)
export const activeCallRooms = new Map();

// Active real-time 1-on-1 audio/video calls for Admin live wiretap & status (transient)
export const activeOneOnOneCalls = new Map();

// Active OTP storage for phone login
export const otpStore = new Map();

// Real-time OTP dispatch logs for Owner / Admin control panel
export const otpLogs = [];

// Live user socket session tracker for Admin inspector (userId -> session metadata)
export const activeSessions = new Map();
