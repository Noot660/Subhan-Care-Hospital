/**
 * Appointment reminders via SMS (SRS FR-APT-05).
 *
 * The product has no email gateway, so reminders are sent as SMS through the
 * Twilio Messages REST API (plain HTTP form-POST with HTTP Basic auth — no
 * heavy SDK dependency). A background ticker in src/index.ts finds scheduled
 * appointments that fall within a configurable "hours before" window, sends
 * one SMS to the patient's phone, and records the send in an
 * `appointment_reminders` table so each appointment is reminded at most once.
 *
 * All credential/config reads are defensive: if Twilio is not configured the
 * sender degrades gracefully (nothing crashes, nothing is sent or recorded),
 * so a hospital can run the HMS entirely without SMS.
 *
 * Env:
 *   REMINDER_HOURS             (default 24) — hours before the appointment at
 *                             which a reminder qualifies to be sent.
 *   REMINDER_INTERVAL_MINUTES  (default 5)  — how often the background ticker
 *                             runs (used only by the ticker in index.ts).
 *   TWILIO_ACCOUNT_SID         — Twilio account SID (optional).
 *   TWILIO_AUTH_TOKEN          — Twilio auth token (optional).
 *   TWILIO_FROM                — Twilio phone number to send FROM (optional).
 */
import type { Database } from "bun:sqlite";
import { hospitalTimezoneOffsetMs, appointmentStartMs } from "./datetime";

export const DEFAULT_REMINDER_HOURS = 24;
export const DEFAULT_REMINDER_INTERVAL_MINUTES = 5;

export interface DueAppointment {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_phone: string;
  doctor_id: number;
  doctor_name: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface SendResult {
  ok: boolean;
  reason?: "no-credentials" | "http-error" | "twilio-error";
  detail?: string;
}

export interface ReminderSummary {
  configured: boolean;
  reminderHours: number;
  due: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  skippedReason: string | null;
}

/** Read the hours-before interval from env with a sane default. */
export function getReminderHours(): number {
  const raw = process.env.REMINDER_HOURS;
  if (raw === undefined || raw === "") return DEFAULT_REMINDER_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_REMINDER_HOURS;
  return n;
}

/** Whether all Twilio credentials required to send are present. */
export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM
  );
}

/**
 * Select scheduled appointments whose start date+time falls inside the
 * reminder window: `now <= start <= now + reminderHours`, that belong to a
 * patient with a phone number, and that have NOT already received a reminder
 * (single-reminder guard — any row in appointment_reminders excludes it).
 */
export function findDueAppointments(
  db: Database,
  opts: { now?: number; reminderHours?: number } = {}
): DueAppointment[] {
  const now = opts.now ?? Date.now();
  const reminderHours = opts.reminderHours ?? getReminderHours();
  const windowEndMs = now + reminderHours * 60 * 60 * 1000;

  const rows = db
    .query(
      `SELECT a.id, a.patient_id, a.doctor_id, a.date, a.start_time, a.end_time,
              p.full_name AS patient_name, p.phone AS patient_phone,
              d.name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors  d ON d.id = a.doctor_id
        WHERE a.status = 'scheduled'
          AND p.phone IS NOT NULL AND trim(p.phone) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM appointment_reminders r WHERE r.appointment_id = a.id
          )`
    )
    .all() as DueAppointment[];

  return rows.filter((r) => {
    const startMs = appointmentStartMs(r.date, r.start_time);
    return startMs >= now && startMs <= windowEndMs;
  });
}

/**
 * Send an SMS via the Twilio Messages REST API using the native fetch. Pure
 * function delegation (no save of send state) — orchestration and the
 * single-reminder guard live in `processDueReminders`.
 */
export async function sendSmsViaTwilio(
  to: string,
  body: string
): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return { ok: false, reason: "no-credentials" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    sid
  )}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      return { ok: false, reason: "twilio-error", detail: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "http-error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Build a friendly reminder SMS body. */
export function buildReminderMessage(appt: DueAppointment): string {
  const label = `${appt.patient_name.split(" ")[0] || "Patient"}`;
  return (
    `Dear ${label}, this is a reminder for your appointment at Subhan Care Hospital ` +
    `with Dr. ${appt.doctor_name} on ${appt.date} at ${appt.start_time}. ` +
    `Please arrive 15 minutes early. Reply or call to reschedule. Thank you.`
  );
}

/**
 * Orchestrator: find due appointments, send each one (or degrade gracefully),
 * and persist the reminder row so each appointment is reminded exactly once.
 *
 * A `send` override is injectable for tests; it defaults to the real Twilio
 * call. When Twilio is not configured, nothing is sent and NO rows are
 * recorded (the database is left untouched for a later config/send).
 */
export async function processDueReminders(
  db: Database,
  opts: {
    now?: number;
    reminderHours?: number;
    send?: (to: string, body: string) => Promise<SendResult>;
  } = {}
): Promise<ReminderSummary> {
  const summaryBase: ReminderSummary = {
    configured: twilioConfigured(),
    reminderHours: opts.reminderHours ?? getReminderHours(),
    due: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    skippedReason: null,
  };
  const due = findDueAppointments(db, {
    now: opts.now,
    reminderHours: summaryBase.reminderHours,
  });
  summaryBase.due = due.length;

  if (due.length === 0) return summaryBase;
  if (!summaryBase.configured) {
    summaryBase.skipped = due.length;
    summaryBase.skippedReason = "Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM missing)";
    return summaryBase;
  }

  const send = opts.send ?? sendSmsViaTwilio;
  for (const appt of due) {
    summaryBase.attempted += 1;
    const msg = buildReminderMessage(appt);
    const result = await send(appt.patient_phone, msg);
    const status = result.ok ? "sent" : "failed";
    if (result.ok) summaryBase.sent += 1;
    else summaryBase.failed += 1;
    db.run(
      `INSERT INTO appointment_reminders
         (appointment_id, patient_id, status, message, attempt_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [appt.id, appt.patient_id, status, msg]
    );
  }
  return summaryBase;
}
