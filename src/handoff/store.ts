// Callback request persistence — callback_requests table operations.
//
// Privacy + dedupe design:
//  - Only the minimum PHI is stored: phone (needed to make the call) and an
//    optional short free-text reason. No name, no CNIC, no patient linkage.
//  - Duplicate submissions are idempotent: one pending request per phone
//    (atomic via the partial unique index) and one per session (checked first
//    for a friendly reply). A request that has been contacted/closed frees
//    the phone so a NEW request can be made later.
//  - Phone numbers are masked wherever they leave the system for display
//    (admin queue list); the full number is only returned by the admin
//    detail endpoint for the operational act of calling back.

import { getDb } from '../db';

export type CallbackStatus = 'pending' | 'contacted' | 'closed';
export const CALLBACK_STATUSES: CallbackStatus[] = ['pending', 'contacted', 'closed'];

export interface CallbackRequest {
  id: number;
  session_id: string | null;
  channel: string;
  language: 'en' | 'ur';
  phone: string;
  reason: string | null;
  status: CallbackStatus;
  created_at: string;
  updated_at: string;
}

/** Mirrors the registration phone convention: 03XX-XXXXXXX (Pakistani mobile). */
export function isValidPhone(phone: string): boolean {
  return /^03\d{2}-?\d{7}$/.test(phone.trim().replace(/\s/g, ''));
}

export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[-\s]/g, '');
}

/** Display-safe phone: keeps prefix + last 4 digits only (0300****4567). */
export function maskPhone(phone: string): string {
  const p = normalizePhone(phone);
  if (p.length < 8) return '*'.repeat(Math.min(p.length, 4)) + p.slice(-4);
  return `${p.slice(0, 4)}****${p.slice(-4)}`;
}

export interface CreateCallbackInput {
  session_id: string | null;
  channel: string;
  language: 'en' | 'ur';
  phone: string;
  reason: string | null;
}

/**
 * Inserts a callback request, idempotently. Returns the existing pending
 * request (duplicate: true) instead of inserting a second row when the same
 * session or the same phone already has a pending request. Never throws on a
 * duplicate — the partial unique index on pending phone is the backstop for
 * concurrent submissions.
 */
export function createCallbackRequest(input: CreateCallbackInput): { request: CallbackRequest; duplicate: boolean } {
  const db = getDb();
  const phone = normalizePhone(input.phone);
  const reason = (input.reason || '').trim().slice(0, 200) || null;

  // Friendly same-session dedupe: one pending request per conversation.
  if (input.session_id) {
    const existing = db.query(
      "SELECT * FROM callback_requests WHERE session_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
    ).get(input.session_id) as CallbackRequest | undefined;
    if (existing) return { request: existing, duplicate: true };
  }

  try {
    const result = db.run(
      `INSERT INTO callback_requests (session_id, channel, language, phone, reason, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [input.session_id || null, input.channel || 'chat', input.language, phone, reason]
    );
    const created = db.query('SELECT * FROM callback_requests WHERE id = ?').get(Number(result.lastInsertRowid)) as CallbackRequest;
    return { request: created, duplicate: false };
  } catch (err) {
    // Unique index on (phone) WHERE status='pending' — same phone raced in first.
    if (String(err).toLowerCase().includes('unique')) {
      const existing = db.query(
        "SELECT * FROM callback_requests WHERE phone = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
      ).get(phone) as CallbackRequest | undefined;
      if (existing) return { request: existing, duplicate: true };
    }
    throw err;
  }
}

export function getCallbackRequest(id: number): CallbackRequest | undefined {
  const db = getDb();
  return db.query('SELECT * FROM callback_requests WHERE id = ?').get(id) as CallbackRequest | undefined;
}

export function listCallbackRequests(opts: { status?: string; limit?: number } = {}): CallbackRequest[] {
  const db = getDb();
  const params: string[] = [];
  let sql = 'SELECT * FROM callback_requests WHERE 1=1';
  if (opts.status && (CALLBACK_STATUSES as string[]).includes(opts.status)) {
    sql += ' AND status = ?';
    params.push(opts.status);
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 200);
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(String(limit));
  return db.query(sql).all(...params) as CallbackRequest[];
}

// Only forward transitions are allowed — no going backwards from contacted/closed.
const ALLOWED_TRANSITIONS: Record<CallbackStatus, CallbackStatus[]> = {
  pending: ['contacted', 'closed'],
  contacted: ['closed'],
  closed: [],
};

export type UpdateResult = { ok: true; request: CallbackRequest } | { ok: false; error: string };

/**
 * Transitions a request to a new status. Returns { ok:false, error } for
 * unknown ids, invalid statuses, or illegal backward transitions.
 */
export function updateCallbackStatus(id: number, to: string): UpdateResult {
  const db = getDb();
  const row = getCallbackRequest(id);
  if (!row) return { ok: false, error: 'Callback request not found' };
  if (!(CALLBACK_STATUSES as string[]).includes(to)) return { ok: false, error: `Invalid status. Must be one of: ${CALLBACK_STATUSES.join(', ')}` };
  const allowed = ALLOWED_TRANSITIONS[row.status];
  if (!allowed.includes(to as CallbackStatus)) {
    return { ok: false, error: `Invalid status transition from '${row.status}' to '${to}'` };
  }
  db.run("UPDATE callback_requests SET status = ?, updated_at = datetime('now') WHERE id = ?", [to, id]);
  return { ok: true, request: getCallbackRequest(id)! };
}

/** Pending-request count (used by analytics; no PHI leaves here). */
export function countPendingCallbacks(): number {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as c FROM callback_requests WHERE status = 'pending'").get() as { c: number };
  return Number(row?.c || 0);
}
