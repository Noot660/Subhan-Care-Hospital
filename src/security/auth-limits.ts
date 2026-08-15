import { auditLog } from '../middleware/audit';
const MAX_FAILURES = Math.max(1, Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5));
const LOCKOUT_MS = Math.max(60_000, Number(process.env.AUTH_LOCKOUT_MS || 900000));
type Counter = { failures: number; lockedUntil: number }; const attempts = new Map<string, Counter>();
const DUMMY_HASH = '$2b$10$7EqJtq98hPqEX7fNZaFWoO4w7p9cZ6vXvV4r8QZ2Nq7l6V8V8V8V8';
const key = (u:string, ip:string) => `${u.trim().toLowerCase()}|${ip}`;
export const clientIp = (r:Request) => (r.headers.get('x-forwarded-for') || r.headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0,64);
export function authLockStatus(u:string, ip:string) { const c=attempts.get(key(u,ip)); if (!c) return {locked:false}; if(c.lockedUntil>Date.now()) return {locked:true,retryAfter:Math.ceil((c.lockedUntil-Date.now())/1000)}; attempts.delete(key(u,ip)); return {locked:false}; }
export function recordAuthFailure(u:string,ip:string) { const k=key(u,ip), c=attempts.get(k)||{failures:0,lockedUntil:0}; c.failures++; if(c.failures>=MAX_FAILURES){c.lockedUntil=Date.now()+LOCKOUT_MS; auditLog({user_id:0,action:'auth_lockout',entity_type:'authentication',entity_id:'anonymous',details:{username_hint:u.slice(0,2)+'***',duration_seconds:Math.ceil(LOCKOUT_MS/1000)}})} attempts.set(k,c); return {locked:!!c.lockedUntil}; }
export const resetAuthFailures=(u:string,ip:string)=>{attempts.delete(key(u,ip));}; export const dummyHash=()=>DUMMY_HASH;
