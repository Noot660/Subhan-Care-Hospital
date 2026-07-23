import { getDb } from "../db";
import { hashPassword, verifyPassword, createSession, invalidateSession, extractToken, validateSession } from "../middleware/auth";
import { json, error, parseBody } from "../middleware/http";
import type { Staff } from "../types";

export async function handleAuthLogin(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{ username: string; password: string }>(request);
    if (!body.username || !body.password) {
      return error("Username and password are required", 400);
    }
    const db = getDb();
    const staff = db.query("SELECT * FROM staff WHERE username = ? AND status = 'active'").get(body.username) as Staff | undefined;
    if (!staff) return error("Invalid credentials", 401);
    const valid = await verifyPassword(body.password, staff.password_hash);
    if (!valid) return error("Invalid credentials", 401);
    const session = createSession({ id: staff.id, role: staff.role, username: staff.username, name: staff.name });
    return json({
      token: session.token,
      user: { id: staff.id, name: staff.name, role: staff.role, username: staff.username, phone: staff.phone, email: staff.email },
      expires_at: session.expires_at,
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : "Bad request", 400);
  }
}

export async function handleAuthLogout(request: Request): Promise<Response> {
  const token = extractToken(request);
  if (token) invalidateSession(token);
  return json({ message: "Logged out successfully" });
}

export async function handleAuthMe(request: Request): Promise<Response> {
  const token = extractToken(request);
  if (!token) return error("Unauthorized", 401);
  const session = validateSession(token);
  if (!session) return error("Invalid or expired session", 401);
  return json({ user: { id: session.staff_id, name: session.name, role: session.role, username: session.username } });
}
