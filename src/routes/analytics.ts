// Analytics + AI operations endpoints — admin only (RBAC module "analytics")
// Overview KPIs, AI event feed, and appointment source (channel) breakdown.

import { getDb } from '../db';
import { json, error } from '../middleware/http';

const VALID_PERIODS = ['today', '7d', '30d'] as const;
type Period = (typeof VALID_PERIODS)[number];

const AI_SOURCES = ['chat', 'voice', 'twilio'];
const ALL_SOURCES = ['staff', 'chat', 'voice', 'twilio'];

function parsePeriod(raw: string | null): Period {
  return (VALID_PERIODS as readonly string[]).includes(raw || '') ? (raw as Period) : '7d';
}

// Compute time cutoffs for a period.
// appointments.* timestamps are ISO-8601 (e.g. 2026-08-06T09:23:00.123Z);
// ai_events.created_at is SQLite datetime('now') (e.g. 2026-08-06 09:23:00, UTC).
function periodCutoffs(period: Period): { iso: string; sqlite: string } {
  const days = period === 'today' ? 0 : period === '30d' ? 30 : 7;
  let startIso: string;
  if (period === 'today') {
    startIso = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').toISOString();
  } else {
    startIso = new Date(Date.now() - days * 86400000).toISOString();
  }
  return { iso: startIso, sqlite: startIso.slice(0, 19).replace('T', ' ') };
}

// GET /api/analytics/overview?period=today|7d|30d
function handleOverview(url: URL): Response {
  const period = parsePeriod(url.searchParams.get('period'));
  const { iso, sqlite } = periodCutoffs(period);
  const db = getDb();

  const count = (sql: string, ...params: (string | number)[]): number => {
    const row = db.query(sql).get(...params) as { c: number };
    return Number(row?.c || 0);
  };

  const total_appointments = count('SELECT COUNT(*) as c FROM appointments WHERE created_at >= ?', iso);
  const ai_booked = count(`SELECT COUNT(*) as c FROM appointments WHERE source IN ('chat','voice','twilio') AND created_at >= ?`, iso);

  const channelRows = db.query(
    `SELECT source, COUNT(*) as c FROM appointments WHERE source IN ('chat','voice','twilio') AND created_at >= ? GROUP BY source`
  ).all(iso) as Array<{ source: string; c: number }>;
  const ai_bookings_by_channel: Record<string, number> = { chat: 0, voice: 0, twilio: 0 };
  for (const row of channelRows) ai_bookings_by_channel[row.source] = Number(row.c);

  const patients_registered_via_ai = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'patient_created' AND created_at >= ?", sqlite);
  const ai_sessions = count('SELECT COUNT(DISTINCT session_id) as c FROM ai_events WHERE session_id IS NOT NULL AND created_at >= ?', sqlite);
  const faqs_answered = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'faq' AND created_at >= ?", sqlite);
  const triage_count = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'triage' AND created_at >= ?", sqlite);
  const cancellations = count("SELECT COUNT(*) as c FROM appointments WHERE status = 'cancelled' AND updated_at >= ?", iso);

  const ai_booking_conversion = ai_sessions > 0 ? Number(((ai_booked / ai_sessions) * 100).toFixed(1)) : 0;

  return json({
    period,
    total_appointments,
    ai_booked,
    ai_bookings_by_channel,
    patients_registered_via_ai,
    ai_sessions,
    faqs_answered,
    triage_count,
    cancellations,
    ai_booking_conversion,
  });
}

// GET /api/analytics/ai-events?limit=50&channel=&event_type=
function handleAiEvents(url: URL): Response {
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const channel = (url.searchParams.get('channel') || '').trim();
  const eventType = (url.searchParams.get('event_type') || '').trim();

  const db = getDb();
  let sql = 'SELECT * FROM ai_events WHERE 1=1';
  const params: string[] = [];
  if (channel) { sql += ' AND channel = ?'; params.push(channel); }
  if (eventType) { sql += ' AND event_type = ?'; params.push(eventType); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(String(limit));

  const rows = db.query(sql).all(...params) as Array<{
    id: number; session_id: string | null; channel: string; event_type: string; details: string | null; created_at: string;
  }>;

  const events = rows.map((row) => {
    // Details may contain identifiers or free text; analytics exposes operational metadata only.
    return { id: row.id, channel: row.channel, event_type: row.event_type, created_at: row.created_at };
  });

  return json({ events, count: events.length, limit });
}

// GET /api/analytics/channels?period=today|7d|30d
function handleChannels(url: URL): Response {
  const period = parsePeriod(url.searchParams.get('period'));
  const { iso } = periodCutoffs(period);
  const db = getDb();

  const rows = db.query(
    `SELECT source, COUNT(*) as c FROM appointments WHERE created_at >= ? GROUP BY source`
  ).all(iso) as Array<{ source: string; c: number }>;

  const channels: Record<string, number> = {};
  for (const source of ALL_SOURCES) channels[source] = 0;
  for (const row of rows) {
    if (channels[row.source] !== undefined) channels[row.source] = Number(row.c);
  }

  return json({ period, channels });
}

export async function handleAnalytics(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/api/analytics/overview' && request.method === 'GET') return handleOverview(url);
  if (pathname === '/api/analytics/ai-events' && request.method === 'GET') return handleAiEvents(url);
  if (pathname === '/api/analytics/channels' && request.method === 'GET') return handleChannels(url);

  return error('Not found', 404);
}
