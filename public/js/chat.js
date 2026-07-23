// Chat Widget — AI Receptionist Interface
import { api } from './api.js';
import { showToast } from './components.js';

// State
let sessionId = null;
let speakerOn = localStorage.getItem('speakerOn') !== 'false'; // default true
let lang = localStorage.getItem('lang') || 'en';
let isProcessing = false;

// DOM refs
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
const micButton = document.getElementById('micButton');
const typingIndicator = document.getElementById('typingIndicator');
const sessionWarning = document.getElementById('sessionWarning');
const langToggle = document.getElementById('langToggle');
const langLabel = document.getElementById('langLabel');
const speakerToggle = document.getElementById('speakerToggle');
const speakerIcon = document.getElementById('speakerIcon');
const quickActions = document.getElementById('quickActions');

// ── Initialization ──
function init() {
  updateLangUI();
  updateSpeakerUI();
  bindEvents();
}

function updateLangUI() {
  langLabel.textContent = lang === 'ur' ? 'English' : 'اردو';
  chatInput.placeholder = lang === 'ur'
    ? 'Apna message type karein...'
    : 'Type your message...';
  document.documentElement.lang = lang;
}

function updateSpeakerUI() {
  speakerIcon.textContent = speakerOn ? '🔊' : '🔇';
}

function bindEvents() {
  sendButton.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  micButton.addEventListener('click', toggleMic);
  langToggle.addEventListener('click', toggleLang);
  speakerToggle.addEventListener('click', toggleSpeaker);

  // Quick action chips
  quickActions.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const msg = chip.dataset.msg;
      if (msg) {
        chatInput.value = msg;
        sendMessage();
      }
    });
  });
}

// ── Language ──
function toggleLang() {
  lang = lang === 'en' ? 'ur' : 'en';
  localStorage.setItem('lang', lang);
  updateLangUI();
  // Reset chat for new language
  sessionId = null;
  chatMessages.innerHTML = '';
  addBotMessage(lang === 'ur'
    ? '👋 Subhan Care Hospital mein khushamadeed! Main aapka AI receptionist hoon. Aaj main aapki kya madad kar sakta hoon?'
    : "👋 Welcome to <strong>Subhan Care Hospital</strong>! I'm your AI receptionist. How can I help you today?"
  );
}

// ── Speaker ──
function toggleSpeaker() {
  speakerOn = !speakerOn;
  localStorage.setItem('speakerOn', speakerOn);
  updateSpeakerUI();
  if (!speakerOn) {
    window.speechSynthesis?.cancel();
  }
}

// ── Messages ──
function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-bubble user';
  div.innerHTML = `
    <div class="bubble-avatar">👤</div>
    <div class="bubble-content"><p>${escapeHtml(text)}</p></div>
  `;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function addBotMessage(text, isMarkdown = true) {
  const div = document.createElement('div');
  div.className = 'chat-bubble bot';
  const content = isMarkdown ? formatMarkdown(text) : `<p>${escapeHtml(text)}</p>`;
  div.innerHTML = `
    <div class="bubble-avatar">🤖</div>
    <div class="bubble-content">${content}</div>
  `;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function formatMarkdown(text) {
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Newlines to paragraphs or breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// ── Typing Indicator ──
function showTyping() {
  typingIndicator.classList.remove('hidden');
  scrollToBottom();
}

function hideTyping() {
  typingIndicator.classList.add('hidden');
}

// ── Session Warning ──
function showSessionWarning() {
  sessionWarning.classList.remove('hidden');
  setTimeout(() => sessionWarning.classList.add('hidden'), 4000);
}

// ── Send Message ──
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  chatInput.value = '';
  sendButton.disabled = true;
  chatInput.disabled = true;

  addUserMessage(message);
  showTyping();

  try {
    const response = await api.chat(message, sessionId, lang);

    // Update session
    if (response.session_id && response.session_id !== sessionId) {
      if (sessionId) showSessionWarning();
      sessionId = response.session_id;
    }

    hideTyping();

    if (response.reply) {
      addBotMessage(response.reply);
      // Text-to-speech
      if (speakerOn) {
        speakResponse(response.reply, response.language || lang);
      }
    }

    // Handle action data
    if (response.action) {
      handleAction(response.action);
    }

  } catch (err) {
    hideTyping();
    addBotMessage(
      lang === 'ur'
        ? '⚠️ Maazrat, koi masla ho gaya. Baraye meherbani dobara koshish karein.'
        : '⚠️ Sorry, something went wrong. Please try again.',
      false
    );
    console.error('Chat error:', err);
  } finally {
    isProcessing = false;
    sendButton.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
}

function handleAction(action) {
  // Future: could show inline cards for appointments, etc.
  console.log('Action:', action);
}

// ── Voice Output (Speech Synthesis) ──
function speakResponse(text, speechLang) {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Strip markdown for speech
  const cleanText = text
    .replace(/\*\*/g, '')
    .replace(/[*_`~#]/g, '')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/\n+/g, '. ')
    .trim();

  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = speechLang === 'ur' ? 'ur-PK' : 'en-US';
  utterance.rate = 0.95;
  utterance.pitch = 1.0;

  // Try to find a good voice
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const preferred = voices.find(v => v.lang.startsWith(speechLang === 'ur' ? 'ur' : 'en')) || voices[0];
    utterance.voice = preferred;
  }

  window.speechSynthesis.speak(utterance);
}

// ── Voice Input (Speech Recognition) ──
let recognition = null;
let isListening = false;

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micButton.classList.add('unsupported');
    micButton.title = 'Voice input not supported in this browser';
    return null;
  }

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = lang === 'ur' ? 'ur-PK' : 'en-US';

  rec.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;

    // Auto-send on final result
    if (event.results[event.results.length - 1].isFinal) {
      setTimeout(() => {
        if (chatInput.value.trim()) sendMessage();
      }, 300);
    }
  };

  rec.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    stopListening();
    if (event.error === 'not-allowed') {
      showToast('Microphone access denied', 'error');
    }
  };

  rec.onend = () => {
    stopListening();
  };

  return rec;
}

function toggleMic() {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
}

function startListening() {
  if (!recognition) {
    recognition = initSpeechRecognition();
  }
  if (!recognition) return;

  try {
    recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    recognition.start();
    isListening = true;
    micButton.classList.add('listening');
    micButton.textContent = '⏹';
    chatInput.placeholder = lang === 'ur' ? 'Sun raha hoon...' : 'Listening...';
  } catch (err) {
    console.warn('Speech start error:', err);
  }
}

function stopListening() {
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  isListening = false;
  micButton.classList.remove('listening');
  micButton.textContent = '🎤';
  updateLangUI(); // Restore placeholder
}

// Preload voices
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// Start
init();
