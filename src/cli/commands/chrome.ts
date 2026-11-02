import { execFileSync, spawn } from 'node:child_process';
import {
  CHROME_DEBUG_ENDPOINT,
  CHROME_USER_DATA_DIR,
  ensureAttachableTab,
  resolveChrome,
} from '../../core/apply/browser.js';
import { moveLegacyChromeProfile } from '../../core/util/rename-move.js';

function processList(): string {
  try {
    return execFileSync('ps', ['-ax', '-o', 'command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

async function debuggerIsUp(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `chrome` — launch the dedicated Chrome profile with remote debugging enabled
 * (ARCHITECTURE § Launching the dedicated Chrome profile). Recent Chrome refuses
 * remote debugging on the default profile, so apply-assist uses a separate one.
 * Kris signs in to job sites in it once; afterwards `apply` / the UI connect over
 * CDP. The process is detached so it keeps running after the CLI exits.
 */
export async function chromeCommand(): Promise<void> {
  const debuggerUp = await debuggerIsUp(CHROME_DEBUG_ENDPOINT);
  const move = moveLegacyChromeProfile({
    newDir: CHROME_USER_DATA_DIR,
    debuggerUp,
    psOutput: debuggerUp ? '' : processList(),
  });
  if (move.action === 'refused') {
    console.error(
      `chrome REFUSED: the profile hasn't moved to its JobHacker folder yet.\n\n${move.reason}`,
    );
    process.exitCode = 1;
    return;
  }
  if (move.action === 'moved') console.log(`Moved the Chrome profile: ${move.from} → ${move.to}\n`);

  if (debuggerUp) {
    // Ensure there is an attachable window; a zero-window background Chrome has
    // no browser context for apply to drive (Known issue [5]).
    const openedTab = await ensureAttachableTab(CHROME_DEBUG_ENDPOINT);
    console.log(
      [
        'Chrome is already listening for apply-assist.',
        `  endpoint: ${CHROME_DEBUG_ENDPOINT}`,
        `  profile:  ${CHROME_USER_DATA_DIR}`,
        openedTab ? '  (it had no open window, so a blank tab was opened for you)' : '',
        '',
        'Leave that window open. Then run `pnpm cli apply <jobId>` or click "Open & fill".',
        'A second Chrome with the same profile exits immediately, so do not launch another.',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    );
    return;
  }

  const bin = resolveChrome();
  if (!bin) {
    console.error(
      'chrome FAILED\n\nCould not find Google Chrome. Set JOBHACKER_CHROME_PATH to the Chrome binary.',
    );
    process.exitCode = 1;
    return;
  }

  const args = ['--remote-debugging-port=9222', `--user-data-dir=${CHROME_USER_DATA_DIR}`];
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    console.error(`chrome FAILED\n\ncould not launch Chrome: ${err.message}`);
    process.exitCode = 1;
  });
  child.unref();

  console.log(
    [
      'Launched the dedicated Chrome with remote debugging.',
      `  binary:   ${bin}`,
      `  profile:  ${CHROME_USER_DATA_DIR}`,
      `  endpoint: ${CHROME_DEBUG_ENDPOINT}`,
      '',
      'Leave this Chrome window open and sign in to the job sites once.',
      'Then run `pnpm cli apply <jobId>` or use "Open & fill" in the UI.',
    ].join('\n'),
  );
}
