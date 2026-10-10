import { defaultData, loadData, saveData } from './data.js';
import { money, formatMoney, escapeHtml } from './utils.js';
import { openSetup } from './screens.js';

// Which ledger row categories show under each bottom tab (see VIEW_TITLES
// for the matching panel heading).
const VIEW_CATEGORIES = {
  income: ['salary', 'income'],
  expenses: ['expense', 'settlement'],
  budgets: ['budget'],
  savings: ['savings']
};

const VIEW_TITLES = {
  income: 'Monthly income',
  expenses: 'Fixed expenses',
  budgets: 'Budgets',
  savings: 'Savings'
};

function monthKey() {
  const now = new Date();
  return `${now.toLocaleString(undefined, { month: 'long' }).trim()} ${now.getFullYear()}`;
}

function monthIncomeForHousehold(data) {
  const persons = Array.isArray(data.persons) ? data.persons : [];
  return persons.reduce((sum, person) => sum + monthIncomeForPerson(person), 0);
}

function currentMonthObject(data) {
  const existing = data && data.currentMonth ? data.currentMonth : null;
  const current = monthKey();
  const income = monthIncomeForHousehold(data);

  if (!existing || !existing.month || existing.month !== current) {
    const history = Array.isArray(existing && existing.history) ? existing.history : [];
    const last = existing && existing.month
      ? { month: existing.month, income: Number(existing.income || 0), paid: Number(existing.paid || 0), remaining: Number(existing.remaining || 0) }
      : null;

    if (last) {
      history.push(last);
    }

    data.currentMonth = {
      month: current,
      income,
      paid: 0,
      remaining: income,
      history
    };
  } else {
    const paid = Array.isArray(data.fixedCosts)
      ? data.fixedCosts.reduce((sum, cost) => sum + (cost && cost.paid ? monthlyEquivalent(cost) : 0), 0)
      : 0;
    const remaining = Math.max(0, income - paid);
    data.currentMonth.income = income;
    data.currentMonth.paid = paid;
    data.currentMonth.remaining = remaining;
  }

  return data.currentMonth;
}

// A tracker (savings or credit card debt) is a starting balance plus an
// append-only list of signed monthly entries. The balance is always the
// starting figure plus every logged entry — nothing is stored pre-summed,
// so correcting or deleting an entry can't leave the running total stale.
function trackerLedger(tracker) {
  const startingBalance = Number(tracker && tracker.startingBalance) || 0;
  const entries = Array.isArray(tracker && tracker.entries) ? tracker.entries : [];
  let running = startingBalance;
  const ledger = entries.map(entry => {
    running += Number(entry.amount) || 0;
    return { ...entry, runningBalance: running };
  });
  return { balance: running, ledger: ledger.slice().reverse() };
}

function renderTrackerPanel(tracker, elements) {
  if (!elements.balanceEl) return;
  const safeTracker = tracker && typeof tracker === 'object' ? tracker : { startingBalance: 0, entries: [] };
  const { balance, ledger } = trackerLedger(safeTracker);

  elements.balanceEl.textContent = formatMoney(balance);
  if (elements.startingInput) elements.startingInput.value = safeTracker.startingBalance || 0;

  if (elements.changeEl) {
    const thisMonth = monthKey();
    const monthTotal = (safeTracker.entries || [])
      .filter(entry => entry.month === thisMonth)
      .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

    if (monthTotal) {
      elements.changeEl.textContent = `${monthTotal > 0 ? '+' : ''}${formatMoney(monthTotal)} this month`;
      elements.changeEl.className = `tracker-sub ${monthTotal > 0 ? 'positive' : 'negative'}`;
    } else {
      elements.changeEl.textContent = 'No activity logged this month yet';
      elements.changeEl.className = 'tracker-sub';
    }
  }

  if (elements.listEl) {
    elements.listEl.innerHTML = ledger.length
      ? ledger.map(entry => `
          <div class="tracker-entry-row">
            <div class="tracker-entry-main">
              <span class="tracker-entry-note">${escapeHtml(entry.note || entry.month || 'Entry')}</span>
              <span class="tracker-entry-month">${escapeHtml(entry.month || '')}</span>
            </div>
            <span class="tracker-entry-amount ${entry.amount >= 0 ? 'positive' : 'negative'}">${entry.amount >= 0 ? '+' : ''}${formatMoney(entry.amount)}</span>
            <span class="tracker-entry-balance">${formatMoney(entry.runningBalance)}</span>
            <button class="tracker-entry-remove" type="button" data-remove-entry="${escapeHtml(entry.id)}">&times;</button>
          </div>
        `).join('')
      : `<div class="tracker-entry-empty">No entries yet — log your first update above.</div>`;
  }
}

// Builds the markup for one savings OR one credit-card panel for one
// person. kind picks which: it controls the labels, which <select> option
// counts as "subtract from the balance", and the red/green balance color.
function personTrackerPanelHtml(person, kind) {
  const isSavings = kind === 'savings';
  const eyebrow = isSavings ? 'Net worth' : 'Liabilities';
  const title = isSavings ? 'Savings balance' : 'Credit card debt';
  const negativeDirection = isSavings ? 'withdrawal' : 'payment';
  const directionOptions = isSavings
    ? '<option value="deposit">Saved (add)</option><option value="withdrawal">Withdrew (remove)</option>'
    : '<option value="charge">Balance went up</option><option value="payment">Paid it down</option>';
  const balanceClass = isSavings ? 'tracker-balance' : 'tracker-balance tracker-balance-debt';

  return `
    <section class="panel small-panel tracker-panel" data-tracker-panel="${kind}" data-person="${escapeHtml(person.name)}">
      <div class="panel-head compact-panel-head">
        <div>
          <span class="section-label small-label">${escapeHtml(person.name)} &middot; ${eyebrow}</span>
          <h3>${title}</h3>
        </div>
      </div>
      <div class="${balanceClass}" data-role="balance">$0.00</div>
      <div class="tracker-sub" data-role="change">No activity logged this month yet</div>

      <div class="tracker-starting-row">
        <label>Current total (set once, adjust anytime)</label>
        <div class="tracker-starting-controls">
          <input type="number" data-role="starting-input" placeholder="0" />
          <button class="secondary-button compact-button" type="button" data-action="save-starting">Save</button>
        </div>
      </div>

      <div class="tracker-form">
        <input type="number" data-role="amount-input" placeholder="Amount" min="0" />
        <select data-role="direction-select">${directionOptions}</select>
        <input type="text" data-role="note-input" placeholder="Note (optional)" />
        <button class="secondary-button compact-button" type="button" data-action="add-entry" data-negative="${negativeDirection}">+ Log</button>
      </div>

      <div class="tracker-list" data-role="entry-list"></div>
    </section>
  `;
}

// Savings and credit card debt belong to a person, not the household — two
// members can have completely different balances and cards. This renders
// one savings panel and one credit-card panel per person into
// #personTrackers (see wirePersonTrackers for how their buttons are wired,
// once, via delegation on that same container).
function renderPersonTrackers(data) {
  const container = document.getElementById('personTrackers');
  if (!container) return;

  const persons = Array.isArray(data.persons) ? data.persons : [];
  if (!persons.length) {
    container.innerHTML = `<div class="tracker-entry-empty">Add people in Household setup to track their savings and credit card debt.</div>`;
    return;
  }

  container.innerHTML = persons
    .map(person => personTrackerPanelHtml(person, 'savings') + personTrackerPanelHtml(person, 'creditCard'))
    .join('');

  container.querySelectorAll('[data-tracker-panel]').forEach(panel => {
    const personName = panel.getAttribute('data-person');
    const kind = panel.getAttribute('data-tracker-panel');
    const person = persons.find(entry => entry.name === personName);
    const trackerKey = kind === 'savings' ? 'savingsTracker' : 'creditCardTracker';
    const tracker = (person && person[trackerKey]) || { startingBalance: 0, entries: [] };

    renderTrackerPanel(tracker, {
      balanceEl: panel.querySelector('[data-role="balance"]'),
      changeEl: panel.querySelector('[data-role="change"]'),
      startingInput: panel.querySelector('[data-role="starting-input"]'),
      listEl: panel.querySelector('[data-role="entry-list"]')
    });
  });
}

// Repopulates a member-picker <select> (Owner / Paid by on the dashboard's
// "Add to your budget" form) with the household's real people instead of
// the old hardcoded Avery/Morgan placeholders, while preserving whatever
// value was already selected if it's still valid.
function populateMemberSelect(select, persons) {
  if (!select) return;
  const previousValue = select.value;
  const names = persons.map(person => person.name).filter(Boolean);
  const values = ['shared', ...names];

  select.innerHTML = values
    .map(value => `<option value="${escapeHtml(value)}">${value === 'shared' ? 'Shared' : escapeHtml(value)}</option>`)
    .join('');

  select.value = values.includes(previousValue) ? previousValue : 'shared';
}

export function renderDashboard(data) {
  currentMonthObject(data);

  const householdTitle = document.getElementById('householdTitle');
  const householdNameDisplay = document.getElementById('householdNameDisplay');
  const householdMembers = document.getElementById('householdMembers');
  const mainNav = document.getElementById('mainNav');

  householdTitle.textContent = data.householdName || 'Budget Planner';
  householdNameDisplay.textContent = data.householdName || 'Family Budget';

  const persons = Array.isArray(data.persons) ? data.persons : [];
  const totalPersonCount = persons.length || 1;
  const personNames = persons.map(person => person.name);
  const shares = calculateSharedExpenseShares(data);
  let selectedMember = (globalThis.app && globalThis.app.currentMember) || '';

  if (selectedMember && !persons.some(person => person.name && person.name.toLowerCase() === selectedMember.toLowerCase())) {
    selectedMember = '';
    if (globalThis.app) globalThis.app.currentMember = '';
  }

  mainNav.innerHTML = `<a class="nav-link ${!selectedMember ? 'active' : ''}" href="#" data-nav="dashboard">Dashboard</a>` +
    (data.persons || []).map(person => {
      const active = person.name.toLowerCase() === selectedMember.toLowerCase();
      return `<a class="nav-link ${active ? 'active' : ''}" href="#" data-nav="member" data-member="${escapeHtml(person.name)}">${escapeHtml(person.name)}</a>`;
    }).join('');

  mainNav.onclick = event => {
    const target = event.target.closest('[data-nav]');
    if (!target) return;
    event.preventDefault();
    if (target.getAttribute('data-nav') === 'dashboard') {
      if (globalThis.app) globalThis.app.currentMember = '';
      renderDashboard(data);
      return;
    }
    if (target.getAttribute('data-nav') === 'member') {
      if (globalThis.app) globalThis.app.currentMember = target.getAttribute('data-member');
      renderDashboard(data);
    }
  };

  householdMembers.innerHTML = personNames.length ? data.persons.map((person, index) => {
    const share = shares[index] || Math.round(100 / totalPersonCount);
    const isActive = selectedMember && person.name.toLowerCase() === selectedMember.toLowerCase();
    return `<div class="member-row ${isActive ? 'member-row-active' : ''}" data-member="${escapeHtml(person.name)}">
      <span class="member-name">${escapeHtml(person.name)}</span>
      <span class="member-share">${Math.round(share)}%</span>
    </div>`;
  }).join('') : `<div class="member-row"><span class='member-name'>No people</span></div>`;

  householdMembers.onclick = event => {
    const member = event.target.closest('[data-member]');
    if (!member) return;
    const personName = member.getAttribute('data-member');
    if (!personName) return;
    if (globalThis.app) globalThis.app.currentMember = personName;
    renderDashboard(data);
  };

  const totals = calculateTotals(data, selectedMember);
  const ledger = calculateCurrentMonthLedger(data);

  if (document.getElementById('currentMonthIncome')) {
    document.getElementById('currentMonthIncome').textContent = formatMoney(ledger.income);
  }
  if (document.getElementById('currentMonthPaid')) {
    document.getElementById('currentMonthPaid').textContent = formatMoney(ledger.paid);
  }
  if (document.getElementById('currentMonthLeft')) {
    document.getElementById('currentMonthLeft').textContent = formatMoney(ledger.remaining);
  }
  if (document.getElementById('currentMonthRemaining')) {
    document.getElementById('currentMonthRemaining').textContent = formatMoney(ledger.remaining);
  }

  const currentIncomeList = document.getElementById('currentMonthIncomeList');
  const currentExpenseList = document.getElementById('currentMonthExpenseList');

  if (currentIncomeList) {
    const incomeRows = Array.isArray(data.persons)
      ? data.persons.map(person => {
          const salary = money(person.salary);
          return `<div class="current-month-list-row">
            <span class="current-month-list-label">${escapeHtml(person.name)} month fixed income</span>
            <span class="current-month-list-value">${formatMoney(salary)}</span>
          </div>`;
        }).join('')
      : `<div class="current-month-list-row"><span class="current-month-list-label">No incomes yet</span></div>`;

    currentIncomeList.innerHTML = incomeRows;
  }

  if (currentExpenseList) {
    const expenseRows = Array.isArray(data.fixedCosts) && data.fixedCosts.length
      ? data.fixedCosts.map(cost => {
          const amount = monthlyEquivalent(cost);
          const paid = Boolean(cost.paid);
          return `<div class="current-month-list-row">
            <span class="current-month-list-label">${escapeHtml(cost.name)}</span>
            <span class="current-month-list-value">${formatMoney(amount)}</span>
            <button class="current-month-action-button" data-paid-cost="${escapeHtml(cost.name)}">${paid ? 'Paid' : 'Mark paid'}</button>
          </div>`;
        }).join('')
      : `<div class="current-month-list-row">
          <span class="current-month-list-label">No fixed costs yet</span>
          <button class="current-month-action-button" data-add-fixed>+ Add</button>
        </div>`;

    currentExpenseList.innerHTML = expenseRows;
  }

  renderPersonTrackers(data);

  populateMemberSelect(document.getElementById('incomeOwner'), persons);
  populateMemberSelect(document.getElementById('expenseOwner'), persons);
  populateMemberSelect(document.getElementById('expensePaidBy'), persons);

  document.getElementById('incomeTotal').textContent = formatMoney(totals.income);
  document.getElementById('expensesTotal').textContent = formatMoney(totals.fixed);
  document.getElementById('budgetTotal').textContent = formatMoney(totals.budgets);
  document.getElementById('availableTotal').textContent = formatMoney(totals.available);

  document.getElementById('totalIncomeLabel').textContent = formatMoney(totals.income);
  document.getElementById('savingsTargetLabel').textContent = formatMoney(data.savings || 0);
  document.getElementById('availableAfterLabel').textContent = formatMoney(totals.available);

  document.getElementById('incomeBar').style.width = `${Math.min(100, Math.max(3, totals.income ? (totals.income / Math.max(totals.income, totals.fixed, totals.budgets, data.savings || 1, 1)) * 100 : 0))}%`;
  document.getElementById('expenseBar').style.width = `${Math.min(100, Math.max(3, totals.fixed ? (totals.fixed / Math.max(totals.income, totals.fixed, totals.budgets, data.savings || 1, 1)) * 100 : 0))}%`;
  document.getElementById('budgetBar').style.width = `${Math.min(100, Math.max(3, totals.budgets ? (totals.budgets / Math.max(totals.income, totals.fixed, totals.budgets, data.savings || 1, 1)) * 100 : 0))}%`;
  document.getElementById('savingsBar').style.width = `${Math.min(100, Math.max(3, (data.savings || 0) ? ((data.savings || 0) / Math.max(totals.income, totals.fixed, totals.budgets, data.savings || 1, 1)) * 100 : 0))}%`;

  document.getElementById('incomeBarValue').textContent = formatMoney(totals.income);
  document.getElementById('expenseBarValue').textContent = formatMoney(totals.fixed);
  document.getElementById('budgetBarValue').textContent = formatMoney(totals.budgets);
  document.getElementById('savingsBarValue').textContent = formatMoney(data.savings || 0);

  document.getElementById('savingsProgress').style.width = `${Math.min(100, ((data.savings || 0) / Math.max(totals.income, 1)) * 100)}%`;
  document.getElementById('budgetProgress').style.width = `${Math.min(100, totals.budgets ? (totals.budgets / Math.max(totals.income, 1)) * 100 : 0)}%`;
  document.getElementById('expenseProgress').style.width = `${Math.min(100, totals.fixed ? (totals.fixed / Math.max(totals.income, 1)) * 100 : 0)}%`;

  document.getElementById('savingsPercent').textContent = `${Math.round((data.savings || 0) / Math.max(totals.income, 1) * 100)}%`;
  document.getElementById('budgetUsed').textContent = `${Math.round((totals.budgets / Math.max(totals.income, 1)) * 100)}%`;
  document.getElementById('expenseRatio').textContent = `${Math.round((totals.fixed / Math.max(totals.income, 1)) * 100)}%`;

  const currentMonthIncome = document.getElementById('currentMonthIncome');
  const currentMonthPaid = document.getElementById('currentMonthPaid');
  const currentMonthLeft = document.getElementById('currentMonthLeft');
  const currentMonthRemaining = document.getElementById('currentMonthRemaining');
  if (currentMonthIncome) currentMonthIncome.textContent = formatMoney(ledger.income);
  if (currentMonthPaid) currentMonthPaid.textContent = formatMoney(ledger.paid);
  if (currentMonthLeft) currentMonthLeft.textContent = formatMoney(ledger.remaining);
  if (currentMonthRemaining) currentMonthRemaining.textContent = formatMoney(ledger.remaining);

  const fixedRows = data.fixedCosts.map(cost => {
    const paid = Boolean(cost.paid);
    return `<div class="category-row">
      <span class="category-label">${escapeHtml(cost.name)}</span>
      <span class="category-amount">${formatMoney(cost.frequency === 'yearly' ? cost.amount / 12 : cost.amount)}</span>
      <span class="category-owner">${escapeHtml(cost.owner || 'Shared')}</span>
      <span class="category-paidBy">${escapeHtml(cost.paidBy || cost.payer || 'Shared')}</span>
      <span class="category-paidToggle"><button class="paid-toggle ${paid ? 'is-paid' : ''}" data-paid-row="${escapeHtml(cost.name)}">${paid ? 'Paid' : 'Mark paid'}</button></span>
      ${owedSummaryHtml(data, cost)}
    </div>`;
  }).join('');

  const budgetRows = data.budgets.map(item => {
    return `<div class="category-row">
      <span class="category-label">${escapeHtml(item.name)}</span>
      <span class="category-amount">${formatMoney(item.frequency === 'yearly' ? item.amount / 12 : item.amount)}</span>
      <span class="category-owner">${escapeHtml(item.owner || 'Shared')}</span>
      <span class="category-paidBy">${escapeHtml(item.paidBy || item.payer || 'Shared')}</span>
      ${owedSummaryHtml(data, item)}
    </div>`;
  }).join('');

  document.getElementById('expenseList').innerHTML = fixedRows || `<div class='category-row'><span class='category-label'>No fixed costs</span></div>`;
  document.getElementById('budgetList').innerHTML = budgetRows || `<div class='category-row'><span class='category-label'>No budgets</span></div>`;

  const rows = [];
  for (const person of data.persons) {
    if (!selectedMember || person.name.toLowerCase() === selectedMember.toLowerCase()) {
      rows.push({
        item: `${person.name} base salary`,
        type: 'Salary',
        owner: person.name,
        paidBy: person.name,
        amount: person.salary,
        date: 'Monthly',
        status: 'Salary',
        sign: '+',
        category: 'salary'
      });

      for (const income of person.incomes) {
        const incomeMonth = (income.receiveMonth || '').trim().toLowerCase();
        const currentMonth = new Date().toLocaleString(undefined, { month: 'long' }).trim().toLowerCase();
        const monthlyAmount = income.frequency === 'yearly'
          ? (incomeMonth === currentMonth ? money(income.amount) : 0)
          : money(income.amount);

        if (income.frequency === 'yearly' && incomeMonth !== currentMonth) {
          continue;
        }

        rows.push({
          item: income.name,
          type: 'Income',
          owner: person.name,
          paidBy: person.name,
          amount: monthlyAmount,
          date: income.frequency === 'yearly' ? `${income.receiveMonth || 'Month'} yearly` : 'Monthly',
          status: 'Income',
          sign: '+',
          category: 'income'
        });
      }
    }
  }

  for (const fixed of data.fixedCosts) {
    const monthlyAmount = fixed.frequency === 'yearly' ? fixed.amount / 12 : fixed.amount;
    const fixedOwner = (fixed.owner || 'Shared').toString().trim().toLowerCase();
    const fixedPaidBy = (fixed.paidBy || fixed.payer || 'Shared').toString().trim().toLowerCase();
    const visible = !selectedMember || fixedOwner === 'shared' || fixedOwner === selectedMember.toLowerCase() || fixedPaidBy === selectedMember.toLowerCase();

    if (!visible) continue;

    rows.push({
      item: fixed.name,
      type: 'Fixed expense',
      owner: fixed.owner || 'Shared',
      paidBy: fixed.paidBy || fixed.payer || 'Shared',
      amount: monthlyAmount,
      date: fixed.frequency === 'yearly' ? `${fixed.payMonth || 'Month'} yearly` : 'Monthly',
      status: 'Expense',
      sign: '-',
      category: 'expense'
    });
  }

  for (const budget of data.budgets) {
    const monthlyAmount = budget.frequency === 'yearly' ? budget.amount / 12 : budget.amount;
    const budgetOwner = (budget.owner || 'Shared').toString().trim().toLowerCase();
    const budgetPaidBy = (budget.paidBy || budget.payer || 'Shared').toString().trim().toLowerCase();
    const visible = !selectedMember || budgetOwner === 'shared' || budgetOwner === selectedMember.toLowerCase() || budgetPaidBy === selectedMember.toLowerCase();

    if (!visible) continue;

    rows.push({
      item: budget.name,
      type: 'Budget',
      owner: budget.owner || 'Shared',
      paidBy: budget.paidBy || budget.payer || 'Shared',
      amount: monthlyAmount,
      date: budget.frequency === 'yearly' ? `${budget.payMonth || 'Month'} yearly` : 'Monthly',
      status: 'Budget',
      sign: '-',
      category: 'budget'
    });
  }

  if (selectedMember) {
    const selected = selectedMember.toLowerCase();
    rows.push(...buildDebtRows(data.fixedCosts, data, selected));
    rows.push(...buildDebtRows(data.budgets, data, selected));
  }

  rows.push({
    item: 'Savings target',
    type: 'Savings',
    owner: 'Shared',
    paidBy: 'Shared',
    amount: data.savings || 0,
    date: 'Monthly',
    status: 'Savings',
    sign: '-',
    category: 'savings'
  });

  const currentView = (globalThis.app && globalThis.app.currentView) || 'income';
  const viewCategories = VIEW_CATEGORIES[currentView] || VIEW_CATEGORIES.income;
  const visibleRows = rows.filter(row => viewCategories.includes(row.category));

  document.querySelectorAll('.tab-button').forEach(button => {
    button.classList.toggle('active', button.getAttribute('data-view') === currentView);
  });
  const dataTitle = document.getElementById('dataTitle');
  if (dataTitle) dataTitle.textContent = VIEW_TITLES[currentView] || VIEW_TITLES.income;

  const tableRows = visibleRows.map(row => `
    <tr data-category="${row.category}">
      <td>${escapeHtml(row.item)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.owner)} / ${escapeHtml(row.paidBy || row.owner || 'Shared')}</td>
      <td class="${row.sign === '+' ? 'money positive' : 'money negative'}">${row.sign}${formatMoney(row.amount)}</td>
      <td><span class='status-pill ${row.category === 'budget' ? 'status-planned' : 'status-active'}'>${escapeHtml(row.status)}</span></td>
    </tr>
  `).join('');

  document.getElementById('tableBody').innerHTML = tableRows || `<tr><td colspan='6'>No rows yet</td></tr>`;
}

function currentMonthName() {
  return new Date().toLocaleString(undefined, { month: 'long' }).trim();
}

function normalizeMonthName(value) {
  return String(value || '').trim().toLowerCase();
}

export function calculateSharedExpenseShares(data) {
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const method = (data.sharedExpenseMethod || 'equal').toLowerCase();
  const currentMonth = normalizeMonthName(currentMonthName());

  if (!persons.length) {
    return [];
  }

  if (method === 'equal') {
    return persons.map(() => 100 / persons.length);
  }

  const shareInputs = persons.map(person => {
    const salary = money(person.salary);

    const monthlyIncomes = Array.isArray(person.incomes)
      ? person.incomes.reduce((sum, income) => {
          if ((income.frequency || '').toLowerCase() === 'yearly') {
            return normalizeMonthName(income.receiveMonth || '') === currentMonth
              ? sum + money(income.amount)
              : sum;
          }
          return sum + money(income.amount);
        }, 0)
      : 0;

    const yearlyIncomes = Array.isArray(person.incomes)
      ? person.incomes.reduce((sum, income) => {
          const incomeAmount = money(income.amount);
          if ((income.frequency || '').toLowerCase() === 'yearly') {
            return sum + incomeAmount;
          }
          return sum + incomeAmount * 12;
        }, 0)
      : 0;

    const monthlyIncome = salary + monthlyIncomes;
    const yearlyIncome = salary * 12 + yearlyIncomes;

    return { name: person.name, monthlyIncome, yearlyIncome };
  });

  if (method === 'monthlyincome') {
    const total = shareInputs.reduce((sum, person) => sum + person.monthlyIncome, 0);
    if (!total) {
      return persons.map(() => 100 / persons.length);
    }
    return shareInputs.map(person => (person.monthlyIncome / total) * 100);
  }

  const total = shareInputs.reduce((sum, person) => sum + person.yearlyIncome, 0);
  if (!total) {
    return persons.map(() => 100 / persons.length);
  }
  return shareInputs.map(person => (person.yearlyIncome / total) * 100);
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function monthlyEquivalent(item) {
  if ((item.frequency || '').toLowerCase() === 'yearly') {
    const payMonth = normalizeMonthName(item.payMonth || '');
    const current = normalizeMonthName(currentMonthName());
    if (payMonth && payMonth !== current) {
      return 0;
    }
    return Number(item.amount || 0) / 12;
  }
  return Number(item.amount || 0);
}

function monthIncomeForPerson(person) {
  const currentMonth = normalizeMonthName(currentMonthName());
  const salary = money(person.salary);
  const income = Array.isArray(person.incomes)
    ? person.incomes.reduce((sum, entry) => {
        if ((entry.frequency || '').toLowerCase() === 'yearly') {
          return normalizeMonthName(entry.receiveMonth || '') === currentMonth ? sum + money(entry.amount) : sum;
        }
        return sum + money(entry.amount);
      }, 0)
    : 0;

  return salary + income;
}

function calculateCurrentMonthLedger(data) {
  const income = Array.isArray(data.persons)
    ? data.persons.reduce((sum, person) => sum + monthIncomeForPerson(person), 0)
    : 0;

  const paid = Array.isArray(data.fixedCosts)
    ? data.fixedCosts.reduce((sum, cost) => {
        if (cost && cost.paid) return sum + monthlyEquivalent(cost);
        return sum;
      }, 0)
    : 0;

  const remaining = Math.max(0, income - paid);
  return { income, paid, remaining };
}

// A shared item can carry its own splitPercent that overrides the
// household's default sharedExpenseMethod for that one expense: the payer
// takes splitPercent% of the cost and the remaining persons split the rest
// evenly between them. Falls back to the household method when the item has
// no valid override (no paidBy, or splitPercent isn't a usable 1-99 value).
function personSplitShare(personName, data, item) {
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const target = normalizeName(personName);
  const paidBy = normalizeName(item.paidBy || item.payer || 'shared');
  const splitPercent = Number(item.splitPercent);
  const hasCustomSplit = Number.isFinite(splitPercent) && splitPercent > 0 && splitPercent < 100 &&
    paidBy !== 'shared' && persons.some(person => normalizeName(person.name) === paidBy);

  if (hasCustomSplit) {
    if (target === paidBy) return splitPercent;
    const others = persons.filter(person => normalizeName(person.name) !== paidBy);
    if (!others.length) return 0;
    return others.some(person => normalizeName(person.name) === target) ? (100 - splitPercent) / others.length : 0;
  }

  const idx = persons.findIndex(entry => normalizeName(entry.name) === target);
  const shares = calculateSharedExpenseShares(data);
  return shares[idx] || (100 / Math.max(1, persons.length));
}

function personShareForCost(personName, data, cost) {
  const owner = normalizeName(cost.owner || 'shared');
  const target = normalizeName(personName);
  const amount = monthlyEquivalent(cost);

  if (owner === 'shared') {
    const share = personSplitShare(personName, data, cost);
    return amount * (share / 100);
  }

  if (owner === target) {
    return amount;
  }

  return 0;
}

// Who owes what on a single shared item, independent of whether it has been
// marked paid: marking a bill "Paid" only means the payer handled it with
// the household/bank, it doesn't settle what the other members still owe
// the payer for their share.
function owedLinesForItem(data, item) {
  const persons = Array.isArray(data.persons) ? data.persons : [];
  if (!persons.length) return [];

  const owner = (item.owner || 'shared').toString().trim().toLowerCase();
  const paidBy = (item.paidBy || item.payer || 'shared').toString().trim().toLowerCase();
  const amount = monthlyEquivalent(item);
  if (amount <= 0) return [];

  // A personal expense (owner is a specific person) that someone else
  // fronted is a straight full reimbursement — no split involved.
  if (owner !== 'shared') {
    if (paidBy === 'shared' || paidBy === owner) return [];
    const ownerPerson = persons.find(person => normalizeName(person.name) === owner);
    const payerExists = persons.some(person => normalizeName(person.name) === paidBy);
    if (!ownerPerson || !payerExists) return [];
    return [{ name: ownerPerson.name, amount, percent: 100 }];
  }

  // A shared expense a specific person paid: everyone else owes their
  // split share. Nobody owes anything if paidBy is itself 'shared' (paid
  // out of a joint account the household already funds together).
  if (paidBy === 'shared') return [];
  const payerExists = persons.some(person => normalizeName(person.name) === paidBy);
  if (!payerExists) return [];

  return persons
    .filter(person => normalizeName(person.name) !== paidBy)
    .map(person => {
      const percent = personSplitShare(person.name, data, item);
      return { name: person.name, amount: amount * (percent / 100), percent };
    })
    .filter(line => line.amount > 0.004);
}

function owedSummaryHtml(data, item) {
  const lines = owedLinesForItem(data, item);
  if (!lines.length) return '';

  const payerLabel = item.paidBy || item.payer || 'Shared';
  const text = lines
    .map(line => `${escapeHtml(line.name)} owes ${escapeHtml(payerLabel)} ${formatMoney(line.amount)} (${Math.round(line.percent)}%)`)
    .join(' &middot; ');

  return `<div class="category-owed">${text}</div>`;
}

// Settlement rows for the selected member: who they owe, and who owes them.
// - A personal expense (owner is a specific person) that someone else paid
//   is a straight reimbursement of the full amount, as before.
// - A shared expense (owner === 'shared') that a specific person paid is
//   split by personSplitShare: everyone but the payer owes their share of
//   the amount to the payer. Nobody owes anything if paidBy is itself
//   'shared' (e.g. paid out of a joint account), since each person's share
//   already came out of their own contribution to that pot.
function buildDebtRows(items, data, selected) {
  const rows = [];
  const persons = Array.isArray(data.persons) ? data.persons : [];

  for (const item of Array.isArray(items) ? items : []) {
    const owner = (item.owner || 'shared').toString().trim().toLowerCase();
    const paidBy = (item.paidBy || item.payer || 'shared').toString().trim().toLowerCase();
    const amount = monthlyEquivalent(item);
    const ownerLabel = item.owner || 'Shared';
    const paidByLabel = item.paidBy || item.payer || 'Shared';

    if (owner !== 'shared') {
      if (paidBy === selected && owner !== selected) {
        rows.push({ item: `${item.name} owed to ${owner}`, type: 'Money owed', owner: ownerLabel, paidBy: paidByLabel, amount, date: 'Monthly', status: 'Settlement', sign: '-', category: 'settlement' });
      }
      if (owner === selected && paidBy !== 'shared' && paidBy !== selected) {
        rows.push({ item: `${item.name} from ${paidBy}`, type: 'Money owed', owner: ownerLabel, paidBy: paidByLabel, amount, date: 'Monthly', status: 'Settlement', sign: '+', category: 'settlement' });
      }
      continue;
    }

    if (paidBy === 'shared' || amount <= 0) continue;

    if (paidBy === selected) {
      const owed = persons
        .filter(person => normalizeName(person.name) !== selected)
        .reduce((sum, person) => sum + amount * (personSplitShare(person.name, data, item) / 100), 0);
      if (owed > 0.004) {
        rows.push({ item: `${item.name} split owed to you`, type: 'Money owed', owner: ownerLabel, paidBy: paidByLabel, amount: owed, date: 'Monthly', status: 'Settlement', sign: '+', category: 'settlement' });
      }
    } else {
      const owed = amount * (personSplitShare(selected, data, item) / 100);
      if (owed > 0.004) {
        rows.push({ item: `${item.name} split owed to ${paidByLabel}`, type: 'Money owed', owner: ownerLabel, paidBy: paidByLabel, amount: owed, date: 'Monthly', status: 'Settlement', sign: '-', category: 'settlement' });
      }
    }
  }

  return rows;
}

export function calculateTotals(data, selectedMember = '') {
  if (selectedMember && selectedMember.trim()) {
    const selected = selectedMember.trim();
    const person = Array.isArray(data.persons)
      ? data.persons.find(entry => normalizeName(entry.name) === normalizeName(selected))
      : null;

    if (person) {
      const income = monthIncomeForPerson(person);
      const fixed = Array.isArray(data.fixedCosts)
        ? data.fixedCosts.reduce((sum, cost) => sum + personShareForCost(person.name, data, cost), 0)
        : 0;
      const budgets = Array.isArray(data.budgets)
        ? data.budgets.reduce((sum, budget) => sum + personShareForCost(person.name, data, budget), 0)
        : 0;
      const available = income - fixed - budgets;

      return { income, fixed, budgets, available };
    }
  }

  const currentMonth = normalizeMonthName(currentMonthName());
  const baseIncome = data.persons.reduce((sum, person) => sum + money(person.salary), 0);
  const extraIncome = data.persons.reduce((sum, person) => {
    return sum + person.incomes.reduce((inner, income) => {
      if ((income.frequency || '').toLowerCase() === 'yearly') {
        return normalizeMonthName(income.receiveMonth || '') === currentMonth ? inner + money(income.amount) : inner;
      }
      return inner + money(income.amount);
    }, 0);
  }, 0);

  const fixed = data.fixedCosts.reduce((sum, cost) => {
    if ((cost.frequency || '').toLowerCase() === 'yearly') {
      return normalizeMonthName(cost.payMonth || '') === currentMonth ? sum + money(cost.amount) / 12 : sum;
    }
    return sum + money(cost.amount);
  }, 0);

  const budgets = data.budgets.reduce((sum, budget) => {
    if ((budget.frequency || '').toLowerCase() === 'yearly') {
      return normalizeMonthName(budget.payMonth || '') === currentMonth ? sum + money(budget.amount) / 12 : sum;
    }
    return sum + money(budget.amount);
  }, 0);

  const savings = money(data.savings);
  const income = baseIncome + extraIncome;
  const available = income - fixed - budgets - savings;

  return { income, fixed, budgets, available };
}

// Per-person tracker panels are rebuilt from scratch on every render (see
// renderPersonTrackers), so their buttons can't be bound at creation time
// the way setup.js binds its rows — any listener attached directly to a
// panel's button is destroyed the next time that HTML is replaced. One
// delegated listener on the always-present #personTrackers container,
// bound once here, survives every re-render; it reads which person/tracker
// a click belongs to from the row's data-person/data-tracker-panel.
function wirePersonTrackers() {
  const container = document.getElementById('personTrackers');
  if (!container) return;

  container.addEventListener('click', async event => {
    const panel = event.target.closest('[data-tracker-panel]');
    if (!panel) return;

    const personName = panel.getAttribute('data-person');
    const trackerKey = panel.getAttribute('data-tracker-panel') === 'savings' ? 'savingsTracker' : 'creditCardTracker';
    const data = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : defaultData();
    const person = Array.isArray(data.persons) ? data.persons.find(entry => entry.name === personName) : null;
    if (!person) return;

    if (!person[trackerKey] || typeof person[trackerKey] !== 'object') {
      person[trackerKey] = { startingBalance: 0, entries: [] };
    }
    if (!Array.isArray(person[trackerKey].entries)) person[trackerKey].entries = [];

    const removeButton = event.target.closest('[data-remove-entry]');
    const actionButton = event.target.closest('[data-action]');

    if (removeButton) {
      const id = removeButton.getAttribute('data-remove-entry');
      person[trackerKey].entries = person[trackerKey].entries.filter(entry => entry.id !== id);
    } else if (actionButton && actionButton.getAttribute('data-action') === 'save-starting') {
      const startingInput = panel.querySelector('[data-role="starting-input"]');
      person[trackerKey].startingBalance = money(startingInput.value);
    } else if (actionButton && actionButton.getAttribute('data-action') === 'add-entry') {
      const amountInput = panel.querySelector('[data-role="amount-input"]');
      const amount = money(amountInput.value);
      if (amount <= 0) return;

      const directionSelect = panel.querySelector('[data-role="direction-select"]');
      const noteInput = panel.querySelector('[data-role="note-input"]');
      const negativeDirection = actionButton.getAttribute('data-negative');
      const signedAmount = directionSelect.value === negativeDirection ? -amount : amount;

      person[trackerKey].entries.push({
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        amount: signedAmount,
        note: noteInput.value.trim(),
        month: monthKey(),
        date: new Date().toISOString()
      });
    } else {
      return;
    }

    const saved = await saveData(data);
    if (!saved.valid) return;
    globalThis.app.currentData = saved.data || data;
    renderDashboard(globalThis.app.currentData);
  });
}

export function setupStaticDashboardEvents() {
  wirePersonTrackers();

  document.querySelectorAll('.tab-button[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      const view = button.getAttribute('data-view');
      if (globalThis.app) globalThis.app.currentView = view;
      const data = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : defaultData();
      renderDashboard(data);
    });
  });

  const expenseList = document.getElementById('expenseList');
  if (expenseList) {
    expenseList.addEventListener('click', async event => {
      const button = event.target.closest('[data-paid-row]');
      if (!button) return;

      const name = String(button.getAttribute('data-paid-row') || '').trim();
      const data = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : defaultData();
      const target = Array.isArray(data.fixedCosts)
        ? data.fixedCosts.find(cost => String(cost.name || '').trim().toLowerCase() === name.toLowerCase())
        : null;

      if (!target) return;

      target.paid = !Boolean(target.paid);
      const saved = await saveData(data);
      if (!saved.valid) return;

      globalThis.app.currentData = saved.data || data;
      renderDashboard(globalThis.app.currentData);
    });
  }

  const currentExpenseList = document.getElementById('currentMonthExpenseList');
  const currentMonthPrompt = document.getElementById('currentMonthPrompt');
  const currentMonthPromptTitle = document.getElementById('currentMonthPromptTitle');
  const currentMonthPromptName = document.getElementById('currentMonthPromptName');
  const currentMonthPromptAmount = document.getElementById('currentMonthPromptAmount');
  const currentMonthPromptSave = document.getElementById('currentMonthPromptSave');
  const currentMonthPromptCancel = document.getElementById('currentMonthPromptCancel');
  const currentMonthPromptClose = document.getElementById('currentMonthPromptClose');

  let currentMonthPromptMode = 'expense';

  function closeCurrentMonthPrompt() {
    if (currentMonthPrompt) currentMonthPrompt.classList.add('hidden');
    if (currentMonthPromptName) currentMonthPromptName.value = '';
    if (currentMonthPromptAmount) currentMonthPromptAmount.value = '0';
  }

  function openCurrentMonthPrompt(mode) {
    currentMonthPromptMode = mode;
    if (currentMonthPrompt && currentMonthPromptTitle) {
      currentMonthPromptTitle.textContent = mode === 'income' ? 'Add monthly income' : 'Add fixed expense';
      currentMonthPrompt.classList.remove('hidden');
    }
  }

  if (currentExpenseList) {
    currentExpenseList.addEventListener('click', async event => {
      const addButton = event.target.closest('[data-add-fixed]');
      if (addButton) {
        openCurrentMonthPrompt('expense');
        return;
      }

      const paidButton = event.target.closest('[data-paid-cost]');
      if (!paidButton) return;

      const data = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : defaultData();
      const name = String(paidButton.getAttribute('data-paid-cost') || '').trim();
      const target = Array.isArray(data.fixedCosts)
        ? data.fixedCosts.find(cost => String(cost.name || '').trim().toLowerCase() === name.toLowerCase())
        : null;

      if (!target) return;

      target.paid = !Boolean(target.paid);
      const saved = await saveData(data);
      if (!saved.valid) return;

      globalThis.app.currentData = saved.data || data;
      renderDashboard(globalThis.app.currentData);
    });
  }

  const currentIncomeList = document.getElementById('currentMonthIncomeList');
  const currentMonthAddIncome = document.getElementById('currentMonthAddIncome');
  if (currentIncomeList && currentMonthAddIncome) {
    currentMonthAddIncome.addEventListener('click', event => {
      event.preventDefault();
      openCurrentMonthPrompt('income');
    });
  }

  const currentMonthAddExpense = document.getElementById('currentMonthAddExpense');
  if (currentMonthAddExpense) {
    currentMonthAddExpense.addEventListener('click', event => {
      event.preventDefault();
      openCurrentMonthPrompt('expense');
    });
  }

  if (currentMonthPromptSave) {
    currentMonthPromptSave.addEventListener('click', async () => {
      const data = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : defaultData();
      const name = (currentMonthPromptName.value || '').trim();
      const amount = money(currentMonthPromptAmount.value || 0);
      if (!name || amount <= 0) {
        closeCurrentMonthPrompt();
        return;
      }

      if (currentMonthPromptMode === 'income') {
        const person = Array.isArray(data.persons) && data.persons.length ? data.persons[0] : null;
        if (!person) {
          data.persons.push({ name: 'Household', salary: 0, incomes: [{ name, amount, frequency: 'monthly', receiveMonth: '' }] });
        } else {
          person.incomes = Array.isArray(person.incomes) ? person.incomes : [];
          person.incomes.push({ name, amount, frequency: 'monthly', receiveMonth: '' });
        }
      } else {
        data.fixedCosts.push({
          name,
          amount,
          frequency: 'monthly',
          payMonth: '',
          owner: 'shared',
          paidBy: 'shared',
          paid: false
        });
      }

      const saved = await saveData(data);
      if (!saved.valid) {
        closeCurrentMonthPrompt();
        return;
      }

      globalThis.app.currentData = saved.data || data;
      closeCurrentMonthPrompt();
      renderDashboard(globalThis.app.currentData);
    });
  }

  if (currentMonthPromptCancel) {
    currentMonthPromptCancel.addEventListener('click', closeCurrentMonthPrompt);
  }

  if (currentMonthPromptClose) {
    currentMonthPromptClose.addEventListener('click', closeCurrentMonthPrompt);
  }

  document.getElementById('addPlanButton').addEventListener('click', event => {
    event.preventDefault();
    addPlanFromDashboard();
  });

  document.getElementById('sidebarAddExpense').addEventListener('click', event => {
    event.preventDefault();
    openSetup();
  });

  document.getElementById('addIncomeButton').addEventListener('click', event => {
    event.preventDefault();
    openSetup();
  });

  document.getElementById('clearDashboardPlan').addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('incomeSource').value = '';
    document.getElementById('incomeAmount').value = '';
    document.getElementById('incomeDate').value = '';
    document.getElementById('expenseSource').value = '';
    document.getElementById('expenseType').value = 'expense';
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseDate').value = '';
    if (document.getElementById('expenseSplitPercent')) document.getElementById('expenseSplitPercent').value = '';
  });

  // This button used to have no id and no handler at all — clicking it did
  // nothing. It now jumps down to the "Add to your budget" form and focuses
  // the item-name field, which is what its placement next to the tabs implies
  // it should do.
  const jumpToAddItemButton = document.getElementById('jumpToAddItemButton');
  if (jumpToAddItemButton) {
    jumpToAddItemButton.addEventListener('click', () => {
      const formPanel = document.querySelector('.form-panel');
      if (formPanel && formPanel.scrollIntoView) formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const sourceInput = document.getElementById('expenseSource');
      if (sourceInput) sourceInput.focus();
    });
  }
}

export async function addPlanFromDashboard() {
  const itemType = document.getElementById('expenseType').value;
  const source = document.getElementById('expenseSource').value.trim();
  const amount = money(document.getElementById('expenseAmount').value);
  const owner = document.getElementById('expenseOwner').value || 'shared';
  const paidBy = document.getElementById('expensePaidBy').value || 'shared';
  const splitPercentField = document.getElementById('expenseSplitPercent');
  const splitPercentRaw = splitPercentField ? money(splitPercentField.value) : 0;
  const splitPercent = owner.toLowerCase() === 'shared' && splitPercentRaw > 0 && splitPercentRaw < 100
    ? splitPercentRaw
    : null;

  if (!source || amount <= 0) return;

  const current = globalThis.app && globalThis.app.currentData ? globalThis.app.currentData : defaultData();
  const data = current && current.householdName && current.password
    ? await loadData(current.householdName, current.password)
    : defaultData();

  if (itemType === 'savings') {
    data.savings = amount;
  } else if (itemType === 'budget') {
    data.budgets.push({
      name: source,
      amount,
      frequency: 'monthly',
      payMonth: '',
      owner,
      paidBy,
      splitPercent
    });
  } else {
    data.fixedCosts.push({
      name: source,
      amount,
      frequency: 'monthly',
      payMonth: '',
      owner,
      paidBy,
      splitPercent
    });
  }

  const saved = await saveData(data);
  if (!saved.valid) {
    return;
  }

  const savedData = saved.data || data;
  globalThis.app.currentData = savedData;
  renderDashboard(savedData);
}
