// Thin API client — every POST carries the session id.

export const inr = (p) =>
  '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function getSessionId() {
  let id = sessionStorage.getItem('mm_sess');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('mm_sess', id);
  }
  return id;
}

export async function api(path, body = null) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify({ sessionId: getSessionId(), ...body }) : undefined,
  });
  return res.json();
}

/** Minimal markdown: **bold**, *italic*, `code`, newlines. */
export function renderMd(s) {
  return String(s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br/>');
}
