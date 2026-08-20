import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Appointment } from "../types";
import { availableSlots, validateAppointmentInput } from "../appointments/validation";

async function handleCreateAppointment(request: Request): Promise<Response> {
  let conflictDoctor = 0;
  let conflictDate = "";
  try {
    const body = await parseBody<{ patient_id: number; doctor_id: number; date: string; start_time: string; source?: string }>(request);
    if (!body.patient_id || !body.doctor_id || !body.date || !body.start_time) return error("Missing required fields: patient_id, doctor_id, date, start_time", 400);
    const source = body.source || "staff";
    if (!["staff", "chat", "voice", "twilio"].includes(source)) return error("Invalid source. Must be one of: staff, chat, voice, twilio", 400);
    const db = getDb();
    conflictDoctor = body.doctor_id;
    conflictDate = body.date;
    if (!db.query("SELECT * FROM patients WHERE id = ? AND status = 'active'").get(body.patient_id)) return error("Patient not found or inactive", 404);
    if (!db.query("SELECT * FROM doctors WHERE id = ? AND status = 'active'").get(body.doctor_id)) return error("Doctor not found or inactive", 404);
    const inputValidation = validateAppointmentInput(db, body.doctor_id, body.date, body.start_time);
    if (!inputValidation.ok) return error(inputValidation.message, 400);
    const endTime = inputValidation.endTime;
    const now = new Date().toISOString();
    // The partial unique index (appointments_active_slot_unique) makes this
    // INSERT atomic against concurrent bookings of the same doctor/date/slot.
    const result = db.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
      [body.patient_id, body.doctor_id, body.date, body.start_time, endTime, source, now, now]
    );
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "create", entity_type: "appointment", entity_id: String(result.lastInsertRowid), details: { patient_id: body.patient_id, doctor_id: body.doctor_id, date: body.date, start_time: body.start_time, source } });
    return json(db.query("SELECT * FROM appointments WHERE id = ?").get(Number(result.lastInsertRowid)) as Appointment, 201);
  } catch (err) {
    // Lost a race for the same slot → tell the caller which slots are still live.
    if (String(err).toLowerCase().includes("unique")) {
      const db = getDb();
      const slots = conflictDoctor && conflictDate ? availableSlots(db, conflictDoctor, conflictDate).map((s) => s.start_time) : [];
      return error(`This slot was just booked. Available slots: ${slots.join(", ") || "Please choose another date or doctor."}`, 409);
    }
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

  // SRS Section 5: Doctor role sees only their own appointments.
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  let scopeDoctorId = 0;
  if (session && session.role === "doctor") {
    const staff = db.query("SELECT * FROM staff WHERE id = ?").get(session.user_id) as { phone: string; name: string } | undefined;
    if (staff) {
      let doctor = db.query("SELECT id FROM doctors WHERE phone = ?").get(staff.phone) as { id: number } | undefined;
      if (!doctor) {
        doctor = db.query("SELECT id FROM doctors WHERE name = ?").get(staff.name) as { id: number } | undefined;
      }
      if (doctor) scopeDoctorId = doctor.id;
    }
  }

  let query = `SELECT a.*, p.full_name as patient_name, p.patient_id as patient_code, d.name as doctor_name, d.specialization as doctor_specialization FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN doctors d ON a.doctor_id = d.id WHERE 1=1`;
  const params: (string | number)[] = [];
  if (scopeDoctorId > 0) { query += " AND a.doctor_id = ?"; params.push(scopeDoctorId); }
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
  let rescheduleDoctor = 0;
  let rescheduleDate = "";
  let rescheduleApptId = 0;
  try {
    const body = await parseBody<{ date: string; start_time: string; reason?: string }>(request);
    if (!body.date || !body.start_time) return error("date and start_time are required", 400);
    const db = getDb();
    const existing = db.query("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as Appointment | undefined;
    if (!existing) return error("Appointment not found", 404);
    if (existing.status === "cancelled") return error("Cannot reschedule a cancelled appointment", 400);
    const validation = validateAppointmentInput(db, existing.doctor_id, body.date, body.start_time);
    if (!validation.ok) return error(validation.message, 400);
    rescheduleDoctor = existing.doctor_id;
    rescheduleDate = body.date;
    rescheduleApptId = Number(id);
    if (db.query(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ? AND id != ? AND status IN ('scheduled', 'checked-in', 'completed')`).get(existing.doctor_id, body.date, body.start_time, Number(id))) {
      const slots = availableSlots(db, existing.doctor_id, body.date, Number(id)).map((s) => s.start_time);
      return error(`This slot was just booked. Available slots: ${slots.join(", ") || "Please choose another date or doctor."}`, 409);
    }
    const endTime = validation.endTime;
    const now = new Date().toISOString();
    const reason = body.reason || "Rescheduled";
    // Same unique index backstops a concurrent reschedule into this slot.
    db.run("UPDATE appointments SET date = ?, start_time = ?, end_time = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?", [body.date, body.start_time, endTime, reason, now, Number(id)]);
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "reschedule", entity_type: "appointment", entity_id: id, details: { old_date: existing.date, old_time: existing.start_time, new_date: body.date, new_time: body.start_time, reason } });
    return json(db.query("SELECT * FROM appointments WHERE id = ?").get(Number(id)) as Appointment);
  } catch (err) {
    if (String(err).toLowerCase().includes("unique")) {
      const db = getDb();
      const slots = rescheduleDoctor ? availableSlots(db, rescheduleDoctor, rescheduleDate, rescheduleApptId).map((s) => s.start_time) : [];
      return error(`This slot was just booked. Available slots: ${slots.join(", ") || "Please choose another date or doctor."}`, 409);
    }
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
