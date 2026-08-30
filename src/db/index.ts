import { Database } from "bun:sqlite";
import { join } from "node:path";

const DB_PATH = join(import.meta.dir, "..", "..", "data", "hms.db");

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    // Ensure data directory exists
    const { mkdirSync } = require("node:fs");
    const dataDir = join(import.meta.dir, "..", "..", "data");
    mkdirSync(dataDir, { recursive: true });

    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      dob TEXT NOT NULL,
      gender TEXT NOT NULL,
      cnic TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      emergency_contact TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      specialization TEXT NOT NULL,
      qualification TEXT NOT NULL,
      cnic TEXT NOT NULL,
      phone TEXT NOT NULL,
      fee REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','doctor','receptionist','pharmacist','billing','management')),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','checked-in','completed','no-show','cancelled')),
      cancellation_reason TEXT,
      source TEXT NOT NULL DEFAULT 'staff' CHECK(source IN ('staff','chat','voice','twilio')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      diagnosis TEXT NOT NULL DEFAULT '',
      vitals TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized','dispensed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (consultation_id) REFERENCES consultations(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE TABLE IF NOT EXISTS prescription_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      duration TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL,
      expiry_date TEXT NOT NULL,
      reorder_threshold INTEGER NOT NULL DEFAULT 10,
      expiry_alert_days INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('add','dispense','adjust')),
      quantity_change INTEGER NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id),
      FOREIGN KEY (user_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized','paid','partially_paid','cancelled')),
      subtotal REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('consultation','medicine','supplementary')),
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      reference TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS credit_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS callback_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      channel TEXT NOT NULL DEFAULT 'chat',
      language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','ur')),
      phone TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacted','closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patient_demographic_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      changed_by INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS doctor_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      requested_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      rejection_reason TEXT,
      resolved_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id),
      FOREIGN KEY (requested_by) REFERENCES staff(id),
      FOREIGN KEY (resolved_by) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS otp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS procedures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS appointment_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'failed')),
      message TEXT NOT NULL,
      attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
  `);

  // Only one PENDING request per phone — idempotent callback submissions.
  // Contacted/closed rows free the phone so a NEW request can be made later.
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS callback_requests_active_phone_unique ON callback_requests(phone) WHERE status = 'pending'`);
  // Admin queue reads filter by status + recency.
  database.exec(`CREATE INDEX IF NOT EXISTS callback_requests_status_idx ON callback_requests(status, created_at)`);
  // Same-session dedupe lookup.
  database.exec(`CREATE INDEX IF NOT EXISTS callback_requests_session_idx ON callback_requests(session_id)`);

  // Only active appointments participate in uniqueness; cancelled/no-show slots can be reused.
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_unique ON appointments(doctor_id, date, start_time) WHERE status IN ('scheduled', 'checked-in', 'completed')`);
  // Single reminder per appointment — the unique index is the database-level
  // guard that backs the application-level check in findDueAppointments().
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS appointment_reminders_appointment_unique ON appointment_reminders(appointment_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS appointment_reminders_status_idx ON appointment_reminders(status)`);

  // ── Migrations (safe for pre-existing databases) ──
  // M1: appointments.source — added later; existing DBs lack the column.
  const appointmentCols = database.query("PRAGMA table_info(appointments)").all() as Array<{ name: string }>;
  if (!appointmentCols.some((c) => c.name === "source")) {
    database.exec("ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'");
  }

  // M2: sessions.last_active_at column migration
  const sessionCols = database.query("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === "last_active_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN last_active_at TEXT NOT NULL DEFAULT '2026-08-19T00:00:00.000Z'");
  }

  // Seed default procedures
  const proceduresCount = (database.query("SELECT COUNT(*) as c FROM procedures").get() as { c: number } | undefined)?.c ?? 0;
  if (proceduresCount === 0) {
    database.run("INSERT INTO procedures (name, price) VALUES ('X-Ray', 1500.0)");
    database.run("INSERT INTO procedures (name, price) VALUES ('Complete Blood Count (CBC)', 800.0)");
    database.run("INSERT INTO procedures (name, price) VALUES ('Procedural Dressing', 500.0)");
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
