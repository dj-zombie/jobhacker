import type { Browser } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { BrowserError, chromeCandidates, connectChrome } from './browser.js';

describe('chromeCandidates', () => {
  it('looks in the standard install folders on Windows', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    };
    expect(chromeCandidates('win32', env)).toEqual([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    ]);
  });

  it('skips a Windows folder whose variable is unset', () => {
    expect(chromeCandidates('win32', { ProgramFiles: 'C:\\Program Files' })).toEqual([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]);
  });

  it('looks for Chrome and Chromium on Linux', () => {
    expect(chromeCandidates('linux', {})).toContain('/usr/bin/google-chrome');
    expect(chromeCandidates('linux', {})).toContain('/usr/bin/chromium');
  });

  it('keeps the macOS app bundles first on a Mac', () => {
    expect(chromeCandidates('darwin', {})[0]).toBe(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
  });
});

/**
 * connectChrome's recovery path (STATUS Round 5 verify, Bug A): when the
 * dedicated Chrome is reachable but has no open window, its default browser
 * context is gone and the first `connectOverCDP` fails. connectChrome must open
 * a tab to restore the context and retry once, rather than reporting "Chrome
 * isn't running". These tests inject the three side-effecting deps.
 */

const fakeBrowser = {} as Browser;
const endpoint = 'http://127.0.0.1:9222';

describe('connectChrome', () => {
  it('throws a launch-command error when Chrome is not reachable', async () => {
    const connectOverCDP = vi.fn();
    await expect(
      connectChrome(endpoint, {
        reachable: async () => false,
        connectOverCDP,
        openBlankTab: async () => {},
      }),
    ).rejects.toThrow(/pnpm cli chrome/);
    expect(connectOverCDP).not.toHaveBeenCalled();
  });

  it('returns the browser when the first connect succeeds', async () => {
    const openBlankTab = vi.fn(async () => {});
    const browser = await connectChrome(endpoint, {
      reachable: async () => true,
      connectOverCDP: async () => fakeBrowser,
      openBlankTab,
    });
    expect(browser).toBe(fakeBrowser);
    expect(openBlankTab).not.toHaveBeenCalled();
  });

  it('opens a tab and retries when the first connect fails (no-window case)', async () => {
    const connectOverCDP = vi
      .fn<(e: string) => Promise<Browser>>()
      .mockRejectedValueOnce(new Error('Browser context management is not supported'))
      .mockResolvedValueOnce(fakeBrowser);
    const openBlankTab = vi.fn(async () => {});

    const browser = await connectChrome(endpoint, {
      reachable: async () => true,
      connectOverCDP,
      openBlankTab,
    });

    expect(browser).toBe(fakeBrowser);
    expect(openBlankTab).toHaveBeenCalledOnce();
    expect(connectOverCDP).toHaveBeenCalledTimes(2);
  });

  it('reports an attach failure (not "Chrome not running") when both connects fail', async () => {
    const connectOverCDP = vi.fn(async () => {
      throw new Error('Browser context management is not supported');
    });
    let thrown: unknown;
    try {
      await connectChrome(endpoint, {
        reachable: async () => true,
        connectOverCDP,
        openBlankTab: async () => {},
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BrowserError);
    expect((thrown as Error).message).toMatch(/no open window/i);
    expect((thrown as Error).message).not.toMatch(/Could not connect to Chrome/);
  });
});
