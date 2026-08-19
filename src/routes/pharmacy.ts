import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Medicine } from "../types";
import { validateCalendarDate } from "../appointments/validation";

function getUserId(request: Request): number | null {
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  return session ? session.user_id : null;
}

// ── Text Dosage Parsing Helpers ──

function parseDosage(dosageText: string): number {
  const text = dosageText.trim().toLowerCase();
  if (/^\d+\s*(mg|g|mcg|ml)$/i.test(text)) {
    return 1;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:tablet|tab|capsule|cap|pill|puff|ml|drop|dose)?s?\b/i);
  if (match) {
    return parseFloat(match[1]);
  }
  const anyNumMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (anyNumMatch) {
    const val = parseFloat(anyNumMatch[1]);
    if (val >= 10) return 1;
    return val;
  }
  return 1;
}

function parseFrequency(freqText: string): number {
  const text = freqText.trim().toLowerCase();
  if (/^\d-\d-\d(?:-\d)?$/.test(text)) {
    return text.split('-').map(Number).reduce((a, b) => a + b, 0);
  }
  const numTimesMatch = text.match(/(\d+)\s*(?:times|x)\s*(?:a\s*day|daily|per\s*day)/i);
  if (numTimesMatch) {
    return parseInt(numTimesMatch[1], 10);
  }
  if (text.includes("once daily") || text.includes("once a day") || text === "daily" || text === "qd" || text === "once") {
    return 1;
  }
  if (text.includes("twice daily") || text.includes("twice a day") || text.includes("2 times") || text === "bid") {
    return 2;
  }
  if (text.includes("three times") || text.includes("3 times") || text === "tid") {
    return 3;
  }
  if (text.includes("four times") || text.includes("4 times") || text === "qid") {
    return 4;
  }
  if (text.includes("every 12 hours") || text.includes("q12h")) {
    return 2;
  }
  if (text.includes("every 8 hours") || text.includes("q8h")) {
    return 3;
  }
  if (text.includes("every 6 hours") || text.includes("q6h")) {
    return 4;
  }
  if (text.includes("every 4 hours") || text.includes("q4h")) {
    return 6;
  }
  return 1;
}

function parseDuration(durationText: string): number {
  const text = durationText.trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(day|week|month|year)s?\b/i);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2];
    if (unit.startsWith("day")) return val;
    if (unit.startsWith("week")) return val * 7;
    if (unit.startsWith("month")) return val * 30;
    if (unit.startsWith("year")) return val * 365;
  }
  const plainNum = text.match(/^(\d+)$/);
  if (plainNum) {
    return parseInt(plainNum[1], 10);
  }
  return 1;
}

export function calculateTotalQuantity(dosage: string, frequency: string, duration: string): number {
  const fullText = `${dosage} ${frequency} ${duration}`.toLowerCase().trim();
  const sentencePattern = /(\d+(?:\.\d+)?)\s*(?:tablet|tab|capsule|cap|pill|puff|ml|drop|dose)?s?[,\s]+(\d+)\s*(?:times|x)\s*(?:a\s*day|daily|per\s*day|daily)?[,\s]+for\s+(\d+)\s*(day|week)s?/i;
  const matchSentence = fullText.match(sentencePattern);
  if (matchSentence) {
    const dose = parseFloat(matchSentence[1]);
    const freq = parseInt(matchSentence[2], 10);
    const unit = matchSentence[4].toLowerCase();
    const durationVal = parseInt(matchSentence[3], 10);
    const dur = unit.startsWith("week") ? durationVal * 7 : durationVal;
    return Math.ceil(dose * freq * dur);
  }

  const dose = parseDosage(dosage);
  const freq = parseFrequency(frequency);
  const dur = parseDuration(duration);
  return Math.ceil(dose * freq * dur);
}

// ── GET /api/pharmacy/medicines?q=&low=1 ──
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

// ── POST /api/pharmacy/medicines ──
async function handleCreateMedicine(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{
      name: string;
      batch_number: string;
      quantity: number;
      unit_cost: number;
      expiry_date: string;
      reorder_threshold?: number;
      expiry_alert_days?: number;
    }>(request);

    const name = body.name?.trim();
    const batch_number = body.batch_number?.trim();
    const quantity = Number(body.quantity);
    const unit_cost = Number(body.unit_cost);
    const expiry_date = body.expiry_date?.trim();
    const reorder_threshold = body.reorder_threshold !== undefined ? Number(body.reorder_threshold) : 10;
    const expiry_alert_days = body.expiry_alert_days !== undefined ? Number(body.expiry_alert_days) : 30;

    if (!name || !batch_number || !expiry_date) {
      return error("name, batch_number, and expiry_date are required", 400);
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return error("quantity must be a non-negative integer", 400);
    }
    if (Number.isNaN(unit_cost) || unit_cost < 0) {
      return error("unit_cost must be a non-negative number", 400);
    }
    if (!Number.isInteger(reorder_threshold) || reorder_threshold < 0) {
      return error("reorder_threshold must be a non-negative integer", 400);
    }
    if (!Number.isInteger(expiry_alert_days) || expiry_alert_days < 0) {
      return error("expiry_alert_days must be a non-negative integer", 400);
    }

    const dateCheck = validateCalendarDate(expiry_date);
    if (!dateCheck.ok) {
      return error(dateCheck.message, 400);
    }

    const db = getDb();
    const now = new Date().toISOString();
    const result = db.run(
      `INSERT INTO medicines (name, batch_number, quantity, unit_cost, expiry_date, reorder_threshold, expiry_alert_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, batch_number, quantity, unit_cost, expiry_date, reorder_threshold, expiry_alert_days, now, now]
    );

    const newId = Number(result.lastInsertRowid);
    const userId = getUserId(request) ?? 0;

    db.run(
      `INSERT INTO stock_movements (medicine_id, type, quantity_change, reference, user_id, created_at)
       VALUES (?, 'add', ?, 'Initial stock entry', ?, ?)`,
      [newId, quantity, userId, now]
    );

    auditLog({ user_id: userId, action: "create", entity_type: "medicine", entity_id: String(newId), details: { name, quantity } });

    return json(db.query("SELECT * FROM medicines WHERE id = ?").get(newId) as Medicine);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// ── POST /api/pharmacy/medicines/:id/restock ──
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

// ── POST /api/pharmacy/medicines/:id/adjust ──
async function handleAdjustMedicine(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<{ quantity_change: number; reason?: string }>(request);
    const quantityChange = Math.floor(Number(body.quantity_change));
    if (!Number.isFinite(quantityChange) || quantityChange === 0) {
      return error("quantity_change must be a non-zero integer", 400);
    }
    const db = getDb();
    const med = db.query("SELECT * FROM medicines WHERE id = ?").get(Number(id)) as Medicine | undefined;
    if (!med) return error("Medicine not found", 404);

    if (med.quantity + quantityChange < 0) {
      return error("Insufficient stock", 400);
    }

    const now = new Date().toISOString();
    db.run("UPDATE medicines SET quantity = quantity + ?, updated_at = ? WHERE id = ?", [quantityChange, now, Number(id)]);
    const userId = getUserId(request) ?? 0;
    db.run(
      `INSERT INTO stock_movements (medicine_id, type, quantity_change, reference, user_id) VALUES (?, 'adjust', ?, ?, ?)`,
      [Number(id), quantityChange, body.reason || 'Manual adjustment', userId]
    );
    auditLog({ user_id: userId, action: "adjust", entity_type: "medicine", entity_id: String(id), details: { quantity_change: quantityChange, reason: body.reason } });
    return json(db.query("SELECT * FROM medicines WHERE id = ?").get(Number(id)) as Medicine);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// ── GET /api/pharmacy/alerts ──
async function handleGetAlerts(request: Request): Promise<Response> {
  const db = getDb();
  const lowStock = db.query("SELECT * FROM medicines WHERE quantity <= reorder_threshold ORDER BY name").all() as Medicine[];
  const nearExpiry = db.query("SELECT * FROM medicines WHERE expiry_date <= date('now', '+' || expiry_alert_days || ' days') ORDER BY expiry_date").all() as Medicine[];
  return json({
    low_stock: lowStock,
    near_expiry: nearExpiry
  });
}

// ── GET /api/pharmacy/prescriptions?status=&patient_id= ──
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

// ── POST /api/pharmacy/prescriptions/:id/dispense ──
async function handleDispensePrescription(request: Request, id: string): Promise<Response> {
  try {
    const db = getDb();
    const existing = db.query("SELECT * FROM prescriptions WHERE id = ?").get(Number(id)) as { id: number; status: string; patient_id: number } | undefined;
    if (!existing) return error("Prescription not found", 404);
    if (existing.status === "dispensed") return error("Prescription already dispensed", 400);

    const items = db.query("SELECT * FROM prescription_items WHERE prescription_id = ?").all(Number(id)) as Array<{ medicine_name: string; dosage: string; frequency: string; duration: string }>;

    const userId = getUserId(request) ?? 0;

    // Define database transaction for atomic updates
    const dispenseTx = db.transaction((prescriptionId: number, itemsList: typeof items, uId: number) => {
      const now = new Date().toISOString();
      for (const item of itemsList) {
        const med = db.query("SELECT * FROM medicines WHERE LOWER(name) = LOWER(?)").get(item.medicine_name.trim()) as Medicine | undefined;
        if (med) {
          const requiredQty = calculateTotalQuantity(item.dosage, item.frequency, item.duration);
          if (med.quantity < requiredQty) {
            throw new Error("Insufficient stock");
          }
          const newQty = med.quantity - requiredQty;
          db.run("UPDATE medicines SET quantity = ?, updated_at = ? WHERE id = ?", [newQty, now, med.id]);
          db.run(
            `INSERT INTO stock_movements (medicine_id, type, quantity_change, reference, user_id) VALUES (?, 'dispense', ?, ?, ?)`,
            [med.id, -requiredQty, `Prescription #${prescriptionId}`, uId]
          );
        }
      }
      db.run("UPDATE prescriptions SET status = 'dispensed' WHERE id = ?", [prescriptionId]);
    });

    dispenseTx(Number(id), items, userId);

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

  const adjustMatch = matchPath("/api/pharmacy/medicines/:id/adjust", pathname);
  if (adjustMatch && request.method === "POST") return handleAdjustMedicine(request, adjustMatch.id);

  const dispenseMatch = matchPath("/api/pharmacy/prescriptions/:id/dispense", pathname);
  if (dispenseMatch && request.method === "POST") return handleDispensePrescription(request, dispenseMatch.id);

  if (pathname === "/api/pharmacy/medicines" && request.method === "GET") return handleListMedicines(request);
  if (pathname === "/api/pharmacy/medicines" && request.method === "POST") return handleCreateMedicine(request);
  if (pathname === "/api/pharmacy/prescriptions" && request.method === "GET") return handleListPrescriptions(request);
  if (pathname === "/api/pharmacy/alerts" && request.method === "GET") return handleGetAlerts(request);

  return error("Not found", 404);
}
