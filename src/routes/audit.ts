import { getDb } from '../db';
import { json, error } from '../middleware/http';

const safeAction = /^[a-zA-Z0-9_.:-]{1,64}$/;
export function handleAudit(request: Request): Response {
  if (request.method !== 'GET') return error('Method not allowed', 405);
  const url = new URL(request.url); const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page') || 1)));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 25))); const offset = (page - 1) * limit;
  const action = url.searchParams.get('action'); const entity = url.searchParams.get('event'); const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
  const where: string[] = []; const args: (string|number)[] = [];
  if (action && safeAction.test(action)) { where.push('a.action = ?'); args.push(action); }
  if (entity && safeAction.test(entity)) { where.push('a.entity_type = ?'); args.push(entity); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('a.created_at >= ?'); args.push(from); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('a.created_at < datetime(?, \'+1 day\')'); args.push(to); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''; const db = getDb();
  const total = (db.query(`SELECT COUNT(*) as count FROM audit_logs a ${clause}`).get(...args) as {count:number}).count;
  const rows = db.query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, CASE WHEN a.user_id > 0 THEN 'staff-' || a.user_id ELSE 'anonymous' END AS user_ref FROM audit_logs a ${clause} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Record<string, unknown>[];
  return json({ logs: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}
