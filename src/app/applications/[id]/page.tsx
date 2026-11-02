import { EmptyState, PageHeader } from '@/components/jobhacker';
import { buttonVariants } from '@/components/ui/button';
import { FileText, Send, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { MobileNavButton } from '../../../components/app-shell.js';
import { ApplicationWorkspace } from '../../components/ApplicationWorkspace.js';
import { brandfetchClientId, getUiConfig, getWorkspace } from '../../lib/queries.js';

export const dynamic = 'force-dynamic';

/** One application's workspace (J7): the fill report, the PDF, the note, answers and activity. */
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const applicationId = Number(id);
  const config = getUiConfig();

  if (!config.ok) {
    return (
      <>
        <PageHeader icon={FileText} title="Application" leading={<MobileNavButton />} />
        <EmptyState
          icon={TriangleAlert}
          title="The config has an error"
          body={
            <pre className="mt-2 max-w-xl whitespace-pre-wrap rounded-md border border-danger/30 bg-danger-wash p-3 text-left font-mono text-xs text-danger">
              {config.error}
            </pre>
          }
        />
      </>
    );
  }

  const data = Number.isInteger(applicationId) ? getWorkspace(config, applicationId) : undefined;
  if (!data) {
    return (
      <>
        <PageHeader icon={FileText} title="Application" leading={<MobileNavButton />} />
        <EmptyState
          icon={Send}
          title="Application not found"
          body="It may have been removed. Go back to your applications to pick another."
          action={
            <Link
              href="/applications"
              className={buttonVariants({ size: 'sm', variant: 'secondary' })}
            >
              Back to applications
            </Link>
          }
        />
      </>
    );
  }

  return <ApplicationWorkspace data={data} logoClientId={brandfetchClientId()} />;
}
