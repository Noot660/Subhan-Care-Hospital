// ═══════════════════════════════════════════════════════════
// Dashboard — Subhan Care HMS
// Dynamic role-based views, cached API access, optimistic UI,
// lazy section loading, auto-refresh and loading skeletons.
// ═══════════════════════════════════════════════════════════
import { api } from './api.js';
import { auth } from './auth.js';
import {
  createModal, createFormField, showToast, showConfirm,
  formatDate, statusBadge, formatRs,
} from './components.js';

const user = auth.getUser();
if (!user || auth.isExpired()) {
  window.location.replace('/login');
  throw new Error('Not authenticated');
}

// ── DOM refs ──
const content = document.getElementById('dashboardContent');
const titleEl = document.getElementById('dashboardTitle');
const breadcrumbEl = document.getElementById('breadcrumb');
const updatedEl = document.getElementById('updatedIndicator');

// ── Helpers ──
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function initials(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── API cache (30s TTL) ──
const CACHE_TTL = 30_000;
const cache = new Map();
function cached(key, fetcher, force = false) {
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.data);
  }
  const p = fetcher().then((data) => {
    cache.set(key, { ts: Date.now(), data });
    return data;
  }).catch((err) => { cache.delete(key); throw err; });
  return p;
}
function invalidate(...keys) { keys.forEach((k) => cache.delete(k)); }
// Invalidate every cached key starting with a prefix (e.g. 'appts' clears all appointment filters).
function invalidatePrefix(prefix) {
  [...cache.keys()].forEach(k => { if (k.startsWith(prefix)) cache.delete(k); });
}

// ── Appointment source badges ──
const SOURCE_META = {
  chat: { label: '💬 Chat', cls: 'badge-blue' },
  voice: { label: '📞 Voice', cls: 'badge-purple' },
  twilio: { label: '📞 Twilio', cls: 'badge-teal' },
  staff: { label: '🏥 Staff', cls: 'badge-gray' },
};
function sourceBadge(source) {
  const meta = SOURCE_META[source] || { label: (source || 'staff'), cls: 'badge-gray' };
  return `<span class="badge ${meta.cls}">${meta.label}</span>`;
}

// ── "Updated just now" indicator ──
let updatedTimer = null;
function markUpdated() {
  updatedEl.hidden = false;
  clearTimeout(updatedTimer);
  updatedTimer = setTimeout(() => { updatedEl.hidden = true; }, 4000);
}

// ── Skeletons & empty states ──
function skeletonCards(n = 4) {
  return `<div class="stats-grid">${'<div class="skel-card"><div class="skeleton" style="height:44px;width:44px;border-radius:10px"></div><div class="skeleton" style="height:20px;width:60%"></div><div class="skeleton" style="height:12px;width:40%"></div></div>'.repeat(n)}</div>`;
}
function skeletonTable(rows = 5) {
  let html = '<div class="table-wrap"><div class="skel-table" style="padding:16px">';
  html += '<div class="skeleton" style="height:22px;width:100%"></div>';
  for (let i = 0; i < rows; i++) html += `<div class="skeleton" style="height:16px;width:${95 - i * 7}%"></div>`;
  return html + '</div></div>';
}
function emptyState(icon, title, msg) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h4>${esc(title)}</h4><p>${esc(msg)}</p></div>`;
}

// ── Icons (inline SVG) ──
const ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 2.9-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M17.5 15c2.4.6 4 2.3 4 5"/></svg>',
  doctor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="7.5" r="3.5"/><path d="M2.5 20c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5"/><path d="M17 3v6M14 6h6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v4M16 3v4"/></svg>',
  pill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-30 12 12)"/><path d="M6 10.5l4.5 8"/></svg>',
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4a2 2 0 0 1 2-1h2a2 2 0 0 1 2 1v1H9zM9 12l2 2 4-4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4v5h5"/><path d="M4.5 13a8 8 0 1 0 2-6.2L4 9"/><path d="M12 8v4.5l3 2"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 12h4l2.5-6.5L14 18l2.5-6H21"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-8.5-5.3-8.5-11A5 5 0 0 1 12 6a5 5 0 0 1 8.5 3.5c0 5.7-8.5 11-8.5 11Z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M8.5 13h.01M15.5 13h.01M9 17h6"/><path d="M2 12v4M22 12v4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

// ── Navigation config per role ──
const navConfig = {
  admin: [
    { id: 'overview', label: 'Overview', icon: 'grid', hash: '#/dashboard/admin' },
    { id: 'patients', label: 'Patients', icon: 'users', hash: '#/dashboard/admin/patients' },
    { id: 'doctors', label: 'Doctors', icon: 'doctor', hash: '#/dashboard/admin/doctors' },
    { id: 'appointments', label: 'Appointments', icon: 'calendar', hash: '#/dashboard/admin/appointments' },
    { id: 'aiops', label: 'AI Ops', icon: 'bot', hash: '#/dashboard/admin/aiops' },
    { id: 'analytics', label: 'Analytics', icon: 'chart', hash: '#/dashboard/admin/analytics' },
    { id: 'consultations', label: 'Consultations', icon: 'clipboard', hash: '#/dashboard/admin/consultations' },
    { id: 'staff', label: 'Staff', icon: 'users', hash: '#/dashboard/admin/staff' },
    { id: 'pharmacy', label: 'Pharmacy', icon: 'pill', hash: '#/dashboard/admin/pharmacy' },
    { id: 'billing', label: 'Billing', icon: 'cash', hash: '#/dashboard/admin/billing' },
  ],
  receptionist: [
    { id: 'today', label: "Today's Appointments", icon: 'calendar', hash: '#/dashboard/receptionist' },
    { id: 'patients', label: 'Patients', icon: 'users', hash: '#/dashboard/receptionist/patients' },
    { id: 'register', label: 'Register Patient', icon: 'plus', hash: '#/dashboard/receptionist/register' },
    { id: 'book', label: 'Book Appointment', icon: 'clipboard', hash: '#/dashboard/receptionist/book' },
  ],
  doctor: [
    { id: 'appointments', label: 'My Appointments', icon: 'calendar', hash: '#/dashboard/doctor' },
    { id: 'history', label: 'Patient History', icon: 'history', hash: '#/dashboard/doctor/history' },
  ],
  pharmacist: [
    { id: 'prescriptions', label: 'Prescriptions', icon: 'clipboard', hash: '#/dashboard/pharmacist' },
    { id: 'inventory', label: 'Inventory', icon: 'pill', hash: '#/dashboard/pharmacist/inventory' },
    { id: 'lowstock', label: 'Low Stock', icon: 'alert', hash: '#/dashboard/pharmacist/lowstock' },
  ],
  billing: [
    { id: 'invoices', label: 'Invoices', icon: 'receipt', hash: '#/dashboard/billing' },
    { id: 'collections', label: 'Collections', icon: 'activity', hash: '#/dashboard/billing/collections' },
  ],
  management: [
    { id: 'overview', label: 'Overview', icon: 'grid', hash: '#/dashboard/management' },
  ],
};

const navTitles = {
  'admin:overview': ['Dashboard Overview', 'HMS / Overview'],
  'admin:patients': ['Patient Management', 'HMS / Patients'],
  'admin:doctors': ['Doctor Management', 'HMS / Doctors'],
  'admin:appointments': ['All Appointments', 'HMS / Appointments'],
  'admin:aiops': ['AI Operations', 'HMS / AI Ops'],
  'admin:analytics': ['Analytics', 'HMS / Analytics'],
  'admin:consultations': ['Consultations', 'HMS / Consultations'],
  'admin:staff': ['Staff Management', 'HMS / Staff'],
  'admin:pharmacy': ['Pharmacy', 'HMS / Pharmacy'],
  'admin:billing': ['Billing', 'HMS / Billing'],
  'receptionist:today': ["Today's Appointments", 'Reception / Today'],
  'receptionist:patients': ['Patient Directory', 'Reception / Patients'],
  'receptionist:register': ['Register Patient', 'Reception / Register'],
  'receptionist:book': ['Book Appointment', 'Reception / Book'],
  'doctor:appointments': ['My Appointments', 'Doctor / Today'],
  'doctor:history': ['Patient History', 'Doctor / History'],
  'pharmacist:prescriptions': ['Prescriptions', 'Pharmacy / Prescriptions'],
  'pharmacist:inventory': ['Medicine Inventory', 'Pharmacy / Inventory'],
  'pharmacist:lowstock': ['Low Stock Alerts', 'Pharmacy / Low Stock'],
  'billing:invoices': ['Invoices', 'Billing / Invoices'],
  'billing:collections': ['Collections', 'Billing / Collections'],
  'management:overview': ['Dashboard Overview', 'Management / Overview'],
};

// ── Sidebar & bottom tabs ──
function sectionKey(hash, role) {
  const h = hash || '#/dashboard/' + role;
  const parts = h.replace('#/dashboard/', '').split('/');
  const section = parts[0] || 'overview';
  const id = (role === 'receptionist' && section === 'register') ? 'register'
    : (role === 'receptionist' && section === 'book') ? 'book'
    : (role === 'receptionist' && section === 'patients') ? 'patients'
    : (role === 'receptionist') ? 'today'
    : (role === 'admin' && section === 'patients') ? 'patients'
    : (role === 'admin' && section === 'doctors') ? 'doctors'
    : (role === 'admin' && section === 'appointments') ? 'appointments'
    : (role === 'admin' && section === 'aiops') ? 'aiops'
    : (role === 'admin' && section === 'analytics') ? 'analytics'
    : (role === 'admin' && section === 'consultations') ? 'consultations'
    : (role === 'admin' && section === 'staff') ? 'staff'
    : (role === 'admin' && section === 'pharmacy') ? 'pharmacy'
    : (role === 'admin' && section === 'billing') ? 'billing'
    : (role === 'admin') ? 'overview'
    : (role === 'doctor' && section === 'history') ? 'history'
    : (role === 'doctor') ? 'appointments'
    : (role === 'pharmacist' && section === 'inventory') ? 'inventory'
    : (role === 'pharmacist' && section === 'lowstock') ? 'lowstock'
    : (role === 'pharmacist') ? 'prescriptions'
    : (role === 'billing' && section === 'collections') ? 'collections'
    : (role === 'billing') ? 'invoices'
    : 'overview';
  return `${role}:${id}`;
}

function buildSidebar() {
  const items = navConfig[user.role] || [];
  const nav = document.getElementById('sidebarNav');
  const bottomTabs = document.getElementById('bottomTabs');
  nav.innerHTML = items.map(item => `
    <a href="${item.hash}" class="nav-item" data-hash="${item.hash}">
      ${ICONS[item.icon]}
      <span class="nav-text">${esc(item.label)}</span>
    </a>
  `).join('');
  bottomTabs.innerHTML = items.slice(0, 5).map(item => `
    <a href="${item.hash}" class="bottom-tab" data-hash="${item.hash}">
      ${ICONS[item.icon]}
      <span>${esc(item.label.split(' ')[0])}</span>
    </a>
  `).join('');
  updateActiveNav();
}

function updateActiveNav() {
  const current = window.location.hash || '#/dashboard/' + user.role;
  document.querySelectorAll('.nav-item, .bottom-tab').forEach(a => {
    a.classList.toggle('active', a.dataset.hash === current);
  });
}

// ── User chrome ──
document.getElementById('userNameDisplay').textContent = user.name;
document.getElementById('userRoleDisplay').textContent = user.role;
document.getElementById('topbarName').textContent = user.name;
document.getElementById('userAvatar').textContent = initials(user.name);
document.getElementById('topbarAvatar').textContent = initials(user.name);
document.getElementById('logoutButton').addEventListener('click', async () => {
  await auth.logout();
  window.location.replace('/login');
});

// Sidebar toggle (mobile drawer + tablet expand)
const sidebar = document.getElementById('sidebar');
document.getElementById('sidebarToggle').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    toggleOverlay(true);
  } else {
    sidebar.classList.toggle('expanded');
  }
});
function toggleOverlay(show) {
  let overlay = document.querySelector('.sidebar-overlay');
  if (show && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      toggleOverlay(false);
    });
    document.body.appendChild(overlay);
  }
  if (overlay) overlay.classList.toggle('show', show);
}
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) toggleOverlay(false);
});

// ── Section renderers registry ──
const renderers = {
  admin: {
    overview: renderAdminOverview,
    patients: renderPatientsView,
    doctors: renderDoctorsView,
    appointments: renderAppointmentsView,
    aiops: renderAiOpsView,
    analytics: renderAnalyticsView,
    consultations: renderConsultationsView,
    staff: renderStaffView,
    pharmacy: renderPharmacyView,
    billing: renderBillingView,
  },
  receptionist: {
    today: renderTodayView,
    patients: renderPatientDirectory,
    register: renderRegisterPatient,
    book: renderBookAppointment,
  },
  doctor: {
    appointments: renderDoctorAppointments,
    history: renderDoctorHistory,
  },
  pharmacist: {
    prescriptions: renderPharmacistPrescriptions,
    inventory: renderPharmacistInventory,
    lowstock: renderPharmacistLowStock,
  },
  billing: {
    invoices: renderBillingInvoices,
    collections: renderBillingCollections,
  },
  management: {
    overview: renderAdminOverview,
  },
};

// ── Routing ──
let currentSection = null;
let refreshInterval = null;

function handleRoute() {
  const key = sectionKey(window.location.hash, user.role);
  const [role, section] = key.split(':');

  // Titles & breadcrumb
  const titles = navTitles[key] || navTitles[`${role}:overview`] || ['Dashboard', 'HMS'];
  titleEl.textContent = titles[0];
  breadcrumbEl.textContent = titles[1];

  updateActiveNav();
  closeMobileDrawer();
  stopAutoRefresh();

  const renderer = (renderers[role] || {})[section];
  if (!renderer) {
    content.innerHTML = emptyState('⚠️', 'Section not found', 'This view is not available for your role.');
    return;
  }
  renderWithTransition(renderer);
  currentSection = key;
}

async function renderWithTransition(renderer) {
  content.classList.add('section-exit');
  await new Promise(r => setTimeout(r, 120));
  content.classList.remove('section-exit');
  content.innerHTML = skeletonCards(4) + '<div style="height:16px"></div>' + skeletonTable(5);
  content.classList.add('section-enter');
  await new Promise(r => setTimeout(r, 40));
  try {
    await renderer();
  } catch (err) {
    content.innerHTML = emptyState('⚠️', 'Something went wrong', err.message || 'Failed to load this section.');
  }
  content.classList.remove('section-enter');
}

function closeMobileDrawer() {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    toggleOverlay(false);
  }
}

window.addEventListener('hashchange', handleRoute);

// ── Auto-refresh (appointments views) ──
function stopAutoRefresh() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}
function startAutoRefresh(fn, ms = 30_000) {
  stopAutoRefresh();
  refreshInterval = setInterval(() => {
    if (currentSection && fn) {
      fn().catch(() => {});
    }
  }, ms);
}

// ═══════════════════════════════════════════════════════════
// SHARED: appointments tables
// ═══════════════════════════════════════════════════════════
function apptRows(appointments, actions = {}) {
  const { checkin, cancel, consult, view } = actions;
  return appointments.map(a => {
    const btns = [];
    if (view) btns.push(`<button class="btn btn-secondary btn-sm v-btn" data-id="${a.id}" data-pid="${a.patient_id}" data-name="${esc(a.patient_name || '')}">View</button>`);
    if (checkin && a.status === 'scheduled') btns.push(`<button class="btn btn-success btn-sm ci-btn" data-id="${a.id}">Check In</button>`);
    if (consult && a.status === 'checked-in') btns.push(`<button class="btn btn-primary btn-sm cs-btn" data-id="${a.id}" data-pid="${a.patient_id}" data-name="${esc(a.patient_name || '')}">Consult</button>`);
    if (cancel && a.status === 'scheduled') btns.push(`<button class="btn btn-danger btn-sm cx-btn" data-id="${a.id}">Cancel</button>`);
    return {
      cells: [
        `<strong>${esc(a.patient_name || `Patient #${a.patient_id}`)}</strong><br><small class="text-muted">${esc(a.patient_code || '')}</small>`,
        esc(a.doctor_name || `Doctor #${a.doctor_id}`),
        a.start_time || '—',
        statusBadge(a.status),
        sourceBadge(a.source),
        btns.length ? `<div class="flex gap-1">${btns.join('')}</div>` : '—',
      ],
    };
  });
}

function wireApptActions(container, opts = {}) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.classList.contains('ci-btn')) {
      await optimisticStatus(btn, id, 'checked-in', 'Patient checked in!');
    }
    if (btn.classList.contains('cx-btn')) {
      const ok = await showConfirm('Cancel this appointment?');
      if (!ok) return;
      try {
        await api.updateAppointmentStatus(id, 'cancelled');
        invalidatePrefix('appts');
        showToast('Appointment cancelled', 'info');
        if (opts.onChanged) opts.onChanged();
      } catch (err) { showToast(err.message, 'error'); }
    }
    if (btn.classList.contains('cs-btn')) {
      if (opts.onConsult) opts.onConsult(btn.dataset.id, btn.dataset.pid, btn.dataset.name);
    }
    if (btn.classList.contains('v-btn')) {
      if (opts.onView) opts.onView(btn.dataset.pid, btn.dataset.name);
    }
  });
}

// Optimistic status update: change UI immediately, confirm via API
async function optimisticStatus(btn, id, status, successMsg) {
  const row = btn.closest('tr');
  const prev = row ? row.innerHTML : null;
  btn.disabled = true;
  btn.textContent = '…';
  if (row) {
    const badge = row.querySelector('.badge');
    if (badge) badge.outerHTML = statusBadge(status);
    btn.closest('td').innerHTML = statusBadge(status) ? `<span class="badge badge-teal">done</span>` : '';
  }
  try {
    await api.updateAppointmentStatus(id, status);
    invalidatePrefix('appts');
    showToast(successMsg, 'success');
    if (row) {
      setTimeout(() => {
        const td = btn.closest('td');
        if (td) td.innerHTML = '<span class="text-muted" style="font-size:0.75rem">✔ done</span>';
      }, 400);
    }
  } catch (err) {
    if (row && prev) row.innerHTML = prev;
    showToast(err.message, 'error');
  }
}

async function fetchAppointments(params) {
  return cached('appts:' + (params.date || params.status || 'all') + ':' + (params.doctor_id || ''), () => api.listAppointments(params));
}

// ═══════════════════════════════════════════════════════════
// ADMIN / MANAGEMENT
// ═══════════════════════════════════════════════════════════
async function renderAdminOverview() {
  const today = todayStr();
  const [patients, todayAppts, doctors, summary] = await Promise.all([
    cached('patients:all', () => api.listPatients().catch(() => [])),
    fetchAppointments({ date: today }).catch(() => []),
    cached('doctors:all', () => api.listDoctors().catch(() => [])),
    cached('billing:summary:today', () => api.billingSummary('today').catch(() => ({}))),
  ]);
  const role = user.role === 'management' ? 'management' : 'admin';

  content.innerHTML = `
    <div class="stats-grid mb-4">
      <div class="stats-card"><div class="stats-icon" style="background:rgba(59,130,246,0.14);color:#93c5fd">🩺</div>
        <div><span class="stats-value">${patients.length}</span><span class="stats-label">Total Patients</span></div></div>
      <div class="stats-card st-green"><div class="stats-icon" style="background:rgba(34,197,94,0.14);color:#86efac">📅</div>
        <div><span class="stats-value">${todayAppts.length}</span><span class="stats-label">Today's Appointments</span></div></div>
      <div class="stats-card st-teal"><div class="stats-icon" style="background:rgba(20,184,166,0.14);color:#5eead4">💰</div>
        <div><span class="stats-value">${formatRs(summary.collections || 0)}</span><span class="stats-label">Revenue Today</span></div></div>
      <div class="stats-card st-amber"><div class="stats-icon" style="background:rgba(245,158,11,0.14);color:#fcd34d">📄</div>
        <div><span class="stats-value">${summary.pending_invoices ?? 0}</span><span class="stats-label">Pending Invoices</span></div></div>
      <div class="stats-card st-purple"><div class="stats-icon" style="background:rgba(167,139,250,0.14);color:#c4b5fd">👨‍⚕️</div>
        <div><span class="stats-value">${doctors.length}</span><span class="stats-label">Active Doctors</span></div></div>
    </div>

    <div class="section-head"><h3>Today's Appointments</h3>
      <div class="toolbar">
        <button class="btn btn-outline btn-sm" onclick="location.hash='#/dashboard/${role}/appointments'">View all</button>
        <button class="btn btn-outline btn-sm" onclick="location.hash='#/dashboard/${role}/patients'">Patients</button>
      </div>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Patient</th><th>Doctor</th><th>Time</th><th>Status</th><th>Source</th></tr></thead>
      <tbody>${todayAppts.length ? todayAppts.slice(0, 6).map(a => `
        <tr><td><strong>${esc(a.patient_name)}</strong></td><td>${esc(a.doctor_name)}</td>
        <td>${esc(a.start_time)}</td><td>${statusBadge(a.status)}</td><td>${sourceBadge(a.source)}</td></tr>`).join('')
        : `<tr><td colspan="5" class="text-muted text-center">No appointments today</td></tr>`}
      </tbody>
    </table></div>

    <div class="section-head" style="margin-top:20px"><h3>Quick Actions</h3></div>
    <div class="flex gap-2" style="flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="location.hash='#/dashboard/${role}/pharmacy'">💊 Pharmacy</button>
      <button class="btn btn-outline btn-sm" onclick="location.hash='#/dashboard/${role}/billing'">💰 Billing</button>
      <button class="btn btn-outline btn-sm" onclick="location.hash='#/dashboard/${role}/doctors'">👨‍⚕️ Doctors</button>
    </div>
  `;
}

// ── Admin: patients ──
async function renderPatientsView() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Patient Management</h3><div class="sub">Search, edit or deactivate patient records</div></div>
      <div class="toolbar"><div class="search-bar" style="flex:1;min-width:220px">
        <input type="text" id="pSearch" placeholder="Search name, CNIC or phone…">
      </div></div>
    </div>
    <div id="pList">${skeletonTable()}</div>
  `;

  const renderList = (patients) => {
    const rows = patients.map(p => ({
      cells: [
        `<strong>${esc(p.full_name)}</strong><br><small class="text-muted">${esc(p.patient_id)}</small>`,
        esc(p.cnic || '—'),
        esc(p.phone || '—'),
        statusBadge(p.status),
        formatDate(p.created_at),
        `<div class="flex gap-1">
          <button class="btn btn-secondary btn-sm edit-btn" data-id="${p.id}">Edit</button>
          ${p.status === 'active' ? `<button class="btn btn-danger btn-sm deact-btn" data-id="${p.id}" data-name="${esc(p.full_name)}">Deactivate</button>` : ''}
        </div>`,
      ],
    }));
    const wrap = document.getElementById('pList');
    wrap.innerHTML = '';
    if (!patients.length) { wrap.innerHTML = emptyState('🔍', 'No patients found', 'Try a different search term or register a new patient.'); return; }
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(['Name / ID', 'CNIC', 'Phone', 'Status', 'Registered', 'Actions'], rows));
    wrap.appendChild(table);

    wrap.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.classList.contains('edit-btn')) openEditPatient(btn.dataset.id);
      if (btn.classList.contains('deact-btn')) {
        const ok = await showConfirm(`Deactivate ${btn.dataset.name}? They will no longer be bookable.`);
        if (!ok) return;
        try {
          await api.deactivatePatient(btn.dataset.id);
          invalidate('patients:all', 'patients:q:');
          showToast('Patient deactivated', 'info');
          renderPatientsView();
        } catch (err) { showToast(err.message, 'error'); }
      }
    });
  };

  const doSearch = debounce(async () => {
    const q = document.getElementById('pSearch').value.trim();
    if (!q) {
      const data = await cached('patients:all', () => api.listPatients().catch(() => []));
      return renderList(data);
    }
    document.getElementById('pList').innerHTML = skeletonTable();
    try {
      const results = await cached('patients:q:' + q, () => api.listPatients({ name: q }).catch(() => []));
      renderList(results);
    } catch { renderList([]); }
  }, 300);

  document.getElementById('pSearch').addEventListener('input', doSearch);
  const initial = await cached('patients:all', () => api.listPatients().catch(() => []));
  renderList(initial);
}

function openEditPatient(id) {
  const form = document.createElement('form');
  form.innerHTML = `<div id="editFields" class="flex justify-center p-4">${skeletonCards(1)}</div>`;
  const modal = createModal('Edit Patient', form);
  api.getPatient(id).then((p) => {
    document.getElementById('editFields').innerHTML = `
      <div class="form-row w-full">
        ${createFormField('Full Name', 'full_name', 'text', { required: true, value: p.full_name }).outerHTML}
        ${createFormField('CNIC', 'cnic', 'text', { required: true, value: p.cnic }).outerHTML}
      </div>
      <div class="form-row">
        ${createFormField('Phone', 'phone', 'text', { required: true, value: p.phone }).outerHTML}
        ${createFormField('Emergency Contact', 'emergency_contact', 'text', { value: p.emergency_contact }).outerHTML}
      </div>
      ${createFormField('Address', 'address', 'textarea', { value: p.address }).outerHTML}
      <button type="submit" class="btn btn-primary mt-4 w-full">Save Changes</button>
    `;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        full_name: form.full_name.value.trim(),
        cnic: form.cnic.value.trim(),
        phone: form.phone.value.trim(),
        emergency_contact: form.emergency_contact.value.trim(),
        address: form.address.value.trim(),
      };
      try {
        await api.updatePatient(id, data);
        invalidate('patients:all');
        showToast('Patient updated', 'success');
        modal.close();
        renderPatientsView();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }).catch(err => showToast(err.message, 'error'));
}

// ── Admin: doctors ──
async function renderDoctorsView() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Doctors</h3><div class="sub">Schedules and availability</div></div>
    </div>
    <div id="dList">${skeletonCards(3)}</div>
  `;
  const doctors = await cached('doctors:all', () => api.listDoctors().catch(() => []));
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const wrap = document.getElementById('dList');
  wrap.innerHTML = doctors.length ? doctors.map(d => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <div class="user-avatar small" style="background:linear-gradient(135deg,#1e3a8a,#3b82f6)">${esc(initials(d.name))}</div>
          <div>
            <h4>${esc(d.name)}</h4>
            <small class="text-muted">${esc(d.specialization)} · ${esc(d.qualification)} · Fee ${formatRs(d.fee)}</small>
          </div>
        </div>
        <div class="flex gap-2 items-center">
          ${statusBadge(d.status === 'active' ? 'available' : 'unavailable')}
          <button class="btn ${d.status === 'active' ? 'btn-danger' : 'btn-success'} btn-sm av-btn" data-id="${d.id}">
            ${d.status === 'active' ? 'Set Unavailable' : 'Set Available'}
          </button>
        </div>
      </div>
      <div class="card-body">
        ${(d.schedule || []).length ? d.schedule.map(s => `
          <div class="schedule-row">
            <span class="schedule-day">${DAYS[s.day_of_week]}</span>
            <span class="schedule-time">${esc(s.start_time)} – ${esc(s.end_time)}</span>
          </div>`).join('')
          : '<small class="text-muted">No schedule set</small>'}
      </div>
    </div>`).join('') : emptyState('👨‍⚕️', 'No doctors found', 'Add a doctor to get started.');

  wrap.querySelectorAll('.av-btn').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const res = await api.toggleDoctorAvailability(btn.dataset.id);
      invalidate('doctors:all');
      showToast(`${res.name} is now ${res.status === 'active' ? 'available' : 'unavailable'}`, 'info');
      renderDoctorsView();
    } catch (err) { showToast(err.message, 'error'); }
  }));
}

// ── Admin: appointments ──
async function renderAppointmentsView() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>All Appointments</h3><div class="sub">Full schedule across all doctors</div></div>
      <div class="filter-chips" id="statusChips"></div>
    </div>
    <div id="aList">${skeletonTable(6)}</div>
  `;

  const filters = [
    { key: '', label: 'All' },
    { key: todayStr(), label: 'Today' },
    { key: 'scheduled', label: 'Pending' },
    { key: 'checked-in', label: 'Confirmed' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];
  const chips = document.getElementById('statusChips');
  chips.innerHTML = filters.map(f => `<button class="chip ${!f.key ? 'active' : ''}" data-key="${f.key}">${f.label}</button>`).join('');
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderList(chip.dataset.key);
  });

  const renderList = async (filterKey) => {
    const listEl = document.getElementById('aList');
    let data;
    if (filterKey === todayStr()) data = await fetchAppointments({ date: filterKey });
    else if (filterKey) data = await fetchAppointments({ status: filterKey });
    else data = await fetchAppointments({});
    listEl.innerHTML = '';
    if (!data.length) {
      listEl.innerHTML = emptyState('📅', 'No appointments', filterKey === todayStr() ? 'Nothing scheduled for today yet.' : 'No appointments match this filter.');
      return;
    }
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(
      ['Patient', 'Doctor', 'Date', 'Time', 'Status', 'Source', 'Actions'],
      apptRows(data, { cancel: true }),
    ));
    listEl.appendChild(table);
  };

  await renderList('');
  startAutoRefresh(async () => { await renderList(document.querySelector('.chip.active')?.dataset.key || ''); markUpdated(); });
  wireApptActions(document.getElementById('aList'), { onChanged: renderAppointmentsView });
}

// ── Shared: AI event labels, relative time, error banner ──
const EVENT_LABELS = {
  appointment_created: 'Appointment booked',
  patient_created: 'Patient registered',
  faq: 'FAQ answered',
  triage: 'Triage',
  appointment_cancelled: 'Appointment cancelled',
  appointment_rescheduled: 'Appointment rescheduled',
  appointments_list: 'Appointment check',
};
const EVENT_ICONS = {
  appointment_created: '📅',
  patient_created: '🪪',
  faq: '💬',
  triage: '🩺',
  appointment_cancelled: '❌',
  appointment_rescheduled: '🔁',
  appointments_list: '📋',
};

function eventDetailsText(ev) {
  const d = ev.details || {};
  switch (ev.event_type) {
    case 'appointment_created':
      return `${d.patient_name || 'Patient'} → ${d.doctor_name || 'doctor'} · ${d.date || ''} at ${d.time || ''}`;
    case 'patient_created':
      return `${d.full_name || 'Patient'} (${d.patient_id || ''})`;
    case 'faq':
      return `Topic: ${d.topic || 'general'}`;
    case 'triage': {
      const parts = [d.symptom, d.severity ? `severity ${d.severity}/10` : '', d.outcome].filter(Boolean);
      return parts.join(' — ') || '—';
    }
    case 'appointments_list':
      return `${d.count || 0} appointment(s) for patient ${d.patient_id || ''}`;
    default:
      try { return JSON.stringify(d); } catch { return ''; }
  }
}

function relTime(value) {
  const str = String(value || '');
  const iso = str.includes('T') ? str : str.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Inline error banner with a Retry button (dark-theme styled, see dashboard.css)
function errorBanner(message, onRetry) {
  const el = document.createElement('div');
  el.className = 'error-banner';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (onRetry) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = 'Retry';
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '…';
      try { await onRetry(); } finally { btn.disabled = false; btn.textContent = 'Retry'; }
    });
    el.appendChild(btn);
  }
  return el;
}

// ── Admin: AI Operations (live KPI strip + activity feed) ──
async function renderAiOpsView() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>AI Operations</h3><div class="sub">Live activity from the AI receptionist · refreshes automatically</div></div>
      <span class="updated-indicator" style="position:static" id="aiOpsLive"><span class="dot"></span> Live</span>
    </div>
    <div id="aiKpis">${skeletonCards(6)}</div>
    <div class="section-head" style="margin-top:18px">
      <div><h3>Recent Activity</h3></div>
      <div class="filter-chips" id="aiChannelChips">
        <button class="chip active" data-key="">All</button>
        <button class="chip" data-key="chat">💬 Chat</button>
        <button class="chip" data-key="voice">📞 Voice</button>
        <button class="chip" data-key="twilio">📞 Twilio</button>
      </div>
    </div>
    <div id="aiFeed">${skeletonTable(6)}</div>
  `;

  const kpiEl = document.getElementById('aiKpis');
  const feedEl = document.getElementById('aiFeed');
  const chips = document.getElementById('aiChannelChips');
  let activeChannel = '';
  let kpiLoaded = false;
  let feedLoaded = false;

  const renderKpis = async () => {
    if (!kpiLoaded) kpiEl.innerHTML = skeletonCards(6);
    try {
      const o = await api.analyticsOverview('today');
      const ch = o.ai_bookings_by_channel || {};
      kpiEl.innerHTML = `
        <div class="stats-grid">
          <div class="stats-card"><div class="stats-icon" style="background:rgba(59,130,246,0.14);color:#93c5fd">🤖</div>
            <div><span class="stats-value">${o.ai_booked ?? 0}</span><span class="stats-label">AI Bookings (Today)</span></div></div>
          <div class="stats-card st-blue"><div class="stats-icon" style="background:rgba(59,130,246,0.14);color:#93c5fd">💬</div>
            <div><span class="stats-value">${ch.chat ?? 0}</span><span class="stats-label">via Chat</span></div></div>
          <div class="stats-card st-purple"><div class="stats-icon" style="background:rgba(167,139,250,0.14);color:#c4b5fd">📞</div>
            <div><span class="stats-value">${ch.voice ?? 0}</span><span class="stats-label">via Voice</span></div></div>
          <div class="stats-card st-teal"><div class="stats-icon" style="background:rgba(20,184,166,0.14);color:#5eead4">📞</div>
            <div><span class="stats-value">${ch.twilio ?? 0}</span><span class="stats-label">via Twilio</span></div></div>
          <div class="stats-card st-green"><div class="stats-icon" style="background:rgba(34,197,94,0.14);color:#86efac">🪪</div>
            <div><span class="stats-value">${o.patients_registered_via_ai ?? 0}</span><span class="stats-label">Patients via AI</span></div></div>
          <div class="stats-card st-amber"><div class="stats-icon" style="background:rgba(245,158,11,0.14);color:#fcd34d">🧵</div>
            <div><span class="stats-value">${o.ai_sessions ?? 0}</span><span class="stats-label">AI Sessions</span></div></div>
          <div class="stats-card st-purple"><div class="stats-icon" style="background:rgba(167,139,250,0.14);color:#c4b5fd">⚡</div>
            <div><span class="stats-value">${o.ai_booking_conversion ?? 0}%</span><span class="stats-label">Booking Conversion</span></div></div>
        </div>`;
      kpiLoaded = true;
    } catch (err) {
      kpiEl.innerHTML = '';
      kpiEl.appendChild(errorBanner('Could not load AI KPIs — ' + err.message, renderKpis));
    }
  };

  const renderFeed = async () => {
    if (!feedLoaded) feedEl.innerHTML = skeletonTable(5);
    try {
      const params = { limit: 30 };
      if (activeChannel) params.channel = activeChannel;
      const data = await api.aiEvents(params);
      const events = data.events || [];
      feedEl.innerHTML = '';
      if (!events.length) {
        feedEl.innerHTML = emptyState('🤖', 'No AI activity', activeChannel ? `No ${activeChannel} events recorded yet.` : 'The AI receptionist has not handled any interactions yet.');
        feedLoaded = true;
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'activity-feed';
      wrap.innerHTML = events.map(ev => {
        const meta = SOURCE_META[ev.channel] || { label: ev.channel || '—', cls: 'badge-gray' };
        const label = EVENT_LABELS[ev.event_type] || ev.event_type.replace(/_/g, ' ');
        return `
          <div class="activity-item">
            <div class="activity-icon">${EVENT_ICONS[ev.event_type] || '🤖'}</div>
            <div class="activity-main">
              <div class="activity-title"><span class="badge ${meta.cls}">${meta.label}</span> <strong>${esc(label)}</strong></div>
              <div class="activity-sub">${esc(eventDetailsText(ev))}</div>
            </div>
            <span class="activity-time">${relTime(ev.created_at)}</span>
          </div>`;
      }).join('');
      feedEl.appendChild(wrap);
      feedLoaded = true;
    } catch (err) {
      feedEl.innerHTML = '';
      feedEl.appendChild(errorBanner('Could not load AI activity — ' + err.message, renderFeed));
    }
  };

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeChannel = chip.dataset.key;
    renderFeed();
  });

  await Promise.all([renderKpis(), renderFeed()]);
  startAutoRefresh(async () => { await Promise.all([renderKpis(), renderFeed()]); markUpdated(); }, 25_000);
}

// ── Admin + pharmacist: pharmacy ──
async function renderPharmacyView() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Medicine Inventory</h3><div class="sub">Stock levels and low stock alerts</div></div>
      <div class="toolbar"><div class="search-bar" style="min-width:220px">
        <input type="text" id="medSearch" placeholder="Search medicine…">
      </div></div>
    </div>
    <div id="medList">${skeletonTable(6)}</div>
  `;

  const renderList = async (q = '') => {
    const listEl = document.getElementById('medList');
    const data = await cached('meds:' + (q || 'all'), () => api.listMedicines(q ? { q } : {}).catch(() => []));
    listEl.innerHTML = '';
    if (!data.length) { listEl.innerHTML = emptyState('💊', 'No medicines found', q ? 'Try a different search.' : 'Add medicines to the inventory.'); return; }
    listEl.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Medicine</th><th>Batch</th><th>Stock</th><th>Level</th><th>Unit Cost</th><th>Expiry</th><th>Actions</th></tr></thead>
      <tbody>${data.map(m => {
        const low = m.quantity <= m.reorder_threshold;
        const pct = m.reorder_threshold ? Math.min(100, Math.round((m.quantity / (m.reorder_threshold * 3)) * 100)) : 50;
        return `<tr>
          <td><strong>${esc(m.name)}</strong></td>
          <td>${esc(m.batch_number)}</td>
          <td><span class="stock-qty ${low ? (m.quantity === 0 ? 'crit' : 'low') : ''}">${m.quantity}</span></td>
          <td><div class="stat-bar"><div class="bar-track"><div class="bar-fill ${m.quantity === 0 ? 'crit' : low ? 'low' : ''}" style="width:${pct}%"></div></div></div></td>
          <td>${formatRs(m.unit_cost)}</td>
          <td>${esc(m.expiry_date)}</td>
          <td><button class="btn btn-secondary btn-sm rs-btn" data-id="${m.id}" data-name="${esc(m.name)}">Restock</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  };

  const doSearch = debounce(async () => renderList(document.getElementById('medSearch').value.trim()), 300);
  document.getElementById('medSearch').addEventListener('input', doSearch);
  document.getElementById('medList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.rs-btn');
    if (!btn) return;
    const qty = prompt(`Restock ${btn.dataset.name} — quantity to add:`);
    if (!qty || isNaN(qty) || Number(qty) <= 0) return;
    try {
      await api.restockMedicine(btn.dataset.id, Number(qty));
      invalidate('meds:all', 'meds:');
      showToast('Stock updated', 'success');
      renderList(document.getElementById('medSearch').value.trim());
    } catch (err) { showToast(err.message, 'error'); }
  });

  await renderList();
}

// ── Admin + billing: billing view ──
async function renderBillingView() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Billing</h3><div class="sub">Invoices and collections</div></div>
      <button class="btn btn-primary btn-sm" id="newInvBtn">＋ New Invoice</button>
    </div>
    <div id="bSummary">${skeletonCards(3)}</div>
    <div id="bList" style="margin-top:16px">${skeletonTable(6)}</div>
  `;

  const [summary, invoices] = await Promise.all([
    cached('billing:summary:today', () => api.billingSummary('today').catch(() => ({}))),
    cached('billing:invoices:all', () => api.listInvoices().catch(() => [])),
  ]);

  document.getElementById('bSummary').innerHTML = `
    <div class="stats-grid">
      <div class="stats-card st-green"><div class="stats-icon" style="background:rgba(34,197,94,0.14);color:#86efac">💰</div>
        <div><span class="stats-value">${formatRs(summary.collections || 0)}</span><span class="stats-label">Collections Today</span></div></div>
      <div class="stats-card st-amber"><div class="stats-icon" style="background:rgba(245,158,11,0.14);color:#fcd34d">📄</div>
        <div><span class="stats-value">${summary.pending_invoices ?? 0}</span><span class="stats-label">Pending Invoices</span></div></div>
      <div class="stats-card st-teal"><div class="stats-icon" style="background:rgba(20,184,166,0.14);color:#5eead4">✅</div>
        <div><span class="stats-value">${summary.paid_invoices ?? 0}</span><span class="stats-label">Paid Invoices</span></div></div>
    </div>`;

  const listEl = document.getElementById('bList');
  listEl.innerHTML = '';
  if (!invoices.length) { listEl.innerHTML = emptyState('💰', 'No invoices yet', 'Create an invoice to get started.'); }
  else {
    const rows = invoices.map(inv => ({
      cells: [
        `<strong>${esc(inv.invoice_number)}</strong>`,
        esc(inv.patient_name || '—'),
        formatDate(inv.created_at),
        formatRs(inv.total),
        statusBadge(inv.status),
        (inv.status === 'paid' || inv.status === 'cancelled')
          ? '—'
          : `<button class="btn btn-success btn-sm pay-btn" data-id="${inv.id}" data-amt="${inv.total}">Record Payment</button>`,
      ],
    }));
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(['Invoice', 'Patient', 'Date', 'Total', 'Status', 'Action'], rows));
    listEl.appendChild(table);

    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.pay-btn');
      if (!btn) return;
      const amt = prompt(`Enter payment amount (max ${btn.dataset.amt}):`, btn.dataset.amt);
      if (!amt || isNaN(amt) || Number(amt) <= 0) return;
      try {
        const res = await api.payInvoice(btn.dataset.id, Number(amt), 'cash');
        invalidate('billing:invoices:all', 'billing:summary:today', 'billing:summary:week', 'billing:summary:month', 'billing:collections');
        showToast(`Payment recorded — invoice ${res.status}`, 'success');
        renderBillingView();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  document.getElementById('newInvBtn').addEventListener('click', openCreateInvoice);
}

function openCreateInvoice() {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="form-field">
      <label for="invPatient">Patient <span class="required">*</span></label>
      <input type="text" id="invPatient" placeholder="Search by name, CNIC or phone…" autocomplete="off">
      <input type="hidden" id="invPatientId">
      <small class="form-help" id="invPatientHint"></small>
    </div>
    <div class="form-field"><label>Line Items</label><div id="invItems"></div>
      <button type="button" class="btn btn-outline btn-sm mt-2" id="addItemBtn">＋ Add item</button>
    </div>
    <button type="submit" class="btn btn-primary w-full mt-4">Create Invoice</button>
  `;
  const modal = createModal('Create Invoice', form);

  function addItemRow(description = '', price = '') {
    const row = document.createElement('div');
    row.className = 'flex gap-2 mb-2';
    row.innerHTML = `
      <input type="text" class="item-desc" placeholder="Description" value="${esc(description)}" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;color:var(--text)">
      <input type="number" class="item-qty" value="1" min="1" style="width:56px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 6px;color:var(--text)">
      <input type="number" class="item-price" placeholder="Rs." value="${esc(price)}" style="width:90px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 6px;color:var(--text)">
      <button type="button" class="btn btn-danger btn-sm rm-item">✕</button>`;
    row.querySelector('.rm-item').addEventListener('click', () => row.remove());
    document.getElementById('invItems').appendChild(row);
  }

  addItemRow('Consultation', '1500');
  document.getElementById('addItemBtn').addEventListener('click', () => addItemRow());
  const patientLookup = document.getElementById('invPatient');
  let lt;
  patientLookup.addEventListener('input', () => {
    clearTimeout(lt);
    lt = setTimeout(async () => {
      const q = patientLookup.value.trim();
      if (q.length < 2) return;
      try {
        const res = await api.listPatients({ name: q });
        if (res.length) {
          document.getElementById('invPatientId').value = res[0].id;
          document.getElementById('invPatientHint').textContent = `Found: ${res[0].full_name} (${res[0].patient_id})`;
        }
      } catch {}
    }, 300);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patientId = document.getElementById('invPatientId').value;
    const items = [...document.querySelectorAll('#invItems > div')].map(r => ({
      description: r.querySelector('.item-desc').value.trim(),
      quantity: Number(r.querySelector('.item-qty').value) || 1,
      unit_price: Number(r.querySelector('.item-price').value) || 0,
    })).filter(i => i.description);
    if (!patientId) return showToast('Please select a patient', 'warning');
    if (!items.length) return showToast('Add at least one line item', 'warning');
    try {
      await api.createInvoice({ patient_id: Number(patientId), items });
      invalidate('billing:invoices:all', 'billing:summary:today');
      showToast('Invoice created', 'success');
      modal.close();
      renderBillingView();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════
// RECEPTIONIST
// ═══════════════════════════════════════════════════════════
async function renderTodayView() {
  const today = todayStr();
  content.innerHTML = `
    <div id="recStats">${skeletonCards(4)}</div>
    <div class="section-head" style="margin-top:18px">
      <div><h3>Today's Appointments</h3><div class="sub">${formatDate(today)}</div></div>
      <div class="toolbar">
        <button class="btn btn-outline btn-sm" id="regBtn">＋ Register Patient</button>
        <button class="btn btn-primary btn-sm" id="bookBtn">📝 Book Appointment</button>
      </div>
    </div>
    <div id="recList">${skeletonTable(5)}</div>
  `;

  document.getElementById('regBtn').addEventListener('click', () => window.location.hash = '#/dashboard/receptionist/register');
  document.getElementById('bookBtn').addEventListener('click', () => window.location.hash = '#/dashboard/receptionist/book');

  const renderList = async () => {
    const appointments = await fetchAppointments({ date: today });
    document.getElementById('recStats').innerHTML = `
      <div class="stats-grid">
        <div class="stats-card"><div class="stats-icon" style="background:rgba(59,130,246,0.14);color:#93c5fd">📅</div>
          <div><span class="stats-value">${appointments.length}</span><span class="stats-label">Today's Appointments</span></div></div>
        <div class="stats-card st-green"><div class="stats-icon" style="background:rgba(34,197,94,0.14);color:#86efac">✅</div>
          <div><span class="stats-value">${appointments.filter(a => a.status === 'checked-in').length}</span><span class="stats-label">Checked In</span></div></div>
        <div class="stats-card st-amber"><div class="stats-icon" style="background:rgba(245,158,11,0.14);color:#fcd34d">⏳</div>
          <div><span class="stats-value">${appointments.filter(a => a.status === 'scheduled').length}</span><span class="stats-label">Pending</span></div></div>
        <div class="stats-card st-teal"><div class="stats-icon" style="background:rgba(20,184,166,0.14);color:#5eead4">✔️</div>
          <div><span class="stats-value">${appointments.filter(a => a.status === 'completed').length}</span><span class="stats-label">Completed</span></div></div>
      </div>`;

    const listEl = document.getElementById('recList');
    listEl.innerHTML = '';
    if (!appointments.length) {
      listEl.innerHTML = emptyState('🎉', 'No appointments today', 'Enjoy the quiet — or book the next appointment.');
      return;
    }
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(
      ['Patient', 'Doctor', 'Time', 'Status', 'Source', 'Actions'],
      apptRows(appointments, { checkin: true, cancel: true }),
    ));
    listEl.appendChild(table);
  };

  await renderList();
  startAutoRefresh(async () => { await renderList(); markUpdated(); });
  wireApptActions(document.getElementById('recList'), { onChanged: renderTodayView });
}

// ── Receptionist: patient directory ──
async function renderPatientDirectory() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Patient Directory</h3><div class="sub">Search by name, CNIC or phone</div></div>
      <div class="toolbar"><div class="search-bar" style="min-width:240px">
        <input type="text" id="pdSearch" placeholder="Search…">
      </div></div>
    </div>
    <div id="pdList">${skeletonTable(5)}</div>
  `;

  const renderList = async (patients) => {
    const listEl = document.getElementById('pdList');
    listEl.innerHTML = '';
    if (!patients.length) { listEl.innerHTML = emptyState('🔍', 'No patients found', 'Try searching by name, CNIC or phone number.'); return; }
    const rows = patients.map(p => ({
      cells: [
        `<strong>${esc(p.full_name)}</strong><br><small class="text-muted">${esc(p.patient_id)}</small>`,
        esc(p.cnic || '—'),
        esc(p.phone || '—'),
        statusBadge(p.status),
        `<button class="btn btn-secondary btn-sm view-btn" data-id="${p.id}" data-name="${esc(p.full_name)}">View</button>`,
      ],
    }));
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(['Patient', 'CNIC', 'Phone', 'Status', 'Actions'], rows));
    listEl.appendChild(table);
    listEl.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => viewPatientDetails(btn.dataset.id, btn.dataset.name)));
  };

  const doSearch = debounce(async () => {
    const q = document.getElementById('pdSearch').value.trim();
    document.getElementById('pdList').innerHTML = skeletonTable();
    if (!q) {
      const data = await cached('patients:all', () => api.listPatients().catch(() => []));
      return renderList(data);
    }
    const [byName, byCnic, byPhone] = await Promise.all([
      api.listPatients({ name: q }).catch(() => []),
      api.listPatients({ cnic: q }).catch(() => []),
      api.listPatients({ phone: q }).catch(() => []),
    ]);
    const seen = new Set();
    const merged = [...byName, ...byCnic, ...byPhone].filter(p => !seen.has(p.id) && seen.add(p.id));
    renderList(merged);
  }, 300);
  document.getElementById('pdSearch').addEventListener('input', doSearch);

  const initial = await cached('patients:all', () => api.listPatients().catch(() => []));
  renderList(initial);
}

async function viewPatientDetails(id, name) {
  const modal = createModal(`Patient: ${name}`, '<div class="p-4">Loading…</div>');
  try {
    const p = await api.getPatient(id);
    modal.body.innerHTML = `
      <div class="flex items-center gap-3 mb-4">
        <div class="user-avatar">${esc(initials(p.full_name))}</div>
        <div><strong>${esc(p.full_name)}</strong><br><small class="text-muted">${esc(p.patient_id)} · ${statusBadge(p.status)}</small></div>
      </div>
      <div class="form-row">
        <div><small class="text-muted">CNIC</small><div>${esc(p.cnic)}</div></div>
        <div><small class="text-muted">Phone</small><div>${esc(p.phone)}</div></div>
        <div><small class="text-muted">DOB</small><div>${esc(p.dob)}</div></div>
        <div><small class="text-muted">Gender</small><div>${esc(p.gender)}</div></div>
      </div>
      <div style="margin-top:14px"><small class="text-muted">Address</small><div>${esc(p.address)}</div></div>
      <div style="margin-top:14px"><strong>Visit History</strong></div>
      ${(p.visit_history || []).length ? p.visit_history.map(v => `
        <div class="list-item" style="margin-top:8px">
          <div class="item-main">
            <div class="item-title">${esc(v.doctor_name)}</div>
            <div class="item-sub">${esc(v.date)} · ${esc(v.start_time)}</div>
          </div>${statusBadge(v.status)}
        </div>`).join('') : '<small class="text-muted">No visits yet</small>'}
    `;
  } catch (err) {
    modal.body.innerHTML = `<p class="text-muted">${esc(err.message)}</p>`;
  }
}

// ── Receptionist: register patient ──
function renderRegisterPatient() {
  content.innerHTML = `
    <div class="card" style="max-width:720px">
      <div class="card-header"><h4>Register New Patient</h4></div>
      <div class="card-body">
        <form id="regForm" novalidate>
          <div class="form-row">
            ${createFormField('Full Name', 'full_name', 'text', { required: true, placeholder: 'Patient full name' }).outerHTML}
            ${createFormField('CNIC', 'cnic', 'text', { required: true, placeholder: 'XXXXX-XXXXXXX-X', help: 'Format: XXXXX-XXXXXXX-X' }).outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('Date of Birth', 'dob', 'date', { required: true }).outerHTML}
            ${createFormField('Gender', 'gender', 'select', { required: true, options: [{label:'Male',value:'male'},{label:'Female',value:'female'},{label:'Other',value:'other'}] }).outerHTML}
          </div>
          <div class="form-row">
            ${createFormField('Phone', 'phone', 'text', { required: true, placeholder: '0300-1234567' }).outerHTML}
            ${createFormField('Emergency Contact', 'emergency_contact', 'text', { required: true, placeholder: 'Emergency phone' }).outerHTML}
          </div>
          ${createFormField('Address', 'address', 'textarea', { required: true, placeholder: 'Full address' }).outerHTML}
          <div class="flex gap-2">
            <button type="submit" class="btn btn-primary">Register Patient</button>
            <button type="button" class="btn btn-secondary" onclick="location.hash='#/dashboard/receptionist'">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('regForm');
  const validators = {
    cnic: (v) => /^\d{5}-\d{7}-\d{1}$/.test(v.trim()),
    phone: (v) => /^03\d{2}-?\d{7}$/.test(v.trim()) || /^\+?\d{10,13}$/.test(v.trim()),
    dob: (v) => !!v && new Date(v) <= new Date(),
  };
  const errFor = { cnic: 'CNIC must be in format XXXXX-XXXXXXX-X', phone: 'Phone must be like 0300-1234567', dob: 'Date of birth cannot be in the future' };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      full_name: form.full_name.value.trim(),
      cnic: form.cnic.value.trim(),
      dob: form.dob.value,
      gender: form.gender.value,
      phone: form.phone.value.trim(),
      address: form.address.value.trim(),
      emergency_contact: form.emergency_contact.value.trim(),
    };
    for (const field of ['full_name', 'cnic', 'dob', 'gender', 'phone', 'address', 'emergency_contact']) {
      if (!data[field]) return showToast(`Please fill in ${field.replace(/_/g, ' ')}`, 'warning');
    }
    if (!validators.cnic(data.cnic)) return showToast(errFor.cnic, 'warning');
    if (!validators.phone(data.phone)) return showToast(errFor.phone, 'warning');
    if (!validators.dob(data.dob)) return showToast(errFor.dob, 'warning');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Registering…';
    try {
      const result = await api.createPatient(data);
      invalidate('patients:all', 'patients:q:');
      showToast(`Patient registered! ID: ${result.patient_id}`, 'success');
      window.location.hash = '#/dashboard/receptionist/patients';
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Register Patient';
      showToast(err.message, 'error');
    }
  });
}

// ── Receptionist: book appointment ──
async function renderBookAppointment() {
  content.innerHTML = `
    <div class="card" style="max-width:720px">
      <div class="card-header"><h4>Book Appointment</h4></div>
      <div class="card-body">
        <form id="bookForm" novalidate>
          <div class="form-field">
            <label for="patientLookup">Patient <span class="required">*</span></label>
            <input type="text" id="patientLookup" placeholder="Search by name, CNIC or phone…" autocomplete="off">
            <input type="hidden" id="patientId">
            <small class="form-help" id="patientHint">Search for an existing patient first.</small>
          </div>
          <div class="form-row">
            <div class="form-field" id="docField"><label>Loading doctors…</label></div>
            <div class="form-field">
              <label for="bkDate">Date <span class="required">*</span></label>
              <input type="date" id="bkDate" required min="${todayStr()}">
            </div>
          </div>
          <div class="form-field" id="slotsWrap" style="display:none">
            <label>Available Slots</label>
            <div id="slotsList" class="flex gap-2" style="flex-wrap:wrap"></div>
          </div>
          <div class="flex gap-2 mt-4">
            <button type="submit" class="btn btn-primary" id="bookSubmit" disabled>Book Appointment</button>
            <button type="button" class="btn btn-secondary" onclick="location.hash='#/dashboard/receptionist'">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const doctors = await cached('doctors:all', () => api.listDoctors().catch(() => []));
  document.getElementById('docField').innerHTML = createFormField('Doctor', 'doctor_id', 'select', {
    required: true,
    options: doctors.map(d => ({ label: `${d.name} — ${d.specialization} (${formatRs(d.fee)})`, value: d.id })),
  }).outerHTML;

  const doctorSelect = document.querySelector('[name="doctor_id"]');
  const dateInput = document.getElementById('bkDate');
  const slotsWrap = document.getElementById('slotsWrap');
  const slotsList = document.getElementById('slotsList');
  const bookSubmit = document.getElementById('bookSubmit');
  const patientLookup = document.getElementById('patientLookup');
  let selectedTime = null;

  const fetchSlots = async () => {
    const doctorId = doctorSelect.value;
    const date = dateInput.value;
    if (!doctorId || !date) return;
    slotsWrap.style.display = 'block';
    slotsList.innerHTML = '<span class="text-muted">Loading slots…</span>';
    try {
      const data = await api.getDoctorSlots(doctorId, date);
      const available = (data.slots || []).filter(s => s.available);
      if (!available.length) {
        slotsList.innerHTML = '<span class="text-muted">No available slots for this date</span>';
        bookSubmit.disabled = true;
        return;
      }
      slotsList.innerHTML = available.map(s => `
        <button type="button" class="btn btn-outline btn-sm slot-btn" data-time="${esc(s.start_time)}">${esc(s.start_time)}</button>
      `).join('');
      slotsList.querySelectorAll('.slot-btn').forEach(btn => btn.addEventListener('click', () => {
        slotsList.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
        selectedTime = btn.dataset.time;
        bookSubmit.disabled = false;
      }));
    } catch { slotsList.innerHTML = '<span class="text-muted">Could not load slots</span>'; }
  };
  doctorSelect.addEventListener('change', fetchSlots);
  dateInput.addEventListener('change', fetchSlots);

  let lt;
  patientLookup.addEventListener('input', () => {
    clearTimeout(lt);
    lt = setTimeout(async () => {
      const q = patientLookup.value.trim();
      if (q.length < 2) return;
      try {
        const results = await api.listPatients({ name: q });
        if (results.length) {
          document.getElementById('patientId').value = results[0].id;
          document.getElementById('patientHint').textContent = `✓ ${results[0].full_name} (${results[0].patient_id})`;
        } else {
          document.getElementById('patientHint').textContent = 'No patient found — register them first.';
        }
      } catch {}
    }, 300);
  });

  document.getElementById('bookForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const patientId = document.getElementById('patientId').value;
    const doctorId = doctorSelect.value;
    const date = dateInput.value;
    if (!patientId) return showToast('Please search and select a patient', 'warning');
    if (!doctorId || !date || !selectedTime) return showToast('Please choose doctor, date and a slot', 'warning');
    bookSubmit.disabled = true;
    try {
      await api.createAppointment({ patient_id: Number(patientId), doctor_id: Number(doctorId), date, start_time: selectedTime });
      invalidatePrefix('appts');
      showToast('Appointment booked!', 'success');
      window.location.hash = '#/dashboard/receptionist';
    } catch (err) {
      bookSubmit.disabled = false;
      showToast(err.message, 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════════
// DOCTOR
// ═══════════════════════════════════════════════════════════
async function findMyDoctor() {
  try {
    const doctors = await cached('doctors:all', () => api.listDoctors().catch(() => []));
    const match = doctors.find(d => (d.name || '').toLowerCase() === (user.name || '').toLowerCase());
    return match || null;
  } catch { return null; }
}

async function renderDoctorAppointments() {
  const today = todayStr();
  const myDoc = await findMyDoctor();
  content.innerHTML = `
    <div class="section-head">
      <div><h3>My Appointments</h3><div class="sub">${myDoc ? esc(myDoc.name) + ' · ' + esc(myDoc.specialization) : ''} · ${formatDate(today)}</div></div>
    </div>
    <div id="docStats">${skeletonCards(3)}</div>
    <div id="docList" style="margin-top:16px">${skeletonTable(5)}</div>
  `;

  const renderList = async () => {
    const appointments = myDoc
      ? await fetchAppointments({ doctor_id: myDoc.id, date: today })
      : [];
    document.getElementById('docStats').innerHTML = `
      <div class="stats-grid">
        <div class="stats-card"><div class="stats-icon" style="background:rgba(59,130,246,0.14);color:#93c5fd">📅</div>
          <div><span class="stats-value">${appointments.length}</span><span class="stats-label">Today</span></div></div>
        <div class="stats-card st-amber"><div class="stats-icon" style="background:rgba(245,158,11,0.14);color:#fcd34d">⏳</div>
          <div><span class="stats-value">${appointments.filter(a => a.status === 'scheduled').length}</span><span class="stats-label">Waiting</span></div></div>
        <div class="stats-card st-teal"><div class="stats-icon" style="background:rgba(20,184,166,0.14);color:#5eead4">✔️</div>
          <div><span class="stats-value">${appointments.filter(a => a.status === 'completed').length}</span><span class="stats-label">Completed</span></div></div>
      </div>`;
    const listEl = document.getElementById('docList');
    listEl.innerHTML = '';
    if (!appointments.length) {
      listEl.innerHTML = emptyState('📅', 'No appointments today', myDoc ? 'Your schedule is clear for today.' : 'No doctor record matched your account.');
      return;
    }
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(
      ['Patient', 'Time', 'Status', 'Source', 'Actions'],
      apptRows(appointments, { checkin: true, consult: true }),
    ));
    listEl.appendChild(table);
  };

  await renderList();
  startAutoRefresh(async () => { await renderList(); markUpdated(); });
  wireApptActions(document.getElementById('docList'), {
    onConsult: (apptId, patientId, patientName) => openConsultationModal(apptId, patientId, patientName),
  });
}

function openConsultationModal(appointmentId, patientId, patientName) {
  const form = document.createElement('form');
  form.innerHTML = `
    <p style="margin-bottom:10px"><strong>Patient:</strong> ${esc(patientName || 'Patient #' + patientId)}</p>
    <div class="form-row">
      ${createFormField('Diagnosis', 'diagnosis', 'textarea', { required: true, placeholder: 'Enter diagnosis' }).outerHTML}
    </div>
    <div class="form-row">
      ${createFormField('Notes', 'notes', 'textarea', { placeholder: 'Consultation notes' }).outerHTML}
      ${createFormField('Vitals', 'vitals', 'text', { placeholder: 'e.g. BP 120/80, Temp 98.6F' }).outerHTML}
    </div>
    <div class="form-field"><label>Prescription</label><div id="rxItems"></div>
      <button type="button" class="btn btn-outline btn-sm mt-2" id="addRx">＋ Add medicine</button>
    </div>
    <button type="submit" class="btn btn-primary mt-4 w-full">Save & Complete</button>
  `;
  const modal = createModal('Record Consultation', form);

  function addRxRow(name = '') {
    const row = document.createElement('div');
    row.className = 'flex gap-2 mb-2';
    row.innerHTML = `
      <input type="text" class="rx-name" placeholder="Medicine" value="${esc(name)}" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;color:var(--text)">
      <input type="text" class="rx-dose" placeholder="Dose" style="width:80px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 6px;color:var(--text)">
      <input type="text" class="rx-freq" placeholder="Freq" style="width:100px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 6px;color:var(--text)">
      <button type="button" class="btn btn-danger btn-sm rm-rx">✕</button>`;
    row.querySelector('.rm-rx').addEventListener('click', () => row.remove());
    document.getElementById('rxItems').appendChild(row);
  }
  addRxRow();
  document.getElementById('addRx').addEventListener('click', () => addRxRow());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prescription = [...document.querySelectorAll('#rxItems > div')]
      .map(r => ({ medicine_name: r.querySelector('.rx-name').value.trim(), dosage: r.querySelector('.rx-dose').value.trim(), frequency: r.querySelector('.rx-freq').value.trim() }))
      .filter(r => r.medicine_name);
    try {
      await api.createConsultation({
        appointment_id: Number(appointmentId),
        diagnosis: form.diagnosis.value.trim(),
        notes: form.notes.value.trim(),
        vitals: form.vitals.value.trim() || '{}',
        prescription,
      });
      invalidatePrefix('appts');
      showToast('Consultation recorded!', 'success');
      modal.close();
      renderDoctorAppointments();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

async function renderDoctorHistory() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Patient History</h3><div class="sub">Search a patient to view past consultations & prescriptions</div></div>
      <div class="toolbar"><div class="search-bar" style="min-width:240px">
        <input type="text" id="histSearch" placeholder="Search patient…">
      </div></div>
    </div>
    <div id="histList">${emptyState('🔍', 'Search for a patient', 'Enter a patient name to see their consultation history.')}</div>
  `;

  const doSearch = debounce(async () => {
    const q = document.getElementById('histSearch').value.trim();
    const listEl = document.getElementById('histList');
    if (q.length < 2) { listEl.innerHTML = emptyState('🔍', 'Search for a patient', 'Enter a patient name to see their consultation history.'); return; }
    listEl.innerHTML = skeletonCards(2);
    try {
      const patients = await api.listPatients({ name: q });
      if (!patients.length) { listEl.innerHTML = emptyState('🔍', 'No patient found', 'No patient matches that name.'); return; }
      const p = patients[0];
      const consultations = await api.listConsultations({ patient_id: p.id }).catch(() => []);
      listEl.innerHTML = `
        <div class="card" style="margin-bottom:12px">
          <div class="card-header">
            <div class="flex items-center gap-2">
              <div class="user-avatar small">${esc(initials(p.full_name))}</div>
              <div><h4>${esc(p.full_name)}</h4><small class="text-muted">${esc(p.patient_id)} · ${esc(p.cnic)} · ${esc(p.phone)}</small></div>
            </div>
          </div>
        </div>
        ${consultations.length ? consultations.map(c => `
          <div class="card" style="margin-bottom:10px">
            <div class="card-header"><h4>${formatDate(c.appointment_date)} · ${esc(c.start_time || '')}</h4>${statusBadge(c.prescription_status || '—')}</div>
            <div class="card-body">
              <p style="margin-bottom:6px"><strong>Diagnosis:</strong> ${esc(c.diagnosis)}</p>
              ${c.notes ? `<p class="text-muted" style="font-size:0.84rem;margin-bottom:6px">${esc(c.notes)}</p>` : ''}
              ${(c.prescription_items || []).length ? `<div style="margin-top:6px"><small class="text-muted" style="text-transform:uppercase;letter-spacing:0.08em;font-size:0.66rem">Prescription</small>${c.prescription_items.map(i => `
                <div class="schedule-row"><span class="schedule-day" style="width:auto">${esc(i.medicine_name)}</span><span class="schedule-time">${esc(i.dosage)} · ${esc(i.frequency)} · ${esc(i.duration)}</span></div>`).join('')}</div>` : ''}
            </div>
          </div>`).join('') : emptyState('📋', 'No consultation history', 'This patient has no recorded consultations yet.')}
      `;
    } catch (err) { listEl.innerHTML = emptyState('⚠️', 'Search failed', err.message); }
  }, 300);
  document.getElementById('histSearch').addEventListener('input', doSearch);
}

// ═══════════════════════════════════════════════════════════
// PHARMACIST
// ═══════════════════════════════════════════════════════════
async function renderPharmacistPrescriptions() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Pending Prescriptions</h3><div class="sub">Prescriptions awaiting dispensing</div></div>
    </div>
    <div id="rxList">${skeletonTable(5)}</div>
  `;

  const renderList = async () => {
    const prescriptions = await cached('rx:pending', () => api.listPrescriptions({ status: 'pending' }).catch(() => []));
    const listEl = document.getElementById('rxList');
    listEl.innerHTML = '';
    if (!prescriptions.length) { listEl.innerHTML = emptyState('💊', 'No pending prescriptions', 'All prescriptions have been dispensed. Great work!'); return; }
    listEl.innerHTML = prescriptions.map(rx => `
      <div class="list-item" data-id="${rx.id}">
        <div class="item-main">
          <div class="item-title">${esc(rx.patient_name)} · ${esc(rx.patient_code)}</div>
          <div class="item-sub">${esc(rx.doctor_name)} · ${esc(rx.diagnosis || '')} · ${formatDate(rx.created_at)}</div>
          <div style="margin-top:6px">${(rx.items || []).map(i => `<span class="badge badge-blue" style="margin-right:4px;margin-top:3px">${esc(i.medicine_name)} ${esc(i.dosage)}</span>`).join('')}</div>
        </div>
        <button class="btn btn-success btn-sm disp-btn" data-id="${rx.id}" data-name="${esc(rx.patient_name)}">Dispense</button>
      </div>`).join('');

    listEl.querySelectorAll('.disp-btn').forEach(btn => btn.addEventListener('click', async () => {
      const item = btn.closest('.list-item');
      btn.disabled = true; btn.textContent = '…';
      // optimistic
      item.style.opacity = '0.45';
      try {
        await api.dispensePrescription(btn.dataset.id);
        invalidate('rx:pending', 'rx:all', 'meds:all', 'meds:');
        showToast(`Prescription dispensed for ${btn.dataset.name}`, 'success');
        item.remove();
        if (!listEl.querySelector('.list-item')) listEl.innerHTML = emptyState('💊', 'No pending prescriptions', 'All prescriptions have been dispensed. Great work!');
      } catch (err) {
        item.style.opacity = '1';
        btn.disabled = false; btn.textContent = 'Dispense';
        showToast(err.message, 'error');
      }
    }));
  };
  await renderList();
  startAutoRefresh(async () => { await renderList(); markUpdated(); });
}

async function renderPharmacistInventory() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Inventory</h3><div class="sub">All medicines in stock</div></div>
      <div class="toolbar"><div class="search-bar" style="min-width:220px">
        <input type="text" id="invSearch" placeholder="Search medicine…">
      </div></div>
    </div>
    <div id="invList">${skeletonTable(6)}</div>
  `;
  const renderList = async (q = '') => {
    const data = await cached('meds:' + (q || 'all'), () => api.listMedicines(q ? { q } : {}).catch(() => []));
    const listEl = document.getElementById('invList');
    listEl.innerHTML = '';
    if (!data.length) { listEl.innerHTML = emptyState('💊', 'No medicines', q ? 'Try a different search.' : 'Inventory is empty.'); return; }
    listEl.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Medicine</th><th>Batch</th><th>Stock</th><th>Unit Cost</th><th>Expiry</th><th>Actions</th></tr></thead>
      <tbody>${data.map(m => `
        <tr>
          <td><strong>${esc(m.name)}</strong></td>
          <td>${esc(m.batch_number)}</td>
          <td><span class="stock-qty ${m.quantity <= m.reorder_threshold ? (m.quantity === 0 ? 'crit' : 'low') : ''}">${m.quantity}</span></td>
          <td>${formatRs(m.unit_cost)}</td>
          <td>${esc(m.expiry_date)}</td>
          <td><button class="btn btn-secondary btn-sm rs-btn" data-id="${m.id}" data-name="${esc(m.name)}">Restock</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  };
  const doSearch = debounce(async () => renderList(document.getElementById('invSearch').value.trim()), 300);
  document.getElementById('invSearch').addEventListener('input', doSearch);
  document.getElementById('invList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.rs-btn');
    if (!btn) return;
    const qty = prompt(`Restock ${btn.dataset.name} — quantity to add:`);
    if (!qty || isNaN(qty) || Number(qty) <= 0) return;
    try {
      await api.restockMedicine(btn.dataset.id, Number(qty));
      invalidate('meds:all', 'meds:');
      showToast('Stock updated', 'success');
      renderList(document.getElementById('invSearch').value.trim());
    } catch (err) { showToast(err.message, 'error'); }
  });
  await renderList();
}

async function renderPharmacistLowStock() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Low Stock Alerts</h3><div class="sub">Items at or below their reorder level</div></div>
    </div>
    <div id="lowList">${skeletonTable(5)}</div>
  `;
  const data = await cached('meds:low', () => api.listMedicines({ low: 1 }).catch(() => []));
  const listEl = document.getElementById('lowList');
  listEl.innerHTML = '';
  if (!data.length) {
    listEl.innerHTML = emptyState('✅', 'All stocked up', 'No medicines are below their reorder level.');
    return;
  }
  listEl.innerHTML = data.map(m => `
    <div class="list-item">
      <div class="item-main">
        <div class="item-title">${esc(m.name)}</div>
        <div class="item-sub">Batch ${esc(m.batch_number)} · Reorder at ${m.reorder_threshold} · Expires ${esc(m.expiry_date)}</div>
      </div>
      <span class="stock-qty ${m.quantity === 0 ? 'crit' : 'low'}" style="font-size:1.1rem">${m.quantity} left</span>
      <button class="btn btn-secondary btn-sm rs-btn" data-id="${m.id}" data-name="${esc(m.name)}">Restock</button>
    </div>`).join('');
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.rs-btn');
    if (!btn) return;
    const qty = prompt(`Restock ${btn.dataset.name} — quantity to add:`);
    if (!qty || isNaN(qty) || Number(qty) <= 0) return;
    try {
      await api.restockMedicine(btn.dataset.id, Number(qty));
      invalidate('meds:low', 'meds:all', 'meds:');
      showToast('Stock updated', 'success');
      renderPharmacistLowStock();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════
// BILLING
// ═══════════════════════════════════════════════════════════
async function renderBillingInvoices() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Invoices</h3><div class="sub">All invoices with payment status</div></div>
      <div class="toolbar">
        <div class="filter-chips" id="invChips">
          <button class="chip active" data-key="">All</button>
          <button class="chip" data-key="pending">Pending</button>
          <button class="chip" data-key="paid">Paid</button>
          <button class="chip" data-key="cancelled">Cancelled</button>
        </div>
        <button class="btn btn-primary btn-sm" id="newInvBtn2">＋ New Invoice</button>
      </div>
    </div>
    <div id="invList">${skeletonTable(6)}</div>
  `;

  const renderList = async (filterKey) => {
    const data = await cached('billing:invoices:' + (filterKey || 'all'), () => api.listInvoices(filterKey ? { status: filterKey } : {}).catch(() => []));
    const listEl = document.getElementById('invList');
    listEl.innerHTML = '';
    if (!data.length) { listEl.innerHTML = emptyState('💰', 'No invoices', 'No invoices match this filter.'); return; }
    const rows = data.map(inv => ({
      cells: [
        `<strong>${esc(inv.invoice_number)}</strong>`,
        esc(inv.patient_name || '—'),
        formatDate(inv.created_at),
        formatRs(inv.total),
        statusBadge(inv.status),
        (inv.status === 'paid' || inv.status === 'cancelled')
          ? '—'
          : `<button class="btn btn-success btn-sm pay-btn" data-id="${inv.id}" data-amt="${inv.total}">Record Payment</button>`,
      ],
    }));
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(['Invoice', 'Patient', 'Date', 'Total', 'Status', 'Action'], rows));
    listEl.appendChild(table);
  };

  document.getElementById('invChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#invChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderList(chip.dataset.key);
  });

  document.getElementById('invList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.pay-btn');
    if (!btn) return;
    const amt = prompt(`Enter payment amount (max ${btn.dataset.amt}):`, btn.dataset.amt);
    if (!amt || isNaN(amt) || Number(amt) <= 0) return;
    try {
      const res = await api.payInvoice(btn.dataset.id, Number(amt), 'cash');
      invalidate('billing:invoices:', 'billing:summary:', 'billing:collections');
      showToast(`Payment recorded — invoice ${res.status}`, 'success');
      renderBillingInvoices();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('newInvBtn2').addEventListener('click', openCreateInvoice);
  await renderList('');
}

async function renderBillingCollections() {
  content.innerHTML = `
    <div class="section-head">
      <div><h3>Collections</h3><div class="sub">Payment totals by period</div></div>
      <div class="filter-chips" id="colChips">
        <button class="chip active" data-key="today">Today</button>
        <button class="chip" data-key="week">Week</button>
        <button class="chip" data-key="month">Month</button>
      </div>
    </div>
    <div id="colStats">${skeletonCards(3)}</div>
    <div id="colList" style="margin-top:16px">${skeletonTable(5)}</div>
  `;

  const renderSummary = async (period) => {
    const s = await cached(`billing:summary:${period}`, () => api.billingSummary(period).catch(() => ({})));
    document.getElementById('colStats').innerHTML = `
      <div class="stats-grid">
        <div class="stats-card st-green"><div class="stats-icon" style="background:rgba(34,197,94,0.14);color:#86efac">💰</div>
          <div><span class="stats-value">${formatRs(s.collections || 0)}</span><span class="stats-label">Collected</span></div></div>
        <div class="stats-card st-teal"><div class="stats-icon" style="background:rgba(20,184,166,0.14);color:#5eead4">🧾</div>
          <div><span class="stats-value">${s.payment_count ?? 0}</span><span class="stats-label">Payments</span></div></div>
        <div class="stats-card st-amber"><div class="stats-icon" style="background:rgba(245,158,11,0.14);color:#fcd34d">📄</div>
          <div><span class="stats-value">${s.pending_invoices ?? 0}</span><span class="stats-label">Pending Invoices · ${formatRs(s.pending_amount || 0)}</span></div></div>
      </div>`;
  };

  const renderList = async (period) => {
    const data = await cached(`billing:collections:${period}`, async () => {
      const from = new Date();
      if (period === 'week') from.setDate(from.getDate() - 7);
      if (period === 'month') from.setMonth(from.getMonth() - 1);
      return api.listCollections({ from: from.toISOString() }).catch(() => []);
    });
    const listEl = document.getElementById('colList');
    listEl.innerHTML = '';
    if (!data.length) { listEl.innerHTML = emptyState('🧾', 'No payments', 'No payments recorded in this period.'); return; }
    const rows = data.map(p => ({
      cells: [
        `<strong>${esc(p.invoice_number)}</strong>`,
        esc(p.patient_name || '—'),
        formatDate(p.created_at),
        formatRs(p.amount),
        esc(p.method || 'cash'),
      ],
    }));
    const table = document.createElement('div');
    table.className = 'table-wrap';
    table.appendChild(createTable(['Invoice', 'Patient', 'Date', 'Amount', 'Method'], rows));
    listEl.appendChild(table);
  };

  document.getElementById('colChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#colChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderSummary(chip.dataset.key);
    renderList(chip.dataset.key);
  });

  await Promise.all([renderSummary('today'), renderList('today')]);
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
buildSidebar();
handleRoute();
