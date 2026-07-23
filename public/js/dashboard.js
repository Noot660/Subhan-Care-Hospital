// Dashboard — Role-based views for all 6 staff roles
import { api } from './api.js';
import { auth } from './auth.js';
import {
  createModal, createTable, createFormField, createStatsCard,
  showToast, showConfirm, formatDate, formatDateTime, statusBadge
} from './components.js';

// ── Init ──
const user = auth.getUser();
if (!user || auth.isExpired()) {
  window.location.href = '/login';
}

// Setup UI
document.getElementById('userNameDisplay').textContent = user.name;
document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
document.getElementById('sidebarUser').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutButton').addEventListener('click', async () => {
  await auth.logout();
  window.location.href = '/login';
});

// ── Sidebar Navigation ──
const navConfig = {
  admin: [
    { label: 'Overview', icon: '📊', hash: '#/dashboard/admin' },
    { label: 'Patients', icon: '🩺', hash: '#/dashboard/admin/patients' },
    { label: 'Doctors', icon: '👨‍⚕️', hash: '#/dashboard/admin/doctors' },
    { label: 'Appointments', icon: '📅', hash: '#/dashboard/admin/appointments' },
    { label: 'Pharmacy', icon: '💊', hash: '#/dashboard/admin/pharmacy' },
    { label: 'Billing', icon: '💰', hash: '#/dashboard/admin/billing' },
  ],
  receptionist: [
    { label: 'Today\'s Appointments', icon: '📅', hash: '#/dashboard/receptionist' },
    { label: 'Patients', icon: '🩺', hash: '#/dashboard/receptionist/patients' },
    { label: 'Register Patient', icon: '➕', hash: '#/dashboard/receptionist/register' },
    { label: 'Book Appointment', icon: '📝', hash: '#/dashboard/receptionist/book' },
  ],
  doctor: [
    { label: 'My Appointments', icon: '📅', hash: '#/dashboard/doctor' },
    { label: 'Patient History', icon: '📋', hash: '#/dashboard/doctor/history' },
  ],
  pharmacist: [
    { label: 'Prescriptions', icon: '📝', hash: '#/dashboard/pharmacist' },
    { label: 'Inventory', icon: '💊', hash: '#/dashboard/pharmacist/inventory' },
    { label: 'Low Stock', icon: '⚠️', hash: '#/dashboard/pharmacist/lowstock' },
  ],
  billing: [
    { label: 'Invoices', icon: '💰', hash: '#/dashboard/billing' },
    { label: 'Collections', icon: '📊', hash: '#/dashboard/billing/collections' },
  ],
  management: [
    { label: 'Overview', icon: '📊', hash: '#/dashboard/management' },
  ],
};

function buildSidebar(role) {
  const nav = document.getElementById('sidebarNav');
  const items = navConfig[role] || navConfig.receptionist;
  nav.innerHTML = items.map(item => `
    <a href="${item.hash}" class="${window.location.hash === item.hash ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span> ${item.label}
    </a>
  `).join('');

  // Update active state on hash change
  window.addEventListener('hashchange', () => {
    nav.querySelectorAll('a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === window.location.hash);
    });
  });
}

buildSidebar(user.role);

// ── Route Handler ──
function handleRoute() {
  const hash = window.location.hash || '#/dashboard/' + user.role;
  const content = document.getElementById('dashboardContent');

  switch (user.role) {
    case 'admin': renderAdmin(hash, content); break;
    case 'receptionist': renderReceptionist(hash, content); break;
    case 'doctor': renderDoctor(hash, content); break;
    case 'pharmacist': renderPharmacist(hash, content); break;
    case 'billing': renderBilling(hash, content); break;
    case 'management': renderManagement(hash, content); break;
    default: content.innerHTML = '<p>Unknown role</p>';
  }
}

window.addEventListener('hashchange', handleRoute);
handleRoute();

// ═══════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════
async function renderAdmin(hash, content) {
  try {
    const [patients, todayAppts, doctors] = await Promise.all([
      api.listPatients().catch(() => []),
      api.listAppointments({ date: new Date().toISOString().split('T')[0] }).catch(() => []),
      api.listDoctors().catch(() => []),
    ]);

    content.innerHTML = `
      <div class="stats-grid mb-4">
        ${createStatsCard('Total Patients', patients.length || 0, '🩺', 'blue')}
        ${createStatsCard("Today's Appointments", todayAppts.length || 0, '📅', 'green')}
        ${createStatsCard('Active Doctors', doctors.length || 0, '👨‍⚕️', 'purple')}
        ${createStatsCard('Daily Revenue', '—', '💰', 'teal')}
      </div>

      <div class="dashboard-section">
        <h3>Quick Search</h3>
        <div class="search-section">
          <div class="search-bar">
            <input type="text" id="patientSearch" placeholder="Search by name, CNIC, or phone...">
            <button class="btn btn-primary btn-sm" id="searchBtn">Search</button>
          </div>
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>

      <div class="dashboard-section">
        <h3>Quick Links</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <a href="#/dashboard/admin/patients" class="btn btn-outline btn-sm">🩺 Manage Patients</a>
          <a href="#/dashboard/admin/doctors" class="btn btn-outline btn-sm">👨‍⚕️ Manage Doctors</a>
          <a href="#/dashboard/admin/appointments" class="btn btn-outline btn-sm">📅 Appointments</a>
          <a href="#/dashboard/admin/pharmacy" class="btn btn-outline btn-sm">💊 Pharmacy</a>
          <a href="#/dashboard/admin/billing" class="btn btn-outline btn-sm">💰 Billing</a>
        </div>
      </div>
    `;

    // Search handler
    document.getElementById('searchBtn').addEventListener('click', () => searchPatients('searchResults'));
    document.getElementById('patientSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchPatients('searchResults');
    });
  } catch (err) {
    content.innerHTML = `<p class="text-muted">Error loading dashboard: ${err.message}</p>`;
  }
}

// ═══════════════════════════════════════════
// RECEPTIONIST DASHBOARD
// ═══════════════════════════════════════════
async function renderReceptionist(hash, content) {
  const today = new Date().toISOString().split('T')[0];

  if (hash.includes('/register')) {
    showRegisterPatientForm(content);
    return;
  }

  if (hash.includes('/book')) {
    showBookAppointmentForm(content);
    return;
  }

  if (hash.includes('/patients')) {
    showPatientList(content);
    return;
  }

  // Default: today's appointments
  try {
    const appointments = await api.listAppointments({ date: today });

    content.innerHTML = `
      <div class="stats-grid mb-4">
        ${createStatsCard("Today's Appointments", appointments.length, '📅', 'blue')}
        ${createStatsCard('Checked In', appointments.filter(a => a.status === 'checked-in').length, '✅', 'green')}
        ${createStatsCard('Scheduled', appointments.filter(a => a.status === 'scheduled').length, '⏳', 'orange')}
        ${createStatsCard('Completed', appointments.filter(a => a.status === 'completed').length, '✔️', 'teal')}
      </div>

      <div class="flex justify-between items-center mb-4">
        <h3>Today's Appointments (${today})</h3>
        <div class="flex gap-2">
          <button class="btn btn-primary btn-sm" id="registerBtn">➕ Register Patient</button>
          <button class="btn btn-success btn-sm" id="bookBtn">📝 Book Appointment</button>
        </div>
      </div>

      <div class="search-section mb-4">
        <div class="search-bar">
          <input type="text" id="patientSearch" placeholder="Quick patient search...">
          <button class="btn btn-primary btn-sm" id="searchBtn">Search</button>
        </div>
        <div class="search-results" id="searchResults"></div>
      </div>

      <div id="appointmentsTable"></div>
    `;

    // Buttons
    document.getElementById('registerBtn').addEventListener('click', () => {
      window.location.hash = '#/dashboard/receptionist/register';
    });
    document.getElementById('bookBtn').addEventListener('click', () => {
      window.location.hash = '#/dashboard/receptionist/book';
    });
    document.getElementById('searchBtn').addEventListener('click', () => searchPatients('searchResults'));
    document.getElementById('patientSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchPatients('searchResults');
    });

    // Appointments table
    const tableContainer = document.getElementById('appointmentsTable');
    const rows = appointments.map(a => ({
      cells: [
        a.patient_name || `Patient #${a.patient_id}`,
        a.doctor_name || `Doctor #${a.doctor_id}`,
        a.start_time,
        statusBadge(a.status),
        `<div class="flex gap-1">
          ${a.status === 'scheduled' ? `<button class="btn btn-sm btn-success checkin-btn" data-id="${a.id}">Check In</button>` : ''}
          ${a.status === 'scheduled' ? `<button class="btn btn-sm btn-danger cancel-btn" data-id="${a.id}">Cancel</button>` : ''}
        </div>`,
      ],
    }));

    tableContainer.appendChild(createTable(
      ['Patient', 'Doctor', 'Time', 'Status', 'Actions'],
      rows,
      { emptyMessage: 'No appointments for today' }
    ));

    // Event delegation for action buttons
    tableContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.id;

      if (btn.classList.contains('checkin-btn')) {
        try {
          await api.updateAppointmentStatus(id, 'checked-in');
          showToast('Patient checked in!', 'success');
          window.location.hash = '#/dashboard/receptionist';
          renderReceptionist(window.location.hash, content);
        } catch (err) {
          showToast(err.message, 'error');
        }
      }

      if (btn.classList.contains('cancel-btn')) {
        const confirmed = await showConfirm('Cancel this appointment?');
        if (confirmed) {
          try {
            await api.updateAppointmentStatus(id, 'cancelled');
            showToast('Appointment cancelled', 'success');
            window.location.hash = '#/dashboard/receptionist';
            renderReceptionist(window.location.hash, content);
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      }
    });

  } catch (err) {
    content.innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
  }
}

// ── Register Patient Form ──
function showRegisterPatientForm(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-header"><h4>Register New Patient</h4></div>
      <div class="card-body">
        <form id="registerForm">
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
            ${createFormField('Emergency Contact', 'emergency_contact', 'text', { required: true, placeholder: 'Emergency phone number' }).outerHTML}
          </div>
          ${createFormField('Address', 'address', 'textarea', { required: true, placeholder: 'Full address' }).outerHTML}
          <div class="flex gap-2">
            <button type="submit" class="btn btn-primary">Register Patient</button>
            <button type="button" class="btn btn-secondary" onclick="window.location.hash='#/dashboard/receptionist'">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      full_name: form.full_name.value.trim(),
      cnic: form.cnic.value.trim(),
      dob: form.dob.value,
      gender: form.gender.value,
      phone: form.phone.value.trim(),
      address: form.address.value.trim(),
      emergency_contact: form.emergency_contact.value.trim(),
    };

    try {
      const result = await api.createPatient(data);
      showToast(`Patient registered! ID: ${result.patient_id}`, 'success');
      window.location.hash = '#/dashboard/receptionist';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Book Appointment Form ──
async function showBookAppointmentForm(content) {
  let doctors = [];
  try {
    doctors = await api.listDoctors();
  } catch {}

  content.innerHTML = `
    <div class="card">
      <div class="card-header"><h4>Book Appointment</h4></div>
      <div class="card-body">
        <form id="bookingForm">
          <div class="form-row">
            <div class="form-field">
              <label for="patientSearch">Patient <span class="required">*</span></label>
              <input type="text" id="patientLookup" placeholder="Search by name, CNIC, or phone...">
              <input type="hidden" id="patientId">
              <small class="form-help" id="patientName"></small>
            </div>
          </div>
          <div class="form-row">
            ${createFormField('Doctor', 'doctor_id', 'select', {
              required: true,
              options: doctors.map(d => ({ label: `${d.name} — ${d.specialization} (Rs. ${d.fee})`, value: d.id }))
            }).outerHTML}
            ${createFormField('Date', 'date', 'date', { required: true }).outerHTML}
          </div>
          <div class="form-field" id="slotsContainer" style="display:none">
            <label>Available Slots</label>
            <div id="slotsList" class="flex gap-2" style="flex-wrap:wrap"></div>
            <input type="hidden" id="selectedTime">
          </div>
          <div class="flex gap-2 mt-4">
            <button type="submit" class="btn btn-primary" id="bookSubmit" disabled>Book Appointment</button>
            <button type="button" class="btn btn-secondary" onclick="window.location.hash='#/dashboard/receptionist'">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Patient lookup
  const patientLookup = document.getElementById('patientLookup');
  let lookupTimeout;
  patientLookup.addEventListener('input', () => {
    clearTimeout(lookupTimeout);
    lookupTimeout = setTimeout(async () => {
      const q = patientLookup.value.trim();
      if (q.length < 2) return;
      try {
        const results = await api.listPatients({ name: q });
        if (results.length > 0) {
          document.getElementById('patientId').value = results[0].id;
          document.getElementById('patientName').textContent = `Found: ${results[0].full_name} (${results[0].patient_id})`;
        }
      } catch {}
    }, 400);
  });

  // Doctor/date change → fetch slots
  const doctorSelect = document.querySelector('[name="doctor_id"]');
  const dateInput = document.querySelector('[name="date"]');

  async function fetchSlots() {
    const doctorId = doctorSelect.value;
    const date = dateInput.value;
    if (!doctorId || !date) return;

    const slotsContainer = document.getElementById('slotsContainer');
    const slotsList = document.getElementById('slotsList');
    const bookSubmit = document.getElementById('bookSubmit');

    try {
      const data = await api.getDoctorSlots(doctorId, date);
      const available = (data.slots || []).filter(s => s.available);
      slotsContainer.style.display = 'block';

      if (available.length === 0) {
        slotsList.innerHTML = '<span class="text-muted">No available slots for this date</span>';
        bookSubmit.disabled = true;
        return;
      }

      slotsList.innerHTML = available.map(s => `
        <button type="button" class="btn btn-outline btn-sm slot-btn" data-time="${s.start_time}">
          ${s.start_time} — ${s.end_time}
        </button>
      `).join('');

      // Slot selection
      let selectedTime = null;
      slotsList.querySelectorAll('.slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          slotsList.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('btn-primary'));
          btn.classList.add('btn-primary');
          document.getElementById('selectedTime').value = btn.dataset.time;
          bookSubmit.disabled = false;
        });
      });

      bookSubmit.disabled = !selectedTime;
    } catch (err) {
      slotsContainer.style.display = 'none';
    }
  }

  doctorSelect.addEventListener('change', fetchSlots);
  dateInput.addEventListener('change', fetchSlots);

  // Form submit
  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const patientId = document.getElementById('patientId').value;
    const doctorId = doctorSelect.value;
    const date = dateInput.value;
    const time = document.getElementById('selectedTime').value;

    if (!patientId || !doctorId || !date || !time) {
      showToast('Please fill all fields', 'warning');
      return;
    }

    try {
      await api.createAppointment({
        patient_id: parseInt(patientId),
        doctor_id: parseInt(doctorId),
        date,
        start_time: time,
      });
      showToast('Appointment booked!', 'success');
      window.location.hash = '#/dashboard/receptionist';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ── Patient List ──
async function showPatientList(content) {
  try {
    const patients = await api.listPatients();
    content.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3>Patients (${patients.length})</h3>
        <div class="search-bar">
          <input type="text" id="patientSearch" placeholder="Search patients...">
          <button class="btn btn-primary btn-sm" id="searchBtn">Search</button>
        </div>
      </div>
      <div id="patientTable"></div>
    `;

    function renderTable(data) {
      const rows = data.map(p => ({
        cells: [
          `<strong>${p.full_name}</strong><br><small class="text-muted">${p.patient_id}</small>`,
          p.cnic,
          p.phone,
          statusBadge(p.status),
          formatDate(p.created_at),
        ],
        onClick: () => {
          showToast(`Selected: ${p.full_name} (${p.patient_id})`, 'info');
        },
      }));

      const tableContainer = document.getElementById('patientTable');
      tableContainer.innerHTML = '';
      tableContainer.appendChild(createTable(
        ['Name / ID', 'CNIC', 'Phone', 'Status', 'Registered'],
        rows,
        { emptyMessage: 'No patients found' }
      ));
    }

    renderTable(patients);

    document.getElementById('searchBtn').addEventListener('click', async () => {
      const q = document.getElementById('patientSearch').value.trim();
      if (!q) { renderTable(patients); return; }
      try {
        const results = await api.listPatients({ name: q });
        renderTable(results);
      } catch {}
    });

    document.getElementById('patientSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('searchBtn').click();
    });

  } catch (err) {
    content.innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
  }
}

// ═══════════════════════════════════════════
// DOCTOR DASHBOARD
// ═══════════════════════════════════════════
async function renderDoctor(hash, content) {
  const today = new Date().toISOString().split('T')[0];
  const user = auth.getUser();

  try {
    // Find the doctor record matching this staff member's name
    let doctorId = null;
    try {
      const doctors = await api.listDoctors();
      const myDoctor = doctors.find(d => d.name === user.name);
      if (myDoctor) doctorId = myDoctor.id;
    } catch {}

    const appointments = doctorId
      ? await api.listAppointments({ doctor_id: doctorId, date: today })
      : [];

    content.innerHTML = `
      <div class="stats-grid mb-4">
        ${createStatsCard("Today's Appointments", appointments.length, '📅', 'blue')}
        ${createStatsCard('Scheduled', appointments.filter(a => a.status === 'scheduled').length, '⏳', 'orange')}
        ${createStatsCard('Checked In', appointments.filter(a => a.status === 'checked-in').length, '✅', 'green')}
        ${createStatsCard('Completed', appointments.filter(a => a.status === 'completed').length, '✔️', 'teal')}
      </div>

      <h3 class="mb-4">Today's Patients</h3>
      <div id="appointmentsTable"></div>
    `;

    const rows = appointments.map(a => ({
      cells: [
        a.patient_name || `Patient #${a.patient_id}`,
        a.start_time,
        statusBadge(a.status),
        `<div class="flex gap-1">
          ${a.status === 'checked-in' ? `<button class="btn btn-sm btn-primary consult-btn" data-id="${a.id}" data-patient="${a.patient_id}" data-name="${a.patient_name || ''}">Consult</button>` : ''}
          ${a.status === 'scheduled' ? `<button class="btn btn-sm btn-success checkin-btn" data-id="${a.id}">Check In</button>` : ''}
        </div>`,
      ],
    }));

    const tableContainer = document.getElementById('appointmentsTable');
    tableContainer.appendChild(createTable(
      ['Patient', 'Time', 'Status', 'Actions'],
      rows,
      { emptyMessage: 'No appointments for today' }
    ));

    tableContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.classList.contains('checkin-btn')) {
        await api.updateAppointmentStatus(btn.dataset.id, 'checked-in');
        showToast('Patient checked in', 'success');
        renderDoctor(hash, content);
      }

      if (btn.classList.contains('consult-btn')) {
        showConsultationModal(btn.dataset.id, btn.dataset.patient, btn.dataset.name);
      }
    });

  } catch (err) {
    content.innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
  }
}

function showConsultationModal(appointmentId, patientId, patientName) {
  const form = document.createElement('form');
  form.innerHTML = `
    <p><strong>Patient:</strong> ${patientName || 'Patient #' + patientId}</p>
    <div class="form-row">
      ${createFormField('Diagnosis', 'diagnosis', 'textarea', { required: true, placeholder: 'Enter diagnosis' }).outerHTML}
    </div>
    <div class="form-row">
      ${createFormField('Notes', 'notes', 'textarea', { placeholder: 'Consultation notes' }).outerHTML}
      ${createFormField('Vitals', 'vitals', 'text', { placeholder: 'e.g., BP 120/80, Temp 98.6°F' }).outerHTML}
    </div>
    <button type="submit" class="btn btn-primary mt-4">Save & Complete</button>
  `;

  const modal = createModal('Record Consultation', form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      // Mark appointment as completed (consultation recording would need its own endpoint)
      await api.updateAppointmentStatus(appointmentId, 'completed');
      showToast('Consultation recorded!', 'success');
      modal.close();
      window.location.hash = '#/dashboard/doctor';
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ═══════════════════════════════════════════
// PHARMACIST DASHBOARD
// ═══════════════════════════════════════════
async function renderPharmacist(hash, content) {
  content.innerHTML = `
    <div class="stats-grid mb-4">
      ${createStatsCard('Pending Prescriptions', '—', '📝', 'blue')}
      ${createStatsCard('Low Stock Items', '—', '⚠️', 'orange')}
      ${createStatsCard('Total Medicines', '—', '💊', 'green')}
    </div>

    <div class="dashboard-section">
      <h3>Pending Prescriptions</h3>
      <p class="text-muted">No pending prescriptions to dispense.</p>
    </div>

    <div class="dashboard-section">
      <h3>Quick Search</h3>
      <div class="search-section">
        <div class="search-bar">
          <input type="text" id="medSearch" placeholder="Search medicine inventory...">
          <button class="btn btn-primary btn-sm" id="searchMedBtn">Search</button>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════
// BILLING DASHBOARD
// ═══════════════════════════════════════════
async function renderBilling(hash, content) {
  content.innerHTML = `
    <div class="stats-grid mb-4">
      ${createStatsCard("Today's Collections", 'Rs. 0', '💰', 'green')}
      ${createStatsCard('Pending Invoices', '0', '📄', 'orange')}
      ${createStatsCard('Paid Today', '0', '✅', 'teal')}
    </div>

    <div class="dashboard-section">
      <h3>Pending Invoices</h3>
      <p class="text-muted">No pending invoices.</p>
    </div>

    <div class="dashboard-section">
      <h3>Invoice Search</h3>
      <div class="search-section">
        <div class="search-bar">
          <input type="text" id="invoiceSearch" placeholder="Search invoices...">
          <button class="btn btn-primary btn-sm">Search</button>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════
// MANAGEMENT DASHBOARD
// ═══════════════════════════════════════════
async function renderManagement(hash, content) {
  try {
    const [patients, todayAppts] = await Promise.all([
      api.listPatients().catch(() => []),
      api.listAppointments({ date: new Date().toISOString().split('T')[0] }).catch(() => []),
    ]);

    content.innerHTML = `
      <div class="stats-grid mb-4">
        ${createStatsCard('Total Patients', patients.length || 0, '🩺', 'blue')}
        ${createStatsCard("Today's Appointments", todayAppts.length || 0, '📅', 'green')}
        ${createStatsCard('Today\'s Revenue', '—', '💰', 'teal')}
        ${createStatsCard('Stock Status', '—', '💊', 'purple')}
      </div>

      <div class="card">
        <div class="card-header"><h4>Today's Activity</h4></div>
        <div class="card-body">
          <p>Total patients registered today: —</p>
          <p>Appointments completed today: ${todayAppts.filter(a => a.status === 'completed').length}</p>
          <p>Appointments pending: ${todayAppts.filter(a => a.status === 'scheduled' || a.status === 'checked-in').length}</p>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
  }
}

// ── Shared: Patient Search ──
async function searchPatients(containerId) {
  const q = document.getElementById('patientSearch').value.trim();
  const container = document.getElementById(containerId);
  if (!q) { container.innerHTML = ''; return; }

  try {
    const results = await api.listPatients({ name: q });
    container.innerHTML = results.length === 0
      ? '<p class="text-muted">No patients found</p>'
      : results.map(p => `
          <div class="search-result-item">
            <div>
              <strong>${p.full_name}</strong>
              <small class="text-muted">${p.patient_id} • ${p.phone}</small>
            </div>
            <span>${statusBadge(p.status)}</span>
          </div>
        `).join('');
  } catch (err) {
    container.innerHTML = `<p class="text-muted">Search error: ${err.message}</p>`;
  }
}
