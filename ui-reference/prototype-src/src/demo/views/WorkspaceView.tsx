import * as React from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  Code2,
  Download,
  LoaderCircle,
  RefreshCw,
  Save,
  Send,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CompanyHeader,
  EmptyState,
  FillReadiness,
  FillReport,
  RemoteChip,
  ScorePill,
  Timeline,
  toast,
  type TimelineGroup,
} from "@/components/jobhacker";
import { useDemo } from "../App";
import { demoHooks } from "../demo-hooks";
import { openLogoPicker } from "../logo-store";
import { demoCoverUrl, demoLogoUrl, demoSymbolUrl, demoWordmarkUrl } from "../logos";
import { bandFor, rank } from "../model";
import { navigate } from "../router";
import { COVER_NOTE, STANDARD_ANSWERS, TIMELINE_LINEAR } from "../data";
import { StatusChip } from "./ApplicationsView";

type Tab = "apply" | "resume" | "cover" | "answers" | "activity";

function countWords(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}

export function WorkspaceView({ appId }: { appId: string }) {
  const { state, dispatch } = useDemo();
  const app = state.apps.find((a) => a.id === appId);
  const [tab, setTab] = React.useState<Tab>("apply");
  const [filling, setFilling] = React.useState(false);
  const isLinear = appId === "linear";
  const [cover, setCover] = React.useState(isLinear ? COVER_NOTE : "");
  const [savedCover, setSavedCover] = React.useState(cover);
  const [showSource, setShowSource] = React.useState(false);

  if (!app) {
    return (
      <EmptyState
        icon={Send}
        title="Application not found"
        body="It may have been removed. Go back to your applications to pick another."
        action={
          <Button size="sm" variant="secondary" onClick={() => navigate("/applications")}>
            Back to applications
          </Button>
        }
      />
    );
  }

  const job = state.jobs.find((j) => j.id === app.jobId)!;
  const fields = state.fields[app.id] ?? [];
  const filled = fields.filter((f) => f.state === "filled").length;
  const review = fields.filter((f) => f.state === "review").length;
  const blank = fields.filter((f) => f.state === "blank").length;
  const score = job.dims ? rank(job.dims, state.weights) : null;
  const submitted = app.status === "submitted";

  const timeline: TimelineGroup[] = isLinear
    ? TIMELINE_LINEAR
    : [
        {
          day: "Recent",
          items: [
            ...(submitted ? [{ id: "s", time: app.submittedLabel ?? "", title: "Marked submitted", detail: `Follow-up set for ${app.followUpLabel}`, kind: "submit" as const }] : []),
            { id: "p", time: app.updatedLabel, title: "Prepared resume, cover note and answers", kind: "prep" as const },
            { id: "t", time: "", title: "Shortlisted from triage", kind: "triage" as const },
            { id: "sc", time: "", title: score != null ? `Scored ${score}` : "Scored", kind: "score" as const },
          ],
        },
      ];

  const openAndFill = () => {
    setFilling(true);
    const hosted = demoHooks.openAndFill;
    if (hosted) {
      hosted(app.id, (result) => {
        setFilling(false);
        if (result) toast(result.title, { description: result.description, icon: <Wand2 className="text-info" /> });
      });
      return;
    }
    window.setTimeout(() => {
      setFilling(false);
      toast("Filled the application in Chrome", {
        description: `${filled + review} fields filled${review ? `, ${review} drafted for review` : ""}. Nothing was submitted.`,
        icon: <Wand2 className="text-info" />,
      });
    }, 1600);
  };

  const markSubmitted = () => {
    dispatch({ type: "submitApp", appId: app.id });
    toast("Marked submitted", {
      description: "Follow-up reminder set for Oct 31.",
      icon: <Send className="text-strong" />,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => navigate(submitted ? "/applications/submitted" : "/applications")}>
          <ChevronLeft />
          Applications
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast("Opening the posting", { description: "Links are switched off in the prototype." })}
          >
            <ArrowUpRight />
            <span className="max-sm:hidden">Open posting</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={openAndFill} disabled={filling || submitted}>
            {filling ? <LoaderCircle className="animate-spin" /> : <Wand2 />}
            {filling ? "Filling in Chrome" : "Open & fill"}
          </Button>
          <Button size="sm" onClick={markSubmitted} disabled={submitted}>
            {submitted ? <Check /> : <Send />}
            {submitted ? "Submitted" : "Mark submitted"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CompanyHeader
          company={job.company}
          title={job.title}
          titleAs="h1"
          artUrl={demoLogoUrl(job.company)}
          coverUrl={demoCoverUrl(job.company)}
          markOnDark={demoSymbolUrl(job.company, "white")}
          markOnLight={demoSymbolUrl(job.company, "black")}
          wordmarkOnDark={demoWordmarkUrl(job.company, "white")}
          wordmarkOnLight={demoWordmarkUrl(job.company, "black")}
          onEditLogo={() => openLogoPicker(job.company)}
          contentClassName="mx-auto max-w-4xl"
          facts={[
            { label: "Location", value: <span className="truncate">{job.location}</span> },
            { label: "Work", value: <RemoteChip remote={job.remote} /> },
            { label: "Status", value: <StatusChip status={app.status} /> },
            ...(score != null
              ? [{ label: "Score", value: <ScorePill score={score} band={bandFor(score, state.thresholds)} /> }]
              : []),
          ]}
        >
        <div className="mx-auto max-w-4xl px-6 py-6 max-md:px-4">
          <FillReadiness
            filled={filled}
            review={review}
            blank={blank}
            resumeAttached={fields.some((f) => f.id === "resume" && f.state === "filled")}
          />

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6">
            <TabsList value={tab} className="overflow-x-auto">
              <TabsTrigger value="apply">
                Apply
                {review ? (
                  <span className="rounded-full bg-maybe-wash px-1.5 text-2xs font-semibold tnum text-maybe">{review}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="resume">Resume</TabsTrigger>
              <TabsTrigger value="cover">Cover note</TabsTrigger>
              <TabsTrigger value="answers">Answers</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="apply" className="pt-5">
              <FillReport
                fields={fields}
                onApprove={(id) => dispatch({ type: "approveField", appId: app.id, fieldId: id })}
                onEdit={() => setTab("answers")}
                onAddAnswer={() => setTab("answers")}
                onCopy={() => toast("Copied", { description: "Paste it into the form." })}
              />
            </TabsContent>

            <TabsContent value="resume" className="pt-5">
              <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
                <ResumePreview />
                <div className="space-y-2">
                  <Button variant="secondary" className="w-full justify-start" onClick={() => toast("Opened Kris_Tester_Resume.pdf")}>
                    <Download />
                    Open PDF
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => toast("Regenerating resume", { description: "Grounded in profile.yaml. About 20 seconds." })}
                  >
                    <RefreshCw />
                    Regenerate
                  </Button>
                  <Button variant="ghost" className="w-full justify-start" onClick={() => setShowSource((s) => !s)}>
                    <Code2 />
                    {showSource ? "Hide HTML source" : "View HTML source"}
                  </Button>
                  <p className="px-1 pt-1 text-2xs leading-relaxed text-fg-4">
                    Every tailored bullet cites a bullet in your profile. Untrue lines are rejected before they get here.
                  </p>
                </div>
              </div>
              {showSource ? (
                <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-line bg-surface-1 p-4 font-mono text-xs leading-relaxed text-fg-3 animate-rise-in">
                  {`<article class="page">
  <h1>Kris Tester</h1>
  <p class="contact">Portland, OR · linkedin.com/in/kris-tester · github.com/kris-tester</p>
  <h2>Summary</h2>
  <p>Full-stack engineer with 12 years building web products …</p>
  <h2>Experience</h2>
  <ul class="bullets">
    <li data-source="fabrikam-1">Leads frontend for the fleet-tracking platform …</li>
    <li data-source="fabrikam-2">Rebuilt the live map and vehicle list …</li>
  </ul>
</article>`}
                </pre>
              ) : null}
            </TabsContent>

            <TabsContent value="cover" className="pt-5">
              {isLinear ? (
                <div className="surface-card rounded-xl p-1">
                  <textarea
                    id="cover-note"
                    value={cover}
                    onChange={(e) => setCover(e.target.value)}
                    rows={16}
                    className="block w-full resize-y rounded-lg bg-transparent p-4 text-base leading-relaxed text-fg outline-none placeholder:text-fg-4 focus-visible:bg-surface-2/40"
                  />
                  <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
                    <span className="text-xs tnum text-fg-3">{countWords(cover)} words</span>
                    {cover !== savedCover ? <span className="text-xs text-maybe">Unsaved changes</span> : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => toast("Regenerating cover note", { description: "Grounded in profile.yaml." })}
                    >
                      <RefreshCw />
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      disabled={cover === savedCover}
                      onClick={() => {
                        setSavedCover(cover);
                        toast("Saved cover note");
                      }}
                    >
                      <Save />
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  className="rounded-xl border border-dashed border-line-2 py-12"
                  icon={RefreshCw}
                  title="Cover note not included in the prototype"
                  body="Only the Linear application carries its real prepared content here. In the app this tab holds the editable note."
                />
              )}
            </TabsContent>

            <TabsContent value="answers" className="pt-5">
              <div className="space-y-6">
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-fg">Standard answers</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {STANDARD_ANSWERS.map((a) => (
                      <label key={a.id} className="block">
                        <span className="mb-1 block text-xs text-fg-3">{a.label}</span>
                        <input
                          defaultValue={a.value}
                          className="h-9 w-full rounded-lg border border-line-2 bg-surface-1 px-3 text-sm text-fg outline-none transition-colors focus:border-brand/60 focus:bg-surface-2"
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-fg">Questions on this job's form</h3>
                  <div className="space-y-3">
                    {fields
                      .filter((f) => f.source === "drafted" || f.state === "blank" || f.state === "review")
                      .map((f) => (
                        <label key={f.id} className="block">
                          <span className="mb-1 flex items-center gap-2 text-xs text-fg-3">
                            {f.label}
                            {f.state === "review" ? (
                              <span className="rounded-full bg-maybe-wash px-1.5 text-2xs text-maybe">Drafted</span>
                            ) : null}
                          </span>
                          <textarea
                            defaultValue={f.value ?? ""}
                            placeholder="No answer yet. Leave blank to skip this optional question."
                            rows={f.value && f.value.length > 120 ? 6 : 2}
                            className="w-full resize-y rounded-lg border border-line-2 bg-surface-1 px-3 py-2 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-4 focus:border-brand/60 focus:bg-surface-2"
                          />
                        </label>
                      ))}
                    {!fields.some((f) => f.source === "drafted" || f.state === "blank" || f.state === "review") ? (
                      <p className="rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">
                        This form only asks the standard questions.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </TabsContent>

            <TabsContent value="activity" className="pt-5">
              <Timeline groups={timeline} />
            </TabsContent>
          </Tabs>
        </div>
        </CompanyHeader>
      </div>
    </div>
  );
}

function ResumePreview() {
  return (
    <div className="overflow-hidden rounded-xl bg-surface-1 p-4 ring-1 ring-line sm:p-6">
      <article
        className={cn(
          "mx-auto max-w-[640px] rounded-sm bg-paper px-8 py-9 text-paper-ink shadow-pop max-sm:px-5",
          "[font-family:'Helvetica_Neue',Arial,sans-serif]",
        )}
      >
        <h2 className="text-2xl font-bold tracking-tight">Kris Tester</h2>
        <p className="mt-1 text-xs text-paper-ink-2">
          Portland, OR · linkedin.com/in/kris-tester · github.com/kris-tester · loopwell.example
        </p>
        <h3 className="mt-5 border-b border-paper-line pb-1 text-xs font-bold tracking-wide text-paper-ink">Summary</h3>
        <p className="mt-2 text-xs leading-relaxed text-paper-ink">
          Full-stack engineer with 12 years building web products, most recently real-time logistics dashboards.
          Strongest in React, TypeScript and Next.js, with a focus on accessibility and fast, well-tested interfaces, and
          comfortable on the Node.js and Go services behind them. Currently leading frontend at Fabrikam Logistics while
          building Loopwell, a collaborative music sequencer, on the side.
        </p>
        <h3 className="mt-5 border-b border-paper-line pb-1 text-xs font-bold tracking-wide text-paper-ink">Experience</h3>
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <b>Senior Full-Stack Developer, Fabrikam Logistics</b>
          </div>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li>Leads frontend for the fleet-tracking platform, real-time location and diagnostics for delivery vehicles.</li>
            <li>
              Rebuilt the live map and vehicle list around virtualization and incremental updates, so the dashboard opens
              in under a second.
            </li>
          </ul>
        </div>
        <div className="mt-3">
          <div className="text-xs">
            <b>Creator and Lead Developer, Loopwell</b>
          </div>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li>
              Built a collaborative music sequencer that runs in the browser: a TypeScript and Web Audio client with a Go
              sync service.
            </li>
            <li>Shipped the public beta to its first thousand users.</li>
          </ul>
        </div>
        <div aria-hidden className="mt-5 space-y-2 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]">
          {[92, 78, 85, 60, 88, 70].map((w, i) => (
            <div key={i} className="h-2 rounded-full bg-paper-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      </article>
    </div>
  );
}
