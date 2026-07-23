// TTS (Text-to-Speech) support
// Prepares text for client-side Web Speech API synthesis
// No server-side TTS engine needed

import type { Language } from './i18n';

export interface TTSPayload {
  text: string;
  language: string;   // BCP 47 language tag for Web Speech API
  voice: string;      // suggested voice name
  rate: number;       // 0.1 - 10
  markers: SpeechMarker[]; // for word-by-word highlighting
}

export interface SpeechMarker {
  word: string;
  startMs: number;
  endMs: number;
}

// Rough TTS estimation: ~150 words per minute = 400ms per word
// This generates approximate markers for the frontend to use
function estimateMarkers(text: string): SpeechMarker[] {
  const words = text.split(/\s+/);
  const markers: SpeechMarker[] = [];
  const avgWordMs = 400; // ms per word
  let currentMs = 0;

  for (const word of words) {
    // Clean the word for display
    const clean = word.replace(/[^\w\u0600-\u06FF\u0750-\u077F]/g, '');
    if (!clean) continue;

    const duration = Math.max(200, Math.min(800, clean.length * 80 + 200));
    markers.push({
      word: clean,
      startMs: currentMs,
      endMs: currentMs + duration,
    });
    currentMs += duration + 50; // small gap between words
  }

  return markers;
}

export function prepareTTS(text: string, lang: Language): TTSPayload {
  // Map our language codes to BCP 47
  const bcp47: Record<Language, string> = {
    en: 'en-US',
    ur: 'ur-PK',
  };

  // Suggested voice names for Web Speech API
  const voiceSuggestions: Record<Language, string> = {
    en: 'Google US English',
    ur: 'Google Urdu',
  };

  return {
    text,
    language: bcp47[lang],
    voice: voiceSuggestions[lang],
    rate: 1.0,
    markers: estimateMarkers(text),
  };
}

// Strip markdown-like formatting for speech
export function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')  // bold
    .replace(/\*(.*?)\*/g, '$1')      // italic
    .replace(/`(.*?)`/g, '$1')        // code
    .replace(/[#*_~`>|-]/g, '')       // remaining markdown chars
    .replace(/📋|👨‍⚕️|👋|🪪|🎂|📞|📍|🚨|✅|❌|⚠️|🏥|💰|🚑/g, '')  // emojis
    .replace(/\n{2,}/g, '. ')         // double newlines → pause
    .replace(/\n/g, ' ')              // single newlines → space
    .replace(/\s{2,}/g, ' ')          // multiple spaces → single
    .trim();
}
