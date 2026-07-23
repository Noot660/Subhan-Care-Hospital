// FAQ responses — pre-configured answers for common questions
import type { Language } from './i18n';

export interface FAQEntry {
  topic: string;
  keywords_en: string[];
  keywords_ur: string[];
  answer_en: string;
  answer_ur: string;
}

export const FAQS: FAQEntry[] = [
  {
    topic: 'Hospital Timings',
    keywords_en: ['hours', 'timing', 'timings', 'open', 'close', 'schedule', 'time', 'when'],
    keywords_ur: ['timings', 'khula', 'band', 'open', 'close', 'time', 'kab', 'wakt'],
    answer_en: `🏥 **Subhan Care Hospital Timings**

• **OPD (Outpatient):** Monday to Saturday, 9:00 AM – 5:00 PM
• **Emergency:** Open 24/7, including Sundays and holidays
• **Pharmacy:** Monday to Saturday, 9:00 AM – 8:00 PM
• **Lab & Diagnostics:** Monday to Saturday, 8:00 AM – 6:00 PM
• **Sunday:** Emergency only (OPD closed)`,
    answer_ur: `🏥 **Subhan Care Hospital Timings**

• **OPD:** Peer se Hafta, subah 9:00 AM – shaam 5:00 PM
• **Emergency:** 24/7 khuli hai, Itwar aur chuttiyon mein bhi
• **Pharmacy:** Peer se Hafta, subah 9:00 AM – raat 8:00 PM
• **Lab & Diagnostics:** Peer se Hafta, subah 8:00 AM – shaam 6:00 PM
• **Itwar:** Sirf emergency (OPD band)`,
  },
  {
    topic: 'Doctor List',
    keywords_en: ['doctor', 'doctors', 'specialist', 'specialists', 'who', 'list', 'available'],
    keywords_ur: ['doctor', 'doctors', 'specialist', 'kaun', 'list'],
    answer_en: `👨‍⚕️ **Our Doctors**

We have experienced specialists across multiple fields. Our current doctors include:

• **Dr. Ahmed** — Cardiologist (MBBS, FCPS Cardiology) | Fee: Rs. 2,000
• **Dr. Fatima** — Pediatrician (MBBS, FCPS Pediatrics) | Fee: Rs. 1,500

To see availability and book an appointment, just say "I want to book an appointment"!`,
    answer_ur: `👨‍⚕️ **Hamare Doctors**

Hamare paas mukhtalif fields ke tajarbakaar doctors hain:

• **Dr. Ahmed** — Cardiologist (MBBS, FCPS Cardiology) | Fee: Rs. 2,000
• **Dr. Fatima** — Pediatrician (MBBS, FCPS Pediatrics) | Fee: Rs. 1,500

Appointment dekhne aur book karne ke liye, bolein "Mujhe appointment book karni hai"!`,
  },
  {
    topic: 'Fees',
    keywords_en: ['fee', 'fees', 'cost', 'price', 'charge', 'charges', 'how much', 'rate', 'consultation'],
    keywords_ur: ['fee', 'fees', 'kharcha', 'qeemat', 'kitna', 'kitne', 'paisa', 'paisay'],
    answer_en: `💰 **Consultation Fees**

• **Dr. Ahmed (Cardiologist):** Rs. 2,000 per consultation
• **Dr. Fatima (Pediatrician):** Rs. 1,500 per consultation

Additional charges may apply for tests, procedures, or medications. Please contact the billing desk for detailed estimates.

Would you like to book an appointment?`,
    answer_ur: `💰 **Consultation Fees**

• **Dr. Ahmed (Cardiologist):** Rs. 2,000 per consultation
• **Dr. Fatima (Pediatrician):** Rs. 1,500 per consultation

Tests, procedures ya medicines ke additional charges ho sakte hain. Tafseeli estimate ke liye billing desk se raabta karein.

Kya aap appointment book karna chahenge?`,
  },
  {
    topic: 'Location',
    keywords_en: ['location', 'address', 'where', 'directions', 'located', 'map', 'reach'],
    keywords_ur: ['location', 'address', 'kahan', 'pata', 'jaga', 'kaise', 'pochanch'],
    answer_en: `📍 **Subhan Care Hospital Location**

**Address:** 123 Main Boulevard, Gulberg III, Lahore, Pakistan

**Landmarks:** Near Liberty Market, opposite Standard Chartered Bank

**Contact:** +92-42-111-782-422

Ample parking is available. Public transport: Metro Bus stop is a 5-minute walk.`,
    answer_ur: `📍 **Subhan Care Hospital Location**

**Address:** 123 Main Boulevard, Gulberg III, Lahore, Pakistan

**Landmarks:** Liberty Market ke qareeb, Standard Chartered Bank ke saamne

**Contact:** +92-42-111-782-422

Parking ki sahulat mojood hai. Public transport: Metro Bus stop 5 minute ki walk par hai.`,
  },
  {
    topic: 'Services',
    keywords_en: ['service', 'services', 'facility', 'facilities', 'offer', 'provide', 'department', 'departments'],
    keywords_ur: ['services', 'sahulat', 'saholatein', 'departments', 'facilities', 'kya', 'provide'],
    answer_en: `🏥 **Our Services**

• **Outpatient Department (OPD)** — General checkups & specialist consultations
• **Emergency & Trauma Care** — 24/7 emergency services
• **Inpatient Services** — Comfortable rooms & wards
• **Pharmacy** — Full-service pharmacy with genuine medicines
• **Laboratory & Diagnostics** — Blood tests, X-rays, ultrasound, ECG
• **Vaccination Center** — Routine & travel vaccinations
• **Health Checkup Packages** — Preventive health screenings

Is there a specific service you'd like to know more about?`,
    answer_ur: `🏥 **Hamari Services**

• **OPD (Outpatient Department)** — General checkup aur specialist consultations
• **Emergency & Trauma Care** — 24/7 emergency services
• **Inpatient Services** — Araam deh rooms aur wards
• **Pharmacy** — Mukammal pharmacy with original medicines
• **Laboratory & Diagnostics** — Blood tests, X-rays, ultrasound, ECG
• **Vaccination Center** — Routine aur travel vaccinations
• **Health Checkup Packages** — Preventive health screenings

Kya koi khaas service hai jiske baare mein aap zyada janna chahte hain?`,
  },
  {
    topic: 'Emergency',
    keywords_en: ['emergency', 'urgent', 'ambulance', 'accident', 'critical', 'life threatening'],
    keywords_ur: ['emergency', 'urgent', 'ambulance', 'hatsadi', 'accident'],
    answer_en: `🚨 **Emergency Services**

Subhan Care Hospital provides **24/7 emergency care**.

• **Emergency Hotline:** 1122 (National) or +92-42-111-782-422
• **Emergency Room:** Open 24 hours, every day including Sundays & holidays
• **Ambulance Service:** Available on request
• **Trauma Center:** Equipped for major injuries and accidents

⚠️ *In a life-threatening emergency, call 1122 immediately.*`,
    answer_ur: `🚨 **Emergency Services**

Subhan Care Hospital **24/7 emergency care** faraham karta hai.

• **Emergency Hotline:** 1122 (National) ya +92-42-111-782-422
• **Emergency Room:** 24 ghante khuli hai, Itwar aur chuttiyon mein bhi
• **Ambulance Service:** Request par available
• **Trauma Center:** Bade hadsaat aur injuries ke liye tayyar

⚠️ *Jaan ko khatra hone ki soorat mein, fori 1122 par call karein.*`,
  },
  {
    topic: 'Appointment Process',
    keywords_en: ['appointment process', 'how to book', 'how do i book', 'booking process', 'schedule appointment', 'make appointment'],
    keywords_ur: ['appointment kaise', 'book karne', 'booking', 'kaise karein', 'tareeqa'],
    answer_en: `📋 **How to Book an Appointment**

Booking is easy! Just tell me:
1. Which doctor or specialty you need
2. Your preferred date
3. Your preferred time

I'll check availability and confirm your booking instantly. Or just say "I want to book an appointment" and I'll guide you step by step!`,
    answer_ur: `📋 **Appointment Book Karne Ka Tareeqa**

Booking bohot aasan hai! Bas mujhe batayein:
1. Aapko kis doctor ya specialty ki zaroorat hai
2. Aapki pasand ki date
3. Aapka pasand ka time

Main availability check karke fori aapki booking confirm kar doonga. Ya phir bolein "Mujhe appointment book karni hai" aur main aapko step by step guide kar doonga!`,
  },
];

export function findFAQ(query: string): FAQEntry | null {
  const lower = query.toLowerCase().trim();

  // Try exact topic match first
  for (const faq of FAQS) {
    if (lower === faq.topic.toLowerCase()) return faq;
  }

  // Score by keyword matches
  let bestScore = 0;
  let bestFAQ: FAQEntry | null = null;

  for (const faq of FAQS) {
    let score = 0;
    for (const kw of faq.keywords_en) {
      if (lower.includes(kw)) score += 1;
    }
    for (const kw of faq.keywords_ur) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestFAQ = faq;
    }
  }

  return bestScore >= 1 ? bestFAQ : null;
}

export function formatFAQAnswer(faq: FAQEntry | null, lang: Language): string {
  if (!faq) {
    if (lang === 'ur') {
      return `Mujhe is topic ke baare mein maloomat nahi hai. Yeh topics hain jin mein main madad kar sakta hoon:\n\n• Hospital timings\n• Doctor list\n• Fees\n• Location\n• Services\n• Emergency info\n• Appointment process\n\nKisi bhi topic ke baare mein poochh sakte hain!`;
    }
    return `I don't have specific information on that topic. Here are topics I can help with:\n\n• Hospital timings\n• Doctor list\n• Fees\n• Location/Address\n• Services offered\n• Emergency info\n• Appointment process\n\nFeel free to ask about any of these!`;
  }
  return lang === 'ur' ? faq.answer_ur : faq.answer_en;
}

export function getFAQTopicList(lang: Language): string {
  if (lang === 'ur') {
    return '• Hospital Timings\n• Doctor List\n• Fees\n• Location\n• Services\n• Emergency\n• Appointment Process';
  }
  return '• Hospital Timings\n• Doctor List\n• Fees\n• Location\n• Services\n• Emergency\n• Appointment Process';
}
