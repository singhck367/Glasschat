// Smart AI, Language Translation, Tone Guard, Action Extraction & Safety Helpers

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', label: 'English' },
  { code: 'hi', name: 'Hindi', label: 'Hindi' },
  { code: 'mr', name: 'Marathi', label: 'Marathi' },
  { code: 'ta', name: 'Tamil', label: 'Tamil' },
  { code: 'te', name: 'Telugu', label: 'Telugu' },
  { code: 'bn', name: 'Bengali', label: 'Bengali' },
  { code: 'gu', name: 'Gujarati', label: 'Gujarati' },
  { code: 'pa', name: 'Punjabi', label: 'Punjabi' },
  { code: 'ur', name: 'Urdu', label: 'Urdu' }
];

export async function translateText(text, targetLang = 'en') {
  if (!text || !targetLang || targetLang === 'off') {
    return { translatedText: text, langLabel: 'Original' };
  }
  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`
  );
  if (!res.ok) throw new Error('Translation HTTP error');
  const data = await res.json();
  const translatedText = data[0].map(item => item[0]).join('');
  const langLabel = SUPPORTED_LANGUAGES.find(l => l.code === targetLang)?.name || targetLang.toUpperCase();
  return { translatedText, langLabel };
}

export function generateSmartReplies(lastMsg, currentUserId = '') {
  if (!lastMsg || (currentUserId && lastMsg.senderId === currentUserId)) return [];
  if (!lastMsg.text) {
    return ['Okay 👍', 'Got it, checking now', "I'll call in 5 mins"];
  }
  const t = lastMsg.text.toLowerCase();

  if (/\b(hi|hello|hey|namaste|salam|gm|good morning|good evening)\b/.test(t)) {
    return ['Hello! How are you? 😊', 'Hey there! Doing great 🙏', 'Yes, go ahead!'];
  }
  if (/\b(kaha|where|location|reach|arrived)\b/.test(t)) {
    return ['On my way, 5 mins away 🚗', 'Sharing my live location 📍', 'At home right now'];
  }
  if (/\b(call|talk|phone|ring)\b/.test(t)) {
    return ['Call me right now 📞', 'Free in 10 mins, will call then', 'In a meeting — talk shortly?'];
  }
  if (/\b(money|upi|pay|rupees|rs|₹|payment|send money|paise|transfer)\b/.test(t)) {
    return ['Sending via UPI now 💸', 'Send a payment request ✅', 'Will transfer shortly'];
  }
  if (/\b(tomorrow|time|meeting|plan|dinner|movie|schedule|when|kal|baje)\b/.test(t)) {
    return ['Sounds good! See you on time 🤝', 'Reminder set ✅', 'Can we adjust the time?'];
  }
  if (t.includes('?') || /\b(what|why|how|when|confirm|ready|ok)\b/.test(t)) {
    return ['Yes, sounds good 👍', 'Confirming shortly', "Let's do it later"];
  }
  if (/\b(thanks|thank you|thx|ty)\b/.test(t)) {
    return ["You're welcome! 😊", 'Anytime! 🙏', 'Happy to help!'];
  }
  return ['Okay 👍', 'Got it ✅', "I'll reply shortly"];
}

const RUDE_PATTERNS = [
  { regex: /\b(stupid|idiot|shut up|nonsense|useless|fool|trash|moron|dumb|pagal|bewakoof|bakwas)\b/i, hint: 'Try calmer phrasing' },
  { regex: /\b(you know nothing|shut your|get lost|worst)\b/i, hint: 'Respond with respectful clarity' }
];

export function analyzeMoodTone(draftText) {
  if (!draftText || draftText.trim().length < 4) return null;
  const trimmed = draftText.trim();

  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  const isAllCaps = letters.length >= 8 && letters === letters.toUpperCase();

  let matchedHint = null;
  for (const p of RUDE_PATTERNS) {
    if (p.regex.test(trimmed)) {
      matchedHint = p.hint;
      break;
    }
  }

  if (!matchedHint && !isAllCaps) return null;

  let polite = trimmed
    .replace(/\bshut up\b/gi, 'please wait a moment')
    .replace(/\b(stupid|idiot|fool|moron|dumb|bewakoof|pagal)\b/gi, 'unclear')
    .replace(/\b(nonsense|bakwas)\b/gi, 'not ideal')
    .replace(/\buseless\b/gi, 'not working well');

  if (isAllCaps) {
    polite = polite.charAt(0).toUpperCase() + polite.slice(1).toLowerCase();
  }
  if (polite === trimmed) {
    polite = `Kindly note: ${trimmed.toLowerCase()} 🙏`;
  } else {
    polite = `${polite} 🙏`;
  }

  return {
    isHarsh: true,
    isRude: true,
    reason: isAllCaps ? 'ALL CAPS can sound like shouting' : 'This message might sound harsh or rude',
    politeSuggestion: polite
  };
}

export function extractSmartAction(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (t.length < 6) return null;
  const lower = t.toLowerCase();

  // Promise / payment intent
  if (/\b(promise|pay back|return money|owe|loan|due date|by tomorrow|send ₹|paise|upi|tarikh)\b/i.test(lower)) {
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return {
      kind: 'contract',
      label: 'Set Payment Reminder',
      title: t.slice(0, 80),
      suggestedTimeMs: dueDate.getTime()
    };
  }

  // Reminder / meeting / time intent
  if (/\b(remind|reminder|meeting|appointment|tomorrow|schedule|\d{1,2}\s*(am|pm)|kal|yaad)\b/i.test(lower)) {
    const timeMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    let label = 'Upcoming Reminder';
    const dueDate = new Date();
    if (/\b(tomorrow|kal)\b/i.test(lower)) {
      dueDate.setDate(dueDate.getDate() + 1);
      label = 'Tomorrow';
    }
    if (timeMatch) {
      let hr = parseInt(timeMatch[1], 10);
      const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const suffix = timeMatch[3].toLowerCase();
      if (suffix === 'pm' && hr < 12) hr += 12;
      if (suffix === 'am' && hr === 12) hr = 0;
      dueDate.setHours(hr, min, 0, 0);
      label = `${label} ${timeMatch[0]}`;
    } else {
      dueDate.setMinutes(dueDate.getMinutes() + 30);
    }

    return {
      kind: 'reminder',
      label: `Set Reminder (${label})`,
      title: t.slice(0, 80),
      suggestedTimeMs: dueDate.getTime()
    };
  }

  return null;
}

export function hasSuspiciousLinks(text) {
  if (!text) return false;
  return /(https?:\/\/[^\s]+|www\.[^\s]+)/i.test(text);
}

export function maskUnknownLinks(text) {
  if (!text) return text;
  return text.replace(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi, '[🚫 Link Hidden by Family Safe Mode]');
}
