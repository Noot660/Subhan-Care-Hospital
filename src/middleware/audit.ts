import { getDb } from "../db";

export function auditLog(params: {
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [
      params.user_id,
      params.action,
      params.entity_type,
      params.entity_id,
      JSON.stringify(params.details || {}),
    ]
  );
}
