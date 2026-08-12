import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { getDb } from '../src/db';
import { handleAppointments } from '../src/routes/appointments';
import { handleMessage } from '../src/ai/intents';
import {
  availableSlots,
  generatedSlots,
  hospitalToday,
  slotInPast,
  validateAppointmentInput,
  validateCalendarDate,
} from '../src/appointments/validation';

/**
 * Appointment reliability — focused tests for:
 *  - strict calendar/date + timezone validation (shared module)
 *  - only generated/live slots are accepted
 *  - valid bookings (API + AI path)
 *  - conflict responses with fresh slots, incl. the unique-index backstop
 *
 * Fixtures are created and removed within this file, so the suite is safe to
 * run against a seeded dev database.
 */

// Identity verification stub is a dev-only flag (see docs/security-privacy-baseline.md).
const originalStub = process.env.PHI_VERIFICATION_STUB;
process.env.PHI_VERIFICATION_STUB = 'true';

const TEST_DOCTOR_CNIC = '99000-0000001-9';
const TEST_PATIENT_CNIC = '99000-0000002-8';
const TEST_PATIENT_PHONE = '0313-9999001';
let doctorId = 0;
let patientId = 0;

// ── date helpers (all relative to the hospital's timezone) ──
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nextWeekday(target: number): string {
  let date = addDays(hospitalToday(), 1);
  for (let i = 0; i < 9; i++) {
    if (weekdayOf(date) === target) return date;
    date = addDays(date, 1);
  }
  throw new Error('unreachable: could not find next weekday');
}

const nextMonday = () => nextWeekday(1);
const nextTuesday = () => nextWeekday(2);
const nextWednesday = () => nextWeekday(3);
const yesterday = () => addDays(hospitalToday(), -1);
const today = () => hospitalToday();

// ── fixture setup/teardown ──
beforeAll(() => {
  const db = getDb();
  const doctor = db.query("SELECT id FROM doctors WHERE cnic = ?").get(TEST_DOCTOR_CNIC) as { id: number } | undefined;
  if (doctor) doctorId = doctor.id;
  else {
    const result = db.run(
      `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      ['Reliability Test Doctor', 'General Medicine', 'MBBS', TEST_DOCTOR_CNIC, '0300-9999001', 1000]
    );
    doctorId = Number(result.lastInsertRowid);
  }
  // Mon–Fri 09:00–11:00 → 4 live 30-minute slots: 09:00, 09:30, 10:00, 10:30
  db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctorId]);
  for (let day = 1; day <= 5; day++) {
    db.run("INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)", [doctorId, day, '09:00', '11:00']);
  }
  const patient = db.query("SELECT id FROM patients WHERE cnic = ?").get(TEST_PATIENT_CNIC) as { id: number } | undefined;
  if (patient) patientId = patient.id;
  else {
    const result = db.run(
      `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      ['SC-PT-RELIABILITY', 'Reliability Test Patient', '1990-01-01', 'male', TEST_PATIENT_CNIC, TEST_PATIENT_PHONE, 'Test Address', '0300-9999002']
    );
    patientId = Number(result.lastInsertRowid);
  }
});

afterAll(() => {
  const db = getDb();
  db.run("DELETE FROM appointments WHERE doctor_id = ?", [doctorId]);
  db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctorId]);
  db.run("DELETE FROM doctors WHERE id = ?", [doctorId]);
  db.run("DELETE FROM patients WHERE id = ?", [patientId]);
  if (originalStub === undefined) delete process.env.PHI_VERIFICATION_STUB;
  else process.env.PHI_VERIFICATION_STUB = originalStub;
});

// ── request helpers ──
const post = (path: string, body: unknown) =>
  handleAppointments(new Request(`http://test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
const patch = (path: string, body: unknown) =>
  handleAppointments(new Request(`http://test${path}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

describe('calendar/date validation (shared module)', () => {
  test('rejects malformed and impossible calendar dates', () => {
    expect(validateCalendarDate('2026-02-31').ok).toBe(false); // impossible day
    expect(validateCalendarDate('2026-13-01').ok).toBe(false); // impossible month
    expect(validateCalendarDate('12-08-2026').ok).toBe(false); // wrong format
    expect(validateCalendarDate('2026/08/12').ok).toBe(false);
    expect(validateCalendarDate('not-a-date').ok).toBe(false);
    expect(validateCalendarDate('2026-8-01').ok).toBe(false); // non-padded month
  });

  test('accepts real calendar dates, including leap days', () => {
    expect(validateCalendarDate('2024-02-29', true).ok).toBe(true);
    expect(validateCalendarDate('2026-08-12', true).ok).toBe(true);
    const result = validateCalendarDate('2026-08-17', true);
    expect(result.ok && result.dayOfWeek).toBe(1); // 2026-08-17 is a Monday
  });

  test('rejects past dates (hospital timezone) but allows them with allowPast', () => {
    expect(validateCalendarDate(yesterday()).ok).toBe(false);
    expect(validateCalendarDate(yesterday(), true).ok).toBe(true);
    expect(validateCalendarDate(today()).ok).toBe(true);
  });
});

describe('live slot generation (shared module)', () => {
  test('generates 30-minute slots strictly from doctor_schedules', () => {
    const slots = generatedSlots(getDb(), doctorId, nextMonday());
    expect(slots.map((s) => s.start_time)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    for (const s of slots) {
      const [h, m] = s.start_time.split(':').map(Number);
      const endTotal = h * 60 + m + 30;
      expect(s.end_time).toBe(`${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`);
    }
  });

  test('generates no slots on a day with no schedule', () => {
    const sunday = nextWeekday(0);
    expect(generatedSlots(getDb(), doctorId, sunday)).toEqual([]);
  });

  test('never offers slots that have already started today', () => {
    const db = getDb();
    for (const slot of generatedSlots(db, doctorId, today())) {
      expect(slotInPast(today(), slot.start_time)).toBe(false);
    }
  });

  test('availableSlots excludes active bookings and supports excluding one appointment (reschedule)', () => {
    const db = getDb();
    const date = nextWednesday();
    expect(availableSlots(db, doctorId, date).length).toBe(4);
    const booking = db.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', 'staff', ?, ?)`,
      [patientId, doctorId, date, '09:30', '10:00', new Date().toISOString(), new Date().toISOString()]
    );
    const apptId = Number(booking.lastInsertRowid);
    try {
      const slots = availableSlots(db, doctorId, date);
      expect(slots.map((s) => s.start_time)).not.toContain('09:30');
      expect(slots.length).toBe(3);
      // For the appointment's own reschedule, its slot counts as free again:
      expect(availableSlots(db, doctorId, date, apptId).length).toBe(4);
    } finally {
      db.run("DELETE FROM appointments WHERE id = ?", [apptId]);
    }
  });
});

describe('shared input validation', () => {
  test('accepts a live generated slot and returns its canonical end time', () => {
    const result = validateAppointmentInput(getDb(), doctorId, nextMonday(), '09:00');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.endTime).toBe('09:30');
  });

  test('rejects non-slot times (not generated from the schedule)', () => {
    const db = getDb();
    const date = nextMonday();
    expect(validateAppointmentInput(db, doctorId, date, '09:15').ok).toBe(false); // mid-slot
    expect(validateAppointmentInput(db, doctorId, date, '08:30').ok).toBe(false); // before schedule
    expect(validateAppointmentInput(db, doctorId, date, '11:00').ok).toBe(false); // at/after schedule end
    expect(validateAppointmentInput(db, doctorId, date, '17:00').ok).toBe(false); // outside schedule
  });

  test('rejects malformed times', () => {
    const db = getDb();
    const date = nextMonday();
    expect(validateAppointmentInput(db, doctorId, date, '9:00').ok).toBe(false);
    expect(validateAppointmentInput(db, doctorId, date, '24:00').ok).toBe(false);
    expect(validateAppointmentInput(db, doctorId, date, '09:60').ok).toBe(false);
    expect(validateAppointmentInput(db, doctorId, date, 'ten o clock').ok).toBe(false);
  });

  test('rejects past dates and (conditionally) slots already started today', () => {
    const db = getDb();
    expect(validateAppointmentInput(db, doctorId, yesterday(), '09:00').ok).toBe(false);
    if (slotInPast(today(), '09:00')) {
      expect(validateAppointmentInput(db, doctorId, today(), '09:00').ok).toBe(false);
    }
  });
});

describe('POST /api/appointments', () => {
  test('creates a valid appointment with the canonical end time', async () => {
    const date = nextTuesday();
    const response = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '09:00' });
    expect(response.status).toBe(201);
    const created = await response.json() as Record<string, unknown>;
    expect(created.date).toBe(date);
    expect(created.start_time).toBe('09:00');
    expect(created.end_time).toBe('09:30');
    expect(created.status).toBe('scheduled');
    expect(created.source).toBe('staff');
    getDb().run("DELETE FROM appointments WHERE id = ?", [Number(created.id)]);
  });

  test('rejects invalid dates, non-slot times and bad inputs with 400/404', async () => {
    const date = nextMonday();
    const cases: Array<[unknown, number]> = [
      [{ patient_id: patientId, doctor_id: doctorId, date: '2026-02-31', start_time: '09:00' }, 400],
      [{ patient_id: patientId, doctor_id: doctorId, date: yesterday(), start_time: '09:00' }, 400],
      [{ patient_id: patientId, doctor_id: doctorId, date, start_time: '09:15' }, 400],
      [{ patient_id: patientId, doctor_id: doctorId, date, start_time: '9:00' }, 400],
      [{ patient_id: 999999, doctor_id: doctorId, date, start_time: '09:00' }, 404],
      [{ patient_id: patientId, doctor_id: 999999, date, start_time: '09:00' }, 404],
      [{ patient_id: patientId, doctor_id: doctorId, date, start_time: '09:00', source: 'carrier-pigeon' }, 400],
      [{ patient_id: patientId, doctor_id: doctorId }, 400], // missing fields
    ];
    for (const [payload, expectedStatus] of cases) {
      const response = await post('/api/appointments', payload);
      expect(response.status).toBe(expectedStatus);
    }
  });

  test('rejects a second booking of the same slot with 409 and fresh slots', async () => {
    const date = nextMonday();
    const first = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '10:00' });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { id: number };
    try {
      const second = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '10:00' });
      expect(second.status).toBe(409);
      const body = await second.json() as { error: string };
      expect(body.error).toContain('just booked');
      expect(body.error).toContain('Available slots');
      expect(body.error).not.toContain('10:00'); // the taken slot is not offered as available
    } finally {
      getDb().run("DELETE FROM appointments WHERE id = ?", [firstBody.id]);
    }
  });

  test('a cancelled appointment frees the slot (partial unique index)', async () => {
    const date = nextWednesday();
    const first = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '09:00' });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { id: number };
    const cancelled = await patch(`/api/appointments/${firstBody.id}/status`, { status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    const reuse = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '09:00' });
    expect(reuse.status).toBe(201);
    const reuseBody = await reuse.json() as { id: number };
    getDb().run("DELETE FROM appointments WHERE id IN (?, ?)", [firstBody.id, reuseBody.id]);
  });

  test('the unique index is the atomic backstop for a concurrent double-book', () => {
    const db = getDb();
    const date = nextTuesday();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', 'staff', ?, ?)`,
      [patientId, doctorId, date, '10:30', '11:00', now, now]
    );
    // A second insert that bypasses any pre-check must fail at the DB layer:
    expect(() =>
      db.run(
        `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'scheduled', 'staff', ?, ?)`,
        [patientId, doctorId, date, '10:30', '11:00', now, now]
      )
    ).toThrow(/UNIQUE constraint failed/i);
    // …but a cancelled row with the same slot does NOT block rebooking:
    db.run("UPDATE appointments SET status = 'cancelled' WHERE doctor_id = ? AND date = ? AND start_time = ?", [doctorId, date, '10:30']);
    db.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'no-show', 'staff', ?, ?)`,
      [patientId, doctorId, date, '10:30', '11:00', now, now]
    );
    db.run("DELETE FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ?", [doctorId, date, '10:30']);
  });
});

describe('PATCH /api/appointments/:id/reschedule', () => {
  test('reschedules to a valid live slot with the canonical end time', async () => {
    const date = nextTuesday();
    const created = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '09:00' });
    const body = await created.json() as { id: number };
    const rescheduled = await patch(`/api/appointments/${body.id}/reschedule`, { date, start_time: '10:00', reason: 'test' });
    expect(rescheduled.status).toBe(200);
    const updated = await rescheduled.json() as Record<string, unknown>;
    expect(updated.start_time).toBe('10:00');
    expect(updated.end_time).toBe('10:30');
    getDb().run("DELETE FROM appointments WHERE id = ?", [body.id]);
  });

  test('rejects rescheduling to a non-slot time or an occupied slot', async () => {
    const date = nextWednesday();
    const created = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '09:00' });
    const body = await created.json() as { id: number };
    try {
      const nonSlot = await patch(`/api/appointments/${body.id}/reschedule`, { date, start_time: '09:15' });
      expect(nonSlot.status).toBe(400);
      // Occupy 09:30 with a second appointment, then try to move into it:
      const other = await post('/api/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: '09:30' });
      expect(other.status).toBe(201);
      const otherBody = await other.json() as { id: number };
      const conflict = await patch(`/api/appointments/${body.id}/reschedule`, { date, start_time: '09:30' });
      expect(conflict.status).toBe(409);
      const conflictBody = await conflict.json() as { error: string };
      expect(conflictBody.error).toContain('Available slots');
      getDb().run("DELETE FROM appointments WHERE id = ?", [otherBody.id]);
    } finally {
      getDb().run("DELETE FROM appointments WHERE id = ?", [body.id]);
    }
  });
});

describe('AI receptionist booking path (shared validation)', () => {
  async function runBookingToConfirm(sid: string) {
    let r = await handleMessage('yes', sid, 'en', 'chat');
    expect(r.conversation_active).toBe(true);
    r = await handleMessage(TEST_PATIENT_CNIC, sid, 'en', 'chat');
    expect(r.intent).toBe('book_appointment');
    r = await handleMessage('Reliability Test Doctor', sid, 'en', 'chat');
    expect(r.intent).toBe('book_appointment');
    return r;
  }

  test('rejects impossible dates and non-slot times during the conversation', async () => {
    let r = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    expect(r.intent).toBe('book_appointment');
    const sid = r.session_id;
    await runBookingToConfirm(sid);

    // Impossible calendar date must be rejected (strict validation).
    r = await handleMessage('2026-02-31', sid, 'en', 'chat');
    expect(r.reply.toLowerCase()).toContain('invalid date');

    // A real future date shows only live slots.
    r = await handleMessage(nextMonday(), sid, 'en', 'chat');
    expect(r.reply.toLowerCase()).toContain('09:00');

    // A non-slot time must be rejected and fresh slots offered.
    r = await handleMessage('09:15', sid, 'en', 'chat');
    expect(r.reply).toContain('live doctor appointment slots');
    expect(r.reply).toContain('Available slots');
    expect(r.conversation_active).toBe(true);
  });

  test('books a valid slot and reports conflict with fresh slots on double-booking, then recovers', async () => {
    const db = getDb();
    const date = nextMonday();

    // First conversation: complete booking at 09:00.
    let r = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    const sid1 = r.session_id;
    await runBookingToConfirm(sid1);
    r = await handleMessage(date, sid1, 'en', 'chat');
    expect(r.reply.toLowerCase()).toContain('09:00');
    r = await handleMessage('09:00', sid1, 'en', 'chat');
    expect(r.intent).toBe('book_appointment');
    r = await handleMessage('yes', sid1, 'en', 'chat');
    expect(r.action?.type).toBe('appointment_created');
    expect((r.action.data as { time: string }).time).toBe('09:00');

    // Second conversation: same slot → conflict with fresh slots, conversation stays open.
    r = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    const sid2 = r.session_id;
    await runBookingToConfirm(sid2);
    r = await handleMessage(date, sid2, 'en', 'chat');
    r = await handleMessage('09:00', sid2, 'en', 'chat');
    r = await handleMessage('yes', sid2, 'en', 'chat');
    expect(r.reply).toContain('just booked');
    expect(r.reply).toContain('Available slots');
    expect(r.reply).not.toContain('09:00'); // taken slot is not re-offered
    expect(r.conversation_active).toBe(true);

    // The flow rolled back to time selection: patient picks 10:00 → confirm → booked.
    r = await handleMessage('10:00', sid2, 'en', 'chat');
    expect(r.intent).toBe('book_appointment');
    r = await handleMessage('yes', sid2, 'en', 'chat');
    expect(r.action?.type).toBe('appointment_created');
    expect((r.action.data as { time: string }).time).toBe('10:00');

    db.run("DELETE FROM appointments WHERE doctor_id = ? AND date = ?", [doctorId, date]);
  });
});
