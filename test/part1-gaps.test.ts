import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { getDb } from "../src/db";
import { handleRequest } from "../src/index";

describe("Part 1 Gaps - Patient & Doctor Features", () => {
  let adminToken: string;
  let doctorToken: string;
  let patientId: number;
  let doctorId: number;
  let doctorStaffId: number;
  let adminStaffId: number;

  beforeAll(async () => {
    const db = getDb();

    // Clean up any stale records from previous failed runs
    db.run("DELETE FROM patient_demographic_history");
    db.run("DELETE FROM doctor_change_requests");
    db.run("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%'))");
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%'))");
    db.run("DELETE FROM invoices WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%')");
    db.run("DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%'))");
    db.run("DELETE FROM prescriptions WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%')");
    db.run("DELETE FROM consultations WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%')");
    db.run("DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE full_name LIKE 'Test Patient%')");
    db.run("DELETE FROM doctor_schedules WHERE doctor_id IN (SELECT id FROM doctors WHERE name LIKE 'Doctor_%')");
    db.run("DELETE FROM doctors WHERE name LIKE 'Doctor_%'");
    db.run("DELETE FROM patients WHERE full_name LIKE 'Test Patient%'");
    db.run("DELETE FROM staff WHERE username LIKE 'admin_%' OR username LIKE 'dr_%'");

    // 1. Create unique test admin and doctor users
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const adminHash = await Bun.password.hash("admin123", { algorithm: "bcrypt", cost: 4 });
    const doctorHash = await Bun.password.hash("doctor123", { algorithm: "bcrypt", cost: 4 });

    const adminResult = db.query(
      `INSERT INTO staff (name, role, username, password_hash, phone, email, status)
       VALUES (?, 'admin', ?, ?, ?, ?, 'active') RETURNING id`
    ).get(`Admin_${suffix}`, `admin_${suffix}`, adminHash, `0300_${suffix}_1`, `admin_${suffix}@test.com`) as { id: number };
    adminStaffId = adminResult.id;

    const docStaffResult = db.query(
      `INSERT INTO staff (name, role, username, password_hash, phone, email, status)
       VALUES (?, 'doctor', ?, ?, ?, ?, 'active') RETURNING id`
    ).get(`Doctor_${suffix}`, `dr_${suffix}`, doctorHash, `0300_${suffix}_2`, `dr_${suffix}@test.com`) as { id: number };
    doctorStaffId = docStaffResult.id;

    // Create doctor profile linked by phone
    const docResult = db.query(
      `INSERT INTO doctors (name, specialization, qualification, cnic, phone, fee, status)
       VALUES (?, 'General', 'MBBS', ?, ?, 1000, 'active') RETURNING id`
    ).get(`Doctor_${suffix}`, `cnic_${suffix}`, `0300_${suffix}_2`) as { id: number };
    doctorId = docResult.id;

    // Create a test patient
    const patResult = db.query(
      `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, status)
       VALUES (?, 'Test Patient', '1990-01-01', 'Male', ?, ?, 'Old Address', '0300-0000000', 'active') RETURNING id`
    ).get(`SC-PT-${suffix.slice(0,6).toUpperCase()}`, `cnic_pat_${suffix}`, `0300_${suffix}_3`) as { id: number };
    patientId = patResult.id;

    // 2. Login to get tokens
    const adminLoginRes = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `admin_${suffix}`, password: "admin123" })
    }));
    adminToken = (await adminLoginRes.json() as any).token;

    const doctorLoginRes = await handleRequest(new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `dr_${suffix}`, password: "doctor123" })
    }));
    doctorToken = (await doctorLoginRes.json() as any).token;
  });

  afterAll(() => {
    const db = getDb();
    // Delete dependent transactional records
    db.run("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id = ?)", [patientId]);
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id = ?)", [patientId]);
    db.run("DELETE FROM invoices WHERE patient_id = ?", [patientId]);
    db.run("DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE patient_id = ?)", [patientId]);
    db.run("DELETE FROM prescriptions WHERE patient_id = ?", [patientId]);
    db.run("DELETE FROM consultations WHERE patient_id = ?", [patientId]);
    db.run("DELETE FROM appointments WHERE patient_id = ?", [patientId]);

    // Delete logs and change requests
    db.run("DELETE FROM patient_demographic_history WHERE patient_id = ?", [patientId]);
    db.run("DELETE FROM doctor_change_requests WHERE doctor_id = ?", [doctorId]);

    // Delete doctor schedule, doctor profile, patient profile
    db.run("DELETE FROM doctor_schedules WHERE doctor_id = ?", [doctorId]);
    db.run("DELETE FROM doctors WHERE id = ?", [doctorId]);
    db.run("DELETE FROM patients WHERE id = ?", [patientId]);

    // Delete staff accounts
    db.run("DELETE FROM sessions WHERE user_id IN (?, ?)", [adminStaffId, doctorStaffId]);
    db.run("DELETE FROM staff WHERE id IN (?, ?)", [adminStaffId, doctorStaffId]);
  });

  test("1. Patient demographic change history tracking", async () => {
    const db = getDb();

    // Trigger update via API
    const updateRes = await handleRequest(new Request(`http://localhost:3000/api/patients/${patientId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        full_name: "Test Patient Updated",
        address: "New Address"
      })
    }));
    expect(updateRes.status).toBe(200);

    // Verify database patient_demographic_history rows
    const history = db.query("SELECT * FROM patient_demographic_history WHERE patient_id = ? ORDER BY field_name").all(patientId) as any[];
    expect(history.length).toBe(2);

    const addressChange = history.find((h) => h.field_name === "address");
    expect(addressChange).toBeDefined();
    expect(addressChange.old_value).toBe("Old Address");
    expect(addressChange.new_value).toBe("New Address");

    const nameChange = history.find((h) => h.field_name === "full_name");
    expect(nameChange).toBeDefined();
    expect(nameChange.old_value).toBe("Test Patient");
    expect(nameChange.new_value).toBe("Test Patient Updated");
  });

  test("2. Patient consolidated detailed profile profile", async () => {
    const db = getDb();

    // Setup dummy appointments, consultations, prescriptions, invoices and payments
    const apptResult = db.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status)
       VALUES (?, ?, '2026-08-20', '09:00', '09:30', 'completed')`,
      [patientId, doctorId]
    );
    const appointmentId = Number(apptResult.lastInsertRowid);

    const consultationResult = db.run(
      `INSERT INTO consultations (appointment_id, patient_id, doctor_id, diagnosis, notes)
       VALUES (?, ?, ?, 'Flu', 'Rest')`,
      [appointmentId, patientId, doctorId]
    );
    const consultationId = Number(consultationResult.lastInsertRowid);

    const prescriptionResult = db.run(
      `INSERT INTO prescriptions (consultation_id, patient_id, doctor_id, status)
       VALUES (?, ?, ?, 'finalized')`,
      [consultationId, patientId, doctorId]
    );
    const rxId = Number(prescriptionResult.lastInsertRowid);
    db.run(
      `INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration)
       VALUES (?, 'Panadol', '500mg', '1-0-1', '3 days')`,
      [rxId]
    );

    const invoiceResult = db.run(
      `INSERT INTO invoices (invoice_number, patient_id, total, status)
       VALUES (?, ?, 1500, 'partially_paid')`,
      [`INV-T-${patientId}`, patientId]
    );
    const invId = Number(invoiceResult.lastInsertRowid);
    db.run(
      `INSERT INTO invoice_items (invoice_id, description, type, quantity, unit_price, total)
       VALUES (?, 'Consultation', 'consultation', 1, 1500, 1500)`,
      [invId]
    );

    db.run(
      `INSERT INTO payments (invoice_id, amount, method)
       VALUES (?, 500, 'cash')`,
      [invId]
    );

    // Call GET API
    const getRes = await handleRequest(new Request(`http://localhost:3000/api/patients/${patientId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${adminToken}`
      }
    }));
    expect(getRes.status).toBe(200);
    const data = await getRes.json() as any;

    expect(data.full_name).toBe("Test Patient Updated");
    expect(data.prescriptions.length).toBe(1);
    expect(data.prescriptions[0].items.length).toBe(1);
    expect(data.prescriptions[0].items[0].medicine_name).toBe("Panadol");

    expect(data.invoices.length).toBe(1);
    expect(data.invoices[0].amount_paid).toBe(500);
    expect(data.invoices[0].items.length).toBe(1);

    expect(data.payments.length).toBe(1);
    expect(data.payments[0].amount).toBe(500);

    expect(data.outstanding_balance).toBe(1000); // 1500 total - 500 paid
  });

  test("3. Doctor schedule availability update", async () => {
    const newSchedule = [
      { day_of_week: 1, start_time: "09:00", end_time: "12:00" },
      { day_of_week: 3, start_time: "14:00", end_time: "17:00" }
    ];

    const putRes = await handleRequest(new Request(`http://localhost:3000/api/doctors/${doctorId}/schedule`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({ schedule: newSchedule })
    }));
    expect(putRes.status).toBe(200);
    const data = await putRes.json() as any;
    expect(data.schedule.length).toBe(2);
    expect(data.schedule[0].start_time).toBe("09:00");
    expect(data.schedule[1].day_of_week).toBe(3);
  });

  test("4. Doctor change request workflow", async () => {
    const db = getDb();

    // A. Doctor creates a change request
    const createRequestRes = await handleRequest(new Request("http://localhost:3000/api/doctors/change-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${doctorToken}`
      },
      body: JSON.stringify({
        fee: 2500,
        specialization: "Cardiology",
        schedule: [
          { day_of_week: 2, start_time: "10:00", end_time: "14:00" }
        ]
      })
    }));
    expect(createRequestRes.status).toBe(201);
    const reqData = await createRequestRes.json() as any;
    expect(reqData.doctor_id).toBe(doctorId);
    expect(reqData.status).toBe("pending");

    const requestId = reqData.id;

    // B. Doctor lists their own requests
    const listDocRes = await handleRequest(new Request("http://localhost:3000/api/doctors/change-requests", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${doctorToken}`
      }
    }));
    expect(listDocRes.status).toBe(200);
    const docRequests = await listDocRes.json() as any[];
    expect(docRequests.length).toBe(1);
    expect(docRequests[0].id).toBe(requestId);

    // C. Admin approves the request
    const approveRes = await handleRequest(new Request(`http://localhost:3000/api/doctors/change-requests/${requestId}/approve`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${adminToken}`
      }
    }));
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json() as any;
    expect(approveData.status).toBe("approved");

    // D. Verify doctor profile has updated
    const updatedDoc = db.query("SELECT * FROM doctors WHERE id = ?").get(doctorId) as any;
    expect(updatedDoc.fee).toBe(2500);
    expect(updatedDoc.specialization).toBe("Cardiology");

    const updatedSchedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ?").all(doctorId) as any[];
    expect(updatedSchedules.length).toBe(1);
    expect(updatedSchedules[0].day_of_week).toBe(2);
    expect(updatedSchedules[0].start_time).toBe("10:00");
  });
});
