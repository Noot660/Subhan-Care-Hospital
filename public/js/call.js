// Subhan Care AI — Voice Call v3
// Tap-to-interrupt: tap mic anytime to stop AI speech and start speaking.
// Short back-and-forth: the AI speaks 1 sentence, then listens to you.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = !!window.speechSynthesis;
const synth = TTS ? window.speechSynthesis : null;

// ── State machine ──
// idle → listening → thinking → speaking → (ready → ...) → idle
let callActive = false;
let processing = false;
let recogActive = false;
let sessionId = null;
let lang = 'en';
let autoMode = false;
let textMode = false;
let muted = false;
let callStart = null;
let timerInterval = null;
let actions = [];
let recognition = null;
let silenceTimer = null;
let currentUtterance = null;
let connectionErrorTimer = null;
let audioCtx = null;
let audioStream = null;
let analyser = null;
let animFrame = null;
let speakerOn = true;
let chipClickActive = false;
let consecutiveFailures = 0;

function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  return audioCtx;
}

function playTone(startFreq, endFreq, durationMs, vol) {
  const ctx = getAudioCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + durationMs / 1000);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
  } catch (_) {}
}

// ── DOM refs ──
const $ = id => document.getElementById(id);
const orbGlow = $('orbGlow'), orbCore = $('orbCore');
const ring1 = $('ring1'), ring2 = $('ring2'), ring3 = $('ring3');
const statusText = $('statusText');
const transcriptUser = $('transcriptUser'), transcriptAI = $('transcriptAI');
const textFallback = $('textFallback'), textInput = $('textInput'), textSendBtn = $('textSendBtn');
const micBtn = $('micBtn'), modeToggle = $('modeToggle'), typeBtn = $('typeBtn'), endBtn = $('endBtn');
const langToggle = $('langToggle'), callTimer = $('callTimer');
const muteBtn = $('muteBtn'), connectionDot = $('connectionDot');
const audioBars = $('audioBars'), quickChips = $('quickChips'), speakerBtn = $('speakerBtn');

// ── Orb icons ──
const ORB_ICONS = {
  idle: `<svg class="orb-mic-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>`,
  listening: `<svg class="orb-mic-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V8a3 3 0 0 0-3-3z"/>
    <path d="M5 13a7 7 0 0 0 14 0"/>
    <path d="M8 21h8"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>`,
  thinking: `<svg class="orb-mic-icon" viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
    <circle cx="5" cy="12" r="2.5" class="thinking-dot dot1"/>
    <circle cx="12" cy="12" r="2.5" class="thinking-dot dot2"/>
    <circle cx="19" cy="12" r="2.5" class="thinking-dot dot3"/>
  </svg>`,
  speaking: `<svg class="orb-mic-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
  </svg>`,
  interrupted: `<svg class="orb-mic-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V8a3 3 0 0 0-3-3z"/>
    <path d="M5 13a7 7 0 0 0 14 0"/>
    <path d="M8 21h8"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>`,
};

// ── Visual state ──
function setOrbState(state) {
  [orbGlow, orbCore].forEach(el => {
    el.className = el.className.replace(/\b(listening|thinking|speaking)\b/g, '').trim();
    el.classList.add(state);
  });
  [ring1, ring2, ring3].forEach(r => { r.classList.remove('active', 'speaking'); });
  if (state === 'listening') [ring1, ring2, ring3].forEach(r => r.classList.add('active'));
  if (state === 'speaking') [ring1, ring2, ring3].forEach(r => r.classList.add('speaking'));

  // Swap orb icon
  const existing = orbCore.querySelector('.orb-mic-icon');
  if (existing) existing.classList.add('fading-out');
  setTimeout(() => {
    orbCore.innerHTML = (ORB_ICONS[state] || ORB_ICONS.idle);
  }, 120);
}

function setStatus(state, custom) {
  setOrbState(state);
  const texts = {
    idle:       { en: 'Tap the mic to speak', ur: 'Bolne ke liye mic dabayein' },
    listening:  { en: 'Listening...', ur: 'Sun raha hoon...' },
    thinking:   { en: 'Thinking...', ur: 'Soch raha hoon...' },
    speaking:   { en: 'Speaking...', ur: 'Bol raha hoon...' },
    ready:      { en: 'Tap mic for next turn', ur: 'Agli baat ke liye mic dabayein' },
    nospeech:   { en: "Didn't catch that — tap mic", ur: 'Kuch sunai nahi diya — dobara koshish karein' },
    error:      { en: 'Voice error — try again or use text', ur: 'Awaz mein masla — text istemal karein' },
    interrupted:{ en: 'Go ahead...', ur: 'Boliye...' },
  };
  const entry = texts[state] || texts.idle;
  statusText.textContent = custom || (lang === 'ur' ? entry.ur : entry.en);
  statusText.className = 'status-text ' +
    (['listening', 'thinking', 'speaking', 'error', 'interrupted'].includes(state) ? state : '');
  updateChips(state);
  if (audioBars) audioBars.classList.toggle('active', state === 'listening' && !muted);
}

function updateChips(state) {
  if (!quickChips) return;
  const options = { idle: ['Book appointment', 'Check timings', 'Register'], ready: ['Book appointment', 'Check timings', 'Register'], listening: ['Yes', 'No', 'Go back'] }[state] || [];
  quickChips.innerHTML = options.map(text => `<button class="chip" type="button">${text}</button>`).join('');
  quickChips.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    if (!callActive || processing) return;
    chipClickActive = true;
    quickChips.innerHTML = '';
    processMessage(chip.textContent.trim()).finally(() => { chipClickActive = false; });
  }));
}

function setConnectionDot(state) {
  connectionDot.className = 'connection-dot ' + state;
  const titles = { connected: 'Connected', processing: 'Processing...', error: 'Connection error', offline: 'Offline' };
  connectionDot.title = titles[state] || 'Connected';
}

function showTranscript(who, text, interim) {
  const el = who === 'user' ? transcriptUser : transcriptAI;
  el.textContent = text;
  el.className = 'transcript-msg ' + (who === 'user' ? 'transcript-user' : 'transcript-ai') +
    ' visible' + (interim ? ' interim' : '');
}

function clearTranscript() {
  transcriptUser.className = 'transcript-msg transcript-user';
  transcriptUser.textContent = '';
  transcriptAI.className = 'transcript-msg transcript-ai';
  transcriptAI.textContent = '';
}

// ── Conversation history ──
let transcriptList = null;

function initTranscriptHistory() {
  transcriptList = document.createElement('div');
  transcriptList.id = 'transcriptList';
  const area = document.getElementById('transcriptArea');
  // Insert before the existing transcriptUser/transcriptAI elements
  area.insertBefore(transcriptList, area.firstChild);
}

function pushToHistory(userText, aiText) {
  if (!transcriptList) return;

  if (userText) {
    const div = document.createElement('div');
    div.className = 'transcript-msg transcript-user visible';
    div.textContent = userText;
    transcriptList.appendChild(div);
  }

  if (aiText) {
    const div = document.createElement('div');
    div.className = 'transcript-msg transcript-ai visible';
    div.textContent = aiText;
    transcriptList.appendChild(div);
  }

  // Keep last 10 messages (individual elements)
  while (transcriptList.children.length > 10) {
    transcriptList.removeChild(transcriptList.firstChild);
  }

  // Auto-scroll
  transcriptList.parentElement.scrollTop = transcriptList.parentElement.scrollHeight;
}

function clearTranscriptHistory() {
  if (transcriptList) transcriptList.innerHTML = '';
}

function setMicBtn(state) {
  micBtn.className = 'mic-btn';
  if (muted) micBtn.classList.add('disabled');
  if (state === 'listening') micBtn.classList.add('listening');
  if (state === 'ready') micBtn.classList.add('ready');
  if (state === 'speaking') micBtn.classList.add('speaking');
}

// ── Mute ──
function startAudioViz() {
  if (audioStream || !navigator.mediaDevices?.getUserMedia || muted) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    if (!callActive || muted) { stream.getTracks().forEach(t => t.stop()); return; }
    audioStream = stream;
    const ctx = getAudioCtx();
    if (!ctx) return;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = audioBars?.querySelectorAll('span') || [];
    const draw = () => {
      if (!analyser) return;
      analyser.getByteFrequencyData(data);
      const chunk = Math.max(1, Math.floor(data.length / 5));
      bars.forEach((el, i) => {
        let total = 0, count = 0;
        for (let j = i * chunk; j < Math.min(data.length, (i + 1) * chunk); j++) { total += data[j]; count++; }
        el.style.height = `${3 + ((count ? total / count : 0) / 255) * 21}px`;
      });
      animFrame = requestAnimationFrame(draw);
    };
    draw();
  }).catch(() => {});
}

function stopAudioViz() {
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
  if (audioStream) audioStream.getTracks().forEach(track => track.stop());
  audioStream = null;
  analyser = null;
  if (audioBars) { audioBars.classList.remove('active'); audioBars.querySelectorAll('span').forEach(el => { el.style.height = '3px'; }); }
}

function toggleMute() {
  muted = !muted;
  if (muted) {
    stopAudioViz();
    muteBtn.textContent = '🔇';
    muteBtn.classList.add('muted');
    muteBtn.setAttribute('aria-label', 'Unmute');
    stopRecognition();
    if (synth) synth.cancel();
    currentUtterance = null;
    processing = false;
    setStatus('idle', lang === 'ur' ? 'Mute — awaaz band' : 'Muted');
    setMicBtn('');
  } else {
    muteBtn.textContent = '🔊';
    muteBtn.classList.remove('muted');
    muteBtn.setAttribute('aria-label', 'Mute');
    if (!callActive || textMode) return;
    if (autoMode) {
      setStatus('listening');
      setMicBtn('listening');
      startRecognition();
    } else {
      setStatus('ready');
      setMicBtn('ready');
    }
  }
}

// ── Timer ──
function startTimer() {
  callStart = Date.now();
  timerInterval = setInterval(() => {
    const e = Math.floor((Date.now() - callStart) / 1000);
    callTimer.textContent =
      Math.floor(e / 60).toString().padStart(2, '0') + ':' + (e % 60).toString().padStart(2, '0');
  }, 1000);
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// ── TTS ──
function getVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  const t = lang === 'ur' ? 'ur' : 'en-US';
  return voices.find(v => v.lang.startsWith(t) && v.name.includes('Google')) ||
    voices.find(v => v.lang.startsWith(t)) ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] || null;
}

function speak(text) {
  return new Promise(resolve => {
    if (!synth) { resolve(); return; }
    synth.cancel(); // Cancel any in-progress speech
    const u = new SpeechSynthesisUtterance(text);
    const v = getVoice();
    if (v) u.voice = v;
    u.rate = lang === 'ur' ? 0.9 : 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    currentUtterance = u;

    u.onstart = () => {
      setStatus('speaking');
      setMicBtn('speaking');
    };
    u.onend = () => {
      currentUtterance = null;
      processing = false;
      resolve();
      afterAISpoke();
    };
    u.onerror = () => {
      currentUtterance = null;
      processing = false;
      resolve();
      afterAISpoke();
    };

    synth.speak(u);
  });
}

function interruptSpeech() {
  stopAudioViz();
  if (!synth) return;
  synth.cancel();
  currentUtterance = null;
}

function afterAISpoke() {
  if (!callActive || muted) return;
  if (autoMode) {
    setStatus('listening');
    setMicBtn('listening');
    startRecognition();
  } else {
    setStatus('ready');
    setMicBtn('ready');
  }
}

// ── API ──
async function sendToAI(message) {
  setConnectionDot('processing');
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch('/api/receptionist/voice-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId, language: lang }),
      signal: ctl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Server ${res.status}`);
    }
    setConnectionDot('connected');
    consecutiveFailures = 0;
    return await res.json();
  } catch (e) {
    clearTimeout(tid);
    setConnectionDot('error');
    // Auto-reset to connected after 2 seconds
    clearTimeout(connectionErrorTimer);
    connectionErrorTimer = setTimeout(() => {
      if (connectionDot.classList.contains('error')) setConnectionDot('connected');
    }, 2000);
    throw e;
  }
}

async function getGreeting() {
  try {
    const r = await fetch(`/api/receptionist/voice-greeting?language=${lang}`);
    if (r.ok) return (await r.json()).greeting;
  } catch (_) {}
  return lang === 'ur'
    ? 'Subhan Care mein khushamdeed. Bataaiye, kya madad chahiye?'
    : 'Thank you for calling Subhan Care. How can I help you today?';
}

// ── Goodbye ──
const END_PATTERNS = [
  /\bbye\b/i, /\bgoodbye\b/i, /\bgood bye\b/i, /\bsee you\b/i,
  /\bthank you\b/i, /\bthanks\b/i, /\bend call\b/i, /\bhang up\b/i,
  /\bthat'?s all\b/i, /\bnothing else\b/i, /\bi'?m done\b/i,
  /\btake care\b/i, /\bno thanks\b/i, /\bi'?m fine\b/i, /\bi'?m good\b/i, /\ball set\b/i,
  /\bshukriya\b/i, /\bshukria\b/i, /\ballah hafiz\b/i, /\bkhuda hafiz\b/i,
  /\btheek hai\b/i, /\bbas itna\b/i, /\bphir milenge\b/i,
];

// ── Core: process a user message ──
async function processMessage(text) {
  if (END_PATTERNS.some(p => p.test(text))) {
    await endCall();
    return;
  }

  processing = true;
  setStatus('thinking');
  setMicBtn('');
  showTranscript('user', text);

  try {
    const result = await sendToAI(text);
    sessionId = result.session_id || sessionId;
    if (result.action?.type) actions.push(result.action);
    showTranscript('ai', result.reply);

    if (result.should_end_call) {
      await speak(result.reply);
      pushToHistory(null, result.reply);
      clearTranscript();
      await endCall(result.call_summary);
      return;
    }
    const aiReply = result.reply || (lang === 'ur'
      ? 'Samajh gaya. Aur kya madad chahiye?'
      : 'Got it. How else can I help?');
    await speak(aiReply);
    pushToHistory(text, aiReply);
    clearTranscript();
  } catch (e) {
    console.error('Voice error:', e);
    consecutiveFailures++;
    setConnectionDot('error');
    if (consecutiveFailures < 3) {
      processing = false;
      setStatus('thinking', lang === 'ur' ? 'Rabita masla — dobara koshish...' : 'Connection issue — retrying...');
      setTimeout(() => { if (callActive) processMessage(text); }, 2000);
      return;
    }
    processing = false;
    setStatus('ready', lang === 'ur' ? 'Rabita nahi ho saka — mic dabayein' : 'Unable to connect — tap mic to retry');
    setMicBtn('ready');
    const errMsg = lang === 'ur' ? 'Maazrat, rabita nahi ho saka. Dobara koshish karein.' : 'Sorry, we could not connect. Please try again.';
    showTranscript('ai', errMsg);
    pushToHistory(text, errMsg);
    clearTranscript();
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
    clearSilenceTimer();
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
      stopRecognition();
      if (!processing) processMessage(text);
    }
  };

  recognition.onerror = (e) => {
    clearSilenceTimer();
    recogActive = false;
    if (e.error === 'not-allowed') {
      setStatus('error');
      showTranscript('ai', lang === 'ur'
        ? 'Mic ki ijazat nahi mili. Text mode istemal karein.'
        : 'Mic access denied. Switching to text mode.');
      switchToText();
      return;
    }
    if (e.error === 'no-speech') {
      if (!processing) {
        setStatus('nospeech');
        if (!autoMode) setMicBtn('ready');
      }
      if (autoMode && callActive && !processing) {
        setTimeout(() => { if (callActive && !recogActive && !processing) startRecognition(); }, 600);
      }
      return;
    }
    if (e.error === 'aborted') return;
    // Other errors: retry
    if (callActive && !processing) {
      setTimeout(() => { if (callActive && !recogActive && !processing) startRecognition(); }, 500);
    }
  };

  recognition.onend = () => {
    clearSilenceTimer();
    recogActive = false;
    // Auto mode: always re-listen unless processing
    if (autoMode && callActive && !processing) {
      setTimeout(() => startRecognition(), 300);
    }
  };

  return true;
}

function updateRecogLang() {
  if (recognition) recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
}

function startRecognition() {
  if (!callActive || processing || recogActive || !recognition || muted) return;
  startAudioViz();
  recogActive = true;
  try {
    recognition.start();
    // Start silence timer: if no result within 5s, stop and retry
    startSilenceTimer();
  } catch (e) {
    recogActive = false;
    if (e.name !== 'InvalidStateError') {
      setTimeout(() => { if (callActive && !recogActive && !processing) startRecognition(); }, 300);
    }
  }
}

function stopRecognition() {
  stopAudioViz();
  clearSilenceTimer();
  if (recognition && recogActive) {
    try { recognition.stop(); } catch (_) {}
  }
  recogActive = false;
}

function startSilenceTimer() {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (recogActive && !processing) {
      stopRecognition();
      if (autoMode) {
        setStatus('listening');
        setMicBtn('listening');
        startRecognition();
      } else {
        setStatus('nospeech');
        setMicBtn('ready');
      }
    }
  }, 5000);
}

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
}

// ── Tap to Speak (and interrupt!) ──
function handleMicTap() {
  if (textMode) return;
  if (muted) return;  // Muted — mic button is disabled

  // If call hasn't started, start it
  if (!callActive) {
    startCall();
    return;
  }

  // In auto mode, mic button interrupts speech — otherwise ignore
  if (autoMode) {
    if (processing && currentUtterance) {
      playTone(800, 800, 30, 0.1);
      interruptSpeech();
      processing = false;
      clearTranscript();
      setStatus('interrupted');
      setMicBtn('listening');
      try { navigator.vibrate?.([10, 30, 10]); } catch (_) {}
      setTimeout(() => {
        if (!callActive) return;
        if (!recognition && !setupRecognition()) { switchToText(); return; }
        setStatus('listening');
        startRecognition();
      }, 200);
    }
    return;
  }

  // ★ TAP TO INTERRUPT: If AI is currently speaking, shut it up and start listening
  if (processing && currentUtterance) {
    playTone(800, 800, 30, 0.1);
    interruptSpeech();
    processing = false;
    clearTranscript();
    setStatus('interrupted');
    setMicBtn('listening');
    try { navigator.vibrate?.([10, 30, 10]); } catch (_) {}
    // Brief pause so the user knows they can speak
    setTimeout(() => {
      if (!callActive) return;
      if (!recognition && !setupRecognition()) { switchToText(); return; }
      setStatus('listening');
      startRecognition();
    }, 200);
    return;
  }

  // If already listening, stop listening (cancel)
  if (recogActive) {
    stopRecognition();
    setStatus('idle');
    setMicBtn('');
    return;
  }

  // Normal tap-to-speak: start listening
  if (!recognition && !setupRecognition()) {
    switchToText();
    return;
  }
  setStatus('listening');
  setMicBtn('listening');
  clearTranscript();
  try { navigator.vibrate?.(15); } catch (_) {}
  startRecognition();
}

// ── Auto mode toggle ──
function toggleAutoMode() {
  autoMode = !autoMode;
  modeToggle.textContent = autoMode ? 'Auto' : 'Tap';
  modeToggle.className = 'mode-toggle' + (autoMode ? ' auto' : '');

  stopRecognition();

  if (autoMode) {
    if (muted) return;
    if (!recognition && !setupRecognition()) {
      autoMode = false;
      modeToggle.textContent = 'Tap';
      modeToggle.className = 'mode-toggle';
      switchToText();
      return;
    }
    setStatus('listening');
    setMicBtn('listening');
    startRecognition();
  } else {
    setStatus('ready');
    setMicBtn('ready');
  }
}

// ── Text mode ──
function switchToText() {
  textMode = true;
  textFallback.style.display = 'flex';
  stopRecognition();
  setStatus('idle', lang === 'ur' ? 'Type karein...' : 'Type your message...');
  setMicBtn('');
  typeBtn.classList.add('active');
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
  playTone(600, 300, 200, 0.15);
  stopAudioViz();
  if (quickChips) quickChips.innerHTML = '';
  callActive = false;
  processing = false;
  stopRecognition();
  stopTimer();
  clearSilenceTimer();
  if (synth) synth.cancel();
  currentUtterance = null;
  setConnectionDot('offline');
  // Reset mute
  if (muted) {
    muted = false;
    muteBtn.textContent = '🔊';
    muteBtn.classList.remove('muted');
    muteBtn.setAttribute('aria-label', 'Mute');
  }
  setStatus('idle');
  setMicBtn('');

  const summary = summaryText || (actions.length
    ? actions.map(a => {
        const d = a.data || {};
        switch (a.type) {
          case 'appointment_created': return `Appointment with ${d.doctor_name || 'doctor'} on ${d.date || ''} at ${d.time || ''}`;
          case 'patient_created': return 'New patient registered';
          case 'appointment_cancelled': return 'Appointment cancelled';
          case 'appointment_rescheduled': return 'Appointment rescheduled';
          default: return '';
        }
      }).filter(Boolean).join('. ')
    : (lang === 'ur' ? 'Baat-cheet hui' : 'General inquiry handled'));

  let overlay = document.querySelector('.post-call-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'post-call-overlay';
    overlay.innerHTML = `
      <div class="post-call-card">
        <h2>${lang === 'ur' ? 'Call Khatam' : 'Call Ended'}</h2>
        <p id="postSummary"></p>
        <div class="post-call-actions">
          <button class="btn-primary" id="recallBtn">🔄 ${lang === 'ur' ? 'Dobara Call' : 'Call Again'}</button>
          <a href="/" class="btn-outline">💬 ${lang === 'ur' ? 'Chat' : 'Open Chat'}</a>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.classList.add('visible');
  overlay.querySelector('#postSummary').textContent = summary;
  overlay.querySelector('#recallBtn').onclick = () => {
    overlay.classList.remove('visible');
    resetCall();
    startCall();
  };
}

// ── Reset / Start ──
function resetCall() {
  consecutiveFailures = 0;
  processing = false;
  stopRecognition();
  stopTimer();
  clearSilenceTimer();
  clearTranscript();
  clearTranscriptHistory();
  if (synth) synth.cancel();
  currentUtterance = null;
  sessionId = null;
  actions = [];
  textFallback.style.display = 'none';
  textMode = false;
  typeBtn.classList.remove('active');
  muted = false;
  muteBtn.textContent = '🔊';
  muteBtn.classList.remove('muted');
  muteBtn.setAttribute('aria-label', 'Mute');
  callTimer.textContent = '00:00';
  setStatus('idle');
  setMicBtn('');
}

async function startCall() {
  consecutiveFailures = 0;
  playTone(300, 600, 150, 0.15);
  callActive = true;
  startTimer();
  setConnectionDot('connected');

  if (!SR) { switchToText(); return; }

  if (autoMode) {
    if (!recognition && !setupRecognition()) {
      autoMode = false;
      modeToggle.textContent = 'Tap';
      modeToggle.className = 'mode-toggle';
      switchToText();
      return;
    }
    setStatus('listening');
    setMicBtn('listening');
    startRecognition();
  } else {
    setStatus('ready');
    setMicBtn('ready');
  }

  // Play greeting
  try {
    const g = await getGreeting();
    processing = true;
    setStatus('speaking');
    setMicBtn('speaking');
    await speak(g);
  } catch (_) {
    processing = false;
    afterAISpoke();
  }
}

// ── Event bindings ──
micBtn.addEventListener('click', handleMicTap);

modeToggle.addEventListener('click', () => {
  if (!callActive) return;
  if (textMode) {
    textMode = false;
    textFallback.style.display = 'none';
    typeBtn.classList.remove('active');
  }
  toggleAutoMode();
});

typeBtn.addEventListener('click', () => {
  if (!callActive) return;
  if (textMode) {
    // Exit text mode
    textMode = false;
    textFallback.style.display = 'none';
    typeBtn.classList.remove('active');
    if (muted) return;
    if (autoMode) {
      setStatus('listening');
      setMicBtn('listening');
      startRecognition();
    } else {
      setStatus('ready');
      setMicBtn('ready');
    }
    return;
  }
  switchToText();
});

endBtn.addEventListener('click', () => endCall());

muteBtn.addEventListener('click', toggleMute);

function toggleSpeaker() {
  speakerOn = !speakerOn;
  speakerBtn.textContent = speakerOn ? '📢' : '🎧';
  speakerBtn.classList.toggle('speaker-on', speakerOn);
  speakerBtn.setAttribute('aria-label', speakerOn ? 'Speaker on' : 'Speaker off');
  try {
    const chooser = navigator.mediaDevices?.selectAudioOutput;
    if (chooser) chooser.call(navigator.mediaDevices).catch(() => {});
  } catch (_) {}
}

speakerBtn.addEventListener('click', toggleSpeaker);

textSendBtn.addEventListener('click', handleTextSend);
textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); handleTextSend(); }
});

langToggle.addEventListener('click', () => {
  lang = lang === 'en' ? 'ur' : 'en';
  langToggle.innerHTML = lang === 'en'
    ? 'EN | <span class="lang-inactive">UR</span>'
    : '<span class="lang-inactive">EN</span> | UR';
  stopRecognition();
  updateRecogLang();
  if (callActive && !processing) {
    if (autoMode) {
      setTimeout(() => startRecognition(), 200);
    } else {
      setStatus('ready');
      setMicBtn('ready');
    }
  }
});

window.addEventListener('beforeunload', () => {
  callActive = false;
  stopTimer();
  clearSilenceTimer();
  if (synth) synth.cancel();
  stopRecognition();
});

// ── Space bar walkie-talkie (desktop) ──
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.code !== 'Space') return;
  if (!callActive || processing || textMode || muted) return;

  // Don't capture if an input element is focused
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return;

  e.preventDefault();

  // In auto mode, space bar interrupts speech
  if (autoMode) {
    if (processing && currentUtterance) {
      interruptSpeech();
      processing = false;
      clearTranscript();
      setStatus('interrupted');
      setMicBtn('listening');
      try { navigator.vibrate?.([10, 30, 10]); } catch (_) {}
      setTimeout(() => {
        if (!callActive) return;
        if (!recognition && !setupRecognition()) { switchToText(); return; }
        setStatus('listening');
        startRecognition();
      }, 200);
    }
    return;
  }

  // Already listening — space is being held
  if (recogActive) return;

  // Interrupt or start fresh
  if (processing && currentUtterance) {
    interruptSpeech();
    processing = false;
    clearTranscript();
    setStatus('interrupted');
    setMicBtn('listening');
    try { navigator.vibrate?.([10, 30, 10]); } catch (_) {}
    setTimeout(() => {
      if (!callActive) return;
      if (!recognition && !setupRecognition()) { switchToText(); return; }
      setStatus('listening');
      startRecognition();
    }, 200);
    return;
  }

  // Normal: start listening
  if (!recognition && !setupRecognition()) { switchToText(); return; }
  setStatus('listening');
  setMicBtn('listening');
  clearTranscript();
  try { navigator.vibrate?.(15); } catch (_) {}
  startRecognition();
});

document.addEventListener('keyup', (e) => {
  if (e.key !== ' ' && e.code !== 'Space') return;
  if (!callActive || textMode || muted) return;

  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return;

  e.preventDefault();

  if (recogActive) {
    stopRecognition();
    // onresult fires with captured speech → processMessage handles the rest
    // If nothing was captured, reset after a brief delay
    setTimeout(() => {
      if (!processing && !recogActive && callActive && !autoMode) {
        setStatus('ready');
        setMicBtn('ready');
      }
    }, 600);
  }
});

// ── Escape to end call ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && callActive) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return;
    endCall();
  }
});

// ── Tab-away handling ──
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause
    stopRecognition();
    clearSilenceTimer();
    if (synth) synth.cancel();
    currentUtterance = null;
    setStatus('idle', 'Call paused — return to tab');
  } else if (callActive) {
    // Resume
    if (muted) return;
    if (textMode) return;
    if (autoMode) {
      setStatus('listening');
      setMicBtn('listening');
      startRecognition();
    } else {
      setStatus('ready');
      setMicBtn('ready');
    }
  }
});

// ── Init ──
initTranscriptHistory();

// Set mobile browser chrome color to match dark theme
const themeMeta = document.querySelector('meta[name="theme-color"]');
if (themeMeta) {
  themeMeta.setAttribute('content', '#0a0f1e');
} else {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#0a0f1e';
  document.head.appendChild(meta);
}

if (!SR) {
  setStatus('idle', lang === 'ur' ? 'Awaz support nahi — type karein' : 'Voice not supported — use text');
  switchToText();
  callActive = true;
  startTimer();
} else {
  setStatus('idle');
}

// Preload voices
if (synth) {
  synth.getVoices();
  synth.onvoiceschanged = () => synth.getVoices();
}
