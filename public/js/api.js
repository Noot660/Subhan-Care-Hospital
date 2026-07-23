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
};
