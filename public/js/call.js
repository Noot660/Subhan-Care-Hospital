// Voice call handler for Subhan Care AI Receptionist
// Uses browser SpeechRecognition + SpeechSynthesis APIs

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
const statusText = document.getElementById('statusText');
const waveform = document.getElementById('waveform');
const listeningDots = document.getElementById('listeningDots');
const callTimer = document.getElementById('callTimer');
const callSummary = document.getElementById('callSummary');
const callSummaryText = document.getElementById('callSummaryText');
const postCallSummaryText = document.getElementById('postCallSummaryText');
const transcriptPreview = document.getElementById('transcriptPreview');
const callError = document.getElementById('callError');
const endCallBtn = document.getElementById('endCallBtn');
const langToggle = document.getElementById('langToggle');
const recallBtn = document.getElementById('recallBtn');
const phoneIcon = document.getElementById('phoneIcon');

// ── Speech Recognition Setup ──
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function setupRecognition() {
  if (!SpeechRecognition) {
    showError('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false; // single utterance
  recognition.interimResults = false;
  recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    clearSilenceTimer();
    const text = event.results[0][0].transcript.trim();
    if (!text) {
      // Empty result — restart listening
      if (callActive) startListening();
      return;
    }

    transcript.push({ role: 'user', text });
    updateTranscriptPreview(text);
    handleUserSpeech(text);
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    clearSilenceTimer();

    if (event.error === 'not-allowed' || event.error === 'permission-denied') {
      showError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    if (event.error === 'aborted' || event.error === 'no-speech') {
      // No speech detected — restart silence timer
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
let synth = window.speechSynthesis;
let currentUtterance = null;

function getBestVoice() {
  const voices = synth.getVoices();
  const targetLang = lang === 'ur' ? 'ur' : 'en-US';

  // Try to find a matching voice
  let voice = voices.find(v => v.lang.startsWith(targetLang) && v.name.includes('Google'));
  if (!voice) voice = voices.find(v => v.lang.startsWith(targetLang));
  if (!voice) voice = voices.find(v => v.lang.startsWith('en'));

  return voice || voices[0];
}

// Preload voices — needed on some browsers
function ensureVoices() {
  return new Promise((resolve) => {
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
    // Cancel any current speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = getBestVoice();
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = lang === 'ur' ? 'ur-PK' : 'en-US';

    utterance.onstart = () => {
      speaking = true;
      setStatus('speaking', 'Speaking...');
    };

    utterance.onend = () => {
      speaking = false;
      currentUtterance = null;
      setStatus('listening', '');
      resolve();
      // Auto-listen after speaking
      if (callActive) {
        setTimeout(() => startListening(), 200);
      }
    };

    utterance.onerror = (e) => {
      console.warn('Speech synthesis error:', e.error);
      speaking = false;
      currentUtterance = null;
      resolve();
      if (callActive) {
        setTimeout(() => startListening(), 200);
      }
    };

    currentUtterance = utterance;
    synth.speak(utterance);
  });
}

// ── Status UI ──
function setStatus(state, text) {
  statusText.textContent = text;
  statusText.className = 'status-text ' + state;

  waveform.style.display = state === 'speaking' ? 'flex' : 'none';
  listeningDots.style.display = state === 'listening' ? 'flex' : 'none';

  // Update phone icon
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

function updateTranscriptPreview(text) {
  transcriptPreview.textContent = text.length > 60 ? text.slice(-60) : text;
}

function showError(msg) {
  callError.textContent = msg;
  callError.classList.add('visible');
}

function hideError() {
  callError.classList.remove('visible');
  callError.textContent = '';
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

// ── Silence detection ──
function startSilenceTimer() {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (callActive && !speaking) {
      // Prompt user
      const promptText = lang === 'ur'
        ? 'Mujhe kuch sunai nahi diya. Main kya madad kar sakta hoon?'
        : "I didn't catch that. How can I help?";
      transcript.push({ role: 'ai', text: promptText });
      speak(promptText);
    }
  }, 8000);
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

  try {
    listening = true;
    setStatus('listening', 'Listening...');
    recognition.start();
  } catch (e) {
    // Already started — ignore
    if (e.name === 'InvalidStateError') {
      listening = true;
      return;
    }
    console.warn('Recognition start error:', e);
    // Retry
    setTimeout(() => {
      if (callActive && !speaking) {
        try { recognition.start(); listening = true; } catch (_) {}
      }
    }, 500);
  }
}

// ── API Interaction ──
async function sendToAI(message) {
  try {
    const res = await fetch('/api/receptionist/voice-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        language: lang,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
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
      ? 'Subhan Care Hospital mein khushamdeed. Main aapki kya madad kar sakta hoon?'
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

  // Send to AI
  setStatus('thinking', 'Thinking...');
  listening = false;

  try {
    const result = await sendToAI(text);

    // Update session
    if (result.session_id) {
      sessionId = result.session_id;
    }

    // Track actions
    if (result.action && result.action.type) {
      actions.push(result.action);
    }

    // Check if AI says call should end
    if (result.should_end_call) {
      await endCall(true, result.call_summary);
      return;
    }

    // Speak the response
    const replyText = result.reply || result.message || 'I understand. How else can I help?';
    transcript.push({ role: 'ai', text: replyText });

    // Speak and then auto-listen
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

// ── End call ──
async function endCall(fromVoice = false, summaryText = null) {
  callActive = false;
  stopTimer();
  clearSilenceTimer();
  synth.cancel();
  speaking = false;
  listening = false;

  // Build summary
  let summary = summaryText || buildSummary();

  // Show post-call UI
  callUI.style.display = 'none';
  postCallUI.style.display = 'flex';
  postCallSummaryText.textContent = summary || 'No significant actions taken during this call.';

  // Also update inline summary
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

// ── Start Call ──
async function startCall() {
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

  startTimer();
  updateRecognitionLang();

  // Get and speak greeting
  try {
    const greeting = await getGreeting();
    transcript.push({ role: 'ai', text: greeting });
    setStatus('speaking', 'Speaking...');
    await speak(greeting);
  } catch (err) {
    console.error('Failed to get greeting:', err);
    const fallback = lang === 'ur'
      ? 'Subhan Care mein khushamdeed. Main aapki kya madad kar sakta hoon?'
      : 'Thank you for calling Subhan Care. How can I help you?';
    transcript.push({ role: 'ai', text: fallback });
    await speak(fallback);
  }
}

// ── Event Handlers ──
micAllowBtn.addEventListener('click', async () => {
  if (!SpeechRecognition) {
    showError('Speech recognition not supported. Please use Chrome, Edge, or Safari.');
    return;
  }

  try {
    // Request mic permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop the stream immediately — just needed permission
    stream.getTracks().forEach(t => t.stop());

    // Setup recognition after permission
    if (setupRecognition()) {
      await ensureVoices();
      startCall();
    }
  } catch (err) {
    console.error('Mic permission error:', err);
    if (err.name === 'NotAllowedError') {
      showError('Microphone access denied. Please allow microphone access in your browser settings and reload.');
    } else if (err.name === 'NotFoundError') {
      showError('No microphone found. Please connect a microphone and try again.');
    } else {
      showError('Could not access microphone: ' + (err.message || 'Unknown error'));
    }
  }
});

endCallBtn.addEventListener('click', () => endCall(false));

recallBtn.addEventListener('click', async () => {
  sessionId = null;
  stopTimer();
  await ensureVoices();
  startCall();
});

langToggle.addEventListener('click', () => {
  lang = lang === 'en' ? 'ur' : 'en';
  langToggle.textContent = lang === 'en' ? 'اردو' : 'English';
  updateRecognitionLang();
  // Don't restart — user can continue in new language
});

// ── Handle page unload ──
window.addEventListener('beforeunload', () => {
  callActive = false;
  stopTimer();
  clearSilenceTimer();
  synth.cancel();
});

// ── Handle visibility change (mobile) ──
document.addEventListener('visibilitychange', () => {
  if (document.hidden && speaking) {
    // Pause speech when tab hidden
    synth.cancel();
    speaking = false;
  }
});
