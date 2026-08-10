// Phase 4 P0 security controls: conservative in-memory limits for the single public deployment.
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.PUBLIC_RATE_LIMIT || 30);
const buckets = new Map<string, { count: number; reset: number }>();

export function clientIp(request: Request): string {
  // Only trust forwarded headers when explicitly enabled by a trusted proxy.
  return process.env.TRUST_PROXY === 'true'
    ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown')
    : 'direct';
}

export function allowPublicRequest(request: Request): boolean {
  const key = `${clientIp(request)}:${new URL(request.url).pathname}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) { buckets.set(key, { count: 1, reset: now + WINDOW_MS }); return true; }
  if (bucket.count >= MAX_REQUESTS) return false;
  bucket.count++;
  return true;
}

export const MAX_BODY_BYTES = 16_384;
export const MAX_SESSION_ID_LENGTH = 96;
export const MAX_TURNS = 40;

// No provider is wired in yet. Sensitive operations must remain unavailable rather than
// treating a name/phone/CNIC as proof of identity.
export interface SensitiveOperationVerifier {
  verify(sessionId: string, provided: string): boolean;
}
export const sensitiveVerifier: SensitiveOperationVerifier = {
  verify: () => process.env.PHI_VERIFICATION_STUB === 'true',
};
export const SENSITIVE_OPERATION_MESSAGE = 'Identity verification is required for this request.';

export function safeErrorLog(err: unknown, context: string): void {
  console.error(`[${context}]`, err instanceof Error ? err.stack || err.message : String(err));
}
