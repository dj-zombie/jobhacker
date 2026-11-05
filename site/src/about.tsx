import { BrandMark } from '@/components/jobhacker';
import { Button } from '@/components/ui/button';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './base.css';
import { DemoBanner } from './banner';
import { REPO_URL, SITE_URL } from './links';
import { mount } from './mount';

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-8">
      <h2 className="font-display text-lg text-fg">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-fg-2">{children}</div>
    </section>
  );
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-[0.55rem] size-1.5 shrink-0 bg-brand-hi" />
      <span>
        <span className="text-fg">{title}</span> {children}
      </span>
    </li>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-sm border border-line-2 bg-surface-3 px-1 font-mono text-[0.85em] text-fg">
    {children}
  </kbd>
);

function About() {
  return (
    <div className="min-h-full bg-canvas text-fg">
      <DemoBanner page="about" />
      <main className="mx-auto max-w-2xl px-5 pt-12 pb-20">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <h1 className="font-display text-3xl tracking-tight">JobHacker</h1>
        </div>
        <p className="mt-5 text-base leading-relaxed text-fg-2">
          A personal job-search tool that runs on your own computer. It pulls postings from hundreds
          of company job boards, ranks them against what you want, prepares each application from
          your real history, and fills the form in your own Chrome. You review the form and click
          submit.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild>
            <a href="/">
              Try the demo
              <ArrowRight />
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href={REPO_URL}>
              Source on GitHub
              <ArrowUpRight />
            </a>
          </Button>
        </div>

        <Section title="What you can try here">
          <ul className="space-y-2">
            <Item title="Triage.">
              Work through ranked jobs from the keyboard: <Key>J</Key> and <Key>K</Key> to move,{' '}
              <Key>S</Key> to shortlist, <Key>X</Key> to skip, and <Key>?</Key> for every shortcut.
            </Item>
            <Item title="Tune.">Move the six ranking weights and watch the list re-rank.</Item>
            <Item title="Apply.">
              Open a prepared application and press Open &amp; fill. A sample form opens in a new
              tab and replays a recorded run of the real filler: what it filled from the profile,
              what it drafted for you to review (amber), and what it left blank for you (red).
            </Item>
            <Item title="Settings.">
              The candidate's profile, standard answers and preferences.
            </Item>
          </ul>
          <p>
            The candidate, Kris Tester, is made up. The companies are real names used as sample
            data; the jobs, scores and applications are not theirs, and JobHacker isn't affiliated
            with any of them. Everything runs in your browser. Nothing is saved, and the demo sends
            nothing anywhere.
          </p>
        </Section>

        <Section title="What it never does">
          <ul className="space-y-2">
            <Item title="Submit.">
              The filler has no way to click submit, apply or send, and a guard test fails if its
              code tries. You click submit.
            </Item>
            <Item title="Scrape.">
              Jobs come from public job-board JSON feeds and from licensed search APIs called with
              your own key, never from a site's HTML. It never hides what it is.
            </Item>
            <Item title="Make things up.">
              Every tailored resume bullet points back to a bullet you wrote. Anything it doesn't
              know stays a marked blank for you to fill.
            </Item>
            <Item title="Guess who you are.">
              Voluntary self-identification answers come only from your profile, exactly as you
              wrote them. The model never sees those fields.
            </Item>
          </ul>
        </Section>

        <Section title="Install it">
          <p>
            It needs Node.js 22 or later, pnpm, Google Chrome, and an Anthropic API key for scoring
            and tailoring. Clone the repo and follow its README:
          </p>
          <pre className="overflow-x-auto rounded-md border border-line bg-surface-1 px-4 py-3 font-mono text-xs leading-relaxed text-fg">
            {`git clone ${REPO_URL}.git\ncd jobhacker\npnpm install`}
          </pre>
          <p>
            Your profile, your database and everything it writes stay on your computer. The only
            personal data that leaves it is what scoring and tailoring send to the model, with your
            key.
          </p>
        </Section>

        <Section id="operators" title="For job-board operators">
          <p>
            Each copy of JobHacker is one person looking for work. It identifies itself as{' '}
            <code className="font-mono text-xs text-fg">
              JobHacker/&lt;version&gt; (personal job search tool; +{SITE_URL})
            </code>{' '}
            and:
          </p>
          <ul className="space-y-2">
            <Item title="Reads only public data.">
              Public job-board JSON endpoints and licensed APIs, never page HTML.
            </Item>
            <Item title="Goes slowly.">
              At most one request per second to any host. It retries a 429 or 5xx at most three
              times, and waits as long as Retry-After asks.
            </Item>
            <Item title="Never applies on its own.">
              It fills a form in the person's own browser, and they decide whether to submit it.
            </Item>
          </ul>
          <p>
            Questions or concerns:{' '}
            <a
              className="text-brand-hi underline-offset-2 hover:underline"
              href={`${REPO_URL}/issues`}
            >
              open an issue on GitHub
            </a>
            .
          </p>
        </Section>

        <footer className="mt-16 border-t border-line pt-5 text-xs text-fg-3">
          JobHacker is open source under the MIT License.
        </footer>
      </main>
    </div>
  );
}

createRoot(mount()).render(
  <StrictMode>
    <About />
  </StrictMode>,
);
