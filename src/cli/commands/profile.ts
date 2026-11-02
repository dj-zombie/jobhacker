import {
  type BuildProfileOptions,
  buildProfileDraft,
  checkProfileFiles,
} from '../../core/ingest/merge.js';
import { IngestError } from '../../core/ingest/types.js';

export interface ProfileBuildCliOptions {
  inputDir?: string;
  configDir?: string;
  resume?: string;
  linkedin?: string;
  force?: boolean;
}

/** `profile:build` — local-only resume + LinkedIn archive → sourced draft profile. */
export async function profileBuildCommand(options: ProfileBuildCliOptions = {}): Promise<void> {
  try {
    const buildOptions: BuildProfileOptions = {
      inputDir: options.inputDir,
      configDir: options.configDir,
      resumeFile: options.resume,
      linkedinDir: options.linkedin,
      force: options.force,
    };
    const result = await buildProfileDraft(buildOptions);
    console.log('profile draft built (local-only; profile.yaml was not overwritten)');
    console.log(`  draft:         ${result.profileFile}`);
    console.log(`  source report: ${result.sourceReportFile}`);
    console.log(`  input files:   ${result.report.inputs.length}`);
    console.log(`  bullets:       ${result.report.bullets.length}`);
    console.log(`  warnings:      ${result.report.warnings.length}`);
    console.log(
      'Review every claim, run `pnpm cli profile:check`, then rename the draft yourself.',
    );
  } catch (err) {
    reportProfileError('profile:build', err);
  }
}

export interface ProfileCheckCliOptions {
  profile?: string;
  sources?: string;
}

/** `profile:check` — source/provenance and unresolved-conflict report. */
export function profileCheckCommand(options: ProfileCheckCliOptions = {}): void {
  try {
    const profileFile = options.profile ?? 'config/profile.draft.yaml';
    const sourcesFile = options.sources ?? 'config/profile.draft.sources.yaml';
    const result = checkProfileFiles(profileFile, sourcesFile);
    const status = !result.ready
      ? 'NEEDS REVIEW'
      : result.needsInput.length > 0
        ? 'SOURCES OK; NEEDS INPUT REMAINS'
        : 'OK';
    console.log(`profile check: ${status}`);
    console.log(`  bullets:              ${result.bulletCount}`);
    console.log(`  unsourced bullets:    ${result.unsourcedBulletIds.length}`);
    console.log(`  changed/paraphrased:  ${result.paraphrasedBulletIds.length}`);
    console.log(`  skills allowlist:     ${result.skillAllowlistSize}`);
    console.log(`  NEEDS INPUT markers:  ${result.needsInput.length}`);
    console.log(`  unresolved conflicts: ${result.unresolvedConflicts.length}`);
    console.log(`  source file errors:   ${result.inputErrors.length}`);
    console.log(`  missing archive files: ${result.archiveWarnings.length} (warning only)`);
    if (result.unsourcedBulletIds.length > 0) {
      console.log(`  unsourced ids:        ${result.unsourcedBulletIds.join(', ')}`);
    }
    if (result.paraphrasedBulletIds.length > 0) {
      console.log(`  changed ids:           ${result.paraphrasedBulletIds.join(', ')}`);
    }
    for (const error of result.inputErrors) console.log(`  source error:          ${error}`);
    for (const warning of result.archiveWarnings)
      console.log(`  archive warning:       ${warning}`);
    if (!result.ready) process.exitCode = 1;
  } catch (err) {
    reportProfileError('profile:check', err);
  }
}

function reportProfileError(command: string, err: unknown): void {
  if (err instanceof IngestError) {
    console.error(`${command} FAILED\n\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  throw err;
}
