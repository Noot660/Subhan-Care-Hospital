import { getDb, closeDb } from "./db";
import { corsResponse, error, json } from "./middleware/http";
import { extractToken, validateSession, getModuleFromPath, hasPermission } from "./middleware/auth";
import type { Role } from "./types";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";

// Route handlers
import { handleAuthLogin, handleAuthLogout, handleAuthMe } from "./routes/auth";
import { handlePatients } from "./routes/patients";
import { handleDoctors } from "./routes/doctors";
import { handleAppointments } from "./routes/appointments";
import { handleReceptionist } from "./routes/receptionist";
import { handleTwilio } from "./routes/twilio";
import { handlePharmacy } from "./routes/pharmacy";
import { handleBilling } from "./routes/billing";
import { handleConsultations } from "./routes/consultations";

// Whitelist of endpoints that don't require authentication
const PUBLIC_ENDPOINTS = [
  { method: "POST", path: "/api/auth/login" },
  { method: "GET", path: "/api/receptionist" },  // all receptionist endpoints are public
  { method: "POST", path: "/api/receptionist" }, // all receptionist endpoints are public
  { method: "GET", path: "/api/twilio" },  // twilio endpoints are public
  { method: "POST", path: "/api/twilio" }, // twilio endpoints are public
  { method: "OPTIONS", path: "" }, // CORS preflight
];

// Health check is always public
const HEALTH_PATH = "/api/health";

// ── Static File Serving ──
const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

const EXPLICIT_ROUTES: Record<string, string> = {
  "/": "chat.html",
  "/login": "login.html",
  "/dashboard": "dashboard.html",
  "/call": "call.html",
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serveStatic(pathname: string): Response | null {
  // Normalize: strip trailing slash (but not for root)
  let normalized = pathname;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Check explicit routes first
  if (EXPLICIT_ROUTES[normalized]) {
    const filePath = join(PUBLIC_DIR, EXPLICIT_ROUTES[normalized]);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      return new Response(content, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    return null;
  }

  // Serve from public/ directory for all other paths
  const filePath = join(PUBLIC_DIR, normalized.replace(/^\//, ""));
  if (!existsSync(filePath)) return null;

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) return null;

  const stat = statSync(filePath);
  if (stat.isDirectory()) return null;

  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  const content = readFileSync(filePath);
  return new Response(content, {
    headers: { "Content-Type": mimeType, "Cache-Control": "no-cache" },
  });
}

const PORT = 3000;

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return corsResponse();
  }

  // Health check
  if (pathname === HEALTH_PATH) {
    return json({ status: "ok", service: "Subhan Care HMS API", version: "1.0.0" });
  }

  // ── Static file serving (non-API routes) ──
  if (!pathname.startsWith("/api")) {
    const staticResponse = serveStatic(pathname);
    if (staticResponse) return staticResponse;

    // SPA fallback: serve chat.html for any unknown non-API path
    const fallbackPath = join(PUBLIC_DIR, "chat.html");
    if (existsSync(fallbackPath)) {
      const content = readFileSync(fallbackPath);
      return new Response(content, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    return error("Not found", 404);
  }

  // Check if endpoint is public (no auth required)
  const isPublic = PUBLIC_ENDPOINTS.some(
    (ep) => request.method === ep.method && (ep.path === "" || pathname.startsWith(ep.path))
  );

  let session = null;
  let token: string | null = null;

  if (!isPublic) {
    token = extractToken(request);
    if (!token) {
      return error("Unauthorized — missing authentication token", 401);
    }

    session = validateSession(token);
    if (!session) {
      return error("Unauthorized — invalid or expired session", 401);
    }

    // RBAC check — skip for auth routes and health
    if (!pathname.startsWith("/api/auth")) {
      const module = getModuleFromPath(pathname);
      if (module) {
        const allowed = hasPermission(session.role as Role, module, request.method);
        if (!allowed) {
          return error("Forbidden — insufficient permissions", 403);
        }
      }
    }
  }

  // ── Route dispatch ──

  // Auth routes
  if (pathname === "/api/auth/login" && request.method === "POST") {
    return handleAuthLogin(request);
  }
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return handleAuthLogout(request);
  }
  if (pathname === "/api/auth/me" && request.method === "GET") {
    return handleAuthMe(request);
  }

  // Patients
  if (pathname.startsWith("/api/patients")) {
    return handlePatients(request);
  }

  // Doctors
  if (pathname.startsWith("/api/doctors")) {
    return handleDoctors(request);
  }

  // Appointments
  if (pathname.startsWith("/api/appointments")) {
    return handleAppointments(request);
  }

  // Pharmacy (medicines, prescriptions) — RBAC module "pharmacy"
  if (pathname.startsWith("/api/pharmacy")) {
    return handlePharmacy(request);
  }

  // Billing (invoices, payments, summary, collections) — RBAC module "billing"
  if (pathname.startsWith("/api/billing") || pathname.startsWith("/api/invoices") || pathname.startsWith("/api/payments")) {
    return handleBilling(request);
  }

  // Consultations — RBAC module "consultations"
  if (pathname.startsWith("/api/consultations")) {
    return handleConsultations(request);
  }

  // AI Receptionist (public — no auth required)
  if (pathname.startsWith("/api/receptionist")) {
    return handleReceptionist(request);
  }

  // Twilio Voice Webhooks (public — no auth required)
  if (pathname.startsWith("/api/twilio")) {
    return handleTwilio(request);
  }

  // Catch-all 404
  return error("Not found", 404);
}

// Initialize database on startup
console.log("🗄️  Initializing database...");
getDb();
console.log("✅ Database ready");

// Start server
const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: handleRequest,
});

console.log(`🚀 Subhan Care HMS API running at http://0.0.0.0:${PORT}`);
console.log(`   Health check: http://0.0.0.0:${PORT}/api/health`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  closeDb();
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDb();
  server.stop();
  process.exit(0);
});
