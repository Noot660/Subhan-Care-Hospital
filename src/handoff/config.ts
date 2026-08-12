// Human-handoff / callback configuration.
//
// Safe by default: HANDOFF_MODE defaults to 'off' — the AI never implies a
// callback can be scheduled unless an operator explicitly enables it AND a
// callback_requests row was actually written. All values are read from the
// environment on every call so tests and deployments can flip them live.

export type HandoffMode = 'off' | 'callback';

export interface HandoffConfig {
  /** 'off' — handoff unavailable (honest refusal); 'callback' — requests may be recorded. */
  mode: HandoffMode;
  /** HANDOFF_PHONE — front desk number shown to callers when callback is off. */
  phone: string | null;
  /** CALLBACK_HOURS — e.g. "between 9am and 5pm" (free text, operator-configured). */
  hours: string | null;
  /** CALLBACK_SLA — e.g. "within 2 hours" (free text, operator-configured). */
  sla: string | null;
}

export function getHandoffConfig(): HandoffConfig {
  const raw = (process.env.HANDOFF_MODE || 'off').trim().toLowerCase();
  const mode: HandoffMode = raw === 'callback' ? 'callback' : 'off';
  return {
    mode,
    phone: (process.env.HANDOFF_PHONE || '').trim() || null,
    hours: (process.env.CALLBACK_HOURS || '').trim() || null,
    sla: (process.env.CALLBACK_SLA || '').trim() || null,
  };
}

/** Human-readable hours/SLA line used in confirmations — never a guarantee. */
export function hoursSlaText(cfg: HandoffConfig, lang: 'en' | 'ur'): string {
  const parts = [cfg.hours, cfg.sla].filter(Boolean);
  if (parts.length) return parts.join('; ');
  return lang === 'ur' ? 'working hours ke dauraan' : 'during working hours';
}
