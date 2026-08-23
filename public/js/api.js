// API helper — fetch wrapper for the Subhan Care HMS
const BASE = '';

function getToken() {
  return sessionStorage.getItem('token');
}

function getLang() {
  return localStorage.getItem('lang') || 'en';
}

async function request(path, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  const token = getToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(BASE + path, config);

  if (res.status === 401) {
    sessionStorage.clear();
    if (window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  login(username, password) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  logout() {
    return request('/api/auth/logout', { method: 'POST' }).catch(() => ({}));
  },

  me() {
    return request('/api/auth/me');
  },

  // Receptionist (public)
  chat(message, sessionId, language) {
    const body = { message, language: language || getLang() };
    if (sessionId) body.session_id = sessionId;
    return request('/api/receptionist/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getFAQs(lang) {
    return request(`/api/receptionist/faqs?lang=${lang || getLang()}`);
  },

  getTTS(text, lang) {
    const encoded = encodeURIComponent(text);
    return request(`/api/receptionist/tts?text=${encoded}&lang=${lang || getLang()}`);
  },

  // Patients
  listPatients(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/patients${qs ? '?' + qs : ''}`);
  },

  getPatient(id) {
    return request(`/api/patients/${id}`);
  },

  createPatient(data) {
    return request('/api/patients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updatePatient(id, data) {
    return request(`/api/patients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deactivatePatient(id) {
    return request(`/api/patients/${id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // Doctors
  listDoctors(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/doctors${qs ? '?' + qs : ''}`);
  },

  getDoctor(id) {
    return request(`/api/doctors/${id}`);
  },

  getDoctorSlots(id, date) {
    return request(`/api/doctors/${id}/slots?date=${date}`);
  },

  toggleDoctorAvailability(id) {
    return request(`/api/doctors/${id}/availability`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // Pharmacy
  listMedicines(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/pharmacy/medicines${qs ? '?' + qs : ''}`);
  },

  restockMedicine(id, quantity) {
    return request(`/api/pharmacy/medicines/${id}/restock`, {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    });
  },

  listPrescriptions(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/pharmacy/prescriptions${qs ? '?' + qs : ''}`);
  },

  dispensePrescription(id) {
    return request(`/api/pharmacy/prescriptions/${id}/dispense`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // Billing
  listInvoices(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/billing/invoices${qs ? '?' + qs : ''}`);
  },

  getInvoice(id) {
    return request(`/api/billing/invoices/${id}`);
  },

  createInvoice(data) {
    return request('/api/billing/invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  payInvoice(id, amount, method) {
    return request(`/api/billing/invoices/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ amount, method: method || 'cash' }),
    });
  },

  billingSummary(period = 'today') {
    return request(`/api/billing/summary?period=${period}`);
  },

  listCollections(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/billing/collections${qs ? '?' + qs : ''}`);
  },

  // Consultations
  listConsultations(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/consultations${qs ? '?' + qs : ''}`);
  },

  getConsultation(id) {
    return request(`/api/consultations/${id}`);
  },

  createConsultation(data) {
    return request('/api/consultations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Appointments
  listAppointments(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/appointments${qs ? '?' + qs : ''}`);
  },

  createAppointment(data) {
    return request('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateAppointmentStatus(id, status) {
    return request(`/api/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  rescheduleAppointment(id, data) {
    return request(`/api/appointments/${id}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Analytics (admin only)
  analyticsOverview(period = '7d') {
    return request(`/api/analytics/overview?period=${period}`);
  },

  aiEvents(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/analytics/ai-events${qs ? '?' + qs : ''}`);
  },

  channels(period = '7d') {
    return request(`/api/analytics/channels?period=${period}`);
  },

  // Callback queue (admin only)
  listCallbacks(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/callbacks${qs ? '?' + qs : ''}`);
  },

  getCallback(id) {
    return request(`/api/callbacks/${id}`);
  },

  updateCallbackStatus(id, status) {
    return request(`/api/callbacks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  // Authentication audit (admin only; server returns redacted fields)
  listAudit(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/audit${qs ? '?' + qs : ''}`);
  },
  // Staff management (admin only)
  listStaff() {
    return request('/api/staff');
  },

  createStaff(data) {
    return request('/api/staff', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateStaff(id, data) {
    return request(`/api/staff/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deactivateStaff(id) {
    return request(`/api/staff/${id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};
