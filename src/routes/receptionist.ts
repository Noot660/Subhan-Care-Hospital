// Receptionist API routes — public-facing AI receptionist endpoints
// Handles chat, FAQ listing, TTS, voice-chat, and voice-greeting

import { json, error, parseBody } from '../middleware/http';
import { handleMessage } from '../ai/intents';
import { getFAQTopicList } from '../ai/faq';
import { prepareTTS, stripForSpeech } from '../ai/tts';
import { getVoiceGreeting, getVoicePrompt, detectCallEnd, summarizeCall, prepareForSpeech } from '../ai/voice';
import type { Language } from '../ai/i18n';

// Main chat endpoint — full-text responses
async function handleChat(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{
      message: string;
      session_id?: string;
      language?: string;
    }>(request);

    if (!body.message || typeof body.message !== 'string') {
      return error('Missing required field: message', 400);
    }

    if (body.message.length > 2000) {
      return error('Message too long (max 2000 characters)', 400);
    }

    const lang: Language = body.language === 'ur' ? 'ur' : 'en';

    const result = await handleMessage(
      body.message.trim(),
      body.session_id || null,
      lang,
      'chat'
    );

    return json(result);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

// FAQ listing endpoint
async function handleFAQList(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lang: Language = url.searchParams.get('lang') === 'ur' ? 'ur' : 'en';

  return json({
    topics: getFAQTopicList(lang),
    language: lang,
  });
}

// TTS endpoint — prepares text for Web Speech API
async function handleTTS(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const text = url.searchParams.get('text');
  const lang: Language = url.searchParams.get('lang') === 'ur' ? 'ur' : 'en';

  if (!text) {
    return error('Missing text query parameter', 400);
  }

  if (text.length > 5000) {
    return error('Text too long (max 5000 characters)', 400);
  }

  const cleanText = stripForSpeech(text);
  const ttsPayload = prepareTTS(cleanText, lang);

  return json(ttsPayload);
}

// ── Voice-optimized chat endpoint ──
// Returns SHORT responses suitable for spoken delivery (<5 seconds)
async function handleVoiceChat(request: Request): Promise<Response> {
  try {
    const body = await parseBody<{
      message: string;
      session_id?: string;
      language?: string;
    }>(request);

    if (!body.message || typeof body.message !== 'string') {
      return error('Missing required field: message', 400);
    }

    if (body.message.length > 2000) {
      return error('Message too long (max 2000 characters)', 400);
    }

    const lang: Language = body.language === 'ur' ? 'ur' : 'en';
    const userMessage = body.message.trim();

    // Check if user wants to end the call
    const userWantsEnd = detectCallEnd(userMessage);

    // Process through the standard intents pipeline
    const result = await handleMessage(
      userMessage,
      body.session_id || null,
      lang,
      'voice'
    );

    // Shorten the reply for spoken delivery: 1-2 sentences, under 200 chars
    const shortReply = prepareForSpeech(result.reply);

    // Determine if call should end: either user said goodbye OR the conversation is complete
    const shouldEndCall = userWantsEnd || !result.conversation_active;

    // Build call summary if ending
    const callSummary = shouldEndCall && result.action
      ? summarizeCall([result.action])
      : null;

    return json({
      reply: shortReply,
      session_id: result.session_id,
      intent: result.intent,
      action: result.action || null,
      language: lang,
      conversation_active: result.conversation_active,
      should_end_call: shouldEndCall,
      call_summary: callSummary,
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Bad request', 400);
  }
}

// Voice greeting endpoint
async function handleVoiceGreeting(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const langParam = url.searchParams.get('language');
  const lang: Language = langParam === 'ur' ? 'ur' : 'en';

  const greeting = getVoiceGreeting(lang);
  const ttsPayload = prepareTTS(greeting, lang);

  return json({
    greeting,
    tts: ttsPayload,
    language: lang,
  });
}

// Voice prompt endpoint — returns a short spoken prompt for a given intent/step
async function handleVoicePrompt(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const intent = url.searchParams.get('intent') || 'fallback';
  const step = url.searchParams.get('step') || '_';
  const lang: Language = url.searchParams.get('lang') === 'ur' ? 'ur' : 'en';

  const prompt = getVoicePrompt(intent, step, lang);

  return json({
    prompt,
    language: lang,
  });
}

// Main router
export async function handleReceptionist(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // POST /api/receptionist/chat
  if (pathname === '/api/receptionist/chat' && request.method === 'POST') {
    return handleChat(request);
  }

  // POST /api/receptionist/voice-chat
  if (pathname === '/api/receptionist/voice-chat' && request.method === 'POST') {
    return handleVoiceChat(request);
  }

  // GET /api/receptionist/voice-greeting
  if (pathname === '/api/receptionist/voice-greeting' && request.method === 'GET') {
    return handleVoiceGreeting(request);
  }

  // GET /api/receptionist/voice-prompt
  if (pathname === '/api/receptionist/voice-prompt' && request.method === 'GET') {
    return handleVoicePrompt(request);
  }

  // GET /api/receptionist/faqs
  if (pathname === '/api/receptionist/faqs' && request.method === 'GET') {
    return handleFAQList(request);
  }

  // GET /api/receptionist/tts
  if (pathname === '/api/receptionist/tts' && request.method === 'GET') {
    return handleTTS(request);
  }

  return error('Not found', 404);
}
