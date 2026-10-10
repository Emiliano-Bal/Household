import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setupDatabase, readRecord, saveRecord, buildStoredPayload, normalizeTracker } from '../server.js';

let dir;
let dbFile;
let db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gastos-test-'));
  dbFile = path.join(dir, 'households.db');
  db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_name TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      data TEXT NOT NULL
    )
  `);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('save + read round-trips the shared expense policy', () => {
  const stored = buildStoredPayload({
    householdName: 'TestHome',
    password: 'abcd',
    persons: [],
    fixedCosts: [],
    budgets: [],
    savings: 0,
    sharedExpenseMethod: 'yearlyIncome'
  });

  const saved = saveRecord(db, stored);
  assert.ok(saved);
  assert.equal(saved.sharedExpenseMethod, 'yearlyIncome');

  const record = readRecord(db, 'TestHome', 'abcd');
  assert.equal(record.sharedExpenseMethod, 'yearlyIncome');
});

test('payer alias normalizes to paidBy on read', () => {
  const stored = buildStoredPayload({
    householdName: 'PayByHome',
    password: 'abcd',
    persons: [],
    fixedCosts: [{ name: 'Rent', amount: 100, frequency: 'monthly', payMonth: '', owner: 'shared', payer: 'Avery' }],
    budgets: [],
    savings: 0,
    sharedExpenseMethod: 'equal'
  });

  saveRecord(db, stored);
  const record = readRecord(db, 'PayByHome', 'abcd');

  assert.equal(record.fixedCosts[0].paidBy, 'Avery');
  assert.equal(record.fixedCosts[0].payer, 'Avery');
});

test('missing shared expense policy defaults to equal', () => {
  const stored = buildStoredPayload({
    householdName: 'LegacyHome',
    password: 'abcd',
    persons: [],
    fixedCosts: [],
    budgets: [],
    savings: 0
  });

  saveRecord(db, stored);
  const record = readRecord(db, 'LegacyHome', 'abcd');
  assert.equal(record.sharedExpenseMethod, 'equal');
});

test('a valid splitPercent on a shared expense survives the round-trip', () => {
  const stored = buildStoredPayload({
    householdName: 'SplitHome',
    password: 'abcd',
    persons: [],
    fixedCosts: [{ name: 'Rent', amount: 1000, frequency: 'monthly', payMonth: '', owner: 'shared', paidBy: 'Avery', splitPercent: 65 }],
    budgets: [],
    savings: 0,
    sharedExpenseMethod: 'equal'
  });

  saveRecord(db, stored);
  const record = readRecord(db, 'SplitHome', 'abcd');
  assert.equal(record.fixedCosts[0].splitPercent, 65);
});

test('an out-of-range splitPercent is dropped to null', () => {
  const stored = buildStoredPayload({
    householdName: 'BadSplitHome',
    password: 'abcd',
    persons: [],
    fixedCosts: [],
    budgets: [{ name: 'Groceries', amount: 200, frequency: 'monthly', payMonth: '', owner: 'shared', paidBy: 'Morgan', splitPercent: 150 }],
    savings: 0,
    sharedExpenseMethod: 'equal'
  });

  saveRecord(db, stored);
  const record = readRecord(db, 'BadSplitHome', 'abcd');
  assert.equal(record.budgets[0].splitPercent, null);
});

test('each person carries their own savings and credit card tracker', () => {
  const stored = buildStoredPayload({
    householdName: 'TrackerHome',
    password: 'abcd',
    persons: [
      {
        name: 'Nano',
        salary: 2700,
        incomes: [],
        savingsTracker: { startingBalance: 1000, entries: [{ id: 'a1', amount: 200, note: 'Bonus', month: 'October 2026', date: '2026-10-05' }] },
        creditCardTracker: { startingBalance: 300, entries: [{ id: 'c1', amount: -50, note: 'Paid down', month: 'October 2026', date: '2026-10-05' }] }
      },
      { name: 'Shelle', salary: 2358, incomes: [] }
    ],
    fixedCosts: [],
    budgets: [],
    savings: 0,
    sharedExpenseMethod: 'equal'
  });

  saveRecord(db, stored);
  const record = readRecord(db, 'TrackerHome', 'abcd');

  assert.equal(record.persons[0].savingsTracker.startingBalance, 1000);
  assert.equal(record.persons[0].savingsTracker.entries[0].amount, 200);
  assert.equal(record.persons[0].creditCardTracker.entries[0].amount, -50);

  // Shelle never set up trackers — they should backfill to an empty tracker
  // rather than being undefined, so the UI never sees a missing field.
  assert.deepEqual(record.persons[1].savingsTracker, { startingBalance: 0, entries: [] });
  assert.deepEqual(record.persons[1].creditCardTracker, { startingBalance: 0, entries: [] });
});

test('normalizeTracker drops malformed entries but keeps valid ones', () => {
  const tracker = normalizeTracker({
    startingBalance: 'not-a-number',
    entries: [
      { id: 'x1', amount: 50, note: 'ok' },
      { id: 'x2', amount: 'oops' },
      null,
      { id: 'x3', amount: 0 }
    ]
  });

  assert.equal(tracker.startingBalance, 0);
  assert.equal(tracker.entries.length, 1);
  assert.equal(tracker.entries[0].id, 'x1');
});

test('an unknown household/password returns null', () => {
  const record = readRecord(db, 'Nobody', 'wrong');
  assert.equal(record, null);
});

test('listing all households normalizes every record', () => {
  saveRecord(db, buildStoredPayload({ householdName: 'A', password: 'pw', sharedExpenseMethod: 'monthlyincome' }));
  saveRecord(db, buildStoredPayload({ householdName: 'B', password: 'pw' }));

  const all = readRecord(db);
  assert.equal(all.length, 2);
  assert.equal(all.find(h => h.householdName === 'A').data.sharedExpenseMethod, 'monthlyIncome');
  assert.equal(all.find(h => h.householdName === 'B').data.sharedExpenseMethod, 'equal');
});
