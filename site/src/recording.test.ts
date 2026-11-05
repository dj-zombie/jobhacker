import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { profileSchema } from '../../src/core/config/schemas.js';
import { recordingSchema } from './recording.js';

/**
 * The committed recording (site/src/fill-recording.json) is the real filler's run on the
 * current sample form, as the fictional demo candidate. Re-record with `pnpm demo:record`.
 */

const SITE = join(process.cwd(), 'site');
const form = readFileSync(join(SITE, 'form/sample-form.html'), 'utf8');
const recording = recordingSchema.parse(
  JSON.parse(readFileSync(join(SITE, 'src/fill-recording.json'), 'utf8')),
);
const profile = profileSchema.parse(
  parseYaml(readFileSync(join(SITE, 'demo-profile.yaml'), 'utf8')),
);

describe('demo fill recording', () => {
  it('was recorded on the current sample form', () => {
    const sha = createHash('sha256').update(form).digest('hex');
    expect(recording.formSha256, 'sample-form.html changed: run pnpm demo:record').toBe(sha);
  });

  it('submitted nothing', () => {
    expect(recording.submits).toBe(0);
  });

  it('every step is a control on the form, once, in form order', () => {
    const ids = [...form.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map(
      (m) => m[1] ?? '',
    );
    const stepIds = recording.steps.map((s) => s.id);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    for (const id of stepIds) expect(ids).toContain(id);
    expect(stepIds).toEqual(ids.filter((id) => stepIds.includes(id)));
  });

  it('the report counts match its rows, and the outlines match the report', () => {
    const { report, steps } = recording;
    const count = (state: string) => report.fields.filter((f) => f.state === state).length;
    expect([count('filled'), count('review'), count('blank')]).toEqual([
      report.filled,
      report.review,
      report.blank,
    ]);
    expect(steps.filter((s) => s.mark === 'review').length).toBe(report.review);
    expect(steps.filter((s) => s.mark === 'blank').length).toBe(report.requiredBlank);
  });

  it('is the fictional candidate, and self-identification declines as the profile says', () => {
    expect(profile.contact.name).toBe('Kris Tester');
    expect(profile.contact.email).toMatch(/@example\.com$/);
    const selfId = recording.report.fields.filter((f) => f.source === 'self-id');
    expect(selfId.length).toBeGreaterThan(0);
    for (const f of selfId) expect(f.value).toMatch(/decline|don't wish/i);
  });
});
