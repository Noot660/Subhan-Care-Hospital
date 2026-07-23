// Conversation state manager — tracks multi-turn conversations
// Auto-expires after 10 minutes of inactivity

import type { Intent } from './llm';

export interface ConversationState {
  sessionId: string;
  intent: Intent;
  language: 'en' | 'ur';
  step: string;
  collected: Record<string, string>;
  context: Record<string, unknown>; // extra data like doctor list, slots, etc.
  createdAt: number;
  lastActivity: number;
}

// In-memory conversation store
const conversations = new Map<string, ConversationState>();

const TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of conversations) {
    if (now - state.lastActivity > TTL_MS) {
      conversations.delete(id);
    }
  }
}, 60_000); // Run cleanup every minute

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getOrCreateSession(sessionId?: string | null): ConversationState {
  const id = sessionId || generateSessionId();

  const existing = conversations.get(id);
  if (existing) {
    existing.lastActivity = Date.now();
    return existing;
  }

  // Return a fresh empty state (intent will be set after classification)
  const state: ConversationState = {
    sessionId: id,
    intent: 'unknown',
    language: 'en',
    step: 'init',
    collected: {},
    context: {},
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  conversations.set(id, state);
  return state;
}

export function updateSession(
  sessionId: string,
  updates: Partial<Omit<ConversationState, 'sessionId' | 'createdAt'>>
): ConversationState {
  const state = conversations.get(sessionId);
  if (!state) {
    return getOrCreateSession(sessionId);
  }

  Object.assign(state, updates);
  state.lastActivity = Date.now();
  return state;
}

export function clearSession(sessionId: string): void {
  conversations.delete(sessionId);
}

export function touchSession(sessionId: string): void {
  const state = conversations.get(sessionId);
  if (state) state.lastActivity = Date.now();
}

// ── Step helpers for each intent flow ──

export const REGISTRATION_STEPS = [
  'ask_full_name',
  'ask_cnic',
  'ask_dob',
  'ask_gender',
  'ask_phone',
  'ask_address',
  'ask_emergency_contact',
  'confirm',
];

export const REGISTRATION_FIELDS = [
  'full_name',
  'cnic',
  'dob',
  'gender',
  'phone',
  'address',
  'emergency_contact',
];

export const BOOKING_STEPS = [
  'ask_is_patient',
  'ask_identifier',
  'ask_doctor',
  'ask_date',
  'ask_time',
  'confirm',
];

export const CHECK_APPOINTMENT_STEPS = [
  'ask_identifier',
  'show_results',
];

export const TRIAGE_STEPS = [
  'ask_severity',
  'ask_duration',
  'recommend',
];

export const CANCEL_RESCHEDULE_STEPS = [
  'ask_identifier',
  'show_appointments',
  'confirm_cancel',
  'ask_new_date',
  'ask_new_time',
  'confirm_reschedule',
];

export function getNextStep(steps: string[], currentStep: string): string | null {
  const idx = steps.indexOf(currentStep);
  if (idx === -1 || idx >= steps.length - 1) return null;
  return steps[idx + 1];
}

export function getStepIndex(steps: string[], step: string): number {
  return steps.indexOf(step);
}
