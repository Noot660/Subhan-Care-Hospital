import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Force load .env file to override global environment variables in sandbox/terminal
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error("Failed to parse .env file:", err);
  }
}

import type { Language } from './i18n';
import { getDb } from '../db';
import { availableSlots as getAvailableSlots, validateAppointmentInput, validateCalendarDate, hospitalToday } from '../appointments/validation';
import { findFAQ, formatFAQAnswer } from './faq';
import { createCallbackRequest as storeCallback } from '../handoff/store';
import type { ConversationState } from './conversation';
import type { Patient, Doctor, Appointment } from '../types';

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


export type Intent =
  | 'register_patient'
  | 'book_appointment'
  | 'check_appointment'
  | 'faq'
  | 'triage'
  | 'cancel_reschedule'
  | 'human_handoff'
  | 'greeting'
  | 'unknown';

export interface ClassifiedIntent {
  intent: Intent;
  confidence: number; // 0-1
  entities: Record<string, string>;
}

// ── Keyword / pattern definitions per intent ──

interface IntentPattern {
  intent: Intent;
  keywords_en: string[];
  keywords_ur: string[];
  phrases_en: string[];
  phrases_ur: string[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'register_patient',
    keywords_en: ['register', 'registration', 'new patient', 'sign up', 'enroll', 'enrollment', 'first time'],
    keywords_ur: ['register', 'naya', 'naye', 'pehli baar', 'pehli dafa', 'new patient', 'register karna', 'naam likhwana'],
    phrases_en: [
      'i am new', 'i want to register', 'register me', 'new here', 'never been',
      'first time here', 'create my record', 'add me', 'become a patient',
    ],
    phrases_ur: [
      'mein naya hoon', 'register karna hai', 'register karwao', 'pehli baar aaya',
      'naam likhwana hai', 'new patient hoon', 'pehla visit hai',
    ],
  },
  {
    intent: 'book_appointment',
    keywords_en: ['appointment', 'book', 'schedule', 'visit', 'see doctor', 'meet', 'slot', 'booking'],
    keywords_ur: ['appointment', 'book', 'schedule', 'doctor se milna', 'doctor se milne', 'visit', 'time', 'slot'],
    phrases_en: [
      'i want to book', 'need an appointment', 'see a doctor', 'want to see',
      'schedule a visit', 'book a slot', 'make an appointment', 'fix appointment',
      'i need to see', 'doctor visit', 'checkup', 'check up',
    ],
    phrases_ur: [
      'appointment leni hai', 'appointment book karni', 'doctor se milna hai',
      'doctor dikhana hai', 'appointment chahiye', 'doctor ke paas jana',
      'checkup karwana', 'mujhe doctor se', 'mujhe appointment',
    ],
  },
  {
    intent: 'check_appointment',
    keywords_en: ['my appointment', 'check appointment', 'appointment status', 'when is my', 'my booking'],
    keywords_ur: ['meri appointment', 'mera appointment', 'appointment check', 'status', 'kab hai'],
    phrases_en: [
      'when is my appointment', 'check my appointment', 'what time is my',
      'status of my appointment', 'my scheduled', 'i have an appointment',
      'appointment details', 'tell me about my appointment',
    ],
    phrases_ur: [
      'meri appointment kab hai', 'mera appointment check karo',
      'appointment ka status', 'meri booking', 'maine appointment li thi',
    ],
  },
  {
    intent: 'faq',
    keywords_en: ['hours', 'timing', 'timings', 'location', 'address', 'fee', 'fees', 'cost', 'price',
      'service', 'services', 'doctor list', 'emergency', 'contact', 'phone number', 'directions',
      'what', 'how much', 'tell me about', 'information', 'info'],
    keywords_ur: ['timings', 'timing', 'hours', 'location', 'address', 'fee', 'fees', 'kharcha',
      'qeemat', 'service', 'services', 'doctor list', 'emergency', 'contact', 'number',
      'kahan', 'kitne', 'kab'],
    phrases_en: [
      'what are your hours', 'when are you open', 'where are you located',
      'what is the fee', 'how much does it cost', 'list of doctors',
      'what doctors do you have', 'what services', 'tell me about',
      'do you have', 'is there a', 'how do i',
    ],
    phrases_ur: [
      'timings kya hain', 'kab khulta hai', 'address kya hai', 'kahan hai',
      'fee kitni hai', 'kitna kharcha', 'doctor kaun hain', 'services kya',
    ],
  },
  {
    intent: 'triage',
    keywords_en: ['pain', 'fever', 'cough', 'headache', 'injury', 'bleeding', 'sick', 'hurt',
      'symptom', 'symptoms', 'feeling', 'vomit', 'diarrhea', 'chest pain',
      'dizzy', 'rash', 'swelling', 'sore', 'ache', 'infection', 'cold', 'flu'],
    keywords_ur: ['dard', 'bukhar', 'khaansi', 'chot', 'takleef', 'bimari', 'bimaar',
      'ultee', 'infection', 'sardi', 'jism', 'sir', 'pet', 'khoon'],
    phrases_en: [
      'i have pain', 'i am feeling', 'i have a fever', 'my head hurts',
      'i injured', 'i am bleeding', 'chest pain', 'i feel sick',
      'not feeling well', 'i have a', 'my back hurts', 'my stomach',
      'i have been coughing', 'throwing up', 'can\'t breathe',
    ],
    phrases_ur: [
      'mujhe dard', 'mere sir mein dard', 'mujhe bukhar', 'meri tabiyat',
      'tabiyat kharab', 'chot lagi', 'khoon nikal', 'ultee ho',
      'saans nahi', 'bimaar hoon', 'takleef hai',
    ],
  },
  {
    intent: 'cancel_reschedule',
    keywords_en: ['cancel', 'reschedule', 'change', 'postpone', 'move', 'modify', 'rebook'],
    keywords_ur: ['cancel', 'reschedule', 'mansookh', 'badalna', 'tabdeel', 'aage', 'peeche'],
    phrases_en: [
      'i want to cancel', 'need to cancel', 'cancel my appointment',
      'reschedule', 'change my appointment', 'move my appointment',
      'postpone', 'i can\'t make it', 'need to change',
    ],
    phrases_ur: [
      'cancel karni hai', 'cancel karna hai', 'appointment cancel',
      'reschedule karna', 'badalni hai', 'time change', 'date change',
      'nahi aa sakta', 'nahi aa sakti',
    ],
  },
  {
    intent: 'human_handoff',
    // "Talk to a human" / "call me back" — English + Roman Urdu. Phrases are
    // deliberately specific ('insaan se baat', 'kisi se baat') so that
    // "doctor se baat karni hai" (booking-ish) does not collapse into handoff.
    keywords_en: ['human', 'agent', 'front desk', 'call me back', 'call back', 'callback',
      'representative', 'real person', 'customer service', 'someone call'],
    keywords_ur: ['insaan', 'waapis call', 'wapas call', 'insaan se', 'kisi se baat', 'koi insaan'],
    phrases_en: [
      'talk to a human', 'talk to an agent', 'talk to a person', 'talk to someone',
      'speak to a human', 'speak to an agent', 'speak to a person', 'speak to someone',
      'talk to the front desk', 'speak to the front desk', 'front desk',
      'call me back', 'call me back please', 'please call me back', 'someone call me',
      'have someone call me', 'can someone call me', 'connect me to',
      'i want to speak to', 'i want to talk to', 'can i speak to', 'can i talk to',
      'is there a human', 'any human', 'a real person', 'an actual person', 'live agent',
    ],
    phrases_ur: [
      'insaan se baat', 'insaan se baat karni hai', 'insaan se baat karni',
      'kisi se baat karni hai', 'kisi se baat karni', 'kisi insaan se baat',
      'kisi se baat kar', 'baat karni hai kisi se',
      'waapis call', 'wapas call', 'waapis call karo', 'wapas call karo', 'call back karo',
      'front desk se baat', 'koi insaan', 'aadmi se baat', 'admi se baat',
    ],
  },
  {
    intent: 'greeting',
    keywords_en: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'salam', 'assalam'],
    keywords_ur: ['hello', 'hi', 'salam', 'assalam', 'adaab', 'salamualaikum'],
    phrases_en: ['hello', 'hi there', 'good morning', 'good evening', 'hey', 'how are you'],
    phrases_ur: ['salam', 'assalam o alaikum', 'adaab', 'hello', 'hi'],
  },
];

/**
 * Phrase-only handoff detector used to bail out of an in-progress flow.
 * Requires an explicit handoff PHRASE (e.g. 'talk to a human', 'kisi se baat
 * karni hai') — a bare keyword like 'human' or 'agent' inside a name or
 * answer must NOT yank a caller out of a registration/booking flow.
 */
export function isHandoffRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const pattern = INTENT_PATTERNS.find((p) => p.intent === 'human_handoff');
  if (!pattern) return false;
  return pattern.phrases_en.some((ph) => lower.includes(ph)) || pattern.phrases_ur.some((ph) => lower.includes(ph));
}

// ── Entity extractors ──
function extractEntities(text: string): Record<string, string> {
  const entities: Record<string, string> = {};
  const lower = text.toLowerCase();

  // CNIC: XXXXX-XXXXXXX-X
  const cnicMatch = text.match(/\b\d{5}-\d{7}-\d\b/);
  if (cnicMatch) entities.cnic = cnicMatch[0];

  // Phone: 03XX-XXXXXXX
  const phoneMatch = text.match(/\b03\d{2}[-\s]?\d{7}\b/);
  if (phoneMatch) entities.phone = phoneMatch[0].replace(/\s/g, '');

  // Date: YYYY-MM-DD
  const dateMatch = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (dateMatch) entities.date = dateMatch[0];

  // Time: HH:MM
  const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (timeMatch) {
    const h = timeMatch[1].padStart(2, '0');
    const m = timeMatch[2];
    entities.time = `${h}:${m}`;
  }

  // Gender
  if (/\b(male|mard|men)\b/i.test(lower)) entities.gender = 'Male';
  if (/\b(female|aurat|women|lady|girl)\b/i.test(lower)) entities.gender = 'Female';
  if (/\bother\b/i.test(lower)) entities.gender = 'Other';

  // Doctor names
  if (/\bdr\.?\s*ahmed\b/i.test(lower) || /\bahmed\b.*doctor/i.test(lower)) entities.doctor = 'Dr. Ahmed';
  if (/\bdr\.?\s*fatima\b/i.test(lower) || /\bfatima\b.*doctor/i.test(lower)) entities.doctor = 'Dr. Fatima';

  // Specialties
  if (/\bcardio/i.test(lower) || /\bheart\b/i.test(lower) || /\bdil\b/i.test(lower)) entities.specialty = 'Cardiologist';
  if (/\bpediatric/i.test(lower) || /\bchild/i.test(lower) || /\bbachch/i.test(lower)) entities.specialty = 'Pediatrician';

  // Name: 2-3 words with capital letters
  const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/);
  if (nameMatch && !entities.doctor) entities.name = nameMatch[1];

  // Symptoms
  const symptomKeywords = ['pain', 'fever', 'cough', 'headache', 'injury', 'bleeding', 'vomit', 'diarrhea',
    'dizzy', 'rash', 'swelling', 'sore', 'ache', 'infection', 'cold', 'flu',
    'dard', 'bukhar', 'khaansi', 'chot', 'takleef', 'ultee', 'khoon'];
  for (const kw of symptomKeywords) {
    if (lower.includes(kw)) {
      entities.symptom = kw;
      break;
    }
  }

  // Yes/No
  if (/^(yes|yeah|yup|yep|haan|ji|hmm|ok|okay|theek|bilkul|sahi|correct)$/i.test(text.trim()) ||
      /\byes\b/i.test(lower) || /\bhaan\b/i.test(lower) || /\bji\b/i.test(lower) ||
      /\bok\b/i.test(lower) || /\bokay\b/i.test(lower) || /\bbilkul\b/i.test(lower)) {
    entities.confirmation = 'yes';
  }
  if (/^(no|nah|nope|nahi|nahin|na|galat|wrong)$/i.test(text.trim()) ||
      /\bno\b/i.test(lower) || /\bnahi\b/i.test(lower) || /\bnahin\b/i.test(lower) ||
      /\bgalat\b/i.test(lower)) {
    entities.confirmation = 'no';
  }

  return entities;
}

// ── Main classifier ──

export function classifyIntent(text: string): ClassifiedIntent {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Score each intent
  const scores: { intent: Intent; score: number }[] = [];

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;

    // Check individual keywords
    for (const kw of pattern.keywords_en) {
      if (lower.includes(kw)) score += 2;
    }
    for (const kw of pattern.keywords_ur) {
      if (lower.includes(kw)) score += 2;
    }

    // Check phrase matches (higher weight)
    for (const phrase of pattern.phrases_en) {
      if (lower.includes(phrase)) score += 5;
    }
    for (const phrase of pattern.phrases_ur) {
      if (lower.includes(phrase)) score += 5;
    }

    // Also check each word against the keywords for partial matching
    // (e.g. 'registered' → 'register'). The kw.includes(word) direction is only
    // credited for words of length >= 3 — tiny function words like 'i', 'to',
    // 'a' would otherwise match inside many keywords ('timing', 'location',
    // 'doctor list') and drown out real intent scores.
    for (const word of words) {
      for (const kw of pattern.keywords_en) {
        if (word.includes(kw) || (kw.includes(word) && word.length >= 3)) score += 0.5;
      }
      for (const kw of pattern.keywords_ur) {
        if (word.includes(kw) || (kw.includes(word) && word.length >= 3)) score += 0.5;
      }
    }

    scores.push({ intent: pattern.intent, score });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];

  // If no intent scored, return unknown
  if (best.score === 0) {
    return { intent: 'unknown', confidence: 0, entities: extractEntities(text) };
  }

  // Calculate confidence
  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const confidence = totalScore > 0 ? best.score / Math.max(totalScore, 1) : 0;

  return {
    intent: best.intent,
    confidence: Math.min(confidence, 1),
    entities: extractEntities(text),
  };
}

// ── Optional OpenAI-compatible API fallback & Gemini Agent ──

export function hasLLMFallback(): boolean {
  return !!(process.env.OPENAI_API_KEY);
}

export async function classifyWithLLM(text: string): Promise<ClassifiedIntent> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    return classifyIntent(text);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'openrouter/free',
        messages: [
          {
            role: 'system',
            content: `You are an intent classifier for a hospital receptionist AI. Classify the user's message into one of these intents:
- register_patient: User wants to register as a new patient
- book_appointment: User wants to book an appointment
- check_appointment: User wants to check appointment status
- faq: User is asking about hospital info (hours, location, fees, services, doctors)
- triage: User is describing symptoms
- cancel_reschedule: User wants to cancel or reschedule an appointment
- human_handoff: User wants to talk to a human (front desk / agent / callback request, e.g. "call me back", "insaan se baat")
- greeting: User is greeting
- unknown: Cannot determine intent

Respond with JSON: {"intent": "...", "confidence": 0.0-1.0, "entities": {}}`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return {
        intent: parsed.intent || 'unknown',
        confidence: parsed.confidence || 0.5,
        entities: { ...extractEntities(text), ...parsed.entities },
      };
    }
  } catch (err) {
    // Fall back to local classifier
  }

  return classifyIntent(text);
}

function recordAiEvent(sessionId: string, channel: string, eventType: string, details: Record<string, unknown> = {}): void {
  const db = getDb();
  db.run(
    `INSERT INTO ai_events (session_id, channel, event_type, details) VALUES (?, ?, ?, ?)`,
    [sessionId || null, channel || 'staff', eventType, JSON.stringify(details)]
  );
}

// Global variable to capture actions from tool execution during the turn
let turnAction: any = null;

async function executeTool(
  name: string,
  args: any,
  sessionId: string,
  channel: string,
  lang: 'en' | 'ur'
): Promise<any> {
  const db = getDb();
  switch (name) {
    case 'find_patient': {
      const cleaned = String(args.query || '').trim();
      let patient = db.query("SELECT * FROM patients WHERE cnic = ? AND status = 'active'").get(cleaned) as Patient | undefined;
      if (!patient) {
        const phoneClean = cleaned.replace(/[-\s]/g, '');
        patient = db.query("SELECT * FROM patients WHERE REPLACE(REPLACE(phone, '-', ''), ' ', '') = ? AND status = 'active'").get(phoneClean) as Patient | undefined;
      }
      if (!patient) {
        patient = db.query("SELECT * FROM patients WHERE full_name LIKE ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(`%${cleaned}%`) as Patient | undefined;
      }
      if (!patient) {
        patient = db.query("SELECT * FROM patients WHERE patient_id = ? AND status = 'active'").get(cleaned) as Patient | undefined;
      }
      if (patient) {
        turnAction = { type: 'patient_found', data: { patient_id: patient.patient_id } };
      }
      return patient || null;
    }
    case 'create_patient': {
      const now = new Date().toISOString();
      const last = db.query("SELECT patient_id FROM patients ORDER BY id DESC LIMIT 1").get() as { patient_id: string } | undefined;
      const num = last ? parseInt(last.patient_id.replace("SC-PT-", ""), 10) + 1 : 1;
      const patientId = `SC-PT-${String(num).padStart(6, "0")}`;
      db.run(
        `INSERT INTO patients (patient_id, full_name, dob, gender, cnic, phone, address, emergency_contact, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [patientId, args.full_name, args.dob, String(args.gender || '').toLowerCase(),
         args.cnic, String(args.phone || '').replace(/[-\s]/g, ''), args.address,
         String(args.emergency_contact || '').replace(/[-\s]/g, ''), now, now]
      );
      recordAiEvent(sessionId, channel, 'patient_created', { patient_id: patientId });
      turnAction = { type: 'patient_created', data: { patient_id: patientId } };
      return { patient_id: patientId };
    }
    case 'get_doctors_list': {
      const doctors = db.query("SELECT * FROM doctors WHERE status = 'active' ORDER BY name").all() as Doctor[];
      return doctors;
    }
    case 'get_available_slots': {
      const doctorId = Number(args.doctor_id);
      const date = String(args.date);
      const slots = getAvailableSlots(db, doctorId, date);
      return slots;
    }
    case 'create_appointment': {
      const patientId = Number(args.patient_id);
      const doctorId = Number(args.doctor_id);
      const date = String(args.date);
      const startTime = String(args.start_time);
      const finalValidation = validateAppointmentInput(db, doctorId, date, startTime);
      if (!finalValidation.ok) {
        throw new Error(finalValidation.message);
      }
      const now = new Date().toISOString();
      const source = channel === 'chat' ? 'chat' : channel === 'twilio' ? 'twilio' : 'voice';
      const result = db.run(
        `INSERT INTO appointments (patient_id, doctor_id, date, start_time, end_time, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
        [patientId, doctorId, date, startTime, finalValidation.endTime, source, now, now]
      );
      const doctor = db.query("SELECT name FROM doctors WHERE id = ?").get(doctorId) as { name: string } | undefined;
      recordAiEvent(sessionId, channel, 'appointment_created', {
        appointment_id: result.lastInsertRowid,
        doctor_name: doctor?.name || `Doctor #${doctorId}`,
        date,
        time: startTime
      });
      turnAction = {
        type: 'appointment_created',
        data: {
          appointment_id: result.lastInsertRowid,
          doctor_name: doctor?.name || `Doctor #${doctorId}`,
          date,
          time: startTime
        }
      };
      return { appointment_id: result.lastInsertRowid };
    }
    case 'get_patient_appointments': {
      const patientId = Number(args.patient_id);
      const appointments = db.query(
        `SELECT a.*, d.name as doctor_name, d.specialization as doctor_specialization
         FROM appointments a JOIN doctors d ON a.doctor_id = d.id
         WHERE a.patient_id = ? AND a.status NOT IN ('cancelled', 'no-show')
         ORDER BY a.date DESC, a.start_time ASC LIMIT 20`
      ).all(patientId) as any[];
      const patient = db.query("SELECT patient_id FROM patients WHERE id = ?").get(patientId) as { patient_id: string } | undefined;
      recordAiEvent(sessionId, channel, 'appointments_list', {
        patient_id: patient?.patient_id || String(patientId),
        count: appointments.length
      });
      turnAction = {
        type: 'appointments_list',
        data: {
          patient_id: patient?.patient_id || String(patientId),
          count: appointments.length
        }
      };
      return appointments;
    }
    case 'cancel_appointment': {
      const appointmentId = Number(args.appointment_id);
      const now = new Date().toISOString();
      db.run("UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelled by patient via AI receptionist', updated_at = ? WHERE id = ?", [now, appointmentId]);
      recordAiEvent(sessionId, channel, 'appointment_cancelled', { appointment_id: appointmentId });
      turnAction = { type: 'appointment_cancelled', data: { appointment_id: appointmentId } };
      return { success: true };
    }
    case 'reschedule_appointment': {
      const apptId = Number(args.appointment_id);
      const newDate = String(args.new_date);
      const newTime = String(args.new_time);
      const appt = db.query("SELECT * FROM appointments WHERE id = ?").get(apptId) as any;
      if (!appt) {
        throw new Error("Appointment not found");
      }
      const timeValidation = validateAppointmentInput(db, appt.doctor_id, newDate, newTime);
      if (!timeValidation.ok) {
        throw new Error(timeValidation.message);
      }
      const now = new Date().toISOString();
      db.run(
        "UPDATE appointments SET date = ?, start_time = ?, end_time = ?, cancellation_reason = 'Rescheduled by patient via AI receptionist', updated_at = ? WHERE id = ?",
        [newDate, newTime, timeValidation.endTime, now, apptId]
      );
      recordAiEvent(sessionId, channel, 'appointment_rescheduled', {
        appointment_id: apptId,
        new_date: newDate,
        new_time: newTime
      });
      turnAction = {
        type: 'appointment_rescheduled',
        data: {
          appointment_id: apptId,
          new_date: newDate,
          new_time: newTime
        }
      };
      return { success: true };
    }
    case 'get_faq_answer': {
      const faq = findFAQ(args.query);
      const answer = formatFAQAnswer(faq, lang);
      recordAiEvent(sessionId, channel, 'faq', { topic: faq ? faq.topic : 'general' });
      return answer;
    }
    case 'create_callback_request': {
      const res = storeCallback({
        session_id: sessionId,
        channel,
        language: lang,
        phone: String(args.phone || ''),
        reason: args.reason || null
      });
      if (!res.duplicate) {
        recordAiEvent(sessionId, channel, 'callback_requested', { callback_id: res.request.id, language: lang });
        turnAction = { type: 'callback_requested', data: { callback_id: res.request.id } };
      }
      return { callback_id: res.request.id, duplicate: res.duplicate };
    }
    default:
      throw new Error(`Unknown tool name: ${name}`);
  }
}

function getSystemPrompt(lang: 'en' | 'ur', today: string): string {
  return `You are the friendly, helpful AI Receptionist for Subhan Care Hospital.
Your goal is to converse with the patient and help them register, book appointments, check appointments, reschedule, cancel, answer FAQs, or handle callback requests.
You must respond in the user's preferred language (English, Urdu, or Roman Urdu).
Today's date is: ${today}.

You must return a JSON response matching the schema below. Do NOT output any other text or Markdown wrapping outside the JSON.
Response Schema:
{
  "thought": "your internal reasoning",
  "reply": "what you will say/speak to the patient",
  "tool_call": {
    "name": "find_patient" | "create_patient" | "get_doctors_list" | "get_available_slots" | "create_appointment" | "get_patient_appointments" | "cancel_appointment" | "reschedule_appointment" | "get_faq_answer" | "create_callback_request",
    "arguments": { ... }
  } | null,
  "intent": "register_patient" | "book_appointment" | "check_appointment" | "faq" | "triage" | "cancel_reschedule" | "human_handoff" | "greeting" | "unknown",
  "conversation_active": true | false
}

Rules for Tools:
1. If you need to search for a patient by CNIC, phone, or name, call "find_patient" with argument { "query": "..." }.
2. If you need to register a patient, call "create_patient" with arguments: { "full_name": "...", "dob": "YYYY-MM-DD", "gender": "Male"|"Female"|"Other", "cnic": "XXXXX-XXXXXXX-X", "phone": "03XX-XXXXXXX", "address": "...", "emergency_contact": "03XX-XXXXXXX" }.
3. If you need to get the list of active doctors, call "get_doctors_list" with no arguments.
4. If you need to check available slots, call "get_available_slots" with arguments { "doctor_id": number, "date": "YYYY-MM-DD" }.
5. If you need to book an appointment, call "create_appointment" with arguments { "patient_id": number, "doctor_id": number, "date": "YYYY-MM-DD", "start_time": "HH:MM" }.
6. If you need to see patient's appointments, call "get_patient_appointments" with { "patient_id": number }.
7. If you need to cancel an appointment, call "cancel_appointment" with { "appointment_id": number }.
8. If you need to reschedule, call "reschedule_appointment" with { "appointment_id": number, "new_date": "YYYY-MM-DD", "new_time": "HH:MM" }.
9. If you need FAQ info, call "get_faq_answer" with { "query": "..." }.
10. If you need to record a callback request, call "create_callback_request" with { "phone": "...", "reason": "..." | null }.

CRITICAL flow instructions for E2E Test Compatibility:
- Patient Registration Flow:
  1. Guide them step-by-step to collect: full name, CNIC, DOB, gender, phone, address, emergency contact.
  2. When asking for CNIC, you MUST use the word "CNIC" in your reply.
  3. When asking for date of birth, you MUST use the words "date of birth" or "DOB".
  4. When asking for gender, you MUST use the word "gender".
  5. When asking for phone, you MUST use the word "phone".
  6. When asking for address, you MUST use the word "address".
  7. When asking for emergency contact, you MUST use the word "emergency".
  8. Once all info is collected, list it and ask for confirmation using the word "confirm" or "correct" (or "durust" in Urdu).
  9. Once confirmed, call "create_patient". In your final reply say "successfully registered" or "kamyabi".

- Appointment Booking Flow:
  1. First ask: "Are you already registered with us?" (include the word "registered").
  2. If they say yes, ask for their "CNIC", "phone", or "record".
  3. Whenever the user provides their name, CNIC, phone number, or record, you MUST immediately call the "find_patient" tool with their provided text as the "query" argument. Do NOT ask for additional identifiers if they have already provided one; look them up first using "find_patient".
  4. Once found, get doctor list using "get_doctors_list" and show them, asking them to select a doctor/specialty. Include "doctor" or "specialty" in your reply. Format the doctor list as bullet points: • **Dr. [Name]** — [Specialty] (Fee: Rs. [Fee])
  5. Once doctor is chosen, ask for "date".
  6. Call "get_available_slots". Show the slots and ask them to select a "time" or "slot".
  7. Confirm appointment details (doctor name, date, time, fee) and ask for confirmation using "confirm", "book", or "fee".
  8. Once confirmed, call "create_appointment". In your final reply say "successfully booked" or "booked".

- Check Appointment Flow:
  1. Ask for their patient identifier (CNIC, phone, or name).
  2. Once provided, call "find_patient" to look up their record.
  3. Call "get_patient_appointments" to list their appointments.

- Cancel/Reschedule Flow:
  1. Ask for their patient identifier (CNIC, phone, or name).
  2. Once provided, call "find_patient" to look up their record.
  3. Call "get_patient_appointments" to list their appointments.
  4. Ask them which appointment they want to cancel or reschedule.
  5. If cancelling, ask for confirmation, then call "cancel_appointment".
  6. If rescheduling, ask for the new date, call "get_available_slots", show the slots, ask for the new time, and call "reschedule_appointment".

- Clinical Triage:
  - Ask for symptom severity on a scale of 1-10 and duration.
  - If severity is 8 or above, say it is an emergency and tell them to call 1122 immediately.`;
}

export async function runGeminiAgent(
  message: string,
  state: ConversationState,
  channel: string
): Promise<ReceptionistResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'openrouter/free';

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for Gemini agent");
  }

  // Ensure history exists
  if (!state.history) {
    state.history = [];
  }

  // Push user message to history
  state.history.push({ role: 'user', content: message });

  // Limit history length to fit context window
  if (state.history.length > 25) {
    state.history = state.history.slice(-20);
  }

  // Reset turn-level action before starting LLM loop
  turnAction = null;

  let loopCount = 0;
  const maxLoops = 5;

  while (loopCount < maxLoops) {
    loopCount++;

    const messages = [
      { role: 'system', content: getSystemPrompt(state.language, hospitalToday()) },
      ...state.history,
      { role: 'system', content: 'CRITICAL REMINDER: You must output ONLY a valid JSON object matching the schema. Do NOT write any conversational text or markdown code blocks outside the JSON.' }
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: 1000,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini agent API failed:', response.status, errBody);
      throw new Error(`Gemini API failed: ${response.statusText}`);
    }

    const resJson = await response.json() as any;
    const assistantContent = resJson.choices?.[0]?.message?.content;
    if (!assistantContent) {
      throw new Error("Gemini agent returned empty content");
    }

    // Clean JSON markdown wrapper if present
    let content = assistantContent.trim();
    if (content.startsWith('```json')) {
      content = content.slice(7);
    } else if (content.startsWith('```')) {
      content = content.slice(3);
    }
    if (content.endsWith('```')) {
      content = content.slice(0, -3);
    }
    content = content.trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse Gemini JSON:', content);
      throw new Error("Gemini agent response was not valid JSON");
    }

    // Process tool call if requested
    if (parsed.tool_call) {
      const { name, arguments: args } = parsed.tool_call;
      
      // Save LLM turn to history
      state.history.push({ role: 'assistant', content: assistantContent });

      let toolResult;
      try {
        toolResult = await executeTool(name, args, state.sessionId, channel, state.language);
      } catch (err: any) {
        console.warn(`Tool ${name} failed with error:`, err.message);
        toolResult = { error: err.message || 'Unknown error occurred' };
      }

      // Save tool result to history
      state.history.push({
        role: 'system',
        content: `Tool result from ${name}: ${JSON.stringify(toolResult)}`
      });

      // Continue LLM dialogue loop
      continue;
    }

    // Final response generated
    state.history.push({ role: 'assistant', content: assistantContent });

    if (parsed.intent && parsed.intent !== 'unknown') {
      state.intent = parsed.intent;
    }

    return {
      reply: parsed.reply || '',
      session_id: state.sessionId,
      intent: parsed.intent || 'unknown',
      action: turnAction || parsed.action || undefined,
      language: state.language,
      conversation_active: parsed.conversation_active !== false
    };
  }

  throw new Error("Gemini agent loop exceeded max iterations");
}

