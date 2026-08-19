// Twilio Voice webhook handler
// Handles incoming phone calls via Twilio
// 
// Required environment variables:
//   TWILIO_ACCOUNT_SID  — Your Twilio account SID
//   TWILIO_AUTH_TOKEN   — Your Twilio auth token
//   TWILIO_PHONE_NUMBER — Your Twilio phone number (e.g. +1XXXXXXXXXX)
//   PUBLIC_URL          — Public URL of this server (for webhook callbacks)
//
// Set these in your .env file or environment

import { json, error, parseBody } from '../middleware/http';
import { handleMessage } from '../ai/intents';
import { getVoiceGreeting, getVoiceClosing, detectCallEnd, summarizeCall } from '../ai/voice';
import type { Language } from '../ai/i18n';
import type { ReceptionistResponse } from '../ai/intents';

// Track ongoing Twilio calls (in-memory)
const activeCalls = new Map<string, {
  sessionId: string;
  language: Language;
  actions: Array<{ type: string; data: unknown }>;
  turnCount: number;
}>();

// ── POST /api/twilio/voice ──
// Twilio calls this when a call comes in
async function handleTwilioVoice(request: Request): Promise<Response> {
  const callSid = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Determine language from query params (Twilio can pass ?language=ur)
  const url = new URL(request.url);
  const langParam = url.searchParams.get('language');
  const lang: Language = langParam === 'ur' ? 'ur' : 'en';

  const greeting = getVoiceGreeting(lang);

  activeCalls.set(callSid, {
    sessionId: '',
    language: lang,
    actions: [],
    turnCount: 0,
  });

  // Build TwiML: greet and then gather speech input in a loop
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${lang === 'ur' ? 'Polly.Zeina' : 'Polly.Joanna'}" language="${lang === 'ur' ? 'ur-PK' : 'en-US'}">
    ${escapeXml(greeting)}
  </Say>
  <Gather input="speech"
          action="/api/twilio/gather?call_sid=${encodeURIComponent(callSid)}&lang=${lang}"
          method="POST"
          speechTimeout="auto"
          language="${lang === 'ur' ? 'ur-PK' : 'en-US'}"
          hints="appointment, doctor, register, help, booking, status">
  </Gather>
  <!-- If no input, prompt and re-gather -->
  <Say voice="${lang === 'ur' ? 'Polly.Zeina' : 'Polly.Joanna'}">
    ${lang === 'ur' ? 'Mujhe kuch sunai nahi diya. Baraye meherbani dobara boliye.' : "I didn't catch that. Please try again."}
  </Say>
  <Redirect>/api/twilio/voice?language=${lang}</Redirect>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

// ── POST /api/twilio/gather ──
// Twilio calls this after gathering speech input
async function handleTwilioGather(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const callSid = url.searchParams.get('call_sid') || '';
  const langParam = url.searchParams.get('lang') || 'en';
  const lang: Language = langParam === 'ur' ? 'ur' : 'en';

  let call = activeCalls.get(callSid);
  if (!call) {
    call = {
      sessionId: '',
      language: lang,
      actions: [],
      turnCount: 0,
    };
    activeCalls.set(callSid, call);
  }
  const sessionId = call.sessionId;
  const actions = call.actions;

  let formData: URLSearchParams;
  try {
    const text = await request.text();
    formData = new URLSearchParams(text);
  } catch {
    formData = new URLSearchParams();
  }

  const speechResult = formData.get('SpeechResult') || '';
  const confidence = formData.get('Confidence') || '0';

  // If no speech result, re-prompt
  if (!speechResult.trim()) {
    return buildGatherResponse(callSid, lang,
      lang === 'ur' ? 'Mujhe kuch sunai nahi diya. Kya aap dobara keh sakte hain?' : "I didn't catch that. Could you repeat that?");
  }

  // Check for call end
  if (detectCallEnd(speechResult)) {
    const summary = summarizeCall(actions);
    const closing = getVoiceClosing(lang, summary);
    activeCalls.delete(callSid);

    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${lang === 'ur' ? 'Polly.Zeina' : 'Polly.Joanna'}">
    ${escapeXml(closing)}
  </Say>
  <Hangup/>
</Response>`, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    });
  }

  // Process through AI
  try {
    const result: ReceptionistResponse = await handleMessage(speechResult, sessionId || null, lang, 'twilio');

    // Update session tracking
    call.sessionId = result.session_id;
    if (result.action) {
      call.actions.push(result.action);
    }
    call.turnCount++;
    activeCalls.set(callSid, call);

    // Check if conversation is complete
    if (!result.conversation_active) {
      const summary = summarizeCall(call.actions);
      const closing = getVoiceClosing(lang, summary);
      activeCalls.delete(callSid);

      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${lang === 'ur' ? 'Polly.Zeina' : 'Polly.Joanna'}">
    ${escapeXml(result.reply + '\n\n' + closing)}
  </Say>
  <Hangup/>
</Response>`, {
        status: 200,
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      });
    }

    // Continue with next gather
    return buildGatherResponse(callSid, lang, result.reply);

  } catch (err) {
    console.error('Twilio gather error:', err);
    return buildGatherResponse(callSid, lang,
      lang === 'ur' ? 'Maazrat, kuch masla ho gaya. Dobara koshish karein.' : 'Sorry, something went wrong. Please try again.');
  }
}

// ── GET /api/twilio/status ──
async function handleTwilioStatus(request: Request): Promise<Response> {
  // Twilio status callback — just acknowledge
  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

// Helper: Build a <Gather> response with a <Say> prompt
function buildGatherResponse(callSid: string, lang: Language, sayText: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${lang === 'ur' ? 'Polly.Zeina' : 'Polly.Joanna'}" language="${lang === 'ur' ? 'ur-PK' : 'en-US'}">
    ${escapeXml(sayText)}
  </Say>
  <Gather input="speech"
          action="/api/twilio/gather?call_sid=${encodeURIComponent(callSid)}&lang=${lang}"
          method="POST"
          speechTimeout="auto"
          language="${lang === 'ur' ? 'ur-PK' : 'en-US'}">
  </Gather>
  <Say voice="${lang === 'ur' ? 'Polly.Zeina' : 'Polly.Joanna'}">
    ${lang === 'ur' ? 'Kya aap wahan hain? Baraye meherbani dobara koshish karein.' : 'Are you still there? Please try again.'}
  </Say>
  <Redirect>/api/twilio/gather?call_sid=${encodeURIComponent(callSid)}&lang=${lang}&retry=1</Redirect>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

// XML escape
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n\n/g, '\n')  // Flatten double newlines for TTS
    .replace(/\n/g, '. ');
}

// ── Main Twilio Router ──
export async function handleTwilio(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // POST /api/twilio/voice — Incoming call webhook
  if (pathname === '/api/twilio/voice' && request.method === 'POST') {
    return handleTwilioVoice(request);
  }

  // POST /api/twilio/gather — Speech gather callback
  if (pathname === '/api/twilio/gather' && request.method === 'POST') {
    return handleTwilioGather(request);
  }

  // POST /api/twilio/status — Call status callback
  if (pathname === '/api/twilio/status' && request.method === 'POST') {
    return handleTwilioStatus(request);
  }

  // GET /api/twilio/status — For Twilio setup verification
  if (pathname === '/api/twilio/status' && request.method === 'GET') {
    return json({ status: 'ok', message: 'Twilio voice endpoint ready' });
  }

  return error('Not found', 404);
}
