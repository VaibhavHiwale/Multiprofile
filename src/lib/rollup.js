import { ErrorEventsRepo } from '../db/errorEvents.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const ROLLUP_PREFIX = 'error-rollups';

// Unchanged from scripts/weekly-error-rollup.js — same ISO-week labelling, so
// rollup filenames stay comparable across the Node → Workers migration.
export function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Accepts either the D1 row shape (error_type) or the in-memory record shape
// (errorType), so the same builder serves the cron job and the unit tests.
function componentOf(row) {
  return row.component ?? 'unknown';
}

function errorTypeOf(row) {
  return row.error_type ?? row.errorType ?? 'Error';
}

export function buildMarkdown(records, now) {
  const byComponent = new Map();
  for (const r of records) {
    const componentKey = componentOf(r);
    if (!byComponent.has(componentKey)) byComponent.set(componentKey, new Map());
    const byType = byComponent.get(componentKey);
    const typeKey = errorTypeOf(r);
    byType.set(typeKey, (byType.get(typeKey) ?? 0) + 1);
  }

  const totalsByComponent = [...byComponent.entries()]
    .map(([component, byType]) => [component, [...byType.values()].reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1]);

  const lines = [`# Weekly error rollup — ${isoWeekLabel(new Date(now))}`, ''];
  lines.push(`${records.length} error(s) recorded in the last 7 days.`, '');

  if (records.length === 0) {
    lines.push('No errors recorded this week.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('## By component', '');
  for (const [component, count] of totalsByComponent) {
    lines.push(`- **${component}**: ${count}`);
  }
  lines.push('', '## By component and error type', '');
  for (const [component, byType] of byComponent) {
    lines.push(`### ${component}`);
    const sorted = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted) {
      lines.push(`- ${type}: ${count}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// The Cron Trigger body. Replaces `npm run rollup:errors` reading
// ./data/errors.jsonl: the source is now the D1 error_events table and the
// destination is an R2 object instead of a local file.
export async function runWeeklyErrorRollup(env, { now = Date.now() } = {}) {
  const records = await new ErrorEventsRepo(env.DB).listSince(now - WEEK_MS);
  const markdown = buildMarkdown(records, now);
  const key = `${ROLLUP_PREFIX}/${isoWeekLabel(new Date(now))}.md`;
  await env.ASSETS_BUCKET.put(key, markdown, {
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
  });
  return { key, recordCount: records.length };
}
