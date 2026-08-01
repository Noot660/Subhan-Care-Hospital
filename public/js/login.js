// Login Page Logic — Subhan Care HMS
import { auth } from './auth.js';

const REMEMBER_KEY = 'sc_remember_user';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const button = document.getElementById('loginButton');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const pwToggle = document.getElementById('pwToggle');
const rememberEl = document.getElementById('rememberMe');

// ── Redirect already-authenticated users straight to the dashboard ──
if (auth.isLoggedIn() && !auth.isExpired()) {
  const user = auth.getUser();
  if (user) {
    const route = auth.getDefaultRoute(user.role);
    window.location.replace('/dashboard' + route);
  }
}

// ── Restore remembered username + focus ──
const remembered = localStorage.getItem(REMEMBER_KEY);
if (remembered) {
  usernameEl.value = remembered;
  rememberEl.checked = true;
  passwordEl.focus();
} else {
  usernameEl.focus();
}

// ── Show / hide password toggle ──
function setPasswordVisible(visible) {
  passwordEl.type = visible ? 'text' : 'password';
  document.querySelector('.eye-open').style.display = visible ? 'none' : '';
  document.querySelector('.eye-off').style.display = visible ? '' : 'none';
  pwToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  pwToggle.setAttribute('aria-pressed', String(visible));
}
pwToggle.addEventListener('click', () => setPasswordVisible(passwordEl.type === 'password'));

// ── Submit ──
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!username || !password) {
    showError('Please enter both username and password');
    if (!username) usernameEl.focus();
    else passwordEl.focus();
    return;
  }

  setLoading(true);
  hideError();

  try {
    const data = await auth.login(username, password);
    if (rememberEl.checked) {
      localStorage.setItem(REMEMBER_KEY, username);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
    const route = auth.getDefaultRoute(data.user.role);
    window.location.href = '/dashboard' + route;
  } catch (err) {
    showError(err.message || 'Login failed. Please check your credentials.');
    setLoading(false);
    passwordEl.value = '';
    passwordEl.focus();
  }
});

function setLoading(loading) {
  button.disabled = loading;
  button.classList.toggle('loading', loading);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
  // Restart the shake animation so repeat errors still animate
  errorEl.style.animation = 'none';
  void errorEl.offsetWidth;
  errorEl.style.animation = '';
}

function hideError() {
  errorEl.classList.add('hidden');
}
