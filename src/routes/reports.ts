import { json, error } from '../middleware/http';
import { handleReport, handleReportExport } from './analytics';

// Role-scoped Reports catalogue (SRS §5 `reports` module).
// Admin = Full, Billing = Read, Management = Read. Read-only at this level:
// there are no write operations here, so Read permission (GET) is sufficient
// for any role that may act on reports. Report data is served read-only and
// export handlers only stream derived files, so no write is exposed.
//
//   GET /api/reports/:type                 — report rows (JSON)
//   GET /api/reports/:type/export?format=  — csv | pdf | excel
//
// The same catalogue remains available to admins under /api/analytics/reports
// (analytics module). This endpoint reuses the same query/export logic.

const VALID_REPORT_TYPES = [
  'daily-collections',
  'doctor-performance',
  'inventory-status',
  'outstanding-dues',
  'provincial-compliance',
];

export async function handleReports(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // GET /api/reports — list the available report catalogue (metadata)
  if (pathname === '/api/reports' && method === 'GET') {
    const catalogue = VALID_REPORT_TYPES.map((type) => ({
      type,
      description: reportDescription(type),
    }));
    return json({ reports: catalogue });
  }

  // GET /api/reports/:type/export?format=
  const exportMatch = pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]+)\/export$/);
  if (exportMatch && method === 'GET') {
    const format = url.searchParams.get('format') || 'csv';
    return handleReportExport(exportMatch[1], format);
  }

  // GET /api/reports/:type
  const typeMatch = pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]+)$/);
  if (typeMatch && method === 'GET') {
    return handleReport(typeMatch[1]);
  }

  return error('Not found', 404);
}

function reportDescription(type: string): string {
  const map: Record<string, string> = {
    'daily-collections': 'Payments collected today, by invoice and patient',
    'doctor-performance': 'Doctor appointment counts and revenue',
    'inventory-status': 'Medicine stock levels, low-stock and near-expiry flags',
    'outstanding-dues': 'Patients with unpaid balances, ranked by amount due',
    'provincial-compliance': 'Clinical visits for regulatory compliance reporting',
  };
  return map[type] || type.replace(/-/g, ' ');
}
