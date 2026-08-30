/**
 * Admin-gated API for appointment SMS reminders (SRS FR-APT-05).
 *
 *   GET  /api/reminders/status  — config + reminder status/counts
 *   POST /api/reminders/run     — trigger a reminder send on demand
 *
 * The endpoint is RBAC-gated on the `reminders` module (admin only) by
 * src/index.ts via getModuleFromPath() — see src/middleware/auth.ts.
 */
import { json, error } from "../middleware/http";
import { getDb } from "../db";
import {
  processDueReminders,
  findDueAppointments,
  getReminderHours,
  twilioConfigured,
} from "../reminders/reminderService";

export async function handleReminders(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;
  const db = getDb();

  // GET /api/reminders/status
  if (pathname === "/api/reminders/status" && method === "GET") {
    const reminderHours = getReminderHours();
    const due = findDueAppointments(db, { reminderHours });
    const sentCount =
      (db.query("SELECT COUNT(*) AS c FROM appointment_reminders WHERE status = 'sent'").get() as {
        c: number;
      })?.c ?? 0;
    const failedCount =
      (db.query("SELECT COUNT(*) AS c FROM appointment_reminders WHERE status = 'failed'").get() as {
        c: number;
      })?.c ?? 0;
    return json({
      configured: twilioConfigured(),
      reminderHours,
      dueCount: due.length,
      sentCount,
      failedCount,
    });
  }

  // POST /api/reminders/run — trigger a send now
  if (pathname === "/api/reminders/run" && method === "POST") {
    const summary = await processDueReminders(db);
    return json(summary);
  }

  return error("Not found", 404);
}
