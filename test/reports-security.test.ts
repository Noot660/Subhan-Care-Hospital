import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { getDb } from "../src/db";
import { handleRequest } from "../src/index";

describe("Subhan Care - Part 4 Reports & Security Tests", () => {
  let adminToken: string;
  let testDoctorId: number;
  let testPatientId: number;
  let testMedicineId: number;

  beforeAll(async () => {
    const db = getDb();

    // Clean up
    db.run("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%'))");
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%'))");
    db.run("DELETE FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%')");
    db.run("DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%')");
    db.run("DELETE FROM patients WHERE full_name LIKE 'Report Test Patient%' OR cnic = '35201-9999999-2'");
    db.run("DELETE FROM doctors WHERE name LIKE 'Dr. Report Test%' OR cnic = '35201-9999999-1'");
    db.run("DELETE FROM stock_movements WHERE medicine_id IN (SELECT id FROM medicines WHERE name LIKE 'Report Test Med%')");
    db.run("DELETE FROM medicines WHERE name LIKE 'Report Test Med%'");
    db.run("DELETE FROM otp_tokens WHERE username = 'admin'");

    // 1. Get tokens
    const adminLogin = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" })
    }));
    adminToken = (await adminLogin.json() as any).token;

    // 2. Insert test doctor
    const docRes = db.run(`
      INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
      VALUES ('Dr. Report Test Specialist', 'Cardiology', 'MBBS, FCPS', '35201-9999999-1', '0300-9999998', 4000, 'active')
    `);
    testDoctorId = Number(docRes.lastInsertRowid);

    // 3. Insert test patient
    const patRes = db.run(`
      INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
      VALUES ('SC-PT-RPT-1', 'Report Test Patient One', '1992-05-15', 'Male', '35201-9999999-2', '0300-9999999', 'Hospital Street', '0300-9999999', 'active')
    `);
    testPatientId = Number(patRes.lastInsertRowid);

    // 4. Insert test medicine
    const medRes = db.run(`
      INSERT INTO medicines (name, batch_number, quantity, unit_cost, expiry_date, reorder_threshold, expiry_alert_days)
      VALUES ('Report Test Med Panadol', 'B-RPT-1', 5, 5.0, '2028-12-31', 10, 30)
    `);
    testMedicineId = Number(medRes.lastInsertRowid);

    // 5. Insert test invoice & item & payment
    const invRes = db.run(`
      INSERT INTO invoices (invoice_number, patient_id, appointment_id, status, subtotal, total)
      VALUES ('INV-RPT-1', ?, null, 'partially_paid', 1000, 1000)
    `, [testPatientId]);
    const invoiceId = Number(invRes.lastInsertRowid);

    db.run(`
      INSERT INTO invoice_items (invoice_id, description, type, quantity, unit_price, total)
      VALUES (?, 'Consultation', 'consultation', 1, 1000, 1000)
    `, [invoiceId]);

    db.run(`
      INSERT INTO payments (invoice_id, amount, method, reference)
      VALUES (?, 400, 'cash', 'Report Test Payment')
    `, [invoiceId]);
  });

  afterAll(() => {
    const db = getDb();
    db.run("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%'))");
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%'))");
    db.run("DELETE FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%')");
    db.run("DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Report Test Patient%')");
    db.run("DELETE FROM patients WHERE full_name LIKE 'Report Test Patient%'");
    db.run("DELETE FROM doctors WHERE id = ?", [testDoctorId]);
    db.run("DELETE FROM stock_movements WHERE medicine_id = ?", [testMedicineId]);
    db.run("DELETE FROM medicines WHERE id = ?", [testMedicineId]);
    db.run("DELETE FROM otp_tokens WHERE username = 'admin'");
  });

  describe("Standard Report Catalogue (Section 13) & Export", () => {
    test("Daily Collection Report returns today's collections", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/analytics/reports/daily-collections", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      }));
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBeGreaterThan(0);
      const testPayment = data.find(p => p.reference === 'Report Test Payment');
      expect(testPayment).toBeDefined();
      expect(testPayment.amount).toBe(400);
    });

    test("Doctor Performance Report returns appointments count and revenue", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/analytics/reports/doctor-performance", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      }));
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBeGreaterThan(0);
      const docReport = data.find(d => d.doctor_id === testDoctorId);
      expect(docReport).toBeDefined();
      expect(docReport.doctor_name).toBe('Dr. Report Test Specialist');
    });

    test("Inventory Status Report returns stock levels and alerts flags", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/analytics/reports/inventory-status", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      }));
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBeGreaterThan(0);
      const med = data.find(m => m.medicine_id === testMedicineId);
      expect(med).toBeDefined();
      expect(med.quantity).toBe(5);
      expect(med.is_low_stock).toBe(1); // 5 <= reorder_threshold 10
    });

    test("Outstanding Dues Report returns patients with outstanding balances", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/analytics/reports/outstanding-dues", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      }));
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBeGreaterThan(0);
      const pat = data.find(p => p.patient_id === testPatientId);
      expect(pat).toBeDefined();
      expect(pat.outstanding_balance).toBe(600); // 1000 total - 400 paid = 600
    });

    test("Exporting report in CSV format returns file stream", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/analytics/reports/outstanding-dues/export?format=csv", {
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain("attachment; filename=");
      const text = await res.text();
      expect(text).toContain("patient_id,patient_code,patient_name,phone");
      expect(text).toContain("Report Test Patient One");
    });
  });

  describe("One-Time Password Reset (FR-AUTH-03)", () => {
    test("Full flow: request OTP, verify and reset password, login, restore password", async () => {
      // 1. Request OTP
      const reqRes = await handleRequest(new Request("http://localhost:3000/api/auth/reset-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin" })
      }));
      expect(reqRes.status).toBe(200);
      const reqBody = await reqRes.json() as any;
      expect(reqBody.otp).toBeDefined();
      const otp = reqBody.otp;

      // 2. Verify and Reset Password
      const verifyRes = await handleRequest(new Request("http://localhost:3000/api/auth/reset-password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "admin",
          otp: otp,
          new_password: "newAdminPassword123"
        })
      }));
      expect(verifyRes.status).toBe(200);
      const verifyBody = await verifyRes.json() as any;
      expect(verifyBody.message).toBe("Password reset successful");

      // 3. Login with new password
      const loginRes = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "newAdminPassword123" })
      }));
      expect(loginRes.status).toBe(200);
      const loginBody = await loginRes.json() as any;
      expect(loginBody.token).toBeDefined();

      // 4. Restore original password so subsequent test runs succeed
      const restoreVerify = await handleRequest(new Request("http://localhost:3000/api/auth/reset-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }));
      // Generate standard OTP
      const db = getDb();
      const newOtp = String(Math.floor(100000 + Math.random() * 900000));
      db.run("INSERT INTO otp_tokens (username, token, expires_at) VALUES ('admin', ?, ?)", [newOtp, new Date(Date.now() + 10 * 60 * 1000).toISOString()]);

      await handleRequest(new Request("http://localhost:3000/api/auth/reset-password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "admin",
          otp: newOtp,
          new_password: "admin123"
        })
      }));
    });
  });

  describe("Inactive Session Timeout (FR-AUTH-04)", () => {
    test("Inactivity > 15 minutes rejects validation and deletes session", async () => {
      const db = getDb();

      // Create a new session
      const loginRes = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" })
      }));
      expect(loginRes.status).toBe(200);
      const token = (await loginRes.json() as any).token;

      // Verify the session works immediately
      const meRes1 = await handleRequest(new Request("http://localhost:3000/api/auth/me", {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` }
      }));
      expect(meRes1.status).toBe(200);

      // Artificially change last_active_at to 20 minutes ago
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      db.run("UPDATE sessions SET last_active_at = ? WHERE token = ?", [twentyMinsAgo, token]);

      // Call auth/me again — should return 401 and delete session
      const meRes2 = await handleRequest(new Request("http://localhost:3000/api/auth/me", {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` }
      }));
      expect(meRes2.status).toBe(401);

      // Verify session was indeed deleted from DB
      const sessionRow = db.query("SELECT * FROM sessions WHERE token = ?").get(token);
      expect(sessionRow).toBeNull();
    });
  });
});
