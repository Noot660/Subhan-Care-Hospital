import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Appointment } from "../types";

async function handleCreateAppointment(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{ patient_id: number; doctor_id: number; date: string; start_time: string }>(request);
    if (!body.patient_id || !body.doctor_id || !body.date || !body.start_time) return error("Missing required fields: patient_id, doctor_id, date, start_time", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return error("Invalid date format. Use YYYY-MM-DD", 400);
    if (!/^\d{2}:\d{2}$/.test(body.start_time)) return error("Invalid time format. Use HH:MM", 400);
    const db = getDb();
    if (!db.query("SELECT * FROM patients WHERE id = ? AND status = 'active'").get(body.patient_id)) return error("Patient not found or inactive", 404);
    if (!db.query("SELECT * FROM doctors WHERE id = ? AND status = 'active'").get(body.doctor_id)) return error("Doctor not found or inactive", 404);
    const [h, m] = body.start_time.split(":").map(Number);
    let endH = h, endM = m + 30;
    if (endM >= 60) { endH += 1; endM -= 60; }
    const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    const dayOfWeek = new Date(body.date + "T00:00:00").getDay();
    if (!db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ? AND start_time <= ? AND end_time >= ?").get(body.doctor_id, dayOfWeek, body.start_time, endTime)) {
      return error("Doctor is not available at this time slot", 400);
    }
    if (db.query(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ? AND status NOT IN ('cancelled', 'no-show')`).get(body.doctor_id, body.date, body.start_time)) {
      return error("This time slot is already booked", 409);
    }
    const now = new Date().toISOString();
    const result = db.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      [body.patient_id, body.doctor_id, body.date, body.start_time, endTime, now, now]
    );
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "create", entity_type: "appointment", entity_id: String(result.lastInsertRowid), details: { patient_id: body.patient_id, doctor_id: body.doctor_id, date: body.date, start_time: body.start_time } });
    return json(db.query("SELECT * FROM appointments WHERE id = ?").get(Number(result.lastInsertRowid)) as Appointment, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

async function handleListAppointments(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const patientId = url.searchParams.get("patient_id") || "";
  const doctorId = url.searchParams.get("doctor_id") || "";
  const date = url.searchParams.get("date") || "";
  const status = url.searchParams.get("status") || "";
  const db = getDb();
  let query = `SELECT a.*, p.full_name as patient_name, p.patient_id as patient_code, d.name as doctor_name, d.specialization as doctor_specialization FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN doctors d ON a.doctor_id = d.id WHERE 1=1`;
  const params: (string | number)[] = [];
  if (patientId) { query += " AND a.patient_id = ?"; params.push(Number(patientId)); }
  if (doctorId) { query += " AND a.doctor_id = ?"; params.push(Number(doctorId)); }
  if (date) { query += " AND a.date = ?"; params.push(date); }
  if (status) { query += " AND a.status = ?"; params.push(status); }
  query += " ORDER BY a.date DESC, a.start_time ASC LIMIT 200";
  return json(db.query(query).all(...params));
}

async function handleUpdateAppointmentStatus(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<{ status: string }>(request);
    const validStatuses = ["scheduled", "checked-in", "completed", "no-show", "cancelled"];
    if (!body.status || !validStatuses.includes(body.status)) return error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`, 400);
    const db = getDb();
    const existing = db.query("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as Appointment | undefined;
    if (!existing) return error("Appointment not found", 404);
    const now = new Date().toISOString();
    db.run("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?", [body.status, now, Number(id)]);
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "status_update", entity_type: "appointment", entity_id: id, details: { old_status: existing.status, new_status: body.status } });
    return json(db.query("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as Appointment);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

async function handleRescheduleAppointment(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<{ date: string; start_time: string; reason?: string }>(request);
    if (!body.date || !body.start_time) return error("date and start_time are required", 400);
    const db = getDb();
    const existing = db.query("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as Appointment | undefined;
    if (!existing) return error("Appointment not found", 404);
    if (existing.status === "cancelled") return error("Cannot reschedule a cancelled appointment", 400);
    const [h, m] = body.start_time.split(":").map(Number);
    let endH = h, endM = m + 30;
    if (endM >= 60) { endH += 1; endM -= 60; }
    const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    if (db.query(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ? AND id != ? AND status NOT IN ('cancelled', 'no-show')`).get(existing.doctor_id, body.date, body.start_time, Number(id))) {
      return error("The new time slot is already booked", 409);
    }
    const now = new Date().toISOString();
    const reason = body.reason || "Rescheduled";
    db.run("UPDATE appointments SET date = ?, start_time = ?, end_time = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?", [body.date, body.start_time, endTime, reason, now, Number(id)]);
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "reschedule", entity_type: "appointment", entity_id: id, details: { old_date: existing.date, old_time: existing.start_time, new_date: body.date, new_time: body.start_time, reason } });
    return json(db.query("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as Appointment);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

export async function handleAppointments(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const statusMatch = matchPath("/api/appointments/:id/status", pathname);
  if (statusMatch && request.method === "PATCH") return handleUpdateAppointmentStatus(request, statusMatch.id);
  const rescheduleMatch = matchPath("/api/appointments/:id/reschedule", pathname);
  if (rescheduleMatch && request.method === "PATCH") return handleRescheduleAppointment(request, rescheduleMatch.id);
  if (pathname === "/api/appointments" && request.method === "POST") return handleCreateAppointment(request);
  if (pathname === "/api/appointments" && request.method === "GET") return handleListAppointments(request);
  return error("Not found", 404);
}
