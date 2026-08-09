import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureErrorLog, recordError, hashToken } from '../src/lib/errorLog.js';
import { buildApp } from '../src/app.js';

async function withTempLog(t) {
  const dir = await mkdtemp(join(tmpdir(), 'switchboard-errlog-'));
  const path = join(dir, 'errors.jsonl');
  configureErrorLog(path);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return path;
}

test('hashToken never returns the raw token', () => {
  const token = 'a'.repeat(32);
  const hash = hashToken(token);
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test('recordError appends one structured JSON line with a hashed token', async (t) => {
  const path = await withTempLog(t);
  const token = 'b'.repeat(32);

  await recordError({
    component: 'test',
    error: new Error('boom'),
    requestPath: '/x/y',
    householdToken: token,
  });

  const contents = await readFile(path, 'utf8');
  const lines = contents.trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.component, 'test');
  assert.equal(record.errorType, 'Error');
  assert.equal(record.message, 'boom');
  assert.equal(record.requestPath, '/x/y');
  assert.equal(record.householdTokenHash, hashToken(token));
  assert.notEqual(record.householdTokenHash, token);
  assert.ok(!contents.includes(token), 'raw token must never appear in the log');
});

test('an unhandled resolver exception is captured via the global error handler', async (t) => {
  const path = await withTempLog(t);
  const app = buildApp({ dbPath: ':memory:', logger: false });
  t.after(() => app.close());

  app.get('/:token/boom-test', async () => {
    throw new Error('deliberate failure');
  });
  await app.ready();

  const res = await app.inject({ method: 'GET', url: `/${'c'.repeat(32)}/boom-test` });
  assert.equal(res.statusCode, 500);

  const contents = await readFile(path, 'utf8');
  const record = JSON.parse(contents.trim().split('\n').pop());
  assert.equal(record.component, 'http');
  assert.equal(record.message, 'deliberate failure');
  assert.match(record.requestPath, /\/boom-test$/);
  assert.equal(record.householdTokenHash, hashToken('c'.repeat(32)));
});
