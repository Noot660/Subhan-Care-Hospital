/**
 * Timezone-aware datetime helpers for appointment reminders.
 *
 * Appointments are stored as a wall-clock `date` (YYYY-MM-DD) and `start_time`
 * (HH:MM) in the hospital's timezone (Asia/Karachi, fixed UTC+5 — no DST).
 * Here we convert that wall-clock pair into a UTC epoch millisecond value so
 * it can be compared against `Date.now()` for the reminder window.
 */
import { HOSPITAL_TIME_ZONE } from "../appointments/validation";

/** UTC offset of the hospital timezone at a given instant, in ms. */
export function hospitalTimezoneOffsetMs(utcMs: number): number {
  const fmtParts = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
  const toMin = (parts: Intl.DateTimeFormatPart[]) =>
    Number(parts.find((p) => p.type === "hour")?.value || "0") * 60 +
    Number(parts.find((p) => p.type === "minute")?.value || "0");
  const diffMin = (toMin(fmtParts(HOSPITAL_TIME_ZONE)) - toMin(fmtParts("UTC")) + 1440) % 1440;
  return diffMin * 60 * 1000;
}

/**
 * Convert a wall-clock appointment date + start time (hospital timezone) into
 * a UTC epoch ms timestamp. Works by deriving the hospital-vs-UTC offset and
 * subtracting it from the naive UTC parse of the wall-clock time.
 */
export function appointmentStartMs(date: string, startTime: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = startTime.split(":").map(Number);
  const wallClockUtc = Date.UTC(y, m - 1, d, h, min, 0, 0);
  const offset = hospitalTimezoneOffsetMs(wallClockUtc);
  return wallClockUtc - offset;
}
