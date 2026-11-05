import { ImageOff } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CompanyLogo } from "@/components/jobhacker";
import { placeholderMark } from "../logos";
import { applyLogo, openLogoPicker } from "../logo-store";
import { suggestionsFor, type LogoSuggestion } from "../logo-suggestions";

function bareHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/\.$/, "");
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
      ? host
      : null;
  } catch {
    return null;
  }
}

/**
 * The logo picker. Suggestions are canned: the prototype can't call Brandfetch.
 * Icons are J9's placeholder marks.
 */
export function LogoPickerDialog({ company }: { company: string | null }) {
  const [query, setQuery] = React.useState(company ?? "");
  const [hits, setHits] = React.useState<LogoSuggestion[]>([]);
  const [typed, setTyped] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!company) return;
    setQuery(company);
    setHits(suggestionsFor(company, company));
    setTyped("");
    setTyping(false);
    setError(null);
  }, [company]);

  React.useEffect(() => {
    if (!company) return;
    const handle = window.setTimeout(() => setHits(suggestionsFor(company, query)), 200);
    return () => window.clearTimeout(handle);
  }, [company, query]);

  const close = () => openLogoPicker(null);

  const pick = (hit: LogoSuggestion) => {
    if (!company) return;
    const domain = bareHost(hit.domain);
    if (!domain) {
      setError("That result has no website to store.");
      return;
    }
    applyLogo(company, { state: "confirmed", domain });
    close();
  };

  const saveTyped = () => {
    if (!company) return;
    const domain = bareHost(typed);
    if (!domain) {
      setError("Type a domain like linear.app.");
      return;
    }
    applyLogo(company, { state: "confirmed", domain });
    close();
  };

  const none = () => {
    if (!company) return;
    applyLogo(company, { state: "none", domain: null });
    close();
  };

  return (
    <Dialog open={company != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md p-0">
        <div className="border-b border-line px-4 py-3">
          <DialogTitle className="text-base font-semibold text-fg">Logo for {company}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-fg-3">
            Pick a suggestion, or type a domain. A typed domain shows that website's own icon.
          </DialogDescription>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Company name"
            autoFocus
            className="mt-3 h-9 w-full rounded-md border border-line-2 bg-surface-1 px-3 text-sm text-fg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-sm text-fg-3">No matches.</li>
          ) : (
            hits.map((hit) => (
              <li key={`${hit.name}-${hit.domain}`}>
                <button
                  type="button"
                  onClick={() => pick(hit)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-3 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi"
                >
                  <CompanyLogo name={hit.name} src={placeholderMark(hit.domain)} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{hit.name}</span>
                    <span className="block truncate text-xs text-fg-3">{hit.domain}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        {error ? <p className="px-4 pb-2 text-xs text-danger">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {typing ? (
            <form
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveTyped();
              }}
            >
              {bareHost(typed) ? (
                <CompanyLogo name={company ?? ""} src={placeholderMark(bareHost(typed) ?? "")} size={32} />
              ) : null}
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Domain"
                placeholder="linear.app"
                className="h-8 min-w-0 flex-1 rounded-md border border-line-2 bg-surface-1 px-2.5 text-sm text-fg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi"
              />
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setTyping(true)}>
              Type a domain
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={none}>
            <ImageOff />
            No logo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
