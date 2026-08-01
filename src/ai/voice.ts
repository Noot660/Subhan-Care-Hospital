// Voice-optimized conversation handler
// Short, conversational prompts for spoken language
// "People can't scan spoken text" — keep everything under 15 words / 80 chars

import type { Language } from './i18n';

// ── Call end detection ──

const END_CALL_PATTERNS = [
  // English
  /\bbye\b/i, /\bgoodbye\b/i, /\bgood bye\b/i, /\bsee you\b/i,
  /\bthank you\b/i, /\bthanks\b/i, /\bend call\b/i, /\bhang up\b/i,
  /\bthat'?s all\b/i, /\bnothing else\b/i, /\bi'?m done\b/i,
  /\btake care\b/i, /\bno thanks\b/i, /\bno thank you\b/i,
  /\bi'?m good\b/i, /\bi'?m fine\b/i, /\ball set\b/i,
  // Urdu/Roman Urdu
  /\bshukriya\b/i, /\bshukria\b/i, /\ballah hafiz\b/i, /\bkhuda hafiz\b/i,
  /\btheek hai\b/i, /\bbas itna\b/i, /\bkaafi hai\b/i, /\bachha\b.*\bbye\b/i,
  /\bphir milenge\b/i, /\bapna khayal\b/i, /\bkhuda\b.*\bhafiz\b/i,
];

export function detectCallEnd(message: string): boolean {
  return END_CALL_PATTERNS.some(p => p.test(message));
}

// ── Voice-optimized greetings (under 80 chars) ──

export function getVoiceGreeting(lang: Language): string {
  if (lang === 'ur') {
    return 'Subhan Care mein khushamdeed. Bataaiye, kya madad chahiye?';
  }
  return 'Thank you for calling Subhan Care. How can I help you today?';
}

// ── Voice-optimized closing ──

export function getVoiceClosing(lang: Language, summary?: string): string {
  const base = lang === 'ur'
    ? 'Subhan Care se raabta karne ka shukriya. Apna khayal rakhiye.'
    : 'Thank you for calling Subhan Care. Take care.';

  if (!summary) return base;

  const prefix = lang === 'ur'
    ? `Aapne ${summary}`
    : `You ${summary}.`;

  return `${prefix} ${base}`;
}

// ── Voice-optimized prompts (shorter, more conversational) ──

export function getVoicePrompt(intent: string, step: string, lang: Language, vars?: Record<string, string>): string {
  const prompts: Record<string, Record<string, Record<Language, string>>> = {
    fallback: {
      _: {
        en: "I didn't catch that. Could you say it again?",
        ur: "Mujhe samajh nahi aaya. Dobara boliye.",
      },
    },
    silence: {
      _: {
        en: "I didn't catch that. How can I help?",
        ur: "Kuch sunai nahi diya. Kya madad chahiye?",
      },
    },
    greeting: {
      _: {
        en: "Thank you for calling Subhan Care. How can I help?",
        ur: "Subhan Care mein khushamdeed. Kya madad chahiye?",
      },
    },
    register_patient: {
      ask_full_name: {
        en: "What's your full name?",
        ur: "Poora naam?",
      },
      ask_cnic: {
        en: "What's your CNIC number?",
        ur: "CNIC number?",
      },
      ask_dob: {
        en: "What's your date of birth?",
        ur: "Date of birth?",
      },
      ask_gender: {
        en: "Male, female, or other?",
        ur: "Male, female, ya other?",
      },
      ask_phone: {
        en: "What's your phone number?",
        ur: "Phone number?",
      },
      ask_address: {
        en: "What's your address?",
        ur: "Address?",
      },
      ask_emergency_contact: {
        en: "Emergency contact number?",
        ur: "Emergency contact?",
      },
    },
    book_appointment: {
      ask_is_patient: {
        en: "Are you registered with us?",
        ur: "Pehle se registered hain?",
      },
      ask_identifier: {
        en: "What's your CNIC or phone number?",
        ur: "CNIC ya phone number?",
      },
      ask_doctor: {
        en: "Which doctor or specialty?",
        ur: "Kaunsa doctor ya specialty?",
      },
      ask_date: {
        en: "Which date? Say year-month-day.",
        ur: "Kaunsi date?",
      },
      ask_time: {
        en: "Which time works for you?",
        ur: "Kaunsa time theek rahega?",
      },
    },
    triage: {
      ask_severity: {
        en: "How bad is it, from 1 to 10?",
        ur: "Kitna shadeed hai, 1 se 10?",
      },
      ask_duration: {
        en: "How long has this been going on?",
        ur: "Kitne arse se hai?",
      },
    },
    medical_disclaimer: {
      _: {
        en: "I'm an AI assistant, not a doctor. For emergencies, call 1122.",
        ur: "Main AI hoon, doctor nahi. Emergency ke liye 1122 call karein.",
      },
    },
  };

  const intentPrompts = prompts[intent];
  if (intentPrompts) {
    const stepPrompts = intentPrompts[step] || intentPrompts['_'];
    if (stepPrompts) {
      let text = stepPrompts[lang] || stepPrompts['en'] || '';
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
      }
      return text;
    }
  }

  return lang === 'ur'
    ? 'Kya madad chahiye?'
    : 'How can I help you?';
}

// ── Prepare text for speech synthesis ──
// Short, conversational: 1 sentence, max 150 chars — spoken in <4 seconds.
// Voice calls should feel like quick back-and-forth, not monologues.

export function prepareForSpeech(text: string): string {
  // Strip all markdown formatting
  let cleaned = text
    .replace(/\*\*(.*?)\*\*/g, '$1')   // bold
    .replace(/__(.*?)__/g, '$1')       // underline bold
    .replace(/\*(.*?)\*/g, '$1')       // italic
    .replace(/`(.*?)`/g, '$1')         // code
    .replace(/[#*_~`>|-]/g, '')        // remaining markdown chars
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')  // emoji
    .replace(/\n{2,}/g, '. ')          // double newlines → period
    .replace(/\n/g, ' ')               // single newlines → space
    .replace(/\s{2,}/g, ' ')           // collapse spaces
    .trim();

  // Split on sentence boundaries
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];

  // Take FIRST sentence only for voice — keep conversations snappy
  let result = sentences[0].trim();

  // If still over 150 chars, truncate at last word boundary
  if (result.length > 150) {
    result = result.substring(0, 150);
    const lastSpace = result.lastIndexOf(' ');
    if (lastSpace > 60) {
      result = result.substring(0, lastSpace) + '.';
    }
  }

  return result;
}

// ── Summarize a call for the closing message ──

export function summarizeCall(actions: Array<{ type: string; data: unknown }>): string {
  if (!actions || actions.length === 0) {
    return '';
  }

  const summaries: string[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'appointment_created': {
        const d = action.data as Record<string, unknown>;
        summaries.push(`booked an appointment with ${d.doctor_name} on ${d.date} at ${d.time}`);
        break;
      }
      case 'patient_created': {
        summaries.push('registered as a new patient');
        break;
      }
      case 'appointment_cancelled':
        summaries.push('cancelled an appointment');
        break;
      case 'appointment_rescheduled':
        summaries.push('rescheduled an appointment');
        break;
      case 'patient_found':
        summaries.push('looked up your patient record');
        break;
      default:
        break;
    }
  }

  if (summaries.length === 0) return '';
  return summaries.join(' and ');
}
