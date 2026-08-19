import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Patient } from "../types";

function generatePatientId(db: ReturnType<typeof getDb>): string {
  const last = db.query("SELECT patient_id FROM patients ORDER BY id DESC LIMIT 1").get() as { patient_id: string } | undefined;
  if (!last) return "SC-PT-000001";
  const num = parseInt(last.patient_id.replace("SC-PT-", ""), 10);
  return `SC-PT-${String(num + 1).padStart(6, "0")}`;
}

function getPatientByIdentifier(db: ReturnType<typeof getDb>, id: string): Patient | undefined {
  const isNumeric = /^\d+$/.test(id);
  return isNumeric
    ? (db.query("SELECT * FROM patients WHERE id = ?").get(Number(id)) as Patient | undefined)
    : (db.query("SELECT * FROM patients WHERE patient_id = ?").get(id) as Patient | undefined);
}

async function handleCreatePatient(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{ full_name: string; dob: string; gender: string; cnic: string; phone: string; address: string; emergency_contact: string }>(request);
    const required = ["full_name", "dob", "gender", "cnic", "phone", "address", "emergency_contact"];
    for (const field of required) {
      if (!(body as Record<string, unknown>)[field]) return error(`Missing required field: ${field}`, 400);
    }
    const db = getDb();
    if (db.query("SELECT id FROM patients WHERE cnic = ?").get(body.cnic)) return error("Patient with this CNIC already exists", 409);
    const patientId = generatePatientId(db);
    const now = new Date().toISOString();
    const result = db.run(
      `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientId, body.full_name, body.dob, body.gender, body.cnic, body.phone, body.address, body.emergency_contact, now, now]
    );
    const token = extractToken(request);
    const session = validateSession(token || "");
    if (session) auditLog({ user_id: session.user_id, action: "create", entity_type: "patient", entity_id: patientId, details: { full_name: body.full_name, cnic: body.cnic } });
    const patient = db.query("SELECT * FROM patients WHERE id = ?").get(Number(result.lastInsertRowid)) as Patient;
    return json(patient, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

async function handleListPatients(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "";
  const cnic = url.searchParams.get("cnic") || "";
  const phone = url.searchParams.get("phone") || "";
  const patientId = url.searchParams.get("patient_id") || "";
  const db = getDb();
  let query = "SELECT * FROM patients WHERE 1=1";
  const params: string[] = [];
  if (name) { query += " AND full_name LIKE ?"; params.push(`%${name}%`); }
  if (cnic) { query += " AND cnic LIKE ?"; params.push(`%${cnic}%`); }
  if (phone) { query += " AND phone LIKE ?"; params.push(`%${phone}%`); }
  if (patientId) { query += " AND patient_id LIKE ?"; params.push(`%${patientId}%`); }
  query += " ORDER BY created_at DESC LIMIT 100";
  return json(db.query(query).all(...params) as Patient[]);
}

async function handleGetPatient(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const patient = getPatientByIdentifier(db, id);
  if (!patient) return error("Patient not found", 404);
  const appointments = db.query(
    `SELECT a.*, d.name as doctor_name FROM appointments a JOIN doctors d ON a.doctor_id = d.id WHERE a.patient_id = ? ORDER BY a.date DESC, a.start_time DESC LIMIT 50`
  ).all(patient.id);

  // Fetch prescriptions and their items
  const prescriptions = db.query(
    `SELECT pr.*, d.name as doctor_name, c.diagnosis
     FROM prescriptions pr
     JOIN doctors d ON pr.doctor_id = d.id
     LEFT JOIN consultations c ON pr.consultation_id = c.id
     WHERE pr.patient_id = ?
     ORDER BY pr.created_at DESC`
  ).all(patient.id) as Array<Record<string, any>>;

  for (const p of prescriptions) {
    p.items = db.query("SELECT * FROM prescription_items WHERE prescription_id = ?").all(p.id);
  }

  // Fetch invoices and their items
  const invoices = db.query(
    `SELECT i.*,
       (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = i.id) as amount_paid
     FROM invoices i
     WHERE i.patient_id = ?
     ORDER BY i.created_at DESC`
  ).all(patient.id) as Array<Record<string, any>>;

  for (const inv of invoices) {
    inv.items = db.query("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id);
  }

  // Fetch payments
  const payments = db.query(
    `SELECT p.*, i.invoice_number
     FROM payments p
     JOIN invoices i ON p.invoice_id = i.id
     WHERE i.patient_id = ?
     ORDER BY p.created_at DESC`
  ).all(patient.id);

  // Calculate outstanding balance across all non-cancelled invoices
  const balanceRow = db.query(
    `SELECT COALESCE(SUM(total - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = invoices.id)), 0) as balance
     FROM invoices
     WHERE patient_id = ? AND status != 'cancelled'`
  ).get(patient.id) as { balance: number } | undefined;
  const outstandingBalance = balanceRow ? balanceRow.balance : 0;

  return json({
    ...patient,
    visit_history: appointments,
    prescriptions,
    invoices,
    payments,
    outstanding_balance: Math.round(outstandingBalance * 100) / 100
  });
}

async function handleUpdatePatient(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<Partial<Patient>>(request);
    const db = getDb();
    const existing = getPatientByIdentifier(db, id);
    if (!existing) return error("Patient not found", 404);
    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: (string | number)[] = [];
    const allowedFields = ["full_name", "dob", "gender", "cnic", "phone", "address", "emergency_contact"];
    for (const field of allowedFields) {
      if (body[field as keyof typeof body] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(body[field as keyof typeof body] as string);
      }
    }
    if (updates.length === 0) return error("No valid fields to update", 400);

    const token = extractToken(request);
    const session = validateSession(token || "");
    const changedBy = session ? session.user_id : 1; // Default to 1 (Admin)

    // Log to patient_demographic_history for each modified field
    for (const field of allowedFields) {
      const newValue = body[field as keyof typeof body];
      if (newValue !== undefined) {
        const oldValue = existing[field as keyof typeof existing];
        if (String(newValue) !== String(oldValue ?? "")) {
          db.run(
            `INSERT INTO patient_demographic_history (patient_id, changed_by, field_name, old_value, new_value)
             VALUES (?, ?, ?, ?, ?)`,
            [existing.id, changedBy, field, oldValue === null ? null : String(oldValue), String(newValue)]
          );
        }
      }
    }

    updates.push("updated_at = ?");
    params.push(now);
    params.push(existing.id);
    db.run(`UPDATE patients SET ${updates.join(", ")} WHERE id = ?`, params);
    if (session) auditLog({ user_id: session.user_id, action: "update", entity_type: "patient", entity_id: existing.patient_id, details: body as Record<string, unknown> });
    return json(db.query("SELECT * FROM patients WHERE id = ?").get(existing.id) as Patient);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

async function handleDeactivatePatient(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const existing = getPatientByIdentifier(db, id);
  if (!existing) return error("Patient not found", 404);
  if (existing.status === "inactive") return error("Patient is already inactive", 400);
  const now = new Date().toISOString();
  db.run("UPDATE patients SET status = 'inactive', updated_at = ? WHERE id = ?", [now, existing.id]);
  const token = extractToken(request);
  const session = validateSession(token || "");
  if (session) auditLog({ user_id: session.user_id, action: "deactivate", entity_type: "patient", entity_id: existing.patient_id });
  return json(db.query("SELECT * FROM patients WHERE id = ?").get(existing.id) as Patient);
}

export async function handlePatients(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const deactivateMatch = matchPath("/api/patients/:id/deactivate", pathname);
  if (deactivateMatch && request.method === "POST") return handleDeactivatePatient(request, deactivateMatch.id);
  const idMatch = matchPath("/api/patients/:id", pathname);
  if (idMatch && request.method === "GET") return handleGetPatient(request, idMatch.id);
  if (idMatch && request.method === "PUT") return handleUpdatePatient(request, idMatch.id);
  if (pathname === "/api/patients" && request.method === "POST") return handleCreatePatient(request);
  if (pathname === "/api/patients" && request.method === "GET") return handleListPatients(request);
  return error("Not found", 404);
}
