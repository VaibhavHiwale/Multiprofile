import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

let logPath = process.env.SWITCHBOARD_ERROR_LOG_PATH ?? './data/errors.jsonl';
let dirEnsured = false;

// Test-only override; also lets deployments repoint the log without env vars.
export function configureErrorLog(path) {
  logPath = path;
  dirEnsured = false;
}

export function hashToken(token) {
  if (!token) return null;
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

// Appends one structured record per failure — timestamp, component, error
// type/message/stack, request path, hashed household token (never raw).
// Never throws: a broken error log must not take down the request it's
// trying to record.
export async function recordError({ component, error, requestPath = null, householdToken = null }) {
  const record = {
    timestamp: new Date().toISOString(),
    component,
    errorType: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    requestPath,
    householdTokenHash: hashToken(householdToken),
  };
  try {
    if (!dirEnsured) {
      await mkdir(dirname(logPath), { recursive: true });
      dirEnsured = true;
    }
    await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Swallow — logging failures are not allowed to become request failures.
  }
  return record;
}
