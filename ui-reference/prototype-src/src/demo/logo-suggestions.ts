/** Canned Brand Search hits. The prototype never calls Brandfetch. */

export interface LogoSuggestion {
  name: string;
  domain: string;
}

const EXTRA: Record<string, LogoSuggestion[]> = {
  Linear: [
    { name: "Linear", domain: "linear.app" },
    { name: "Linear Labs", domain: "linearlabs.example" },
  ],
  Vercel: [
    { name: "Vercel", domain: "vercel.com" },
    { name: "Vercel Enterprise", domain: "vercel-enterprise.example" },
  ],
  Notion: [
    { name: "Notion", domain: "notion.so" },
    { name: "Notion Up", domain: "notionup.example" },
  ],
  Datadog: [
    { name: "Datadog", domain: "datadoghq.com" },
    { name: "Datadog Status", domain: "datadogstatus.example" },
  ],
  Cloudflare: [
    { name: "Cloudflare", domain: "cloudflare.com" },
    { name: "Cloudflare Workers", domain: "workers.example" },
  ],
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "company";
}

export function suggestionsFor(company: string, query: string): LogoSuggestion[] {
  const canned = EXTRA[company] ?? [
    { name: company, domain: `${slug(company)}.example` },
    { name: `${company} Labs`, domain: `${slug(company)}labs.example` },
    { name: `${company} HQ`, domain: `${slug(company)}hq.example` },
  ];
  const q = query.trim().toLowerCase();
  const matched = q
    ? canned.filter((item) => item.name.toLowerCase().includes(q) || item.domain.includes(q))
    : canned;
  return matched.slice(0, 5);
}
