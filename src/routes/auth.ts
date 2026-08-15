import { getDb } from '../db';
import { hashPassword, verifyPassword, createSession, invalidateSession, extractToken, validateSession } from '../middleware/auth';
import { json, error, parseBody } from '../middleware/http';
import { auditLog } from '../middleware/audit';
import { authLockStatus, recordAuthFailure, resetAuthFailures, clientIp, dummyHash } from '../security/auth-limits';
import type { Staff } from '../types';
export async function handleAuthLogin(request: Request): Promise<Response> {
 try { const body=await parseBody<{username:string;password:string}>(request); const username=typeof body.username==='string'?body.username.slice(0,128):''; const password=typeof body.password==='string'?body.password:''; const ip=clientIp(request); if(!username||!password)return error('Invalid credentials',401);
  const lock=authLockStatus(username,ip); if(lock.locked){ auditLog({user_id:0,action:'auth_login_blocked',entity_type:'authentication',entity_id:'anonymous',details:{username_hint:username.slice(0,2)+'***'}}); return error('Invalid credentials',401); }
  const db=getDb(); const staff=db.query("SELECT * FROM staff WHERE username = ? AND status = 'active'").get(username) as Staff|undefined; const valid=await verifyPassword(password,staff?.password_hash||dummyHash());
  if(!staff||!valid){ recordAuthFailure(username,ip); auditLog({user_id:0,action:'auth_login_failure',entity_type:'authentication',entity_id:'anonymous',details:{username_hint:username.slice(0,2)+'***'}}); return error('Invalid credentials',401); }
  resetAuthFailures(username,ip); auditLog({user_id:staff.id,action:'auth_login_success',entity_type:'authentication',entity_id:String(staff.id),details:{}}); const session=createSession({id:staff.id,role:staff.role,username:staff.username,name:staff.name}); return json({token:session.token,user:{id:staff.id,name:staff.name,role:staff.role,username:staff.username,phone:staff.phone,email:staff.email},expires_at:session.expires_at});
 } catch(err){ return error('Invalid credentials',401); }
}
export async function handleAuthLogout(request:Request):Promise<Response>{const token=extractToken(request);if(token)invalidateSession(token);return json({message:'Logged out successfully'});}
export async function handleAuthMe(request:Request):Promise<Response>{const token=extractToken(request);if(!token)return error('Unauthorized',401);const s=validateSession(token);if(!s)return error('Invalid or expired session',401);return json({user:{id:s.staff_id,name:s.name,role:s.role,username:s.username}});}
