"use client";

import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";
import { BulletId, describedBy, EntryDisclosure, SettingsField, SettingsNote, settingsFieldClass } from "./settings";

/*
  The Settings forms. Each one is controlled: the container holds the value and the errors,
  and gets every edit back through onChange. Errors are keyed by the dotted path core reports,
  e.g. "contact.email" or "experience.3.start". Nothing here validates, saves or fetches.
*/

export type FieldErrors = Readonly<Record<string, string>>;

const INPUT = `${settingsFieldClass} h-9`;
const AREA = `${settingsFieldClass} resize-y py-2 leading-relaxed`;

/** The id an input gets for a dotted path. */
export function fieldId(path: string): string {
  return `settings-${path.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function rowsFor(text: string, min = 2, max = 10): number {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 88)), 0);
  return Math.min(max, Math.max(min, lines));
}

export interface TextFieldDef {
  key: string;
  label: string;
  type?: "text" | "email" | "tel" | "url";
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
}

/** A grid of one-line fields over one object, such as contact or links. */
export function TextFields({
  path,
  fields,
  value,
  onChange,
  errors,
  className,
}: {
  path: string;
  fields: TextFieldDef[];
  value: Readonly<Record<string, string>>;
  onChange: (next: Record<string, string>) => void;
  errors: FieldErrors;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {fields.map((field) => {
        const p = `${path}.${field.key}`;
        const id = fieldId(p);
        const error = errors[p];
        return (
          <SettingsField key={field.key} label={field.label} htmlFor={id} error={error} hint={field.hint}>
            <input
              id={id}
              type={field.type ?? "text"}
              autoComplete={field.autoComplete ?? "off"}
              spellCheck={false}
              placeholder={field.placeholder}
              value={value[field.key] ?? ""}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(id, { error, hint: field.hint })}
              onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
              className={INPUT}
            />
          </SettingsField>
        );
      })}
    </div>
  );
}

/** One block of prose, such as the summary or preferences.md. */
export function TextBlock({
  path,
  label,
  value,
  onChange,
  errors,
  hint,
  minRows = 4,
  maxRows = 16,
}: {
  path: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  errors: FieldErrors;
  hint?: string;
  minRows?: number;
  maxRows?: number;
}) {
  const id = fieldId(path);
  const error = errors[path];
  return (
    <SettingsField label={label} htmlFor={id} error={error} hint={hint}>
      <textarea
        id={id}
        value={value}
        rows={rowsFor(value, minRows, maxRows)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { error, hint })}
        onChange={(e) => onChange(e.target.value)}
        className={AREA}
      />
    </SettingsField>
  );
}

export interface SkillGroupText {
  group: string;
  /** The group's items as typed: comma-separated, or one per line. */
  items: string;
}

export function SkillsEditor({
  groups,
  onChange,
  errors,
}: {
  groups: SkillGroupText[];
  onChange: (next: SkillGroupText[]) => void;
  errors: FieldErrors;
}) {
  const set = (i: number, patch: Partial<SkillGroupText>) =>
    onChange(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <div className="space-y-4">
      {groups.map((g, i) => {
        const nameId = fieldId(`skills.${i}.group`);
        const itemsId = fieldId(`skills.${i}.items`);
        const nameError = errors[`skills.${i}.group`];
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; a group's name is what's being edited
            key={i}
            className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-2 sm:grid-cols-[12rem_1fr_auto] sm:gap-x-3"
          >
            <SettingsField label="Group" htmlFor={nameId} error={nameError}>
              <input
                id={nameId}
                value={g.group}
                spellCheck={false}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={describedBy(nameId, { error: nameError })}
                onChange={(e) => set(i, { group: e.target.value })}
                className={INPUT}
              />
            </SettingsField>
            <Hint label={`Remove the ${g.group || "unnamed"} group`}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="col-start-2 row-start-1 mt-5 sm:col-start-3"
                aria-label={`Remove the ${g.group || "unnamed"} group`}
                onClick={() => onChange(groups.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </Hint>
            <SettingsField
              label="Skills, separated by commas"
              htmlFor={itemsId}
              className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
            >
              <textarea
                id={itemsId}
                value={g.items}
                rows={rowsFor(g.items, 2, 8)}
                onChange={(e) => set(i, { items: e.target.value })}
                className={AREA}
              />
            </SettingsField>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...groups, { group: "", items: "" }])}>
        <Plus />
        Add a group
      </Button>
    </div>
  );
}

export interface BulletValue {
  id?: string;
  text: string;
}

export interface ExperienceValue {
  id?: string;
  company: string;
  title: string;
  start: string;
  end: string;
  location: string;
  bullets: BulletValue[];
}

export function ExperienceEditor({
  entries,
  onChange,
  errors,
  dateFlag,
  openIndex,
}: {
  entries: ExperienceValue[];
  onChange: (next: ExperienceValue[]) => void;
  errors: FieldErrors;
  /** Why a date needs a look, e.g. a year with no month. Null when it's fine. */
  dateFlag: (date: string) => string | null;
  /** An entry to show open, such as the one an error is in. */
  openIndex?: number | null;
}) {
  const set = (i: number, patch: Partial<ExperienceValue>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const p = `experience.${i}`;
        const startFlag = dateFlag(entry.start);
        const endFlag = dateFlag(entry.end);
        const hasError = Object.keys(errors).some((k) => k === p || k.startsWith(`${p}.`));
        const setBullet = (b: number, text: string) =>
          set(i, { bullets: entry.bullets.map((x, k) => (k === b ? { ...x, text } : x)) });
        return (
          <EntryDisclosure
            key={entry.id ?? `new-${i}`}
            title={[entry.title, entry.company].filter(Boolean).join(" · ") || "New role"}
            meta={[entry.start, entry.end].filter(Boolean).join(" – ")}
            flags={startFlag || endFlag ? ["Year-only date"] : undefined}
            defaultOpen={hasError || openIndex === i || entry.id === undefined}
          >
            <TextFields
              path={p}
              value={{ title: entry.title, company: entry.company, location: entry.location }}
              onChange={(next) =>
                set(i, {
                  company: next.company ?? "",
                  title: next.title ?? "",
                  location: next.location ?? "",
                })
              }
              errors={errors}
              fields={[
                { key: "title", label: "Title" },
                { key: "company", label: "Company" },
                { key: "location", label: "Location (optional)" },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {(["start", "end"] as const).map((key) => {
                const id = fieldId(`${p}.${key}`);
                const error = errors[`${p}.${key}`];
                const flag = key === "start" ? startFlag : endFlag;
                const hint = key === "start" ? "YYYY-MM" : "YYYY-MM, or present";
                return (
                  <SettingsField
                    key={key}
                    label={key === "start" ? "Start" : "End"}
                    htmlFor={id}
                    error={error}
                    flag={flag}
                    hint={flag ? undefined : hint}
                  >
                    <input
                      id={id}
                      value={entry[key]}
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={error ? true : undefined}
                      aria-describedby={describedBy(id, { error, flag, hint: flag ? undefined : hint })}
                      onChange={(e) => set(i, { [key]: e.target.value })}
                      className={cn(INPUT, "font-mono tnum")}
                    />
                  </SettingsField>
                );
              })}
            </div>
            <fieldset className="min-w-0 space-y-2">
              <legend className="hud-label mb-1 text-fg-3">Bullets</legend>
              <SettingsNote tone="info">
                Applications you've already prepared keep the text they were made from.
              </SettingsNote>
              {entry.bullets.map((bullet, b) => {
                const id = fieldId(`${p}.bullets.${b}.text`);
                const error = errors[`${p}.bullets.${b}.text`];
                return (
                  <div key={bullet.id ?? `new-${b}`} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <label htmlFor={id} className="mb-1 flex text-xs">
                        <span className="sr-only">Bullet </span>
                        <BulletId id={bullet.id ?? null} />
                      </label>
                      <textarea
                        id={id}
                        value={bullet.text}
                        rows={rowsFor(bullet.text, 2, 8)}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(id, { error })}
                        onChange={(e) => setBullet(b, e.target.value)}
                        className={AREA}
                      />
                      {error ? (
                        <SettingsNote tone="error" id={`${id}-error`} className="mt-1.5">
                          {error}
                        </SettingsNote>
                      ) : null}
                    </div>
                    <Hint label={`Remove bullet ${bullet.id ?? b + 1}`}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="mt-5"
                        aria-label={`Remove bullet ${bullet.id ?? b + 1}`}
                        onClick={() => set(i, { bullets: entry.bullets.filter((_, k) => k !== b) })}
                      >
                        <X />
                      </Button>
                    </Hint>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set(i, { bullets: [...entry.bullets, { text: "" }] })}
              >
                <Plus />
                Add a bullet
              </Button>
            </fieldset>
            <div className="flex justify-end border-t border-line pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
              >
                <Trash2 />
                Remove this role
              </Button>
            </div>
          </EntryDisclosure>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...entries, { company: "", title: "", start: "", end: "", location: "", bullets: [] }])
        }
      >
        <Plus />
        Add a role
      </Button>
    </div>
  );
}

export interface EducationValue {
  id?: string;
  school: string;
  credential: string;
  start: string;
  end: string;
}

export function EducationEditor({
  entries,
  onChange,
  errors,
}: {
  entries: EducationValue[];
  onChange: (next: EducationValue[]) => void;
  errors: FieldErrors;
}) {
  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const p = `education.${i}`;
        const hasError = Object.keys(errors).some((k) => k === p || k.startsWith(`${p}.`));
        return (
          <EntryDisclosure
            key={entry.id ?? `new-${i}`}
            title={entry.school || "New school"}
            meta={[entry.start, entry.end].filter(Boolean).join(" – ")}
            defaultOpen={hasError || entry.id === undefined}
          >
            <TextFields
              path={p}
              value={{ school: entry.school, credential: entry.credential, start: entry.start, end: entry.end }}
              onChange={(next) =>
                onChange(
                  entries.map((e, j) =>
                    j === i
                      ? {
                          ...e,
                          school: next.school ?? "",
                          credential: next.credential ?? "",
                          start: next.start ?? "",
                          end: next.end ?? "",
                        }
                      : e,
                  ),
                )
              }
              errors={errors}
              fields={[
                { key: "school", label: "School" },
                { key: "credential", label: "Credential (optional)" },
                { key: "start", label: "Start (optional)" },
                { key: "end", label: "End (optional)" },
              ]}
            />
            <div className="flex justify-end border-t border-line pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(entries.filter((_, j) => j !== i))}>
                <Trash2 />
                Remove this school
              </Button>
            </div>
          </EntryDisclosure>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...entries, { school: "", credential: "", start: "", end: "" }])}
      >
        <Plus />
        Add a school
      </Button>
    </div>
  );
}

export interface KeyedValue {
  key: string;
  value: string;
}

/** Named values: standard answers, or self-ID overrides. Add, rename, edit and remove a row. */
export function KeyedRowsEditor({
  path,
  rows,
  onChange,
  errors,
  keyLabel,
  valueLabel,
  addLabel,
  valueFlag,
}: {
  path: string;
  rows: KeyedValue[];
  onChange: (next: KeyedValue[]) => void;
  errors: FieldErrors;
  keyLabel: string;
  valueLabel: string;
  addLabel: string;
  /** Why a value needs a look, such as a [NEEDS INPUT] marker. Null when it's fine. */
  valueFlag?: (value: string) => string | null;
}) {
  const set = (i: number, patch: Partial<KeyedValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {rows.length === 0 ? <SettingsNote tone="info">None yet.</SettingsNote> : null}
      {rows.map((row, i) => {
        const keyId = fieldId(`${path}.${i}.key`);
        const valueId = fieldId(`${path}.${i}.value`);
        const keyError = errors[`${path}.${i}.key`];
        const valueError = errors[`${path}.${i}.value`];
        const flag = valueFlag?.(row.value) ?? null;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; the key is what's being edited
            key={i}
            className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-2 border-b border-line pb-3 last:border-b-0 sm:grid-cols-[14rem_1fr_auto] sm:gap-x-3"
          >
            <SettingsField label={keyLabel} htmlFor={keyId} error={keyError}>
              <input
                id={keyId}
                value={row.key}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={keyError ? true : undefined}
                aria-describedby={describedBy(keyId, { error: keyError })}
                onChange={(e) => set(i, { key: e.target.value })}
                className={cn(INPUT, "font-mono text-xs")}
              />
            </SettingsField>
            <Hint label={`Remove ${row.key || "this row"}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="col-start-2 row-start-1 mt-5 sm:col-start-3"
                aria-label={`Remove ${row.key || "this row"}`}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </Hint>
            <SettingsField
              label={valueLabel}
              htmlFor={valueId}
              error={valueError}
              flag={flag}
              className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
            >
              <textarea
                id={valueId}
                value={row.value}
                rows={rowsFor(row.value, 1, 6)}
                aria-invalid={valueError ? true : undefined}
                aria-describedby={describedBy(valueId, { error: valueError, flag })}
                onChange={(e) => set(i, { value: e.target.value })}
                className={AREA}
              />
            </SettingsField>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

export interface SelfIdValue {
  gender: string;
  race_ethnicity: string;
  veteran_status: string;
  disability_status: string;
  overrides: KeyedValue[];
}

const SELF_ID_FIELDS: { key: Exclude<keyof SelfIdValue, "overrides">; label: string }[] = [
  { key: "gender", label: "Gender" },
  { key: "race_ethnicity", label: "Race or ethnicity" },
  { key: "veteran_status", label: "Veteran status" },
  { key: "disability_status", label: "Disability status" },
];

/** The four self-ID answers as written, each with a one-click Decline, and the overrides. No suggestions. */
export function SelfIdEditor({
  value,
  onChange,
  errors,
  decline = "decline",
}: {
  value: SelfIdValue;
  onChange: (next: SelfIdValue) => void;
  errors: FieldErrors;
  decline?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {SELF_ID_FIELDS.map(({ key, label }) => {
          const p = `self_identification.${key}`;
          const id = fieldId(p);
          const error = errors[p];
          const declined = value[key] === decline;
          return (
            <SettingsField key={key} label={label} htmlFor={id} error={error}>
              <div className="flex items-center gap-1.5">
                <input
                  id={id}
                  value={value[key]}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={describedBy(id, { error })}
                  onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                  className={cn(INPUT, "min-w-0 flex-1")}
                />
                <Button
                  type="button"
                  size="sm"
                  variant={declined ? "ghost" : "secondary"}
                  disabled={declined}
                  aria-label={`Decline ${label.toLowerCase()}`}
                  onClick={() => onChange({ ...value, [key]: decline })}
                >
                  Decline
                </Button>
              </div>
            </SettingsField>
          );
        })}
      </div>
      <div className="space-y-2">
        <h3 className="hud-label text-fg-3">Overrides</h3>
        <SettingsNote tone="info">
          Exact option text for a form whose wording doesn't match the answers above.
        </SettingsNote>
        <KeyedRowsEditor
          path="self_identification.overrides"
          rows={value.overrides}
          onChange={(overrides) => onChange({ ...value, overrides })}
          errors={errors}
          keyLabel="Field"
          valueLabel="Option text"
          addLabel="Add an override"
        />
      </div>
    </div>
  );
}
