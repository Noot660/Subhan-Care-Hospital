import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDb, closeDb } from "./index";
import { hashPassword } from "../middleware/auth";

async function seed() {
  console.log("🌱 Seeding Subhan Care HMS database...");

  // Ensure clean slate: delete the DB file so autoincrement counters reset
  const dbPath = join(import.meta.dir, "..", "..", "data", "hms.db");
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    console.log("🗑️  Removed existing database file");
  }

  const db = getDb();

  // ── 1. Staff (Admin, Receptionist, Pharmacist, Billing) ──
  const adminHash = await hashPassword("admin123");
  const staffHash = await hashPassword("staff123");

  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["System Admin", "admin", "admin", adminHash, "0300-0000001", "admin@subhancare.pk", "active"]);

  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["Sara Ahmed", "receptionist", "receptionist", staffHash, "0300-0000002", "sara@subhancare.pk", "active"]);

  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["Kamran Ali", "pharmacist", "pharmacist", staffHash, "0300-0000003", "kamran@subhancare.pk", "active"]);

  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["Bilal Khan", "billing", "billing", staffHash, "0300-0000004", "bilal@subhancare.pk", "active"]);

  // AI Receptionist service account — used internally by the AI receptionist
  const aiHash = await hashPassword("ai_receptionist_secret_key_2026");
  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["AI Receptionist", "receptionist", "receptionist_ai", aiHash, "0300-0000005", "ai@subhancare.pk", "active"]);

  // Doctor staff accounts — allows doctors to log in to the dashboard
  const doctorHash = await hashPassword("doctor123");
  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["Dr. Ahmed", "doctor", "dr.ahmed", doctorHash, "0300-1111111", "dr.ahmed@subhancare.pk", "active"]);
  db.run(`INSERT INTO staff (name, role, username, password_hash, phone, email, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["Dr. Fatima", "doctor", "dr.fatima", doctorHash, "0300-2222222", "dr.fatima@subhancare.pk", "active"]);

  console.log("✅ Staff created (admin/admin123, receptionist/staff123, pharmacist/staff123, billing/staff123, receptionist_ai, dr.ahmed/doctor123, dr.fatima/doctor123)");

  // ── 2. Doctors ──
  db.run(`INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee)
          VALUES (?, ?, ?, ?, ?, ?)`,
    ["Dr. Ahmed", "Cardiologist", "MBBS, FCPS Cardiology", "35201-1234567-1", "0300-1111111", 2000]);

  db.run(`INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee)
          VALUES (?, ?, ?, ?, ?, ?)`,
    ["Dr. Fatima", "Pediatrician", "MBBS, FCPS Pediatrics", "35201-1234567-2", "0300-2222222", 1500]);

  // ── Doctor schedules ──
  // Dr. Ahmed: Mon-Fri, 9am-3pm
  for (let day = 1; day <= 5; day++) {
    db.run(`INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
            VALUES (?, ?, ?, ?)`, [1, day, "09:00", "15:00"]);
  }
  // Dr. Ahmed: Saturday 10am-1pm
  db.run(`INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
          VALUES (?, ?, ?, ?)`, [1, 6, "10:00", "13:00"]);

  // Dr. Fatima: Sun-Thu, 10am-4pm
  for (let day = 0; day <= 4; day++) {
    db.run(`INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
            VALUES (?, ?, ?, ?)`, [2, day, "10:00", "16:00"]);
  }

  console.log("✅ Doctors and schedules created (Dr. Ahmed - Cardiologist, Dr. Fatima - Pediatrician)");

  // ── 3. Patients ──
  const patients = [
    { patient_id: "SC-PT-000001", full_name: "Muhammad Ali", dob: "1985-03-15", gender: "Male", cnic: "35201-1111111-1", phone: "0300-3333331", address: "123 Main Road, Lahore", emergency_contact: "0300-9999991" },
    { patient_id: "SC-PT-000002", full_name: "Ayesha Khan", dob: "1990-07-22", gender: "Female", cnic: "35201-2222222-2", phone: "0300-3333332", address: "456 Canal View, Karachi", emergency_contact: "0300-9999992" },
    { patient_id: "SC-PT-000003", full_name: "Hamza Tariq", dob: "2019-01-05", gender: "Male", cnic: "35201-3333333-3", phone: "0300-3333333", address: "789 Garden Town, Islamabad", emergency_contact: "0300-9999993" },
    { patient_id: "SC-PT-000004", full_name: "Fatima Bibi", dob: "1955-11-30", gender: "Female", cnic: "35201-4444444-4", phone: "0300-3333334", address: "321 Model Town, Peshawar", emergency_contact: "0300-9999994" },
    { patient_id: "SC-PT-000005", full_name: "Zain Malik", dob: "2000-06-18", gender: "Male", cnic: "35201-5555555-5", phone: "0300-3333335", address: "654 DHA Phase 5, Lahore", emergency_contact: "0300-9999995" },
  ];

  const now = new Date().toISOString();
  for (const p of patients) {
    db.run(
      `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.patient_id, p.full_name, p.dob, p.gender, p.cnic, p.phone, p.address, p.emergency_contact, now, now]
    );
  }

  console.log("✅ 5 sample patients created");

  // ── 4. Medicines ──
  const medicines = [
    { name: "Panadol 500mg", batch_number: "BATCH-001", quantity: 500, unit_cost: 2.5, expiry_date: "2027-12-31", reorder_threshold: 50, expiry_alert_days: 90 },
    { name: "Brufen 400mg", batch_number: "BATCH-002", quantity: 300, unit_cost: 5.0, expiry_date: "2027-06-30", reorder_threshold: 30, expiry_alert_days: 60 },
    { name: "Amoxil 250mg", batch_number: "BATCH-003", quantity: 200, unit_cost: 12.0, expiry_date: "2027-03-15", reorder_threshold: 20, expiry_alert_days: 45 },
    { name: "Ciproxin 500mg", batch_number: "BATCH-004", quantity: 150, unit_cost: 18.0, expiry_date: "2027-09-01", reorder_threshold: 15, expiry_alert_days: 60 },
    { name: "Zantac 150mg", batch_number: "BATCH-005", quantity: 400, unit_cost: 8.0, expiry_date: "2028-01-15", reorder_threshold: 40, expiry_alert_days: 90 },
    { name: "Ventolin Inhaler", batch_number: "BATCH-006", quantity: 60, unit_cost: 250.0, expiry_date: "2027-11-30", reorder_threshold: 10, expiry_alert_days: 30 },
    { name: "Glucophage 500mg", batch_number: "BATCH-007", quantity: 250, unit_cost: 6.0, expiry_date: "2027-08-20", reorder_threshold: 25, expiry_alert_days: 45 },
    { name: "Norvasc 5mg", batch_number: "BATCH-008", quantity: 180, unit_cost: 15.0, expiry_date: "2027-10-10", reorder_threshold: 20, expiry_alert_days: 60 },
    { name: "Augmentin 625mg", batch_number: "BATCH-009", quantity: 120, unit_cost: 35.0, expiry_date: "2027-04-05", reorder_threshold: 10, expiry_alert_days: 30 },
    { name: "Cough Syrup 120ml", batch_number: "BATCH-010", quantity: 80, unit_cost: 45.0, expiry_date: "2027-05-25", reorder_threshold: 10, expiry_alert_days: 30 },
  ];

  for (const m of medicines) {
    db.run(
      `INSERT INTO medicines (name, batch_number, quantity, unit_cost, expiry_date, reorder_threshold, expiry_alert_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.name, m.batch_number, m.quantity, m.unit_cost, m.expiry_date, m.reorder_threshold, m.expiry_alert_days, now, now]
    );
  }

  console.log("✅ 10 sample medicines created");

  // ── 5. Sample Appointments ──
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  db.run(
    `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    [1, 1, tomorrowStr, "09:00", "09:30", now, now]
  );
  db.run(
    `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    [2, 2, tomorrowStr, "10:00", "10:30", now, now]
  );
  db.run(
    `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    [3, 2, tomorrowStr, "10:30", "11:00", now, now]
  );

  console.log(`✅ 3 sample appointments created for ${tomorrowStr}`);

  closeDb();
  console.log("\n🎉 Database seeded successfully!");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
