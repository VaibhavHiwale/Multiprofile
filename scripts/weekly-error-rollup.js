import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const LOG_PATH = process.env.SWITCHBOARD_ERROR_LOG_PATH ?? './data/errors.jsonl';
const OUTPUT_DIR = process.env.SWITCHBOARD_ERROR_ROLLUP_DIR ?? './data/error-rollups';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export async function loadRecords(logPath) {
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function buildMarkdown(records, now) {
  const byComponent = new Map();
  for (const r of records) {
    const componentKey = r.component ?? 'unknown';
    if (!byComponent.has(componentKey)) byComponent.set(componentKey, new Map());
    const byType = byComponent.get(componentKey);
    const typeKey = r.errorType ?? 'Error';
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

export async function runRollup({
  logPath = LOG_PATH,
  outputDir = OUTPUT_DIR,
  now = Date.now(),
} = {}) {
  const all = await loadRecords(logPath);
  const recent = all.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && now - t <= WEEK_MS;
  });
  const markdown = buildMarkdown(recent, now);

  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${isoWeekLabel(new Date(now))}.md`);
  await writeFile(outputPath, markdown, 'utf8');
  return { outputPath, recordCount: recent.length };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runRollup().then(({ outputPath, recordCount }) => {
    console.log(`Wrote ${outputPath} (${recordCount} record(s))`);
  });
}
