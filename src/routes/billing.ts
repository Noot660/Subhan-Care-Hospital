import { getDb } from "../db";
import { json, error, parseBody, matchPath } from "../middleware/http";
import { extractToken, validateSession } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import type { Invoice } from "../types";
import { calculateTotalQuantity } from "./pharmacy";

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

function getInvoicePrintableMetadata(invoice: any, patient: any, items: any[], payments: any[], creditNotes: any[]) {
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalCredited = creditNotes.reduce((sum, c) => sum + c.amount, 0);
  const balanceDue = Math.max(0, Math.round((invoice.total - totalPaid - totalCredited) * 100) / 100);

  return {
    header: {
      clinic_name: "Subhan Care Hospital",
      receipt_type: "Invoice Receipt",
      invoice_number: invoice.invoice_number,
      created_at: invoice.created_at,
    },
    patient: {
      code: patient.patient_id,
      name: patient.full_name,
      phone: patient.phone,
      cnic: patient.cnic,
    },
    items: items.map(item => ({
      description: item.description,
      type: item.type,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.total
    })),
    summary: {
      subtotal: invoice.subtotal,
      total: invoice.total,
      total_paid: totalPaid,
      total_credited: totalCredited,
      balance_due: balanceDue,
    },
    formatted_text: `
========================================
         SUBHAN CARE HOSPITAL          
========================================
Receipt No: ${invoice.invoice_number}
Date: ${invoice.created_at}
Patient: ${patient.full_name} (${patient.patient_id})
----------------------------------------
${items.map(item => `${item.description.padEnd(25)} Qty:${item.quantity}  Fee:${item.unit_price}  Total:${item.total}`).join('\n')}
----------------------------------------
Subtotal: ${invoice.subtotal}
Total: ${invoice.total}
Paid: ${totalPaid}
Credited: ${totalCredited}
Balance Due: ${balanceDue}
========================================
`.trim()
  };
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
    const payments = db.query("SELECT * FROM payments WHERE invoice_id = ?").all(row.id as number);
    const creditNotes = db.query("SELECT * FROM credit_notes WHERE invoice_id = ?").all(row.id as number);
    const patient = db.query("SELECT * FROM patients WHERE id = ?").get(row.patient_id as number);
    return {
      ...row,
      items,
      payments,
      credit_notes: creditNotes,
      printable_metadata: getInvoicePrintableMetadata(row, patient, items, payments, creditNotes)
    };
  });
  return json(result);
}

// GET /api/billing/invoices/:id (or /api/invoices/:id)
async function handleGetInvoice(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const invoice = db.query("SELECT * FROM invoices WHERE id = ?").get(Number(id)) as Record<string, unknown> | undefined;
  if (!invoice) return error("Invoice not found", 404);

  const patient = db.query("SELECT * FROM patients WHERE id = ?").get(invoice.patient_id as number);
  const items = db.query("SELECT * FROM invoice_items WHERE invoice_id = ?").all(invoice.id as number);
  const payments = db.query("SELECT * FROM payments WHERE invoice_id = ?").all(invoice.id as number);
  const creditNotes = db.query("SELECT * FROM credit_notes WHERE invoice_id = ?").all(invoice.id as number);

  return json({
    ...invoice,
    items,
    payments,
    credit_notes: creditNotes,
    printable_metadata: getInvoicePrintableMetadata(invoice, patient, items, payments, creditNotes)
  });
}

// POST /api/billing/invoices  { patient_id, appointment_id?, items: [{description,type,quantity,unit_price}] }
async function handleCreateInvoice(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{
      patient_id: number;
      appointment_id?: number;
      status?: string;
      items?: Array<{ description: string; type?: string; quantity?: number; unit_price?: number }>;
    }>(request);
    if (!body.patient_id) return error("patient_id is required", 400);
    const db = getDb();
    const patient = db.query("SELECT * FROM patients WHERE id = ?").get(body.patient_id);
    if (!patient) return error("Patient not found", 404);

    let itemsToInsert: Array<{ description: string; type: string; quantity: number; unit_price: number }> = [];

    if (body.items && Array.isArray(body.items) && body.items.length > 0) {
      for (const item of body.items) {
        const type = item.type || "supplementary";
        let price = Number(item.unit_price || 0);
        let desc = item.description || "";
        const qty = Number(item.quantity || 1);

        if (type === "consultation") {
          let fee = 0;
          if (body.appointment_id) {
            const doc = db.query(
              `SELECT d.fee, d.name FROM doctors d
               JOIN appointments a ON a.doctor_id = d.id
               WHERE a.id = ?`
            ).get(body.appointment_id) as { fee: number; name: string } | undefined;
            if (doc) {
              fee = doc.fee;
              if (!desc) desc = `Consultation Fee - ${doc.name}`;
            }
          }
          if (fee === 0) {
            const docName = desc.replace("Consultation Fee - ", "").trim();
            const doc = db.query("SELECT fee FROM doctors WHERE name = ? OR name LIKE ?").get(docName, `%${docName}%`) as { fee: number } | undefined;
            if (doc) fee = doc.fee;
          }
          price = fee;
        } else if (type === "medicine") {
          const medName = desc.trim();
          const med = db.query("SELECT unit_cost FROM medicines WHERE LOWER(name) = LOWER(?)").get(medName) as { unit_cost: number } | undefined;
          price = med ? med.unit_cost : 0;
        }

        itemsToInsert.push({
          description: desc,
          type,
          quantity: qty,
          unit_price: price
        });
      }
    } else if (body.appointment_id) {
      // Auto-generate items
      const appt = db.query(
        `SELECT a.doctor_id, d.name as doctor_name, d.fee as doctor_fee FROM appointments a
         JOIN doctors d ON a.doctor_id = d.id
         WHERE a.id = ?`
      ).get(body.appointment_id) as { doctor_id: number; doctor_name: string; doctor_fee: number } | undefined;

      if (!appt) return error("Appointment not found", 404);

      itemsToInsert.push({
        description: `Consultation Fee - ${appt.doctor_name}`,
        type: "consultation",
        quantity: 1,
        unit_price: appt.doctor_fee
      });

      const consultation = db.query("SELECT id FROM consultations WHERE appointment_id = ?").get(body.appointment_id) as { id: number } | undefined;
      if (consultation) {
        const prescription = db.query("SELECT id FROM prescriptions WHERE consultation_id = ? AND status = 'finalized'").get(consultation.id) as { id: number } | undefined;
        if (prescription) {
          const rxItems = db.query("SELECT * FROM prescription_items WHERE prescription_id = ?").all(prescription.id) as Array<{ medicine_name: string; dosage: string; frequency: string; duration: string }>;
          for (const rxItem of rxItems) {
            const med = db.query("SELECT unit_cost FROM medicines WHERE LOWER(name) = LOWER(?)").get(rxItem.medicine_name.trim()) as { unit_cost: number } | undefined;
            const price = med ? med.unit_cost : 0;
            const qty = calculateTotalQuantity(rxItem.dosage, rxItem.frequency, rxItem.duration);
            itemsToInsert.push({
              description: rxItem.medicine_name,
              type: "medicine",
              quantity: qty,
              unit_price: price
            });
          }
        }
      }
    } else {
      return error("items array or appointment_id is required", 400);
    }

    if (itemsToInsert.length === 0) {
      return error("Invoice must contain at least one item", 400);
    }

    let subtotal = 0;
    for (const item of itemsToInsert) {
      subtotal += item.quantity * item.unit_price;
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
    for (const item of itemsToInsert) {
      db.run(
        `INSERT INTO invoice_items (invoice_id, description, type, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, item.description, item.type, item.quantity, item.unit_price, Math.round(item.quantity * item.unit_price * 100) / 100]
      );
    }
    const userId = getUserId(request) ?? 0;
    auditLog({ user_id: userId, action: "create", entity_type: "invoice", entity_id: invoiceNumber, details: { patient_id: body.patient_id, total: subtotal } });

    // Fetch complete invoice payload to return with printable_metadata
    const invoiceRecord = db.query("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as Record<string, unknown>;
    const savedItems = db.query("SELECT * FROM invoice_items WHERE invoice_id = ?").all(invoiceId);
    return json({
      ...invoiceRecord,
      items: savedItems,
      payments: [],
      credit_notes: [],
      printable_metadata: getInvoicePrintableMetadata(invoiceRecord, patient, savedItems, [], [])
    }, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// DELETE /api/billing/invoices/:id (or /api/invoices/:id)
async function handleDeleteInvoice(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const invoice = db.query("SELECT * FROM invoices WHERE id = ?").get(Number(id)) as Record<string, unknown> | undefined;
  if (!invoice) return error("Invoice not found", 404);

  if (invoice.status !== "draft") {
    return error("Cannot delete a finalized invoice", 400);
  }

  db.run("DELETE FROM invoice_items WHERE invoice_id = ?", [invoice.id]);
  db.run("DELETE FROM invoices WHERE id = ?", [invoice.id]);
  
  const userId = getUserId(request) ?? 0;
  auditLog({ user_id: userId, action: "delete", entity_type: "invoice", entity_id: String(invoice.invoice_number), details: {} });
  
  return json({ message: "Invoice deleted" });
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
    const credited = (db.query("SELECT COALESCE(SUM(amount),0) as s FROM credit_notes WHERE invoice_id = ?").get(Number(id)) as { s: number }).s;
    const newStatus = (paid + credited) >= invoice.total - 0.01 ? "paid" : "partially_paid";
    db.run("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?", [newStatus, now, Number(id)]);
    auditLog({ user_id: userId, action: "pay", entity_type: "invoice", entity_id: invoice.invoice_number, details: { amount, method: body.method || "cash" } });
    return json({ message: "Payment recorded", invoice_id: Number(id), status: newStatus, amount_paid: paid });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// POST /api/billing/invoices/:id/credit-notes
async function handleCreateCreditNote(request: Request, id: string): Promise<Response> {
  try {
    const body = await parseBody<{ amount: number; reason: string }>(request);
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return error("amount must be a positive number", 400);
    if (!body.reason || !body.reason.trim()) return error("reason is required", 400);

    const db = getDb();
    const invoice = db.query("SELECT * FROM invoices WHERE id = ?").get(Number(id)) as Invoice | undefined;
    if (!invoice) return error("Invoice not found", 404);
    if (invoice.status === "cancelled") return error("Cannot add credit note to a cancelled invoice", 400);

    const paid = (db.query("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE invoice_id = ?").get(invoice.id) as { s: number }).s;
    const credited = (db.query("SELECT COALESCE(SUM(amount),0) as s FROM credit_notes WHERE invoice_id = ?").get(invoice.id) as { s: number }).s;
    const remaining = invoice.total - paid - credited;

    if (amount > remaining + 0.01) {
      return error("Credit note amount cannot exceed remaining invoice balance", 400);
    }

    const now = new Date().toISOString();
    const result = db.run(
      `INSERT INTO credit_notes (invoice_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`,
      [invoice.id, amount, body.reason, now]
    );
    const cnId = Number(result.lastInsertRowid);

    const newStatus = (paid + credited + amount) >= invoice.total - 0.01 ? "paid" : "partially_paid";
    db.run("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?", [newStatus, now, invoice.id]);

    const userId = getUserId(request) ?? 0;
    auditLog({ user_id: userId, action: "create_credit_note", entity_type: "credit_note", entity_id: String(cnId), details: { invoice_id: invoice.id, amount } });

    const createdCn = db.query("SELECT * FROM credit_notes WHERE id = ?").get(cnId);
    return json(createdCn, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

// GET /api/billing/invoices/:id/credit-notes
async function handleListCreditNotes(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const notes = db.query("SELECT * FROM credit_notes WHERE invoice_id = ? ORDER BY created_at DESC").all(Number(id));
  return json(notes);
}

// GET /api/billing/patients/:id/outstanding-balance
async function handlePatientOutstandingBalance(request: Request, id: string): Promise<Response> {
  const db = getDb();
  const patient = db.query("SELECT id FROM patients WHERE id = ?").get(Number(id));
  if (!patient) return error("Patient not found", 404);

  const summary = db.query(`
    SELECT 
      COALESCE(SUM(i.total), 0) as total_invoiced,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN invoices inv ON p.invoice_id = inv.id WHERE inv.patient_id = ? AND inv.status != 'cancelled') as total_paid,
      (SELECT COALESCE(SUM(cn.amount), 0) FROM credit_notes cn JOIN invoices inv ON cn.invoice_id = inv.id WHERE inv.patient_id = ? AND inv.status != 'cancelled') as total_credited
    FROM invoices i
    WHERE i.patient_id = ? AND i.status != 'cancelled'
  `).get(Number(id), Number(id), Number(id)) as { total_invoiced: number; total_paid: number; total_credited: number };

  const outstanding = Math.round((summary.total_invoiced - summary.total_paid - summary.total_credited) * 100) / 100;

  return json({
    patient_id: Number(id),
    total_invoiced: summary.total_invoiced,
    total_paid: summary.total_paid,
    total_credited: summary.total_credited,
    outstanding_balance: Math.max(0, outstanding)
  });
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

  const cnMatch = matchPath("/api/billing/invoices/:id/credit-notes", pathname);
  if (cnMatch && request.method === "POST") return handleCreateCreditNote(request, cnMatch.id);
  if (cnMatch && request.method === "GET") return handleListCreditNotes(request, cnMatch.id);
  const cnMatchAlt = matchPath("/api/invoices/:id/credit-notes", pathname);
  if (cnMatchAlt && request.method === "POST") return handleCreateCreditNote(request, cnMatchAlt.id);
  if (cnMatchAlt && request.method === "GET") return handleListCreditNotes(request, cnMatchAlt.id);

  const outstandingMatch = matchPath("/api/billing/patients/:id/outstanding-balance", pathname);
  if (outstandingMatch && request.method === "GET") return handlePatientOutstandingBalance(request, outstandingMatch.id);
  const outstandingMatchAlt = matchPath("/api/patients/:id/outstanding-balance", pathname);
  if (outstandingMatchAlt && request.method === "GET") return handlePatientOutstandingBalance(request, outstandingMatchAlt.id);

  const invDetailMatch = matchPath("/api/billing/invoices/:id", pathname);
  if (invDetailMatch && request.method === "GET") return handleGetInvoice(request, invDetailMatch.id);
  if (invDetailMatch && request.method === "DELETE") return handleDeleteInvoice(request, invDetailMatch.id);
  const invDetailMatchAlt = matchPath("/api/invoices/:id", pathname);
  if (invDetailMatchAlt && request.method === "GET") return handleGetInvoice(request, invDetailMatchAlt.id);
  if (invDetailMatchAlt && request.method === "DELETE") return handleDeleteInvoice(request, invDetailMatchAlt.id);

  if ((pathname === "/api/billing/invoices" || pathname === "/api/invoices") && request.method === "GET") return handleListInvoices(request);
  if ((pathname === "/api/billing/invoices" || pathname === "/api/invoices") && request.method === "POST") return handleCreateInvoice(request);
  if (pathname === "/api/billing/summary" && request.method === "GET") return handleBillingSummary(request);
  if (pathname === "/api/billing/collections" && request.method === "GET") return handleCollections(request);

  return error("Not found", 404);
}
