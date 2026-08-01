import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Medicine } from "../types";

function getUserId(request: Request): number | null {
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  return session ? session.user_id : null;
}

// GET /api/pharmacy/medicines?q=&low=1
async function handleListMedicines(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const low = url.searchParams.get("low") || "";
  const db = getDb();
  let query = "SELECT * FROM medicines WHERE 1=1";
  const params: (string | number)[] = [];
  if (q) {
    query += " AND name LIKE ?";
    params.push(`%${q}%`);
  }
  if (low === "1" || low === "true") {
    query += " AND quantity <= reorder_threshold";
  }
  query += " ORDER BY name";
  const medicines = db.query(query).all(...params) as Medicine[];
  return json(medicines);
}

// POST /api/pharmacy/medicines/:id/restock  { quantity }
async function handleRestockMedicine(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<{ quantity: number }>(request);
    const quantity = Math.floor(Number(body.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return error("quantity must be a positive number", 400);
    }
    const db = getDb();
    const med = db.query("SELECT * FROM medicines WHERE id = ?").get(Number(id)) as Medicine | undefined;
    if (!med) return error("Medicine not found", 404);
    const now = new Date().toISOString();
    db.run("UPDATE medicines SET quantity = quantity + ?, updated_at = ? WHERE id = ?", [quantity, now, Number(id)]);
    const userId = getUserId(request) ?? 0;
    db.run(
      `INSERT INTO stock_movements (medicine_id, type, quantity_change, reference, user_id) VALUES (?, 'add', ?, ?, ?)`,
      [Number(id), quantity, `Restock`, userId]
    );
    auditLog({ user_id: userId, action: "restock", entity_type: "medicine", entity_id: String(id), details: { quantity } });
    return json(db.query("SELECT * FROM medicines WHERE id = ?").get(Number(id)) as Medicine);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// GET /api/pharmacy/prescriptions?status=&patient_id=
async function handleListPrescriptions(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const patientId = url.searchParams.get("patient_id") || "";
  const db = getDb();
  let query = `
    SELECT pr.*, p.full_name as patient_name, p.patient_id as patient_code,
           d.name as doctor_name, c.diagnosis, c.notes
    FROM prescriptions pr
    JOIN patients p ON pr.patient_id = p.id
    JOIN doctors d ON pr.doctor_id = d.id
    LEFT JOIN consultations c ON pr.consultation_id = c.id
    WHERE 1=1`;
  const params: (string | number)[] = [];
  if (status) {
    if (status === "pending") {
      query += " AND pr.status = 'finalized'";
    } else {
      query += " AND pr.status = ?";
      params.push(status);
    }
  }
  if (patientId) {
    query += " AND pr.patient_id = ?";
    params.push(Number(patientId));
  }
  query += " ORDER BY pr.created_at DESC LIMIT 100";
  const rows = db.query(query).all(...params) as Array<Record<string, unknown>>;
  const result = rows.map((row) => {
    const items = db.query("SELECT * FROM prescription_items WHERE prescription_id = ?").all(row.id as number);
    return { ...row, items };
  });
  return json(result);
}

// POST /api/pharmacy/prescriptions/:id/dispense
async function handleDispensePrescription(request: Request, id: string): Promise<Response> {
  try {
    const db = getDb();
    const existing = db.query("SELECT * FROM prescriptions WHERE id = ?").get(Number(id)) as { id: number; status: string; patient_id: number } | undefined;
    if (!existing) return error("Prescription not found", 404);
    if (existing.status === "dispensed") return error("Prescription already dispensed", 400);

    const items = db.query("SELECT * FROM prescription_items WHERE prescription_id = ?").all(Number(id)) as Array<{ medicine_name: string; dosage: string; frequency: string; duration: string }>;

    // Decrement stock for any items that match a known medicine (by name, case-insensitive)
    const now = new Date().toISOString();
    const userId = getUserId(request) ?? 0;
    for (const item of items) {
      const med = db.query("SELECT * FROM medicines WHERE LOWER(name) = LOWER(?)").get(item.medicine_name.trim()) as Medicine | undefined;
      if (med) {
        const newQty = Math.max(0, med.quantity - 1);
        db.run("UPDATE medicines SET quantity = ?, updated_at = ? WHERE id = ?", [newQty, now, med.id]);
        db.run(
          `INSERT INTO stock_movements (medicine_id, type, quantity_change, reference, user_id) VALUES (?, 'dispense', ?, ?, ?)`,
          [med.id, -1, `Prescription #${id}`, userId]
        );
      }
    }

    db.run("UPDATE prescriptions SET status = 'dispensed' WHERE id = ?", [Number(id)]);
    auditLog({ user_id: userId, action: "dispense", entity_type: "prescription", entity_id: String(id), details: { items: items.length } });
    return json({ message: "Prescription dispensed", prescription_id: Number(id) });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

export async function handlePharmacy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const restockMatch = matchPath("/api/pharmacy/medicines/:id/restock", pathname);
  if (restockMatch && request.method === "POST") return handleRestockMedicine(request, restockMatch.id);

  const dispenseMatch = matchPath("/api/pharmacy/prescriptions/:id/dispense", pathname);
  if (dispenseMatch && request.method === "POST") return handleDispensePrescription(request, dispenseMatch.id);

  if (pathname === "/api/pharmacy/medicines" && request.method === "GET") return handleListMedicines(request);
  if (pathname === "/api/pharmacy/prescriptions" && request.method === "GET") return handleListPrescriptions(request);

  return error("Not found", 404);
}
