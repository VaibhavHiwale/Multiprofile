// 128-bit random token, hex-encoded, used as the opaque household identifier
// embedded in the manifest URL path. Never derived from user input.
//
// Workers expose the Web Crypto API globally, so this is `crypto.getRandomValues`
// / `crypto.randomUUID` rather than node:crypto — same guarantees, no polyfill.
export function generateHouseholdToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateId() {
  return crypto.randomUUID();
}
