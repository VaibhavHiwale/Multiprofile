import { randomBytes, randomUUID } from 'node:crypto';

// 128-bit random token, hex-encoded, used as the opaque household identifier
// embedded in the manifest URL path. Never derived from user input.
export function generateHouseholdToken() {
  return randomBytes(16).toString('hex');
}

export function generateId() {
  return randomUUID();
}
