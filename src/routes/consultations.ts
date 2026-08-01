import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";

function getUserId(request: Request): number | null {
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  return session ? session.user_id : null;
}

// GET /api/consultations?patient_id=&doctor_id=&limit=
async function handleListConsultations(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const patientId = url.searchParams.get("patient_id") || "";
  const doctorId = url.searchParams.get("doctor_id") || "";
  const db = getDb();
  let query = `
    SELECT c.*, p.full_name as patient_name, p.patient_id as patient_code,
           d.name as doctor_name, a.date as appointment_date, a.start_time,
           pr.id as prescription_id, pr.status as prescription_status
    FROM consultations c
    JOIN patients p ON c.patient_id = p.id
    JOIN doctors d ON c.doctor_id = d.id
    LEFT JOIN appointments a ON c.appointment_id = a.id
    LEFT JOIN prescriptions pr ON pr.consultation_id = c.id
    WHERE 1=1`;
  const params: (string | number)[] = [];
  if (patientId) { query += " AND c.patient_id = ?"; params.push(Number(patientId)); }
  if (doctorId) { query += " AND c.doctor_id = ?"; params.push(Number(doctorId)); }
  query += " ORDER BY c.created_at DESC LIMIT 100";
  const rows = db.query(query).all(...params) as Array<Record<string, unknown>>;
  const result = rows.map((row) => {
    let items: unknown[] = [];
    if (row.prescription_id) {
      items = db.query("SELECT * FROM prescription_items WHERE prescription_id = ?").all(row.prescription_id as number);
    }
    return { ...row, prescription_items: items };
  });
  return json(result);
}

// POST /api/consultations  { appointment_id, diagnosis, notes, vitals, prescription: [{medicine_name, dosage, frequency, duration, instructions}] }
async function handleCreateConsultation(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{
      appointment_id: number;
      diagnosis: string;
      notes?: string;
      vitals?: string;
      prescription?: Array<{ medicine_name: string; dosage?: string; frequency?: string; duration?: string; instructions?: string }>;
    }>(request);
    if (!body.appointment_id || !body.diagnosis) return error("appointment_id and diagnosis are required", 400);
    const db = getDb();
    const appt = db.query("SELECT * FROM appointments WHERE id = ?").get(Number(body.appointment_id)) as
      { id: number; patient_id: number; doctor_id: number; status: string } | undefined;
    if (!appt) return error("Appointment not found", 404);
    if (appt.status === "cancelled") return error("Cannot record consultation for a cancelled appointment", 400);

    const now = new Date().toISOString();
    const cResult = db.run(
      `INSERT INTO consultations (appointment_id, patient_id, doctor_id, diagnosis, notes, vitals, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [appt.id, appt.patient_id, appt.doctor_id, body.diagnosis, body.notes || "", body.vitals || "{}", now]
    );
    const consultationId = Number(cResult.lastInsertRowid);

    let prescriptionId: number | null = null;
    if (Array.isArray(body.prescription) && body.prescription.length > 0) {
      const pResult = db.run(
        `INSERT INTO prescriptions (consultation_id, patient_id, doctor_id, status, created_at) VALUES (?, ?, ?, 'finalized', ?)`,
        [consultationId, appt.patient_id, appt.doctor_id, now]
      );
      prescriptionId = Number(pResult.lastInsertRowid);
      for (const item of body.prescription) {
        if (!item.medicine_name) continue;
        db.run(
          `INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?)`,
          [prescriptionId, item.medicine_name, item.dosage || "", item.frequency || "", item.duration || "", item.instructions || ""]
        );
      }
    }

    // Mark the appointment completed
    if (appt.status !== "completed") {
      db.run("UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?", [now, appt.id]);
    }

    const userId = getUserId(request) ?? 0;
    auditLog({ user_id: userId, action: "create", entity_type: "consultation", entity_id: String(consultationId), details: { appointment_id: appt.id, diagnosis: body.diagnosis } });
    return json({ id: consultationId, appointment_id: appt.id, patient_id: appt.patient_id, doctor_id: appt.doctor_id, prescription_id: prescriptionId }, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

export async function handleConsultations(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const idMatch = matchPath("/api/consultations/:id", pathname);
  if (idMatch && request.method === "GET") {
    // Minimal detail handler: single consultation with items
    const db = getDb();
    const row = db.query(
      `SELECT c.*, p.full_name as patient_name, d.name as doctor_name FROM consultations c
       JOIN patients p ON c.patient_id = p.id JOIN doctors d ON c.doctor_id = d.id
       WHERE c.id = ?`
    ).get(Number(idMatch.id)) as Record<string, unknown> | undefined;
    if (!row) return error("Consultation not found", 404);
    const items = db.query("SELECT * FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE consultation_id = ?)").all(Number(idMatch.id));
    return json({ ...row, prescription_items: items });
  }
  if (pathname === "/api/consultations" && request.method === "GET") return handleListConsultations(request);
  if (pathname === "/api/consultations" && request.method === "POST") return handleCreateConsultation(request);
  return error("Not found", 404);
}
