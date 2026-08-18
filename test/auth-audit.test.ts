import { describe, expect, test, beforeEach, afterAll, beforeAll } from 'bun:test';
import { handleAuthLogin } from '../src/routes/auth';
import { handleAudit } from '../src/routes/audit';
import { getDb } from '../src/db';
import { hasPermission } from '../src/middleware/auth';
import { handleRequest } from '../src/index';
import { resetAuthLimitState, authLockStatus, recordAuthFailure } from '../src/security/auth-limits';

const db = getDb();
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const username = `audit_${suffix}`;
const password = 'correct-password-42';
let staffId = 0;

const login = (u = username, p = password, ip = '198.51.100.10') => handleAuthLogin(new Request('http://test/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify({ username: u, password: p }),
}));
const auditRows = (action?: string) => handleAudit(new Request(`http://test/api/audit?limit=100${action ? `&action=${action}` : ''}`));

beforeEach(() => resetAuthLimitState());
afterAll(() => {
  db.run('DELETE FROM audit_logs WHERE entity_id = ? OR (user_id = ? AND action LIKE \'auth_%\')', ['anonymous', staffId]);
  if (staffId) db.run('DELETE FROM staff WHERE id = ?', [staffId]);
});

describe.serial('authentication audit and lockout controls', () => {
  test('successful login creates an audit event and failed login is generic and redacted', async () => {
    const hash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 4 });
    const inserted = db.query("INSERT INTO staff (name, role, username, password_hash, phone, email) VALUES (?, 'admin', ?, ?, ?, ?) RETURNING id")
      .get('Audit Test User', username, hash, '03001234567', `${username}@example.test`) as { id: number };
    staffId = inserted.id;
    const success = await login();
    expect(success.status).toBe(200);
    const failure = await login(username, 'wrong-password');
    expect(failure.status).toBe(401);
    expect(await failure.json()).toEqual({ error: 'Invalid credentials' });
    const response = await auditRows();
    const payload = await response.json() as { logs: Array<Record<string, unknown>> };
    const relevant = payload.logs.filter((row) => row.entity_id === 'anonymous' || row.user_ref === `staff-${staffId}`);
    expect(relevant.map((row) => row.action)).toContain('auth_login_success');
    expect(relevant.map((row) => row.action)).toContain('auth_login_failure');
    for (const row of relevant) {
      expect(row).not.toHaveProperty('details');
      expect(row).not.toHaveProperty('password');
      expect(row).not.toHaveProperty('username');
    }
  });

  test('fifth failed attempt locks the account and emits a lockout event', async () => {
    resetAuthLimitState();
    for (let i = 0; i < 5; i++) recordAuthFailure(username, '198.51.100.20');
    expect(authLockStatus(username, '198.51.100.20').locked).toBe(true);
    const response = await auditRows('auth_lockout');
    const payload = await response.json() as { logs: Array<Record<string, unknown>> };
    expect(payload.logs.length).toBeGreaterThan(0);
  });

  test('failure counters are isolated by account/IP and successful login resets them', async () => {
    for (let i = 0; i < 4; i++) expect((await login(username, 'wrong', '203.0.113.1')).status).toBe(401);
    expect((await login(username, password, '203.0.113.1')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(username, 'wrong', '203.0.113.1')).status).toBe(401);
    expect((await login(username, password, '203.0.113.2')).status).toBe(200);
  });

  test('malformed auth failures return the same generic error', async () => {
    const response = await handleAuthLogin(new Request('http://test/api/auth/login', { method: 'POST', body: '{bad' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid credentials' });
  });

  test('audit endpoint requires authentication and is admin-only', async () => {
    const missing = await handleRequest(new Request('http://test/api/audit'));
    expect(missing.status).toBe(401);
    const receptionist = await login('receptionist', 'staff123', '203.0.113.80');
    expect(receptionist.status).toBe(200);
    const { token } = await receptionist.json() as { token: string };
    const forbidden = await handleRequest(new Request('http://test/api/audit', { headers: { authorization: `Bearer ${token}` } }));
    expect(forbidden.status).toBe(403);
    expect(hasPermission('admin', 'audit', 'GET')).toBe(true);
    expect(hasPermission('receptionist', 'audit', 'GET')).toBe(false);
    expect(hasPermission('doctor', 'audit', 'GET')).toBe(false);
    expect(hasPermission('admin', 'audit', 'POST')).toBe(false);
  });

  test('admin audit supports pagination and filters without exposing sensitive fields', async () => {
    const all = await handleAudit(new Request('http://test/api/audit?page=1&limit=1'));
    expect(all.status).toBe(200);
    const page = await all.json() as { logs: unknown[]; pagination: { page: number; limit: number } };
    expect(page.pagination).toMatchObject({ page: 1, limit: 1 });
    const filtered = await auditRows('auth_login_failure');
    expect(filtered.status).toBe(200);
    const body = await filtered.json() as { logs: Array<Record<string, unknown>> };
    expect(body.logs.every((row) => row.action === 'auth_login_failure')).toBe(true);
    for (const row of body.logs) {
      expect(Object.keys(row).sort()).toEqual(['action', 'created_at', 'entity_id', 'entity_type', 'id', 'user_ref'].sort());
    }
  });

  test('short configurable lockout recovers', () => {
    const script = `import { recordAuthFailure, authLockStatus } from './src/security/auth-limits.ts'; for(let i=0;i<5;i++) recordAuthFailure('subprocess-user','203.0.113.50'); if(!authLockStatus('subprocess-user','203.0.113.50').locked) process.exit(2); setTimeout(()=>process.exit(authLockStatus('subprocess-user','203.0.113.50').locked ? 3 : 0), 1100);`;
    const result = Bun.spawnSync(['bun', '-e', script], { cwd: import.meta.dir + '/..', env: { ...process.env, AUTH_LOCKOUT_MS: '1000' }, timeout: 3000 });
    expect(result.exitCode).toBe(0);
  });
});
