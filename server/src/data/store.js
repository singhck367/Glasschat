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
  calls: []
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
        statuses: parsed.statuses || []
      };
    }
  } catch (err) {
    console.error('Failed to read database.json, initializing fresh clean store:', err);
  }

  // Create clean database.json
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultSeed, null, 2), 'utf-8');
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

// Save current state to disk
export function saveDatabase() {
  try {
    const dataToSave = {
      users,
      groups,
      messages,
      calls,
      statuses
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save to database.json:', err);
  }
}

// Active real-time room sessions for WebRTC group calls (transient)
export const activeCallRooms = new Map();

// Active OTP storage for phone login
export const otpStore = new Map();

// Real-time OTP dispatch logs for Owner / Admin control panel
export const otpLogs = [];
