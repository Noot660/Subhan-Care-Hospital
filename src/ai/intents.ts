// Intent handler — processes user messages and manages conversation flows
// Handles: register_patient, book_appointment, check_appointment, faq, triage, cancel_reschedule

import { getDb } from '../db';
import type { Language } from './i18n';
import { t, detectLanguage } from './i18n';
import { findFAQ, formatFAQAnswer, getFAQTopicList } from './faq';
import type { ClassifiedIntent } from './llm';
import type { ConversationState } from './conversation';
import {
  getOrCreateSession,
  updateSession,
  clearSession,
  REGISTRATION_STEPS,
  REGISTRATION_FIELDS,
  BOOKING_STEPS,
  CHECK_APPOINTMENT_STEPS,
  TRIAGE_STEPS,
  CANCEL_RESCHEDULE_STEPS,
  getStepIndex,
} from './conversation';
import type { Patient, Doctor, DoctorSchedule, Appointment } from '../types';
import { MAX_TURNS, sensitiveVerifier, SENSITIVE_OPERATION_MESSAGE } from '../security';
import { availableSlots as getAvailableSlots, validateAppointmentInput, validateCalendarDate, hospitalToday } from '../appointments/validation';
import { detectRedFlag } from './safety';
import { classifyIntent, isHandoffRequest, runGeminiAgent, hasLLMFallback } from './llm';
import { getHandoffConfig, hoursSlaText } from '../handoff/config';
import {
  isValidPhone as isValidCallbackPhone,
  normalizePhone,
  createCallbackRequest,
} from '../handoff/store';

export interface ReceptionistResponse {
  reply: string;
  session_id: string;
  intent: string;
  action?: {
    type: string;
    data: unknown;
  };
  language: Language;
  conversation_active: boolean;
}

// ── AI event logging ──
// Records completed AI actions to ai_events for admin analytics / ops feed.
function recordAiEvent(sessionId: string, channel: string, eventType: string, details: Record<string, unknown> = {}): void {
  const db = getDb();
  db.run(
    `INSERT INTO ai_events (session_id, channel, event_type, details) VALUES (?, ?, ?, ?)`,
    [sessionId || null, channel || 'staff', eventType, JSON.stringify(details)]
  );
}

// ── Helpers ──

function isAffirmative(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return /^(yes|yeah|yup|yep|haan|ji|hmm|ok|okay|theek|bilkul|sahi|correct|confirm|sure|of course|absolutely)/i.test(lower) ||
    /\byes\b/i.test(lower) || /\bhaan\b/i.test(lower) || /\bbilkul\b/i.test(lower);
}

function isNegative(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return /^(no|nah|nope|nahi|nahin|na|galat|wrong|never|don't|do not)/i.test(lower) ||
    /\bno\b/i.test(lower) || /\bnahi\b/i.test(lower) || /\bnahin\b/i.test(lower);
}

function formatAndSanitizeCNIC(cnic: string): string | null {
  const digits = cnic.replace(/\D/g, '');
  if (digits.length !== 13) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function isValidCNIC(cnic: string): boolean {
  return formatAndSanitizeCNIC(cnic) !== null;
}

function parseAndFormatDOB(dob: string): string | null {
  const trimmed = dob.trim();
  // Try YYYY-MM-DD
  let match = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (match) return trimmed;

  // Try DD-MM-YYYY or DD/MM/YYYY
  match = trimmed.match(/^(0[1-9]|[12]\d|3[01])[-/](0[1-9]|1[0-2])[-/](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return `${y}-${m}-${d}`;
  }

  // Try YYYY/MM/DD
  match = trimmed.match(/^(\d{4})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m}-${d}`;
  }

  return null;
}

function isValidDOB(dob: string): boolean {
  const formatted = parseAndFormatDOB(dob);
  if (!formatted) return false;
  const [year, month, day] = formatted.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return false;
  }
  const today = hospitalToday();
  return formatted <= today;
}

function formatAndSanitizePhone(phone: string): string | null {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('923') && cleaned.length === 12) {
    cleaned = '0' + cleaned.slice(2);
  }
  if (cleaned.length !== 11 || !cleaned.startsWith('03')) {
    return null;
  }
  return cleaned;
}

function isValidPhone(phone: string): boolean {
  return formatAndSanitizePhone(phone) !== null;
}

function sanitizeGender(gender: string): string | null {
  const cleaned = gender.trim().toLowerCase();
  if (/^(male|mard|m|men|larka)$/i.test(cleaned)) return 'Male';
  if (/^(female|aurat|f|women|lady|girl|larki)$/i.test(cleaned)) return 'Female';
  if (/^(other|o)$/i.test(cleaned)) return 'Other';
  return null;
}

function isValidGender(gender: string): boolean {
  return sanitizeGender(gender) !== null;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z\s.\-']/g, '').replace(/\s+/g, ' ').trim();
}

function findPatientByIdentifier(query: string): Patient | null {
  const db = getDb();
  const cleaned = query.trim();

  // Try CNIC
  let patient = db.query("SELECT * FROM patients WHERE cnic = ? AND status = 'active'").get(cleaned) as Patient | undefined;
  if (patient) return patient;

  // Try phone
  const phoneClean = cleaned.replace(/[-\s]/g, '');
  patient = db.query("SELECT * FROM patients WHERE REPLACE(REPLACE(phone, '-', ''), ' ', '') = ? AND status = 'active'").get(phoneClean) as Patient | undefined;
  if (patient) return patient;

  // Try name (partial match)
  patient = db.query("SELECT * FROM patients WHERE full_name LIKE ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(`%${cleaned}%`) as Patient | undefined;
  if (patient) return patient;

  // Try patient ID
  patient = db.query("SELECT * FROM patients WHERE patient_id = ? AND status = 'active'").get(cleaned) as Patient | undefined;
  if (patient) return patient;

  return null;
}

function formatDoctorList(doctors: Array<Doctor & { schedule?: unknown }>, lang: Language): string {
  return doctors.map(d => {
    if (lang === 'ur') {
      return `• **${d.name}** — ${d.specialization} (Fee: Rs. ${d.fee})`;
    }
    return `• **${d.name}** — ${d.specialization} (Fee: Rs. ${d.fee})`;
  }).join('\n');
}

function formatAppointmentList(appointments: Array<Appointment & { doctor_name?: string; doctor_specialization?: string }>, lang: Language): string {
  if (appointments.length === 0) return lang === 'ur' ? 'Koi appointment nahi mili.' : 'No appointments found.';

  return appointments.map((a, i) => {
    const drName = a.doctor_name || `Doctor #${a.doctor_id}`;
    if (lang === 'ur') {
      return `${i + 1}. ID: ${a.id} — **${drName}** | 📅 ${a.date} | 🕐 ${a.start_time} | Status: ${a.status}`;
    }
    return `${i + 1}. ID: ${a.id} — **${drName}** | 📅 ${a.date} | 🕐 ${a.start_time} | Status: ${a.status}`;
  }).join('\n');
}

// Find doctor by name or specialty
function findDoctor(query: string): Doctor | null {
  const db = getDb();
  const cleaned = query.trim().toLowerCase();

  // Try numeric ID
  if (/^\d+$/.test(cleaned)) {
    return db.query("SELECT * FROM doctors WHERE id = ? AND status = 'active'").get(Number(cleaned)) as Doctor | undefined || null;
  }

  // Try name
  let doctor = db.query("SELECT * FROM doctors WHERE LOWER(name) LIKE ? AND status = 'active' LIMIT 1").get(`%${cleaned}%`) as Doctor | undefined;
  if (doctor) return doctor;

  // Try specialty
  doctor = db.query("SELECT * FROM doctors WHERE LOWER(specialization) LIKE ? AND status = 'active' LIMIT 1").get(`%${cleaned}%`) as Doctor | undefined;
  if (doctor) return doctor;

  return null;
}

// ── Main handler ──

export async function handleMessage(
  message: string,
  sessionId: string | null | undefined,
  preferredLang?: string,
  channel: string = 'staff'
): Promise<ReceptionistResponse> {
  const lang: Language = (preferredLang === 'ur' ? 'ur' : detectLanguage(message));
  let state = getOrCreateSession(sessionId);

  // Bound multi-turn conversations to prevent unbounded state and abuse.
  const turnCount = typeof state.context.turnCount === 'number' ? state.context.turnCount : 0;
  if (turnCount >= MAX_TURNS) {
    clearSession(state.sessionId);
    return {
      reply: 'This conversation has reached its maximum length. Please start a new request.',
      session_id: state.sessionId,
      intent: state.intent,
      language: lang,
      conversation_active: false,
    };
  }
  state.context.turnCount = turnCount + 1;

  // Clinical safety gate — runs on EVERY utterance, before intent
  // classification and before any in-progress flow can continue. Deterministic
  // red-flag phrases (English + Roman Urdu) escalate straight to emergency
  // care; this is navigation only and never a diagnosis. A patient mid-booking
  // who suddenly says 'saans nahi aa rahi' still gets emergency escalation.
  const redFlag = detectRedFlag(message);
  if (redFlag) {
    recordAiEvent(state.sessionId, channel, 'triage', { outcome: 'emergency', red_flag: redFlag.category });
    clearSession(state.sessionId);
    return {
      reply: maybeAppendHandoffOffer(t('triage_emergency', lang), lang),
      session_id: state.sessionId,
      intent: 'triage',
      language: lang,
      conversation_active: false,
    };
  }

  // If LLM fallback is available (OPENAI_API_KEY is present), use the Gemini agent
  if (hasLLMFallback()) {
    try {
      state.language = lang;
      const agentResponse = await runGeminiAgent(message, state, channel);
      return agentResponse;
    } catch (err) {
      console.warn("Gemini agent failed, falling back to legacy state machine:", err);
      // Fall through to legacy state-machine flow below
    }
  }

  // If we have an active conversation flow, continue it — unless the caller is
  // asking for a human/callback right now, in which case they bail out of the
  // in-progress flow (e.g. mid-booking "bas mujhe waapis call karo").
  if (state.intent !== 'unknown' && state.step !== 'init') {
    if (isHandoffRequest(message)) {
      return startHandoff(state, { intent: 'human_handoff', confidence: 1, entities: {} }, message, lang, channel);
    }
    return continueFlow(state, message, lang, channel);
  }

  // Classify the intent
  const classified = classifyIntent(message);

  // If unknown, return fallback
  if (classified.intent === 'unknown' || classified.intent === 'greeting') {
    state = updateSession(state.sessionId, {
      intent: 'unknown',
      language: lang,
      step: 'init',
      collected: {},
    });

    if (classified.intent === 'greeting') {
      return {
        reply: t('welcome', lang),
        session_id: state.sessionId,
        intent: 'greeting',
        language: lang,
        conversation_active: false,
      };
    }

    return {
      reply: t('fallback', lang),
      session_id: state.sessionId,
      intent: 'unknown',
      language: lang,
      conversation_active: false,
    };
  }

  // Start a new flow
  return startFlow(state, classified, message, lang, channel);
}

async function startFlow(
  state: ConversationState,
  classified: ClassifiedIntent,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  switch (classified.intent) {
    case 'register_patient':
      return startRegistration(state, classified, lang);
    case 'book_appointment':
      return startBooking(state, classified, lang);
    case 'check_appointment':
      return startCheckAppointment(state, classified, lang);
    case 'faq':
      return handleFAQ(state, message, lang, channel);
    case 'triage':
      return startTriage(state, classified, message, lang, channel);
    case 'cancel_reschedule':
      return startCancelReschedule(state, classified, lang);
    case 'human_handoff':
      return startHandoff(state, classified, message, lang, channel);
    default:
      return {
        reply: t('fallback', lang),
        session_id: state.sessionId,
        intent: 'unknown',
        language: lang,
        conversation_active: false,
      };
  }
}

// ── Emergency replies: optional handoff offer ──
// When callback mode is enabled, the emergency copy is followed by an OFFER to
// also request a front-desk callback — after the caller has called emergency
// services. The 1122 instruction and disclaimer are never weakened or reordered.
function maybeAppendHandoffOffer(reply: string, lang: Language): string {
  if (getHandoffConfig().mode !== 'callback') return reply;
  return reply + t('handoff_after_emergency', lang);
}

// ── Human Handoff / Callback Flow ──

function handoffUnavailableReply(lang: Language): string {
  const cfg = getHandoffConfig();
  const phoneLine = cfg.phone
    ? (lang === 'ur' ? ` Aap ${cfg.phone} par call kar sakte hain.` : ` You can call our front desk directly at ${cfg.phone}.`)
    : (lang === 'ur' ? ' Aap hospital ke front desk par tashreef la sakte hain.' : ' You can visit our front desk at the hospital.');
  return t('handoff_unavailable', lang, { phone_line: phoneLine });
}

// Start of the handoff flow — respects HANDOFF_MODE:
//  - off (default): honest "not available" reply, nothing recorded, no promise.
//  - callback: collect phone → optional reason → persist → confirm (no guarantee).
function startHandoff(
  state: ConversationState,
  _classified: ClassifiedIntent,
  _message: string,
  lang: Language,
  _channel: string
): ReceptionistResponse {
  if (getHandoffConfig().mode !== 'callback') {
    clearSession(state.sessionId);
    return {
      reply: handoffUnavailableReply(lang),
      session_id: state.sessionId,
      intent: 'human_handoff',
      language: lang,
      conversation_active: false,
    };
  }

  state = updateSession(state.sessionId, {
    intent: 'human_handoff',
    language: lang,
    step: 'ask_phone',
    collected: {},
    context: {},
  });

  return {
    reply: t('handoff_ask_phone', lang),
    session_id: state.sessionId,
    intent: 'human_handoff',
    language: lang,
    conversation_active: true,
  };
}

async function continueHandoff(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const text = message.trim();
  const collected = { ...state.collected };

  // Mode switched off mid-conversation → honest refusal, nothing recorded.
  if (getHandoffConfig().mode !== 'callback') {
    clearSession(state.sessionId);
    return {
      reply: handoffUnavailableReply(lang),
      session_id: state.sessionId,
      intent: 'human_handoff',
      language: lang,
      conversation_active: false,
    };
  }

  if (state.step === 'ask_phone') {
    // Phone is required — missing/invalid numbers are never accepted and never stored.
    if (!isValidCallbackPhone(text)) {
      return {
        reply: t('reg_invalid_phone', lang),
        session_id: state.sessionId,
        intent: 'human_handoff',
        language: lang,
        conversation_active: true,
      };
    }
    collected.phone = normalizePhone(text);
    state = updateSession(state.sessionId, { step: 'ask_reason', collected });
    return {
      reply: t('handoff_ask_reason', lang, { phone: collected.phone }),
      session_id: state.sessionId,
      intent: 'human_handoff',
      language: lang,
      conversation_active: true,
    };
  }

  if (state.step === 'ask_reason') {
    let reason: string | null = null;
    if (!isNegative(text) && !/^(none|nothing|koi nahi|nhi|skip|skip it)$/i.test(text.trim())) {
      if (text.length > 200) {
        return {
          reply: t('handoff_reason_too_long', lang),
          session_id: state.sessionId,
          intent: 'human_handoff',
          language: lang,
          conversation_active: true,
        };
      }
      reason = text;
    }

    // Persist (idempotent: same session/phone → existing pending request).
    const { request, duplicate } = createCallbackRequest({
      session_id: state.sessionId,
      channel,
      language: lang,
      phone: collected.phone || '',
      reason,
    });

    if (!duplicate) {
      // Redacted metadata only — never the phone number, never free text.
      recordAiEvent(state.sessionId, channel, 'callback_requested', {
        callback_id: request.id,
        language: lang,
      });
    }

    const cfg = getHandoffConfig();
    const hoursSla = hoursSlaText(cfg, lang);
    const reply = duplicate
      ? t('handoff_duplicate', lang, { phone: request.phone, hours_sla: hoursSla })
      : t('handoff_recorded', lang, { phone: request.phone, hours_sla: hoursSla });

    clearSession(state.sessionId);
    return {
      reply,
      session_id: state.sessionId,
      intent: 'human_handoff',
      action: duplicate ? undefined : { type: 'callback_requested', data: { callback_id: request.id } },
      language: lang,
      conversation_active: false,
    };
  }

  clearSession(state.sessionId);
  return handleMessage(message, null, lang, channel);
}

// ── Registration Flow ──

async function startRegistration(
  state: ConversationState,
  classified: ClassifiedIntent,
  lang: Language
): Promise<ReceptionistResponse> {
  // Check if CNIC was provided in the message
  if (classified.entities.cnic && isValidCNIC(classified.entities.cnic)) {
    const db = getDb();
    const existing = db.query("SELECT * FROM patients WHERE cnic = ?").get(classified.entities.cnic) as Patient | undefined;
    if (existing) {
      state = updateSession(state.sessionId, {
        intent: 'register_patient',
        language: lang,
        step: 'init',
        collected: { cnic: classified.entities.cnic },
      });
      return {
        reply: t('reg_cnic_exists', lang, { cnic: classified.entities.cnic }),
        session_id: state.sessionId,
        intent: 'register_patient',
        language: lang,
        conversation_active: true,
        action: { type: 'patient_found', data: { patient_id: existing.patient_id } },
      };
    }
  }

  state = updateSession(state.sessionId, {
    intent: 'register_patient',
    language: lang,
    step: 'ask_full_name',
    collected: {},
  });

  return {
    reply: t('reg_ask_full_name', lang),
    session_id: state.sessionId,
    intent: 'register_patient',
    language: lang,
    conversation_active: true,
  };
}

async function continueFlow(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  switch (state.intent) {
    case 'register_patient':
      return continueRegistration(state, message, lang, channel);
    case 'book_appointment':
      return continueBooking(state, message, lang, channel);
    case 'check_appointment':
      return continueCheckAppointment(state, message, lang, channel);
    case 'triage':
      return continueTriage(state, message, lang, channel);
    case 'cancel_reschedule':
      return continueCancelReschedule(state, message, lang, channel);
    case 'human_handoff':
      return continueHandoff(state, message, lang, channel);
    default:
      // Restart classification
      clearSession(state.sessionId);
      const newState = getOrCreateSession(null);
      return handleMessage(message, newState.sessionId, lang, channel);
  }
}

async function continueRegistration(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const text = message.trim();
  const step = state.step;
  const collected = { ...state.collected };

  const stepIdx = getStepIndex(REGISTRATION_STEPS, step);

  // If we're on confirm step
  if (step === 'confirm') {
    if (isAffirmative(text)) {
      // Create patient
      try {
        const db = getDb();
        const now = new Date().toISOString();

        // Generate patient ID
        const last = db.query("SELECT patient_id FROM patients ORDER BY id DESC LIMIT 1").get() as { patient_id: string } | undefined;
        const num = last ? parseInt(last.patient_id.replace("SC-PT-", ""), 10) + 1 : 1;
        const patientId = `SC-PT-${String(num).padStart(6, "0")}`;

        db.run(
          `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [patientId, collected.full_name, collected.dob, collected.gender.toLowerCase(),
           collected.cnic, collected.phone.replace(/[-\s]/g, ''), collected.address,
           collected.emergency_contact.replace(/[-\s]/g, ''), now, now]
        );

        recordAiEvent(state.sessionId, channel, 'patient_created', { patient_id: patientId });

        clearSession(state.sessionId);
        return {
          reply: t('reg_success', lang, { patient_id: patientId }),
          session_id: state.sessionId,
          intent: 'register_patient',
          action: { type: 'patient_created', data: { patient_id: patientId } },
          language: lang,
          conversation_active: false,
        };
      } catch (err) {
        return {
          reply: lang === 'ur'
            ? `Maazrat, registration mein masla ho gaya. Baraye meherbani dobara koshish karein. (${err instanceof Error ? err.message : 'Unknown error'})`
            : `Sorry, there was an issue with registration. Please try again. (${err instanceof Error ? err.message : 'Unknown error'})`,
          session_id: state.sessionId,
          intent: 'register_patient',
          language: lang,
          conversation_active: false,
        };
      }
    } else if (isNegative(text)) {
      // Start over
      clearSession(state.sessionId);
      const newState = getOrCreateSession(null);
      return {
        reply: t('negative_responses', lang),
        session_id: newState.sessionId,
        intent: 'unknown',
        language: lang,
        conversation_active: false,
      };
    } else {
      // Ask again
      return {
        reply: lang === 'ur' ? 'Baraye meherbani haan ya nahi mein jawab dein. Kya yeh maloomat durust hai?' : 'Please answer yes or no. Is this information correct?',
        session_id: state.sessionId,
        intent: 'register_patient',
        language: lang,
        conversation_active: true,
      };
    }
  }

  // Map step to field name
  const fieldMap: Record<string, string> = {
    ask_full_name: 'full_name',
    ask_cnic: 'cnic',
    ask_dob: 'dob',
    ask_gender: 'gender',
    ask_phone: 'phone',
    ask_address: 'address',
    ask_emergency_contact: 'emergency_contact',
  };

  const field = fieldMap[step];

  if (!field) {
    clearSession(state.sessionId);
    return handleMessage(message, null, lang, channel);
  }

  // Validate and store
  let valid = true;
  let errorKey = '';

  switch (field) {
    case 'full_name': {
      const sanitized = sanitizeName(text);
      if (sanitized.length < 2) { valid = false; errorKey = 'validation_required'; }
      else { collected.full_name = sanitized; }
      break;
    }
    case 'cnic': {
      const sanitized = formatAndSanitizeCNIC(text);
      if (!sanitized) { valid = false; errorKey = 'reg_invalid_cnic'; }
      else {
        const db = getDb();
        const existing = db.query("SELECT * FROM patients WHERE cnic = ?").get(sanitized) as Patient | undefined;
        if (existing) {
          return {
            reply: t('reg_cnic_exists', lang, { cnic: sanitized }),
            session_id: state.sessionId,
            intent: 'register_patient',
            language: lang,
            conversation_active: true,
            action: { type: 'patient_found', data: { patient_id: existing.patient_id } },
          };
        }
        collected.cnic = sanitized;
      }
      break;
    }
    case 'dob': {
      const sanitized = parseAndFormatDOB(text);
      if (!sanitized || !isValidDOB(text)) { valid = false; errorKey = 'reg_invalid_dob'; }
      else { collected.dob = sanitized; }
      break;
    }
    case 'gender': {
      const sanitized = sanitizeGender(text);
      if (!sanitized) { valid = false; errorKey = 'reg_invalid_gender'; }
      else { collected.gender = sanitized; }
      break;
    }
    case 'phone': {
      const sanitized = formatAndSanitizePhone(text);
      if (!sanitized) { valid = false; errorKey = 'reg_invalid_phone'; }
      else { collected.phone = sanitized; }
      break;
    }
    case 'address': {
      const sanitized = text.trim();
      if (sanitized.length < 5) { valid = false; errorKey = 'validation_required'; }
      else { collected.address = sanitized; }
      break;
    }
    case 'emergency_contact': {
      const sanitized = formatAndSanitizePhone(text);
      if (!sanitized) { valid = false; errorKey = 'reg_invalid_phone'; }
      else { collected.emergency_contact = sanitized; }
      break;
    }
  }

  if (!valid) {
    return {
      reply: t(errorKey || 'validation_required', lang),
      session_id: state.sessionId,
      intent: 'register_patient',
      language: lang,
      conversation_active: true,
    };
  }

  // Get next step
  const nextStepIdx = stepIdx + 1;

  if (nextStepIdx >= REGISTRATION_STEPS.length) {
    // Shouldn't happen, but just in case
    clearSession(state.sessionId);
    return handleMessage(message, null, lang, channel);
  }

  const nextStep = REGISTRATION_STEPS[nextStepIdx];

  if (nextStep === 'confirm') {
    state = updateSession(state.sessionId, {
      step: 'confirm',
      collected,
    });

    return {
      reply: t('reg_confirm', lang, collected),
      session_id: state.sessionId,
      intent: 'register_patient',
      language: lang,
      conversation_active: true,
    };
  }

  // Map next step to question key
  const promptMap: Record<string, string> = {
    ask_full_name: 'reg_ask_full_name',
    ask_cnic: 'reg_ask_cnic',
    ask_dob: 'reg_ask_dob',
    ask_gender: 'reg_ask_gender',
    ask_phone: 'reg_ask_phone',
    ask_address: 'reg_ask_address',
    ask_emergency_contact: 'reg_ask_emergency_contact',
  };

  state = updateSession(state.sessionId, {
    step: nextStep,
    collected,
  });

  return {
    reply: t(promptMap[nextStep] || 'reg_ask_full_name', lang),
    session_id: state.sessionId,
    intent: 'register_patient',
    language: lang,
    conversation_active: true,
  };
}

// ── Booking Flow ──

async function startBooking(
  state: ConversationState,
  classified: ClassifiedIntent,
  lang: Language
): Promise<ReceptionistResponse> {
  state = updateSession(state.sessionId, {
    intent: 'book_appointment',
    language: lang,
    step: 'ask_is_patient',
    collected: {},
    context: {},
  });

  return {
    reply: t('book_ask_is_patient', lang),
    session_id: state.sessionId,
    intent: 'book_appointment',
    language: lang,
    conversation_active: true,
  };
}

async function continueBooking(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const text = message.trim();
  const step = state.step;
  const collected = { ...state.collected };
  const context = { ...state.context };

  // ask_is_patient step
  if (step === 'ask_is_patient') {
    if (isAffirmative(text)) {
      state = updateSession(state.sessionId, { step: 'ask_identifier' });
      return {
        reply: t('book_ask_identifier', lang),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    } else {
      // New patient — redirect to registration
      clearSession(state.sessionId);
      const newState = getOrCreateSession(null);
      // Auto-classify as registration
      return startRegistration(newState, { intent: 'register_patient', confidence: 1, entities: {} }, lang);
    }
  }

  // ask_identifier step
  if (step === 'ask_identifier') {
    if (!sensitiveVerifier.verify(state.sessionId, text)) return { reply: SENSITIVE_OPERATION_MESSAGE, session_id: state.sessionId, intent: 'book_appointment', language: lang, conversation_active: false };
    const patient = findPatientByIdentifier(text);

    // Track failed lookup attempts
    const lookupAttempts = (typeof context.lookupAttempts === 'number' ? context.lookupAttempts : 0) + 1;
    context.lookupAttempts = lookupAttempts;

    if (!patient) {
      // After 3 failed attempts, offer escape — register as new patient or try different info
      if (lookupAttempts >= 3) {
        clearSession(state.sessionId);
        return {
          reply: lang === 'ur'
            ? `Mujhe ab tak aapka record nahi mila. Kya aap:\n• Dobara alag maloomat ke saath koshish karna chahenge?\n• Naye patient ke taur par register karna chahenge?\n\nBaraye meherbani jawab dein.`
            : `I still couldn't find your record after several attempts. Would you like to:\n• Try again with different information (CNIC, phone, or full name)?\n• Register as a new patient?\n\nPlease let me know how you'd like to proceed.`,
          session_id: state.sessionId,
          intent: 'book_appointment',
          language: lang,
          conversation_active: false,
        };
      }

      state = updateSession(state.sessionId, {
        step: 'ask_identifier',
        collected,
        context,
      });

      return {
        reply: t('check_no_patient', lang, { query: text }) + (lookupAttempts >= 2 ? (lang === 'ur' ? '\n\nEk aur koshish — kya aap apna CNIC ya phone number dena chahenge?' : '\n\nOne more try — would you like to provide your CNIC or phone number instead?') : ''),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    // Reset lookup attempts on success
    context.lookupAttempts = 0;
    collected.patient_id = String(patient.id);

    // Move to doctor selection
    const db = getDb();
    const doctors = db.query("SELECT * FROM doctors WHERE status = 'active' ORDER BY name").all() as Doctor[];
    context.doctors = doctors;

    state = updateSession(state.sessionId, {
      step: 'ask_doctor',
      collected,
      context,
    });

    return {
      reply: t('book_ask_doctor', lang, { doctor_list: formatDoctorList(doctors, lang) }),
      session_id: state.sessionId,
      intent: 'book_appointment',
      language: lang,
      conversation_active: true,
    };
  }

  // ask_doctor step
  if (step === 'ask_doctor') {
    const doctor = findDoctor(text);
    if (!doctor) {
      const db = getDb();
      const doctors = db.query("SELECT * FROM doctors WHERE status = 'active' ORDER BY name").all() as Doctor[];
      return {
        reply: t('book_no_doctor', lang, { query: text, doctor_list: formatDoctorList(doctors, lang) }),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    collected.doctor_id = String(doctor.id);
    collected.doctor_name = doctor.name;
    collected.specialization = doctor.specialization;
    collected.fee = String(doctor.fee);
    context.selectedDoctor = doctor;

    // Show schedule info
    const db = getDb();
    const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ? ORDER BY day_of_week").all(doctor.id) as DoctorSchedule[];
    if (schedules.length === 0) {
      return {
        reply: t('book_doctor_unconfigured', lang, { doctor_name: doctor.name }),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const scheduleInfo = schedules.map(s => `${dayNames[s.day_of_week]}: ${s.start_time}-${s.end_time}`).join(', ');

    state = updateSession(state.sessionId, {
      step: 'ask_date',
      collected,
      context,
    });

    return {
      reply: t('book_ask_date', lang, { doctor_name: doctor.name, schedule_info: scheduleInfo }),
      session_id: state.sessionId,
      intent: 'book_appointment',
      language: lang,
      conversation_active: true,
    };
  }

  // ask_date step
  if (step === 'ask_date') {
    const dateMatch = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
    if (!dateMatch) {
      return {
        reply: t('book_invalid_date', lang),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    const date = dateMatch[0];
    const dateValidation = validateCalendarDate(date);
    if (!dateValidation.ok) {
      return {
        reply: t('book_invalid_date', lang),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    collected.date = date;

    // Get slots for this date
    const db = getDb();
    const doctorId = Number(collected.doctor_id);
    const dayOfWeek = dateValidation.ok ? dateValidation.dayOfWeek : -1;
    const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?").all(doctorId, dayOfWeek) as DoctorSchedule[];

    if (schedules.length === 0) {
      return {
        reply: t('book_no_schedule_on_day', lang, { doctor_name: collected.doctor_name, date }),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    // Build available slots
    const availableSlots = getAvailableSlots(db, doctorId, date);
    if (availableSlots.length === 0) {
      return {
        reply: t('book_fully_booked', lang, { doctor_name: collected.doctor_name, date }),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    context.availableSlots = availableSlots;
    const slotsText = availableSlots.map(s => `• ${s.start_time} — ${s.end_time}`).join('\n');

    state = updateSession(state.sessionId, {
      step: 'ask_time',
      collected,
      context,
    });

    return {
      reply: t('book_ask_time', lang, { doctor_name: collected.doctor_name, date, slots: slotsText }),
      session_id: state.sessionId,
      intent: 'book_appointment',
      language: lang,
      conversation_active: true,
    };
  }

  // ask_time step
  if (step === 'ask_time') {
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!timeMatch) {
      // Re-list slots
      const availableSlots = context.availableSlots as Array<{ start_time: string; end_time: string }> || [];
      const slotsText = availableSlots.map(s => `• ${s.start_time} — ${s.end_time}`).join('\n');
      return {
        reply: t('book_ask_time', lang, { doctor_name: collected.doctor_name, date: collected.date, slots: slotsText }),
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    const h = timeMatch[1].padStart(2, '0');
    const m = timeMatch[2];
    const time = `${h}:${m}`;

    const db = getDb();
    const timeValidation = validateAppointmentInput(db, Number(collected.doctor_id), String(collected.date), time);
    if (!timeValidation.ok) {
      const slots = getAvailableSlots(db, Number(collected.doctor_id), String(collected.date));
      updateSession(state.sessionId, { context: { ...context, availableSlots: slots } });
      return { reply: `${timeValidation.message} Available slots: ${slots.map(s => s.start_time).join(', ')}`, session_id: state.sessionId, intent: 'book_appointment', language: lang, conversation_active: true };
    }
    collected.time = time;

    // Confirm
    state = updateSession(state.sessionId, {
      step: 'confirm',
      collected,
      context,
    });

    return {
      reply: t('book_confirm', lang, {
        doctor_name: collected.doctor_name,
        specialization: collected.specialization,
        date: collected.date,
        time: collected.time,
        fee: collected.fee,
      }),
      session_id: state.sessionId,
      intent: 'book_appointment',
      language: lang,
      conversation_active: true,
    };
  }

  // confirm step
  if (step === 'confirm') {
    if (isAffirmative(text)) {
      // Create the appointment
      const db = getDb();
      const patientId = Number(collected.patient_id);
      const doctorId = Number(collected.doctor_id);
      const date = collected.date;
      const startTime = collected.time;

      // A slot raced away (concurrent booking). Roll back to the time-selection
      // step with the still-live slots so the patient can pick another time
      // without restarting the conversation.
      const slotConflictReply = () => {
        const slots = getAvailableSlots(db, doctorId, date);
        const collectedWithoutTime = { ...collected };
        delete collectedWithoutTime.time;
        updateSession(state.sessionId, {
          step: 'ask_time',
          collected: collectedWithoutTime,
          context: { ...context, availableSlots: slots },
        });
        return {
          reply: `This slot was just booked. Available slots: ${slots.map(s => s.start_time).join(', ') || 'Please choose another date or doctor.'}`,
          session_id: state.sessionId,
          intent: 'book_appointment',
          language: lang,
          conversation_active: true,
        };
      };
      try {
        const finalValidation = validateAppointmentInput(db, doctorId, date, startTime);
        if (!finalValidation.ok) {
          return { reply: finalValidation.message, session_id: state.sessionId, intent: 'book_appointment', language: lang, conversation_active: true };
        }

        // The partial unique index makes this insert atomic against concurrent bookings.
        if (db.query(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ? AND status IN ('scheduled', 'checked-in', 'completed')`).get(doctorId, date, startTime)) {
          return slotConflictReply();
        }

        // Schedule and slot validity are centralized in validateAppointmentInput above.
        const now = new Date().toISOString();
        // Map conversation channel to appointment booking source: chat→'chat', voice→'voice', twilio→'twilio'
        const source: string = channel === 'chat' ? 'chat' : channel === 'twilio' ? 'twilio' : 'voice';
        const result = db.run(
          `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
          [patientId, doctorId, date, startTime, finalValidation.endTime, source, now, now]
        );

        recordAiEvent(state.sessionId, channel, 'appointment_created', {
          appointment_id: result.lastInsertRowid,
          doctor_name: collected.doctor_name,
          date,
          time: startTime,
          // NOTE: no patient_name / free-text PHI here — privacy baseline
          // (docs/security-privacy-baseline.md): AI event details never include
          // names. The appointment_id links back to the record for staff.
        });

        clearSession(state.sessionId);

        return {
          reply: t('book_success', lang, {
            appointment_id: String(result.lastInsertRowid),
            doctor_name: collected.doctor_name,
            date,
            time: startTime,
          }),
          session_id: state.sessionId,
          intent: 'book_appointment',
          action: { type: 'appointment_created', data: { appointment_id: result.lastInsertRowid, doctor_name: collected.doctor_name, date, time: startTime } },
          language: lang,
          conversation_active: false,
        };
      } catch (err) {
        // Lost a race for this slot (unique index backstop) → offer fresh slots.
        if (String(err).toLowerCase().includes('unique')) {
          return slotConflictReply();
        }
        return {
          reply: lang === 'ur'
            ? `Maazrat, booking mein masla ho gaya. Baraye meherbani dobara koshish karein.`
            : `Sorry, there was an issue with booking. Please try again.`,
          session_id: state.sessionId,
          intent: 'book_appointment',
          language: lang,
          conversation_active: false,
        };
      }
    } else if (isNegative(text)) {
      clearSession(state.sessionId);
      const newState = getOrCreateSession(null);
      return {
        reply: t('negative_responses', lang),
        session_id: newState.sessionId,
        intent: 'unknown',
        language: lang,
        conversation_active: false,
      };
    } else {
      return {
        reply: lang === 'ur' ? 'Baraye meherbani haan ya nahi mein jawab dein.' : 'Please answer yes or no. Shall I book this appointment?',
        session_id: state.sessionId,
        intent: 'book_appointment',
        language: lang,
        conversation_active: true,
      };
    }
  }

  // Shouldn't reach here
  clearSession(state.sessionId);
  return handleMessage(message, null, lang, channel);
}

// ── Check Appointment Flow ──

async function startCheckAppointment(
  state: ConversationState,
  classified: ClassifiedIntent,
  lang: Language
): Promise<ReceptionistResponse> {
  state = updateSession(state.sessionId, {
    intent: 'check_appointment',
    language: lang,
    step: 'ask_identifier',
    collected: {},
    context: {},
  });

  return {
    reply: t('check_ask_identifier', lang),
    session_id: state.sessionId,
    intent: 'check_appointment',
    language: lang,
    conversation_active: true,
  };
}

async function continueCheckAppointment(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const text = message.trim();

  if (state.step === 'ask_identifier') {
    if (!sensitiveVerifier.verify(state.sessionId, text)) return { reply: SENSITIVE_OPERATION_MESSAGE, session_id: state.sessionId, intent: 'check_appointment', language: lang, conversation_active: false };
    const patient = findPatientByIdentifier(text);
    if (!patient) {
      return {
        reply: t('check_no_patient', lang, { query: text }),
        session_id: state.sessionId,
        intent: 'check_appointment',
        language: lang,
        conversation_active: true,
      };
    }

    const db = getDb();
    const appointments = db.query(
      `SELECT a.*, d.name as doctor_name, d.specialization as doctor_specialization
       FROM appointments a JOIN doctors d ON a.doctor_id = d.id
       WHERE a.patient_id = ? AND a.status NOT IN ('cancelled', 'no-show')
       ORDER BY a.date DESC, a.start_time ASC LIMIT 20`
    ).all(patient.id) as Array<Appointment & { doctor_name: string; doctor_specialization: string }>;

    recordAiEvent(state.sessionId, channel, 'appointments_list', { patient_id: patient.patient_id, count: appointments.length });
    clearSession(state.sessionId);

    if (appointments.length === 0) {
      return {
        reply: t('check_no_appointments', lang, { patient_name: patient.full_name }),
        session_id: state.sessionId,
        intent: 'check_appointment',
        language: lang,
        conversation_active: false,
      };
    }

    return {
      reply: t('check_results', lang, {
        patient_name: patient.full_name,
        appointments: formatAppointmentList(appointments, lang),
      }),
      session_id: state.sessionId,
      intent: 'check_appointment',
      language: lang,
      conversation_active: false,
      action: { type: 'appointments_list', data: { patient_id: patient.patient_id, count: appointments.length } },
    };
  }

  clearSession(state.sessionId);
  return handleMessage(message, null, lang, channel);
}

// ── FAQ Flow ──

function handleFAQ(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const faq = findFAQ(message);
  recordAiEvent(state.sessionId, channel, 'faq', { topic: faq ? faq.topic : 'general' });
  clearSession(state.sessionId);

  return Promise.resolve({
    reply: formatFAQAnswer(faq, lang),
    session_id: state.sessionId,
    intent: 'faq',
    language: lang,
    conversation_active: false,
  });
}

// ── Triage Flow ──

function startTriage(
  state: ConversationState,
  classified: ClassifiedIntent,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const symptom = classified.entities.symptom || 'symptoms';

  // Emergency red-flag check — runs against the FULL utterance (not just the
  // extracted symptom entity, which is a single keyword and misses phrases like
  // 'seena mein dard' or 'saans nahi aa rahi'). Shared deterministic module,
  // escalation only, no diagnosis.
  const redFlag = detectRedFlag(message) || detectRedFlag(classified.entities.symptom || '');

  if (redFlag) {
    recordAiEvent(state.sessionId, channel, 'triage', { outcome: 'emergency', red_flag: redFlag.category });
    clearSession(state.sessionId);
    return Promise.resolve({
      reply: maybeAppendHandoffOffer(t('triage_emergency', lang), lang),
      session_id: state.sessionId,
      intent: 'triage',
      language: lang,
      conversation_active: false,
    });
  }

  state = updateSession(state.sessionId, {
    intent: 'triage',
    language: lang,
    step: 'ask_severity',
    collected: { symptom },
    context: {},
  });

  return Promise.resolve({
    reply: t('triage_ask_severity', lang, { symptom }),
    session_id: state.sessionId,
    intent: 'triage',
    language: lang,
    conversation_active: true,
  });
}

async function continueTriage(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const text = message.trim();
  const collected = { ...state.collected };

  if (state.step === 'ask_severity') {
    // Only a numeric 1–10 severity is accepted. A missing or unparseable value
    // must NEVER default to a severity — re-ask for the number. Out-of-range
    // values (0, 11, 50, …) are rejected the same way.
    const severityMatch = text.match(/(?<![-\d])\b(\d{1,2})\b/);
    const severity = severityMatch ? parseInt(severityMatch[1], 10) : NaN;

    if (!severityMatch || Number.isNaN(severity) || severity < 1 || severity > 10) {
      return {
        reply: t('triage_severity_invalid', lang),
        session_id: state.sessionId,
        intent: 'triage',
        language: lang,
        conversation_active: true,
      };
    }

    if (severity >= 8) {
      recordAiEvent(state.sessionId, channel, 'triage', { severity, outcome: 'emergency' });
      clearSession(state.sessionId);
      return {
        reply: maybeAppendHandoffOffer(t('triage_emergency', lang), lang),
        session_id: state.sessionId,
        intent: 'triage',
        language: lang,
        conversation_active: false,
      };
    }

    collected.severity = String(severity);
    state = updateSession(state.sessionId, {
      step: 'ask_duration',
      collected,
    });

    return {
      reply: t('triage_ask_duration', lang),
      session_id: state.sessionId,
      intent: 'triage',
      language: lang,
      conversation_active: true,
    };
  }

  if (state.step === 'ask_duration') {
    collected.duration = text;

    // Check for red flags in duration
    const severity = parseInt(collected.severity) || 5;
    const lower = text.toLowerCase();
    // Long-duration markers — English + Roman Urdu, including the oblique/plural
    // variants 'hafte'/'haftey' (hafta) and 'mahine'/'maheene' (mahina) that
    // callers actually use ('do hafte', 'teen mahine').
    const isLongDuration =
      /\b(week|weeks|month|months|year|years|hafta|hafte|haftey|maah|mahina|mahine|maheene|saal)\b/i.test(lower) ||
      (/\b(\d+)\s*(day|din)\b/i.test(lower) && parseInt(lower.match(/\d+/)?.[0] || '0', 10) > 7);

    clearSession(state.sessionId);

    if (severity >= 6 || isLongDuration) {
      // Recommend booking an appointment
      const specialtyInfo = lang === 'ur'
        ? 'Aap doctor se mil kar apna checkup karwayein.'
        : 'Please see a doctor for a proper checkup.';

      const disclaimer = t('triage_disclaimer', lang);
      recordAiEvent(state.sessionId, channel, 'triage', { severity, outcome: 'see_doctor' });
      return {
        reply: t('triage_recommend_doctor', lang, { specialty_info: specialtyInfo }) + '\n\n' + disclaimer,
        session_id: state.sessionId,
        intent: 'triage',
        language: lang,
        conversation_active: false,
      };
    } else {
      const disclaimer = t('triage_disclaimer', lang);
      recordAiEvent(state.sessionId, channel, 'triage', { severity, outcome: 'self_care' });
      return {
        reply: t('triage_recommend_rest', lang) + '\n\n' + disclaimer,
        session_id: state.sessionId,
        intent: 'triage',
        language: lang,
        conversation_active: false,
      };
    }
  }

  clearSession(state.sessionId);
  return handleMessage(message, null, lang, channel);
}

// ── Cancel/Reschedule Flow ──

async function startCancelReschedule(
  state: ConversationState,
  classified: ClassifiedIntent,
  lang: Language
): Promise<ReceptionistResponse> {
  // Detect if it's cancel or reschedule from the message
  const lower = classified.entities.symptom || '';
  const isReschedule = /\breschedule\b|\bchange\b|\bbadal|\btabdeel\b/i.test(lower);

  state = updateSession(state.sessionId, {
    intent: 'cancel_reschedule',
    language: lang,
    step: 'ask_identifier',
    collected: { action: isReschedule ? 'reschedule' : 'cancel' },
    context: {},
  });

  return {
    reply: t('cancel_ask_identifier', lang),
    session_id: state.sessionId,
    intent: 'cancel_reschedule',
    language: lang,
    conversation_active: true,
  };
}

async function continueCancelReschedule(
  state: ConversationState,
  message: string,
  lang: Language,
  channel: string
): Promise<ReceptionistResponse> {
  const text = message.trim();
  const collected = { ...state.collected };
  const context = { ...state.context };

  if (state.step === 'ask_identifier') {
    if (!sensitiveVerifier.verify(state.sessionId, text)) return { reply: SENSITIVE_OPERATION_MESSAGE, session_id: state.sessionId, intent: 'cancel_reschedule', language: lang, conversation_active: false };
    const patient = findPatientByIdentifier(text);
    if (!patient) {
      return {
        reply: t('check_no_patient', lang, { query: text }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    collected.patient_id = String(patient.id);

    const db = getDb();
    const appointments = db.query(
      `SELECT a.*, d.name as doctor_name, d.specialization as doctor_specialization
       FROM appointments a JOIN doctors d ON a.doctor_id = d.id
       WHERE a.patient_id = ? AND a.status = 'scheduled'
       ORDER BY a.date ASC, a.start_time ASC LIMIT 20`
    ).all(patient.id) as Array<Appointment & { doctor_name: string; doctor_specialization: string }>;

    if (appointments.length === 0) {
      clearSession(state.sessionId);
      return {
        reply: t('cancel_no_appointments', lang, { patient_name: patient.full_name }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: false,
      };
    }

    context.appointments = appointments;

    state = updateSession(state.sessionId, {
      step: 'show_appointments',
      collected,
      context,
    });

    return {
      reply: t('cancel_show_appointments', lang, {
        patient_name: patient.full_name,
        appointments: formatAppointmentList(appointments, lang),
      }),
      session_id: state.sessionId,
      intent: 'cancel_reschedule',
      language: lang,
      conversation_active: true,
    };
  }

  if (state.step === 'show_appointments') {
    // User selects which appointment
    const appointments = context.appointments as Array<Appointment & { doctor_name: string }> || [];
    const numMatch = text.match(/\b(\d+)\b/);
    let selected: Appointment & { doctor_name: string } | null = null;

    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1;
      if (idx >= 0 && idx < appointments.length) {
        selected = appointments[idx];
      }
    }

    if (!selected) {
      // Try to match by appointment ID
      const idMatch = text.match(/\b(\d+)\b/);
      if (idMatch) {
        selected = appointments.find(a => a.id === parseInt(idMatch[1])) || null;
      }
    }

    if (!selected) {
      return {
        reply: lang === 'ur'
          ? 'Baraye meherbani appointment number batayein.'
          : 'Please specify which appointment by its number.',
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    collected.appointment_id = String(selected.id);
    collected.doctor_name = selected.doctor_name;
    collected.doctor_id = String(selected.doctor_id);
    collected.date = selected.date;
    collected.time = selected.start_time;

    const action = collected.action || 'cancel';

    if (action === 'reschedule') {
      state = updateSession(state.sessionId, {
        step: 'ask_new_date',
        collected,
        context,
      });

      return {
        reply: t('reschedule_ask_date', lang),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    // For cancel: confirm
    state = updateSession(state.sessionId, {
      step: 'confirm_cancel',
      collected,
      context,
    });

    return {
      reply: t('cancel_confirm', lang, {
        doctor_name: selected.doctor_name,
        date: selected.date,
        time: selected.start_time,
      }),
      session_id: state.sessionId,
      intent: 'cancel_reschedule',
      language: lang,
      conversation_active: true,
    };
  }

  if (state.step === 'confirm_cancel') {
    if (isAffirmative(text)) {
      const db = getDb();
      const apptId = Number(collected.appointment_id);
      const now = new Date().toISOString();

      db.run("UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelled by patient via AI receptionist', updated_at = ? WHERE id = ?", [now, apptId]);

      recordAiEvent(state.sessionId, channel, 'appointment_cancelled', { appointment_id: apptId });
      clearSession(state.sessionId);

      return {
        reply: t('cancel_success', lang, {
          doctor_name: collected.doctor_name,
          date: collected.date,
          time: collected.time,
        }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: false,
        action: { type: 'appointment_cancelled', data: { appointment_id: apptId } },
      };
    } else {
      clearSession(state.sessionId);
      return {
        reply: t('negative_responses', lang),
        session_id: state.sessionId,
        intent: 'unknown',
        language: lang,
        conversation_active: false,
      };
    }
  }

  if (state.step === 'ask_new_date') {
    const dateMatch = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
    if (!dateMatch) {
      return {
        reply: t('book_invalid_date', lang),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    const newDate = dateMatch[0];
    // Strict calendar validation — rejects impossible dates (e.g. 2026-02-31) and past dates.
    const dateValidation = validateCalendarDate(newDate);
    if (!dateValidation.ok) {
      return {
        reply: t('book_invalid_date', lang),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }
    collected.new_date = newDate;

    // Get live slots for new date (shared slot generation in ../appointments/validation).
    const db = getDb();
    const doctorId = Number(collected.doctor_id);
    const dayOfWeek = dateValidation.ok ? dateValidation.dayOfWeek : -1;
    const schedules = db.query("SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?").all(doctorId, dayOfWeek) as DoctorSchedule[];

    if (schedules.length === 0) {
      return {
        reply: t('book_no_schedule_on_day', lang, { doctor_name: collected.doctor_name, date: newDate }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    const availableSlots = getAvailableSlots(db, doctorId, newDate);
    if (availableSlots.length === 0) {
      return {
        reply: t('book_fully_booked', lang, { doctor_name: collected.doctor_name, date: newDate }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    context.availableSlots = availableSlots;
    const slotsText = availableSlots.map(s => `• ${s.start_time} — ${s.end_time}`).join('\n');

    state = updateSession(state.sessionId, {
      step: 'ask_new_time',
      collected,
      context,
    });

    return {
      reply: t('reschedule_ask_time', lang, { date: newDate, slots: slotsText }),
      session_id: state.sessionId,
      intent: 'cancel_reschedule',
      language: lang,
      conversation_active: true,
    };
  }

  if (state.step === 'ask_new_time') {
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!timeMatch) {
      const availableSlots = context.availableSlots as Array<{ start_time: string; end_time: string }> || [];
      const slotsText = availableSlots.map(s => `• ${s.start_time} — ${s.end_time}`).join('\n');
      return {
        reply: t('reschedule_ask_time', lang, { date: collected.new_date, slots: slotsText }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }

    const h = timeMatch[1].padStart(2, '0');
    const m = timeMatch[2];
    const newTime = `${h}:${m}`;
    const db = getDb();
    const apptId = Number(collected.appointment_id);
    const newDate = collected.new_date;
    const doctorId = Number(collected.doctor_id);
    // Shared validation — only live generated slots are acceptable.
    const timeValidation = validateAppointmentInput(db, doctorId, newDate, newTime);
    if (!timeValidation.ok) {
      const slots = getAvailableSlots(db, doctorId, newDate);
      return {
        reply: `${timeValidation.message} Available slots: ${slots.map(s => s.start_time).join(', ')}`,
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }
    // Slot already held (or raced away) → offer what is still live.
    if (db.query(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ? AND id != ? AND status IN ('scheduled', 'checked-in', 'completed')`).get(doctorId, newDate, newTime, apptId)) {
      const slots = getAvailableSlots(db, doctorId, newDate);
      return {
        reply: `This slot was just booked. Available slots: ${slots.map(s => s.start_time).join(', ') || 'Please choose another date or doctor.'}`,
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: true,
      };
    }
    const endTime = timeValidation.endTime;
    try {
      const now = new Date().toISOString();
      db.run(
        "UPDATE appointments SET date = ?, start_time = ?, end_time = ?, cancellation_reason = 'Rescheduled by patient via AI receptionist', updated_at = ? WHERE id = ?",
        [newDate, newTime, endTime, now, apptId]
      );

      recordAiEvent(state.sessionId, channel, 'appointment_rescheduled', { appointment_id: apptId, new_date: newDate, new_time: newTime });
      clearSession(state.sessionId);

      return {
        reply: t('reschedule_success', lang, {
          doctor_name: collected.doctor_name,
          date: newDate,
          time: newTime,
        }),
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: false,
        action: { type: 'appointment_rescheduled', data: { appointment_id: apptId, new_date: newDate, new_time: newTime } },
      };
    } catch (err) {
      // Lost a race for the target slot (unique index backstop) → offer fresh slots.
      if (String(err).toLowerCase().includes('unique')) {
        const slots = getAvailableSlots(db, doctorId, newDate);
        return {
          reply: `This slot was just booked. Available slots: ${slots.map(s => s.start_time).join(', ') || 'Please choose another date or doctor.'}`,
          session_id: state.sessionId,
          intent: 'cancel_reschedule',
          language: lang,
          conversation_active: true,
        };
      }
      return {
        reply: lang === 'ur'
          ? 'Maazrat, reschedule mein masla ho gaya. Baraye meherbani dobara koshish karein.'
          : 'Sorry, there was an issue rescheduling. Please try again.',
        session_id: state.sessionId,
        intent: 'cancel_reschedule',
        language: lang,
        conversation_active: false,
      };
    }
  }

  clearSession(state.sessionId);
  return handleMessage(message, null, lang, channel);
}
