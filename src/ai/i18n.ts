// Multi-language support: English (en) and Roman Urdu (ur)
// All user-facing messages, prompts, and FAQ responses

export type Language = 'en' | 'ur';

export function detectLanguage(text: string): Language {
  // Genuine Roman Urdu words — NO English words that overlap
  // "kya" is kept because standalone "kya" is very rare in English
  const urduMarkers = [
    'mein', 'hain', 'mujhe', 'meri', 'mera', 'aap', 'aapka', 'aapki',
    'leni', 'lena', 'dena', 'chahiye', 'sakta', 'sakti', 'nahi', 'nahin',
    'bilkul', 'zaroor', 'shukriya', 'bukhar', 'dard', 'khaansi',
    'dawai', 'dawaiyan', 'ilaj', 'mareez', 'kahan', 'kab', 'kitna',
    'kitne', 'kaise', 'kyun', 'hona', 'jana', 'aur', 'lekin', 'magar',
    'theek', 'haan', 'ji', 'acha', 'achha', 'wala', 'wali', 'walay',
    'hogaya', 'hogai', 'karein', 'karo', 'karain', 'bolein', 'sunain',
    'dekhein', 'karna', 'karni',
  ];
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  let urduScore = 0;
  for (const word of words) {
    if (urduMarkers.includes(word)) urduScore++;
  }
  // If >20% of words match Urdu markers, classify as Urdu
  return urduScore > 0 && urduScore / Math.max(words.length, 1) > 0.15 ? 'ur' : 'en';
}

// All translatable strings
const strings: Record<string, Record<Language, string>> = {
  // ── Greetings & General ──
  welcome: {
    en: "👋 Welcome to Subhan Care Hospital! I'm your AI receptionist. How can I help you today?\n\nYou can:\n• Register as a new patient\n• Book an appointment\n• Check your appointment status\n• Ask about our services, timings, or fees\n• Describe symptoms for guidance",
    ur: "👋 Subhan Care mein khushamadeed! Main aapka AI receptionist hoon. Bataaiye, kya madad chahiye?\n\nAap kar sakte hain:\n• Naye patient register karein\n• Appointment book karein\n• Appointment status check karein\n• Services, timings ya fees poochhein\n• Symptoms bataayein",
  },
  fallback: {
    en: "I'm not sure I understand. Could you please rephrase? I can help you with:\n• Registering as a new patient\n• Booking an appointment\n• Checking appointment status\n• Hospital information (timings, fees, location)\n• Symptom guidance",
    ur: "Mujhe samajh nahi aaya. Dobara bataayein. Main madad kar sakta hoon:\n• Naye patient register karna\n• Appointment book karna\n• Appointment status check karna\n• Hospital ki maloomat (timings, fees)\n• Symptoms ke baare mein",
  },
  goodbye: {
    en: "Thank you for contacting Subhan Care Hospital. Feel free to reach out anytime. Take care! 👋",
    ur: "Subhan Care se raabta karne ka shukriya. Apna khayal rakhiye! 👋",
  },

  // ── Registration ──
  reg_ask_full_name: {
    en: "Let's get you registered! First, what is your full name?",
    ur: "Chaliye register karte hain! Aapka poora naam?",
  },
  reg_ask_cnic: {
    en: "What is your CNIC number? (Format: XXXXX-XXXXXXX-X)",
    ur: "CNIC number? Format: XXXXX-XXXXXXX-X",
  },
  reg_ask_dob: {
    en: "What is your date of birth? (Format: YYYY-MM-DD, e.g., 1990-05-15)",
    ur: "Date of birth? Format: YYYY-MM-DD",
  },
  reg_ask_gender: {
    en: "What is your gender? (Male / Female / Other)",
    ur: "Gender? Male, Female, ya Other?",
  },
  reg_ask_phone: {
    en: "What is your phone number? (e.g., 0300-1234567)",
    ur: "Phone number? Misaal: 0300-1234567",
  },
  reg_ask_address: {
    en: "What is your address?",
    ur: "Aapka address?",
  },
  reg_ask_emergency_contact: {
    en: "Finally, what is an emergency contact number? (A family member or close contact)",
    ur: "Emergency contact number? Kisi qareebi ka number.",
  },
  reg_confirm: {
    en: "Here's what I have. Please confirm if this is correct:\n\n📋 **Name:** {full_name}\n🪪 **CNIC:** {cnic}\n🎂 **Date of Birth:** {dob}\n⚥ **Gender:** {gender}\n📞 **Phone:** {phone}\n📍 **Address:** {address}\n🚨 **Emergency Contact:** {emergency_contact}\n\nIs this correct? (yes/no)",
    ur: "Yeh maloomat collect ki hai. Confirm karein:\n\n📋 **Naam:** {full_name}\n🪪 **CNIC:** {cnic}\n🎂 **DOB:** {dob}\n⚥ **Gender:** {gender}\n📞 **Phone:** {phone}\n📍 **Address:** {address}\n🚨 **Emergency:** {emergency_contact}\n\nSab theek hai? (haan/yes)",
  },
  reg_success: {
    en: "✅ You have been successfully registered! Your Patient ID is: **{patient_id}**. You can now book an appointment. Would you like to book one now?",
    ur: "✅ Registration ho gayi! Patient ID: **{patient_id}**. Appointment book karni hai?",
  },
  reg_cnic_exists: {
    en: "⚠️ A patient with CNIC {cnic} already exists. Let me look up your record instead. Would you like to book an appointment or check your existing appointments?",
    ur: "⚠️ CNIC {cnic} pehle se registered hai. Appointment book karni hai ya check karni hai?",
  },
  reg_invalid_cnic: {
    en: "❌ That doesn't look like a valid CNIC format. CNIC should be in the format: XXXXX-XXXXXXX-X (13 digits with dashes). Please try again.",
    ur: "❌ CNIC format sahi nahi hai. Format: XXXXX-XXXXXXX-X. Dobara try karein.",
  },
  reg_invalid_dob: {
    en: "❌ Invalid date format. Please use YYYY-MM-DD (e.g., 1990-05-15).",
    ur: "❌ Date format galat hai. YYYY-MM-DD use karein.",
  },
  reg_invalid_gender: {
    en: "❌ Please enter Male, Female, or Other.",
    ur: "❌ Male, Female, ya Other likhein.",
  },
  reg_invalid_phone: {
    en: "❌ Invalid phone number. Please enter a valid Pakistani phone number (e.g., 0300-1234567).",
    ur: "❌ Phone number galat hai. Sahi Pakistani number likhein.",
  },

  // ── Booking ──
  book_ask_doctor: {
    en: "Which doctor or specialty are you looking for? Here are our available doctors:\n\n{doctor_list}\n\nYou can say the doctor's name or specialty (e.g., 'Dr. Ahmed' or 'Cardiologist').",
    ur: "Kaunsa doctor ya specialty chahiye? Doctors:\n\n{doctor_list}\n\nNaam ya specialty bataayein.",
  },
  book_ask_date: {
    en: "For which date would you like the appointment? (YYYY-MM-DD format, e.g., 2026-07-25)\n\n{doctor_name} is available {schedule_info}.",
    ur: "Kaunsi date? YYYY-MM-DD format mein.\n\n{doctor_name} {schedule_info} available hain.",
  },
  book_ask_time: {
    en: "Here are the available time slots for {doctor_name} on {date}:\n\n{slots}\n\nWhich time do you prefer? (e.g., '09:00')",
    ur: "{doctor_name} ke slots {date} ko:\n\n{slots}\n\nKaunsa time? Misaal: '9 bajay'",
  },
  book_confirm: {
    en: "Let me confirm your appointment:\n\n👨‍⚕️ **Doctor:** {doctor_name} ({specialization})\n📅 **Date:** {date}\n🕐 **Time:** {time}\n💰 **Fee:** Rs. {fee}\n\nShall I book this? (yes/no)",
    ur: "Appointment confirm karta hoon:\n\n👨‍⚕️ **Doctor:** {doctor_name}\n📅 **Date:** {date}\n🕐 **Time:** {time}\n💰 **Fee:** {fee} rupay\n\nBook karni hai? (haan/yes)",
  },
  book_success: {
    en: "✅ Appointment booked successfully!\n\n📋 Appointment ID: {appointment_id}\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nPlease arrive 15 minutes early. Would you like anything else?",
    ur: "✅ Appointment book ho gayi!\n\n📋 ID: {appointment_id}\n👨‍⚕️ {doctor_name}\n📅 {date} ko {time}\n\n15 minute pehle aaiye. Aur kuch chahiye?",
  },
  book_no_slots: {
    en: "Sorry, {doctor_name} has no available slots on {date}. Would you like to try a different date or another doctor?",
    ur: "{doctor_name} ke {date} ko koi slot nahi. Koi aur date ya doctor?",
  },
  book_doctor_unconfigured: {
    en: "Dr. {doctor_name} does not have a configured schedule. Please select another doctor.",
    ur: "Dr. {doctor_name} ka schedule abhi configured nahi hai. Baraye meherbani koi aur doctor muntakhib karein.",
  },
  book_no_schedule_on_day: {
    en: "Dr. {doctor_name} is not scheduled to work on {date}. Please choose another date or doctor.",
    ur: "Dr. {doctor_name} {date} ko available nahi hain. Baraye meherbani koi aur date ya doctor muntakhib karein.",
  },
  book_fully_booked: {
    en: "Dr. {doctor_name} is fully booked on {date}. Please choose another date or doctor.",
    ur: "Dr. {doctor_name} {date} ko mukammal booked hain. Baraye meherbani koi aur date ya doctor muntakhib karein.",
  },
  book_no_doctor: {
    en: "I couldn't find a doctor matching '{query}'. Our available doctors are:\n\n{doctor_list}\n\nPlease try again.",
    ur: "'{query}' se match koi doctor nahi mila. Doctors:\n\n{doctor_list}\n\nDobara try karein.",
  },
  book_invalid_date: {
    en: "❌ Invalid date. Please use YYYY-MM-DD format. The date should be today or in the future.",
    ur: "❌ Date galat hai. YYYY-MM-DD format use karein. Aaj ya baad ki date.",
  },
  book_slot_taken: {
    en: "⚠️ That time slot is no longer available (someone may have booked it). Please choose another time:\n\n{slots}",
    ur: "⚠️ Woh slot ab available nahi. Koi aur time:\n\n{slots}",
  },
  book_ask_is_patient: {
    en: "Are you already registered with Subhan Care Hospital? (yes/no)\nIf yes, I can look up your record. If not, I'll help you register first!",
    ur: "Pehle se registered hain? (haan/yes)\nHaan to record dhoondhta hoon. Nahi to register karte hain.",
  },
  book_ask_identifier: {
    en: "How can I find your record? Please provide your CNIC, phone number, or full name.",
    ur: "Record dhoondhne ke liye CNIC, phone number, ya poora naam bataayein.",
  },

  // ── Check Appointment ──
  check_ask_identifier: {
    en: "I'd be happy to check your appointments. How can I find your record? Please provide your CNIC, phone number, or full name.",
    ur: "Appointments check karta hoon. CNIC, phone, ya naam bataayein.",
  },
  check_no_patient: {
    en: "I couldn't find a patient matching '{query}'. Please double-check the information and try again.",
    ur: "'{query}' se koi patient nahi mila. Dobara check karein.",
  },
  check_results: {
    en: "Here are the appointments for **{patient_name}**:\n\n{appointments}\n\nWould you like help with anything else?",
    ur: "**{patient_name}** ki appointments:\n\n{appointments}\n\nAur kuch chahiye?",
  },
  check_no_appointments: {
    en: "**{patient_name}** doesn't have any upcoming appointments. Would you like to book one?",
    ur: "**{patient_name}** ki koi appointment nahi. Book karni hai?",
  },

  // ── FAQ ──
  faq_not_found: {
    en: "I don't have information on that specific topic. Here are topics I can help with:\n\n{topics}\n\nYou can also ask about any of these!",
    ur: "Is topic ki maloomat nahi hai. Yeh topics hain:\n\n{topics}\n\nIn mein se poochh sakte hain!",
  },

  // ── Triage ──
  triage_ask_severity: {
    en: "I understand you're experiencing **{symptom}**. On a scale of 1-10, how severe is it? (1 = mild, 10 = extremely severe)",
    ur: "Aapko **{symptom}** ho raha hai. 1 se 10 tak kitna shadeed? (1 = halka, 10 = bohot zyada)",
  },
  triage_ask_duration: {
    en: "How long have you been experiencing this? (e.g., '2 hours', '3 days', '1 week')",
    ur: "Kitne arse se hai? Misaal: '2 ghante', '3 din', '1 hafta'",
  },
  triage_severity_invalid: {
    en: "❌ Please give me a number from 1 to 10 for how severe this is (1 = mild, 10 = extremely severe).",
    ur: "❌ Baraye meherbani 1 se 10 tak ka number batayein (1 = halka, 10 = bohot zyada).",
  },
  triage_emergency: {
    en: "🚨 **URGENT**: Based on what you've described, this sounds like it could be serious. Please seek emergency care immediately.\n\n📞 Emergency: **1122**\n🏥 Subhan Care Emergency: Open 24/7\n\n⚠️ *Disclaimer: I am an AI assistant, not a doctor. If this is an emergency, please call emergency services immediately.*",
    ur: "🚨 **EMERGENCY**: Yeh serious ho sakta hai. Foran emergency care lein.\n\n📞 Emergency: **1122**\n🏥 Subhan Care Emergency: 24/7 khuli hai\n\n⚠️ *Main AI hoon, doctor nahi. Emergency mein 1122 call karein.*",
  },
  triage_recommend_doctor: {
    en: "Based on what you've shared, I recommend booking an appointment with a doctor. {specialty_info}\n\nWould you like me to help you book an appointment?",
    ur: "Doctor se appointment book karna behtar hoga. {specialty_info}\n\nAppointment book karwa doon?",
  },
  triage_recommend_rest: {
    en: "For mild symptoms, I recommend rest and staying hydrated. If symptoms worsen or persist beyond 48 hours, please see a doctor.\n\n⚠️ *Disclaimer: I am an AI assistant, not a doctor. This is general advice, not medical diagnosis.*\n\nWould you like to book an appointment or ask anything else?",
    ur: "Halki alamat ke liye aaram karein, pani peete rahein. 48 ghante se zyada rahe to doctor se milein.\n\n⚠️ *Main AI hoon, doctor nahi. Yeh aam salah hai.*\n\nAppointment book karni hai?",
  },
  triage_disclaimer: {
    en: "⚠️ *Disclaimer: I am an AI assistant, not a doctor. If this is an emergency, please call emergency services (1122) immediately.*",
    ur: "⚠️ *Main AI hoon, doctor nahi. Emergency mein 1122 call karein.*",
  },
  triage_emergency_keywords_note: {
    en: "⚠️ **Important**: Symptoms like chest pain, severe bleeding, difficulty breathing, or loss of consciousness require immediate emergency care. Please call 1122 or visit the nearest emergency room.\n\n*Disclaimer: I am an AI assistant, not a doctor.*",
    ur: "⚠️ Seene mein dard, shadeed khoon, saans ki mushkil, ya behoshi — foran 1122 call karein.\n\n*Main AI hoon, doctor nahi.*",
  },

  // ── Cancel/Reschedule ──
  cancel_ask_identifier: {
    en: "I can help with cancelling or rescheduling. First, let me find your record. Please provide your CNIC, phone number, or full name.",
    ur: "Cancel/reschedule kar sakta hoon. CNIC, phone, ya naam bataayein.",
  },
  cancel_show_appointments: {
    en: "Here are your upcoming appointments for **{patient_name}**:\n\n{appointments}\n\nWhich one would you like to cancel or reschedule? (Please say the appointment number or date/time)",
    ur: "**{patient_name}** ki appointments:\n\n{appointments}\n\nKaunsi cancel karni hai?",
  },
  cancel_confirm: {
    en: "Are you sure you want to **cancel** this appointment?\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nThis action cannot be undone. (yes/no)",
    ur: "Aap sure hain? Cancel karni hai?\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nYe wapas nahi ho sakta. (haan/yes)",
  },
  cancel_success: {
    en: "✅ Your appointment with {doctor_name} on {date} at {time} has been cancelled. Would you like to book a new one?",
    ur: "✅ {doctor_name} ke saath {date} ko {time} wali cancel. Nayi book karni hai?",
  },
  cancel_no_appointments: {
    en: "**{patient_name}** doesn't have any upcoming appointments to cancel or reschedule.",
    ur: "**{patient_name}** ki koi appointment nahi cancel karne ke liye.",
  },
  reschedule_ask_date: {
    en: "What new date would you like? (YYYY-MM-DD format)",
    ur: "Nayi kaunsi date? YYYY-MM-DD format.",
  },
  reschedule_ask_time: {
    en: "Available slots for {date}:\n\n{slots}\n\nWhat time would you prefer?",
    ur: "{date} ke slots:\n\n{slots}\n\nKaunsa time?",
  },
  reschedule_success: {
    en: "✅ Appointment rescheduled!\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nIs there anything else?",
    ur: "✅ Reschedule ho gayi!\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nAur kuch?",
  },

  // ── Human handoff / callback ──
  handoff_unavailable: {
    en: "I'm sorry — a callback from our front desk is not currently available.{phone_line} Is there anything else I can help you with?",
    ur: "Maazrat — filhaal front desk se callback available nahi hai.{phone_line} Aur kuch madad chahiye?",
  },
  handoff_ask_phone: {
    en: "I can request a callback from our front desk. What phone number should we call you on? (e.g., 0300-1234567)",
    ur: "Main front desk se callback karwa sakta hoon. Kaunse number par call karein? (Misaal: 0300-1234567)",
  },
  handoff_ask_reason: {
    en: "Thanks — **{phone}** is noted. Would you like to briefly tell us the reason for the callback? (Optional — you can say 'no' to skip.)",
    ur: "Shukriya — **{phone}** note kar liya. Callback ki wajah bataana chahenge? (Optional — 'nahi' keh kar skip kar sakte hain.)",
  },
  handoff_reason_too_long: {
    en: "That reason is too long (maximum 200 characters). Please keep it brief, or say 'no' to skip.",
    ur: "Wajah bohot lambi hai (zayada se zayada 200 characters). Mukhtasar rakhein, ya 'nahi' keh kar skip karein.",
  },
  handoff_recorded: {
    en: "✅ Your callback request has been recorded. Our front desk team will call you back at **{phone}** {hours_sla}. This is a request only — we cannot guarantee a specific response time.",
    ur: "✅ Aapki callback request record ho gayi. Front desk **{phone}** par waapis call karega {hours_sla}. Yeh sirf ek request hai — response time ki koi guarantee nahi.",
  },
  handoff_duplicate: {
    en: "ℹ️ You already have a callback request pending for **{phone}**. Our front desk team will call you back {hours_sla}. We'll be in touch.",
    ur: "ℹ️ Aapki **{phone}** ke liye callback request pehle se pending hai. Front desk {hours_sla} par waapis call karega.",
  },
  handoff_after_emergency: {
    en: "\n\nAfter you have called emergency services, you can also ask me to have our front desk call you back.",
    ur: "\n\nEmergency services ko call karne ke baad, agar chahein to front desk se callback karwa sakte hain.",
  },

  // ── Validation ──
  validation_required: {
    en: "⚠️ This field is required. Please provide a valid value.",
    ur: "⚠️ Yeh field zaroori hai. Sahi value likhein.",
  },
  affirmative_responses: {
    en: "Great! Let me proceed.",
    ur: "Achha! Aage barhte hain.",
  },
  negative_responses: {
    en: "Alright, let's start over. How can I help you?",
    ur: "Theek hai, dobara shuru karte hain. Kya madad chahiye?",
  },
};

export function t(key: string, lang: Language, vars?: Record<string, string>): string {
  const entry = strings[key];
  if (!entry) return `[missing: ${key}]`;
  let text = entry[lang] || entry['en'] || `[missing: ${key}]`;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return text;
}

export function getFAQTopics(lang: Language): string {
  if (lang === 'ur') {
    return "• Hospital timings\n• Doctor list\n• Fees\n• Location\n• Services\n• Emergency info\n• Appointment process";
  }
  return "• Hospital timings\n• Doctor list\n• Fees\n• Location/Address\n• Services offered\n• Emergency info\n• Appointment process";
}
