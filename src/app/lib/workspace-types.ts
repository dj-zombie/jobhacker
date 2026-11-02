import type { Band, RemoteType, TimelineGroup } from '@/components/jobhacker';
import type { CopyRow, FillView } from '../../core/apply/fill-view.js';

export type { CopyRow };

/** Props for the pipeline lists and the application workspace (J7). Plain data, client-safe. */

export interface CompanyLogoRef {
  domain: string | null;
  logoSource: string | null;
  markUrl: string | null;
}

export interface ApplicationRowView {
  applicationId: number;
  title: string;
  company: string;
  status: string;
  updatedLabel: string;
  followUpLabel: string | null;
  followUpDue: boolean;
  /** Null until the form has been filled once. */
  progress: { filled: number; review: number; total: number; label: string } | null;
  score: number | null;
  band: Band | null;
  logo: CompanyLogoRef;
}

export interface StageCounts {
  prepped: number;
  submitted: number;
  interviewing: number;
  offer: number;
}

export interface WorkspaceAnswer {
  key: string;
  label: string;
  value: string;
  /** A standard answer from the profile (snake_case key), not a question on this form. */
  standard: boolean;
  /**
   * Saved on the application. A question the fill left blank with no saved answer is not, and
   * stays unsaved while its field is empty: an empty saved answer means "blank on purpose".
   */
  stored: boolean;
}

export interface WorkspaceData {
  applicationId: number;
  jobId: number;
  title: string;
  company: string;
  status: string;
  submittedAt: string | null;
  /** The follow-up date as a local `yyyy-mm-dd`, or '' when none is set. */
  followUpDate: string;
  notes: string;
  postingUrl: string;
  location: string;
  remote: RemoteType;
  score: number | null;
  band: Band | null;
  logo: CompanyLogoRef;
  fill: FillView;
  /** False until Open & fill has run once. */
  filled: boolean;
  /** `provided`: the PDF is Kris's own `input/resume.pdf`, which Open & fill attaches as it is (D124). */
  resume: { pdfUrl: string | null; html: string; fileName: string; provided: boolean };
  coverNote: string;
  answers: WorkspaceAnswer[];
  copyRows: CopyRow[];
  activity: TimelineGroup[];
  /** The list this application sits in, for the back button. */
  backHref: '/applications' | '/applications/submitted';
}
