import { auditLog } from '../middleware/audit';

const MAX_FAILURES = Math.max(1, Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5));
const LOCKOUT_MS = Math.max(1_000, Number(process.env.AUTH_LOCKOUT_MS || 900000));
type Counter = { failures: number; lockedUntil: number };
const attempts = new Map<string, Counter>();
const DUMMY_HASH = '$2b$10$7EqJtq98hPqEX7fNZaFWoO4w7p9cZ6vXvV4r8QZ2Nq7l6V8V8V8V8';
const accountKey = (u: string) => `account:${u.trim().toLowerCase()}`;
const ipKey = (ip: string) => `ip:${ip}`;
export const resetAuthLimitState = () => attempts.clear();
export const clientIp = (r: Request) => (r.headers.get('x-forwarded-for') || r.headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0, 64);
function status(key: string) {
  const c = attempts.get(key);
  if (!c) return { locked: false };
  if (c.lockedUntil > Date.now()) return { locked: true, retryAfter: Math.ceil((c.lockedUntil - Date.now()) / 1000) };
  attempts.delete(key); return { locked: false };
}
export function authLockStatus(u: string, ip: string) {
  const account = status(accountKey(u)); const address = status(ipKey(ip));
  return account.locked || address.locked ? { locked: true, retryAfter: Math.max(account.retryAfter || 0, address.retryAfter || 0) } : { locked: false };
}
export function recordAuthFailure(u: string, ip: string) {
  let newlyLocked = false;
  for (const key of [accountKey(u), ipKey(ip)]) {
    const c = attempts.get(key) || { failures: 0, lockedUntil: 0 }; c.failures++;
    if (c.failures >= MAX_FAILURES && c.lockedUntil <= Date.now()) { c.lockedUntil = Date.now() + LOCKOUT_MS; newlyLocked = true; }
    attempts.set(key, c);
  }
  if (newlyLocked) auditLog({ user_id: 0, action: 'auth_lockout', entity_type: 'authentication', entity_id: 'anonymous', details: { duration_seconds: Math.ceil(LOCKOUT_MS / 1000) } });
  return { locked: true };
}
export const resetAuthFailures = (u: string, ip: string) => { attempts.delete(accountKey(u)); attempts.delete(ipKey(ip)); };
export const dummyHash = () => DUMMY_HASH;
