// Multi-language support: English (en) and Roman Urdu (ur)
// All user-facing messages, prompts, and FAQ responses

export type Language = 'en' | 'ur';

export function detectLanguage(text: string): Language {
  // Common Roman Urdu words/patterns
  const urduMarkers = [
    'mein', 'hai', 'hain', 'kya', 'karna', 'karni', 'kar', 'mujhe',
    'meri', 'mera', 'aap', 'aapka', 'aapki', 'doctor', 'appointment',
    'leni', 'lena', 'dena', 'jana', 'hona', 'chahiye', 'sakta', 'sakti',
    'is', 'us', 'aur', 'lekin', 'magar', 'nahi', 'nahin', 'bilkul',
    'zaroor', 'shukriya', 'please', 'bukhar', 'dard', 'khaansi',
    'dawai', 'dawaiyan', 'ilaj', 'mareez', 'hospital', 'timings',
    'register', 'kahan', 'kab', 'kitna', 'kitne', 'kaise', 'kyun',
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
    ur: "👋 Subhan Care Hospital mein khushamadeed! Main aapka AI receptionist hoon. Aaj main aapki kya madad kar sakta hoon?\n\nAap kar sakte hain:\n• Naye patient ke taur par register karein\n• Appointment book karein\n• Apni appointment ka status check karein\n• Services, timings ya fees ke baare mein poochhein\n• Symptoms batakar guidance lein",
  },
  fallback: {
    en: "I'm not sure I understand. Could you please rephrase? I can help you with:\n• Registering as a new patient\n• Booking an appointment\n• Checking appointment status\n• Hospital information (timings, fees, location)\n• Symptom guidance",
    ur: "Mujhe samajh nahi aaya. Kya aap dobara bata sakte hain? Main aapki madad kar sakta hoon:\n• Naye patient register karne mein\n• Appointment book karne mein\n• Appointment status check karne mein\n• Hospital ki maloomat (timings, fees, location)\n• Symptoms ke baare mein guidance",
  },
  goodbye: {
    en: "Thank you for contacting Subhan Care Hospital. Feel free to reach out anytime. Take care! 👋",
    ur: "Subhan Care Hospital se raabta karne ka shukriya. Kabhi bhi humse raabta karein. Apna khayal rakhiye! 👋",
  },

  // ── Registration ──
  reg_ask_full_name: {
    en: "Let's get you registered! First, what is your full name?",
    ur: "Chaliye aapko register karte hain! Pehle, aapka poora naam kya hai?",
  },
  reg_ask_cnic: {
    en: "What is your CNIC number? (Format: XXXXX-XXXXXXX-X)",
    ur: "Aapka CNIC number kya hai? (Format: XXXXX-XXXXXXX-X)",
  },
  reg_ask_dob: {
    en: "What is your date of birth? (Format: YYYY-MM-DD, e.g., 1990-05-15)",
    ur: "Aapki date of birth kya hai? (Format: YYYY-MM-DD, misaal: 1990-05-15)",
  },
  reg_ask_gender: {
    en: "What is your gender? (Male / Female / Other)",
    ur: "Aapki gender kya hai? (Male / Female / Other)",
  },
  reg_ask_phone: {
    en: "What is your phone number? (e.g., 0300-1234567)",
    ur: "Aapka phone number kya hai? (Misaal: 0300-1234567)",
  },
  reg_ask_address: {
    en: "What is your address?",
    ur: "Aapka address kya hai?",
  },
  reg_ask_emergency_contact: {
    en: "Finally, what is an emergency contact number? (A family member or close contact)",
    ur: "Aakhir mein, emergency contact number kya hai? (Kisi qareebi rishtedaar ka number)",
  },
  reg_confirm: {
    en: "Here's what I have. Please confirm if this is correct:\n\n📋 **Name:** {full_name}\n🪪 **CNIC:** {cnic}\n🎂 **Date of Birth:** {dob}\n⚥ **Gender:** {gender}\n📞 **Phone:** {phone}\n📍 **Address:** {address}\n🚨 **Emergency Contact:** {emergency_contact}\n\nIs this correct? (yes/no)",
    ur: "Yeh maloomat hai jo maine collect ki. Baraye meherbani confirm karein:\n\n📋 **Naam:** {full_name}\n🪪 **CNIC:** {cnic}\n🎂 **Date of Birth:** {dob}\n⚥ **Gender:** {gender}\n📞 **Phone:** {phone}\n📍 **Address:** {address}\n🚨 **Emergency Contact:** {emergency_contact}\n\nKya yeh durust hai? (haan/ji haan/yes)",
  },
  reg_success: {
    en: "✅ You have been successfully registered! Your Patient ID is: **{patient_id}**. You can now book an appointment. Would you like to book one now?",
    ur: "✅ Aap kamyabi se register ho gaye hain! Aapki Patient ID hai: **{patient_id}**. Ab aap appointment book kar sakte hain. Kya aap abhi appointment book karna chahenge?",
  },
  reg_cnic_exists: {
    en: "⚠️ A patient with CNIC {cnic} already exists. Let me look up your record instead. Would you like to book an appointment or check your existing appointments?",
    ur: "⚠️ CNIC {cnic} ke saath pehle se ek patient mojood hai. Main aapka record talash karta hoon. Kya aap appointment book karna chahenge ya apni pehli appointment check karna chahenge?",
  },
  reg_invalid_cnic: {
    en: "❌ That doesn't look like a valid CNIC format. CNIC should be in the format: XXXXX-XXXXXXX-X (13 digits with dashes). Please try again.",
    ur: "❌ Yeh CNIC ka durust format nahi lag raha. CNIC ka format hona chahiye: XXXXX-XXXXXXX-X (13 digits with dashes). Baraye meherbani dobara koshish karein.",
  },
  reg_invalid_dob: {
    en: "❌ Invalid date format. Please use YYYY-MM-DD (e.g., 1990-05-15).",
    ur: "❌ Date ka format galat hai. Baraye meherbani YYYY-MM-DD format istemal karein (Misaal: 1990-05-15).",
  },
  reg_invalid_gender: {
    en: "❌ Please enter Male, Female, or Other.",
    ur: "❌ Baraye meherbani Male, Female, ya Other likhein.",
  },
  reg_invalid_phone: {
    en: "❌ Invalid phone number. Please enter a valid Pakistani phone number (e.g., 0300-1234567).",
    ur: "❌ Phone number galat hai. Baraye meherbani sahi Pakistani phone number likhein (Misaal: 0300-1234567).",
  },

  // ── Booking ──
  book_ask_doctor: {
    en: "Which doctor or specialty are you looking for? Here are our available doctors:\n\n{doctor_list}\n\nYou can say the doctor's name or specialty (e.g., 'Dr. Ahmed' or 'Cardiologist').",
    ur: "Aap kis doctor ya specialty ke liye appointment chahte hain? Yeh hain hamare mojood doctors:\n\n{doctor_list}\n\nAap doctor ka naam ya specialty bata sakte hain (Misaal: 'Dr. Ahmed' ya 'Cardiologist').",
  },
  book_ask_date: {
    en: "For which date would you like the appointment? (YYYY-MM-DD format, e.g., 2026-07-25)\n\n{doctor_name} is available {schedule_info}.",
    ur: "Aap kis date ke liye appointment chahte hain? (YYYY-MM-DD format, Misaal: 2026-07-25)\n\n{doctor_name} {schedule_info} available hain.",
  },
  book_ask_time: {
    en: "Here are the available time slots for {doctor_name} on {date}:\n\n{slots}\n\nWhich time do you prefer? (e.g., '09:00')",
    ur: "Yeh hain {doctor_name} ke liye {date} ko available time slots:\n\n{slots}\n\nAap kaunsa time pasand karenge? (Misaal: '09:00')",
  },
  book_confirm: {
    en: "Let me confirm your appointment:\n\n👨‍⚕️ **Doctor:** {doctor_name} ({specialization})\n📅 **Date:** {date}\n🕐 **Time:** {time}\n💰 **Fee:** Rs. {fee}\n\nShall I book this? (yes/no)",
    ur: "Main aapki appointment confirm karta hoon:\n\n👨‍⚕️ **Doctor:** {doctor_name} ({specialization})\n📅 **Date:** {date}\n🕐 **Time:** {time}\n💰 **Fee:** Rs. {fee}\n\nKya yeh book karni hai? (haan/yes)",
  },
  book_success: {
    en: "✅ Appointment booked successfully!\n\n📋 Appointment ID: {appointment_id}\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nPlease arrive 15 minutes early. Would you like anything else?",
    ur: "✅ Appointment kamyabi se book ho gayi!\n\n📋 Appointment ID: {appointment_id}\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nBaraye meherbani 15 minutes pehle pohanchiye. Kya aapko aur kuch chahiye?",
  },
  book_no_slots: {
    en: "Sorry, {doctor_name} has no available slots on {date}. Would you like to try a different date or another doctor?",
    ur: "Maazrat, {doctor_name} ke {date} ko koi slot available nahi hai. Kya aap koi aur date ya koi aur doctor try karna chahenge?",
  },
  book_no_doctor: {
    en: "I couldn't find a doctor matching '{query}'. Our available doctors are:\n\n{doctor_list}\n\nPlease try again.",
    ur: "Mujhe '{query}' se match karne wala koi doctor nahi mila. Hamare available doctors:\n\n{doctor_list}\n\nBaraye meherbani dobara koshish karein.",
  },
  book_invalid_date: {
    en: "❌ Invalid date. Please use YYYY-MM-DD format. The date should be today or in the future.",
    ur: "❌ Date galat hai. Baraye meherbani YYYY-MM-DD format istemal karein. Date aaj ya aaj ke baad ki honi chahiye.",
  },
  book_slot_taken: {
    en: "⚠️ That time slot is no longer available (someone may have booked it). Please choose another time:\n\n{slots}",
    ur: "⚠️ Woh time slot ab available nahi hai. Baraye meherbani koi aur time choose karein:\n\n{slots}",
  },
  book_ask_is_patient: {
    en: "Are you already registered with Subhan Care Hospital? (yes/no)\nIf yes, I can look up your record. If not, I'll help you register first!",
    ur: "Kya aap pehle se Subhan Care Hospital mein register hain? (haan/yes)\nAgar haan, to main aapka record search kar sakta hoon. Agar nahi, to pehle registration karte hain!",
  },
  book_ask_identifier: {
    en: "How can I find your record? Please provide your CNIC, phone number, or full name.",
    ur: "Main aapka record kaise dhoondhoon? Baraye meherbani apna CNIC, phone number, ya poora naam bataayein.",
  },

  // ── Check Appointment ──
  check_ask_identifier: {
    en: "I'd be happy to check your appointments. How can I find your record? Please provide your CNIC, phone number, or full name.",
    ur: "Main aapki appointment check karta hoon. Main aapka record kaise dhoondhoon? Baraye meherbani apna CNIC, phone number, ya poora naam bataayein.",
  },
  check_no_patient: {
    en: "I couldn't find a patient matching '{query}'. Please double-check the information and try again.",
    ur: "Mujhe '{query}' se match karne wala koi patient nahi mila. Baraye meherbani maloomat check karein aur dobara koshish karein.",
  },
  check_results: {
    en: "Here are the appointments for **{patient_name}**:\n\n{appointments}\n\nWould you like help with anything else?",
    ur: "Yeh hain **{patient_name}** ki appointments:\n\n{appointments}\n\nKya aapko aur kuch chahiye?",
  },
  check_no_appointments: {
    en: "**{patient_name}** doesn't have any upcoming appointments. Would you like to book one?",
    ur: "**{patient_name}** ki koi appointment nahi hai. Kya aap book karna chahenge?",
  },

  // ── FAQ ──
  faq_not_found: {
    en: "I don't have information on that specific topic. Here are topics I can help with:\n\n{topics}\n\nYou can also ask about any of these!",
    ur: "Mere paas is topic ke baare mein maloomat nahi hai. Main in topics mein madad kar sakta hoon:\n\n{topics}\n\nAap in mein se kisi ke baare mein poochh sakte hain!",
  },

  // ── Triage ──
  triage_ask_severity: {
    en: "I understand you're experiencing **{symptom}**. On a scale of 1-10, how severe is it? (1 = mild, 10 = extremely severe)",
    ur: "Main samjhta hoon aapko **{symptom}** ho raha hai. 1-10 ke scale par, yeh kitna shadeed hai? (1 = halka, 10 = bohot shadeed)",
  },
  triage_ask_duration: {
    en: "How long have you been experiencing this? (e.g., '2 hours', '3 days', '1 week')",
    ur: "Aapko yeh kitne arse se ho raha hai? (Misaal: '2 ghante', '3 din', '1 hafta')",
  },
  triage_emergency: {
    en: "🚨 **URGENT**: Based on what you've described, this sounds like it could be serious. Please seek emergency care immediately.\n\n📞 Emergency: **1122**\n🏥 Subhan Care Emergency: Open 24/7\n\n⚠️ *Disclaimer: I am an AI assistant, not a doctor. If this is an emergency, please call emergency services immediately.*",
    ur: "🚨 **EMERGENCY**: Aapki batayi hui alamat ki bunyaad par, yeh serious ho sakta hai. Baraye meherbani fori tor par emergency care hasil karein.\n\n📞 Emergency: **1122**\n🏥 Subhan Care Emergency: 24/7 khuli hai\n\n⚠️ *Disclaimer: Main AI assistant hoon, doctor nahi. Agar yeh emergency hai to fori tor par emergency services ko call karein.*",
  },
  triage_recommend_doctor: {
    en: "Based on what you've shared, I recommend booking an appointment with a doctor. {specialty_info}\n\nWould you like me to help you book an appointment?",
    ur: "Aapki batayi hui maloomat ki bunyaad par, main doctor se appointment book karne ki tajweez karta hoon. {specialty_info}\n\nKya main appointment book karne mein aapki madad karoon?",
  },
  triage_recommend_rest: {
    en: "For mild symptoms, I recommend rest and staying hydrated. If symptoms worsen or persist beyond 48 hours, please see a doctor.\n\n⚠️ *Disclaimer: I am an AI assistant, not a doctor. This is general advice, not medical diagnosis.*\n\nWould you like to book an appointment or ask anything else?",
    ur: "Halki alamat ke liye, main aaram aur pani peene ki tajweez karta hoon. Agar alamat 48 ghante se zyada rahe ya badh jaaye, to doctor se zaroor milein.\n\n⚠️ *Disclaimer: Main AI assistant hoon, doctor nahi. Yeh aam salah hai, medical diagnosis nahi.*\n\nKya aap appointment book karna chahenge ya kuch aur poochna chahenge?",
  },
  triage_disclaimer: {
    en: "⚠️ *Disclaimer: I am an AI assistant, not a doctor. If this is an emergency, please call emergency services (1122) immediately.*",
    ur: "⚠️ *Disclaimer: Main AI assistant hoon, doctor nahi. Agar yeh emergency hai to fori tor par emergency services (1122) ko call karein.*",
  },
  triage_emergency_keywords_note: {
    en: "⚠️ **Important**: Symptoms like chest pain, severe bleeding, difficulty breathing, or loss of consciousness require immediate emergency care. Please call 1122 or visit the nearest emergency room.\n\n*Disclaimer: I am an AI assistant, not a doctor.*",
    ur: "⚠️ **Zaroori**: Seene mein dard, shadeed khoon, saans lene mein mushkil, ya behoshi jaisi alamat ke liye fori emergency care ki zaroorat hai. 1122 par call karein ya qareebi emergency room jaayein.\n\n*Disclaimer: Main AI assistant hoon, doctor nahi.*",
  },

  // ── Cancel/Reschedule ──
  cancel_ask_identifier: {
    en: "I can help with cancelling or rescheduling. First, let me find your record. Please provide your CNIC, phone number, or full name.",
    ur: "Main cancel ya reschedule karne mein madad kar sakta hoon. Pehle, mujhe aapka record dhoondhna hoga. Baraye meherbani apna CNIC, phone number, ya poora naam batayein.",
  },
  cancel_show_appointments: {
    en: "Here are your upcoming appointments for **{patient_name}**:\n\n{appointments}\n\nWhich one would you like to cancel or reschedule? (Please say the appointment number or date/time)",
    ur: "Yeh hain **{patient_name}** ki aane wali appointments:\n\n{appointments}\n\nAap kaunsi cancel ya reschedule karna chahenge? (Baraye meherbani appointment number ya date/time batayein)",
  },
  cancel_confirm: {
    en: "Are you sure you want to **cancel** this appointment?\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nThis action cannot be undone. (yes/no)",
    ur: "Kya aap yaqeenan yeh appointment **cancel** karna chahte hain?\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nYeh action undo nahi ho sakta. (haan/yes)",
  },
  cancel_success: {
    en: "✅ Your appointment with {doctor_name} on {date} at {time} has been cancelled. Would you like to book a new one?",
    ur: "✅ {doctor_name} ke saath {date} ko {time} wali appointment cancel ho gayi. Kya aap nayi appointment book karna chahenge?",
  },
  cancel_no_appointments: {
    en: "**{patient_name}** doesn't have any upcoming appointments to cancel or reschedule.",
    ur: "**{patient_name}** ki koi aane wali appointment nahi hai jo cancel ya reschedule ki ja sake.",
  },
  reschedule_ask_date: {
    en: "What new date would you like? (YYYY-MM-DD format)",
    ur: "Aap nayi kaunsi date chahte hain? (YYYY-MM-DD format)",
  },
  reschedule_ask_time: {
    en: "Available slots for {date}:\n\n{slots}\n\nWhat time would you prefer?",
    ur: "{date} ke liye available slots:\n\n{slots}\n\nAap kaunsa time pasand karenge?",
  },
  reschedule_success: {
    en: "✅ Appointment rescheduled!\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nIs there anything else?",
    ur: "✅ Appointment reschedule ho gayi!\n\n👨‍⚕️ {doctor_name}\n📅 {date} at {time}\n\nKya aapko aur kuch chahiye?",
  },

  // ── Validation ──
  validation_required: {
    en: "⚠️ This field is required. Please provide a valid value.",
    ur: "⚠️ Yeh field zaroori hai. Baraye meherbani sahi value likhein.",
  },
  affirmative_responses: {
    en: "Great! Let me proceed.",
    ur: "Bohot achha! Main aage barhta hoon.",
  },
  negative_responses: {
    en: "Alright, let's start over. How can I help you?",
    ur: "Theek hai, chaliye dobara shuru karte hain. Main aapki kya madad kar sakta hoon?",
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
