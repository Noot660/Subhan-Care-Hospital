import { getDb } from '../db';
import { json, error } from '../middleware/http';
import { extractToken, validateSession } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const BACKUP_DIR = path.join(import.meta.dirname, '..', '..', 'backups');
const BACKUP_KEY = crypto.scryptSync('subhan-care-backup-key-1234567890', 'salt', 32); // AES-256 key

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export function encrypt(buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', BACKUP_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

export function decrypt(buffer: Buffer): Buffer {
  const iv = buffer.subarray(0, 16);
  const encrypted = buffer.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', BACKUP_KEY, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// POST /api/admin/backups/create
async function handleCreateBackup(request: Request): Promise<Response> {
  try {
    const dbPath = path.join(import.meta.dirname, '..', '..', 'data', 'hms.db');
    if (!fs.existsSync(dbPath)) return error('Database file not found', 500);

    const rawBuffer = fs.readFileSync(dbPath);
    const encryptedBuffer = encrypt(rawBuffer);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `hms-backup-${timestamp}.enc`;
    const destPath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(destPath, encryptedBuffer);

    const token = extractToken(request);
    const session = token ? validateSession(token) : null;
    const userId = session ? session.user_id : 0;
    auditLog({ user_id: userId, action: 'create_backup', entity_type: 'system', entity_id: filename, details: {} });

    return json({ message: 'Backup created and encrypted successfully', filename }, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

// GET /api/admin/backups
async function handleListBackups(request: Request): Promise<Response> {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.enc'))
      .map(f => {
        const filePath = path.join(BACKUP_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          filename: f,
          size_bytes: stats.size,
          created_at: stats.mtime.toISOString()
        };
      });
    return json(files);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

export async function handleBackups(request: Request): Promise<Response> {
  const token = extractToken(request);
  if (!token) return error("Unauthorized — missing authentication token", 401);
  const session = validateSession(token);
  if (!session) return error("Unauthorized — invalid or expired session", 401);

  if (session.role !== 'admin') {
    return error("Forbidden — insufficient permissions", 403);
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/api/admin/backups/create' && request.method === 'POST') {
    return handleCreateBackup(request);
  }
  if (pathname === '/api/admin/backups' && request.method === 'GET') {
    return handleListBackups(request);
  }

  return error('Not found', 404);
}
