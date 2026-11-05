import { Menu, Settings } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
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
  SkillsEditor,
  TextBlock,
  TextFields,
  toast,
} from "@/components/jobhacker";
import { useDemo } from "../App";
import { DEMO_PROFILE, DEMO_RESCORE, type DemoProfile } from "../settings-data";
import deckAlien from "@/art/deck-alien.webp";

export type SettingsSectionId = "profile" | "answers" | "self-id" | "preferences";

const TABS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/answers", label: "Answers" },
  { href: "/settings/self-id", label: "Self-ID" },
  { href: "/settings/preferences", label: "Preferences" },
];

const EMAIL_MESSAGE = "must be an email address or a visible [NEEDS INPUT: …] marker";
const YEAR_ONLY = "Year only. Forms with a month picker leave the month blank, since no month is made up.";
const NEEDS_INPUT = "Forms leave this blank and list it in the fill report.";

let saved: DemoProfile = DEMO_PROFILE;

type Key = keyof DemoProfile;

/** One section's draft, its errors, and the save flow, including the re-score notice for scored sections. */
function useSection<K extends Key>(key: K, scored: boolean) {
  const [draft, setDraft] = React.useState<DemoProfile[K]>(saved[key]);
  const [stored, setStored] = React.useState<DemoProfile[K]>(saved[key]);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [status, setStatus] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  const commit = () => {
    saved = { ...saved, [key]: draft };
    setStored(draft);
    setNotice(false);
    setStatus("Saved. The previous file was backed up first.");
    toast.success("Saved to profile.yaml");
  };
  const save = (validate?: (v: DemoProfile[K]) => FieldErrors) => {
    const found = validate?.(draft) ?? {};
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStatus(null);
      return;
    }
    if (scored) setNotice(true);
    else commit();
  };
  return {
    draft,
    setDraft: (v: DemoProfile[K]) => {
      setDraft(v);
      setStatus(null);
    },
    errors,
    dirty,
    status,
    discard: () => {
      setDraft(stored);
      setErrors({});
    },
    save,
    notice: (
      <RescoreNotice
        open={notice}
        onOpenChange={setNotice}
        stale={DEMO_RESCORE.stale}
        cost={DEMO_RESCORE.cost}
        costBasis={DEMO_RESCORE.costBasis}
        perRun={DEMO_RESCORE.perRun}
        onConfirm={commit}
      />
    ),
  };
}

export function SettingsView({ section }: { section: SettingsSectionId }) {
  const { isMobile, openMobileNav } = useDemo();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={Settings}
        kicker="Setup"
        title="Settings"
        art={deckAlien}
        leading={
          isMobile ? (
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={openMobileNav}>
              <Menu />
            </Button>
          ) : null
        }
      >
        <SettingsTabs tabs={TABS} activeHref={`/settings/${section}`} />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-5 py-5 max-md:px-4">
          {section === "profile" ? <ProfileSections /> : null}
          {section === "answers" ? <AnswersSection /> : null}
          {section === "self-id" ? <SelfIdSection /> : null}
          {section === "preferences" ? <PreferencesSection /> : null}
        </div>
      </div>
    </div>
  );
}

function ProfileSections() {
  const contact = useSection("contact", false);
  const links = useSection("links", false);
  const summary = useSection("summary", true);
  const skills = useSection("skills", true);
  const experience = useSection("experience", true);
  const education = useSection("education", false);
  return (
    <>
      <SettingsNote tone="info">
        Every fact on your applications comes from here. Each section saves on its own, into
        config/profile.yaml, and the file is backed up before each save. A section marked Changes
        scores asks first, since saving it makes your {DEMO_RESCORE.stale.toLocaleString("en-US")}{" "}
        current scores stale.
      </SettingsNote>
      <SettingsSection
        id="contact"
        title="Contact"
        footer={
          <SaveBar
            dirty={contact.dirty}
            status={contact.status}
            onDiscard={contact.discard}
            onSave={() =>
              contact.save((v): FieldErrors =>
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || /\[NEEDS INPUT/i.test(v.email)
                  ? {}
                  : { "contact.email": EMAIL_MESSAGE },
              )
            }
          />
        }
      >
        <TextFields
          path="contact"
          value={contact.draft}
          onChange={(v) => contact.setDraft({ ...contact.draft, ...v })}
          errors={contact.errors}
          fields={[
            { key: "name", label: "Name", autoComplete: "name" },
            { key: "email", label: "Email", type: "email", autoComplete: "email" },
            { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
            { key: "location", label: "Location" },
          ]}
        />
      </SettingsSection>
      <SettingsSection
        id="links"
        title="Links"
        footer={<SaveBar dirty={links.dirty} status={links.status} onDiscard={links.discard} onSave={() => links.save()} />}
      >
        <TextFields
          path="links"
          value={links.draft}
          onChange={(v) => links.setDraft({ ...links.draft, ...v })}
          errors={links.errors}
          fields={[
            { key: "linkedin", label: "LinkedIn", type: "url" },
            { key: "github", label: "GitHub", type: "url" },
            { key: "portfolio", label: "Portfolio", type: "url" },
          ]}
        />
      </SettingsSection>
      <SettingsSection
        id="summary"
        title="Summary"
        scored
        footer={
          <SaveBar dirty={summary.dirty} status={summary.status} onDiscard={summary.discard} onSave={() => summary.save()} />
        }
      >
        <TextBlock path="summary" label="Summary" value={summary.draft} onChange={summary.setDraft} errors={summary.errors} />
      </SettingsSection>
      <SettingsSection
        id="skills"
        title="Skills"
        scored
        description="Also the list of technologies a tailored resume may name."
        footer={<SaveBar dirty={skills.dirty} status={skills.status} onDiscard={skills.discard} onSave={() => skills.save()} />}
      >
        <SkillsEditor groups={skills.draft} onChange={skills.setDraft} errors={skills.errors} />
      </SettingsSection>
      <SettingsSection
        id="experience"
        title="Experience"
        scored
        description="Bullet ids are labels that tailored resumes point back to. A new bullet gets the next free one when you save."
        footer={
          <SaveBar
            dirty={experience.dirty}
            status={experience.status}
            onDiscard={experience.discard}
            onSave={() => experience.save()}
          />
        }
      >
        <ExperienceEditor
          entries={experience.draft}
          onChange={experience.setDraft}
          errors={experience.errors}
          dateFlag={(date) => (/^\d{4}$/.test(date.trim()) ? YEAR_ONLY : null)}
        />
      </SettingsSection>
      <SettingsSection
        id="education"
        title="Education"
        footer={
          <SaveBar dirty={education.dirty} status={education.status} onDiscard={education.discard} onSave={() => education.save()} />
        }
      >
        <EducationEditor entries={education.draft} onChange={education.setDraft} errors={education.errors} />
      </SettingsSection>
      {summary.notice}
      {skills.notice}
      {experience.notice}
    </>
  );
}

function AnswersSection() {
  const answers = useSection("standard_answers", false);
  return (
    <SettingsSection
      id="answers"
      title="Standard answers"
      description="Used as written for the questions most forms ask. Saving these doesn't change any score."
      footer={<SaveBar dirty={answers.dirty} status={answers.status} onDiscard={answers.discard} onSave={() => answers.save()} />}
    >
      <KeyedRowsEditor
        path="standard_answers"
        rows={answers.draft}
        onChange={answers.setDraft}
        errors={answers.errors}
        keyLabel="Key"
        valueLabel="Answer"
        addLabel="Add an answer"
        valueFlag={(value) => (/\[NEEDS INPUT/i.test(value) ? NEEDS_INPUT : null)}
      />
    </SettingsSection>
  );
}

function SelfIdSection() {
  const self = useSection("self_identification", false);
  return (
    <SettingsSection
      id="self-id"
      title="Self-identification"
      description="Voluntary answers, filled onto forms exactly as written here and never sent to the model. Leave one at decline to not disclose it."
      footer={<SaveBar dirty={self.dirty} status={self.status} onDiscard={self.discard} onSave={() => self.save()} />}
    >
      <SelfIdEditor value={self.draft} onChange={self.setDraft} errors={self.errors} />
    </SettingsSection>
  );
}

function PreferencesSection() {
  const prefs = useSection("preferences", true);
  return (
    <>
      <SettingsSection
        id="preferences"
        title="Preferences"
        scored
        description={`The roles you want, in your own words. The scorer reads this beside your profile, so saving asks first: it makes your ${DEMO_RESCORE.stale.toLocaleString("en-US")} current scores stale. Saved to config/preferences.md.`}
        footer={<SaveBar dirty={prefs.dirty} status={prefs.status} onDiscard={prefs.discard} onSave={() => prefs.save()} />}
      >
        <TextBlock
          path="preferences"
          label="preferences.md"
          value={prefs.draft}
          onChange={prefs.setDraft}
          errors={prefs.errors}
          minRows={12}
          maxRows={28}
        />
      </SettingsSection>
      {prefs.notice}
    </>
  );
}
