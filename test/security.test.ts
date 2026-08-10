import { describe, expect, test } from 'bun:test';
import { parseBody } from '../src/middleware/http';
import { allowPublicRequest, MAX_BODY_BYTES, MAX_SESSION_ID_LENGTH, MAX_TURNS } from '../src/security';
import { handleReceptionist } from '../src/routes/receptionist';
import { handleMessage } from '../src/ai/intents';
import { getOrCreateSession } from '../src/ai/conversation';
import { getDb } from '../src/db';
import { handleAnalytics } from '../src/routes/analytics';

const request = (body: string, path = '/api/receptionist/chat') => new Request(`http://test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body,
});

describe('privacy and abuse controls', () => {
  test('sensitive appointment operations fail closed without PHI_VERIFICATION_STUB', async () => {
    delete process.env.PHI_VERIFICATION_STUB;
    const started = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    expect(started.conversation_active).toBe(true);
    const confirmedExisting = await handleMessage('yes', started.session_id, 'en', 'chat');
    expect(confirmedExisting.conversation_active).toBe(true);
    const denied = await handleMessage('0312-0000000', started.session_id, 'en', 'chat');
    expect(denied.reply).toContain('Identity verification is required');
    expect(denied.action).toBeUndefined();
  });

  test('rejects malformed and oversized JSON bodies', async () => {
    await expect(parseBody(request('{oops'))).rejects.toThrow();
    await expect(parseBody(request('x'.repeat(MAX_BODY_BYTES + 1)))).rejects.toThrow('request too large');
    const response = await handleReceptionist(request('{oops'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unable to process request.' });
    const voiceResponse = await handleReceptionist(request('{oops', '/api/receptionist/voice-chat'));
    expect(voiceResponse.status).toBe(400);
    expect(await voiceResponse.json()).toEqual({ error: 'Unable to process request.' });
  });

  test('rejects malformed or oversized session and message values', async () => {
    const badSession = await handleReceptionist(request(JSON.stringify({ message: 'hello', session_id: 'not-a-session' })));
    expect(badSession.status).toBe(400);
    const longSession = await handleReceptionist(request(JSON.stringify({ message: 'hello', session_id: 'a'.repeat(MAX_SESSION_ID_LENGTH + 1) })));
    expect(longSession.status).toBe(400);
    const longMessage = await handleReceptionist(request(JSON.stringify({ message: 'x'.repeat(2001) })));
    expect(longMessage.status).toBe(400);
  });

  test('receptionist rate limit is per IP and path and returns 429 after the limit', () => {
    const url = 'http://test/api/receptionist/rate-test';
    let allowed = 0;
    for (let i = 0; i < 31; i++) {
      if (allowPublicRequest(new Request(url, { headers: { 'x-forwarded-for': '198.51.100.7' } }))) allowed++;
    }
    expect(allowed).toBe(30);
    expect(allowPublicRequest(new Request(url, { headers: { 'x-forwarded-for': '198.51.100.7' } }))).toBe(false);
  });

  test('analytics AI events expose neither session_id nor details', () => {
    const db = getDb();
    db.run("INSERT INTO ai_events (session_id, channel, event_type, details) VALUES (?, ?, ?, ?)", ['phi-session', 'chat', 'test_privacy', JSON.stringify({ diagnosis: 'secret' })]);
    return handleAnalytics(new Request('http://test/api/analytics/ai-events?event_type=test_privacy')).then(async (response) => {
      const payload = await response.json() as { events: Array<Record<string, unknown>> };
      expect(payload.events.length).toBeGreaterThan(0);
      expect(payload.events[0]).not.toHaveProperty('session_id');
      expect(payload.events[0]).not.toHaveProperty('details');
    });
  });

  test('turn limit ends a conversation at MAX_TURNS', async () => {
    const state = getOrCreateSession(null);
    state.context.turnCount = MAX_TURNS;
    const response = await handleMessage('hello', state.sessionId, 'en', 'chat');
    expect(response.conversation_active).toBe(false);
    expect(response.reply).toContain('maximum length');
  });
});
