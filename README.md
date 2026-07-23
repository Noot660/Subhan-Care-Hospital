# Subhan Care AI Receptionist

An AI-powered voice and chat receptionist for hospitals and clinics that handles patient registration, appointment booking, FAQs, and front-desk triage — 24/7, in multiple languages. Plugs into the Subhan Care Hospital Management System (HMS).

## Tech Stack
- **Runtime:** Bun (TypeScript)
- **Database:** SQLite (via `bun:sqlite`)
- **Frontend:** Vanilla JS ES modules (no build step)
- **Auth:** bcrypt password hashing (via `Bun.password`), session tokens with 24-hour expiry
- **AI:** Local keyword/pattern-based intent classifier with optional OpenAI fallback

## Quick Start

```bash
# Install dependencies
bun install

# Seed the database with sample data
bun run src/db/seed.ts

# Start the server
bun run src/index.ts
# Or in dev mode with hot reload:
bun run dev
```

The server starts on **port 3000**.

## Project Structure

```
src/
├── index.ts              # HTTP server entry point (port 3000)
├── db/
│   ├── index.ts          # Database connection + schema init (14 tables)
│   └── seed.ts           # Seed script (sample data)
├── middleware/
│   ├── auth.ts           # Auth helpers + RBAC matrix + session management
│   ├── http.ts           # JSON response helpers, body parser, CORS
│   └── audit.ts          # Audit log writer
├── routes/
│   ├── auth.ts           # POST /api/auth/login, /logout, GET /api/auth/me
│   ├── patients.ts       # CRUD patients + deactivate (no delete)
│   ├── doctors.ts        # CRUD doctors + schedule + available slots
│   ├── appointments.ts   # Book, list, status update, reschedule
│   └── receptionist.ts   # AI chat, FAQ listing, TTS endpoints (public)
├── ai/
│   ├── intents.ts        # Intent handler — multi-turn conversation flows
│   ├── conversation.ts   # In-memory conversation state manager (10-min TTL)
│   ├── faq.ts            # FAQ knowledge base (English + Roman Urdu)
│   ├── i18n.ts           # Multi-language support (en + ur)
│   ├── llm.ts            # Local intent classifier + optional OpenAI fallback
│   └── tts.ts            # TTS payload preparation for Web Speech API
└── types/
    └── index.ts          # TypeScript interfaces for all entities

public/
├── chat.html             # AI Receptionist chat widget (public-facing)
├── login.html            # Staff login page
├── dashboard.html        # Role-based dashboard (all 6 roles)
├── css/
│   ├── style.css         # Design system (buttons, forms, cards, tables, modals)
│   ├── chat.css          # Chat widget layout
│   ├── login.css         # Login page styles
│   └── dashboard.css     # Dashboard layout styles
└── js/
    ├── chat.js           # Chat widget logic (multi-turn, voice input/output)
    ├── login.js          # Login form handler
    ├── dashboard.js      # Role-based dashboard views (admin, receptionist, doctor, pharmacist, billing, management)
    ├── api.js            # API fetch wrapper with auth token
    ├── auth.js           # Auth state management (sessionStorage)
    ├── components.js     # Reusable UI components (modal, table, form, toast, confirm)
    └── router.js         # Hash-based client router

test/
└── e2e.sh               # End-to-end test suite (curl-based)
```

## API Endpoints

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |

### Auth (public login)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | No | Login with username+password → token + user + expires_at |
| POST | /api/auth/logout | Yes | Invalidate session |
| GET | /api/auth/me | Yes | Get current user info + role |

### Patients
| Method | Path | RBAC | Description |
|--------|------|------|-------------|
| POST | /api/patients | receptionist+, admin | Register new patient (auto SC-PT-XXXXXX) |
| GET | /api/patients | all roles | List/search patients (?name=&cnic=&phone=&patient_id=) |
| GET | /api/patients/:id | all roles | Single patient + visit history |
| PUT | /api/patients/:id | receptionist+, admin | Update demographics |
| POST | /api/patients/:id/deactivate | receptionist+, admin | Mark inactive (no patient deletion) |

### Doctors
| Method | Path | RBAC | Description |
|--------|------|------|-------------|
| POST | /api/doctors | admin only | Create doctor + schedule |
| GET | /api/doctors | all (except pharmacist) | List doctors with schedules |
| GET | /api/doctors/:id | all (except pharmacist) | Doctor detail + schedule |
| GET | /api/doctors/:id/slots?date=YYYY-MM-DD | all (except pharmacist) | Available 30-min slots for date |

### Appointments
| Method | Path | RBAC | Description |
|--------|------|------|-------------|
| POST | /api/appointments | receptionist+, admin | Book appointment (validates schedule, prevents double-booking) |
| GET | /api/appointments | receptionist+, admin, doctor | List/filter appointments (?patient_id=&doctor_id=&date=&status=) |
| PATCH | /api/appointments/:id/status | receptionist+, admin | Update status (scheduled→checked-in→completed/cancelled/no-show) |
| PATCH | /api/appointments/:id/reschedule | receptionist+, admin | Reschedule (new date + time, prevents conflicts) |

### AI Receptionist (public — no auth)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/receptionist/chat | Main chat endpoint. Body: `{ "message": "...", "session_id?": "...", "language?": "en|ur" }` |
| GET | /api/receptionist/faqs?lang=en|ur | List FAQ topics |
| GET | /api/receptionist/tts?text=...&lang=en|ur | Prepare text for Web Speech API TTS |

### Chat Intents
The AI receptionist handles these conversation flows:
- **register_patient** — Multi-step registration (name, CNIC, DOB, gender, phone, address, emergency contact, confirm)
- **book_appointment** — Multi-step booking (patient lookup, doctor selection, date, time slot, confirm)
- **check_appointment** — Look up patient → show appointments
- **faq** — Hospital timings, doctor list, fees, location, services, emergency info, appointment process
- **triage** — Symptom severity + duration → emergency alert or doctor recommendation
- **cancel_reschedule** — Look up patient → select appointment → cancel or reschedule with new date/time

## Seed Credentials

| Role | Username | Password | Notes |
|------|----------|----------|-------|
| Admin | admin | admin123 | Full system access |
| Receptionist | receptionist | staff123 | Patient registration, appointment booking |
| Pharmacist | pharmacist | staff123 | Medicine inventory access |
| Billing | billing | staff123 | Patient data read access |
| Doctor (Cardiologist) | dr.ahmed | doctor123 | Dr. Ahmed — view appointments, record consultations |
| Doctor (Pediatrician) | dr.fatima | doctor123 | Dr. Fatima — view appointments, record consultations |

### Seed Data
- **6 Patients** (Muhammad Ali, Ayesha Khan, Hamza Tariq, Fatima Bibi, Zain Malik)
- **2 Doctors** with weekly schedules (Dr. Ahmed: Mon-Sat, Dr. Fatima: Sun-Thu)
- **10 Medicines** with batch tracking and reorder thresholds
- **3 Sample Appointments** for tomorrow

## Using the AI Chat Widget

1. Open `http://localhost:3000/` in your browser
2. The chat widget shows a welcome message with quick action chips
3. You can:
   - Click a quick action chip (Book Appointment, New Patient, FAQs, etc.)
   - Type a message like "I want to book an appointment" or "I have a fever"
   - Click 🎤 for voice input (uses browser SpeechRecognition API)
   - Toggle 🔊 for voice output (uses browser SpeechSynthesis API)
   - Toggle اردو/English for language switching
4. The AI guides you through multi-step flows (registration, booking, triage)
5. Conversations persist for 10 minutes of inactivity

## Architecture Overview

```
                 ┌─────────────────────┐
                 │   Public Users      │
                 │  (Patients/Visitors)│
                 └────────┬────────────┘
                          │ HTTP
                          ▼
┌──────────────────────────────────────────────┐
│              Bun HTTP Server (:3000)          │
│                                                │
│  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Static Files  │  │   /api/* Routes      │   │
│  │ (public/)    │  │                      │   │
│  │              │  │  Auth → RBAC check    │   │
│  │ chat.html    │  │  Patients CRUD       │   │
│  │ login.html   │  │  Doctors + Slots     │   │
│  │ dashboard    │  │  Appointments        │   │
│  │ JS/CSS       │  │  Receptionist (AI)   │   │
│  └──────────────┘  └──────────┬───────────┘   │
│                                │               │
│                    ┌───────────▼───────────┐   │
│                    │   AI Engine           │   │
│                    │  • Intent Classifier  │   │
│                    │  • Conversation State │   │
│                    │  • FAQ Knowledge Base │   │
│                    │  • i18n (en/ur)       │   │
│                    │  • TTS Prep           │   │
│                    └───────────┬───────────┘   │
│                                │               │
│                    ┌───────────▼───────────┐   │
│                    │   SQLite Database     │   │
│                    │  (14 tables, WAL mode)│   │
│                    └───────────────────────┘   │
└──────────────────────────────────────────────┘
```

## RBAC Matrix

| Module | Admin | Doctor | Receptionist | Pharmacist | Billing | Management |
|--------|-------|--------|-------------|------------|---------|------------|
| Patients | F | R | F | R | R | R |
| Doctors | F | R | R | - | - | R |
| Appointments | F | R | F | - | - | R |
| Consultations | R | F | - | R | - | - |
| Pharmacy | F | - | - | F | - | R |
| Billing | F | - | - | - | F | R |
| Reports | F | - | - | - | R | R |
| Users | F | - | - | - | - | - |
| Audit | R | - | - | - | - | - |

F = Full (CRUD), R = Read, L = List only, - = No access

## Security

- Passwords hashed with bcrypt (cost 10)
- Session tokens: 32-byte random hex, 24-hour expiry
- Input validation on all endpoints
- Duplicate CNIC prevention (409 Conflict)
- Double-booking prevention (409 Conflict)
- No patient deletion — deactivation only
- Audit logging on all mutations
- RBAC enforced at middleware level
- CORS enabled for all origins
- Consistent error format: `{ "error": "message" }`

## Running Tests

```bash
# Ensure server is running first
bash test/e2e.sh
```

Tests cover:
- UC-1: Patient registration via AI chat (multi-turn)
- UC-2: Appointment booking via AI chat (multi-turn)
- UC-3: Doctor/receptionist login, appointments, status updates
- UC-4: Pharmacist RBAC verification
- UC-5: Billing RBAC verification
- UC-6: Low stock alert / inventory check
- Error handling (duplicate CNIC, double booking, auth, RBAC)
- Multi-language (Urdu)
- CORS headers
- Session management
- Data integrity (no patient deletion)

## Publishing

```bash
bun run publish
# or:
bash publish.sh
```

This rebuilds and restarts the production server on port 3000.
