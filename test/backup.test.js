import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase, runMaintenance } from '../src/lib/backup.js';
import { configureErrorLog } from '../src/lib/errorLog.js';

async function withTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'switchboard-backup-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('backupDatabase produces a readable snapshot with the same data', async (t) => {
  const dir = await withTempDir(t);
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (x INTEGER)');
  db.prepare('INSERT INTO t VALUES (?)').run(42);

  const destinationPath = join(dir, 'nested', 'backup.db');
  await backupDatabase(db, destinationPath);
  db.close();

  const restored = new Database(destinationPath, { readonly: true });
  const row = restored.prepare('SELECT x FROM t').get();
  restored.close();

  assert.equal(row.x, 42);
});

test('runMaintenance backs up and vacuums without throwing', async (t) => {
  const dir = await withTempDir(t);
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (x INTEGER)');

  const backupPath = join(dir, 'backup.db');
  const result = await runMaintenance(db, { backupPath });
  db.close();
  assert.equal(result.ok, true);

  const stat = await readFile(backupPath);
  assert.ok(stat.length > 0);
});

test('runMaintenance swallows failures and records them via the error log', async (t) => {
  const dir = await withTempDir(t);
  configureErrorLog(join(dir, 'errors.jsonl'));

  const db = new Database(':memory:');
  db.close(); // force db.backup()/exec() to throw on an already-closed handle

  const result = await runMaintenance(db, { backupPath: join(dir, 'backup.db') });
  assert.equal(result.ok, false);

  const logContents = await readFile(join(dir, 'errors.jsonl'), 'utf8');
  const record = JSON.parse(logContents.trim());
  assert.equal(record.component, 'maintenance');
});
