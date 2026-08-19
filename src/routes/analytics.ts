import { getDb } from '../db';
import { json, error } from '../middleware/http';
import { countPendingCallbacks } from '../handoff/store';

const VALID_PERIODS = ['today', '7d', '30d'] as const;
type Period = (typeof VALID_PERIODS)[number];

const AI_SOURCES = ['chat', 'voice', 'twilio'];
const ALL_SOURCES = ['staff', 'chat', 'voice', 'twilio'];

function parsePeriod(raw: string | null): Period {
  return (VALID_PERIODS as readonly string[]).includes(raw || '') ? (raw as Period) : '7d';
}

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
  ).all(sqlite) as Array<{ source: string; c: number }>;
  const ai_bookings_by_channel: Record<string, number> = { chat: 0, voice: 0, twilio: 0 };
  for (const row of channelRows) ai_bookings_by_channel[row.source] = Number(row.c);

  const patients_registered_via_ai = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'patient_created' AND created_at >= ?", sqlite);
  const ai_sessions = count('SELECT COUNT(DISTINCT session_id) as c FROM ai_events WHERE session_id IS NOT NULL AND created_at >= ?', sqlite);
  const faqs_answered = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'faq' AND created_at >= ?", sqlite);
  const triage_count = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'triage' AND created_at >= ?", sqlite);
  const cancellations = count("SELECT COUNT(*) as c FROM appointments WHERE status = 'cancelled' AND updated_at >= ?", iso);

  const callbacks_requested = count("SELECT COUNT(*) as c FROM ai_events WHERE event_type = 'callback_requested' AND created_at >= ?", sqlite);
  const callbacks_pending = countPendingCallbacks();

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
    callbacks_requested,
    callbacks_pending,
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

// ── Standard Report Catalogue (Section 13) Helpers ──

function queryReportData(type: string): any[] {
  const db = getDb();
  if (type === 'daily-collections') {
    return db.query(`
      SELECT p.id as payment_id, p.amount, p.method, p.reference, p.created_at,
             i.invoice_number, pat.full_name as patient_name
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      JOIN patients pat ON i.patient_id = pat.id
      WHERE date(p.created_at) = date('now')
      ORDER BY p.created_at DESC
    `).all();
  }

  if (type === 'doctor-performance') {
    return db.query(`
      SELECT d.id as doctor_id, d.name as doctor_name, d.specialization,
        (SELECT COUNT(*) FROM appointments WHERE doctor_id = d.id) as appointment_count,
        (SELECT COALESCE(SUM(ii.total), 0)
         FROM invoice_items ii
         JOIN invoices i ON ii.invoice_id = i.id
         JOIN appointments a ON i.appointment_id = a.id
         WHERE a.doctor_id = d.id AND i.status != 'cancelled') as total_revenue
      FROM doctors d
      WHERE d.status = 'active'
      ORDER BY total_revenue DESC
    `).all();
  }

  if (type === 'inventory-status') {
    return db.query(`
      SELECT id as medicine_id, name, batch_number, quantity, unit_cost, expiry_date,
             (quantity <= reorder_threshold) as is_low_stock,
             (expiry_date <= date('now', '+' || expiry_alert_days || ' days')) as is_near_expiry
      FROM medicines
      ORDER BY name
    `).all();
  }

  if (type === 'outstanding-dues') {
    const patients = db.query(`
      SELECT p.id as patient_id, p.patient_id as patient_code, p.full_name as patient_name, p.phone,
             COALESCE(SUM(i.total), 0) as total_invoiced,
             (SELECT COALESCE(SUM(pm.amount), 0) FROM payments pm JOIN invoices inv ON pm.invoice_id = inv.id WHERE inv.patient_id = p.id AND inv.status != 'cancelled') as total_paid,
             (SELECT COALESCE(SUM(cn.amount), 0) FROM credit_notes cn JOIN invoices inv ON cn.invoice_id = inv.id WHERE inv.patient_id = p.id AND inv.status != 'cancelled') as total_credited
      FROM patients p
      JOIN invoices i ON i.patient_id = p.id
      WHERE i.status != 'cancelled'
      GROUP BY p.id
    `).all() as any[];

    return patients
      .map(row => {
        const outstanding = Math.round((row.total_invoiced - row.total_paid - row.total_credited) * 100) / 100;
        return { ...row, outstanding_balance: Math.max(0, outstanding) };
      })
      .filter(row => row.outstanding_balance > 0)
      .sort((a, b) => b.outstanding_balance - a.outstanding_balance);
  }

  if (type === 'provincial-compliance') {
    return db.query(`
      SELECT 
        'PHC-REG-77889' as phc_clinic_reg_no,
        p.patient_id as patient_code,
        p.full_name as patient_name,
        p.dob as dob,
        p.gender as gender,
        p.cnic as cnic,
        p.phone as phone,
        c.created_at as visit_date,
        d.name as doctor_name,
        d.specialization as doctor_specialization,
        c.diagnosis as diagnosis,
        (
          SELECT GROUP_CONCAT(pi.medicine_name || ' (' || pi.dosage || ', ' || pi.frequency || ' for ' || pi.duration || ')')
          FROM prescription_items pi
          JOIN prescriptions pr ON pi.prescription_id = pr.id
          WHERE pr.consultation_id = c.id
        ) as prescribed_medicines,
        COALESCE(i.total, 0) as total_billed,
        COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id), 0) as amount_paid
      FROM consultations c
      JOIN patients p ON c.patient_id = p.id
      JOIN doctors d ON c.doctor_id = d.id
      LEFT JOIN invoices i ON i.appointment_id = c.appointment_id AND i.status != 'cancelled'
      ORDER BY c.created_at DESC
    `).all();
  }

  return [];
}

// GET /api/analytics/reports/:type
function handleReport(type: string): Response {
  const data = queryReportData(type);
  if (data.length === 0 && !['daily-collections', 'doctor-performance', 'inventory-status', 'outstanding-dues', 'provincial-compliance'].includes(type)) {
    return error('Invalid report type', 400);
  }
  return json(data);
}

// GET /api/analytics/reports/:type/export
function handleReportExport(type: string, format: string): Response {
  if (format !== 'csv') {
    return error('Only CSV format is currently supported for export', 400);
  }
  const data = queryReportData(type);
  if (data.length === 0) {
    return new Response('', {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${type}_report.csv"`,
      }
    });
  }

  const headers = Object.keys(data[0]);
  const rows = [headers.join(",")];
  for (const item of data) {
    const values = headers.map(header => {
      const val = item[header];
      const valStr = val === null || val === undefined ? "" : String(val);
      const escaped = valStr.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    rows.push(values.join(","));
  }
  const csvContent = rows.join("\r\n");

  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${type}_report.csv"`,
      'Cache-Control': 'no-cache',
    }
  });
}

// Route dispatcher
export async function handleAnalytics(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Exact export endpoint match
  const exportMatch = pathname.match(/^\/api\/analytics\/reports\/([a-zA-Z0-9_-]+)\/export$/);
  if (exportMatch && request.method === 'GET') {
    const format = url.searchParams.get('format') || 'csv';
    return handleReportExport(exportMatch[1], format);
  }

  // Exact report catalogue endpoint match
  const reportMatch = pathname.match(/^\/api\/analytics\/reports\/([a-zA-Z0-9_-]+)$/);
  if (reportMatch && request.method === 'GET') {
    return handleReport(reportMatch[1]);
  }

  if (pathname === '/api/analytics/overview' && request.method === 'GET') return handleOverview(url);
  if (pathname === '/api/analytics/ai-events' && request.method === 'GET') return handleAiEvents(url);
  if (pathname === '/api/analytics/channels' && request.method === 'GET') return handleChannels(url);

  return error('Not found', 404);
}
