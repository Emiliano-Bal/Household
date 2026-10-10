#!/usr/bin/env node
// Household budget planner backend. Serves the static frontend and the
// /api/households JSON API from a single origin/port, on purpose: the old
// Python server defaulted to port 4040 while the frontend called a
// hardcoded 4041, so most saves/loads silently failed. Keeping both on one
// origin removes that whole class of bug — see src/data.js, which now
// calls a relative /api/households path instead of an absolute URL.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'households.db');

export function emptyTracker() {
  return { startingBalance: 0, entries: [] };
}

// A tracker (savings or credit card debt) belongs to one person: a starting
// balance plus an append-only list of signed monthly entries. Anything
// malformed is dropped rather than rejecting the whole save.
export function normalizeTracker(tracker) {
  if (!tracker || typeof tracker !== 'object') return emptyTracker();

  const startingBalance = Number(tracker.startingBalance);
  const entries = Array.isArray(tracker.entries) ? tracker.entries : [];

  const cleanEntries = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const amount = Number(entry.amount);
    if (!amount) continue;
    cleanEntries.push({
      id: String(entry.id || '').trim() || `entry-${cleanEntries.length}`,
      amount,
      note: String(entry.note || '').trim(),
      month: String(entry.month || '').trim(),
      date: String(entry.date || '').trim()
    });
  }

  return {
    startingBalance: Number.isFinite(startingBalance) ? startingBalance : 0,
    entries: cleanEntries
  };
}

function normalizePerson(person) {
  if (!person || typeof person !== 'object') return person;
  person.savingsTracker = normalizeTracker(person.savingsTracker);
  person.creditCardTracker = normalizeTracker(person.creditCardTracker);
  return person;
}

// splitPercent is the payer's custom share (1-99) of a shared expense;
// anything outside that range is meaningless, so it's dropped to null and
// the household's default sharedExpenseMethod applies instead.
function normalizeSplitPercent(item) {
  const raw = item.splitPercent;
  if (raw === null || raw === undefined || raw === '') {
    item.splitPercent = null;
    return item;
  }
  const percent = Number(raw);
  item.splitPercent = Number.isFinite(percent) && percent > 0 && percent < 100 ? percent : null;
  return item;
}

function normalizePaidBy(item) {
  if (!item || typeof item !== 'object') return item;

  const paidBy = String(item.paidBy || item.payer || 'shared').trim() || 'shared';
  item.paidBy = paidBy;
  item.payer = String(item.payer || item.paidBy || 'shared').trim() || 'shared';

  return normalizeSplitPercent(item);
}

const SHARED_EXPENSE_METHODS = new Set(['equal', 'yearlyincome', 'monthlyincome']);

function normalizeSharedExpenseMethod(record) {
  if (!record || typeof record !== 'object') return record;

  const method = String(record.sharedExpenseMethod || 'equal').trim().toLowerCase();
  if (method === 'yearlyincome') {
    record.sharedExpenseMethod = 'yearlyIncome';
  } else if (method === 'monthlyincome') {
    record.sharedExpenseMethod = 'monthlyIncome';
  } else {
    record.sharedExpenseMethod = 'equal';
  }

  if (Array.isArray(record.persons)) record.persons = record.persons.map(normalizePerson);
  if (Array.isArray(record.fixedCosts)) record.fixedCosts = record.fixedCosts.map(normalizePaidBy);
  if (Array.isArray(record.budgets)) record.budgets = record.budgets.map(normalizePaidBy);

  return record;
}

export function setupDatabase() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_name TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `);
  return db;
}

export function readRecord(db, householdName, password) {
  if (householdName && password) {
    const row = db.prepare('SELECT data FROM households WHERE household_name = ? AND password = ?')
      .get(householdName, password);
    return row ? normalizeSharedExpenseMethod(JSON.parse(row.data)) : null;
  }

  if (householdName) {
    const row = db.prepare('SELECT data FROM households WHERE household_name = ?').get(householdName);
    return row ? normalizeSharedExpenseMethod(JSON.parse(row.data)) : null;
  }

  const rows = db.prepare('SELECT household_name, data FROM households ORDER BY id').all();
  return rows.map(row => ({
    householdName: row.household_name,
    data: normalizeSharedExpenseMethod(JSON.parse(row.data))
  }));
}

export function saveRecord(db, payload) {
  const householdName = String(payload.householdName || '').trim();
  const password = String(payload.password || '').trim();
  if (!householdName || !password) return null;

  const dataText = JSON.stringify(payload);
  db.prepare(`
    INSERT INTO households(household_name, password, data)
    VALUES(?, ?, ?)
    ON CONFLICT(household_name)
    DO UPDATE SET password = excluded.password, data = excluded.data
  `).run(householdName, password, dataText);

  return payload;
}

function sanitizeMethod(value) {
  const method = String(value || 'equal').trim().toLowerCase();
  if (method === 'yearlyincome') return 'yearlyIncome';
  if (method === 'monthlyincome') return 'monthlyIncome';
  return 'equal';
}

export function buildStoredPayload(payload) {
  return {
    householdName: String(payload.householdName || '').trim(),
    password: String(payload.password || '').trim(),
    persons: Array.isArray(payload.persons) ? payload.persons.map(normalizePerson) : [],
    fixedCosts: Array.isArray(payload.fixedCosts) ? payload.fixedCosts.map(normalizePaidBy) : [],
    budgets: Array.isArray(payload.budgets) ? payload.budgets.map(normalizePaidBy) : [],
    savings: payload.savings || 0,
    sharedExpenseMethod: sanitizeMethod(payload.sharedExpenseMethod),
    currentMonth: payload.currentMonth || null
  };
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(ROOT, filePath);

  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(fullPath);
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

export function createApp(db) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    if (url.pathname === '/api/households' && req.method === 'GET') {
      try {
        const householdName = (url.searchParams.get('householdName') || '').trim();
        const password = (url.searchParams.get('password') || '').trim();

        if (householdName && password) {
          const record = readRecord(db, householdName, password);
          if (record) sendJson(res, 200, record);
          else sendJson(res, 404, { error: 'household not found', householdName });
        } else if (householdName) {
          const record = readRecord(db, householdName);
          if (record) sendJson(res, 200, record);
          else sendJson(res, 404, { error: 'household not found', householdName });
        } else {
          sendJson(res, 200, readRecord(db));
        }
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
      return;
    }

    if (url.pathname === '/api/households' && req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const payload = raw ? JSON.parse(raw) : {};
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { error: 'payload must be an object' });
          return;
        }

        const stored = buildStoredPayload(payload);
        if (!stored.householdName || !stored.password) {
          sendJson(res, 400, { error: 'household name and password are required' });
          return;
        }

        const saved = saveRecord(db, stored);
        if (!saved) sendJson(res, 500, { error: 'database write failed' });
        else sendJson(res, 200, saved);
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

function isMain() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const db = setupDatabase();
  const port = Number(process.env.PORT || process.argv[2] || 4040);
  const app = createApp(db);
  app.listen(port, '127.0.0.1', () => {
    console.log(`Serving household budget planner on http://127.0.0.1:${port}`);
  });
}
