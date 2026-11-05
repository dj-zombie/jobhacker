/**
 * J18 acceptance 4: run the Settings writers against a temporary copy of a config folder and
 * print hashes and line counts only, never a value.
 *
 *   pnpm exec tsx scripts/profile-roundtrip.ts [configDir]
 *
 * Every section is saved with its current value (the sha256 must not change), then one link is
 * changed on the copy and the copy's path is printed so `diff | grep -c '^[<>]'` can be run on it.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile, loadPreferences } from '../src/core/config/load.js';
import { savePreferences } from '../src/core/config/preferences-file.js';
import { saveProfileSection } from '../src/core/config/profile-file.js';
import { PROFILE_SECTIONS, toSectionInputs } from '../src/core/config/profile-sections.js';
import { profileSchema } from '../src/core/config/schemas.js';
import { systemClock } from '../src/core/util/clock.js';

const source = process.argv[2] ?? 'config';
const root = mkdtempSync(join(tmpdir(), 'jh-roundtrip-'));
const dir = join(root, 'config');
cpSync(source, dir, { recursive: true });
const deps = { clock: systemClock, backupDir: join(root, 'backups') };

const sha = (file: string) =>
  createHash('sha256')
    .update(readFileSync(join(dir, file)))
    .digest('hex')
    .slice(0, 12);

const before = { profile: sha('profile.yaml'), preferences: sha('preferences.md') };
const inputs = toSectionInputs(loadConfigFile('profile', profileSchema, dir));
for (const section of PROFILE_SECTIONS) {
  const result = saveProfileSection(dir, section, inputs[section], deps);
  console.log(`${section.padEnd(20)} changed=${result.changed} sha=${sha('profile.yaml')}`);
}
const prefs = savePreferences(dir, loadPreferences(dir), deps);
console.log(`${'preferences'.padEnd(20)} changed=${prefs.changed} sha=${sha('preferences.md')}`);
console.log(
  `profile.yaml ${before.profile} → ${sha('profile.yaml')} ${before.profile === sha('profile.yaml') ? 'unchanged' : 'CHANGED'}`,
);
console.log(
  `preferences.md ${before.preferences} → ${sha('preferences.md')} ${before.preferences === sha('preferences.md') ? 'unchanged' : 'CHANGED'}`,
);

const links = inputs.links;
const key = (['github', 'linkedin', 'portfolio'] as const).find((k) => links[k] !== '');
if (key) {
  saveProfileSection(
    dir,
    'links',
    { ...links, [key]: `${links[key].replace(/\/$/, '')}/edited` },
    deps,
  );
  console.log(`changed links.${key} on the copy`);
} else {
  saveProfileSection(dir, 'links', { ...links, github: 'https://github.com/edited' }, deps);
  console.log('added links.github on the copy');
}
console.log(`copy: ${join(dir, 'profile.yaml')}`);
