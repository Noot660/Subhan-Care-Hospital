import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Invoice } from "../types";

function getUserId(request: Request): number | null {
  const token = extractToken(request);
  const session = token ? validateSession(token) : null;
  return session ? session.user_id : null;
}

function generateInvoiceNumber(db: ReturnType<typeof getDb>): string {
  const last = db.query("SELECT invoice_number FROM invoices ORDER BY id DESC LIMIT 1").get() as { invoice_number: string } | undefined;
  if (!last) return "INV-0001";
  const num = parseInt(last.invoice_number.replace("INV-", ""), 10);
  return `INV-${String(num + 1).padStart(4, "0")}`;
}

// GET /api/billing/invoices  (?status=&patient_id=)  — also served at /api/invoices
async function handleListInvoices(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const patientId = url.searchParams.get("patient_id") || "";
  const db = getDb();
  let query = `
    SELECT i.*, p.full_name as patient_name, p.patient_id as patient_code,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id = i.id) as amount_paid
    FROM invoices i JOIN patients p ON i.patient_id = p.id
    WHERE 1=1`;
  const params: (string | number)[] = [];
  if (status) {
    if (status === "pending") {
      query += " AND i.status IN ('draft','finalized','partially_paid')";
    } else {
      query += " AND i.status = ?";
      params.push(status);
    }
  }
  if (patientId) {
    query += " AND i.patient_id = ?";
    params.push(Number(patientId));
  }
  query += " ORDER BY i.created_at DESC LIMIT 200";
  const rows = db.query(query).all(...params) as Array<Record<string, unknown>>;
  const result = rows.map((row) => {
    const items = db.query("SELECT * FROM invoice_items WHERE invoice_id = ?").all(row.id as number);
    return { ...row, items };
  });
  return json(result);
}

// POST /api/billing/invoices  { patient_id, appointment_id?, items: [{description,type,quantity,unit_price}] }
async function handleCreateInvoice(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{
      patient_id: number;
      appointment_id?: number;
      status?: string;
      items: Array<{ description: string; type?: string; quantity?: number; unit_price: number }>;
    }>(request);
    if (!body.patient_id) return error("patient_id is required", 400);
    if (!Array.isArray(body.items) || body.items.length === 0) return error("items array is required", 400);
    const db = getDb();
    if (!db.query("SELECT id FROM patients WHERE id = ?").get(body.patient_id)) return error("Patient not found", 404);

    let subtotal = 0;
    for (const item of body.items) {
      if (!item.description || !Number.isFinite(Number(item.unit_price))) {
        return error("Each item needs description and unit_price", 400);
      }
      subtotal += Number(item.quantity || 1) * Number(item.unit_price);
    }
    subtotal = Math.round(subtotal * 100) / 100;

    const status = body.status && ["draft", "finalized", "paid"].includes(body.status) ? body.status : "finalized";
    const now = new Date().toISOString();
    const invoiceNumber = generateInvoiceNumber(db);
    const result = db.run(
      `INSERT INTO invoices (invoice_number, patient_id, appointment_id, status, subtotal, total, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceNumber, body.patient_id, body.appointment_id || null, status, subtotal, subtotal, now, now]
    );
    const invoiceId = Number(result.lastInsertRowid);
    for (const item of body.items) {
      const qty = Number(item.quantity || 1);
      const unit = Number(item.unit_price);
      db.run(
        `INSERT INTO invoice_items (invoice_id, description, type, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, item.description, item.type || "supplementary", qty, unit, Math.round(qty * unit * 100) / 100]
      );
    }
    const userId = getUserId(request) ?? 0;
    auditLog({ user_id: userId, action: "create", entity_type: "invoice", entity_id: invoiceNumber, details: { patient_id: body.patient_id, total: subtotal } });
    return json(db.query("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as Invoice, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// POST /api/billing/invoices/:id/pay  { amount, method }
async function handlePayInvoice(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<{ amount: number; method?: string }>(request);
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return error("amount must be a positive number", 400);
    const db = getDb();
    const invoice = db.query("SELECT * FROM invoices WHERE id = ?").get(Number(id)) as Invoice | undefined;
    if (!invoice) return error("Invoice not found", 404);
    if (invoice.status === "cancelled") return error("Cannot pay a cancelled invoice", 400);

    const now = new Date().toISOString();
    const userId = getUserId(request) ?? 0;
    db.run(
      `INSERT INTO payments (invoice_id, amount, method, reference, created_at) VALUES (?, ?, ?, ?, ?)`,
      [Number(id), amount, body.method || "cash", "Dashboard payment", now]
    );
    const paid = (db.query("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE invoice_id = ?").get(Number(id)) as { s: number }).s;
    const newStatus = paid >= invoice.total - 0.01 ? "paid" : "partially_paid";
    db.run("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?", [newStatus, now, Number(id)]);
    auditLog({ user_id: userId, action: "pay", entity_type: "invoice", entity_id: invoice.invoice_number, details: { amount, method: body.method || "cash" } });
    return json({ message: "Payment recorded", invoice_id: Number(id), status: newStatus, amount_paid: paid });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// GET /api/billing/summary?period=today|week|month
async function handleBillingSummary(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "today";
  const db = getDb();
  const now = new Date();
  let from: string;
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    from = d.toISOString();
  } else if (period === "month") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    from = d.toISOString();
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  const collections = db.query(
    `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM payments WHERE created_at >= ?`
  ).get(from) as { total: number; count: number };
  const invoices = db.query("SELECT * FROM invoices").all() as unknown as Invoice[];
  const pending = invoices.filter((i) => ["draft", "finalized", "partially_paid"].includes(i.status));
  const pendingAmount = pending.reduce((s, i) => s + (i.total - 0), 0);
  const paidInvoices = invoices.filter((i) => i.status === "paid").length;
  return json({
    period,
    collections: Math.round(collections.total * 100) / 100,
    payment_count: collections.count,
    total_invoices: invoices.length,
    paid_invoices: paidInvoices,
    pending_invoices: pending.length,
    pending_amount: Math.round(pendingAmount * 100) / 100,
  });
}

// GET /api/billing/collections?from=&to=
async function handleCollections(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const db = getDb();
  let query = `
    SELECT p.*, i.invoice_number, i.total as invoice_total, pat.full_name as patient_name
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    JOIN patients pat ON i.patient_id = pat.id
    WHERE 1=1`;
  const params: string[] = [];
  if (from) { query += " AND p.created_at >= ?"; params.push(from); }
  if (to) { query += " AND p.created_at <= ?"; params.push(to); }
  query += " ORDER BY p.created_at DESC LIMIT 200";
  return json(db.query(query).all(...params));
}

export async function handleBilling(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const payMatch = matchPath("/api/billing/invoices/:id/pay", pathname);
  if (payMatch && request.method === "POST") return handlePayInvoice(request, payMatch.id);
  const payMatchAlt = matchPath("/api/invoices/:id/pay", pathname);
  if (payMatchAlt && request.method === "POST") return handlePayInvoice(request, payMatchAlt.id);

  if ((pathname === "/api/billing/invoices" || pathname === "/api/invoices") && request.method === "GET") return handleListInvoices(request);
  if ((pathname === "/api/billing/invoices" || pathname === "/api/invoices") && request.method === "POST") return handleCreateInvoice(request);
  if (pathname === "/api/billing/summary" && request.method === "GET") return handleBillingSummary(request);
  if (pathname === "/api/billing/collections" && request.method === "GET") return handleCollections(request);

  return error("Not found", 404);
}
