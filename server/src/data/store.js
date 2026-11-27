import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.json');
const DB_BAK_FILE = path.join(__dirname, 'database.json.bak');
const DB_TMP_FILE = path.join(__dirname, 'database.json.tmp');

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

function parseDbFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw || !raw.trim()) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return null;
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

// Load data from disk with automatic backup recovery (NEVER wipes history on corrupt file)
function loadDatabase() {
  for (const candidate of [DB_FILE, DB_BAK_FILE, DB_TMP_FILE]) {
    try {
      const parsed = parseDbFile(candidate);
      if (parsed) {
        console.log(`📦 Loaded database (${path.basename(candidate)}) with ${parsed.users.length} real users.`);
        if (candidate !== DB_FILE) {
          try {
            fs.writeFileSync(DB_FILE, JSON.stringify(parsed), 'utf-8');
          } catch {}
        }
        return parsed;
      }
    } catch (err) {
      console.error(`Failed to parse ${path.basename(candidate)}:`, err);
      if (candidate === DB_FILE && fs.existsSync(DB_FILE)) {
        try {
          fs.copyFileSync(DB_FILE, `${DB_FILE}.corrupt.${Date.now()}`);
        } catch {}
      }
    }
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
    const snapshot = buildSnapshot();
    await fs.promises.writeFile(DB_TMP_FILE, snapshot, 'utf-8');
    if (fs.existsSync(DB_FILE)) {
      try { await fs.promises.copyFile(DB_FILE, DB_BAK_FILE); } catch {}
    }
    await fs.promises.rename(DB_TMP_FILE, DB_FILE);
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
    const snapshot = buildSnapshot();
    fs.writeFileSync(DB_TMP_FILE, snapshot, 'utf-8');
    if (fs.existsSync(DB_FILE)) {
      try { fs.copyFileSync(DB_FILE, DB_BAK_FILE); } catch {}
    }
    fs.renameSync(DB_TMP_FILE, DB_FILE);
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
