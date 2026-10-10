// Relative, not absolute: the backend (server.js) serves this page and the
// API from the same origin/port, so the browser always calls back wherever
// it actually loaded the page from. The old hardcoded "http://127.0.0.1:4041"
// silently broke every save/load whenever the server ran on a different
// port than that one — which, with no startup script pinning it, was most
// of the time.
export const API_URL = '/api/households';

// Savings and credit card debt are tracked per person (two people can have
// completely different balances/cards), so each person object carries its
// own tracker rather than the household having one shared pair.
export function emptyTracker() {
  return { startingBalance: 0, entries: [] };
}

export function defaultData() {
  return {
    householdName: '',
    password: '',
    persons: [],
    fixedCosts: [],
    budgets: [],
    savings: 0,
    sharedExpenseMethod: 'equal',
    currentMonth: {
      month: new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' }).trim(),
      income: 0,
      paid: 0,
      remaining: 0,
      history: []
    }
  };
}

export const emptyData = defaultData();

export async function loadData(householdName = '', password = '') {
  try {
    const params = new URLSearchParams();
    if (householdName) params.set('householdName', householdName);
    if (password) params.set('password', password);

    const url = params.toString() ? `${API_URL}?${params.toString()}` : API_URL;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) return defaultData();
    const record = await response.json();

    if (Array.isArray(record)) {
      return defaultData();
    }

    return { ...defaultData(), ...record };
  } catch (error) {
    return defaultData();
  }
}

export async function saveData(data) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      cache: 'no-store'
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to save household' }));
      return { valid: false, message: error.error || 'Unable to save household' };
    }

    const saved = await response.json();
    return { valid: true, data: saved };
  } catch (error) {
    return { valid: false, message: 'Unable to save household' };
  }
}
