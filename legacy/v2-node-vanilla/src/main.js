import { defaultData, loadData } from './data.js';
import { openAuth } from './screens.js';
import { setupFormEvents, renderPeopleRows, addFixedCostRow, addBudgetRow } from './setup.js';
import { setupStaticDashboardEvents } from './dashboard.js';

const app = {
  currentData: defaultData(),
  currentMember: '',
  nextScreen: 'auth'
};

globalThis.app = app;

function setDefaultNames() {
  document.getElementById('householdNameSetup').value = '';
  document.getElementById('passwordSetup').value = '';
  document.getElementById('personCount').value = 1;
  document.getElementById('savingsTarget').value = 0;
}

async function boot() {
  setDefaultNames();
  setupFormEvents();
  setupStaticDashboardEvents();
  renderPeopleRows(1);
  addFixedCostRow();
  addBudgetRow();

  const saved = await loadData();
  if (saved && saved.householdName) {
    app.currentData = saved;
  }

  openAuth();
}

boot();
