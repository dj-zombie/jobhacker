import { readFile } from 'node:fs/promises';
import { loadAllConfig } from '../../../../core/config/load.js';
import { attachmentName } from '../../../../core/prep/render.js';
import { getResumePdfPath } from '../../../lib/queries.js';

export const dynamic = 'force-dynamic';

function fileName(): string {
  try {
    return attachmentName(loadAllConfig().profile, 'Resume');
  } catch {
    return 'resume.pdf';
  }
}

/**
 * The resume PDF the application attaches, for the workspace's Resume tab and Open PDF (J7):
 * Kris's own `input/resume.pdf` when it exists (D124), else the one prep rendered. The path
 * never comes from the request.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const applicationId = Number(id);
  const path = Number.isInteger(applicationId) ? getResumePdfPath(applicationId) : null;
  if (!path?.endsWith('.pdf')) return new Response('No resume PDF', { status: 404 });
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch {
    return new Response('No resume PDF', { status: 404 });
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fileName()}"`,
      'cache-control': 'no-store',
    },
  });
}
