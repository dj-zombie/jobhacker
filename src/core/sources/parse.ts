import type { ZodError, ZodType } from 'zod';
import { BoardParseError, type ParsedBoard } from './types.js';

/**
 * Validate each posting independently. Unknown extra fields are the schema's
 * concern (passthrough). A posting that fails validation is skipped with a
 * reason. If every posting fails, throw so the caller does not close jobs.
 */
export function collectPostings<T>(
  ats: string,
  items: unknown[],
  schema: ZodType<T>,
  accept: (posting: T) => boolean = () => true,
): ParsedBoard<T> {
  const postings: T[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const parsed = schema.safeParse(items[i]);
    if (!parsed.success) {
      skipped.push(`skipped posting ${i}: ${formatIssues(parsed.error)}`);
      continue;
    }
    if (!accept(parsed.data)) continue;
    postings.push(parsed.data);
  }

  if (items.length > 0 && postings.length === 0 && skipped.length === items.length) {
    throw new BoardParseError(
      `${ats} board returned ${items.length} postings but none could be parsed (${skipped[0] ?? 'unknown reason'})`,
    );
  }

  return { postings, skipped };
}

export function boardError(ats: string, error: ZodError): BoardParseError {
  return new BoardParseError(`${ats} board payload: ${formatIssues(error)}`);
}

function formatIssues(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
