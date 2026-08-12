import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { getDb } from '../src/db';
import { handleMessage } from '../src/ai/intents';
import { detectRedFlag } from '../src/ai/safety';
import { hospitalToday } from '../src/appointments/validation';

/**
 * Option C P0 safety sprint — focused tests:
 *  - shared deterministic red-flag detection (English + Roman Urdu, incl.
 *    spelling variants) and escalation-only behavior (no diagnosis claims)
 *  - missing/invalid severity never defaults: re-ask for a numeric 1–10
 *  - Roman Urdu duration variants (hafta/hafte/haftey, mahina/mahine/maheene)
 *  - appointment_created AI event redacts patient_name (privacy baseline)
 */

// Identity verification stub is a dev-only flag (docs/security-privacy-baseline.md).
const originalStub = process.env.PHI_VERIFICATION_STUB;
process.env.PHI_VERIFICATION_STUB = 'true';

// ── red-flag detection ──

describe('clinical safety: red-flag detection (shared module)', () => {
  test('English red flags are detected with escalation category', () => {
    expect(detectRedFlag('I have chest pain')?.category).toBe('chest_pain');
    expect(detectRedFlag("I can't breathe")?.category).toBe('breathing_difficulty');
    expect(detectRedFlag('he is unconscious right now')?.category).toBe('unconscious');
    expect(detectRedFlag('she passed out')?.category).toBe('unconscious');
    expect(detectRedFlag('severe bleeding from the wound')?.category).toBe('severe_bleeding');
    expect(detectRedFlag('my father had a heart attack')?.category).toBe('heart_attack');
    expect(detectRedFlag('shortness of breath')?.category).toBe('breathing_difficulty');
  });

  test('Roman Urdu red flags are detected (audit phrases + spelling variants)', () => {
    expect(detectRedFlag('seena mein dard hai')?.category).toBe('chest_pain');
    expect(detectRedFlag('seene main dard')?.category).toBe('chest_pain');
    expect(detectRedFlag('sina me dard')?.category).toBe('chest_pain');
    expect(detectRedFlag('saans nahi aa rahi')?.category).toBe('breathing_difficulty');
    expect(detectRedFlag('sans nahi aa raha')?.category).toBe('breathing_difficulty');
    expect(detectRedFlag('saans nahi aa')?.category).toBe('breathing_difficulty');
    expect(detectRedFlag('mera beta behosh ho gaya')?.category).toBe('unconscious');
    expect(detectRedFlag('wo behoush hai')?.category).toBe('unconscious');
    expect(detectRedFlag('khoon bahut bah raha hai')?.category).toBe('severe_bleeding');
    expect(detectRedFlag('bahut zyada khoon')?.category).toBe('severe_bleeding');
    expect(detectRedFlag('khoon nahi ruk raha')?.category).toBe('severe_bleeding');
    expect(detectRedFlag('dil ka daura para hai')?.category).toBe('heart_attack');
  });

  test('mild / non-emergency phrases are NOT red flags', () => {
    expect(detectRedFlag('mujhe sardi hai')).toBeNull();
    expect(detectRedFlag('mere sir mein dard hai')).toBeNull();
    expect(detectRedFlag('mujhe bukhar hai')).toBeNull();
    expect(detectRedFlag('I have a headache')).toBeNull();
    expect(detectRedFlag('my stomach hurts')).toBeNull();
    expect(detectRedFlag('I am bleeding a little from my finger')).toBeNull();
    expect(detectRedFlag('mujhe khoon ki kami hai')).toBeNull();
    expect(detectRedFlag('appointment book karni hai')).toBeNull();
    expect(detectRedFlag('')).toBeNull();
  });
});

describe('clinical safety: emergency escalation via the receptionist flow', () => {
  test('Roman Urdu red flag escalates and does not claim a diagnosis', async () => {
    const res = await handleMessage('seena mein dard hai', null, 'ur', 'chat');
    expect(res.conversation_active).toBe(false);
    expect(res.intent).toBe('triage');
    expect(res.reply).toContain('1122');                    // navigation to emergency
    expect(res.reply).toContain('doctor nahi');             // disclaimer retained
    expect(res.reply).not.toMatch(/diagnos|heart attack|daura\b/i); // no diagnosis wording
  });

  test('English red flag escalates even when it would otherwise classify elsewhere', async () => {
    const res = await handleMessage('I am having a heart attack', null, 'en', 'chat');
    expect(res.conversation_active).toBe(false);
    expect(res.reply).toContain('URGENT');
    expect(res.reply).toContain('not a doctor');
  });

  test('red flag interrupts an in-progress flow immediately', async () => {
    const started = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    expect(started.conversation_active).toBe(true);
    const interrupted = await handleMessage('saans nahi aa rahi', started.session_id, 'ur', 'chat');
    expect(interrupted.conversation_active).toBe(false);
    expect(interrupted.reply).toContain('EMERGENCY'); // Urdu emergency copy
    expect(interrupted.reply).toContain('1122');
  });
});

// ── severity validation ──

async function startTriageAtSeverity(lang: 'en' | 'ur') {
  const first = await handleMessage(
    lang === 'ur' ? 'mujhe bukhar hai' : 'I have a fever',
    null, lang, 'chat'
  );
  expect(first.conversation_active).toBe(true);
  expect(first.reply).toContain(lang === 'ur' ? '1 se 10' : '1-10');
  return first;
}

describe('triage severity: never default to 5', () => {
  test('a missing number re-asks instead of defaulting to severity 5', async () => {
    const s = await startTriageAtSeverity('en');
    const res = await handleMessage('bahut zyada', s.session_id, 'en', 'chat');
    expect(res.conversation_active).toBe(true);                       // still on ask_severity
    expect(res.reply).toContain('number from 1 to 10');               // localized re-ask
    expect(res.reply).not.toContain('How long');                      // did NOT advance
  });

  test('out-of-range and non-numeric values are rejected and re-asked', async () => {
    for (const bad of ['0', '11', '50', '100', '-3', 'ten', 'abc']) {
      const s = await startTriageAtSeverity('en');
      const res = await handleMessage(bad, s.session_id, 'en', 'chat');
      expect(res.conversation_active).toBe(true);
      expect(res.reply).toContain('number from 1 to 10');
    }
  });

  test('Roman Urdu re-ask copy is localized', async () => {
    const s = await startTriageAtSeverity('ur');
    const res = await handleMessage('bahut', s.session_id, 'ur', 'chat');
    expect(res.conversation_active).toBe(true);
    expect(res.reply).toContain('1 se 10');
  });

  test('a valid 1–10 severity advances; severity 10 escalates', async () => {
    const s = await startTriageAtSeverity('en');
    const res = await handleMessage('3', s.session_id, 'en', 'chat');
    expect(res.conversation_active).toBe(true);
    expect(res.reply).toContain('How long');

    const s2 = await startTriageAtSeverity('en');
    const res2 = await handleMessage('10', s2.session_id, 'en', 'chat');
    expect(res2.conversation_active).toBe(false);
    expect(res2.reply).toContain('URGENT');
  });
});

// ── duration variants ──

async function triageWithDuration(duration: string, lang: 'en' | 'ur') {
  const s = await startTriageAtSeverity(lang);
  await handleMessage('5', s.session_id, lang, 'chat'); // severity 5 (not ≥ 6, not ≥ 8)
  return handleMessage(duration, s.session_id, lang, 'chat');
}

describe('triage duration: Roman Urdu variants count as long duration', () => {
  test('hafta / hafte / haftey / mahine / saal are recognized', async () => {
    for (const d of ['1 hafta', 'do hafte', 'teen haftey', 'do mahine', 'teen maheene', '1 saal', '2 weeks', '1 month']) {
      const res = await triageWithDuration(d, 'ur');
      expect(res.conversation_active).toBe(false);
      expect(res.reply).toContain('Doctor'); // see_doctor outcome
    }
  });

  test('short durations still recommend rest', async () => {
    const res = await triageWithDuration('2 din', 'ur');
    expect(res.conversation_active).toBe(false);
    expect(res.reply).toContain('aaram'); // rest outcome
  });
});

// ── PHI redaction in appointment_created AI events ──

describe('appointment_created AI event redacts patient name', () => {
  const DOCTOR_CNIC = '99000-0000101-4';
  const PATIENT_CNIC = '99000-0000102-3';
  const PATIENT_NAME = 'Safety Sprint PHI Patient';
  const DOCTOR_NAME = 'Safety Sprint Test Doctor';
  let doctorId = 0;
  let patientId = 0;
  let phiSessionId = '';

  function addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  function weekdayOf(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function nextMonday(): string {
    let date = addDays(hospitalToday(), 1);
    for (let i = 0; i < 9; i++) {
      if (weekdayOf(date) === 1) return date;
      date = addDays(date, 1);
    }
    throw new Error('unreachable');
  }

  beforeAll(() => {
    const db = getDb();
    const doctor = db.query("SELECT id FROM doctors WHERE cnic = ?").get(DOCTOR_CNIC) as { id: number } | undefined;
    if (doctor) doctorId = doctor.id;
    else {
      doctorId = Number(db.run(
        `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [DOCTOR_NAME, 'General Medicine', 'MBBS', DOCTOR_CNIC, '0300-9999001', 1000]
      ).lastInsertRowid);
    }
    // Reset slot state so repeated runs book the same 09:00 slot cleanly.
    db.run("DELETE FROM appointments WHERE doctor_id = ?", [doctorId]);
    db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctorId]);
    for (let day = 1; day <= 5; day++) {
      db.run("INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)", [doctorId, day, '09:00', '11:00']);
    }
    const patient = db.query("SELECT id FROM patients WHERE cnic = ?").get(PATIENT_CNIC) as { id: number } | undefined;
    if (patient) patientId = patient.id;
    else {
      patientId = Number(db.run(
        `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        ['SC-PT-SAFETY-SPRINT', PATIENT_NAME, '1990-01-01', 'female', PATIENT_CNIC, '0313-9999002', 'Test Address', '0300-9999003']
      ).lastInsertRowid);
    }
  });

  afterAll(() => {
    const db = getDb();
    db.run("DELETE FROM appointments WHERE doctor_id = ?", [doctorId]);
    db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctorId]);
    db.run("DELETE FROM doctors WHERE id = ?", [doctorId]);
    db.run("DELETE FROM patients WHERE id = ?", [patientId]);
    if (phiSessionId) db.run("DELETE FROM ai_events WHERE session_id = ?", [phiSessionId]);
    if (originalStub === undefined) delete process.env.PHI_VERIFICATION_STUB;
    else process.env.PHI_VERIFICATION_STUB = originalStub;
  });

  test('event details contain appointment reference but no patient name', async () => {
    const s = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    phiSessionId = s.session_id;
    await handleMessage('yes', phiSessionId, 'en', 'chat');                       // is patient
    await handleMessage(PATIENT_CNIC, phiSessionId, 'en', 'chat');                // identifier
    await handleMessage(DOCTOR_NAME, phiSessionId, 'en', 'chat');                 // doctor
    await handleMessage(nextMonday(), phiSessionId, 'en', 'chat');                // date
    const timeRes = await handleMessage('09:00', phiSessionId, 'en', 'chat');     // time
    expect(timeRes.reply).toContain('confirm');
    const done = await handleMessage('yes', phiSessionId, 'en', 'chat');          // confirm
    expect(done.conversation_active).toBe(false);
    expect(done.reply).toContain('booked');

    const db = getDb();
    const row = db.query(
      `SELECT details FROM ai_events WHERE session_id = ? AND event_type = 'appointment_created' ORDER BY id DESC LIMIT 1`
    ).get(phiSessionId) as { details: string } | undefined;
    expect(row).toBeDefined();
    const details = JSON.parse(row!.details) as Record<string, unknown>;
    expect(details).not.toHaveProperty('patient_name');
    expect(row!.details).not.toContain(PATIENT_NAME);     // no free-text PHI in raw JSON either
    expect(details.appointment_id).toBeDefined();         // staff can still trace via appointment id
  });
});
