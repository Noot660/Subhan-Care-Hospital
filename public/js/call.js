// Voice call handler for Subhan Care AI Receptionist
// Uses browser SpeechRecognition + SpeechSynthesis APIs
// With graceful degradation for unsupported browsers

// ── State ──
let lang = 'en';
let callActive = false;
let listening = false;
let speaking = false;
let sessionId = null;
let callStartTime = null;
let timerInterval = null;
let silenceTimer = null;
let actions = []; // Track actions taken during call
let transcript = [];

// ── DOM refs ──
const callContainer = document.getElementById('callContainer');
const micPrompt = document.getElementById('micPrompt');
const micAllowBtn = document.getElementById('micAllowBtn');
const callUI = document.getElementById('callUI');
const postCallUI = document.getElementById('postCallUI');
const textFallbackUI = document.getElementById('textFallbackUI');
const statusText = document.getElementById('statusText');
const waveform = document.getElementById('waveform');
const listeningDots = document.getElementById('listeningDots');
const thinkingDots = document.getElementById('thinkingDots');
const callTimer = document.getElementById('callTimer');
const callSummary = document.getElementById('callSummary');
const callSummaryText = document.getElementById('callSummaryText');
const postCallSummaryText = document.getElementById('postCallSummaryText');
const postCallActionsList = document.getElementById('postCallActionsList');
const transcriptPreview = document.getElementById('transcriptPreview');
const callError = document.getElementById('callError');
const endCallBtn = document.getElementById('endCallBtn');
const langToggle = document.getElementById('langToggle');
const recallBtn = document.getElementById('recallBtn');
const phoneIcon = document.getElementById('phoneIcon');
const textInputWrap = document.getElementById('textInputWrap');
const textInput = document.getElementById('textInput');
const textSendBtn = document.getElementById('textSendBtn');
const useTextBtn = document.getElementById('useTextBtn');
const textModeBanner = document.getElementById('textModeBanner');

// ── Feature Detection ──
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSpeechRecognition = !!SpeechRecognition;
const hasSpeechSynthesis = !!window.speechSynthesis;

// ── Speech Recognition Setup ──
let recognition = null;

function setupRecognition() {
  if (!SpeechRecognition) {
    showError('Speech recognition is not supported in this browser. Please use Chrome or Edge, or switch to text mode.');
    showTextFallbackOption();
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;      // Bug 2.1: continuous mode — no restart delay
  recognition.interimResults = true;  // Bug 2.4: show live transcription
  recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    clearSilenceTimer();
    let finalText = '';
    let interimText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interimText += result[0].transcript;
      }
    }

    // Show interim results as user speaks
    if (interimText) {
      updateTranscriptPreview(interimText, true);
    }

    if (finalText) {
      const text = finalText.trim();
      transcriptPreview.classList.remove('interim');
      if (!text) return;

      transcript.push({ role: 'user', text });
      updateTranscriptPreview(text, false);
      handleUserSpeech(text);
    }
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    clearSilenceTimer();

    if (event.error === 'not-allowed' || event.error === 'permission-denied') {
      showError('Microphone access denied. Please allow microphone access and try again, or use text mode.');
      showTextFallbackOption();
      return;
    }

    if (event.error === 'aborted' || event.error === 'no-speech') {
      if (callActive && listening) {
        startSilenceTimer();
      }
      return;
    }

    // Other errors — try again after delay
    if (callActive) {
      setTimeout(() => {
        if (callActive) startListening();
      }, 1000);
    }
  };

  recognition.onend = () => {
    listening = false;
    // If still active but not speaking, restart listening
    if (callActive && !speaking) {
      startSilenceTimer();
    }
  };

  return true;
}

function updateRecognitionLang() {
  if (recognition) {
    recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
  }
}

// ── Speech Synthesis ──
let synth = hasSpeechSynthesis ? window.speechSynthesis : null;
let currentUtterance = null;

function getBestVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  const targetLang = lang === 'ur' ? 'ur' : 'en-US';

  // Check localStorage first
  const cachedVoice = localStorage.getItem(`sc-preferred-voice-${lang}`);
  if (cachedVoice) {
    const found = voices.find(v => v.name === cachedVoice);
    if (found) return found;
  }

  let voice = voices.find(v => v.lang.startsWith(targetLang) && v.name.includes('Google'));
  if (!voice) voice = voices.find(v => v.lang.startsWith(targetLang));
  if (!voice) voice = voices.find(v => v.lang.startsWith('en'));

  return voice || voices[0] || null;
}

// Preload voices
function ensureVoices() {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    const voices = synth.getVoices();
    if (voices.length > 0) {
      resolve(voices);
    } else {
      synth.onvoiceschanged = () => {
        resolve(synth.getVoices());
      };
    }
  });
}

function speak(text) {
  return new Promise((resolve) => {
    if (!synth || !hasSpeechSynthesis) {
      // Text-only mode: just resolve immediately
      resolve();
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getBestVoice();
    if (voice) utterance.voice = voice;

    // Bug 4.1: slower rate for Urdu for better comprehension
    utterance.rate = lang === 'ur' ? 0.9 : 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = lang === 'ur' ? 'ur-PK' : 'en-US';

    utterance.onstart = () => {
      speaking = true;
      setStatus('speaking', lang === 'ur' ? 'Bol raha hoon...' : 'Speaking...');
    };

    utterance.onend = () => {
      speaking = false;
      currentUtterance = null;
      setStatus('listening', lang === 'ur' ? 'Sun raha hoon...' : 'Listening...');
      resolve();
      // Bug 2.2: reduced from 200ms to 100ms
      if (callActive) {
        setTimeout(() => startListening(), 100);
      }
    };

    utterance.onerror = (e) => {
      console.warn('Speech synthesis error:', e.error);
      speaking = false;
      currentUtterance = null;
      resolve();
      if (callActive) {
        setTimeout(() => startListening(), 100);
      }
    };

    // Cache voice preference (Bug 4.2)
    if (voice && voice.name) {
      try {
        localStorage.setItem(`sc-preferred-voice-${lang}`, voice.name);
      } catch (_) {}
    }

    currentUtterance = utterance;
    synth.speak(utterance);
  });
}

// ── Sound effects (Polish 1: Web Audio API tone) ──
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch (_) {}
}

// ── Status UI (Polish 2: better status messages) ──
function setStatus(state, text) {
  statusText.textContent = text;
  statusText.className = 'status-text ' + state;

  waveform.style.display = state === 'speaking' ? 'flex' : 'none';
  listeningDots.style.display = state === 'listening' ? 'flex' : 'none';
  thinkingDots.style.display = state === 'thinking' ? 'flex' : 'none';

  if (state === 'speaking') {
    phoneIcon.textContent = '🔊';
  } else if (state === 'listening') {
    phoneIcon.textContent = '🎤';
  } else if (state === 'thinking') {
    phoneIcon.textContent = '🤔';
  } else {
    phoneIcon.textContent = '📞';
  }
}

function updateTranscriptPreview(text, isInterim) {
  const display = text.length > 60 ? '...' + text.slice(-57) : text;
  transcriptPreview.textContent = display;
  if (isInterim) {
    transcriptPreview.classList.add('interim');
  } else {
    transcriptPreview.classList.remove('interim');
  }
}

function showError(msg) {
  callError.textContent = msg;
  callError.classList.add('visible');
}

function hideError() {
  callError.classList.remove('visible');
  callError.textContent = '';
}

function showTextFallbackOption() {
  if (useTextBtn) useTextBtn.style.display = 'inline-flex';
}

// ── Timer ──
function startTimer() {
  callStartTime = Date.now();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateTimerDisplay() {
  const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');
  callTimer.textContent = `${mins}:${secs}`;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ── Silence detection (Bug 2.3: reduced from 8s to 5s) ──
function startSilenceTimer() {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (callActive && !speaking) {
      const promptText = lang === 'ur'
        ? 'Kuch sunai nahi diya. Kya madad chahiye?'
        : "I didn't catch that. How can I help?";
      transcript.push({ role: 'ai', text: promptText });
      speak(promptText);
    }
  }, 5000); // Bug 2.3: was 8000
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

// ── Start listening ──
function startListening() {
  if (!callActive || speaking) return;
  if (!recognition) return;

  try {
    listening = true;
    setStatus('listening', lang === 'ur' ? 'Sun raha hoon...' : 'Listening...');
    recognition.start();
  } catch (e) {
    if (e.name === 'InvalidStateError') {
      listening = true;
      return;
    }
    console.warn('Recognition start error:', e);
    setTimeout(() => {
      if (callActive && !speaking) {
        try { recognition.start(); listening = true; } catch (_) {}
      }
    }, 500);
  }
}

// ── API Interaction (Bug 2.6: 10s timeout) ──
async function sendToAI(message) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // Bug 2.6

  try {
    const res = await fetch('/api/receptionist/voice-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        language: lang,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    console.error('API error:', err);
    throw err;
  }
}

async function getGreeting() {
  try {
    const res = await fetch(`/api/receptionist/voice-greeting?language=${lang}`);
    if (!res.ok) throw new Error('Failed to get greeting');
    const data = await res.json();
    return data.greeting;
  } catch {
    return lang === 'ur'
      ? 'Subhan Care mein khushamdeed. Bataaiye, kya madad chahiye?'
      : 'Thank you for calling Subhan Care Hospital. How can I help you today?';
  }
}

// ── Handle user speech ──
async function handleUserSpeech(text) {
  // Check for call end intent
  const endPhrases = ['bye', 'goodbye', 'thank you', 'thanks', 'end call', 'hang up',
    'that\'s all', 'nothing else', 'shukriya', 'shukria', 'allah hafiz', 'khuda hafiz',
    'theek hai bye', 'bas itna hai', 'phir milenge'];
  const lower = text.toLowerCase();

  if (endPhrases.some(p => lower.includes(p))) {
    await endCall(true);
    return;
  }

  // Send to AI — show thinking state (Bug 2.5)
  setStatus('thinking', lang === 'ur' ? 'AI soch raha hai...' : 'AI is thinking...');
  listening = false;

  // Play subtle notification (Polish 1)
  playNotificationSound();

  try {
    const result = await sendToAI(text);

    if (result.session_id) {
      sessionId = result.session_id;
    }

    if (result.action && result.action.type) {
      actions.push(result.action);
    }

    if (result.should_end_call) {
      await endCall(true, result.call_summary);
      return;
    }

    const replyText = result.reply || result.message || 'I understand. How else can I help?';
    transcript.push({ role: 'ai', text: replyText });

    await speak(replyText);

  } catch (err) {
    console.error('Error processing speech:', err);
    const errorMsg = lang === 'ur'
      ? 'Maazrat, kuch masla ho gaya. Dobara koshish karein.'
      : 'Sorry, something went wrong. Please try again.';
    transcript.push({ role: 'ai', text: errorMsg });
    await speak(errorMsg);
  }
}

// ── Text mode send (Bug 5: graceful degradation) ──
async function handleTextSend() {
  const text = textInput.value.trim();
  if (!text || !callActive) return;
  textInput.value = '';

  transcript.push({ role: 'user', text });
  setStatus('thinking', lang === 'ur' ? 'AI soch raha hai...' : 'AI is thinking...');

  try {
    const result = await sendToAI(text);

    if (result.session_id) sessionId = result.session_id;
    if (result.action && result.action.type) actions.push(result.action);

    if (result.should_end_call) {
      await endCall(true, result.call_summary);
      return;
    }

    const replyText = result.reply || result.message || 'I understand.';
    transcript.push({ role: 'ai', text: replyText });

    // Show response in transcript preview
    updateTranscriptPreview(replyText, false);
    await speak(replyText);
  } catch (err) {
    const errorMsg = lang === 'ur'
      ? 'Maazrat, kuch masla ho gaya.'
      : 'Sorry, something went wrong.';
    updateTranscriptPreview(errorMsg, false);
    await speak(errorMsg);
  }
}

// ── End call ──
async function endCall(fromVoice = false, summaryText = null) {
  callActive = false;
  stopTimer();
  clearSilenceTimer();
  if (synth) synth.cancel();
  speaking = false;
  listening = false;

  // Build summary
  let summary = summaryText || buildSummary();
  let actionsHtml = buildActionsHtml();

  // Show post-call UI (Polish 3: clean card format)
  callUI.style.display = 'none';
  if (textInputWrap) textInputWrap.style.display = 'none';
  if (textModeBanner) textModeBanner.style.display = 'none';
  postCallUI.style.display = 'flex';
  postCallSummaryText.textContent = summary || (lang === 'ur' ? 'Is call mein koi action nahi liya gaya.' : 'No significant actions taken during this call.');
  if (postCallActionsList) {
    postCallActionsList.innerHTML = actionsHtml;
  }

  if (summary) {
    callSummaryText.textContent = summary;
    callSummary.classList.add('visible');
  }
}

function buildSummary() {
  if (actions.length === 0) {
    return lang === 'ur'
      ? 'Koi khaas action nahi liya gaya.'
      : 'No specific actions were taken.';
  }

  const parts = [];
  for (const action of actions) {
    switch (action.type) {
      case 'appointment_created': {
        const d = action.data || {};
        parts.push(lang === 'ur'
          ? `Appointment book hui: ${d.doctor_name || 'Doctor'} ke saath ${d.date || ''} ko ${d.time || ''}`
          : `Appointment booked with ${d.doctor_name || 'Doctor'} on ${d.date || ''} at ${d.time || ''}`);
        break;
      }
      case 'patient_created':
        parts.push(lang === 'ur' ? 'Naye patient register hue' : 'New patient registered');
        break;
      case 'appointment_cancelled':
        parts.push(lang === 'ur' ? 'Appointment cancel hui' : 'Appointment cancelled');
        break;
      case 'appointment_rescheduled':
        parts.push(lang === 'ur' ? 'Appointment reschedule hui' : 'Appointment rescheduled');
        break;
      case 'patient_found':
        parts.push(lang === 'ur' ? 'Patient record mil gaya' : 'Patient record found');
        break;
      default:
        break;
    }
  }

  return parts.length > 0 ? parts.join('. ') : (lang === 'ur' ? 'Baat-cheet hui' : 'General inquiry handled');
}

// Polish 3: Post-call actions card
function buildActionsHtml() {
  if (actions.length === 0) return '';
  const items = actions.map(action => {
    switch (action.type) {
      case 'appointment_created': {
        const d = action.data || {};
        return `<div class="action-card">
          <span class="action-icon">📅</span>
          <div class="action-detail">
            <strong>${d.doctor_name || 'Doctor'}</strong>
            <span>${d.date || ''} at ${d.time || ''}</span>
          </div>
        </div>`;
      }
      case 'patient_created': {
        const d = action.data || {};
        return `<div class="action-card">
          <span class="action-icon">🆕</span>
          <div class="action-detail">
            <strong>New Patient Registered</strong>
            <span>ID: ${d.patient_id || 'N/A'}</span>
          </div>
        </div>`;
      }
      case 'appointment_cancelled':
        return `<div class="action-card">
          <span class="action-icon">❌</span>
          <div class="action-detail"><strong>Appointment Cancelled</strong></div>
        </div>`;
      case 'appointment_rescheduled':
        return `<div class="action-card">
          <span class="action-icon">🔄</span>
          <div class="action-detail"><strong>Appointment Rescheduled</strong></div>
        </div>`;
      default:
        return '';
    }
  }).filter(Boolean).join('');
  return items;
}

// ── Start Call ──
async function startCall(useTextMode = false) {
  callActive = true;
  actions = [];
  transcript = [];

  hideError();
  micPrompt.classList.remove('visible');
  callUI.style.display = 'flex';
  postCallUI.style.display = 'none';
  callSummary.classList.remove('visible');
  callSummaryText.textContent = '';
  transcriptPreview.textContent = '';
  if (useTextBtn) useTextBtn.style.display = 'none';

  // Show text input if in text mode
  if (useTextMode) {
    if (textInputWrap) textInputWrap.style.display = 'flex';
    if (textModeBanner) textModeBanner.style.display = 'block';
  }

  startTimer();
  if (!useTextMode) updateRecognitionLang();

  // Get and speak greeting
  try {
    const greeting = await getGreeting();
    transcript.push({ role: 'ai', text: greeting });
    setStatus('speaking', lang === 'ur' ? 'Bol raha hoon...' : 'Speaking...');
    await speak(greeting);
  } catch (err) {
    console.error('Failed to get greeting:', err);
    const fallback = lang === 'ur'
      ? 'Subhan Care mein khushamdeed. Bataaiye, kya madad chahiye?'
      : 'Thank you for calling Subhan Care. How can I help you?';
    transcript.push({ role: 'ai', text: fallback });
    await speak(fallback);
  }
}

// ── Event Handlers ──

// Mic allow button
micAllowBtn.addEventListener('click', async () => {
  if (!SpeechRecognition) {
    showError('Speech recognition not supported. Please use Chrome, Edge, or Safari, or switch to text mode.');
    showTextFallbackOption();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());

    if (setupRecognition()) {
      await ensureVoices();
      startCall(false);
    }
  } catch (err) {
    console.error('Mic permission error:', err);
    showTextFallbackOption();
    if (err.name === 'NotAllowedError') {
      showError('Microphone access denied. Please allow access in browser settings, or use text mode.');
    } else if (err.name === 'NotFoundError') {
      showError('No microphone found. Please connect one and try again, or use text mode.');
    } else {
      showError('Could not access microphone: ' + (err.message || 'Unknown error'));
    }
  }
});

// Use text instead button (Bug 5.3)
if (useTextBtn) {
  useTextBtn.addEventListener('click', async () => {
    micPrompt.classList.remove('visible');
    callUI.style.display = 'flex';
    postCallUI.style.display = 'none';
    useTextBtn.style.display = 'none';
    hideError();
    await ensureVoices();
    startCall(true);
  });
}

// End call button
endCallBtn.addEventListener('click', () => endCall(false));

// Recall button (Polish 4: reset and start fresh)
recallBtn.addEventListener('click', async () => {
  sessionId = null;
  stopTimer();
  await ensureVoices();
  if (recognition && !recognition._textOnly) {
    startCall(false);
  } else {
    startCall(true);
  }
});

// Language toggle
langToggle.addEventListener('click', () => {
  lang = lang === 'en' ? 'ur' : 'en';
  langToggle.textContent = lang === 'en' ? 'اردو' : 'English';
  if (!textInputWrap || textInputWrap.style.display === 'none') {
    updateRecognitionLang();
  }
});

// Text input send button
if (textSendBtn) {
  textSendBtn.addEventListener('click', handleTextSend);
}
if (textInput) {
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTextSend();
    }
  });
}

// ── Handle page unload ──
window.addEventListener('beforeunload', () => {
  callActive = false;
  stopTimer();
  clearSilenceTimer();
  if (synth) synth.cancel();
});

// ── Handle visibility change (Bug 4.3: pause instead of cancel) ──
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (speaking && synth) {
      synth.pause();
    }
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) {}
      listening = false;
    }
  } else {
    // Resume speaking if we were paused
    if (speaking && synth) {
      synth.resume();
    }
    // Resume listening if call is active
    if (callActive && !speaking) {
      startListening();
    }
  }
});

// ── Initialize: show mic prompt or text fallback ──
if (!hasSpeechRecognition) {
  micPrompt.querySelector('h2').textContent = 'Voice Not Supported';
  micPrompt.querySelector('p').textContent = 'Your browser doesn\'t support speech recognition. You can use text mode to chat with the AI receptionist.';
  micAllowBtn.textContent = '💬 Start Text Chat';
  showTextFallbackOption();

  // Override mic button to start text mode
  micAllowBtn.addEventListener('click', async (e) => {
    e.stopImmediatePropagation();
    micPrompt.classList.remove('visible');
    callUI.style.display = 'flex';
    postCallUI.style.display = 'none';
    useTextBtn.style.display = 'none';
    hideError();
    await ensureVoices();
    startCall(true);
  }, { once: true });
}
