// Login Page Logic
import { auth } from './auth.js';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const button = document.getElementById('loginButton');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('Please enter both username and password');
    return;
  }

  button.disabled = true;
  button.textContent = 'Signing in...';
  hideError();

  try {
    const data = await auth.login(username, password);
    const route = auth.getDefaultRoute(data.user.role);
    window.location.href = '/dashboard' + route;
  } catch (err) {
    showError(err.message || 'Login failed. Please check your credentials.');
    button.disabled = false;
    button.textContent = 'Sign In';
  }
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function hideError() {
  errorEl.classList.add('hidden');
}

// Redirect if already logged in
if (auth.isLoggedIn() && !auth.isExpired()) {
  const user = auth.getUser();
  if (user) {
    const route = auth.getDefaultRoute(user.role);
    window.location.href = '/dashboard' + route;
  }
}
