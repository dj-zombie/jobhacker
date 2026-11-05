import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './base.css';
import { App } from '../../ui-reference/prototype-src/src/demo/App';
import { demoHooks } from '../../ui-reference/prototype-src/src/demo/demo-hooks';
import { DemoBanner } from './banner';
import { brandfetchLogos } from './brand';
import { mount } from './mount';
import { openSampleForm } from './open-fill';

demoHooks.openAndFill = openSampleForm;
demoHooks.logos = brandfetchLogos(__DEMO_BRANDFETCH_CLIENT_ID__);

createRoot(mount()).render(
  <StrictMode>
    <div className="flex h-full flex-col">
      <DemoBanner page="demo" />
      <div className="relative min-h-0 flex-1">
        <App />
      </div>
    </div>
  </StrictMode>,
);
