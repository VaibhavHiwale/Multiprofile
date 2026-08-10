import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// Replaces src/lib/errorLog.js (fs.appendFile → ./data/errors.jsonl). Same
// record shape, now a D1 row: timestamp, component, error type/message/stack,
// request path, SHA-256-hashed household token.
//
// The raw household token is NEVER stored. This is a hard requirement from the
// project owner, restated here so nobody "helpfully" adds the plain token to
// make debugging easier.
export function hashToken(token) {
  if (!token) return null;
  return bytesToHex(sha256(utf8ToBytes(token))).slice(0, 16);
}

export function buildErrorRecord({
  component,
  error,
  requestPath = null,
  householdToken = null,
  now = Date.now(),
}) {
  return {
    timestamp: now,
    component,
    errorType: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    requestPath,
    householdTokenHash: hashToken(householdToken),
  };
}

export class ErrorEventsRepo {
  constructor(db) {
    this.db = db;
  }

  // Never throws: a broken error log must not take down the request it is
  // trying to record (same contract as the Node build's recordError).
  async record(input) {
    const record = buildErrorRecord(input);
    try {
      await this.db
        .prepare(
          `INSERT INTO error_events
             (timestamp, component, error_type, message, stack, request_path, household_token_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          record.timestamp,
          record.component,
          record.errorType,
          record.message,
          record.stack,
          record.requestPath,
          record.householdTokenHash
        )
        .run();
    } catch {
      // Swallow — logging failures are not allowed to become request failures.
    }
    return record;
  }

  async listSince(sinceTimestamp) {
    const { results } = await this.db
      .prepare('SELECT * FROM error_events WHERE timestamp >= ? ORDER BY timestamp DESC')
      .bind(sinceTimestamp)
      .all();
    return results ?? [];
  }
}
