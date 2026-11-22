/**
 * Indian Standard Time (IST) Utility for Client
 * Time Zone: Asia/Kolkata (UTC+5:30)
 */

export function formatISTTime(input = new Date()) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).toUpperCase();
}

export function formatISTDate(input = new Date()) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

export function formatChatTimestamp(input) {
  if (!input) return 'Today';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) {
    return String(input);
  }

  const now = new Date();
  const dIST = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  const isToday = dIST.toDateString() === nowIST.toDateString();
  const yesterday = new Date(nowIST);
  yesterday.setDate(nowIST.getDate() - 1);
  const isYesterday = dIST.toDateString() === yesterday.toDateString();

  if (isToday) return formatISTTime(d);
  if (isYesterday) return 'Yesterday';

  const diffDays = Math.floor((nowIST.getTime() - dIST.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7 && diffDays > 0) {
    return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  }

  return formatISTDate(d);
}

export function formatLastSeen(isoStr) {
  if (!isoStr) return 'Offline';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'Offline';
    const now = new Date();

    const dIST = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    const timeStr = formatISTTime(d);
    const isToday = dIST.toDateString() === nowIST.toDateString();
    const yesterday = new Date(nowIST);
    yesterday.setDate(nowIST.getDate() - 1);
    const isYesterday = dIST.toDateString() === yesterday.toDateString();

    if (isToday) return `Last seen today at ${timeStr}`;
    if (isYesterday) return `Last seen yesterday at ${timeStr}`;
    return `Last seen ${formatISTDate(d)} at ${timeStr}`;
  } catch {
    return 'Offline';
  }
}
