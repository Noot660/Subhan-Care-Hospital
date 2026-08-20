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

  // SRS Section 5: Doctor role sees only their own profile ("R (own)").
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  let scopeDoctorId = 0;
  if (session && session.role === "doctor") {
    scopeDoctorId = resolveDoctorFromSession(db, session) ?? 0;
  }

  let query = "SELECT * FROM doctors WHERE status = 'active'";
  const params: string[] = [];
  if (scopeDoctorId > 0) { query += " AND id = ?"; params.push(String(scopeDoctorId)); }
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

  // SRS Section 5: Doctor role can only view their own profile ("R (own)").
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  if (session && session.role === "doctor") {
    const requestedId = /^\d+$/.test(id) ? Number(id) : 0;
    const ownId = resolveDoctorFromSession(db, session) ?? 0;
    if (ownId > 0 && requestedId !== ownId) {
      return error("Forbidden — you can only view your own profile", 403);
    }
  }

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

async function handleUpdateDoctorSchedule(request: Request, id: string): Promise<Response> {
  try {
    const token = extractToken(request);
    const session = token ? validateSession(token) : null;
    if (!session || session.role !== "admin") {
      return error("Forbidden — Admin access required", 403);
    }
    const body = await parseBody<{ schedule: Array<{ day_of_week: number; start_time: string; end_time: string }> }>(request);
    if (!body.schedule || !Array.isArray(body.schedule)) {
      return error("Missing or invalid schedule array", 400);
    }
    const db = getDb();
    const doctor = db.query("SELECT * FROM doctors WHERE id = ?").get(Number(id)) as Doctor | undefined;
    if (!doctor) return error("Doctor not found", 404);

    db.transaction(() => {
      db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctor.id]);
      for (const slot of body.schedule) {
        db.run(
          `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)`,
          [doctor.id, slot.day_of_week, slot.start_time, slot.end_time]
        );
      }
    })();

    auditLog({
      user_id: session.user_id,
      action: "update_schedule",
      entity_type: "doctor",
      entity_id: String(doctor.id),
      details: { slot_count: body.schedule.length }
    });

    const updatedSchedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ?").all(doctor.id);
    return json({ ...doctor, schedule: updatedSchedules });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

function resolveDoctorFromSession(db: any, session: any): number | null {
  const staff = db.query("SELECT * FROM staff WHERE id = ?").get(session.user_id) as any;
  if (!staff) return null;
  let doctor = db.query("SELECT * FROM doctors WHERE phone = ?").get(staff.phone) as any;
  if (!doctor) {
    doctor = db.query("SELECT * FROM doctors WHERE name = ?").get(staff.name) as any;
  }
  return doctor ? doctor.id : null;
}

async function handleCreateChangeRequest(request: Request): Promise<Response> {
  try {
    const token = extractToken(request);
    const session = token ? validateSession(token) : null;
    if (!session) return error("Unauthorized", 401);

    const db = getDb();
    let doctorId: number;

    const body = await parseBody<any>(request);

    if (session.role === "doctor") {
      const resolvedId = resolveDoctorFromSession(db, session);
      if (!resolvedId) return error("Logged in doctor profile not found", 404);
      doctorId = resolvedId;
      // Doctor cannot request changes for other doctors
      delete body.doctor_id;
    } else if (session.role === "admin") {
      if (!body.doctor_id) return error("doctor_id is required for Admin request", 400);
      doctorId = Number(body.doctor_id);
    } else {
      return error("Forbidden", 403);
    }

    const doctorExists = db.query("SELECT id FROM doctors WHERE id = ?").get(doctorId);
    if (!doctorExists) return error("Doctor not found", 404);

    const requestedData = JSON.stringify(body);
    const now = new Date().toISOString();
    const result = db.run(
      `INSERT INTO doctor_change_requests (doctor_id, requested_by, requested_data, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [doctorId, session.user_id, requestedData, now, now]
    );

    const reqId = Number(result.lastInsertRowid);
    auditLog({
      user_id: session.user_id,
      action: "create_change_request",
      entity_type: "doctor_change_request",
      entity_id: String(reqId),
      details: { doctor_id: doctorId }
    });

    const created = db.query("SELECT * FROM doctor_change_requests WHERE id = ?").get(reqId);
    return json(created, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

async function handleListChangeRequests(request: Request): Promise<Response> {
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  if (!session) return error("Unauthorized", 401);

  const db = getDb();
  let query = "SELECT * FROM doctor_change_requests";
  const params: any[] = [];

  if (session.role === "doctor") {
    const doctorId = resolveDoctorFromSession(db, session);
    if (!doctorId) return json([]);
    query += " WHERE doctor_id = ?";
    params.push(doctorId);
  } else if (session.role !== "admin") {
    return error("Forbidden", 403);
  }

  query += " ORDER BY created_at DESC";
  const rows = db.query(query).all(...params);
  return json(rows);
}

async function handleResolveChangeRequest(request: Request, id: string, action: "approve" | "reject"): Promise<Response> {
  try {
    const token = extractToken(request);
    const session = token ? validateSession(token) : null;
    if (!session || session.role !== "admin") return error("Forbidden — Admin access required", 403);

    const db = getDb();
    const req = db.query("SELECT * FROM doctor_change_requests WHERE id = ?").get(Number(id)) as any;
    if (!req) return error("Change request not found", 404);
    if (req.status !== "pending") return error("Change request is already resolved", 400);

    const now = new Date().toISOString();

    if (action === "reject") {
      const body = await parseBody<{ rejection_reason?: string }>(request);
      const reason = body.rejection_reason || "Rejected by Admin";
      db.run(
        `UPDATE doctor_change_requests SET status = 'rejected', rejection_reason = ?, resolved_by = ?, updated_at = ? WHERE id = ?`,
        [reason, session.user_id, now, req.id]
      );
      auditLog({
        user_id: session.user_id,
        action: "reject_change_request",
        entity_type: "doctor_change_request",
        entity_id: String(req.id),
        details: { reason }
      });
      return json({ ...req, status: "rejected", rejection_reason: reason, resolved_by: session.user_id, updated_at: now });
    }

    // Approve action
    const data = JSON.parse(req.requested_data);
    const doctor = db.query("SELECT * FROM doctors WHERE id = ?").get(req.doctor_id) as any;
    if (!doctor) return error("Target doctor not found", 404);

    db.transaction(() => {
      // 1. Update doctor info if changes specified
      const allowedDoctorFields = ["name", "specialization", "qualification", "cnic", "phone", "fee"];
      const updates: string[] = [];
      const params: any[] = [];
      for (const field of allowedDoctorFields) {
        if (data[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(data[field]);
        }
      }
      if (updates.length > 0) {
        params.push(doctor.id);
        db.run(`UPDATE doctors SET ${updates.join(", ")} WHERE id = ?`, params);
      }

      // 2. Update staff profile if name/phone/email modified and staff exists
      let staff = db.query("SELECT * FROM staff WHERE phone = ? AND role = 'doctor'").get(doctor.phone) as any;
      if (!staff) {
        staff = db.query("SELECT * FROM staff WHERE name = ? AND role = 'doctor'").get(doctor.name) as any;
      }
      if (staff) {
        const staffUpdates: string[] = [];
        const staffParams: any[] = [];
        if (data.name !== undefined) { staffUpdates.push("name = ?"); staffParams.push(data.name); }
        if (data.phone !== undefined) { staffUpdates.push("phone = ?"); staffParams.push(data.phone); }
        if (data.email !== undefined) { staffUpdates.push("email = ?"); staffParams.push(data.email); }
        if (staffUpdates.length > 0) {
          staffParams.push(staff.id);
          db.run(`UPDATE staff SET ${staffUpdates.join(", ")} WHERE id = ?`, staffParams);
        }
      }

      // 3. Update doctor schedules if schedule array specified
      if (data.schedule && Array.isArray(data.schedule)) {
        db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctor.id]);
        for (const slot of data.schedule) {
          db.run(
            `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)`,
            [doctor.id, slot.day_of_week, slot.start_time, slot.end_time]
          );
        }
      }

      // 4. Update request status
      db.run(
        `UPDATE doctor_change_requests SET status = 'approved', resolved_by = ?, updated_at = ? WHERE id = ?`,
        [session.user_id, now, req.id]
      );
    })();

    auditLog({
      user_id: session.user_id,
      action: "approve_change_request",
      entity_type: "doctor_change_request",
      entity_id: String(req.id),
      details: { doctor_id: doctor.id }
    });

    const updatedReq = db.query("SELECT * FROM doctor_change_requests WHERE id = ?").get(req.id);
    return json(updatedReq);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

export async function handleDoctors(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Change requests routes
  if (pathname === "/api/doctors/change-requests") {
    if (request.method === "POST") return handleCreateChangeRequest(request);
    if (request.method === "GET") return handleListChangeRequests(request);
  }

  const approveMatch = matchPath("/api/doctors/change-requests/:id/approve", pathname);
  if (approveMatch && request.method === "POST") return handleResolveChangeRequest(request, approveMatch.id, "approve");

  const rejectMatch = matchPath("/api/doctors/change-requests/:id/reject", pathname);
  if (rejectMatch && request.method === "POST") return handleResolveChangeRequest(request, rejectMatch.id, "reject");

  // Schedule route
  const scheduleMatch = matchPath("/api/doctors/:id/schedule", pathname);
  if (scheduleMatch && request.method === "PUT") return handleUpdateDoctorSchedule(request, scheduleMatch.id);

  // Existing routes
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
