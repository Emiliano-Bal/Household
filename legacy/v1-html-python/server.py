#!/usr/bin/env python3
import json
import os
import sqlite3
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / 'data'
DB_FILE = DATA_DIR / 'households.db'


def setup_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS households (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_name TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            data TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


def normalize_tracker(tracker):
    """Validate a savings/credit-card tracker: a starting balance plus a
    list of dated entries ({id, amount, note, month, date}). Anything
    malformed is dropped rather than rejecting the whole save."""
    if not isinstance(tracker, dict):
        return {'startingBalance': 0, 'entries': []}

    try:
        starting_balance = float(tracker.get('startingBalance', 0) or 0)
    except (TypeError, ValueError):
        starting_balance = 0

    entries = []
    for entry in tracker.get('entries', []) if isinstance(tracker.get('entries'), list) else []:
        if not isinstance(entry, dict):
            continue
        try:
            amount = float(entry.get('amount', 0) or 0)
        except (TypeError, ValueError):
            continue
        if not amount:
            continue
        entries.append({
            'id': str(entry.get('id') or '').strip() or f'entry-{len(entries)}',
            'amount': amount,
            'note': str(entry.get('note') or '').strip(),
            'month': str(entry.get('month') or '').strip(),
            'date': str(entry.get('date') or '').strip()
        })

    return {'startingBalance': starting_balance, 'entries': entries}


def normalize_shared_expense_method(record):
    if not isinstance(record, dict):
        return record

    method = str(record.get('sharedExpenseMethod', 'equal') or 'equal').strip().lower()
    if method not in {'equal', 'yearlyincome', 'yearlyIncome', 'monthlyincome', 'monthlyIncome'}:
        method = 'equal'

    if method == 'yearlyincome':
        record['sharedExpenseMethod'] = 'yearlyIncome'
    elif method == 'monthlyincome':
        record['sharedExpenseMethod'] = 'monthlyIncome'
    else:
        record['sharedExpenseMethod'] = 'equal'

    def normalize_paid_by(item):
        if not isinstance(item, dict):
            return item
        if 'paidBy' not in item:
            payer = item.get('payer') or item.get('paidBy') or 'shared'
            item['paidBy'] = str(payer).strip() or 'shared'
        else:
            item['paidBy'] = str(item.get('paidBy') or 'shared').strip() or 'shared'
        if 'payer' not in item:
            item['payer'] = item['paidBy']
        else:
            item['payer'] = str(item.get('payer') or item.get('paidBy') or 'shared').strip() or 'shared'

        # splitPercent is the payer's custom share (1-99) of a shared expense;
        # anything outside that range is meaningless, so drop it to None and
        # let the household's default sharedExpenseMethod apply instead.
        raw_split = item.get('splitPercent')
        if raw_split in (None, ''):
            item['splitPercent'] = None
        else:
            try:
                percent = float(raw_split)
                item['splitPercent'] = percent if 0 < percent < 100 else None
            except (TypeError, ValueError):
                item['splitPercent'] = None

        return item

    if isinstance(record.get('fixedCosts'), list):
        record['fixedCosts'] = [normalize_paid_by(item) for item in record['fixedCosts']]
    if isinstance(record.get('budgets'), list):
        record['budgets'] = [normalize_paid_by(item) for item in record['budgets']]

    # Older records predate the savings/credit-card trackers, so backfill an
    # empty one rather than letting the UI see a missing field.
    record['savingsTracker'] = normalize_tracker(record.get('savingsTracker'))
    record['creditCardTracker'] = normalize_tracker(record.get('creditCardTracker'))

    return record


def read_record(conn, household_name=None, password=None):
    if household_name and password:
        row = conn.execute(
            'SELECT data FROM households WHERE household_name = ? AND password = ?',
            (household_name, password),
        ).fetchone()
        if row:
            record = json.loads(row[0])
            return normalize_shared_expense_method(record)
        return None

    if household_name:
        row = conn.execute(
            'SELECT data FROM households WHERE household_name = ?',
            (household_name,),
        ).fetchone()
        if row:
            record = json.loads(row[0])
            return normalize_shared_expense_method(record)
        return None

    rows = conn.execute('SELECT household_name, data FROM households ORDER BY id').fetchall()
    normalized = []
    for row in rows:
        record = json.loads(row[1])
        normalized.append({'householdName': row[0], 'data': normalize_shared_expense_method(record)})
    return normalized


def save_record(payload):
    conn = sqlite3.connect(DB_FILE)
    household_name = str(payload.get('householdName', '')).strip()
    password = str(payload.get('password', '')).strip()
    data_text = json.dumps(payload, ensure_ascii=False)

    if not household_name or not password:
        return None

    conn.execute('''
        INSERT INTO households(household_name, password, data)
        VALUES(?, ?, ?)
        ON CONFLICT(household_name)
        DO UPDATE SET password = excluded.password, data = excluded.data
    ''', (household_name, password, data_text))
    conn.commit()
    conn.close()
    return payload


class BudgetHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/households':
            try:
                query = parse_qs(parsed.query)
                household_name = (query.get('householdName', [''])[0] or '').strip()
                password = (query.get('password', [''])[0] or '').strip()
                conn = sqlite3.connect(DB_FILE)
                if household_name and password:
                    record = read_record(conn, household_name, password)
                    if record:
                        self.send_json(record)
                    else:
                        self.send_json({'error': 'household not found', 'householdName': household_name}, 404)
                elif household_name:
                    record = read_record(conn, household_name)
                    if record:
                        self.send_json(record)
                    else:
                        self.send_json({'error': 'household not found', 'householdName': household_name}, 404)
                else:
                    rows = read_record(conn)
                    self.send_json(rows)
                conn.close()
                return
            except Exception as exc:
                self.send_json({'error': str(exc)}, 500)
                return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/households':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                raw = self.rfile.read(length)
                payload = json.loads(raw.decode('utf-8')) if raw else {}
                if not isinstance(payload, dict):
                    self.send_json({'error': 'payload must be an object'}, 400)
                    return

                # normalize fields expected by the UI
                stored = {
                    'householdName': str(payload.get('householdName', '')).strip(),
                    'password': str(payload.get('password', '')).strip(),
                    'persons': payload.get('persons', []),
                    'fixedCosts': payload.get('fixedCosts', []),
                    'budgets': payload.get('budgets', []),
                    'savings': payload.get('savings', 0),
                    'sharedExpenseMethod': str(payload.get('sharedExpenseMethod', 'equal')).strip() or 'equal',
                    'currentMonth': payload.get('currentMonth'),
                    'savingsTracker': normalize_tracker(payload.get('savingsTracker')),
                    'creditCardTracker': normalize_tracker(payload.get('creditCardTracker'))
                }

                method = stored['sharedExpenseMethod'].lower()
                if method == 'yearlyincome':
                    stored['sharedExpenseMethod'] = 'yearlyIncome'
                elif method == 'monthlyincome':
                    stored['sharedExpenseMethod'] = 'monthlyIncome'
                else:
                    stored['sharedExpenseMethod'] = 'equal'

                if not stored['householdName'] or not stored['password']:
                    self.send_json({'error': 'household name and password are required'}, 400)
                    return

                saved = save_record(stored)
                if not saved:
                    self.send_json({'error': 'database write failed'}, 500)
                else:
                    self.send_json(saved)
                return
            except Exception as exc:
                self.send_json({'error': str(exc)}, 500)
                return

        self.send_json({'error': 'not found'}, 404)


def main():
    setup_database()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4040
    try:
        httpd = ThreadingHTTPServer(('127.0.0.1', port), BudgetHandler)
        print(f'Serving database API on http://127.0.0.1:{port}')
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down server')


if __name__ == '__main__':
    main()
