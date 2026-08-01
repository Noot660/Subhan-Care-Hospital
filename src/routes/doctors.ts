import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Doctor, DoctorSchedule } from "../types";

async function handleCreateDoctor(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{ name: string; specialization: string; qualification: string; cnic: string; phone: string; fee: number; schedule?: Array<{ day_of_week: number; start_time: string; end_time: string }> }>(request);
    if (!body.name || !body.specialization || !body.qualification || !body.cnic || !body.phone || body.fee === undefined) {
      return error("Missing required fields: name, specialization, qualification, cnic, phone, fee", 400);
    }
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.run(
      `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [body.name, body.specialization, body.qualification, body.cnic, body.phone, body.fee, now]
    );
    const doctorId = Number(result.lastInsertRowid);
    if (body.schedule && Array.isArray(body.schedule)) {
      for (const slot of body.schedule) {
        db.run(`INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)`, [doctorId, slot.day_of_week, slot.start_time, slot.end_time]);
      }
    }
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "create", entity_type: "doctor", entity_id: String(doctorId), details: { name: body.name, specialization: body.specialization } });
    const doctor = db.query("SELECT * FROM doctors WHERE id = ?").get(doctorId) as Doctor;
    const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ?").all(doctorId) as DoctorSchedule[];
    return json({ ...doctor, schedule: schedules }, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

async function handleListDoctors(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const specialization = url.searchParams.get("specialization") || "";
  const db = getDb();
  let query = "SELECT * FROM doctors WHERE status = 'active'";
  const params: string[] = [];
  if (specialization) { query += " AND specialization LIKE ?"; params.push(`%${specialization}%`); }
  query += " ORDER BY name";
  const doctors = db.query(query).all(...params) as Doctor[];
  const doctorsWithSchedules = doctors.map((d) => {
    const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ?").all(d.id) as DoctorSchedule[];
    return { ...d, schedule: schedules };
  });
  return json(doctorsWithSchedules);
}

async function handleGetDoctor(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const isNumeric = /^\d+$/.test(id);
  const doctor = isNumeric ? (db.query("SELECT * FROM doctors WHERE id = ?").get(Number(id)) as Doctor | undefined) : null;
  if (!doctor) return error("Doctor not found", 404);
  const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ?").all(doctor.id) as DoctorSchedule[];
  return json({ ...doctor, schedule: schedules });
}

async function handleGetDoctorSlots(request: Request, id: string): Promise<Response> {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date) return error("date query parameter is required (YYYY-MM-DD)", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return error("Invalid date format. Use YYYY-MM-DD", 400);
  const db = getDb();
  const isNumeric = /^\d+$/.test(id);
  const doctor = isNumeric ? (db.query("SELECT * FROM doctors WHERE id = ? AND status = 'active'").get(Number(id)) as Doctor | undefined) : null;
  if (!doctor) return error("Doctor not found", 404);
  const dayOfWeek = new Date(date + "T00:00:00").getDay();
  const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?").all(doctor.id, dayOfWeek) as DoctorSchedule[];
  if (schedules.length === 0) return json({ date, day_of_week: dayOfWeek, slots: [], message: "Doctor not available on this day" });
  const bookedSlots = db.query(
    `SELECT start_time, end_time FROM appointments WHERE doctor_id = ? AND date = ? AND status NOT IN ('cancelled', 'no-show')`
  ).all(doctor.id, date) as Array<{ start_time: string; end_time: string }>;
  const allSlots: Array<{ start_time: string; end_time: string; available: boolean }> = [];
  for (const schedule of schedules) {
    let current = schedule.start_time;
    while (current < schedule.end_time) {
      const [h, m] = current.split(":").map(Number);
      let endH = h, endM = m + 30;
      if (endM >= 60) { endH += 1; endM -= 60; }
      const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
      if (endTime <= schedule.end_time) {
        const isBooked = bookedSlots.some((b) => b.start_time === current);
        allSlots.push({ start_time: current, end_time: endTime, available: !isBooked });
      }
      current = endTime;
    }
  }
  return json({ doctor_id: doctor.id, doctor_name: doctor.name, date, day_of_week: dayOfWeek, slots: allSlots });
}

async function handleToggleAvailability(request: Request, id: string): Promise<Response> {
  try {
    const db = getDb();
    const isNumeric = /^\d+$/.test(id);
    const doctor = isNumeric ? (db.query("SELECT * FROM doctors WHERE id = ?").get(Number(id)) as Doctor | undefined) : null;
    if (!doctor) return error("Doctor not found", 404);
    const newStatus = doctor.status === "active" ? "inactive" : "active";
    db.run("UPDATE doctors SET status = ? WHERE id = ?", [newStatus, doctor.id]);
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "toggle_availability", entity_type: "doctor", entity_id: String(doctor.id), details: { old_status: doctor.status, new_status: newStatus } });
    return json({ id: doctor.id, name: doctor.name, status: newStatus });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

export async function handleDoctors(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const slotsMatch = matchPath("/api/doctors/:id/slots", pathname);
  if (slotsMatch && request.method === "GET") return handleGetDoctorSlots(request, slotsMatch.id);
  const availMatch = matchPath("/api/doctors/:id/availability", pathname);
  if (availMatch && request.method === "POST") return handleToggleAvailability(request, availMatch.id);
  const detailMatch = matchPath("/api/doctors/:id", pathname);
  if (detailMatch && request.method === "GET") return handleGetDoctor(request, detailMatch.id);
  if (pathname === "/api/doctors" && request.method === "POST") return handleCreateDoctor(request);
  if (pathname === "/api/doctors" && request.method === "GET") return handleListDoctors(request);
  return error("Not found", 404);
}
