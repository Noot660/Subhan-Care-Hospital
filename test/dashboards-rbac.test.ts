import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { getDb } from "../src/db";
import { handleRequest } from "../src/index";
import { handleAuthLogin } from "../src/routes/auth";

// ─────────────────────────────────────────────────────────────
// Dashboard RBAC tests (SRS §5 matrix) for the role-specific
// dashboards. Verifies each role can read exactly the modules it
// is allowed to see, and is denied (403) everything else —
// including the role-scoped `/api/reports` catalogue newly wired
// for billing/management (read-only) and the pharmacy alerts
// endpoint used by the pharmacist dashboard.
// ─────────────────────────────────────────────────────────────

const MGMT_USER = "mgmt_dash_test";
const MGMT_PASS = "mgmt123";

async function login(username: string, password: string): Promise<string> {
  const res = await handleAuthLogin(
    new Request("http://test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function get(path: string, token: string): Promise<Response> {
  return handleRequest(
    new Request("http://test" + path, {
      headers: { Authorization: `Bearer ${token}` },
    })
  );
}

describe("Role-specific dashboard RBAC (SRS §5)", () => {
  let adminToken: string;
  let billingToken: string;
  let pharmacistToken: string;
  let receptionistToken: string;
  let mgmtToken: string;

  beforeAll(async () => {
    const db = getDb();
    // Seed users (admin, billing, pharmacist, receptionist) are normally present.
    // Create the management dashboard user deterministically (idempotent).
    db.run("DELETE FROM staff WHERE username = ?", [MGMT_USER]);
    const hash = await Bun.password.hash(MGMT_PASS, { algorithm: "bcrypt", cost: 4 });
    db.run(
      `INSERT INTO staff (name, role, username, password_hash, phone, email, status)
       VALUES (?, 'management', ?, ?, '0000-0000000', ?, 'active')`,
      ["Mgmt Dash User", MGMT_USER, hash, MGMT_USER + "@subhancare.pk"]
    );

    adminToken = await login("admin", "admin123");
    billingToken = await login("billing", "staff123");
    pharmacistToken = await login("pharmacist", "staff123");
    receptionistToken = await login("receptionist", "staff123");
    mgmtToken = await login(MGMT_USER, MGMT_PASS);
  });

  afterAll(() => {
    const db = getDb();
    db.run("DELETE FROM staff WHERE username = ?", [MGMT_USER]);
  });

  describe("Role-scoped /api/reports (reports module: admin=F, billing=R, management=R)", () => {
    test("billing can read the outstanding-dues report (200)", async () => {
      const res = await get("/api/reports/outstanding-dues", billingToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });

    test("management can read the report catalogue and a report (200)", async () => {
      const cat = await get("/api/reports", mgmtToken);
      expect(cat.status).toBe(200);
      const body = (await cat.json()) as { reports: { type: string }[] };
      expect(body.reports.some((r) => r.type === "outstanding-dues")).toBe(true);

      const rep = await get("/api/reports/inventory-status", mgmtToken);
      expect(rep.status).toBe(200);
    });

    test("pharmacist is denied the reports module (403)", async () => {
      const res = await get("/api/reports/outstanding-dues", pharmacistToken);
      expect(res.status).toBe(403);
    });

    test("receptionist is denied the reports catalogue (403)", async () => {
      const res = await get("/api/reports", receptionistToken);
      expect(res.status).toBe(403);
    });

    test("billing can export a report as CSV (200, text/csv)", async () => {
      const res = await get("/api/reports/daily-collections/export?format=csv", billingToken);
      expect(res.status).toBe(200);
      expect((res.headers.get("content-type") || "").toLowerCase()).toContain("text/csv");
    });

    test("pharmacist cannot export a report (403)", async () => {
      const res = await get("/api/reports/outstanding-dues/export?format=csv", pharmacistToken);
      expect(res.status).toBe(403);
    });
  });

  describe("Admin-only analytics module stays gated (management cannot bypass via reports)", () => {
    test("management is denied /api/analytics/overview (403)", async () => {
      const res = await get("/api/analytics/overview?period=today", mgmtToken);
      expect(res.status).toBe(403);
    });

    test("admin can read analytics overview (200)", async () => {
      const res = await get("/api/analytics/overview?period=today", adminToken);
      expect(res.status).toBe(200);
    });
  });

  describe("Dashboard data parity — each role reads only its modules", () => {
    test("pharmacist dashboard: pharmacy alerts (low_stock + near_expiry) readable", async () => {
      const res = await get("/api/pharmacy/alerts", pharmacistToken);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { low_stock: unknown[]; near_expiry: unknown[] };
      expect(Array.isArray(body.low_stock)).toBe(true);
      expect(Array.isArray(body.near_expiry)).toBe(true);
    });

    test("billing dashboard: financial summary readable, pharmacy alerts denied", async () => {
      const summary = await get("/api/billing/summary?period=today", billingToken);
      expect(summary.status).toBe(200);
      const alerts = await get("/api/pharmacy/alerts", billingToken);
      expect(alerts.status).toBe(403);
    });

    test("pharmacist is denied the billing financial summary (403)", async () => {
      const res = await get("/api/billing/summary?period=today", pharmacistToken);
      expect(res.status).toBe(403);
    });

    test("doctor read view: can list patients & appointments (R)", async () => {
      const doctorToken = await login("dr.ahmed", "doctor123");
      expect((await get("/api/patients", doctorToken)).status).toBe(200);
      expect((await get("/api/appointments", doctorToken)).status).toBe(200);
      // doctor has no billing access
      expect((await get("/api/billing/summary?period=today", doctorToken)).status).toBe(403);
    });

    test("receptionist: appointments read & write (F), but staff module denied", async () => {
      expect((await get("/api/appointments", receptionistToken)).status).toBe(200);
      expect((await get("/api/staff", receptionistToken)).status).toBe(403);
      // receptionist (F on patients) can read patients
      expect((await get("/api/patients", receptionistToken)).status).toBe(200);
    });

    test("admin has full access to reports, analytics, staff (200)", async () => {
      expect((await get("/api/reports/outstanding-dues", adminToken)).status).toBe(200);
      expect((await get("/api/analytics/overview?period=today", adminToken)).status).toBe(200);
      expect((await get("/api/staff", adminToken)).status).toBe(200);
    });
  });
});
