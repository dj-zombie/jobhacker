'use client';

import {
  EducationEditor,
  ExperienceEditor,
  type FieldErrors,
  KeyedRowsEditor,
  PageHeader,
  RescoreNotice,
  SaveBar,
  SelfIdEditor,
  SettingsNote,
  SettingsSection,
  SettingsTabs,
  type SkillGroupText,
  SkillsEditor,
  TextBlock,
  TextFields,
  toast,
} from '@/components/jobhacker';
import { Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { MobileNavButton } from '../../components/app-shell.js';
import {
  DECLINE,
  type ProfileSection,
  type SectionInputs,
  isYearOnly,
  needsInput,
  skillItemsFromText,
  skillItemsToText,
} from '../../core/config/profile-sections.js';
import { savePreferencesAction, saveProfileSectionAction } from '../lib/actions.js';
import {
  type SettingsSectionKey,
  costBasisLabel,
  splitIssues,
  usd,
} from '../lib/settings-format.js';
import type {
  ProfileSettings,
  RescoreBasisView,
  SettingsSaveResult,
} from '../lib/settings-types.js';

const PROFILE_HREF = '/settings/profile';
const TABS = [
  { href: PROFILE_HREF, label: 'Profile' },
  { href: '/settings/answers', label: 'Answers' },
  { href: '/settings/self-id', label: 'Self-ID' },
  { href: '/settings/preferences', label: 'Preferences' },
];

const YEAR_ONLY =
  'Year only. Forms with a month picker leave the month blank, since no month is made up.';
const NEEDS_INPUT = 'Forms leave this blank and list it in the fill report.';

/** The Settings header and tabs, around whichever section route is open. */
export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = TABS.find((tab) => pathname.startsWith(tab.href))?.href ?? PROFILE_HREF;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={Settings}
        kicker="Setup"
        title="Settings"
        art="/art/deck-alien.webp"
        leading={<MobileNavButton />}
      >
        <SettingsTabs tabs={TABS} activeHref={active} />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-5 py-5 max-md:px-4">{children}</div>
      </div>
    </div>
  );
}

type Confirm = Extract<SettingsSaveResult<unknown>, { status: 'confirm' }>;

/**
 * One section's draft, its errors and its save, including the re-score notice when the server
 * says the edit changes scores. `toWire` and `fromWire` convert between what the editor holds and
 * what the action takes, which differ only for skills.
 */
function useSaveFlow<D, W>({
  section,
  initial,
  toWire,
  fromWire,
  save,
  file,
}: {
  section: SettingsSectionKey;
  initial: W;
  toWire: (draft: D) => W;
  fromWire: (value: W) => D;
  save: (value: W, confirm: boolean) => Promise<SettingsSaveResult<W>>;
  file: string;
}) {
  const [stored, setStored] = React.useState<D>(() => fromWire(initial));
  const [draft, setDraftState] = React.useState<D>(stored);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [sectionError, setSectionError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [impact, setImpact] = React.useState<Confirm | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  const run = async (confirm: boolean) => {
    setBusy(true);
    try {
      const result = await save(toWire(draft), confirm);
      if (result.status === 'confirm') {
        setImpact(result);
        return;
      }
      setImpact(null);
      if (result.status === 'refused') {
        const split = splitIssues(section, result.issues);
        setErrors(split.fields);
        const fieldsToFix =
          Object.keys(split.fields).length > 0 ? ['Fix the fields marked below.'] : [];
        setSectionError([result.error, ...split.section, ...fieldsToFix].join(' '));
        setStatus(null);
        return;
      }
      const next = fromWire(result.value);
      setStored(next);
      setDraftState(next);
      setErrors({});
      setSectionError(null);
      setStatus(
        result.changed
          ? 'Saved. The previous file was backed up first.'
          : 'Nothing had changed, so nothing was written.',
      );
      if (result.changed) toast.success(`Saved to ${file}`);
    } catch {
      setImpact(null);
      setSectionError('The save didn’t reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  return {
    draft,
    setDraft: (next: D) => {
      setDraftState(next);
      setStatus(null);
    },
    errors,
    sectionError,
    bar: (
      <SaveBar
        dirty={dirty}
        busy={busy}
        status={status}
        onSave={() => void run(false)}
        onDiscard={() => {
          setDraftState(stored);
          setErrors({});
          setSectionError(null);
        }}
      />
    ),
    notice: (
      <RescoreNotice
        open={impact !== null}
        onOpenChange={(open) => {
          if (!open) setImpact(null);
        }}
        stale={impact?.staleIfSaved ?? 0}
        cost={impact?.estimatedUsd == null ? null : usd(impact.estimatedUsd)}
        costBasis={costBasisLabel(impact?.basis ?? null)}
        perRun={impact?.perRun ?? 0}
        busy={busy}
        onConfirm={() => void run(true)}
      />
    ),
  };
}

const same = <T,>(value: T): T => value;

function useProfileSection<S extends ProfileSection>(section: S, initial: SectionInputs[S]) {
  return useSaveFlow<SectionInputs[S], SectionInputs[S]>({
    section,
    initial,
    toWire: same,
    fromWire: same,
    save: (value, confirm) => saveProfileSectionAction(section, value, confirm),
    file: 'profile.yaml',
  });
}

function skillsToText(groups: SectionInputs['skills']): SkillGroupText[] {
  return groups.map((g) => ({ group: g.group, items: skillItemsToText(g.items) }));
}

function skillsFromText(groups: SkillGroupText[]): SectionInputs['skills'] {
  return groups.map((g) => ({ group: g.group, items: skillItemsFromText(g.items) }));
}

/** "your 150 current scores stale", or the sentence for when no score is current. */
function staleScores(rescore: RescoreBasisView): string {
  const n = rescore.current;
  if (n === 0) return 'every current score stale, though none are current right now';
  return `your ${n.toLocaleString('en-US')} current ${n === 1 ? 'score' : 'scores'} stale`;
}

export function ProfileSettingsForm({
  profile,
  rescore,
}: {
  profile: ProfileSettings;
  rescore: RescoreBasisView;
}) {
  const contact = useProfileSection('contact', profile.contact);
  const links = useProfileSection('links', profile.links);
  const summary = useProfileSection('summary', profile.summary);
  const skills = useSaveFlow<SkillGroupText[], SectionInputs['skills']>({
    section: 'skills',
    initial: profile.skills,
    toWire: skillsFromText,
    fromWire: skillsToText,
    save: (value, confirm) => saveProfileSectionAction('skills', value, confirm),
    file: 'profile.yaml',
  });
  const experience = useProfileSection('experience', profile.experience);
  const education = useProfileSection('education', profile.education);
  return (
    <>
      <SettingsNote tone="info">
        Every fact on your applications comes from here. Each section saves on its own, into
        config/profile.yaml, and the file is backed up before each save. A section marked Changes
        scores asks first, since saving it makes {staleScores(rescore)}.
      </SettingsNote>
      <SettingsSection
        id="contact"
        title="Contact"
        error={contact.sectionError}
        footer={contact.bar}
      >
        <TextFields
          path="contact"
          value={contact.draft}
          onChange={(v) => contact.setDraft({ ...contact.draft, ...v })}
          errors={contact.errors}
          fields={[
            { key: 'name', label: 'Name', autoComplete: 'name' },
            { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
            { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
            { key: 'location', label: 'Location' },
          ]}
        />
      </SettingsSection>
      <SettingsSection id="links" title="Links" error={links.sectionError} footer={links.bar}>
        <TextFields
          path="links"
          value={links.draft}
          onChange={(v) => links.setDraft({ ...links.draft, ...v })}
          errors={links.errors}
          fields={[
            { key: 'linkedin', label: 'LinkedIn', type: 'url' },
            { key: 'github', label: 'GitHub', type: 'url' },
            { key: 'portfolio', label: 'Portfolio', type: 'url' },
          ]}
        />
      </SettingsSection>
      <SettingsSection
        id="summary"
        title="Summary"
        scored
        error={summary.sectionError}
        footer={summary.bar}
      >
        <TextBlock
          path="summary"
          label="Summary"
          value={summary.draft}
          onChange={summary.setDraft}
          errors={summary.errors}
        />
      </SettingsSection>
      <SettingsSection
        id="skills"
        title="Skills"
        scored
        description="Also the list of technologies a tailored resume may name."
        error={skills.sectionError}
        footer={skills.bar}
      >
        <SkillsEditor groups={skills.draft} onChange={skills.setDraft} errors={skills.errors} />
      </SettingsSection>
      <SettingsSection
        id="experience"
        title="Experience"
        scored
        description="Bullet ids are labels that tailored resumes point back to. A new bullet gets the next free one when you save."
        error={experience.sectionError}
        footer={experience.bar}
      >
        <ExperienceEditor
          entries={experience.draft}
          onChange={experience.setDraft}
          errors={experience.errors}
          dateFlag={(date) => (isYearOnly(date) ? YEAR_ONLY : null)}
        />
      </SettingsSection>
      <SettingsSection
        id="education"
        title="Education"
        error={education.sectionError}
        footer={education.bar}
      >
        <EducationEditor
          entries={education.draft}
          onChange={education.setDraft}
          errors={education.errors}
        />
      </SettingsSection>
      {summary.notice}
      {skills.notice}
      {experience.notice}
    </>
  );
}

export function AnswersSettingsForm({ answers }: { answers: SectionInputs['standard_answers'] }) {
  const form = useProfileSection('standard_answers', answers);
  return (
    <SettingsSection
      id="answers"
      title="Standard answers"
      description="Used as written for the questions most forms ask. Saving these doesn't change any score."
      error={form.sectionError}
      footer={form.bar}
    >
      <KeyedRowsEditor
        path="standard_answers"
        rows={form.draft}
        onChange={form.setDraft}
        errors={form.errors}
        keyLabel="Key"
        valueLabel="Answer"
        addLabel="Add an answer"
        valueFlag={(value) => (needsInput(value) ? NEEDS_INPUT : null)}
      />
    </SettingsSection>
  );
}

export function SelfIdSettingsForm({ selfId }: { selfId: SectionInputs['self_identification'] }) {
  const form = useProfileSection('self_identification', selfId);
  return (
    <SettingsSection
      id="self-id"
      title="Self-identification"
      description="Voluntary answers, filled onto forms exactly as written here and never sent to the model. Leave one at decline to not disclose it."
      error={form.sectionError}
      footer={form.bar}
    >
      <SelfIdEditor
        value={form.draft}
        onChange={form.setDraft}
        errors={form.errors}
        decline={DECLINE}
      />
    </SettingsSection>
  );
}

export function PreferencesSettingsForm({
  preferences,
  rescore,
}: {
  preferences: string;
  rescore: RescoreBasisView;
}) {
  const form = useSaveFlow<string, string>({
    section: 'preferences',
    initial: preferences,
    toWire: same,
    fromWire: same,
    save: savePreferencesAction,
    file: 'preferences.md',
  });
  return (
    <>
      <SettingsSection
        id="preferences"
        title="Preferences"
        scored
        description={`The roles you want, in your own words. The scorer reads this beside your profile, so saving asks first: it makes ${staleScores(rescore)}. Saved to config/preferences.md.`}
        error={form.sectionError}
        footer={form.bar}
      >
        <TextBlock
          path="preferences"
          label="preferences.md"
          value={form.draft}
          onChange={form.setDraft}
          errors={form.errors}
          minRows={12}
          maxRows={28}
        />
      </SettingsSection>
      {form.notice}
    </>
  );
}
