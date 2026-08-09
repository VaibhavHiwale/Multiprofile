const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}
