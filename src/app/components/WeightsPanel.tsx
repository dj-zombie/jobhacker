'use client';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { DIMENSIONS, type Dimension, type Weights } from '../../core/config/schemas.js';
import { saveWeightsAction } from '../lib/actions.js';
import { DIMENSION_LABELS, encodeWeights, sameWeights } from '../lib/format.js';

/**
 * Weight sliders (FR-6). Moving one rewrites `?w=` and the server re-ranks the
 * stored dimension scores; no LLM is involved. "Save" writes the weights to
 * criteria.yaml (comments kept) so the CLI and later runs use them too.
 */
export function WeightsPanel({ saved, current }: { saved: Weights; current: Weights }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [weights, setWeights] = useState<Weights>(current);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentKey = encodeWeights(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the URL's weights change
  useEffect(() => {
    setWeights(current);
  }, [currentKey]);

  function navigate(next: Weights) {
    const params = new URLSearchParams(searchParams.toString());
    if (sameWeights(next, saved)) params.delete('w');
    else params.set('w', encodeWeights(next));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onChange(dimension: Dimension, value: number) {
    const next = { ...weights, [dimension]: value };
    setWeights(next);
    setMessage(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate(next), 200);
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveWeightsAction(weights);
      if (!result.ok) {
        setMessage(result.error ?? 'save failed');
        return;
      }
      setMessage('Saved to criteria.yaml.');
      const params = new URLSearchParams(searchParams.toString());
      params.delete('w');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      router.refresh();
    });
  }

  const dirty = !sameWeights(weights, saved);

  return (
    <section className="surface-card mb-4 rounded-xl p-4" data-testid="weights-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-2">
          Weights <span className="text-fg-3">· re-rank locally, no model calls</span>
        </span>
        <span className="flex items-center gap-2">
          {message ? <span className="text-xs text-fg-3">{message}</span> : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || pending}
            onClick={() => {
              setWeights(saved);
              navigate(saved);
            }}
          >
            Reset
          </Button>
          <Button variant="secondary" size="sm" disabled={!dirty || pending} onClick={onSave}>
            {pending ? 'Saving…' : 'Save to criteria.yaml'}
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {DIMENSIONS.map((d) => (
          <label key={d} className="flex flex-col gap-1.5 text-xs text-fg-3">
            <span className="flex justify-between">
              <span>{DIMENSION_LABELS[d]}</span>
              <span className="tnum font-medium text-fg">{weights[d]}</span>
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={weights[d]}
              aria-label={`${DIMENSION_LABELS[d]} weight`}
              onChange={(e) => onChange(d, Number(e.target.value))}
              className="h-1.5 w-full accent-brand"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
