import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { recordError } from './errorLog.js';

// Uses better-sqlite3's .backup() API (a live, consistent snapshot taken
// through SQLite's own backup mechanism), not a raw filesystem copy of a
// live WAL file — copying WAL/SHM files directly can produce a corrupt
// snapshot if a write is in flight (design doc §6, "Silent data loss").
export async function backupDatabase(db, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await db.backup(destinationPath);
}

// Runs a backup + VACUUM once, swallowing and logging failures rather than
// throwing — this is background maintenance, not a request path.
export async function runMaintenance(db, { backupPath }) {
  try {
    if (backupPath) {
      await backupDatabase(db, backupPath);
    }
    db.exec('VACUUM');
    return { ok: true };
  } catch (error) {
    await recordError({ component: 'maintenance', error });
    return { ok: false, error };
  }
}

// Fires once at startup (so a service that only lives a few hours between
// restarts still gets backed up) and then on the given interval.
export function scheduleNightlyMaintenance(db, { backupPath, intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  runMaintenance(db, { backupPath });
  const timer = setInterval(() => runMaintenance(db, { backupPath }), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
