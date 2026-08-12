// Callback queue endpoints — admin only (RBAC module "callbacks").
//
// Privacy rules:
//  - The LIST endpoint masks phone numbers (0300****4567) — never the full
//    number in any list/analytics surface.
//  - The DETAIL endpoint returns the full number for the operational act of
//    calling the patient back (admin only).
//  - Status updates emit a redacted ai_event (callback_status_updated) with
//    the callback id + target status only — no phone, no free text.

import { json, error, parseBody, matchPath } from '../middleware/http';
import { auditLog } from '../middleware/audit';
import { extractToken, validateSession } from '../middleware/auth';
import {
  listCallbackRequests,
  getCallbackRequest,
  updateCallbackStatus,
  maskPhone,
  type CallbackRequest,
} from '../handoff/store';
import { getDb } from '../db';

// Queue view — phone is ALWAYS masked in list responses.
function toQueueView(row: CallbackRequest): Record<string, unknown> {
  return {
    id: row.id,
    channel: row.channel,
    language: row.language,
    phone_masked: maskPhone(row.phone),
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/callbacks?status=pending|contacted|closed&limit=N — pending by default.
function handleList(url: URL): Response {
  const status = (url.searchParams.get('status') || 'pending').trim();
  const rawLimit = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  const requests = listCallbackRequests({ status, limit });
  return json({ requests: requests.map(toQueueView), count: requests.length, status });
}

// GET /api/callbacks/:id — full phone for the operational callback (admin only).
function handleGet(id: string): Response {
  const row = getCallbackRequest(Number(id));
  if (!row) return error('Callback request not found', 404);
  return json({
    id: row.id,
    session_id: row.session_id,
    channel: row.channel,
    language: row.language,
    phone: row.phone, // full number — admin operational access only
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

// PATCH /api/callbacks/:id/status — body { status: "contacted" | "closed" }.
async function handleStatusUpdate(request: Request, id: string, sessionUser: number): Promise<Response> {
  try {
    const body = await parseBody<{ status?: string }>(request);
    if (!body.status || typeof body.status !== 'string') return error('Missing required field: status', 400);

    const result = updateCallbackStatus(Number(id), body.status.trim().toLowerCase());
    if (!result.ok) return error(result.error, 400);

    auditLog({
      user_id: sessionUser,
      action: 'update',
      entity_type: 'callback_request',
      entity_id: id,
      details: { id: Number(id), to_status: result.request.status },
    });

    // Redacted AI event metadata for the ops feed — no phone, no reason text.
    const db = getDb();
    db.run(
      `INSERT INTO ai_events (session_id, channel, event_type, details) VALUES (?, ?, ?, ?)`,
      [null, 'staff', 'callback_status_updated', JSON.stringify({ callback_id: Number(id), to_status: result.request.status })]
    );

    return json(toQueueView(result.request));
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

export async function handleCallbacks(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Session user id for audit logging (index.ts has already enforced RBAC: admin only).
  const token = extractToken(request);
  const session = validateSession(token || '');
  const sessionUser = session ? session.user_id : 0;

  const statusMatch = matchPath('/api/callbacks/:id/status', pathname);
  if (statusMatch && request.method === 'PATCH') return handleStatusUpdate(request, statusMatch.id, sessionUser);

  const idMatch = matchPath('/api/callbacks/:id', pathname);
  if (idMatch && request.method === 'GET') return handleGet(idMatch.id);

  if (pathname === '/api/callbacks' && request.method === 'GET') return handleList(url);

  return error('Not found', 404);
}
