import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class SharedExpensePolicyPersistsTest(unittest.TestCase):
    def setUp(self):
        fd, self.db_path = tempfile.mkstemp(prefix='gastos_shared_policy_', suffix='.db')
        os.close(fd)
        server.DB_FILE = self.db_path
        server.setup_database()

    def tearDown(self):
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def test_save_record_persists_shared_expense_policy(self):
        payload = {
            'householdName': 'TestHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [],
            'budgets': [],
            'savings': 0,
            'sharedExpenseMethod': 'yearlyIncome'
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)
        self.assertEqual(saved.get('sharedExpenseMethod'), 'yearlyIncome')

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'TestHome', 'abcd')
        conn.close()

        self.assertEqual(record.get('sharedExpenseMethod'), 'yearlyIncome')

    def test_read_record_accepts_payer_alias_and_normalizes_paid_by(self):
        payload = {
            'householdName': 'PayByHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [
                {
                    'name': 'Rent',
                    'amount': 100,
                    'frequency': 'monthly',
                    'payMonth': '',
                    'owner': 'shared',
                    'payer': 'Avery'
                }
            ],
            'budgets': [],
            'savings': 0,
            'sharedExpenseMethod': 'equal'
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'PayByHome', 'abcd')
        conn.close()

        self.assertEqual(record['fixedCosts'][0]['paidBy'], 'Avery')
        self.assertEqual(record['fixedCosts'][0]['payer'], 'Avery')

    def test_read_record_defaults_missing_shared_expense_policy_to_equal(self):
        payload = {
            'householdName': 'LegacyHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [],
            'budgets': [],
            'savings': 0
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'LegacyHome', 'abcd')
        conn.close()

        self.assertEqual(record.get('sharedExpenseMethod'), 'equal')

    def test_read_record_keeps_valid_split_percent_on_shared_expense(self):
        payload = {
            'householdName': 'SplitHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [
                {
                    'name': 'Rent',
                    'amount': 1000,
                    'frequency': 'monthly',
                    'payMonth': '',
                    'owner': 'shared',
                    'paidBy': 'Avery',
                    'splitPercent': 65
                }
            ],
            'budgets': [],
            'savings': 0,
            'sharedExpenseMethod': 'equal'
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'SplitHome', 'abcd')
        conn.close()

        self.assertEqual(record['fixedCosts'][0]['splitPercent'], 65)

    def test_read_record_drops_out_of_range_split_percent(self):
        payload = {
            'householdName': 'BadSplitHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [],
            'budgets': [
                {
                    'name': 'Groceries',
                    'amount': 200,
                    'frequency': 'monthly',
                    'payMonth': '',
                    'owner': 'shared',
                    'paidBy': 'Morgan',
                    'splitPercent': 150
                }
            ],
            'savings': 0,
            'sharedExpenseMethod': 'equal'
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'BadSplitHome', 'abcd')
        conn.close()

        self.assertIsNone(record['budgets'][0]['splitPercent'])

    def test_read_record_persists_savings_and_credit_card_tracker_entries(self):
        payload = {
            'householdName': 'TrackerHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [],
            'budgets': [],
            'savings': 0,
            'sharedExpenseMethod': 'equal',
            'savingsTracker': {
                'startingBalance': 1000,
                'entries': [{'id': 'a1', 'amount': 200, 'note': 'Paycheck top-up', 'month': 'October 2026', 'date': '2026-10-05'}]
            },
            'creditCardTracker': {
                'startingBalance': 300,
                'entries': [{'id': 'c1', 'amount': -50, 'note': 'Paid down', 'month': 'October 2026', 'date': '2026-10-05'}]
            }
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'TrackerHome', 'abcd')
        conn.close()

        self.assertEqual(record['savingsTracker']['startingBalance'], 1000)
        self.assertEqual(record['savingsTracker']['entries'][0]['amount'], 200)
        self.assertEqual(record['creditCardTracker']['entries'][0]['amount'], -50)

    def test_read_record_backfills_missing_trackers_for_legacy_records(self):
        payload = {
            'householdName': 'LegacyTrackerHome',
            'password': 'abcd',
            'persons': [],
            'fixedCosts': [],
            'budgets': [],
            'savings': 0,
            'sharedExpenseMethod': 'equal'
        }

        saved = server.save_record(payload)
        self.assertIsNotNone(saved)

        conn = sqlite3.connect(self.db_path)
        record = server.read_record(conn, 'LegacyTrackerHome', 'abcd')
        conn.close()

        self.assertEqual(record['savingsTracker'], {'startingBalance': 0, 'entries': []})
        self.assertEqual(record['creditCardTracker'], {'startingBalance': 0, 'entries': []})

    def test_index_html_exposes_main_nav_for_dashboard_member_routes(self):
        index_path = Path(__file__).resolve().parents[1] / 'index.html'
        html = index_path.read_text()
        self.assertIn('<nav class="main-nav" id="mainNav">', html)

    def test_index_html_exposes_current_month_panel_for_dashboard(self):
        index_path = Path(__file__).resolve().parents[1] / 'index.html'
        html = index_path.read_text()
        self.assertIn('Current month', html)
        self.assertIn('id="currentMonthSection"', html)


if __name__ == '__main__':
    unittest.main()
