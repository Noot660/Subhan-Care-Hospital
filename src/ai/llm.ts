// Local intent classifier using keyword/pattern matching
// No external API dependency required
// Optional OpenAI-compatible API as fallback

import type { Language } from './i18n';

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

// ── Optional OpenAI-compatible API fallback ──

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
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
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
    });

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
  } catch {
    // Fall back to local classifier
  }

  return classifyIntent(text);
}
