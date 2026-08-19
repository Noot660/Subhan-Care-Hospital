import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { getDb } from "../src/db";
import { handleRequest } from "../src/index";

describe("Subhan Care - Part 3 Billing & Payments Tests", () => {
  let adminToken: string;
  let billingToken: string;
  let testDoctorId: number;
  let testPatientId: number;
  let testAppointmentId: number;
  let testMedicineId: number;

  beforeAll(async () => {
    const db = getDb();

    // Clean up any stale data from previous failed runs (safely handling foreign keys in reverse order)
    db.run("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM credit_notes WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM consultations WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM patients WHERE full_name LIKE 'Billing Test Patient%' OR cnic = '35201-8888888-2'");
    db.run("DELETE FROM doctor_schedules WHERE doctor_id IN (SELECT id FROM doctors WHERE name LIKE 'Dr. Billing Test%')");
    db.run("DELETE FROM doctors WHERE name LIKE 'Dr. Billing Test%' OR cnic = '35201-8888888-1'");
    db.run("DELETE FROM stock_movements WHERE medicine_id IN (SELECT id FROM medicines WHERE name LIKE 'Billing Test Med%')");
    db.run("DELETE FROM medicines WHERE name LIKE 'Billing Test Med%'");

    // 1. Get tokens
    const adminLogin = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" })
    }));
    adminToken = (await adminLogin.json() as any).token;

    const billingLogin = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "billing", password: "staff123" })
    }));
    billingToken = (await billingLogin.json() as any).token;

    // 2. Insert test doctor
    const docRes = db.run(`
      INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
      VALUES ('Dr. Billing Test Specialist', 'Cardiology', 'MBBS, FCPS', '35201-8888888-1', '0300-8888888', 3500, 'active')
    `);
    testDoctorId = Number(docRes.lastInsertRowid);

    // 3. Insert test patient
    const patRes = db.run(`
      INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
      VALUES ('SC-PT-BILL-1', 'Billing Test Patient One', '1990-05-15', 'Male', '35201-8888888-2', '0300-8888889', 'Hospital Street', '0300-8888889', 'active')
    `);
    testPatientId = Number(patRes.lastInsertRowid);

    // 4. Insert test appointment
    const apptRes = db.run(`
      INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source)
      VALUES (?, ?, '2026-09-01', '10:00', '10:30', 'scheduled', 'staff')
    `, [testPatientId, testDoctorId]);
    testAppointmentId = Number(apptRes.lastInsertRowid);

    // 5. Insert test medicine
    const medRes = db.run(`
      INSERT INTO medicines (name, batch_number, quantity, unit_cost, expiry_date, reorder_threshold, expiry_alert_days)
      VALUES ('Billing Test Med Panadol', 'B-BILL-1', 1000, 4.5, '2028-12-31', 10, 30)
    `);
    testMedicineId = Number(medRes.lastInsertRowid);
  });

  afterAll(() => {
    const db = getDb();
    db.run("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM credit_notes WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%'))");
    db.run("DELETE FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM consultations WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Billing Test Patient%')");
    db.run("DELETE FROM patients WHERE full_name LIKE 'Billing Test Patient%'");
    db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [testDoctorId]);
    db.run("DELETE FROM doctors WHERE id = ?", [testDoctorId]);
    db.run("DELETE FROM stock_movements WHERE medicine_id = ?", [testMedicineId]);
    db.run("DELETE FROM medicines WHERE id = ?", [testMedicineId]);
  });

  describe("Automatic Charge Calculation & Generation", () => {
    test("Invoice generation automatically fetches doctor fee and medicine cost", async () => {
      const db = getDb();

      // Create consultation & finalized prescription
      const consId = Number(db.run(
        `INSERT INTO consultations (appointment_id, patient_id, doctor_id, diagnosis, notes)
         VALUES (?, ?, ?, 'Chest Pain', 'Take rest')`, [testAppointmentId, testPatientId, testDoctorId]
      ).lastInsertRowid);

      const rxId = Number(db.run(
        `INSERT INTO prescriptions (consultation_id, patient_id, doctor_id, status)
         VALUES (?, ?, ?, 'finalized')`, [consId, testPatientId, testDoctorId]
      ).lastInsertRowid);

      // Add a prescription item (requires 2 tablets, twice daily for 5 days = 20 tablets)
      db.run(
        `INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration)
         VALUES (?, 'Billing Test Med Panadol', '2 tablets', 'twice daily', '5 days')`, [rxId]
      );

      // Now create invoice using appointment_id only (automatic lookup)
      const res = await handleRequest(new Request("http://localhost:3000/api/billing/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${billingToken}`
        },
        body: JSON.stringify({
          patient_id: testPatientId,
          appointment_id: testAppointmentId
        })
      }));
      expect(res.status).toBe(201);
      const invoice = await res.json() as any;

      // Doctor fee (3500) + Medicine (20 tablets * 4.5 = 90) = 3590
      expect(invoice.total).toBe(3590);
      expect(invoice.items.length).toBe(2);

      const consultationItem = invoice.items.find((i: any) => i.type === "consultation");
      expect(consultationItem).toBeDefined();
      expect(consultationItem.unit_price).toBe(3500);

      const medicineItem = invoice.items.find((i: any) => i.type === "medicine");
      expect(medicineItem).toBeDefined();
      expect(medicineItem.unit_price).toBe(4.5);
      expect(medicineItem.quantity).toBe(20);
      expect(medicineItem.total).toBe(90);
    });

    test("Invoice generation resolves prices from items array when unit_price is omitted", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/billing/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${billingToken}`
        },
        body: JSON.stringify({
          patient_id: testPatientId,
          appointment_id: testAppointmentId,
          items: [
            { description: "Consultation Fee - Dr. Billing Test Specialist", type: "consultation", quantity: 1 },
            { description: "Billing Test Med Panadol", type: "medicine", quantity: 10 }
          ]
        })
      }));
      expect(res.status).toBe(201);
      const invoice = await res.json() as any;

      // Doctor fee (3500) + Medicine (10 tablets * 4.5 = 45) = 3545
      expect(invoice.total).toBe(3545);
      expect(invoice.items.find((i: any) => i.type === "consultation").unit_price).toBe(3500);
      expect(invoice.items.find((i: any) => i.type === "medicine").unit_price).toBe(4.5);
    });
  });

  describe("Invoice Immutability (FR-BIL-06 / INV-02)", () => {
    test("Finalized invoice cannot be deleted", async () => {
      const db = getDb();
      // Get the finalized invoice from the previous test
      const inv = db.query("SELECT * FROM invoices WHERE patient_id = ? ORDER BY id DESC LIMIT 1").get(testPatientId) as any;
      expect(inv).toBeDefined();

      const res = await handleRequest(new Request(`http://localhost:3000/api/billing/invoices/${inv.id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        }
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("Cannot delete a finalized invoice");

      // Verify it is still in the database
      const checkInv = db.query("SELECT * FROM invoices WHERE id = ?").get(inv.id);
      expect(checkInv).toBeDefined();
    });

    test("Draft invoice can be deleted", async () => {
      const db = getDb();
      // Insert a draft invoice
      const resCreate = await handleRequest(new Request("http://localhost:3000/api/billing/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${billingToken}`
        },
        body: JSON.stringify({
          patient_id: testPatientId,
          status: "draft",
          items: [{ description: "Draft Item", type: "supplementary", quantity: 1, unit_price: 100 }]
        })
      }));
      expect(resCreate.status).toBe(201);
      const draftInvoice = await resCreate.json() as any;

      const resDelete = await handleRequest(new Request(`http://localhost:3000/api/billing/invoices/${draftInvoice.id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        }
      }));
      expect(resDelete.status).toBe(200);

      // Verify it was deleted from DB
      const checkInv = db.query("SELECT * FROM invoices WHERE id = ?").get(draftInvoice.id);
      expect(checkInv).toBeNull();
    });
  });

  describe("Credit Notes Adjustments", () => {
    test("Issue credit note and check balance update", async () => {
      const db = getDb();
      const inv = db.query("SELECT * FROM invoices WHERE patient_id = ? ORDER BY id DESC LIMIT 1").get(testPatientId) as any;

      // Issue a credit note of 500
      const res = await handleRequest(new Request(`http://localhost:3000/api/billing/invoices/${inv.id}/credit-notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${billingToken}`
        },
        body: JSON.stringify({
          amount: 500,
          reason: "Adjusted consultation charge"
        })
      }));
      expect(res.status).toBe(201);
      const note = await res.json() as any;
      expect(note.amount).toBe(500);

      // Verify in DB
      const dbNote = db.query("SELECT * FROM credit_notes WHERE id = ?").get(note.id) as any;
      expect(dbNote).toBeDefined();
      expect(dbNote.invoice_id).toBe(inv.id);
    });

    test("Block credit note exceeding remaining balance", async () => {
      const db = getDb();
      const inv = db.query("SELECT * FROM invoices WHERE patient_id = ? ORDER BY id DESC LIMIT 1").get(testPatientId) as any;

      // Try to issue a credit note that exceeds total
      const res = await handleRequest(new Request(`http://localhost:3000/api/billing/invoices/${inv.id}/credit-notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${billingToken}`
        },
        body: JSON.stringify({
          amount: 100000,
          reason: "Excessive Credit"
        })
      }));
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("Credit note amount cannot exceed remaining invoice balance");
    });
  });

  describe("Patient Outstanding Balance", () => {
    test("Retrieve cross-visit outstanding balance summaries", async () => {
      const res = await handleRequest(new Request(`http://localhost:3000/api/billing/patients/${testPatientId}/outstanding-balance`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${billingToken}`
        }
      }));
      expect(res.status).toBe(200);
      const summary = await res.json() as any;

      expect(summary.patient_id).toBe(testPatientId);
      expect(summary.total_invoiced).toBeGreaterThan(0);
      expect(summary.total_credited).toBe(500);
      expect(summary.outstanding_balance).toBe(summary.total_invoiced - summary.total_paid - summary.total_credited);
    });
  });

  describe("Printable Metadata Stubs", () => {
    test("Invoices include printable_metadata", async () => {
      const db = getDb();
      const inv = db.query("SELECT * FROM invoices WHERE patient_id = ? ORDER BY id DESC LIMIT 1").get(testPatientId) as any;

      const res = await handleRequest(new Request(`http://localhost:3000/api/billing/invoices/${inv.id}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${billingToken}`
        }
      }));
      expect(res.status).toBe(200);
      const invoice = await res.json() as any;

      expect(invoice.printable_metadata).toBeDefined();
      expect(invoice.printable_metadata.header.clinic_name).toBe("Subhan Care Hospital");
      expect(invoice.printable_metadata.summary.total_credited).toBe(500);
      expect(invoice.printable_metadata.formatted_text).toContain("SUBHAN CARE HOSPITAL");
    });

    test("Consultations include printable_metadata", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/consultations", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${adminToken}`
        }
      }));
      expect(res.status).toBe(200);
      const list = await res.json() as any[];

      const consultation = list.find((c: any) => c.patient_id === testPatientId);
      expect(consultation).toBeDefined();
      expect(consultation.printable_metadata).toBeDefined();
      expect(consultation.printable_metadata.header.clinic_name).toBe("Subhan Care Hospital");
      expect(consultation.printable_metadata.clinical.diagnosis).toBe("Chest Pain");
      expect(consultation.printable_metadata.formatted_text).toContain("PRESCRIPTION:");
    });
  });
});
