export function openAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.add('hidden');
}

export function openSetup() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('setupScreen').classList.remove('hidden');
  document.getElementById('dashboardScreen').classList.add('hidden');
}

export function openDashboard() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('hidden');
}
