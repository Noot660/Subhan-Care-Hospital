import type { Database } from "bun:sqlite";

/**
 * Shared appointment validation + slot logic.
 *
 * Both entry points that create/reschedule appointments — the AI receptionist
 * (src/ai/intents.ts) and the HTTP API (src/routes/appointments.ts) — must
 * agree on what a valid, bookable slot is. Everything here is the single
 * source of truth: strict calendar validation (timezone-correct), slots
 * generated purely from the doctor's live schedule, and the set of statuses
 * that occupy a slot.
 */

export const HOSPITAL_TIME_ZONE = "Asia/Karachi";

/** Statuses that occupy a slot (a cancelled/no-show appointment frees it). */
const ACTIVE_STATUSES = "('scheduled', 'checked-in', 'completed')";

/** Today's calendar date in the hospital's timezone, as YYYY-MM-DD. */
export function hospitalToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Current wall-clock time in the hospital's timezone, as HH:MM (24h). */
function hospitalNowHHMM(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/**
 * Strict calendar validation. `Date.parse` silently normalizes impossible
 * dates (2026-02-31 → 2026-03-03), so we round-trip through Date.UTC instead
 * and reject anything that does not land exactly on the requested calendar
 * date. "Past" is judged in the hospital's timezone, not the server's.
 */
export function validateCalendarDate(
  value: string,
  allowPast = false
): { ok: true; dayOfWeek: number } | { ok: false; message: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, message: "Invalid date. Use YYYY-MM-DD." };
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return { ok: false, message: "Invalid calendar date." };
  }
  if (!allowPast && value < hospitalToday()) return { ok: false, message: "Date cannot be in the past." };
  return { ok: true, dayOfWeek: candidate.getUTCDay() };
}

/** End time of a 30-minute appointment starting at `startTime` (HH:MM). */
export function appointmentEndTime(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** True when `startTime` on `date` has already started in hospital time (only ever true for today). */
export function slotInPast(date: string, startTime: string): boolean {
  if (date !== hospitalToday()) return false;
  return startTime <= hospitalNowHHMM();
}

/**
 * The doctor's live 30-minute slots for a date, generated strictly from
 * doctor_schedules (never hard-coded). Slots that have already started today
 * are excluded, so callers can only ever offer/accept real, bookable slots.
 */
export function generatedSlots(
  db: Database,
  doctorId: number,
  date: string
): Array<{ start_time: string; end_time: string }> {
  const checked = validateCalendarDate(date, true);
  if (!checked.ok) return [];
  const schedules = db
    .query("SELECT start_time, end_time FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ? ORDER BY start_time")
    .all(doctorId, checked.dayOfWeek) as Array<{ start_time: string; end_time: string }>;
  const slots: Array<{ start_time: string; end_time: string }> = [];
  for (const schedule of schedules) {
    let current = schedule.start_time;
    while (current < schedule.end_time) {
      const end = appointmentEndTime(current);
      if (end > schedule.end_time) break;
      if (!slotInPast(date, current)) slots.push({ start_time: current, end_time: end });
      current = end;
    }
  }
  return slots;
}

/**
 * Generated slots minus those already held by an active appointment.
 * Pass `excludingId` (e.g. the appointment being rescheduled) to treat that
 * appointment's own slot as free.
 */
export function availableSlots(
  db: Database,
  doctorId: number,
  date: string,
  excludingId?: number
): Array<{ start_time: string; end_time: string }> {
  const booked = db
    .query(
      `SELECT start_time FROM appointments WHERE doctor_id = ? AND date = ? AND status IN ${ACTIVE_STATUSES}${excludingId ? " AND id != ?" : ""}`
    )
    .all(...(excludingId ? [doctorId, date, excludingId] : [doctorId, date])) as Array<{ start_time: string }>;
  const busy = new Set(booked.map((row) => row.start_time));
  return generatedSlots(db, doctorId, date).filter((slot) => !busy.has(slot.start_time));
}

export type AppointmentInputResult = { ok: true; endTime: string } | { ok: false; message: string };

/**
 * Shared input validation for booking/rescheduling: the date must be a real,
 * non-past calendar date and the time must be exactly one of the doctor's
 * live generated slot starts. Availability (not already booked) is enforced
 * separately — the partial unique index in src/db/index.ts is the atomic
 * backstop that turns a concurrent double-booking into an error.
 */
export function validateAppointmentInput(
  db: Database,
  doctorId: number,
  date: string,
  startTime: string
): AppointmentInputResult {
  const dateResult = validateCalendarDate(date);
  if (!dateResult.ok) return dateResult;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    return { ok: false, message: "Invalid time. Choose a live 30-minute doctor slot." };
  }
  const slot = generatedSlots(db, doctorId, date).find((candidate) => candidate.start_time === startTime);
  if (!slot) return { ok: false, message: "Choose one of the live doctor appointment slots." };
  return { ok: true, endTime: slot.end_time };
}
