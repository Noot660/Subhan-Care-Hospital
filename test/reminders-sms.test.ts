import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test";
import { getDb } from "../src/db";
import type { Database } from "bun:sqlite";
import { handleRequest } from "../src/index";
import { handleAuthLogin } from "../src/routes/auth";
import { HOSPITAL_TIME_ZONE } from "../src/appointments/validation";
import {
  findDueAppointments,
  processDueReminders,
  getReminderHours,
  twilioConfigured,
  buildReminderMessage,
  SendResult,
} from "../src/reminders/reminderService";
import { appointmentStartMs } from "../src/reminders/datetime";

/**
 * Appointment reminders — SMS (SRS FR-APT-05).
 *
 * Tests the reminder-selection window (which appointments qualify), the
 * single-reminder guard, and graceful degradation when Twilio is not
 * configured. Fixtures are created and removed within this file against a
 * seeded dev database; time is controlled via an explicit `now` so the tests
 * are deterministic regardless of wall-clock time.
 */
const TEST_DOCTOR_CNIC = "88000-0000001-7";
const TEST_PATIENT_BASE = "88000-0000002";
let doctorId = 0;
let createdAppointmentIds: number[] = [];

// Convert an epoch-ms instant to hospital wall-clock date (YYYY-MM-DD) and
// time (HH:MM) strings — the storage format for appointments.
function wallClock(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return { date, time };
}

function makeDoctor(db: Database): void {
  const doc = db.query("SELECT id FROM doctors WHERE cnic = ?").get(TEST_DOCTOR_CNIC) as
    | { id: number }
    | undefined;
  if (doc) {
    doctorId = doc.id;
    return;
  }
  const r = db.run(
    `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    ["Reminder Test Doctor", "General Medicine", "MBBS", TEST_DOCTOR_CNIC, "0300-0000071", 1000]
  );
  doctorId = Number(r.lastInsertRowid);
}

function makePatient(db: Database, index: number, phone: string): number {
  const cnic = `${TEST_PATIENT_BASE}-${String(index).padStart(1, "0")}-${7}`;
  const existing = db.query("SELECT id FROM patients WHERE cnic = ?").get(cnic) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const r = db.run(
    `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [`P-REM-${index}`, `Reminder Patient ${index}`, "1990-01-01", "male", cnic, phone, "Test St", "0300-0000000"]
  );
  return Number(r.lastInsertRowid);
}

function insertAppointment(
  db: Database,
  startMs: number,
  patientPhone: string,
  patientIndex: number,
  status = "scheduled"
): number {
  const patientId = makePatient(db, patientIndex, patientPhone);
  const wc = wallClock(startMs);
  const endMs = startMs + 30 * 60 * 1000;
  const endWc = wallClock(endMs);
  const r = db.run(
    `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'staff', datetime('now'), datetime('now'))`,
    [patientId, doctorId, wc.date, wc.time, endWc.time, status]
  );
  const id = Number(r.lastInsertRowid);
  createdAppointmentIds.push(id);
  return id;
}

const REAL_TWILIO = {
  sid: process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  from: process.env.TWILIO_FROM,
};

function clearTwilioEnv(): void {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM;
}
function setTwilioEnv(): void {
  process.env.TWILIO_ACCOUNT_SID = "AC-test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15000000000";
}
function restoreTwilioEnv(): void {
  if (REAL_TWILIO.sid) process.env.TWILIO_ACCOUNT_SID = REAL_TWILIO.sid;
  else delete process.env.TWILIO_ACCOUNT_SID;
  if (REAL_TWILIO.token) process.env.TWILIO_AUTH_TOKEN = REAL_TWILIO.token;
  else delete process.env.TWILIO_AUTH_TOKEN;
  if (REAL_TWILIO.from) process.env.TWILIO_FROM = REAL_TWILIO.from;
  else delete process.env.TWILIO_FROM;
}

beforeAll(() => {
  const db = getDb();
  makeDoctor(db);
  createdAppointmentIds = [];
});

// Clean slate of this doctor's test appointments before every test so the
// active-slot unique index never collides across tests.
beforeEach(() => {
  const db = getDb();
  for (const id of createdAppointmentIds) {
    db.run("DELETE FROM appointment_reminders WHERE appointment_id = ?", [id]);
    db.run("DELETE FROM appointments WHERE id = ?", [id]);
  }
  createdAppointmentIds = [];
  db.run("DELETE FROM appointments WHERE doctor_id = ?", [doctorId]);
});

afterAll(() => {
  const db = getDb();
  for (const id of createdAppointmentIds) {
    db.run("DELETE FROM appointment_reminders WHERE appointment_id = ?", [id]);
    db.run("DELETE FROM appointments WHERE id = ?", [id]);
  }
  createdAppointmentIds = [];
  restoreTwilioEnv();
});

describe("reminder window selection (findDueAppointments)", () => {
  test("qualifies only scheduled appointments inside the hours-before window with a phone", () => {
    const db = getDb();
    clearTwilioEnv();
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    // within window -> qualifies
    const inside = insertAppointment(db, now + 1 * hour, "0300-1000001", 1);
    // outside window (48h, reminder 24h) -> NOT
    const outside = insertAppointment(db, now + 48 * hour, "0300-1000002", 2);
    // cancelled even though inside -> NOT
    const cancelled = insertAppointment(db, now + 2 * hour, "0300-1000003", 3, "cancelled");
    // in the past -> NOT
    const past = insertAppointment(db, now - 1 * hour, "0300-1000004", 4);
    // inside but no phone -> NOT
    const nophone = insertAppointment(db, now + 3 * hour, "   ", 5);

    const due = findDueAppointments(db, { now, reminderHours: 24 }).map((a) => a.id);
    expect(due).toContain(inside);
    expect(due).not.toContain(outside);
    expect(due).not.toContain(cancelled);
    expect(due).not.toContain(past);
    expect(due).not.toContain(nophone);
  });

  test("respects a custom reminder interval", () => {
    const db = getDb();
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const near = insertAppointment(db, now + 2 * hour, "0300-1000006", 6);
    const far = insertAppointment(db, now + 6 * hour, "0300-1000007", 7);
    const due = findDueAppointments(db, { now, reminderHours: 4 }).map((a) => a.id);
    expect(due).toContain(near);
    expect(due).not.toContain(far);
  });

  test("getReminderHours reads env with a 24h default", () => {
    delete process.env.REMINDER_HOURS;
    expect(getReminderHours()).toBe(24);
    process.env.REMINDER_HOURS = "6";
    expect(getReminderHours()).toBe(6);
    process.env.REMINDER_HOURS = "not-a-number";
    expect(getReminderHours()).toBe(24);
    delete process.env.REMINDER_HOURS;
  });

  test("appointmentStartMs round-trips a wall-clock slot to a real instant", () => {
    const now = Date.now();
    const wc = wallClock(now + 2 * 60 * 60 * 1000);
    // Jump to an even minute boundary so a second difference doesn't matter.
    const target = Math.round((now + 2 * 60 * 60 * 1000) / 60000) * 60000;
    const targetWc = wallClock(target);
    expect(appointmentStartMs(targetWc.date, targetWc.time)).toBe(target);
  });
});

describe("single-reminder guard + graceful missing-cred behaviour", () => {
  test("records one reminder per appointment and does not resend", async () => {
    const db = getDb();
    setTwilioEnv();
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const appt = insertAppointment(db, now + 2 * hour, "0300-1000008", 8);
    let calls = 0;
    const fakeSend = async (): Promise<SendResult> => {
      calls += 1;
      return { ok: true };
    };
    const s1 = await processDueReminders(db, { now, reminderHours: 24, send: fakeSend });
    expect(s1.due).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1);
    const row = db
      .query("SELECT status FROM appointment_reminders WHERE appointment_id = ?")
      .get(appt) as { status: string } | undefined;
    expect(row?.status).toBe("sent");

    // Second run: nothing due for this appointment any more.
    const before = calls;
    const s2 = await processDueReminders(db, { now, reminderHours: 24, send: fakeSend });
    expect(s2.due).toBe(0);
    expect(calls).toBe(before);
  });

  test("gracefully skips when Twilio is not configured (no crash, no records)", async () => {
    const db = getDb();
    clearTwilioEnv();
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const appt = insertAppointment(db, now + 2 * hour, "0300-1000009", 9);

    expect(twilioConfigured()).toBe(false);
    const summary = await processDueReminders(db, { now, reminderHours: 24 });
    expect(summary.configured).toBe(false);
    expect(summary.skipped).toBe(summary.due);
    expect(summary.attempted).toBe(0);
    // No reminder row should be recorded when not configured.
    const row = db
      .query("SELECT id FROM appointment_reminders WHERE appointment_id = ?")
      .get(appt) as { id: number } | undefined;
    expect(row).toBeNull();
  });

  test("twilioConfigured requires all three credentials", () => {
    setTwilioEnv();
    expect(twilioConfigured()).toBe(true);
    delete process.env.TWILIO_FROM;
    expect(twilioConfigured()).toBe(false);
    restoreTwilioEnv();
  });

  test("buildReminderMessage references patient, doctor, date and time", () => {
    const msg = buildReminderMessage({
      id: 1,
      patient_id: 1,
      patient_name: "Ayesha Khan",
      patient_phone: "0300-0000000",
      doctor_id: 1,
      doctor_name: "Dr. Ali",
      date: "2026-09-01",
      start_time: "10:00",
      end_time: "10:30",
    });
    expect(msg).toContain("Ayesha");
    expect(msg).toContain("Dr. Ali");
    expect(msg).toContain("2026-09-01");
    expect(msg).toContain("10:00");
  });
});

describe("reminders HTTP API (admin-gated, RBAC 'reminders' module)", () => {
  let adminToken: string;
  let receptionistToken: string;

  beforeAll(async () => {
    async function login(username: string, password: string): Promise<string> {
      const res = await handleAuthLogin(
        new Request("http://test/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        })
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as { token: string }).token;
    }
    adminToken = await login("admin", "admin123");
    receptionistToken = await login("receptionist", "staff123");
  });

  test("admin can read reminder status (configured=false, graceful)", async () => {
    clearTwilioEnv();
    const res = await handleRequest(
      new Request("http://test/api/reminders/status", {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; reminderHours: number };
    expect(body.configured).toBe(false);
    expect(body.reminderHours).toBe(24);
  });

  test("non-admin role is denied (403)", async () => {
    clearTwilioEnv();
    const res = await handleRequest(
      new Request("http://test/api/reminders/status", {
        headers: { Authorization: `Bearer ${receptionistToken}` },
      })
    );
    expect(res.status).toBe(403);
  });

  test("manual run endpoint triggers gracefully when not configured", async () => {
    clearTwilioEnv();
    const res = await handleRequest(
      new Request("http://test/api/reminders/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });
});
