import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRollup, buildMarkdown, isoWeekLabel } from '../scripts/weekly-error-rollup.js';

async function withTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'switchboard-rollup-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('buildMarkdown groups counts by component and error type', () => {
  const now = Date.now();
  const records = [
    { timestamp: new Date(now).toISOString(), component: 'http', errorType: 'TypeError' },
    { timestamp: new Date(now).toISOString(), component: 'http', errorType: 'TypeError' },
    { timestamp: new Date(now).toISOString(), component: 'cinemeta', errorType: 'Error' },
  ];
  const md = buildMarkdown(records, now);
  assert.match(md, /3 error\(s\) recorded/);
  assert.match(md, /\*\*http\*\*: 2/);
  assert.match(md, /\*\*cinemeta\*\*: 1/);
  assert.match(md, /TypeError: 2/);
});

test('buildMarkdown handles the empty case', () => {
  const md = buildMarkdown([], Date.now());
  assert.match(md, /No errors recorded this week/);
});

test('runRollup reads a JSONL log, drops records older than 7 days, writes a dated markdown file', async (t) => {
  const dir = await withTempDir(t);
  const logPath = join(dir, 'errors.jsonl');
  const outputDir = join(dir, 'rollups');
  const now = Date.now();
  const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;

  const lines = [
    JSON.stringify({ timestamp: new Date(now).toISOString(), component: 'http', errorType: 'Error' }),
    JSON.stringify({ timestamp: new Date(eightDaysAgo).toISOString(), component: 'http', errorType: 'Error' }),
  ];
  await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');

  const { outputPath, recordCount } = await runRollup({ logPath, outputDir, now });
  assert.equal(recordCount, 1);
  assert.equal(outputPath, join(outputDir, `${isoWeekLabel(new Date(now))}.md`));

  const markdown = await readFile(outputPath, 'utf8');
  assert.match(markdown, /1 error\(s\) recorded/);
});

test('runRollup tolerates a missing log file', async (t) => {
  const dir = await withTempDir(t);
  const { recordCount } = await runRollup({
    logPath: join(dir, 'does-not-exist.jsonl'),
    outputDir: join(dir, 'rollups'),
    now: Date.now(),
  });
  assert.equal(recordCount, 0);
});
