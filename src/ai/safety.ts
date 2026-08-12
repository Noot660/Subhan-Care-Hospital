// Clinical safety module — deterministic emergency red-flag detection.
//
// Medically conservative: these phrases trigger IMMEDIATE emergency escalation
// (navigate the caller to emergency care / 1122), never a diagnosis. The module
// only returns an escalation category — it does not name a condition as a
// diagnosis, and callers must pair it with the reviewed emergency disclaimer
// copy (triage_emergency / triage_disclaimer).
//
// Matching is normalized (lowercased, punctuation-stripped, Roman Urdu spelling
// variants folded to canonical forms) so it is robust to the way callers
// actually type/say these phrases — e.g. 'seena mein dard', 'seene main dard'
// and 'sina me dard' all reduce to the same phrase.
//
// Scope: escalation/navigation ONLY. No treatment advice, no prescriptions,
// no diagnosis wording.

export type RedFlagCategory =
  | 'chest_pain'
  | 'breathing_difficulty'
  | 'unconscious'
  | 'severe_bleeding'
  | 'heart_attack'
  | 'stroke'
  | 'seizure'
  | 'severe_burn'
  | 'severe_injury';

export interface RedFlagResult {
  category: RedFlagCategory;
  /** The exact normalized phrase that matched (for ops logging). */
  matched: string;
}

// ── Normalization ──
// 1. lowercase
// 2. delete apostrophes/quotes ("can't" → "cant"), turn other punctuation into
//    spaces ("3rd-degree" → "3rd degree")
// 3. collapse whitespace
// 4. fold common Roman Urdu spelling variants to canonical forms

function normalizeText(text: string): string {
  let normalized = text
    .toLowerCase()
    .replace(/['’`"]/g, '')
    .replace(/[.,!?;:()\[\]{}<>/\\|@#^*=_+~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Roman Urdu spelling variants → canonical forms used in the patterns below.
  const WORD_VARIANTS: Array<[RegExp, string]> = [
    [/\bseene\b/g, 'seena'],     // seene mein dard → seena mein dard
    [/\bseenay\b/g, 'seena'],
    [/\bseeni\b/g, 'seena'],
    [/\bsina\b/g, 'seena'],
    [/\bsene\b/g, 'seena'],
    [/\bbehoush\b/g, 'behosh'],   // behosh variants
    [/\bbehoosh\b/g, 'behosh'],
    [/\bbihosh\b/g, 'behosh'],
    [/\bbe hosh\b/g, 'behosh'],
    [/\bkhun\b/g, 'khoon'],       // khoon variants
    [/\bsans\b/g, 'saans'],       // saans variants
    [/\bsanas\b/g, 'saans'],
  ];
  for (const [variant, canonical] of WORD_VARIANTS) {
    normalized = normalized.replace(variant, canonical);
  }
  return normalized;
}

// ── Red-flag phrase patterns (normalized text) ──
// The preposition group (mein|main|me|men|mai|m) covers the common Roman Urdu
// spellings of "mein" ("in"). Only exact medical phrases match; a bare keyword
// like 'pain' or 'khoon' alone is NOT a red flag.

const RED_FLAG_PATTERNS: Array<{ category: RedFlagCategory; patterns: RegExp[] }> = [
  {
    category: 'chest_pain',
    patterns: [
      /chest (pain|tightness|pressure)/,
      /\bseena (mein|main|me|men|mai|m )? (dard|takleef|jalan)/,
      /\bdil (mein|main|me|men|mai|m )? dard/,
    ],
  },
  {
    category: 'breathing_difficulty',
    patterns: [
      /(cant|cannot|can not|hard|difficulty|difficult|trouble|unable to) (breathe|breathing)/,
      /short(ness)? of breath/,
      /(breathless|gasping)/,
      /saans (nahi|na) (aa|a) (rahi|raha|ri|rhi|rahe|rahy)/,
      /saans (nahi|na) (aa|a)/,
      /saans (nahi|na) (aayi|aaya|aai)/,
      /saans lene (mein|main|me|men|mai|m )? (mushkil|takleef|dard)/,
      /saans (phool|phoolna|phooli|phool rahi|phool raha)/,
    ],
  },
  {
    category: 'unconscious',
    patterns: [
      /unconscious/,
      /pass(ed)? out/,
      /faint(ed|ing)?/,
      /loss of consciousness/,
      /black(ed)? out/,
      /behosh/,
    ],
  },
  {
    category: 'severe_bleeding',
    patterns: [
      /(severe|heavy|serious|uncontrolled|uncontrollable|shadeed) (bleeding|blood loss|khoon)/,
      /bleeding (heavily|badly|a lot|severely)/,
      /bleeding (wont|cant|cannot|doesnt) stop/,
      /khoon (bahut|zyada|beshak)/,
      /bahut (zyada )?khoon/,
      /khoon (nahi|na) ruk/,
      /khoon (nikal|bah) raha/,
    ],
  },
  {
    category: 'heart_attack',
    patterns: [
      /heart attack/,
      /cardiac arrest/,
      /\b(dil|heart) (ka|ke) (daura|doora|hamla)/,
    ],
  },
  {
    category: 'stroke',
    patterns: [
      /\bstroke(s)?\b/,
      /\bfalg\b/,
      /\bfalij\b/,
    ],
  },
  {
    category: 'seizure',
    patterns: [
      /\bseizure(s)?\b/,
      /\bmirgi\b/,
      /\bmrigi\b/,
      /fit (aa|a) (gaya|gayi)/,
    ],
  },
  {
    category: 'severe_burn',
    patterns: [
      /severe burn/,
      /(third|3rd) degree burn/,
      /burn(ed)? (severely|badly)/,
      /bahut (zyada )?jala/,
      /shadeed jala/,
    ],
  },
  {
    category: 'severe_injury',
    patterns: [
      /(severe|serious|major|critical) injur(y|ies)/,
      /(shadeed|bahut zyada) chot/,
      /chot (bahut|zyada) bari/,
      /gehri chot/,
    ],
  },
];

/**
 * Deterministic emergency red-flag detection for English and Roman Urdu.
 * Returns the first matching escalation category, or null when no red flag is
 * present. Never returns a diagnosis — only an escalation category.
 */
export function detectRedFlag(text: string): RedFlagResult | null {
  if (!text || typeof text !== 'string') return null;
  const normalized = normalizeText(text);
  if (!normalized) return null;

  for (const group of RED_FLAG_PATTERNS) {
    for (const pattern of group.patterns) {
      const match = normalized.match(pattern);
      if (match) {
        return { category: group.category, matched: match[0] };
      }
    }
  }
  return null;
}
