import type { Session, Role } from "../types";
import { getDb } from "../db";

// Basic credentials for login request
export interface LoginBody {
  username: string;
  password: string;
}

// Extracted from auth header / token
export interface AuthContext {
  session: Session;
}

// Hash password using Bun's built-in bcrypt
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  });
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// Generate a random session token
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Create session in DB
export function createSession(staff: {
  id: number;
  role: string;
  username: string;
  name: string;
}): Session {
  const db = getDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  db.run(
    `INSERT INTO sessions (token, user_id, staff_id, role, username, name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token, staff.id, staff.id, staff.role, staff.username, staff.name, expiresAt]
  );

  return {
    token,
    user_id: staff.id,
    staff_id: staff.id,
    role: staff.role,
    username: staff.username,
    name: staff.name,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  };
}

// Validate session from token
export function validateSession(token: string): Session | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT token, user_id, staff_id, role, username, name, created_at, expires_at
       FROM sessions WHERE token = ?`
    )
    .get(token) as Session | undefined;

  if (!row) return null;

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    db.run("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }

  return row;
}

// Invalidate session
export function invalidateSession(token: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE token = ?", [token]);
}

// Extract Bearer token from request
export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;

  return parts[1];
}

// RBAC permissions matrix from SRS Section 5
// F = Full access, R = Read-only, L = List only, '-' = No access
const RBAC_MATRIX: Record<string, Record<Role, "F" | "R" | "L" | "-">> = {
  patients: {
    admin: "F",
    doctor: "R",
    receptionist: "F",
    pharmacist: "R",
    billing: "R",
    management: "R",
  },
  doctors: {
    admin: "F",
    doctor: "R",
    receptionist: "R",
    pharmacist: "-",
    billing: "-",
    management: "R",
  },
  appointments: {
    admin: "F",
    doctor: "R",
    receptionist: "F",
    pharmacist: "-",
    billing: "-",
    management: "R",
  },
  consultations: {
    admin: "R",
    doctor: "F",
    receptionist: "-",
    pharmacist: "R",
    billing: "-",
    management: "-",
  },
  pharmacy: {
    admin: "F",
    doctor: "-",
    receptionist: "-",
    pharmacist: "F",
    billing: "-",
    management: "R",
  },
  billing: {
    admin: "F",
    doctor: "-",
    receptionist: "-",
    pharmacist: "-",
    billing: "F",
    management: "R",
  },
  reports: {
    admin: "F",
    doctor: "-",
    receptionist: "-",
    pharmacist: "-",
    billing: "R",
    management: "R",
  },
  users: {
    admin: "F",
    doctor: "-",
    receptionist: "-",
    pharmacist: "-",
    billing: "-",
    management: "-",
  },
  audit: {
    admin: "R",
    doctor: "-",
    receptionist: "-",
    pharmacist: "-",
    billing: "-",
    management: "-",
  },
};

// Map HTTP methods to required permission level
function methodToLevel(method: string): "F" | "R" | "L" {
  switch (method) {
    case "GET":
      return "R";
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
      return "F";
    default:
      return "R";
  }
}

// Check if a role has permission for a module
export function hasPermission(role: Role, module: string, method: string): boolean {
  const modulePerms = RBAC_MATRIX[module];
  if (!modulePerms) return false;

  const access = modulePerms[role];
  if (!access || access === "-") return false;

  const requiredLevel = methodToLevel(method);
  if (requiredLevel === "F" && access !== "F") return false;
  if (requiredLevel === "R" && access === "L") return false;
  // "L" means they can only list, not get individual. For simplicity, we treat GET with "L" as allowed
  // since listing is GET-based.

  return true;
}

// Determine which module an endpoint belongs to
export function getModuleFromPath(pathname: string): string | null {
  if (pathname.startsWith("/api/auth")) return "users"; // auth is like user access
  if (pathname.startsWith("/api/patients")) return "patients";
  if (pathname.startsWith("/api/doctors")) return "doctors";
  if (pathname.startsWith("/api/appointments")) return "appointments";
  if (pathname.startsWith("/api/consultations")) return "consultations";
  if (pathname.startsWith("/api/prescriptions")) return "consultations";
  if (pathname.startsWith("/api/medicines") || pathname.startsWith("/api/pharmacy")) return "pharmacy";
  if (pathname.startsWith("/api/invoices") || pathname.startsWith("/api/payments")) return "billing";
  if (pathname.startsWith("/api/reports")) return "reports";
  if (pathname.startsWith("/api/staff") || pathname.startsWith("/api/users")) return "users";
  if (pathname.startsWith("/api/audit")) return "audit";
  return null;
}
