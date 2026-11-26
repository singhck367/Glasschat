// Shared contact resolution, formatting, and SMS invite helpers

export function normalizeDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function getLast10(phone) {
  const digits = normalizeDigits(phone);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function lookupSavedName(phone, savedContactsMap = {}) {
  if (!phone || !savedContactsMap) return '';
  const digits = normalizeDigits(phone);
  if (!digits) return '';
  const last10 = getLast10(digits);
  return savedContactsMap[last10] || savedContactsMap[digits] || '';
}

export function isSavedNumber(phone, savedContactsMap = {}) {
  return Boolean(lookupSavedName(phone, savedContactsMap));
}

/**
 * Always resolves a contact/user using the user's phonebook saved name first.
 * Falls back to phone number or profile name when unsaved.
 */
export function resolveDisplayName(entity, savedContactsMap = {}, preferPhoneOverUnsavedName = false) {
  if (!entity) return 'Unknown';
  if (entity.isGroup) return entity.name || 'Group';

  const phone = entity.phone || entity.senderPhone || entity.callerPhone || '';
  const saved = lookupSavedName(phone, savedContactsMap);
  if (saved) return saved;

  if (preferPhoneOverUnsavedName && phone) {
    return phone;
  }
  const rawName = entity.name || entity.senderName || entity.callerName || '';
  const cleanName = rawName.trim().toLowerCase() === 'user' ? '' : rawName;
  return phone || cleanName || 'Unknown';
}

export function openSmsInvite(phone, contactName = '') {
  const cleanPhone = String(phone || '').trim();
  const downloadUrl = 'https://glasschat-vt5f.onrender.com/download';
  const greeting = contactName ? `Hi ${contactName}, ` : 'Hi! ';
  const body = `${greeting}I am using GlassChat — download the app for HD video/audio calls, fast messaging & smart tools: ${downloadUrl}`;
  const encodedBody = encodeURIComponent(body);
  const sep = /iPad|iPhone|iPod/i.test(navigator.userAgent) ? '&' : '?';
  const smsUrl = cleanPhone ? `sms:${cleanPhone}${sep}body=${encodedBody}` : `sms:${sep}body=${encodedBody}`;

  try {
    window.location.href = smsUrl;
  } catch {
    if (navigator.share) {
      navigator.share({ title: 'Join me on GlassChat', text: body, url: downloadUrl }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(body).then(() => {
        alert(`Invite message copied! Send to ${cleanPhone || 'contact'}:\n\n${body}`);
      }).catch(() => {});
    }
  }
}
