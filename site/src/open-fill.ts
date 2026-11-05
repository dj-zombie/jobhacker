import { toast } from '@/components/jobhacker';
import type { FillResult } from '../../ui-reference/prototype-src/src/demo/demo-hooks';
import { FILL_CHANNEL, describeFill, isFillDone } from './fill-channel';

/** A replay takes about half a minute. After this long the button gives up waiting. */
const GIVE_UP_MS = 120_000;

/**
 * Open & fill on the demo: open the sample form in a new tab, where the recorded fill
 * replays, and wait for that tab to say it finished.
 */
export function openSampleForm(appId: string, done: (result: FillResult | null) => void): void {
  const run = crypto.randomUUID();
  const tab = window.open(`/form/?app=${encodeURIComponent(appId)}&run=${run}`, '_blank');
  if (!tab) {
    done(null);
    toast('The browser blocked the new tab', {
      description: 'Allow pop-ups for this site, or open jobhacker.space/form/ yourself.',
    });
    return;
  }
  const channel = new BroadcastChannel(FILL_CHANNEL);
  const timer = window.setTimeout(() => {
    channel.close();
    done(null);
  }, GIVE_UP_MS);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isFillDone(message) || message.run !== run) return;
    window.clearTimeout(timer);
    channel.close();
    done({ title: 'Filled the sample form', description: describeFill(message) });
  };
}
