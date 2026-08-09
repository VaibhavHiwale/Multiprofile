import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from '@noble/hashes/utils.js';

// PIN hashing stays argon2id with a per-PIN random salt, stored as a standard
// PHC string ($argon2id$v=19$m=...,t=...,p=...$salt$hash) — same algorithm and
// same on-disk shape as the Node build's `argon2` package produced, so the
// column contents remain interchangeable.
//
// Two things changed, both forced by the platform. Both are logged in
// docs/PROGRESS.md rather than silently downgraded:
//
// 1. Implementation. `argon2` is a native binding and Workers have no
//    native-binary support. `hash-wasm` was the obvious swap, but it
//    base64-embeds its .wasm and calls WebAssembly.instantiate() on raw bytes
//    at runtime, which workerd rejects ("Wasm code generation disallowed by
//    embedder") — that would pass locally under Miniflare and then fail in
//    production, the worst possible failure mode. @noble/hashes is pure JS,
//    audited, zero-dependency, and behaves identically in both.
//
// 2. Cost parameters. Cloudflare's Free plan allows 10 ms of CPU per request.
//    The `argon2` package's defaults (m=64 MiB, t=3) need ~50-100 ms and would
//    hard-fail every PIN request on that plan. These parameters are tuned to
//    fit the Free-plan budget. That is a genuine reduction in brute-force cost,
//    and it is defensible *here specifically* because a 4-8 digit PIN has at
//    most 10^8 possible values — no KDF cost factor makes that offline-safe —
//    and design.md §4.4 already scopes the PIN as "a parental-convenience
//    control, not an authentication boundary". On the Workers Paid plan
//    (30 s CPU) raise ARGON2_MEMORY_KIB back toward 65536; verifyPin reads the
//    parameters out of each stored hash, so old hashes keep verifying.
const ARGON2_MEMORY_KIB = 512;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_SALT_BYTES = 16;
const ARGON2_HASH_BYTES = 32;
const ARGON2_VERSION = 0x13;

export const ARGON2_PARAMS = Object.freeze({
  m: ARGON2_MEMORY_KIB,
  t: ARGON2_TIME_COST,
  p: ARGON2_PARALLELISM,
});

function toB64NoPad(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
}

function fromB64NoPad(text) {
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Constant-time equality: a PIN check should not leak how much of the hash
// matched via timing.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function encodePhc({ memoryKib, timeCost, parallelism, version, salt, hash }) {
  return [
    '',
    'argon2id',
    `v=${version}`,
    `m=${memoryKib},t=${timeCost},p=${parallelism}`,
    toB64NoPad(salt),
    toB64NoPad(hash),
  ].join('$');
}

export function decodePhc(phc) {
  const parts = String(phc).split('$');
  // ['', 'argon2id', 'v=19', 'm=..,t=..,p=..', salt, hash]
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id') {
    throw new Error('unsupported PIN hash format');
  }
  const version = Number(/^v=(\d+)$/.exec(parts[2])?.[1]);
  const params = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3]);
  if (!Number.isFinite(version) || !params) {
    throw new Error('unsupported PIN hash format');
  }
  return {
    version,
    memoryKib: Number(params[1]),
    timeCost: Number(params[2]),
    parallelism: Number(params[3]),
    salt: fromB64NoPad(parts[4]),
    hash: fromB64NoPad(parts[5]),
  };
}

export async function hashPin(pin) {
  const salt = randomBytes(ARGON2_SALT_BYTES);
  const hash = argon2id(pin, salt, {
    m: ARGON2_MEMORY_KIB,
    t: ARGON2_TIME_COST,
    p: ARGON2_PARALLELISM,
    version: ARGON2_VERSION,
    dkLen: ARGON2_HASH_BYTES,
  });
  return encodePhc({
    memoryKib: ARGON2_MEMORY_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
    version: ARGON2_VERSION,
    salt,
    hash,
  });
}

export async function verifyPin(storedHash, pin) {
  try {
    const parsed = decodePhc(storedHash);
    const candidate = argon2id(pin, parsed.salt, {
      m: parsed.memoryKib,
      t: parsed.timeCost,
      p: parsed.parallelism,
      version: parsed.version,
      dkLen: parsed.hash.length,
    });
    return timingSafeEqual(candidate, parsed.hash);
  } catch {
    return false;
  }
}
