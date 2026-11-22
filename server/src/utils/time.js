/**
 * Indian Standard Time (IST) Utility for Server
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

export function formatISTDateTime(input = new Date()) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: true
  }).toUpperCase();
}

export function formatChatTimestamp(input) {
  if (!input) return 'Today';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input);

  const now = new Date();
  const dIST = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  const isToday = dIST.toDateString() === nowIST.toDateString();
  const yesterday = new Date(nowIST);
  yesterday.setDate(nowIST.getDate() - 1);
  const isYesterday = dIST.toDateString() === yesterday.toDateString();

  if (isToday) return formatISTTime(d);
  if (isYesterday) return 'Yesterday';
  return formatISTDate(d);
}
