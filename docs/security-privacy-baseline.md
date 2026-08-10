# Phase 4 P0 privacy/security baseline

- Public receptionist requests are bounded to 16 KiB JSON bodies, 2,000-character messages, validated generated session IDs, and a conservative in-memory per-IP/path rate limit (default 30 requests/minute). Set `PUBLIC_RATE_LIMIT`, `RATE_LIMIT_WINDOW_MS`, and `TRUST_PROXY=true` only behind a trusted proxy.
- Appointment lookup, cancellation, and rescheduling still require a real identity verification provider. The `SensitiveOperationVerifier` interface in `src/security.ts` fails closed by default; `PHI_VERIFICATION_STUB=true` is a development-only explicit stub and is not OTP.
- AI analytics event responses omit details/session IDs; event details stored by the AI flow no longer include names. Existing historical rows are not rewritten.
- API errors return stable safe messages; server logs retain stack traces.

Deferred: Twilio webhook signatures, real OTP provider, and clinical triage/safety integration. No claim of OTP, Twilio signature validation, or clinical safety is made by this baseline.
