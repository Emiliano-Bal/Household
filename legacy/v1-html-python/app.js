const STORE_KEY = 'householdBudgetPlannerDataV1';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

const emptyData = {
  householdName: '',
  password: '',
  persons: [],
  fixedCosts: [],
  budgets: [],
  savings: 0
};

const app = {
  currentData: loadData(),
  nextScreen: 'auth'
};

function defaultData() {
  return {
    householdName: '',
    password: '',
    persons: [],
    fixedCosts: [],
    budgets: [],
    savings: 0
  };
}

function loadData() {
  const saved = localStorage.getItem(STORE_KEY);
  if (!saved) return defaultData();
  try {
    return { ...defaultData(), ...JSON.parse(saved) };
  } catch (error) {
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function money(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  return currency.format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function openAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.add('hidden');
}

function openSetup() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('setupScreen').classList.remove('hidden');
  document.getElementById('dashboardScreen').classList.add('hidden');
}

function openDashboard() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('hidden');
}

function setupFormEvents() {
  const setupScreen = document.getElementById('setupScreen');
  const setupForm = document.getElementById('setupForm');
  const addPersonButton = document.getElementById('addPersonButton');
  const addBudgetButton = document.getElementById('addBudgetButton');
  const addFixedCostButton = document.getElementById('addFixedCostButton');
  const personCount = document.getElementById('personCount');

  document.getElementById('createHouseholdButton').addEventListener('click', () => {
    clearSetupForm();
    openSetup();
  });

  document.getElementById('backToSignIn').addEventListener('click', () => {
    openAuth();
  });

  document.getElementById('signInButton').addEventListener('click', () => {
    const userName = document.getElementById('authHouseholdName').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const existing = loadData();

    if (!existing || !existing.householdName || !existing.password) {
      showAuthError('No household found. Create your household first.');
      return;
    }

    if (existing.householdName.toLowerCase() !== userName.toLowerCase() || existing.password !== password) {
      showAuthError('Household name or password is incorrect.');
      return;
    }

    app.currentData = existing;
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

  setupForm.addEventListener('submit', event => {
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
      savings: setup.savings
    };

    saveData(household);
    app.currentData = household;
    renderDashboard(household);
    openDashboard();
  });
}

function showAuthError(message) {
  const authForm = document.querySelector('#authScreen .auth-form');
  let error = authForm.querySelector('.form-message');
  if (!error) {
    error = document.createElement('div');
    error.className = 'form-message';
    authForm.appendChild(error);
  }
  error.textContent = message;
}

function showSetupError(message) {
  const setupError = document.getElementById('setupError') || addSetupError();
  setupError.textContent = message;
}

function addSetupError() {
  const div = document.createElement('div');
  div.id = 'setupError';
  div.className = 'form-message setup-error';
  document.getElementById('setupForm').insertBefore(div, document.getElementById('setupForm').firstChild);
  return div;
}

function clearSetupForm() {
  document.getElementById('setupForm').reset();
  document.getElementById('householdNameSetup').value = '';
  document.getElementById('passwordSetup').value = '';
  document.getElementById('personCount').value = 1;
  document.getElementById('peopleRows').innerHTML = '';
  document.getElementById('budgetRows').innerHTML = '';
  document.getElementById('savingsTarget').value = 0;

  if (document.getElementById('setupError')) {
    document.getElementById('setupError').remove();
  }
}

function renderPeopleRows(count) {
  const peopleRows = document.getElementById('peopleRows');
  count = Math.max(1, Number(count) || 1);
  peopleRows.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'person-row';

    row.innerHTML = `
      <div class="person-grid">
        <div class="input-wrap">
          <label>Name</label>
          <input type="text" class="person-name" placeholder="Person ${i+1} name" />
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
      entry.querySelector('.remove-row').addEventListener('click', () => entry.remove());
      list.appendChild(entry);
    });

    peopleRows.appendChild(row);
  }
}

function addFixedCostRow() {
  const fixedCostsRows = document.getElementById('fixedCostsRows');
  const row = document.createElement('div');
  row.className = 'fixed-cost-row';
  row.innerHTML = `
    <div class="cost-entry-grid">
      <input type="text" class="cost-name" placeholder="Fixed cost name" />
      <input type="number" class="cost-amount" placeholder="Cost amount" />
      <select class="cost-frequency">
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
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
      <button type="button" class="remove-row cost-remove">×</button>
    </div>
  `;

  row.querySelector('.cost-remove').addEventListener('click', () => row.remove());
  fixedCostsRows.appendChild(row);
}

function addBudgetRow() {
  const budgetRows = document.getElementById('budgetRows');
  const row = document.createElement('div');
  row.className = 'budget-row';
  row.innerHTML = `
    <div class="budget-entry-grid">
      <input type="text" class="budget-name" placeholder="Budget name" />
      <input type="number" class="budget-amount" placeholder="Budget amount" />
      <select class="budget-frequency">
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
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
      <button type="button" class="remove-row budget-remove">×</button>
    </div>
  `;

  row.querySelector('.budget-remove').addEventListener('click', () => row.remove());
  budgetRows.appendChild(row);
}

function buildHouseholdFromSetup() {
  const householdName = document.getElementById('householdNameSetup').value.trim();
  const password = document.getElementById('passwordSetup').value.trim();
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

  const persons = [];
  for (const row of personRows) {
    const name = row.querySelector('.person-name').value.trim();
    const salary = money(row.querySelector('.person-salary').value);

    if (!name || salary <= 0) {
      return { valid: false, message: 'Each person needs a name and a monthly salary.' };
    }

    const incomes = Array.from(row.querySelectorAll('.income-entry')).map(entry => ({
      name: entry.querySelector('.income-name').value.trim(),
      amount: money(entry.querySelector('.income-amount').value),
      frequency: entry.querySelector('.income-frequency').value,
      receiveMonth: entry.querySelector('.income-month').value || 'Monthly'
    }));

    persons.push({
      name,
      salary,
      incomes: incomes.filter(item => item.name && item.amount > 0)
    });
  }

  const fixedCostRows = Array.from(document.querySelectorAll('#fixedCostsRows .fixed-cost-row'));
  const fixedCosts = fixedCostRows.map(row => {
    const name = row.querySelector('.cost-name').value.trim();
    const amount = money(row.querySelector('.cost-amount').value);
    const frequency = row.querySelector('.cost-frequency').value;
    const payMonth = row.querySelector('.cost-month').value || 'Month';

    if (!name || amount <= 0) return null;

    return {
      name,
      amount,
      frequency,
      payMonth
    };
  }).filter(Boolean);

  const budgetRows = Array.from(document.querySelectorAll('#budgetRows .budget-row'));
  const budgets = budgetRows.map(row => {
    const name = row.querySelector('.budget-name').value.trim();
    const amount = money(row.querySelector('.budget-amount').value);
    const frequency = row.querySelector('.budget-frequency').value;
    const payMonth = row.querySelector('.budget-month').value || 'Month';

    if (!name || amount <= 0) return null;

    return {
      name,
      amount,
      frequency,
      payMonth
    };
  }).filter(Boolean);

  const savings = money(document.getElementById('savingsTarget').value);

  return {
    valid: true,
    householdName,
    password,
    persons,
    fixedCosts,
    budgets,
    savings
  };
}

function renderDashboard(data) {
  const householdTitle = document.getElementById('householdTitle');
  const householdNameDisplay = document.getElementById('householdNameDisplay');
  const householdMembers = document.getElementById('householdMembers');

  householdTitle.textContent = data.householdName || 'Budget Planner';
  householdNameDisplay.textContent = data.householdName || 'Family Budget';

  const totalPersonCount = data.persons.length || 1;
  const personNames = data.persons.map(person => person.name);

  householdMembers.innerHTML = personNames.length ? personNames.map((name, i) => {
    return `<div class="member-row">
      <span class="member-name">${escapeHtml(name)}</span>
      <span class="member-share">${Math.round(100 / totalPersonCount)}%</span>
    </div>`;
  }).join('') : `<div class="member-row"><span class='member-name'>No people</span></div>`;

  const totals = calculateTotals(data);

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

  const fixedRows = data.fixedCosts.map(cost => {
    return `<div class="category-row">
      <span class="category-label">${escapeHtml(cost.name)}</span>
      <span class="category-amount">${formatMoney(cost.frequency === 'yearly' ? cost.amount / 12 : cost.amount)}</span>
      <span class="category-owner">${escapeHtml(cost.frequency)}</span>
    </div>`;
  }).join('');

  const budgetRows = data.budgets.map(item => {
    return `<div class="category-row">
      <span class="category-label">${escapeHtml(item.name)}</span>
      <span class="category-amount">${formatMoney(item.frequency === 'yearly' ? item.amount / 12 : item.amount)}</span>
      <span class="category-owner">${escapeHtml(item.frequency)}</span>
    </div>`;
  }).join('');

  document.getElementById('expenseList').innerHTML = fixedRows || `<div class='category-row'><span class='category-label'>No fixed costs</span></div>`;
  document.getElementById('budgetList').innerHTML = budgetRows || `<div class='category-row'><span class='category-label'>No budgets</span></div>`;

  const rows = [];
  for (const person of data.persons) {
    rows.push({
      item: `${person.name} base salary`,
      type: 'Salary',
      owner: person.name,
      amount: person.salary,
      date: 'Monthly',
      status: 'Salary',
      sign: '+',
      category: 'salary'
    });

    for (const income of person.incomes) {
      const monthlyAmount = income.frequency === 'yearly' ? income.amount / 12 : income.amount;
      rows.push({
        item: income.name,
        type: 'Income',
        owner: person.name,
        amount: monthlyAmount,
        date: income.frequency === 'yearly' ? `${income.receiveMonth || 'Month'} yearly` : 'Monthly',
        status: 'Income',
        sign: '+',
        category: 'income'
      });
    }
  }

  for (const fixed of data.fixedCosts) {
    const monthlyAmount = fixed.frequency === 'yearly' ? fixed.amount / 12 : fixed.amount;
    rows.push({
      item: fixed.name,
      type: 'Fixed expense',
      owner: 'Shared',
      amount: monthlyAmount,
      date: fixed.frequency === 'yearly' ? `${fixed.payMonth || 'Month'} yearly` : 'Monthly',
      status: 'Expense',
      sign: '-',
      category: 'expense'
    });
  }

  for (const budget of data.budgets) {
    const monthlyAmount = budget.frequency === 'yearly' ? budget.amount / 12 : budget.amount;
    rows.push({
      item: budget.name,
      type: 'Budget',
      owner: 'Shared',
      amount: monthlyAmount,
      date: budget.frequency === 'yearly' ? `${budget.payMonth || 'Month'} yearly` : 'Monthly',
      status: 'Budget',
      sign: '-',
      category: 'budget'
    });
  }

  rows.push({
    item: 'Savings target',
    type: 'Savings',
    owner: 'Shared',
    amount: data.savings || 0,
    date: 'Monthly',
    status: 'Savings',
    sign: '-',
    category: 'savings'
  });

  const tableRows = rows.map(row => `
    <tr data-category="${row.category}">
      <td>${escapeHtml(row.item)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.owner)}</td>
      <td class="${row.sign === '+' ? 'money positive' : 'money negative'}">${row.sign}${formatMoney(row.amount)}</td>
      <td><span class='status-pill ${row.category === 'budget' ? 'status-planned' : 'status-active'}'>${escapeHtml(row.status)}</span></td>
    </tr>
  `).join('');

  document.getElementById('tableBody').innerHTML = tableRows || `<tr><td colspan='6'>No rows yet</td></tr>`;
}

function calculateTotals(data) {
  const baseIncome = data.persons.reduce((sum, person) => sum + money(person.salary), 0);
  const extraIncome = data.persons.reduce((sum, person) => {
    return sum + person.incomes.reduce((inner, income) => inner + money(income.frequency === 'yearly' ? income.amount / 12 : income.amount), 0);
  }, 0);

  const fixed = data.fixedCosts.reduce((sum, cost) => sum + money(cost.frequency === 'yearly' ? cost.amount / 12 : cost.amount), 0);
  const budgets = data.budgets.reduce((sum, budget) => sum + money(budget.frequency === 'yearly' ? budget.amount / 12 : budget.amount), 0);
  const savings = money(data.savings);

  const income = baseIncome + extraIncome;
  const available = income - fixed - budgets - savings;

  return { income, fixed, budgets, available };
}

function setupStaticDashboardEvents() {
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
  });
}

function addPlanFromDashboard() {
  const itemType = document.getElementById('expenseType').value;
  const source = document.getElementById('expenseSource').value.trim();
  const amount = money(document.getElementById('expenseAmount').value);

  if (!source || amount <= 0) return;

  const data = loadData();
  if (itemType === 'savings') {
    data.savings = amount;
  } else if (itemType === 'budget') {
    data.budgets.push({
      name: source,
      amount,
      frequency: 'monthly',
      payMonth: ''
    });
  } else {
    data.fixedCosts.push({
      name: source,
      amount,
      frequency: 'monthly',
      payMonth: ''
    });
  }

  saveData(data);
  app.currentData = data;
  renderDashboard(data);
}

function boot() {
  setDefaultNames();
  setupFormEvents();
  setupStaticDashboardEvents();
  renderPeopleRows(1);
  addFixedCostRow();
  addBudgetRow();
  openAuth();
}

function setDefaultNames() {
  document.getElementById('householdNameSetup').value = '';
  document.getElementById('passwordSetup').value = '';
  document.getElementById('personCount').value = 1;
  document.getElementById('savingsTarget').value = 0;
}

boot();
