import { EmptyState } from '@/components/jobhacker';
import { TriangleAlert } from 'lucide-react';

/** A Settings route whose file doesn't load: what's wrong with it, so Kris can fix it by hand. */
export function SettingsConfigError({ file, issues }: { file: string; issues: string[] }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={`${file} has an error`}
      body={`Fix it in config/${file} and reload this page. ${issues.join(' · ')}`}
    />
  );
}
