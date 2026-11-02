import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { VERDICTS } from '../../core/db/schema.js';
import { parseWhere, sortAreas, whereDefault, whereLabel } from '../../core/pipeline/areas.js';
import { type RankedRow, rankedList } from '../../core/pipeline/ranked.js';
import { reconcilePlacement } from '../../core/pipeline/reconcile.js';
import { scoringInputs } from '../../core/pipeline/score.js';
import { systemClock } from '../../core/util/clock.js';
import { reportCliError } from '../errors.js';

/**
 * `rank [--n 30] [--verdict strong] [--where portland,remote|anywhere]` (alias
 * `jobs:top`) — the ranked list with the current weights from criteria.yaml.
 * `--where` defaults to `where_default` and is a view filter only. Reconciles
 * gates/prescores/places first; no LLM calls. A `bands:` line counts every
 * scored job in that Where, including stale scores and jobs that have left
 * triage, not just the `--n` rows in the table. Columns
 * R T D S L C are the six dimensions (role, tech, domain, seniority,
 * logistics, comp), `-` where the posting doesn't say. `*` marks a stale score.
 */
export function rankCommand(options: { n?: string; verdict?: string; where?: string } = {}): void {
  const n = parseN(options.n);
  if (n === 'invalid') {
    console.error('rank FAILED\n\n--n must be a positive integer');
    process.exitCode = 1;
    return;
  }
  const verdict = options.verdict;
  if (verdict !== undefined && !(VERDICTS as readonly string[]).includes(verdict)) {
    console.error(`rank FAILED\n\n--verdict must be one of ${VERDICTS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const { key } = scoringInputs(config.criteria, config.profile, config.preferences);
    const opened = createDb();
    sqlite = opened.sqlite;
    const criteria = config.criteria;
    const where =
      options.where === undefined ? whereDefault(criteria) : parseWhere(options.where, criteria);
    reconcilePlacement(opened.db, criteria, config.preferences, systemClock);
    const all = rankedList(
      opened.db,
      systemClock,
      { weights: criteria.weights, bands: criteria.bands, current: key },
      { areas: where },
    );
    const filtered = verdict ? all.filter((row) => row.verdict === verdict) : all;
    const rows = filtered.slice(0, n);
    const whereText = whereLabel(criteria, where);
    if (rows.length === 0) {
      console.log(
        where.length > 0
          ? `no LLM-scored jobs in ${whereText} yet. Try \`--where anywhere\`, or run \`pnpm cli score\`.`
          : 'no LLM-scored jobs yet. Run `pnpm cli score` first (see `pnpm cli funnel`).',
      );
      return;
    }
    const w = criteria.weights;
    const bands = { strong: 0, maybe: 0, no: 0 };
    for (const row of all) bands[row.verdict] += 1;
    console.log(
      `weights: role ${w.role_fit} · tech ${w.tech_fit} · domain ${w.domain_interest} · seniority ${w.seniority_fit} · logistics ${w.logistics_fit} · comp ${w.comp_fit}`,
    );
    console.log(
      `where: ${whereText}${where.length > 0 ? ' (`--where anywhere` shows every job)' : ''}`,
    );
    console.log(`bands: ${bands.strong} strong · ${bands.maybe} maybe · ${bands.no} no`);
    console.log(renderTable(rows, (areas) => sortAreas(criteria, areas).join(',') || '—'));
    if (rows.some((r) => r.stale)) {
      console.log(
        '\n* stale: scored with older preferences/profile/rubric; the next `score` run that reaches it rescores it',
      );
    }
  } catch (err) {
    reportCliError('rank', err);
  } finally {
    sqlite?.close();
  }
}

function renderTable(rows: RankedRow[], areas: (areas: string[]) => string): string {
  const header = [
    '#',
    'score',
    'verdict',
    'R T D S L C',
    'company',
    'title',
    'location',
    'areas',
    'comp',
    'id',
  ];
  const body = rows.map((row, i) => [
    String(i + 1),
    `${row.score ?? '—'}${row.stale ? '*' : ''}`,
    row.verdict,
    dims(row),
    clip(row.company, 10),
    clip(row.title, 52),
    clip(location(row), 30),
    areas(row.areas),
    comp(row),
    String(row.jobId),
  ]);
  const widths = header.map((h, col) =>
    Math.max(h.length, ...body.map((cells) => (cells[col] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, col) => c.padEnd(widths[col] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

function dims(row: RankedRow): string {
  const d = row.dimensions;
  return [d.role_fit, d.tech_fit, d.domain_interest, d.seniority_fit, d.logistics_fit, d.comp_fit]
    .map((x) => (x.score === null ? '-' : String(x.score)))
    .join(' ');
}

function location(row: RankedRow): string {
  const trimmed = row.locationRaw?.trim();
  return trimmed ? `${trimmed} (${row.remoteType})` : row.remoteType;
}

function comp(row: RankedRow): string {
  if (row.compMin == null && row.compMax == null) return '—';
  const currency = row.compCurrency ? ` ${row.compCurrency}` : '';
  if (row.compMin != null && row.compMax != null) {
    return `${short(row.compMin)}–${short(row.compMax)}${currency}`;
  }
  return `${short((row.compMin ?? row.compMax) as number)}${currency}`;
}

function short(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function parseN(raw: string | undefined): number | 'invalid' {
  if (raw == null) return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 'invalid';
  return n;
}
