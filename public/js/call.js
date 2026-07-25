// Subhan Care AI — Voice Call v2 | Tap-to-Speak default | Auto mode toggle
// ── Feature detection ──
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = !!window.speechSynthesis;

// ── State ──
let lang = 'en', callActive = false, processing = false, sessionId = null;
let autoMode = false, textMode = false, recogActive = false;
let callStart = null, timerInterval = null, actions = [];
// ── Speech objects ──
let recognition = null;
const synth = TTS ? window.speechSynthesis : null;

// ── DOM ──
const $ = id => document.getElementById(id);
const orbGlow = $('orbGlow'), orbCore = $('orbCore'), ring1 = $('ring1'), ring2 = $('ring2'), ring3 = $('ring3');
const statusText = $('statusText'), transcriptUser = $('transcriptUser'), transcriptAI = $('transcriptAI');
const textFallback = $('textFallback'), textInput = $('textInput'), textSendBtn = $('textSendBtn');
const micBtn = $('micBtn'), modeToggle = $('modeToggle'), typeBtn = $('typeBtn'), endBtn = $('endBtn');
const langToggle = $('langToggle'), callTimer = $('callTimer');

// ── Orbset: update orb visuals for state ──
function setOrbState(state) {
  [orbGlow, orbCore].forEach(el => { el.className = el.className.replace(/\b(listening|thinking|speaking)\b/g,'').trim(); el.classList.add(state); });
  [ring1, ring2, ring3].forEach(r => { r.classList.remove('active','speaking'); });
  if (state === 'listening') [ring1, ring2, ring3].forEach(r => r.classList.add('active'));
  if (state === 'speaking') [ring1, ring2, ring3].forEach(r => r.classList.add('speaking'));
}

function setStatus(state, custom) {
  setOrbState(state);
  const texts = {
    listening: { en: 'Listening...', ur: 'Sun raha hoon...' },
    thinking: { en: 'Thinking...', ur: 'Soch raha hoon...' },
    speaking: { en: 'Speaking...', ur: 'Bol raha hoon...' },
    idle: { en: 'Tap the mic to speak', ur: 'Bolne ke liye mic dabayein' },
    ready: { en: 'Tap mic for next turn', ur: 'Agli baat ke liye mic dabayein' },
    nospeech: { en: "Didn't catch that — tap mic to retry", ur: 'Kuch sunai nahi diya — dobara koshish karein' },
    error: { en: 'Voice error — try again or use text', ur: 'Awaz mein masla — text istemal karein' },
  };
  const entry = texts[state] || texts.idle;
  statusText.textContent = custom || (lang === 'ur' ? entry.ur : entry.en);
  statusText.className = 'status-text ' + (state === 'listening' || state === 'thinking' || state === 'speaking' || state === 'error' ? state : '');
}

function showTranscript(who, text, interim) {
  const el = who === 'user' ? transcriptUser : transcriptAI;
  el.textContent = text;
  el.className = 'transcript-msg ' + (who === 'user' ? 'transcript-user' : 'transcript-ai') + ' visible' + (interim ? ' interim' : '');
}

function clearTranscript() { transcriptUser.className = 'transcript-msg transcript-user'; transcriptAI.className = 'transcript-msg transcript-ai'; }

function setMicBtn(state) {
  micBtn.className = 'mic-btn';
  if (state === 'listening') micBtn.classList.add('listening');
  if (state === 'ready') micBtn.classList.add('ready');
}

// ── Timer ──
function startTimer() { callStart = Date.now(); timerInterval = setInterval(() => { const e = Math.floor((Date.now() - callStart) / 1000); callTimer.textContent = Math.floor(e / 60).toString().padStart(2, '0') + ':' + (e % 60).toString().padStart(2, '0'); }, 1000); }
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// ── TTS ──
function getVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  const t = lang === 'ur' ? 'ur' : 'en-US';
  return voices.find(v => v.lang.startsWith(t) && v.name.includes('Google')) || voices.find(v => v.lang.startsWith(t)) || voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
}

function speak(text) {
  return new Promise(resolve => {
    if (!synth) { resolve(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = getVoice(); if (v) u.voice = v;
    u.rate = lang === 'ur' ? 0.9 : 1.0; u.pitch = 1.0; u.volume = 1.0;
    u.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    setStatus('speaking'); setMicBtn('');
    u.onstart = () => { setStatus('speaking'); };
    u.onend = () => { processing = false; resolve(); onAIFinished(); };
    u.onerror = () => { processing = false; resolve(); onAIFinished(); };
    synth.speak(u);
  });
}

function onAIFinished() {
  if (!callActive) return;
  if (autoMode) {
    setStatus('listening'); setMicBtn('listening');
    startRecognition();
  } else if (textMode) {
    setStatus('idle'); setMicBtn('');
  } else {
    setStatus('ready'); setMicBtn('ready');
  }
}

// ── API ──
async function sendToAI(message) {
  const ctl = new AbortController(), tid = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch('/api/receptionist/voice-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, session_id: sessionId, language: lang }), signal: ctl.signal });
    clearTimeout(tid);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Server ${res.status}`); }
    return await res.json();
  } catch (e) { clearTimeout(tid); throw e; }
}

async function getGreeting() {
  try { const r = await fetch(`/api/receptionist/voice-greeting?language=${lang}`); if (r.ok) return (await r.json()).greeting; } catch (_) {}
  return lang === 'ur' ? 'Subhan Care mein khushamdeed. Bataaiye, kya madad chahiye?' : 'Thank you for calling Subhan Care. How can I help you today?';
}

// ── Goodbye detection ──
const END_PATTERNS = [/\bbye\b/i, /\bgoodbye\b/i, /\bgood bye\b/i, /\bsee you\b/i, /\bthank you\b/i, /\bthanks\b/i, /\bend call\b/i, /\bhang up\b/i, /\bthat'?s all\b/i, /\bnothing else\b/i, /\bi'?m done\b/i, /\btake care\b/i, /\bno thanks\b/i, /\bi'?m fine\b/i, /\bi'?m good\b/i, /\ball set\b/i, /\bshukriya\b/i, /\bshukria\b/i, /\ballah hafiz\b/i, /\bkhuda hafiz\b/i, /\btheek hai\b/i, /\bbas itna\b/i, /\bphir milenge\b/i];
const isGoodbye = t => END_PATTERNS.some(p => p.test(t));

// ── Core: process message ──
async function processMessage(text) {
  if (isGoodbye(text)) { await endCall(); return; }
  processing = true;
  setStatus('thinking'); setMicBtn('');
  showTranscript('user', text);
  try {
    const result = await sendToAI(text);
    sessionId = result.session_id || sessionId;
    if (result.action?.type) actions.push(result.action);
    showTranscript('ai', result.reply);
    if (result.should_end_call) { await speak(result.reply); await endCall(result.call_summary); return; }
    await speak(result.reply || (lang === 'ur' ? 'Samajh gaya. Aur kya madad chahiye?' : 'Got it. How else can I help?'));
  } catch (e) {
    console.error('Voice error:', e);
    processing = false;
    const errMsg = lang === 'ur' ? 'Maazrat, masla ho gaya. Dobara koshish karein.' : 'Sorry, something went wrong. Please try again.';
    showTranscript('ai', errMsg);
    await speak(errMsg);
  }
}

// ── Speech Recognition ──
function setupRecognition() {
  if (!SR) return false;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  updateRecogLang();

  recognition.onresult = (e) => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) final += t + ' ';
      else interim += t + ' ';
    }
    if (interim) showTranscript('user', interim, true);
    if (final) {
      const text = final.trim();
      if (!text) return;
      showTranscript('user', text);
      try { recognition.stop(); } catch (_) {}
      recogActive = false;
      if (!processing) processMessage(text);
    }
  };

  recognition.onspeechend = () => {
    // Give a brief window for final result to arrive
    setTimeout(() => {
      if (recogActive && !processing) {
        try { recognition.stop(); } catch (_) {}
        recogActive = false;
        if (autoMode) { setStatus('listening'); setMicBtn('listening'); startRecognition(); }
        else { setStatus('nospeech'); setMicBtn('ready'); }
      }
    }, 800);
  };

  recognition.onerror = (e) => {
    recogActive = false;
    if (e.error === 'not-allowed' || e.error === 'permission-denied') {
      setStatus('error'); showTranscript('ai', lang === 'ur' ? 'Mic ki ijazat nahi mili. Text mode istemal karein.' : 'Mic access denied. Switching to text mode.');
      switchToText();
      return;
    }
    if (e.error === 'no-speech') {
      if (!processing) { setStatus('nospeech'); if (!autoMode) setMicBtn('ready'); }
      if (autoMode && callActive && !processing) { setTimeout(() => { if (callActive && !recogActive && !processing) startRecognition(); }, 500); }
      return;
    }
    if (e.error === 'aborted') return;
    console.warn('Recognition error:', e.error);
    if (callActive && !processing) { setTimeout(() => { if (callActive && !recogActive && !processing) startRecognition(); }, 400); }
  };

  recognition.onend = () => {
    recogActive = false;
    if (autoMode && callActive && !processing) { setTimeout(() => startRecognition(), 300); }
  };

  return true;
}

function updateRecogLang() { if (recognition) recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US'; }

function startRecognition() {
  if (!callActive || processing || recogActive || !recognition) return;
  recogActive = true;
  try { recognition.start(); } catch (e) { recogActive = false; if (e.name !== 'InvalidStateError') { setTimeout(() => { if (callActive && !recogActive && !processing) startRecognition(); }, 300); } }
}

// ── Tap to Speak ──
function tapToSpeak() {
  if (processing) return;
  if (recogActive) { try { recognition.stop(); } catch (_) {} recogActive = false; return; }
  if (!recognition && !setupRecognition()) { switchToText(); return; }
  setStatus('listening'); setMicBtn('listening'); clearTranscript();
  startRecognition();
}

// ── Auto mode ──
function toggleAutoMode() {
  autoMode = !autoMode;
  modeToggle.textContent = autoMode ? 'Auto' : 'Tap';
  modeToggle.className = 'mode-toggle' + (autoMode ? ' auto' : '');
  if (recogActive) { try { recognition.stop(); } catch (_) {} recogActive = false; }
  if (autoMode) {
    if (!recognition && !setupRecognition()) { autoMode = false; modeToggle.textContent = 'Tap'; modeToggle.className = 'mode-toggle'; switchToText(); return; }
    setStatus('listening'); setMicBtn('listening');
    startRecognition();
  } else {
    setStatus('ready'); setMicBtn('ready');
  }
}

// ── Text mode ──
function switchToText() {
  textMode = true; textFallback.style.display = 'flex';
  if (recogActive) { try { recognition.stop(); } catch (_) {} recogActive = false; }
  setStatus('idle', lang === 'ur' ? 'Type karein...' : 'Type your message...');
  setMicBtn(''); typeBtn.classList.add('active');
}

async function handleTextSend() {
  const text = textInput.value.trim();
  if (!text || !callActive || processing) return;
  textInput.value = '';
  clearTranscript();
  await processMessage(text);
}

// ── End call ──
async function endCall(summaryText) {
  callActive = false; processing = false; recogActive = false;
  stopTimer();
  if (synth) synth.cancel();
  if (recognition) { try { recognition.stop(); } catch (_) {} }

  const summary = summaryText || (actions.length
    ? actions.map(a => { const d = a.data || {}; switch (a.type) { case 'appointment_created': return `Appointment with ${d.doctor_name || 'doctor'} on ${d.date || ''} at ${d.time || ''}`; case 'patient_created': return 'New patient registered'; case 'appointment_cancelled': return 'Appointment cancelled'; case 'appointment_rescheduled': return 'Appointment rescheduled'; default: return ''; } }).filter(Boolean).join('. ')
    : (lang === 'ur' ? 'Baat-cheet hui' : 'General inquiry handled'));

  let overlay = document.querySelector('.post-call-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'post-call-overlay'; overlay.innerHTML = `<div class="post-call-card"><h2>Call Ended</h2><p id="postSummary"></p><div class="post-call-actions"><button class="btn-primary" id="recallBtn">🔄 Call Again</button><a href="/" class="btn-outline">💬 Open Chat</a></div></div>`; document.body.appendChild(overlay); }
  overlay.classList.add('visible');
  overlay.querySelector('#postSummary').textContent = summary;

  const recallBtn = overlay.querySelector('#recallBtn');
  recallBtn.onclick = () => { overlay.classList.remove('visible'); resetCall(); startCall(); };
}

// ── Start / Reset ──
function resetCall() {
  processing = false; recogActive = false; sessionId = null; actions = [];
  stopTimer(); clearTranscript();
  if (recognition) { try { recognition.stop(); } catch (_) {} }
  if (synth) synth.cancel();
  textFallback.style.display = 'none'; textMode = false; typeBtn.classList.remove('active');
  callTimer.textContent = '00:00';
  setStatus('idle'); setMicBtn('');
}

async function startCall() {
  callActive = true;
  startTimer();
  if (!SR) { switchToText(); }
  if (autoMode) {
    if (!recognition && !setupRecognition()) { autoMode = false; modeToggle.textContent = 'Tap'; modeToggle.className = 'mode-toggle'; switchToText(); return; }
    setStatus('listening'); setMicBtn('listening');
    startRecognition();
  } else {
    setStatus('ready'); setMicBtn('ready');
  }
  // Play greeting
  try {
    const g = await getGreeting();
    processing = true; setStatus('speaking'); setMicBtn('');
    await speak(g);
  } catch (_) {
    processing = false;
    if (autoMode) { setStatus('listening'); setMicBtn('listening'); startRecognition(); }
    else { setStatus('ready'); setMicBtn('ready'); }
  }
}

// ── Event bindings ──
micBtn.addEventListener('click', () => {
  if (textMode) return;
  if (!callActive) { startCall(); return; }
  if (autoMode) return; // In auto mode, mic button is display-only
  tapToSpeak();
});

modeToggle.addEventListener('click', () => {
  if (!callActive) return;
  if (textMode) { textMode = false; textFallback.style.display = 'none'; typeBtn.classList.remove('active'); }
  toggleAutoMode();
});

typeBtn.addEventListener('click', () => {
  if (!callActive) return;
  if (textMode) { textMode = false; textFallback.style.display = 'none'; typeBtn.classList.remove('active'); if (autoMode) { setStatus('listening'); setMicBtn('listening'); startRecognition(); } else { setStatus('ready'); setMicBtn('ready'); } return; }
  switchToText();
});

endBtn.addEventListener('click', () => endCall());

textSendBtn.addEventListener('click', handleTextSend);
textInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleTextSend(); } });

langToggle.addEventListener('click', () => {
  lang = lang === 'en' ? 'ur' : 'en';
  langToggle.innerHTML = lang === 'en' ? 'EN | <span class="lang-inactive">UR</span>' : '<span class="lang-inactive">EN</span> | UR';
  if (recogActive) { try { recognition.stop(); } catch (_) {} recogActive = false; }
  updateRecogLang();
  if (callActive && !processing) {
    if (autoMode) { setTimeout(() => startRecognition(), 200); }
    else { setStatus('ready'); setMicBtn('ready'); }
  }
});

window.addEventListener('beforeunload', () => { callActive = false; stopTimer(); if (synth) synth.cancel(); if (recognition) { try { recognition.stop(); } catch (_) {} } });

// ── Init ──
if (!SR) { setStatus('idle', lang === 'ur' ? 'Awaz support nahi — type karein' : 'Voice not supported — use text'); switchToText(); callActive = true; startTimer(); }
else { setStatus('idle'); }

// Preload voices
if (synth) { synth.getVoices(); synth.onvoiceschanged = () => synth.getVoices(); }
