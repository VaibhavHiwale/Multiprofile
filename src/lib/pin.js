import argon2 from 'argon2';

export async function hashPin(pin) {
  return argon2.hash(pin, { type: argon2.argon2id });
}

export async function verifyPin(hash, pin) {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}
