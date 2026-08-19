import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { getDb } from "../src/db";
import { handleRequest } from "../src/index";
import { handleMessage } from "../src/ai/intents";
import { calculateTotalQuantity } from "../src/routes/pharmacy";
import { hospitalToday } from "../src/appointments/validation";

// Bypass identity verification stub for tests
const originalStub = process.env.PHI_VERIFICATION_STUB;

describe("Subhan Care - AI Receptionist & Pharmacy Gaps Tests", () => {
  let adminToken: string;
  let pharmacistToken: string;
  let billingToken: string;
  let testDoctorId: number;
  let unconfiguredDoctorId: number;

  beforeAll(async () => {
    process.env.PHI_VERIFICATION_STUB = 'true';

    const db = getDb();
    
    // Clean up any stale data from previous failed runs (safely handling foreign keys in reverse order)
    db.run("DELETE FROM stock_movements WHERE medicine_id IN (SELECT id FROM medicines WHERE name LIKE 'Test Med %')");
    db.run("DELETE FROM medicines WHERE name LIKE 'Test Med %'");
    db.run("DELETE FROM doctor_schedules WHERE doctor_id IN (SELECT id FROM doctors WHERE name IN ('Dr. Unconfigured', 'Dr. Test Availability'))");
    db.run("DELETE FROM appointments WHERE doctor_id IN (SELECT id FROM doctors WHERE name IN ('Dr. Unconfigured', 'Dr. Test Availability'))");
    db.run("DELETE FROM doctors WHERE name IN ('Dr. Unconfigured', 'Dr. Test Availability')");
    
    const targetCnics = "('35201-9999000-1', '35201-1234777-1', '35201-1234888-1', '35201-1234888-2')";
    db.run(`DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE cnic IN ${targetCnics}))`);
    db.run(`DELETE FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE cnic IN ${targetCnics})`);
    db.run(`DELETE FROM consultations WHERE patient_id IN (SELECT id FROM patients WHERE cnic IN ${targetCnics})`);
    db.run(`DELETE FROM patients WHERE cnic IN ${targetCnics}`);
    db.run("DELETE FROM patients WHERE full_name IN ('Sanitized Patient', 'Phone Sanitized Patient', 'DOB Patient', 'DOB Patient 2', 'Dispense Patient')");

    // 1. Get tokens
    const adminLogin = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" })
    }));
    adminToken = (await adminLogin.json() as any).token;

    const pharmacistLogin = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pharmacist", password: "staff123" })
    }));
    pharmacistToken = (await pharmacistLogin.json() as any).token;

    const billingLogin = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "billing", password: "staff123" })
    }));
    billingToken = (await billingLogin.json() as any).token;

    // 2. Setup doctors for testing booking guardrails
    // Create an unconfigured doctor (no schedules)
    const doc1 = db.query(
      `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
       VALUES ('Dr. Unconfigured', 'General', 'MBBS', '35201-9999999-1', '0300-9999991', 1000, 'active') RETURNING id`
    ).get() as { id: number };
    unconfiguredDoctorId = doc1.id;

    // Create a configured doctor with a schedule on only 1 day (e.g. Wednesday, day_of_week=3)
    const doc2 = db.query(
      `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
       VALUES ('Dr. Test Availability', 'General', 'MBBS', '35201-9999999-2', '0300-9999992', 1000, 'active') RETURNING id`
    ).get() as { id: number };
    testDoctorId = doc2.id;

    db.run(
      `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
       VALUES (?, 3, '09:00', '09:30')`, [testDoctorId]
    );
  });

  afterAll(() => {
    const db = getDb();
    db.run("DELETE FROM doctor_schedules WHERE doctor_id IN (?, ?)", [testDoctorId, unconfiguredDoctorId]);
    db.run("DELETE FROM appointments WHERE doctor_id IN (?, ?)", [testDoctorId, unconfiguredDoctorId]);
    db.run("DELETE FROM doctors WHERE id IN (?, ?)", [testDoctorId, unconfiguredDoctorId]);
    db.run("DELETE FROM stock_movements WHERE medicine_id IN (SELECT id FROM medicines WHERE name LIKE 'Test Med %')");
    db.run("DELETE FROM medicines WHERE name LIKE 'Test Med %'");

    if (originalStub === undefined) delete process.env.PHI_VERIFICATION_STUB;
    else process.env.PHI_VERIFICATION_STUB = originalStub;
  });

  // ── TASK 1: AI RECEPTIONIST SANITIZATION & GUARDRAILS ──

  describe("AI Receptionist Intake Sanitization", () => {
    test("CNIC is sanitized and formatted", async () => {
      const s = await handleMessage("I want to register", null, "en", "chat");
      await handleMessage("Sanitized Patient", s.session_id, "en", "chat");
      
      // Send raw unformatted CNIC (13 digits)
      const cnicRes = await handleMessage("3520198765432", s.session_id, "en", "chat");
      
      // Should format to 35201-9876543-2 and proceed to DOB
      expect(cnicRes.reply).not.toContain("invalid");
      expect(cnicRes.reply).toContain("date of birth");
      
      // Let's verify it formatted inside the session state
      const db = getDb();
      const state = db.query("SELECT * FROM patients WHERE full_name = 'Sanitized Patient'").get();
      if (state) {
        db.run("DELETE FROM patients WHERE full_name = 'Sanitized Patient'");
      }
    });

    test("Phone/Emergency number normalization (+923... / 923... to 03...)", async () => {
      const s = await handleMessage("I want to register", null, "en", "chat");
      await handleMessage("Phone Sanitized Patient", s.session_id, "en", "chat");
      await handleMessage("35201-1234777-1", s.session_id, "en", "chat"); // CNIC
      await handleMessage("1995-10-10", s.session_id, "en", "chat"); // DOB
      await handleMessage("Male", s.session_id, "en", "chat"); // Gender

      // Send raw Pakistani phone number starting with +923
      const phoneRes = await handleMessage("+923001234567", s.session_id, "en", "chat");
      
      // Should accept and ask for address
      expect(phoneRes.reply).toContain("address");
      
      await handleMessage("123 Street Road", s.session_id, "en", "chat"); // Address
      
      // Send emergency phone starting with 923
      const emergencyRes = await handleMessage("923001234567", s.session_id, "en", "chat");
      
      // Should accept emergency and present confirm details.
      // Note: identical phone and emergency phone numbers are allowed as per minor correction!
      expect(emergencyRes.reply).toContain("confirm");
      
      const confirmRes = await handleMessage("yes", s.session_id, "en", "chat");
      expect(confirmRes.reply).toContain("successfully registered");

      // Verify the patient phone numbers in DB are normalized to 11 digits
      const db = getDb();
      const patient = db.query("SELECT * FROM patients WHERE full_name = 'Phone Sanitized Patient'").get() as any;
      expect(patient).toBeDefined();
      expect(patient.phone).toBe("03001234567");
      expect(patient.emergency_contact).toBe("03001234567");
      expect(patient.cnic).toBe("35201-1234777-1");

      // Clean up
      db.run("DELETE FROM patients WHERE id = ?", [patient.id]);
    });

    test("Alternative DOB formats and strict calendar validation", async () => {
      const s = await handleMessage("I want to register", null, "en", "chat");
      await handleMessage("DOB Patient", s.session_id, "en", "chat");
      await handleMessage("35201-1234888-1", s.session_id, "en", "chat");

      // Test alternative format DD-MM-YYYY (e.g. 15-05-1990)
      const dobRes1 = await handleMessage("15-05-1990", s.session_id, "en", "chat");
      expect(dobRes1.reply).toContain("gender"); // Advances!

      // Test invalid calendar date (impossible date Feb 30th)
      const s2 = await handleMessage("I want to register", null, "en", "chat");
      await handleMessage("DOB Patient 2", s2.session_id, "en", "chat");
      await handleMessage("35201-1234888-2", s2.session_id, "en", "chat");
      const dobRes2 = await handleMessage("2026-02-30", s2.session_id, "en", "chat");
      expect(dobRes2.reply).toContain("Invalid date format"); // Rejected!
    });
  });

  describe("AI Receptionist Booking Guardrails", () => {
    test("Blocks booking if doctor is unconfigured", async () => {
      const s = await handleMessage("I want to book an appointment", null, "en", "chat");
      await handleMessage("yes", s.session_id, "en", "chat"); // is patient
      await handleMessage("SC-PT-000001", s.session_id, "en", "chat"); // patient ID
      
      const docRes = await handleMessage("Dr. Unconfigured", s.session_id, "en", "chat");
      
      // Should block booking and indicate unconfigured schedule
      expect(docRes.reply).toContain("does not have a configured schedule");
    });

    test("Specifically handles doctor fully booked vs not working on that day", async () => {
      // Setup: Dr. Test Availability is only available on Wednesdays.
      // Date 2026-08-26 is Wednesday (in the future). Thursday is 2026-08-27 (in the future).
      
      const s1 = await handleMessage("I want to book an appointment", null, "en", "chat");
      await handleMessage("yes", s1.session_id, "en", "chat");
      await handleMessage("SC-PT-000001", s1.session_id, "en", "chat");
      await handleMessage("Dr. Test Availability", s1.session_id, "en", "chat");
      
      // Book on Thursday (not scheduled)
      const notScheduledRes = await handleMessage("2026-08-27", s1.session_id, "en", "chat");
      expect(notScheduledRes.reply).toContain("is not scheduled to work");

      // Book on Wednesday (scheduled)
      const s2 = await handleMessage("I want to book an appointment", null, "en", "chat");
      await handleMessage("yes", s2.session_id, "en", "chat");
      await handleMessage("SC-PT-000001", s2.session_id, "en", "chat");
      await handleMessage("Dr. Test Availability", s2.session_id, "en", "chat");
      
      const scheduledRes = await handleMessage("2026-08-26", s2.session_id, "en", "chat");
      expect(scheduledRes.reply).toContain("available time slots");

      // Now block/occupy that slot to test fully booked
      const db = getDb();
      db.run(
        `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source)
         VALUES (1, ?, '2026-08-26', '09:00', '09:30', 'scheduled', 'chat')`, [testDoctorId]
      );

      // Attempt to book again on the now occupied date
      const s3 = await handleMessage("I want to book an appointment", null, "en", "chat");
      await handleMessage("yes", s3.session_id, "en", "chat");
      await handleMessage("SC-PT-000001", s3.session_id, "en", "chat");
      await handleMessage("Dr. Test Availability", s3.session_id, "en", "chat");
      
      const fullyBookedRes = await handleMessage("2026-08-26", s3.session_id, "en", "chat");
      expect(fullyBookedRes.reply).toContain("is fully booked");

      // Clean up appointment
      db.run("DELETE FROM appointments WHERE doctor_id = ? AND date = '2026-08-26'", [testDoctorId]);
    });
  });

  // ── TASK 2: PHARMACY & INVENTORY GAPS ──

  describe("Pharmacy - New Medicine Product Entry", () => {
    test("Role permissions check - billing user forbidden", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/pharmacy/medicines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${billingToken}`
        },
        body: JSON.stringify({
          name: "Test Med Billing",
          batch_number: "B-TEST-1",
          quantity: 100,
          unit_cost: 10,
          expiry_date: "2027-12-31"
        })
      }));
      expect(res.status).toBe(403);
    });

    test("Registers a new medicine successfully & logs stock movement and audit log", async () => {
      const res = await handleRequest(new Request("http://localhost:3000/api/pharmacy/medicines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          name: "Test Med Panadol",
          batch_number: "B-PAN-99",
          quantity: 250,
          unit_cost: 2.5,
          expiry_date: "2027-12-31",
          reorder_threshold: 30,
          expiry_alert_days: 60
        })
      }));
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.id).toBeDefined();
      expect(data.name).toBe("Test Med Panadol");
      expect(data.quantity).toBe(250);

      // Verify stock movement was recorded
      const db = getDb();
      const move = db.query("SELECT * FROM stock_movements WHERE medicine_id = ? AND type = 'add'").get(data.id) as any;
      expect(move).toBeDefined();
      expect(move.quantity_change).toBe(250);
      expect(move.reference).toBe("Initial stock entry");
    });
  });

  describe("Pharmacy - Manual Stock Adjustments Log", () => {
    test("Adjusts stock level (positive/negative) and logs stock_movements", async () => {
      const db = getDb();
      const med = db.query("SELECT * FROM medicines WHERE name = 'Test Med Panadol'").get() as any;
      expect(med).toBeDefined();

      // Negative adjustment (loss/damage)
      const res1 = await handleRequest(new Request(`http://localhost:3000/api/pharmacy/medicines/${med.id}/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          quantity_change: -50,
          reason: "Damaged batch"
        })
      }));
      expect(res1.status).toBe(200);
      const data1 = await res1.json() as any;
      expect(data1.quantity).toBe(200); // 250 - 50 = 200

      // Verify stock movement
      const move1 = db.query("SELECT * FROM stock_movements WHERE medicine_id = ? AND type = 'adjust' ORDER BY id DESC LIMIT 1").get(med.id) as any;
      expect(move1.quantity_change).toBe(-50);
      expect(move1.reference).toBe("Damaged batch");
    });

    test("Blocks manual adjustment from reducing stock below zero", async () => {
      const db = getDb();
      const med = db.query("SELECT * FROM medicines WHERE name = 'Test Med Panadol'").get() as any;

      const res = await handleRequest(new Request(`http://localhost:3000/api/pharmacy/medicines/${med.id}/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          quantity_change: -300, // available is 200
          reason: "Disposed"
        })
      }));
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toBe("Insufficient stock");

      // Verify DB stock remains 200
      const checkMed = db.query("SELECT quantity FROM medicines WHERE id = ?").get(med.id) as any;
      expect(checkMed.quantity).toBe(200);
    });
  });

  describe("Pharmacy - Inventory Alerts", () => {
    test("Alerts route returns low-stock and near-expiry medicines", async () => {
      // 1. Create a medicine below reorder threshold
      const db = getDb();
      const res1 = await handleRequest(new Request("http://localhost:3000/api/pharmacy/medicines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          name: "Test Med LowStock",
          batch_number: "B-LOW-1",
          quantity: 5,
          unit_cost: 10,
          expiry_date: "2027-12-31",
          reorder_threshold: 10
        })
      }));
      expect(res1.status).toBe(200);
      const data1 = await res1.json() as any;

      // 2. Create a medicine near expiry (within 30 days)
      const nearDate = new Date();
      nearDate.setDate(nearDate.getDate() + 10); // expiring in 10 days
      const nearDateStr = nearDate.toISOString().split("T")[0];

      const res2 = await handleRequest(new Request("http://localhost:3000/api/pharmacy/medicines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          name: "Test Med NearExpiry",
          batch_number: "B-EXP-1",
          quantity: 50,
          unit_cost: 10,
          expiry_date: nearDateStr,
          expiry_alert_days: 30
        })
      }));
      expect(res2.status).toBe(200);
      const data2 = await res2.json() as any;

      // 3. Call GET /api/pharmacy/alerts
      const alertsRes = await handleRequest(new Request("http://localhost:3000/api/pharmacy/alerts", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${pharmacistToken}`
        }
      }));
      expect(alertsRes.status).toBe(200);
      const alerts = await alertsRes.json() as any;

      expect(alerts.low_stock.some((m: any) => m.name === "Test Med LowStock")).toBe(true);
      expect(alerts.near_expiry.some((m: any) => m.name === "Test Med NearExpiry")).toBe(true);

      // Clean up (delete movements first then medicines due to foreign key constraints!)
      db.run("DELETE FROM stock_movements WHERE medicine_id IN (?, ?)", [data1.id, data2.id]);
      db.run("DELETE FROM medicines WHERE id IN (?, ?)", [data1.id, data2.id]);
    });
  });

  describe("Prescription Dispensing - Dosage Parsing & Transaction Block", () => {
    test("calculateTotalQuantity parses various dosage strings correctly", () => {
      // 2 tablets, 3 times a day for 7 days = 42
      expect(calculateTotalQuantity("2 tablets", "3 times a day", "for 7 days")).toBe(42);
      expect(calculateTotalQuantity("2 tabs", "3x daily", "7 days")).toBe(42);
      
      // 500mg, 1-0-1, 3 days = 6
      expect(calculateTotalQuantity("500mg", "1-0-1", "3 days")).toBe(6);

      // 1 tablet, daily, 5 days = 5
      expect(calculateTotalQuantity("1 tablet", "once daily", "5 days")).toBe(5);

      // Single combined string inside dosage field
      expect(calculateTotalQuantity("2 tablets, 3 times daily for 5 days", "", "")).toBe(30);
    });

    test("Dispensing deducts correct quantity and blocks atomic transaction if stock is insufficient", async () => {
      const db = getDb();
      
      // Create medicine
      const resMed = await handleRequest(new Request("http://localhost:3000/api/pharmacy/medicines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${pharmacistToken}`
        },
        body: JSON.stringify({
          name: "Test Med Dispense",
          batch_number: "B-DISP-1",
          quantity: 20, // Only 20 in stock
          unit_cost: 10,
          expiry_date: "2027-12-31"
        })
      }));
      expect(resMed.status).toBe(200);
      const med = await resMed.json() as any;

      // Create patient, consultation, and prescription
      const patId = Number(db.run(
        `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
         VALUES ('SC-PT-DISP', 'Dispense Patient', '1990-01-01', 'Male', '35201-9999000-1', '0300-9999000', 'Test Address', '0300-9999000', 'active')`
      ).lastInsertRowid);

      const consId = Number(db.run(
        `INSERT INTO consultations (appointment_id, patient_id, doctor_id, diagnosis, notes)
         VALUES (1, ?, 1, 'Cold', 'Take rest')`, [patId]
      ).lastInsertRowid);

      const rxId = Number(db.run(
        `INSERT INTO prescriptions (consultation_id, patient_id, doctor_id, status)
         VALUES (?, ?, 1, 'finalized')`, [consId, patId]
      ).lastInsertRowid);

      // Add item demanding 30 tablets (1 tablet, 3 times a day for 10 days = 30) - exceeds stock of 20!
      db.run(
        `INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration)
         VALUES (?, 'Test Med Dispense', '1 tablet', '3 times a day', '10 days')`, [rxId]
      );

      // Attempt to dispense
      const dispenseRes1 = await handleRequest(new Request(`http://localhost:3000/api/pharmacy/prescriptions/${rxId}/dispense`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${pharmacistToken}`
        }
      }));
      
      // Should fail with 400 Insufficient stock
      expect(dispenseRes1.status).toBe(400);
      const errData = await dispenseRes1.json() as any;
      expect(errData.error).toBe("Insufficient stock");

      // Verify stock was NOT deducted (atomicity baseline)
      const checkMed1 = db.query("SELECT quantity FROM medicines WHERE id = ?").get(med.id) as any;
      expect(checkMed1.quantity).toBe(20);

      // Restock to 50
      db.run("UPDATE medicines SET quantity = 50 WHERE id = ?", [med.id]);

      // Dispense again (now sufficient)
      const dispenseRes2 = await handleRequest(new Request(`http://localhost:3000/api/pharmacy/prescriptions/${rxId}/dispense`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${pharmacistToken}`
        }
      }));
      
      expect(dispenseRes2.status).toBe(200);

      // Verify stock was deducted exactly 30 tablets (50 - 30 = 20)
      const checkMed2 = db.query("SELECT quantity FROM medicines WHERE id = ?").get(med.id) as any;
      expect(checkMed2.quantity).toBe(20);

      // Verify stock movement
      const move = db.query("SELECT * FROM stock_movements WHERE medicine_id = ? AND type = 'dispense'").get(med.id) as any;
      expect(move).toBeDefined();
      expect(move.quantity_change).toBe(-30);

      // Clean up patient & tx details (delete movements first due to foreign keys)
      db.run("DELETE FROM prescription_items WHERE prescription_id = ?", [rxId]);
      db.run("DELETE FROM prescriptions WHERE id = ?", [rxId]);
      db.run("DELETE FROM consultations WHERE id = ?", [consId]);
      db.run("DELETE FROM patients WHERE id = ?", [patId]);
      db.run("DELETE FROM stock_movements WHERE medicine_id = ?", [med.id]);
      db.run("DELETE FROM medicines WHERE id = ?", [med.id]);
    });
  });
});
