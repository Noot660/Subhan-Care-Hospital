// Staff management endpoints — admin only (RBAC module "users")
// GET list (never exposes password_hash), POST create, PATCH update, POST deactivate.

import { getDb } from '../db';
import { json, error, parseBody, matchPath } from '../middleware/http';
import { extractToken, validateSession, hashPassword } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import type { Staff } from '../types';

const VALID_ROLES = ['admin', 'doctor', 'receptionist', 'pharmacist', 'billing', 'management'];
const VALID_STATUSES = ['active', 'inactive'];

// Strip sensitive fields before returning staff rows
function toPublicStaff(row: Staff) {
  const { password_hash: _ph, ...staff } = row;
  return staff;
}

// GET /api/staff — list all staff (password_hash never returned)
function handleListStaff(): Response {
  const db = getDb();
  const rows = db.query("SELECT * FROM staff ORDER BY id").all() as Staff[];
  return json(rows.map(toPublicStaff));
}

// POST /api/staff — create a new staff member
async function handleCreateStaff(request: Request, sessionUser: number): Promise<Response> {
  try {
    const body = await parseBody<{ name?: string; username?: string; password?: string; role?: string; phone?: string; email?: string }>(request);
    if (!body.name || !body.username || !body.password || !body.role) {
      return error("Missing required fields: name, username, password, role", 400);
    }
    if (!VALID_ROLES.includes(body.role)) {
      return error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400);
    }
    if (body.password.length < 6) {
      return error("Password must be at least 6 characters", 400);
    }

    const db = getDb();
    const existing = db.query("SELECT id FROM staff WHERE username = ?").get(body.username) as { id: number } | undefined;
    if (existing) return error(`Username '${body.username}' is already taken`, 409);

    const passwordHash = await hashPassword(body.password);
    const result = db.run(
      `INSERT INTO staff (name, role, username, password_hash, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [body.name.trim(), body.role, body.username.trim(), passwordHash, (body.phone || '').trim(), (body.email || '').trim()]
    );

    auditLog({
      user_id: sessionUser,
      action: 'create',
      entity_type: 'staff',
      entity_id: String(result.lastInsertRowid),
      details: { name: body.name, username: body.username, role: body.role },
    });

    const created = db.query("SELECT * FROM staff WHERE id = ?").get(Number(result.lastInsertRowid)) as Staff | undefined;
    return json(created ? toPublicStaff(created) : {}, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

// PATCH /api/staff/:id — update name/phone/email/role/status
async function handleUpdateStaff(request: Request, id: string, sessionUser: number): Promise<Response> {
  try {
    const db = getDb();
    const staff = db.query("SELECT * FROM staff WHERE id = ?").get(Number(id)) as Staff | undefined;
    if (!staff) return error('Staff member not found', 404);

    const body = await parseBody<{ name?: string; phone?: string; email?: string; role?: string; status?: string }>(request);
    if (Object.keys(body).length === 0) return error('No fields to update', 400);

    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) return error('name must be a non-empty string', 400);
      updates.push('name = ?'); params.push(body.name.trim());
    }
    if (body.phone !== undefined) {
      if (typeof body.phone !== 'string') return error('phone must be a string', 400);
      updates.push('phone = ?'); params.push(body.phone.trim());
    }
    if (body.email !== undefined) {
      if (typeof body.email !== 'string') return error('email must be a string', 400);
      updates.push('email = ?'); params.push(body.email.trim());
    }
    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role)) return error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400);
      if (Number(id) === sessionUser && body.role !== staff.role) {
        return error('Admins cannot change their own role', 400);
      }
      updates.push('role = ?'); params.push(body.role);
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) return error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
      if (Number(id) === sessionUser && body.status !== staff.status) {
        return error('Admins cannot deactivate their own account', 400);
      }
      updates.push('status = ?'); params.push(body.status);
    }

    if (updates.length === 0) return error('No valid fields to update', 400);

    params.push(Number(id));
    db.run(`UPDATE staff SET ${updates.join(', ')} WHERE id = ?`, params);

    auditLog({
      user_id: sessionUser,
      action: 'update',
      entity_type: 'staff',
      entity_id: id,
      details: { fields: Object.keys(body) },
    });

    const updated = db.query("SELECT * FROM staff WHERE id = ?").get(Number(id)) as Staff | undefined;
    return json(updated ? toPublicStaff(updated) : {});
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

// POST /api/staff/:id/deactivate
async function handleDeactivateStaff(id: string, sessionUser: number): Promise<Response> {
  const db = getDb();
  if (Number(id) === sessionUser) return error('Admins cannot deactivate their own account', 400);

  const staff = db.query("SELECT * FROM staff WHERE id = ?").get(Number(id)) as Staff | undefined;
  if (!staff) return error('Staff member not found', 404);
  if (staff.status === 'inactive') return json({ message: 'Staff member is already inactive', staff: toPublicStaff(staff) });

  db.run("UPDATE staff SET status = 'inactive' WHERE id = ?", [Number(id)]);
  auditLog({ user_id: sessionUser, action: 'deactivate', entity_type: 'staff', entity_id: id, details: { username: staff.username } });

  const updated = db.query("SELECT * FROM staff WHERE id = ?").get(Number(id)) as Staff | undefined;
  return json(updated ? toPublicStaff(updated) : {});
}

export async function handleStaff(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const token = extractToken(request);
  const session = validateSession(token || '');
  const sessionUser = session ? session.user_id : 0;

  const deactivateMatch = matchPath('/api/staff/:id/deactivate', pathname);
  if (deactivateMatch && request.method === 'POST') return handleDeactivateStaff(deactivateMatch.id, sessionUser);

  const idMatch = matchPath('/api/staff/:id', pathname);
  if (idMatch && request.method === 'PATCH') return handleUpdateStaff(request, idMatch.id, sessionUser);

  if (pathname === '/api/staff' && request.method === 'GET') return handleListStaff();
  if (pathname === '/api/staff' && request.method === 'POST') return handleCreateStaff(request, sessionUser);

  return error('Not found', 404);
}
