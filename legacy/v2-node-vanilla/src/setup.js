import { loadData, saveData, emptyTracker } from './data.js';
import { money } from './utils.js';
import { openAuth, openSetup, openDashboard } from './screens.js';
import { renderDashboard } from './dashboard.js';

function wireFrequencyMonthVisibility(frequencySelector, monthSelector, monthLabel = null) {
  const refresh = () => {
    const showMonth = frequencySelector.value === 'yearly';
    monthSelector.style.display = showMonth ? '' : 'none';
    if (monthLabel) monthLabel.style.display = showMonth ? '' : 'none';
    monthSelector.disabled = !showMonth;
    monthSelector.required = showMonth;
  };

  frequencySelector.addEventListener('change', refresh);
  refresh();
}

// The split % only makes sense for a shared expense (owner === 'shared'); a
// personal expense always belongs 100% to its owner, so hide the field then.
function wireOwnerSplitVisibility(ownerSelector, splitField, splitInput) {
  const refresh = () => {
    const isShared = ownerSelector.value === 'shared';
    splitField.style.display = isShared ? '' : 'none';
    splitInput.disabled = !isShared;
    if (!isShared) splitInput.value = '';
  };

  ownerSelector.addEventListener('change', refresh);
  refresh();
}

export function showAuthError(message) {
  const authForm = document.querySelector('#authScreen .auth-form');
  let error = authForm.querySelector('.form-message');
  if (!error) {
    error = document.createElement('div');
    error.className = 'form-message';
    authForm.appendChild(error);
  }
  error.textContent = message;
}

export function showSetupError(message) {
  const setupError = document.getElementById('setupError') || addSetupError();
  setupError.textContent = message;
}

export function addSetupError() {
  const div = document.createElement('div');
  div.id = 'setupError';
  div.className = 'form-message setup-error';
  document.getElementById('setupForm').insertBefore(div, document.getElementById('setupForm').firstChild);
  return div;
}

function getOwnerOptions() {
  const names = Array.from(document.querySelectorAll('#peopleRows .person-name'))
    .map(input => input.value.trim())
    .filter(Boolean);

  const selected = ['shared'];
  return ['shared', ...names];
}

function createOwnerSelect(owner = 'shared', ownerClass = 'cost-owner') {
  const names = Array.from(document.querySelectorAll('#peopleRows .person-name'))
    .map(input => input.value.trim())
    .filter(Boolean);

  const options = ['shared', ...names]
    .map(name => `<option value="${name}" ${name === owner ? 'selected' : ''}>${name === 'shared' ? 'Shared' : name}</option>`)
    .join('');

  return `<select class="${ownerClass}" data-owner="${owner}">
    ${options}
  </select>`;
}

// Clamp a raw split-% input to a usable share for the person who paid; blank
// or out-of-range values mean "use the household's default split method".
function readSplitPercent(input) {
  if (!input || input.value === '') return null;
  const value = money(input.value);
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return null;
  return value;
}

function createPaidBySelect(paidBy = 'shared', paidByClass = 'cost-paidBy') {
  const names = Array.from(document.querySelectorAll('#peopleRows .person-name'))
    .map(input => input.value.trim())
    .filter(Boolean);

  const options = ['shared', ...names]
    .map(name => `<option value="${name}" ${name === paidBy ? 'selected' : ''}>${name === 'shared' ? 'Shared' : name}</option>`)
    .join('');

  return `<select class="${paidByClass}" data-paidBy="${paidBy}">
    ${options}
  </select>`;
}

export function clearSetupForm() {
  document.getElementById('setupForm').reset();
  document.getElementById('householdNameSetup').value = '';
  document.getElementById('passwordSetup').value = '';
  document.getElementById('personCount').value = 1;
  document.getElementById('peopleRows').innerHTML = '';
  document.getElementById('fixedCostsRows').innerHTML = '';
  document.getElementById('budgetRows').innerHTML = '';
  document.getElementById('savingsTarget').value = 0;
  document.getElementById('sharedExpenseMethod').value = 'equal';
  document.getElementById('householdNameSetup').disabled = false;

  if (document.getElementById('setupError')) {
    document.getElementById('setupError').remove();
  }
}

export function renderPeopleRows(count, people = []) {
  const peopleRows = document.getElementById('peopleRows');
  count = Math.max(1, Number(count) || 1);
  peopleRows.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'person-row';

    const person = people[i] || {};

    row.innerHTML = `
      <div class="person-grid">
        <div class="input-wrap">
          <label>Name</label>
          <input type="text" class="person-name" placeholder="Person ${i + 1} name" />
        </div>
        <div class="input-wrap">
          <label>Net base salary monthly</label>
          <input type="number" class="person-salary" min="0" placeholder="0" />
        </div>
        <div class="income-area">
          <div class="section-row small-row">
            <span class="section-label">Additional incomes</span>
            <button class="secondary-button compact-button add-income-button" type="button">+ Income</button>
          </div>
          <div class="income-list"></div>
        </div>
      </div>
    `;

    row.querySelector('.person-name').value = person.name || '';
    row.querySelector('.person-salary').value = person.salary || '';

    const incomeList = row.querySelector('.income-list');
    for (const income of Array.isArray(person.incomes) ? person.incomes : []) {
      const entry = document.createElement('div');
      entry.className = 'income-entry';
      entry.innerHTML = `
        <div class="income-entry-grid">
          <input type="text" class="income-name" placeholder="Income name" />
          <input type="number" class="income-amount" placeholder="Amount" />
          <select class="income-frequency">
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <select class="income-month">
            <option value="">Receive month</option>
            <option value="January">January</option>
            <option value="February">February</option>
            <option value="March">March</option>
            <option value="April">April</option>
            <option value="May">May</option>
            <option value="June">June</option>
            <option value="July">July</option>
            <option value="August">August</option>
            <option value="September">September</option>
            <option value="October">October</option>
            <option value="November">November</option>
            <option value="December">December</option>
          </select>
          <button type="button" class="remove-row">×</button>
        </div>
      `;

      const frequency = entry.querySelector('.income-frequency');
      const month = entry.querySelector('.income-month');
      entry.querySelector('.income-name').value = income.name || '';
      entry.querySelector('.income-amount').value = income.amount || 0;
      frequency.value = income.frequency || 'monthly';
      month.value = income.receiveMonth || '';
      wireFrequencyMonthVisibility(frequency, month);
      entry.querySelector('.remove-row').addEventListener('click', () => entry.remove());
      incomeList.appendChild(entry);
    }

    const addIncomeButton = row.querySelector('.add-income-button');
    addIncomeButton.addEventListener('click', () => {
      const list = row.querySelector('.income-list');
      const entry = document.createElement('div');
      entry.className = 'income-entry';
      entry.innerHTML = `
        <div class="income-entry-grid">
          <input type="text" class="income-name" placeholder="Income name" />
          <input type="number" class="income-amount" placeholder="Amount" />
          <select class="income-frequency">
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <select class="income-month">
            <option value="">Receive month</option>
            <option value="January">January</option>
            <option value="February">February</option>
            <option value="March">March</option>
            <option value="April">April</option>
            <option value="May">May</option>
            <option value="June">June</option>
            <option value="July">July</option>
            <option value="August">August</option>
            <option value="September">September</option>
            <option value="October">October</option>
            <option value="November">November</option>
            <option value="December">December</option>
          </select>
          <button type="button" class="remove-row">×</button>
        </div>
      `;
      const frequency = entry.querySelector('.income-frequency');
      const month = entry.querySelector('.income-month');
      wireFrequencyMonthVisibility(frequency, month);
      entry.querySelector('.remove-row').addEventListener('click', () => entry.remove());
      list.appendChild(entry);
    });

    peopleRows.appendChild(row);
  }
}

export function addFixedCostRow(cost = {}) {
  const fixedCostsRows = document.getElementById('fixedCostsRows');
  const row = document.createElement('div');
  row.className = 'fixed-cost-row';
  row.innerHTML = `
    <div class="cost-entry-grid">
      <div class="row-entry-field">
        <label class="row-field-label">Fixed cost</label>
        <input type="text" class="cost-name" placeholder="Fixed cost name" />
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Cost amount</label>
        <input type="number" class="cost-amount" placeholder="Cost amount" />
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Expense type</label>
        <select class="cost-frequency">
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>
      <div class="row-entry-field month-field">
        <label class="row-field-label month-label">Pay month</label>
        <select class="cost-month">
          <option value="">Pay month</option>
          <option value="January">January</option>
          <option value="February">February</option>
          <option value="March">March</option>
          <option value="April">April</option>
          <option value="May">May</option>
          <option value="June">June</option>
          <option value="July">July</option>
          <option value="August">August</option>
          <option value="September">September</option>
          <option value="October">October</option>
          <option value="November">November</option>
          <option value="December">December</option>
        </select>
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Expense owner</label>
        <span class="cost-owner-wrap"></span>
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Paid by</label>
        <span class="cost-paidBy-wrap"></span>
      </div>
      <div class="row-entry-field split-percent-field">
        <label class="row-field-label">Split %</label>
        <input type="number" class="cost-splitPercent" min="1" max="99" placeholder="Auto" />
      </div>
      <button type="button" class="remove-row cost-remove">×</button>
    </div>
  `;

  const ownerWrap = row.querySelector('.cost-owner-wrap');
  ownerWrap.innerHTML = createOwnerSelect(cost.owner || 'shared', 'cost-owner');
  const ownerSelect = row.querySelector('.cost-owner');
  ownerSelect.value = cost.owner || 'shared';

  const paidByWrap = row.querySelector('.cost-paidBy-wrap');
  paidByWrap.innerHTML = createPaidBySelect(cost.paidBy || cost.payer || 'shared', 'cost-paidBy');
  const paidBySelect = row.querySelector('.cost-paidBy');
  paidBySelect.value = cost.paidBy || cost.payer || 'shared';

  row.querySelector('.cost-name').value = cost.name || '';
  row.querySelector('.cost-amount').value = cost.amount || '';
  row.querySelector('.cost-frequency').value = cost.frequency || 'monthly';
  row.querySelector('.cost-month').value = cost.payMonth || '';
  row.querySelector('.cost-splitPercent').value = cost.splitPercent || '';

  wireFrequencyMonthVisibility(
    row.querySelector('.cost-frequency'),
    row.querySelector('.cost-month'),
    row.querySelector('.cost-entry-grid .month-label')
  );
  wireOwnerSplitVisibility(
    ownerSelect,
    row.querySelector('.split-percent-field'),
    row.querySelector('.cost-splitPercent')
  );
  row.querySelector('.cost-remove').addEventListener('click', () => row.remove());
  fixedCostsRows.appendChild(row);
}

export function addBudgetRow(budget = {}) {
  const budgetRows = document.getElementById('budgetRows');
  const row = document.createElement('div');
  row.className = 'budget-row';
  row.innerHTML = `
    <div class="budget-entry-grid">
      <div class="row-entry-field">
        <label class="row-field-label">Budget item</label>
        <input type="text" class="budget-name" placeholder="Budget name" />
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Budget amount</label>
        <input type="number" class="budget-amount" placeholder="Budget amount" />
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Expense type</label>
        <select class="budget-frequency">
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>
      <div class="row-entry-field month-field">
        <label class="row-field-label month-label">Pay month</label>
        <select class="budget-month">
          <option value="">Pay month</option>
          <option value="January">January</option>
          <option value="February">February</option>
          <option value="March">March</option>
          <option value="April">April</option>
          <option value="May">May</option>
          <option value="June">June</option>
          <option value="July">July</option>
          <option value="August">August</option>
          <option value="September">September</option>
          <option value="October">October</option>
          <option value="November">November</option>
          <option value="December">December</option>
        </select>
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Expense owner</label>
        <span class="budget-owner-wrap"></span>
      </div>
      <div class="row-entry-field">
        <label class="row-field-label">Paid by</label>
        <span class="budget-paidBy-wrap"></span>
      </div>
      <div class="row-entry-field split-percent-field">
        <label class="row-field-label">Split %</label>
        <input type="number" class="budget-splitPercent" min="1" max="99" placeholder="Auto" />
      </div>
      <button type="button" class="remove-row budget-remove">×</button>
    </div>
  `;

  const ownerWrap = row.querySelector('.budget-owner-wrap');
  ownerWrap.innerHTML = createOwnerSelect(budget.owner || 'shared', 'budget-owner');
  const ownerSelect = row.querySelector('.budget-owner');
  ownerSelect.value = budget.owner || 'shared';

  const paidByWrap = row.querySelector('.budget-paidBy-wrap');
  paidByWrap.innerHTML = createPaidBySelect(budget.paidBy || budget.payer || 'shared', 'budget-paidBy');
  const paidBySelect = row.querySelector('.budget-paidBy');
  paidBySelect.value = budget.paidBy || budget.payer || 'shared';

  row.querySelector('.budget-name').value = budget.name || '';
  row.querySelector('.budget-amount').value = budget.amount || '';
  row.querySelector('.budget-frequency').value = budget.frequency || 'monthly';
  row.querySelector('.budget-month').value = budget.payMonth || '';
  row.querySelector('.budget-splitPercent').value = budget.splitPercent || '';

  wireFrequencyMonthVisibility(
    row.querySelector('.budget-frequency'),
    row.querySelector('.budget-month'),
    row.querySelector('.budget-entry-grid .month-label')
  );
  wireOwnerSplitVisibility(
    ownerSelect,
    row.querySelector('.split-percent-field'),
    row.querySelector('.budget-splitPercent')
  );
  row.querySelector('.budget-remove').addEventListener('click', () => row.remove());
  budgetRows.appendChild(row);
}

export function loadHouseholdIntoSetup(data) {
  clearSetupForm();

  if (!data) return;

  document.getElementById('householdNameSetup').value = data.householdName || '';
  document.getElementById('passwordSetup').value = data.password || '';
  document.getElementById('personCount').value = Math.max(1, Array.isArray(data.persons) ? data.persons.length : 1);
  document.getElementById('savingsTarget').value = data.savings || 0;
  document.getElementById('sharedExpenseMethod').value = data.sharedExpenseMethod || 'equal';
  document.getElementById('householdNameSetup').disabled = true;

  renderPeopleRows(data.persons.length || 1, Array.isArray(data.persons) ? data.persons : []);

  for (const cost of Array.isArray(data.fixedCosts) ? data.fixedCosts : []) {
    addFixedCostRow(cost);
  }

  for (const item of Array.isArray(data.budgets) ? data.budgets : []) {
    addBudgetRow(item);
  }
}

export function buildHouseholdFromSetup() {
  const householdName = document.getElementById('householdNameSetup').value.trim();
  const password = document.getElementById('passwordSetup').value.trim();
  const sharedExpenseMethod = document.getElementById('sharedExpenseMethod').value || 'equal';
  const personCount = Math.max(1, Math.round(money(document.getElementById('personCount').value)));

  if (!householdName || !password) {
    return { valid: false, message: 'Household name and password are required.' };
  }

  if (password.length < 4) {
    return { valid: false, message: 'Password must be at least 4 characters.' };
  }

  const personRows = Array.from(document.querySelectorAll('#peopleRows .person-row'));
  if (personRows.length < personCount) {
    return { valid: false, message: 'Please add every person.' };
  }

  // The setup form only edits name/salary/incomes — it has no fields for a
  // person's savings/credit-card tracker. Carry those forward from whatever
  // household is currently loaded (matched by name) so re-saving the setup
  // form can't silently wipe out that history; a brand-new person starts
  // with empty trackers.
  const existingPersons = (globalThis.app && globalThis.app.currentData && Array.isArray(globalThis.app.currentData.persons))
    ? globalThis.app.currentData.persons
    : [];

  const persons = [];
  for (const row of personRows) {
    const name = row.querySelector('.person-name').value.trim();
    const salary = money(row.querySelector('.person-salary').value);

    if (!name || salary <= 0) {
      return { valid: false, message: 'Each person needs a name and a monthly salary.' };
    }

    const incomes = Array.from(row.querySelectorAll('.income-entry')).map(entry => {
      const frequency = entry.querySelector('.income-frequency').value;
      return {
        name: entry.querySelector('.income-name').value.trim(),
        amount: money(entry.querySelector('.income-amount').value),
        frequency,
        receiveMonth: frequency === 'yearly' ? entry.querySelector('.income-month').value : ''
      };
    });

    const existing = existingPersons.find(person => person.name && person.name.trim().toLowerCase() === name.toLowerCase());

    persons.push({
      name,
      salary,
      incomes: incomes.filter(item => item.name && item.amount > 0),
      savingsTracker: (existing && existing.savingsTracker) || emptyTracker(),
      creditCardTracker: (existing && existing.creditCardTracker) || emptyTracker()
    });
  }

  const fixedCostRows = Array.from(document.querySelectorAll('#fixedCostsRows .fixed-cost-row'));
  const fixedCosts = fixedCostRows.map(row => {
    const name = row.querySelector('.cost-name').value.trim();
    const amount = money(row.querySelector('.cost-amount').value);
    const frequency = row.querySelector('.cost-frequency').value;
    const payMonth = frequency === 'yearly' ? row.querySelector('.cost-month').value : '';
    const owner = row.querySelector('.cost-owner') ? row.querySelector('.cost-owner').value : 'shared';
    const paidBy = row.querySelector('.cost-paidBy') ? row.querySelector('.cost-paidBy').value : 'shared';
    const splitPercent = owner === 'shared' ? readSplitPercent(row.querySelector('.cost-splitPercent')) : null;

    if (!name || amount <= 0) return null;

    return { name, amount, frequency, payMonth, owner, paidBy, splitPercent };
  }).filter(Boolean);

  const budgetRows = Array.from(document.querySelectorAll('#budgetRows .budget-row'));
  const budgets = budgetRows.map(row => {
    const name = row.querySelector('.budget-name').value.trim();
    const amount = money(row.querySelector('.budget-amount').value);
    const frequency = row.querySelector('.budget-frequency').value;
    const payMonth = frequency === 'yearly' ? row.querySelector('.budget-month').value : '';
    const owner = row.querySelector('.budget-owner') ? row.querySelector('.budget-owner').value : 'shared';
    const paidBy = row.querySelector('.budget-paidBy') ? row.querySelector('.budget-paidBy').value : 'shared';
    const splitPercent = owner === 'shared' ? readSplitPercent(row.querySelector('.budget-splitPercent')) : null;

    if (!name || amount <= 0) return null;

    return { name, amount, frequency, payMonth, owner, paidBy, splitPercent };
  }).filter(Boolean);

  const savings = money(document.getElementById('savingsTarget').value);

  return {
    valid: true,
    householdName,
    password,
    persons,
    fixedCosts,
    budgets,
    savings,
    sharedExpenseMethod
  };
}

export function setupFormEvents() {
  const setupForm = document.getElementById('setupForm');
  const addPersonButton = document.getElementById('addPersonButton');
  const addBudgetButton = document.getElementById('addBudgetButton');
  const addFixedCostButton = document.getElementById('addFixedCostButton');
  const personCount = document.getElementById('personCount');
  const editHouseholdButton = document.getElementById('editHouseholdButton');

  document.getElementById('createHouseholdButton').addEventListener('click', () => {
    if (globalThis.app) globalThis.app.setupOrigin = 'auth';
    clearSetupForm();
    openSetup();
  });

  if (editHouseholdButton) {
    editHouseholdButton.addEventListener('click', () => {
      const current = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : null;
      if (current && current.householdName) {
        if (globalThis.app) globalThis.app.setupOrigin = 'dashboard';
        clearSetupForm();
        loadHouseholdIntoSetup(current);
        openSetup();
      }
    });
  }

  document.getElementById('backToSignIn').addEventListener('click', () => {
    const app = globalThis.app;
    const current = app && app.currentData ? app.currentData : null;
    const cameFromDashboard = app && app.setupOrigin === 'dashboard' && current && current.householdName;

    if (cameFromDashboard) {
      renderDashboard(current);
      openDashboard();
      return;
    }

    openAuth();
  });

  document.getElementById('signInButton').addEventListener('click', async () => {
    const userName = document.getElementById('authHouseholdName').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const existing = await loadData(userName, password);

    if (!existing || !existing.householdName || !existing.password) {
      showAuthError('No household found. Create your household first.');
      return;
    }

    if (existing.householdName.toLowerCase() !== userName.toLowerCase() || existing.password !== password) {
      showAuthError('Household name or password is incorrect.');
      return;
    }

    globalThis.app.currentData = existing;
    globalThis.app.currentMember = '';
    renderDashboard(existing);
    openDashboard();
  });

  addPersonButton.addEventListener('click', () => {
    const count = Math.max(1, Math.round(money(personCount.value || 1)));
    personCount.value = count + 1;
    renderPeopleRows(count + 1);
  });

  personCount.addEventListener('change', () => {
    const count = Math.max(1, Math.round(money(personCount.value)));
    personCount.value = count;
    renderPeopleRows(count);
  });

  addFixedCostButton.addEventListener('click', () => {
    addFixedCostRow();
  });

  addBudgetButton.addEventListener('click', () => {
    addBudgetRow();
  });

  setupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const setup = buildHouseholdFromSetup();
    if (!setup.valid) {
      showSetupError(setup.message);
      return;
    }

    const household = {
      householdName: setup.householdName,
      password: setup.password,
      persons: setup.persons,
      fixedCosts: setup.fixedCosts,
      budgets: setup.budgets,
      savings: setup.savings,
      sharedExpenseMethod: setup.sharedExpenseMethod
    };

    const saved = await saveData(household);
    if (!saved.valid) {
      showSetupError(saved.message);
      return;
    }

    const savedHousehold = saved.data || household;
    globalThis.app.currentData = savedHousehold;
    globalThis.app.currentMember = '';
    renderDashboard(savedHousehold);
    openDashboard();
  });
}
