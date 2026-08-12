import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { getDb } from '../src/db';
import { handleMessage } from '../src/ai/intents';
import { classifyIntent, isHandoffRequest } from '../src/ai/llm';
import { handleCallbacks } from '../src/routes/callbacks';
import { handleAnalytics } from '../src/routes/analytics';
import { hasPermission, getModuleFromPath } from '../src/middleware/auth';
import { createCallbackRequest, maskPhone, updateCallbackStatus } from '../src/handoff/store';

/**
 * Human handoff & callback workflow — focused tests:
 *  - EN + Roman Urdu handoff intent classification
 *  - HANDOFF_MODE=off honesty (never claims a scheduled callback)
 *  - phone required/validated (existing conventions), optional bounded reason
 *  - idempotent callback_requests persistence (session + phone dedupe)
 *  - redacted ai_event metadata (callback_requested / callback_status_updated)
 *  - admin-only queue: RBAC, masked phone, status transitions, safe errors
 */

const originalStub = process.env.PHI_VERIFICATION_STUB;
process.env.PHI_VERIFICATION_STUB = 'true';

// Handoff env management — tests flip these; restored in afterAll.
const origMode = process.env.HANDOFF_MODE;
const origPhone = process.env.HANDOFF_PHONE;
const origHours = process.env.CALLBACK_HOURS;
const origSla = process.env.CALLBACK_SLA;

function setMode(mode: 'off' | 'callback') {
  if (mode === 'callback') process.env.HANDOFF_MODE = 'callback';
  else delete process.env.HANDOFF_MODE;
}
function setCallbackEnv() {
  process.env.HANDOFF_MODE = 'callback';
  process.env.HANDOFF_PHONE = '051-111000111';
  process.env.CALLBACK_HOURS = 'between 9am and 5pm';
  process.env.CALLBACK_SLA = 'within 2 hours';
}

// Unique test phones so parallel/rerun DBs never collide.
const PHONE_A = '0300-9999001';
const PHONE_B = '0301-9999002';
// Every phone used anywhere in this file — cleaned before/after the run so a
// crashed prior run can never leave a pending row that breaks a later run.
const TEST_PHONES = [
  PHONE_A,
  PHONE_B,
  '0302-1234567',
  '0303-9999003',
  '0304-9999004',
  '0305-9999005',
  '0306-9999006',
  '0307-9999007',
];
const TEST_PHONE_DIGITS = TEST_PHONES.map((p) => p.replace(/\D/g, ''));

function cleanupDb() {
  const db = getDb();
  db.run(`DELETE FROM callback_requests WHERE phone IN (${TEST_PHONE_DIGITS.map(() => '?').join(',')})`, TEST_PHONE_DIGITS);
  db.run("DELETE FROM ai_events WHERE event_type IN ('callback_requested','callback_status_updated')");
}

beforeAll(() => cleanupDb());
afterAll(() => {
  cleanupDb();
  if (origMode === undefined) delete process.env.HANDOFF_MODE; else process.env.HANDOFF_MODE = origMode;
  if (origPhone === undefined) delete process.env.HANDOFF_PHONE; else process.env.HANDOFF_PHONE = origPhone;
  if (origHours === undefined) delete process.env.CALLBACK_HOURS; else process.env.CALLBACK_HOURS = origHours;
  if (origSla === undefined) delete process.env.CALLBACK_SLA; else process.env.CALLBACK_SLA = origSla;
  if (originalStub === undefined) delete process.env.PHI_VERIFICATION_STUB; else process.env.PHI_VERIFICATION_STUB = originalStub;
});

const countRows = (): number => {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as c FROM callback_requests").get() as { c: number };
  return Number(row.c);
};
const countEvents = (type: string): number => {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as c FROM ai_events WHERE event_type = ?").get(type) as { c: number };
  return Number(row.c);
};

// ── 1. Intent classification ──

describe('handoff intent classification', () => {
  test('English handoff phrases classify as human_handoff', () => {
    for (const phrase of [
      'I want to talk to a human',
      'Can I speak to an agent please',
      'talk to the front desk',
      'please call me back',
      'have someone call me',
      'is there any human I can talk to',
      'connect me to a representative',
    ]) {
      expect(classifyIntent(phrase).intent).toBe('human_handoff');
    }
  });

  test('Roman Urdu handoff phrases classify as human_handoff', () => {
    for (const phrase of [
      'insaan se baat karni hai',
      'kisi se baat karni hai',
      'mujhe waapis call karo',
      'wapas call karwa do',
      'front desk se baat karni hai',
      'koi insaan se baat karwao',
    ]) {
      expect(classifyIntent(phrase).intent).toBe('human_handoff');
    }
  });

  test('non-handoff intents are unchanged', () => {
    expect(classifyIntent('I want to book an appointment').intent).toBe('book_appointment');
    expect(classifyIntent('appointment book karni hai').intent).toBe('book_appointment');
    expect(classifyIntent('mujhe bukhar hai').intent).toBe('triage');
    expect(classifyIntent('mujhe doctor se milna hai').intent).toBe('book_appointment');
    expect(classifyIntent('hello').intent).toBe('greeting');
    expect(classifyIntent('what are your timings').intent).toBe('faq');
  });

  test('phrase-only mid-flow detector does not fire on keywords inside answers', () => {
    expect(isHandoffRequest('Muhammad Human')).toBe(false);   // a name, not a request
    expect(isHandoffRequest('call me back')).toBe(true);
    expect(isHandoffRequest('insaan se baat karni hai')).toBe(true);
    expect(isHandoffRequest('0300-1234567')).toBe(false);
  });
});

// ── 2. HANDOFF_MODE off ──

describe('HANDOFF_MODE=off (default): honest refusal', () => {
  test('requesting a callback never records a row and never promises one', async () => {
    setMode('off');
    const before = countRows();
    const res = await handleMessage('please call me back', null, 'en', 'chat');
    expect(res.intent).toBe('human_handoff');
    expect(res.conversation_active).toBe(false);
    expect(res.reply).toContain('not currently available');
    expect(res.reply).not.toMatch(/recorded|scheduled/i);
    expect(res.action).toBeUndefined();
    expect(countRows()).toBe(before); // nothing persisted
  });

  test('Roman Urdu off-mode reply is honest and localized', async () => {
    setMode('off');
    process.env.HANDOFF_PHONE = '051-111000111';
    const res = await handleMessage('mujhe waapis call karo', null, 'ur', 'chat');
    expect(res.intent).toBe('human_handoff');
    expect(res.reply).toContain('available nahi hai');
    expect(res.reply).toContain('051-111000111'); // directs caller to front desk number
    expect(res.reply).not.toMatch(/record|scheduled/i);
    delete process.env.HANDOFF_PHONE;
  });
});

// ── 3. Callback flow: phone validation + persistence ──

describe('callback flow: phone required and validated', () => {
  test('missing/invalid phone is re-asked and never stored', async () => {
    setCallbackEnv();
    const before = countRows();
    const started = await handleMessage('talk to a human', null, 'en', 'chat');
    expect(started.conversation_active).toBe(true);
    expect(started.reply).toContain('phone number');

    const invalid = await handleMessage('123', started.session_id, 'en', 'chat');
    expect(invalid.conversation_active).toBe(true);
    expect(invalid.reply).toContain('Invalid phone');
    expect(countRows()).toBe(before); // still nothing stored

    const missing = await handleMessage('', started.session_id, 'en', 'chat');
    expect(missing.conversation_active).toBe(true);
  });

  test('valid phone + optional reason persists a request and confirms with hours/SLA', async () => {
    setCallbackEnv();
    const before = countRows();
    const started = await handleMessage('please call me back', null, 'en', 'chat');
    const phoneStep = await handleMessage(PHONE_A, started.session_id, 'en', 'chat');
    expect(phoneStep.reply).toContain('reason');

    const done = await handleMessage('I need help with my lab report', started.session_id, 'en', 'chat');
    expect(done.conversation_active).toBe(false);
    expect(done.reply).toContain('recorded');
    expect(done.reply).toContain(PHONE_A.replace(/\D/g, '')); // canonical form echoed back
    expect(done.reply).toContain('between 9am and 5pm'); // configured hours
    expect(done.reply).toContain('within 2 hours');      // configured SLA
    expect(done.reply).toContain('request only');        // no guaranteed response
    expect(done.action?.type).toBe('callback_requested');

    const db = getDb();
    const row = db.query(
      "SELECT * FROM callback_requests WHERE phone = ? ORDER BY id DESC LIMIT 1"
    ).get(PHONE_A.replace(/\D/g, '')) as { language: string; channel: string; reason: string | null; status: string; session_id: string | null };
    expect(row).toBeDefined();
    expect(row.language).toBe('en');
    expect(row.channel).toBe('chat');
    expect(row.reason).toBe('I need help with my lab report');
    expect(row.status).toBe('pending');
    expect(countRows()).toBe(before + 1);
  });

  test('reason is optional — saying no skips it', async () => {
    setCallbackEnv();
    const before = countRows();
    const started = await handleMessage('insaan se baat karni hai', null, 'ur', 'chat');
    await handleMessage(PHONE_B, started.session_id, 'ur', 'chat');
    const done = await handleMessage('nahi', started.session_id, 'ur', 'chat');
    expect(done.conversation_active).toBe(false);
    expect(done.reply).toContain('record');
    const db = getDb();
    const row = db.query(
      "SELECT reason FROM callback_requests WHERE phone = ? ORDER BY id DESC LIMIT 1"
    ).get(PHONE_B.replace(/\D/g, '')) as { reason: string | null };
    expect(row.reason).toBeNull();
    expect(countRows()).toBe(before + 1);
  });

  test('reason is bounded at 200 characters', async () => {
    setCallbackEnv();
    const started = await handleMessage('call me back', null, 'en', 'chat');
    await handleMessage('0302-1234567', started.session_id, 'en', 'chat');
    const tooLong = await handleMessage('x'.repeat(201), started.session_id, 'en', 'chat');
    expect(tooLong.conversation_active).toBe(true);
    expect(tooLong.reply).toContain('200');
    const done = await handleMessage('brief reason', started.session_id, 'en', 'chat');
    expect(done.conversation_active).toBe(false);
    const db = getDb();
    const row = db.query(
      "SELECT reason FROM callback_requests WHERE phone = ? ORDER BY id DESC LIMIT 1"
    ).get('03021234567') as { reason: string };
    expect(row.reason.length).toBeLessThanOrEqual(200);
    db.run('DELETE FROM callback_requests WHERE phone = ?', ['03021234567']);
  });

  test('Roman Urdu full flow persists language=ur and channel=voice', async () => {
    setCallbackEnv();
    const started = await handleMessage('mujhe waapis call karo', null, 'ur', 'voice');
    const phoneStep = await handleMessage('0303-9999003', started.session_id, 'ur', 'voice');
    const done = await handleMessage('nahi', started.session_id, 'ur', 'voice');
    expect(done.reply).toContain('record');
    const db = getDb();
    const row = db.query(
      "SELECT language, channel FROM callback_requests WHERE phone = ? ORDER BY id DESC LIMIT 1"
    ).get('03039999003') as { language: string; channel: string };
    expect(row.language).toBe('ur');
    expect(row.channel).toBe('voice');
    db.run('DELETE FROM callback_requests WHERE phone = ?', ['03039999003']);
  });
});

// ── 4. Idempotent dedupe ──

describe('callback dedupe is idempotent', () => {
  test('same session cannot create a second pending request', async () => {
    setCallbackEnv();
    // Rerun-safe: a crashed prior run must not leave a pending row behind.
    getDb().run('DELETE FROM callback_requests WHERE phone = ?', ['03049999004']);

    const started = await handleMessage('talk to an agent', null, 'en', 'chat');
    const sid = started.session_id;
    await handleMessage('0304-9999004', sid, 'en', 'chat');
    const first = await handleMessage('skip', sid, 'en', 'chat'); // 'skip' keeps EN, skips the reason
    expect(first.reply).toContain('recorded');
    expect(first.action?.type).toBe('callback_requested');

    const again = await handleMessage('call me back', null, 'en', 'chat');
    await handleMessage('0304-9999004', again.session_id, 'en', 'chat');
    const second = await handleMessage('skip', again.session_id, 'en', 'chat');
    expect(second.reply).toContain('already');
    expect(second.action).toBeUndefined(); // duplicate → no new action event

    const db = getDb();
    const rows = db.query("SELECT COUNT(*) as c FROM callback_requests WHERE phone = ?").get('03049999004') as { c: number };
    expect(Number(rows.c)).toBe(1);
    db.run('DELETE FROM callback_requests WHERE phone = ?', ['03049999004']);
  });

  test('store-level dedupe returns existing row for the same pending phone', () => {
    setCallbackEnv();
    const first = createCallbackRequest({ session_id: null, channel: 'chat', language: 'en', phone: '0305-9999005', reason: 'one' });
    expect(first.duplicate).toBe(false);
    const second = createCallbackRequest({ session_id: 'other-session', channel: 'voice', language: 'ur', phone: '0305 9999005', reason: 'two' });
    expect(second.duplicate).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    // A contacted request frees the phone for a NEW request.
    const updated = updateCallbackStatus(first.request.id, 'contacted');
    expect(updated.ok).toBe(true);
    const third = createCallbackRequest({ session_id: null, channel: 'chat', language: 'en', phone: '0305-9999005', reason: 'three' });
    expect(third.duplicate).toBe(false);
    expect(third.request.id).not.toBe(first.request.id);
    const db = getDb();
    db.run('DELETE FROM callback_requests WHERE phone = ?', ['03059999005']);
  });
});

// ── 5. Redacted AI event metadata ──

describe('callback AI events are redacted', () => {
  test('callback_requested event contains callback id but never the phone', async () => {
    setCallbackEnv();
    const before = countEvents('callback_requested');
    const started = await handleMessage('call me back', null, 'en', 'chat');
    await handleMessage('0306-9999006', started.session_id, 'en', 'chat');
    await handleMessage('nahi', started.session_id, 'en', 'chat');

    expect(countEvents('callback_requested')).toBe(before + 1);
    const db = getDb();
    const row = db.query(
      "SELECT details FROM ai_events WHERE event_type = 'callback_requested' ORDER BY id DESC LIMIT 1"
    ).get() as { details: string };
    expect(row).toBeDefined();
    expect(row.details).not.toContain('0306');          // no phone anywhere
    expect(row.details).not.toContain('9999006');
    const parsed = JSON.parse(row.details) as Record<string, unknown>;
    expect(parsed.callback_id).toBeDefined();
    expect(parsed).not.toHaveProperty('phone');
    expect(parsed).not.toHaveProperty('reason');
    db.run('DELETE FROM callback_requests WHERE phone = ?', ['03069999006']);
  });
});

// ── 6. Admin queue: RBAC + masking + transitions ──

describe('admin callback queue endpoint', () => {
  test('RBAC: only admin can access the callbacks module', () => {
    expect(getModuleFromPath('/api/callbacks')).toBe('callbacks');
    expect(hasPermission('admin', 'callbacks', 'GET')).toBe(true);
    expect(hasPermission('admin', 'callbacks', 'PATCH')).toBe(true);
    for (const role of ['doctor', 'receptionist', 'pharmacist', 'billing', 'management']) {
      expect(hasPermission(role as never, 'callbacks', 'GET')).toBe(false);
    }
  });

  test('list masks phone numbers and never returns the full phone', async () => {
    setCallbackEnv();
    const { request } = createCallbackRequest({ session_id: 'admin-q-test', channel: 'chat', language: 'en', phone: '0307-9999007', reason: 'billing question' });
    const response = await handleCallbacks(new Request('http://test/api/callbacks?status=pending'));
    const payload = await response.json() as { requests: Array<Record<string, unknown>> };
    const found = payload.requests.find((r) => r.id === request.id);
    expect(found).toBeDefined();
    expect(found!.phone_masked).toBe('0307****9007');
    expect(found!).not.toHaveProperty('phone');
    expect(found!.reason).toBe('billing question');
    expect(found!.status).toBe('pending');
    expect(found!.language).toBe('en');
  });

  test('detail endpoint returns the full phone (admin operational access)', async () => {
    setCallbackEnv();
    const db = getDb();
    const row = db.query("SELECT id FROM callback_requests WHERE phone = ?").get('03079999007') as { id: number };
    const response = await handleCallbacks(new Request(`http://test/api/callbacks/${row.id}`));
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.phone).toBe('03079999007'); // full canonical number for dialing — masked everywhere else
  });

  test('status transitions: pending→contacted→closed; illegal transitions rejected', async () => {
    setCallbackEnv();
    const db = getDb();
    const row = db.query("SELECT id FROM callback_requests WHERE phone = ?").get('03079999007') as { id: number };

    const badStatus = await handleCallbacks(new Request(`http://test/api/callbacks/${row.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'hacked' }),
    }));
    expect(badStatus.status).toBe(400);

    const missingStatus = await handleCallbacks(new Request(`http://test/api/callbacks/${row.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(missingStatus.status).toBe(400);

    const contacted = await handleCallbacks(new Request(`http://test/api/callbacks/${row.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'contacted' }),
    }));
    expect(contacted.status).toBe(200);
    expect(((await contacted.json()) as { status: string }).status).toBe('contacted');

    // Backward transition is rejected (contacted → pending).
    const rewind = await handleCallbacks(new Request(`http://test/api/callbacks/${row.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    }));
    expect(rewind.status).toBe(400);
    expect(((await rewind.json()) as { error: string }).error).toContain('Invalid status transition');

    const closed = await handleCallbacks(new Request(`http://test/api/callbacks/${row.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }));
    expect(closed.status).toBe(200);

    // callback_status_updated event emitted with redacted metadata.
    const evt = db.query(
      "SELECT details FROM ai_events WHERE event_type = 'callback_status_updated' ORDER BY id DESC LIMIT 1"
    ).get() as { details: string };
    expect(evt).toBeDefined();
    expect(evt.details).toContain('closed');
    expect(evt.details).not.toContain('9999007');
    db.run('DELETE FROM callback_requests WHERE id = ?', [row.id]);
  });

  test('unknown request id → 404; safe error on garbage id', async () => {
    const missing = await handleCallbacks(new Request('http://test/api/callbacks/999999999'));
    expect(missing.status).toBe(404);
    const badId = await handleCallbacks(new Request('http://test/api/callbacks/abc'));
    expect([400, 404]).toContain(badId.status);
  });

  test('maskPhone masks conservatively', () => {
    expect(maskPhone('0300-1234567')).toBe('0300****4567');
    expect(maskPhone('03129998877')).toBe('0312****8877');
  });
});

// ── 7. Analytics counts ──

describe('analytics includes callback counts', () => {
  test('overview reports callbacks_requested and callbacks_pending', async () => {
    setCallbackEnv();
    const response = await handleAnalytics(new Request('http://test/api/analytics/overview?period=today'));
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(typeof payload.callbacks_requested).toBe('number');
    expect(typeof payload.callbacks_pending).toBe('number');
  });
});

// ── 8. Flow integration ──

describe('handoff flow integration', () => {
  test('a handoff request mid-booking bails into the callback flow', async () => {
    setCallbackEnv();
    const started = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    expect(started.conversation_active).toBe(true);
    const bailed = await handleMessage('actually, please call me back', started.session_id, 'en', 'chat');
    expect(bailed.intent).toBe('human_handoff');
    expect(bailed.reply).toContain('phone number');
    expect(bailed.conversation_active).toBe(true);
  });

  test('mode-off mid-flow also refuses honestly', async () => {
    setMode('off');
    const started = await handleMessage('I want to book an appointment', null, 'en', 'chat');
    const bailed = await handleMessage('call me back please', started.session_id, 'en', 'chat');
    expect(bailed.intent).toBe('human_handoff');
    expect(bailed.reply).toContain('not currently available');
    expect(bailed.conversation_active).toBe(false);
  });

  test('emergency reply offers a callback only when mode is callback', async () => {
    setMode('off');
    const offRes = await handleMessage('seena mein dard hai', null, 'ur', 'chat');
    expect(offRes.reply).toContain('1122');
    expect(offRes.reply).not.toContain('front desk se callback');

    setCallbackEnv();
    const onRes = await handleMessage('seena mein dard hai', null, 'ur', 'chat');
    expect(onRes.reply).toContain('1122');           // emergency instruction kept
    expect(onRes.reply).toContain('front desk se callback'); // offer appended
    expect(onRes.reply).toContain('Emergency services');      // only after 1122
  });
});
