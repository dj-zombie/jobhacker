import { BrandMark } from '@/components/jobhacker';
import { Button } from '@/components/ui/button';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './base.css';
import { DemoBanner } from './banner';
import { mount } from './mount';

function NotFound() {
  return (
    <div className="min-h-full bg-canvas text-fg">
      <DemoBanner page="missing" />
      <main className="mx-auto flex max-w-md flex-col items-center px-5 pt-24 pb-20 text-center">
        <BrandMark size={40} blink={false} />
        <h1 className="mt-5 font-display text-2xl">Nothing here</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-2">
          This page doesn't exist. The demo has three: the app, the sample form it fills, and a page
          about the tool.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <a href="/">Try the demo</a>
          </Button>
          <Button asChild variant="secondary">
            <a href="/about/">About JobHacker</a>
          </Button>
        </div>
      </main>
    </div>
  );
}

createRoot(mount()).render(
  <StrictMode>
    <NotFound />
  </StrictMode>,
);
