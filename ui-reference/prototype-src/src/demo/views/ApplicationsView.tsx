import { BellRing, ChevronRight, FileText, Menu, Send, Trophy, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CompanyLogo, EmptyState, PageHeader, ScorePill, toast } from "@/components/jobhacker";
import { useDemo } from "../App";
import { demoLogoUrl } from "../logos";
import { bandFor, rank } from "../model";
import { navigate } from "../router";
import type { AppStatus } from "../data";

const STATUS: Record<AppStatus, { label: string; cls: string }> = {
  prepped: { label: "Prepped", cls: "bg-brand-wash text-brand-hi ring-brand/25" },
  submitted: { label: "Submitted", cls: "bg-strong-wash text-strong ring-strong/25" },
  interviewing: { label: "Interviewing", cls: "bg-info-wash text-info ring-info/25" },
  offer: { label: "Offer", cls: "bg-maybe-wash text-maybe ring-maybe/25" },
  rejected: { label: "Closed", cls: "bg-surface-3 text-fg-3 ring-line-2" },
};

export function StatusChip({ status }: { status: AppStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-medium ring-1 ring-inset", s.cls)}>
      {s.label}
    </span>
  );
}

export function ApplicationsView({ filter }: { filter: "in-progress" | "submitted" | "follow-ups" }) {
  const { state, isMobile, openMobileNav } = useDemo();

  const rows = state.apps
    .map((app) => {
      const job = state.jobs.find((j) => j.id === app.jobId)!;
      const fields = state.fields[app.id] ?? [];
      const filled = fields.filter((f) => f.state !== "blank").length;
      const review = fields.filter((f) => f.state === "review").length;
      const score = job.dims ? rank(job.dims, state.weights) : null;
      return { app, job, filled, total: fields.length, review, score };
    })
    .filter(({ app }) =>
      filter === "in-progress" ? app.status === "prepped" : filter === "submitted" ? app.status === "submitted" : false,
    );

  const stageCounts = {
    prepped: state.apps.filter((a) => a.status === "prepped").length,
    submitted: state.apps.filter((a) => a.status === "submitted").length,
    interviewing: 0,
    offer: 0,
  };

  const stages = [
    { key: "prepped", label: "Prepped", icon: FileText, n: stageCounts.prepped, href: "/applications", tone: "text-brand-hi" },
    { key: "submitted", label: "Submitted", icon: Send, n: stageCounts.submitted, href: "/applications/submitted", tone: "text-strong" },
    { key: "interviewing", label: "Interviewing", icon: MessagesSquare, n: 0, href: null, tone: "text-info" },
    { key: "offer", label: "Offer", icon: Trophy, n: 0, href: null, tone: "text-maybe" },
  ];

  const title = filter === "in-progress" ? "In progress" : filter === "submitted" ? "Submitted" : "Follow-ups";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={filter === "submitted" ? Send : filter === "follow-ups" ? BellRing : FileText}
        title={title}
        count={rows.length}
        leading={
          isMobile ? (
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={openMobileNav}>
              <Menu />
            </Button>
          ) : null
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast("Exported applications.csv", { description: `${state.apps.length} applications` })}
          >
            Export CSV
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-5 max-md:px-4">
          <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {stages.map((st, i) => {
              const Icon = st.icon;
              const active = (st.key === "prepped" && filter === "in-progress") || (st.key === "submitted" && filter === "submitted");
              return (
                <li key={st.key} className="relative">
                  <button
                    type="button"
                    disabled={!st.href}
                    onClick={() => st.href && navigate(st.href)}
                    className={cn(
                      "surface-card flex w-full items-center gap-3 rounded-xl p-3.5 text-left transition-colors",
                      active ? "ring-1 ring-brand/40" : "hover:bg-surface-2",
                      !st.href && "cursor-default opacity-70",
                    )}
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
                      <Icon className={cn("size-4", st.tone)} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-2xs text-fg-3">{st.label}</span>
                      <span className="block text-xl font-semibold leading-tight tnum text-fg">{st.n}</span>
                    </span>
                  </button>
                  {i < stages.length - 1 ? (
                    <ChevronRight
                      aria-hidden
                      className="absolute -right-2.5 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-fg-4 lg:block"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {rows.length === 0 ? (
            <EmptyState
              className="py-16"
              icon={filter === "follow-ups" ? BellRing : Send}
              title={filter === "follow-ups" ? "No follow-ups due" : "Nothing here yet"}
              body={
                filter === "follow-ups"
                  ? "Canva's follow-up comes due on Oct 31. It will show up here that morning."
                  : "Applications move here when you mark them submitted."
              }
            />
          ) : (
            <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1 shadow-card">
              {rows.map(({ app, job, filled, total, review, score }) => (
                <li key={app.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/applications/${app.id}`)}
                    className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <CompanyLogo name={job.company} src={demoLogoUrl(job.company)} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-medium text-fg">{job.title}</span>
                        <StatusChip status={app.status} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-3">
                        <span className="text-fg-2">{job.company}</span>
                        <span>Updated {app.updatedLabel}</span>
                        {app.followUpLabel ? <span>Follow up {app.followUpLabel}</span> : null}
                      </div>
                    </div>
                    <div className="hidden w-40 shrink-0 sm:block">
                      <div className="flex items-baseline justify-between text-2xs text-fg-3">
                        <span>{review ? `${review} to check` : app.status === "submitted" ? "Sent" : "Ready"}</span>
                        <span className="tnum text-fg-2">
                          {filled}/{total}
                        </span>
                      </div>
                      <div className="mt-1 flex h-1 gap-0.5">
                        <div className="rounded-full bg-strong" style={{ flexGrow: filled - review }} />
                        {review ? <div className="rounded-full bg-maybe" style={{ flexGrow: review }} /> : null}
                        {total - filled ? <div className="rounded-full bg-surface-4" style={{ flexGrow: total - filled }} /> : null}
                      </div>
                    </div>
                    {score != null ? (
                      <ScorePill score={score} band={bandFor(score, state.thresholds)} className="hidden md:inline-flex" />
                    ) : null}
                    <ChevronRight className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
