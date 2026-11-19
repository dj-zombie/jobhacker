'use client';

import { IndustryMark } from '@/components/jobhacker';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { setCompanyIndustry } from '../lib/actions.js';
import type { IndustryInfo } from '../lib/triage.js';

/**
 * Confirm, change, or clear the industry on the company of the open job.
 * The decision is stored on the company, so every job there follows it.
 */
export function CompanyIndustry({
  companyId,
  industryId,
  status,
  reason,
  options,
  onOptimistic,
}: {
  companyId: number;
  industryId: string | null;
  status: 'suggested' | 'confirmed' | 'cleared' | null;
  reason: string | null;
  options: IndustryInfo[];
  onOptimistic: (companyId: number, industryId: string | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const choose = (id: string | null) => {
    if (pending) return;
    setPending(true);
    onOptimistic(companyId, id);
    void setCompanyIndustry(companyId, id)
      .then((result) => {
        if (!result.ok) router.refresh();
      })
      .finally(() => setPending(false));
  };
  return (
    <IndustryMark
      options={options}
      industryId={status === 'cleared' ? null : industryId}
      status={status === 'suggested' || status === 'confirmed' ? status : null}
      reason={reason}
      disabled={pending}
      onSet={(id) => choose(id)}
      onClear={() => choose(null)}
    />
  );
}
