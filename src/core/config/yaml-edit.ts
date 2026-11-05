import {
  type Document,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  parse as parseYaml,
  stringify,
} from 'yaml';

/**
 * Line-preserving edits to a YAML file (J18). `editYamlText` compares the parsed file with
 * `next`, the whole document as it should be, and splices only the text that differs:
 * - a changed scalar keeps its line, its quoting and any comment after it
 * - a renamed key keeps its line
 * - a removed entry loses its lines, and an added one is appended after the last entry
 * - anything it can't edit that way is re-rendered at the smallest entry that holds it
 *
 * The result is parsed back and must equal `next`, or it returns null and the caller
 * decides. yaml's `Document.toString()` re-folds every line longer than 80 characters, so on
 * a file of long lines it would rewrite most of the file for a one-line edit.
 */
export function editYamlText(original: string, next: unknown): string | null {
  const doc = parseDocument(original);
  if (doc.errors.length > 0 || !doc.contents) return null;
  const ctx: Ctx = {
    doc,
    text: original,
    indent: detectIndent(original),
    indentSeq: detectIndentSeq(original),
    parentCol: -1,
    inFlow: false,
  };
  let splices: Splice[];
  try {
    splices = diffValue(ctx, doc.contents, next);
  } catch (err) {
    if (err instanceof Rerender) return null;
    throw err;
  }
  const out = applySplices(original, splices);
  if (out === null) return null;
  return sameYaml(out, next) ? out : null;
}

/** True when `text` parses without errors to exactly `value`, key order included. */
export function sameYaml(text: string, value: unknown): boolean {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return false;
  return JSON.stringify(doc.toJS()) === JSON.stringify(value);
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

interface Ctx {
  doc: Document;
  text: string;
  indent: number;
  indentSeq: boolean;
  /** The column of the collection this node sits in, or -1 at the root. */
  parentCol: number;
  inFlow: boolean;
}

/** This node can't be edited in place; the entry that holds it is re-rendered instead. */
class Rerender extends Error {}

function diffValue(ctx: Ctx, node: Node | null | undefined, next: unknown): Splice[] {
  const prev = node ? node.toJS(ctx.doc) : null;
  if (JSON.stringify(prev) === JSON.stringify(next)) return [];
  if (!node || !node.range) throw new Rerender();
  if (isScalar(node) && isScalarValue(next)) return [scalarSplice(ctx, node, next)];
  if (isMap(node) && !node.flow && isPlainObject(next)) return diffMap(ctx, node, next);
  if (isSeq(node) && !node.flow && Array.isArray(next)) return diffSeq(ctx, node, next);
  if ((isMap(node) || isSeq(node)) && node.flow) {
    const flow = renderFlow(next);
    if (flow !== null) return [{ start: node.range[0], end: node.range[1], text: flow }];
  }
  throw new Rerender();
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

function diffMap(ctx: Ctx, map: YAMLMap, next: Record<string, unknown>): Splice[] {
  const range = map.range;
  if (!range) throw new Rerender();
  const col = column(ctx.text, range[0]);
  const pairs = map.items;
  const oldKeys = pairs.map(keyOf);
  const newKeys = Object.keys(next);
  if (oldKeys.some((k) => k === null)) throw new Rerender();
  const keys = oldKeys as string[];
  if (newKeys.length === 0) throw new Rerender();

  const renamesOnly =
    keys.length === newKeys.length &&
    keys.every(
      (k, i) => k === newKeys[i] || (!newKeys.includes(k) && !keys.includes(newKeys[i] ?? '')),
    );
  const splices: Splice[] = [];
  if (renamesOnly) {
    pairs.forEach((pair, i) => {
      const key = newKeys[i] as string;
      if (keys[i] !== key) {
        if (!isScalar(pair.key) || !pair.key.range) throw new Rerender();
        splices.push(scalarSplice({ ...ctx, parentCol: col }, pair.key, key));
      }
      splices.push(...childOfPair(ctx, pair, key, next[key], col));
    });
    return splices;
  }

  const kept = keys.filter((k) => newKeys.includes(k));
  const keptInNew = newKeys.filter((k) => keys.includes(k));
  const orderKept =
    kept.every((k, i) => keptInNew[i] === k) &&
    newKeys.slice(0, keptInNew.length).every((k, i) => k === keptInNew[i]);
  if (!orderKept) return [rerenderInPlace(ctx, map, next, col)];

  for (const [i, pair] of pairs.entries()) {
    const key = keys[i] as string;
    if (!newKeys.includes(key)) {
      const removed = deletePairLines(ctx, pair);
      if (!removed) return [rerenderInPlace(ctx, map, next, col)];
      splices.push(removed);
    } else {
      splices.push(...childOfPair(ctx, pair, key, next[key], col));
    }
  }
  const added = newKeys.filter((k) => !keys.includes(k));
  if (added.length > 0) {
    const last = pairs[pairs.length - 1];
    if (!last) throw new Rerender();
    const at = lineEnd(ctx.text, pairEnd(last));
    const lead = at > 0 && ctx.text[at - 1] !== '\n' ? '\n' : '';
    const block = Object.fromEntries(added.map((k) => [k, next[k]]));
    splices.push({ start: at, end: at, text: lead + indentLines(render(ctx, block), col, true) });
  }
  return splices;
}

function keyOf(pair: Pair): string | null {
  if (isScalar(pair.key) && typeof pair.key.value === 'string') return pair.key.value;
  return null;
}

function childOfPair(ctx: Ctx, pair: Pair, key: string, value: unknown, col: number): Splice[] {
  try {
    return diffValue({ ...ctx, parentCol: col, inFlow: false }, pair.value as Node | null, value);
  } catch (err) {
    if (!(err instanceof Rerender)) throw err;
    return [rerenderPair(ctx, pair, key, value, col)];
  }
}

/** Replace `key: value` through the end of its last line. */
function rerenderPair(ctx: Ctx, pair: Pair, key: string, value: unknown, col: number): Splice {
  if (!isScalar(pair.key) || !pair.key.range) throw new Rerender();
  const start = pair.key.range[0];
  const end = lineEnd(ctx.text, pairEnd(pair));
  return { start, end, text: indentLines(render(ctx, { [key]: value }), col, false) };
}

function pairEnd(pair: Pair): number {
  const value = pair.value as Node | null;
  if (value?.range) return value.range[1];
  if (isScalar(pair.key) && pair.key.range) return pair.key.range[1];
  throw new Rerender();
}

function deletePairLines(ctx: Ctx, pair: Pair): Splice | null {
  if (!isScalar(pair.key) || !pair.key.range) return null;
  const keyStart = pair.key.range[0];
  const start = lineStart(ctx.text, keyStart);
  if (ctx.text.slice(start, keyStart).trim() !== '') return null;
  return { start, end: lineEnd(ctx.text, pairEnd(pair)), text: '' };
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

function diffSeq(ctx: Ctx, seq: YAMLSeq, next: unknown[]): Splice[] {
  const range = seq.range;
  if (!range) throw new Rerender();
  if (next.length === 0) throw new Rerender();
  const col = column(ctx.text, range[0]);
  const items = seq.items as (Node | null)[];
  const old = items.map((item) => (item ? item.toJS(ctx.doc) : null));
  const splices: Splice[] = [];

  const ids = (values: unknown[]): (string | null)[] =>
    values.map((v) => (isPlainObject(v) && typeof v.id === 'string' ? v.id : null));
  const oldIds = ids(old);
  const newIds = ids(next);
  const byId =
    old.length !== next.length &&
    oldIds.every((id) => id !== null) &&
    newIds.every((id) => id !== null) &&
    new Set(oldIds).size === oldIds.length &&
    new Set(newIds).size === newIds.length;

  if (byId) {
    const kept = oldIds.filter((id) => newIds.includes(id));
    const keptInNew = newIds.filter((id) => oldIds.includes(id));
    const ordered =
      kept.every((id, i) => keptInNew[i] === id) &&
      newIds.slice(0, keptInNew.length).every((id, i) => id === keptInNew[i]);
    if (!ordered) return [rerenderInPlace(ctx, seq, next, col)];
    for (const [i, item] of items.entries()) {
      const id = oldIds[i];
      const at = id === undefined ? -1 : newIds.indexOf(id);
      if (at === -1) {
        const removed = deleteItemLines(ctx, item);
        if (!removed) return [rerenderInPlace(ctx, seq, next, col)];
        splices.push(removed);
      } else {
        splices.push(...childOfSeq(ctx, item, next[at], col));
      }
    }
    const added = next.filter((_, i) => {
      const id = newIds[i];
      return id !== undefined && !oldIds.includes(id);
    });
    if (added.length > 0) splices.push(appendItems(ctx, items, added, col));
    return splices;
  }

  const common = Math.min(old.length, next.length);
  for (let i = 0; i < common; i++) splices.push(...childOfSeq(ctx, items[i] ?? null, next[i], col));
  for (let i = common; i < items.length; i++) {
    const removed = deleteItemLines(ctx, items[i] ?? null);
    if (!removed) return [rerenderInPlace(ctx, seq, next, col)];
    splices.push(removed);
  }
  if (next.length > old.length) splices.push(appendItems(ctx, items, next.slice(common), col));
  return splices;
}

function childOfSeq(ctx: Ctx, item: Node | null, value: unknown, col: number): Splice[] {
  try {
    return diffValue({ ...ctx, parentCol: col, inFlow: false }, item, value);
  } catch (err) {
    if (!(err instanceof Rerender)) throw err;
    return [rerenderItem(ctx, item, value, col)];
  }
}

/** The `-` that starts an item, when it's on the item's first line. */
function dashOf(ctx: Ctx, item: Node | null): number | null {
  if (!item?.range) return null;
  const dash = ctx.text.lastIndexOf('-', item.range[0] - 1);
  if (dash < 0 || ctx.text.slice(dash + 1, item.range[0]).trim() !== '') return null;
  return dash;
}

function rerenderItem(ctx: Ctx, item: Node | null, value: unknown, col: number): Splice {
  const dash = dashOf(ctx, item);
  if (dash === null || !item?.range) throw new Rerender();
  return {
    start: dash,
    end: lineEnd(ctx.text, item.range[1]),
    text: indentLines(render(ctx, [value]), col, false),
  };
}

function deleteItemLines(ctx: Ctx, item: Node | null): Splice | null {
  const dash = dashOf(ctx, item);
  if (dash === null || !item?.range) return null;
  const start = lineStart(ctx.text, dash);
  if (ctx.text.slice(start, dash).trim() !== '') return null;
  return { start, end: lineEnd(ctx.text, item.range[1]), text: '' };
}

function appendItems(ctx: Ctx, items: (Node | null)[], added: unknown[], col: number): Splice {
  const last = items[items.length - 1];
  if (!last?.range) throw new Rerender();
  const at = lineEnd(ctx.text, last.range[1]);
  const lead = at > 0 && ctx.text[at - 1] !== '\n' ? '\n' : '';
  return { start: at, end: at, text: lead + indentLines(render(ctx, added), col, true) };
}

// ---------------------------------------------------------------------------
// Re-rendering
// ---------------------------------------------------------------------------

/** Replace a block collection's own lines, from its first entry to its end. */
function rerenderInPlace(ctx: Ctx, node: Node, value: unknown, col: number): Splice {
  if (!node.range) throw new Rerender();
  if (
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  ) {
    throw new Rerender();
  }
  return {
    start: node.range[0],
    end: lineEnd(ctx.text, node.range[1]),
    text: indentLines(render(ctx, value), col, false),
  };
}

function render(ctx: Ctx, value: unknown): string {
  return stringify(value, {
    indent: ctx.indent,
    indentSeq: ctx.indentSeq,
    lineWidth: 0,
    minContentWidth: 0,
  });
}

/** A flow list or map of scalars on one line, or null when `value` isn't one. */
function renderFlow(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (!value.every(isScalarValue)) return null;
    return `[${value.map((v) => flowScalar(v)).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const scalars = entries.filter((entry): entry is [string, ScalarValue] =>
      isScalarValue(entry[1]),
    );
    if (scalars.length !== entries.length) return null;
    if (scalars.length === 0) return '{}';
    return `{ ${scalars.map(([k, v]) => `${flowScalar(k)}: ${flowScalar(v)}`).join(', ')} }`;
  }
  return null;
}

function flowScalar(value: ScalarValue): string {
  if (typeof value !== 'string') return value === null ? 'null' : String(value);
  return plainSafe(value, true) ? value : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

type ScalarValue = string | number | boolean | null;

function isScalarValue(value: unknown): value is ScalarValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function scalarSplice(ctx: Ctx, node: Scalar, value: ScalarValue): Splice {
  const range = node.range;
  if (!range) throw new Rerender();
  const block = node.type === 'BLOCK_FOLDED' || node.type === 'BLOCK_LITERAL';
  if (typeof value !== 'string') {
    const text = value === null ? 'null' : String(value);
    return { start: range[0], end: range[1], text: block ? `${text}\n` : text };
  }
  if (block) {
    const text = renderBlockScalar(ctx, node, value) ?? `${JSON.stringify(value)}\n`;
    return { start: range[0], end: range[1], text };
  }
  if (value.replace(/\n$/, '').includes('\n') && !ctx.inFlow && ctx.parentCol >= 0) {
    const literal = literalBlock(value, ctx.parentCol + ctx.indent);
    if (literal) return { start: range[0], end: lineEnd(ctx.text, range[1]), text: literal };
  }
  if (value.includes('\n')) return { start: range[0], end: range[1], text: JSON.stringify(value) };
  switch (node.type) {
    case 'QUOTE_DOUBLE':
      return { start: range[0], end: range[1], text: JSON.stringify(value) };
    case 'QUOTE_SINGLE':
      return { start: range[0], end: range[1], text: `'${value.replaceAll("'", "''")}'` };
    default:
      return {
        start: range[0],
        end: range[1],
        text: plainSafe(value, ctx.inFlow) ? value : JSON.stringify(value),
      };
  }
}

/** A block scalar in its original style (`>` or `|`), at its original indentation. */
function renderBlockScalar(ctx: Ctx, node: Scalar, value: string): string | null {
  const range = node.range;
  if (!range) return null;
  const headerEnd = ctx.text.indexOf('\n', range[0]);
  if (headerEnd < 0) return null;
  const body = ctx.text.slice(headerEnd + 1, range[1]);
  const firstLine = body.split('\n').find((line) => line.trim() !== '');
  const indent = firstLine
    ? firstLine.length - firstLine.trimStart().length
    : Math.max(ctx.parentCol, 0) + ctx.indent;
  const folded = node.type === 'BLOCK_FOLDED';
  const core = value.replace(/\n$/, '');
  if (folded && !core.includes('\n')) {
    const chomp = chompOf(value);
    if (chomp === null || core === '' || /^\s/.test(core)) return null;
    return `>${chomp}\n${' '.repeat(indent)}${core}\n`;
  }
  return literalBlock(value, indent);
}

/** `|` with its chomping indicator, every line at `indent`. Null when that can't hold `value`. */
function literalBlock(value: string, indent: number): string | null {
  const chomp = chompOf(value);
  const core = value.replace(/\n$/, '');
  if (chomp === null || core === '' || /^\s/.test(core)) return null;
  const lines = core.split('\n').map((line) => (line === '' ? '' : `${' '.repeat(indent)}${line}`));
  return `|${chomp}\n${lines.join('\n')}\n`;
}

/** The chomping indicator that keeps `value`'s trailing newline: one kept, none stripped. */
function chompOf(value: string): '' | '-' | null {
  if (value.endsWith('\n\n')) return null;
  return value.endsWith('\n') ? '' : '-';
}

/** Whether `value` reads back as the same string when written without quotes. */
function plainSafe(value: string, inFlow: boolean): boolean {
  if (value === '' || value !== value.trim() || /[\n\r\t]/.test(value)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
  if (value.includes(': ') || value.includes(' #') || value.endsWith(':')) return false;
  if (inFlow && /[,[\]{}]/.test(value)) return false;
  try {
    const back = parseYaml(`k: ${value}`) as { k?: unknown } | null;
    return back?.k === value;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function applySplices(text: string, splices: Splice[]): string | null {
  const sorted = [...splices].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const s of sorted) {
    if (s.end > floor) return null;
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
    floor = s.start;
  }
  return out;
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

/** The start of the line after the one `pos` is on, or `pos` when it already starts a line. */
function lineEnd(text: string, pos: number): number {
  if (pos > 0 && text[pos - 1] === '\n') return pos;
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i + 1;
}

function column(text: string, pos: number): number {
  return pos - lineStart(text, pos);
}

/** Indent every non-empty line after the first by `col`, and the first too when `first`. */
function indentLines(rendered: string, col: number, first: boolean): string {
  const pad = ' '.repeat(col);
  const lines = rendered.replace(/\n$/, '').split('\n');
  return `${lines
    .map((line, i) => (line === '' || (i === 0 && !first) ? line : pad + line))
    .join('\n')}\n`;
}

function detectIndent(text: string): number {
  const match = /^[^\s#][^\n]*:[ \t]*\n( +)\S/m.exec(text);
  const width = match?.[1]?.length ?? 2;
  return width >= 1 && width <= 8 ? width : 2;
}

/** False when a block list's `-` sits at its key's column (`key:\n- a`). */
function detectIndentSeq(text: string): boolean {
  const match = /^( *)[^\s#-][^\n]*:[ \t]*\n( *)- /m.exec(text);
  if (!match) return true;
  return (match[2]?.length ?? 0) > (match[1]?.length ?? 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
