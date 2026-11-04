import type { DimKey, FillField, RemoteType, TimelineGroup, TriageState } from "@/components/jobhacker/types";
import type { Weights } from "@/components/jobhacker/tune-panel";

/*
  Prototype data. Titles, companies, locations, comp ranges and the funnel numbers
  are modeled on real public postings. The candidate, Kris Tester, is fictional,
  and every dimension score and reason is illustrative.
*/

export type Dims = [number, number, number, number, number, number | null];

export interface DemoJob {
  id: string;
  company: string;
  title: string;
  location: string;
  remote: RemoteType;
  employment: "Full-time" | "Contract";
  comp?: string;
  postedLabel: string;
  ageHours: number;
  prescore: number;
  state: TriageState;
  /** The sources no longer list it. Shortlist keeps the row. */
  closed?: boolean;
  /** Last confirmed, in the same words as postedLabel. Defaults in toDetail. */
  confirmedLabel?: string;
  /** Scored jobs have dims. Unscored jobs carry `pending` dims used when scoring is simulated. */
  dims?: Dims;
  pending?: Dims;
  summary?: string;
  reasons?: Partial<Record<DimKey, string>>;
  redFlags?: string[];
  description?: string;
  kind?: "frontend" | "fullstack" | "backend" | "platform" | "lead" | "other";
}

export const STATS = {
  totalJobs: 11374,
  gated: 241,
  passed: 11133,
  scored: 1108,
  unscored: 10025,
  boards: 336,
  lastRun: "1:42 AM",
  newLastRun: 40,
  llmCalls: 1471,
};

export const DEFAULT_WEIGHTS: Weights = { role: 6, tech: 2, domain: 2, seniority: 2, logistics: 4, comp: 1 };
export const DEFAULT_THRESHOLDS = { strong: 72, maybe: 48 };

const LINEAR_DESCRIPTION = `About the role
Build product features end to end across Linear's TypeScript and React client and its Node and GraphQL backend, including AI functionality, with craft as the bar.

Stack
- React, TypeScript, GraphQL, Node and PostgreSQL
- MobX, Temporal and Redis
- Google Cloud and Kubernetes
- GitHub, Slack, Notion

What we offer
We're a small, focused team that cares deeply about the quality of our work and the people we do it with. Here's what you can expect:
- Competitive salary and equity
- Employee-friendly equity terms including early exercise in the US and extended exercise windows
- Daily meal and coffee stipend on every workday
- Paid co-working space or desk
- Health coverage (based on country requirements)
- 5 weeks paid vacation, plus local statutory holidays
- 4 months paid parental leave
- Paid month off after 4 years & every 2 years thereafter
- Regular team events and off-sites
- Remote-first with no required commute

Learn how we think and work
- Read Me https://linear.app/readme a story about our mission
- Our hiring process: How we hire at Linear https://linear.app/now/how-we-hire-at-linear
- How we work: Designing remote work at Linear https://linear.app/now/designing-remote-work-at-linear
- Why and how we do work trials at Linear https://linear.app/blog/why-and-how-we-do-work-trials-at-linear
- Scaling our real-time sync engine, a talk by our cofounder, Tuomas Artman, at Linear's 2023 offsite

Linear is an equal opportunity employer. We do not discriminate based on race, color, religion, gender identity or expression, sexual orientation, national origin, age, disability, veteran status, or any other protected characteristic under applicable law.`;

export const JOBS: DemoJob[] = [
  {
    id: "linear-pe",
    company: "Linear",
    title: "Senior / Staff Product Engineer",
    location: "North America",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Mar 3",
    ageHours: 52,
    prescore: 0.754,
    state: "new",
    kind: "fullstack",
    dims: [5, 4, 3, 5, 5, null],
    summary:
      "Senior/Staff Product Engineer, full-time IC role at Linear building TypeScript/React product features and AI functionality, remote within the US and Europe.",
    reasons: {
      role: "Full-stack product engineering role building customer-facing features, UI, and AI functionality, which matches the candidate's preferred product engineering and frontend-focused full-stack work.",
      tech: "Posting centers on React, TypeScript, GraphQL, Node, and PostgreSQL, all of which appear in the candidate's skills; MobX, Temporal, Redis, and Google Cloud/k8s are less clearly covered.",
      domain:
        "Developer/product-development tooling aligns with the stated developer tools interest, though it is a project management product rather than games or audio, and the candidate says strong general product roles are also attractive.",
      seniority: "Senior/Staff individual-contributor product engineer role with 5+ years experience required, matching the senior/staff IC level sought.",
      logistics: "Remote role open to candidates in the US, full-time, which matches the top location priority of US-remote and the full-time employment type.",
      comp: "Compensation is not stated in the posting, and the candidate set no numeric floor.",
    },
    redFlags: [
      "Compensation not disclosed in the posting",
      "Open to US and Europe only; remote is region-restricted rather than fully global",
      "Stack includes MobX, Temporal, and Google Cloud/k8s, which are not clearly in the candidate's profile",
    ],
    description: LINEAR_DESCRIPTION,
  },
  {
    id: "vercel-de",
    company: "Vercel",
    title: "Design Engineer",
    location: "Remote, United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 18",
    ageHours: 30,
    prescore: 0.4,
    state: "new",
    kind: "frontend",
    dims: [4, 5, 4, 4, 5, null],
    summary: "Design Engineer building polished, fast interfaces at the line between design and engineering, remote in the US.",
    reasons: {
      role: "Interface-heavy engineering with a strong design component; your design background and frontend depth both apply, though the role expects design ownership too.",
      tech: "React, Next.js and TypeScript are the core of the role and the core of your experience.",
      domain: "Developer tools and the web platform, which you listed as an interest.",
    },
    redFlags: ["Compensation not disclosed in the posting"],
  },
  {
    id: "mozilla-staff",
    company: "Mozilla",
    title: "Staff Software Engineer, Web Application Services",
    location: "Remote, US",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 15",
    ageHours: 60,
    prescore: 0.43,
    state: "new",
    kind: "fullstack",
    dims: [4, 4, 3, 5, 5, null],
    summary: "Staff IC on Mozilla's web application services, building full-stack web features, remote in the US.",
    redFlags: ["Compensation not disclosed in the posting"],
  },
  {
    id: "soundcloud",
    company: "SoundCloud",
    title: "Senior Full-Stack Engineer, Artist Success",
    location: "New York, NY",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 22",
    ageHours: 20,
    prescore: 0.43,
    state: "new",
    kind: "fullstack",
    dims: [5, 4, 5, 5, 2, null],
    summary: "Senior full-stack engineer on artist-facing tools at a music platform, on-site in New York.",
    reasons: {
      domain: "Music and creator tools: the audio domain you named first, and close to your own side projects.",
      logistics: "On-site in New York, which isn't one of your places.",
    },
    redFlags: ["On-site in New York, not Portland or Phoenix", "Compensation not disclosed in the posting"],
  },
  {
    id: "elastic",
    company: "Elastic",
    title: "Senior Software Engineer, Platform Billing Experience",
    location: "United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 16",
    ageHours: 70,
    prescore: 0.48,
    state: "new",
    kind: "fullstack",
    dims: [4, 4, 3, 4, 4, null],
    summary: "Senior engineer on the billing experience for Elastic's cloud platform, distributed across the US.",
    redFlags: ["Billing is a lateral move from the domains you're most interested in"],
  },
  {
    id: "talkspace",
    company: "Talkspace",
    title: "Senior Software Engineer, Tech Lead",
    location: "New York, NY (Remote)",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 13",
    ageHours: 90,
    prescore: 0.45,
    state: "new",
    kind: "lead",
    dims: [4, 4, 2, 4, 4, null],
    summary: "Senior engineer and tech lead on a remote US product team.",
  },
  {
    id: "roblox",
    company: "Roblox",
    title: "Principal Software Engineer, App Performance",
    location: "San Mateo, CA",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 21",
    ageHours: 26,
    prescore: 0.47,
    state: "new",
    kind: "frontend",
    dims: [4, 3, 5, 5, 2, null],
    summary: "Principal engineer on client app performance for a games platform, on-site in San Mateo.",
    reasons: {
      domain: "Games: one of the domains you named first.",
      logistics: "On-site in San Mateo, not Portland or Phoenix.",
    },
    redFlags: [
      "On-site in San Mateo, not Portland or Phoenix",
      "Principal level may expect deep native client performance experience",
    ],
  },
  {
    id: "sentry",
    company: "Sentry",
    title: "Senior Software Engineer, Billing Platform",
    location: "San Francisco, CA",
    remote: "hybrid",
    employment: "Full-time",
    comp: "$215–400k",
    postedLabel: "Oct 19",
    ageHours: 40,
    prescore: 0.48,
    state: "new",
    kind: "fullstack",
    dims: [4, 4, 4, 4, 2, 5],
    summary: "Senior engineer on Sentry's billing platform, hybrid in San Francisco, with a posted range.",
    redFlags: ["Hybrid in San Francisco, not Portland or Phoenix"],
  },
  {
    id: "bunch",
    company: "Bunch",
    title: "(Senior) Full-Stack Engineer, Frontend-leaning",
    location: "Spain",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 23",
    ageHours: 15,
    prescore: 0.47,
    state: "new",
    kind: "frontend",
    dims: [5, 4, 3, 4, 1, null],
    summary: "Frontend-leaning senior full-stack role on a platform team, hiring in Spain.",
    reasons: { logistics: "Remote within Spain only, so not workable from the US." },
    redFlags: ["Hiring in Spain only; not workable from the US"],
  },
  {
    id: "gitlab",
    company: "GitLab",
    title: "Senior Backend Engineer, Platform Enablement",
    location: "Remote, United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 11",
    ageHours: 100,
    prescore: 0.4,
    state: "new",
    kind: "backend",
    dims: [2, 3, 4, 4, 5, null],
  },
  {
    id: "roadie",
    company: "Roadie",
    title: "Senior Software Engineer, Backend",
    location: "Remote",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 24",
    ageHours: 8,
    prescore: 0.46,
    state: "new",
    kind: "backend",
    dims: [2, 3, 4, 4, 5, null],
  },
  {
    id: "supabase",
    company: "Supabase",
    title: "Cloud Platform Engineer",
    location: "Remote, Global",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 14",
    ageHours: 75,
    prescore: 0.43,
    state: "new",
    kind: "platform",
    dims: [2, 3, 4, 4, 5, null],
  },
  {
    id: "gruve",
    company: "Gruve",
    title: "Junior Full Stack Developer",
    location: "USA (Remote)",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 22",
    ageHours: 30,
    prescore: 0.17,
    state: "new",
    kind: "fullstack",
    dims: [3, 4, 2, 1, 5, null],
    redFlags: ["Junior level for someone at senior level"],
  },
  {
    id: "tailscale",
    company: "Tailscale",
    title: "Senior Solutions Engineer, Enterprise",
    location: "Remote (United States)",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 17",
    ageHours: 50,
    prescore: 0.41,
    state: "new",
    kind: "other",
    pending: [2, 3, 3, 4, 5, null],
  },
  {
    id: "afresh",
    company: "Afresh",
    title: "Staff Backend Engineer",
    location: "Remote, United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 24",
    ageHours: 12,
    prescore: 0.44,
    state: "new",
    kind: "backend",
    dims: [2, 3, 2, 5, 5, null],
  },
  {
    id: "webflow",
    company: "Webflow",
    title: "Lead Platform Engineer, Identity & Access",
    location: "United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 9",
    ageHours: 140,
    prescore: 0.32,
    state: "new",
    kind: "platform",
    pending: [2, 3, 4, 4, 4, null],
  },
  {
    id: "pagerduty",
    company: "PagerDuty",
    title: "Forward Deployed Engineer",
    location: "Remote (USA)",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 6",
    ageHours: 180,
    prescore: 0.13,
    state: "new",
    kind: "other",
    dims: [2, 3, 3, 4, 4, null],
  },
  {
    id: "notion",
    company: "Notion",
    title: "Software Engineer, Model Capabilities",
    location: "San Francisco, CA",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 20",
    ageHours: 36,
    prescore: 0.34,
    state: "new",
    kind: "backend",
    dims: [3, 3, 3, 4, 2, null],
  },
  {
    id: "render",
    company: "Render",
    title: "Software Engineering Manager, Billing",
    location: "Remote, United States",
    remote: "remote",
    employment: "Full-time",
    comp: "$236–295k",
    postedLabel: "Oct 15",
    ageHours: 66,
    prescore: 0.25,
    state: "new",
    kind: "lead",
    dims: [1, 3, 3, 2, 5, 5],
    redFlags: ["People-management role; you're looking for IC work"],
  },
  {
    id: "wonderschool",
    company: "Wonderschool",
    title: "Senior Software Engineer, Payments",
    location: "San Francisco, CA",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 2",
    ageHours: 200,
    prescore: 0.48,
    state: "new",
    kind: "fullstack",
    dims: [3, 4, 2, 4, 2, null],
  },
  {
    id: "imo",
    company: "Imo Online",
    title: "Senior AI/ML Engineer, Applications & Automation",
    location: "United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 1",
    ageHours: 220,
    prescore: 0.21,
    state: "new",
    kind: "other",
    dims: [2, 2, 3, 4, 4, null],
  },
  {
    id: "typeform",
    company: "Typeform",
    title: "Staff AI Engineer",
    location: "United Kingdom (Remote)",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 19",
    ageHours: 45,
    prescore: 0.35,
    state: "new",
    kind: "other",
    dims: [3, 3, 3, 5, 1, null],
  },
  {
    id: "scout-motors",
    company: "Scout Motors",
    title: "Senior DataOps Engineer",
    location: "Remote",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 7",
    ageHours: 160,
    prescore: 0.27,
    state: "new",
    kind: "platform",
    dims: [1, 2, 2, 4, 5, null],
  },
  {
    id: "backblaze",
    company: "Backblaze",
    title: "Senior Observability Systems Engineer",
    location: "Remote, US",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 5",
    ageHours: 190,
    prescore: 0.15,
    state: "new",
    kind: "platform",
    dims: [1, 2, 2, 4, 5, null],
  },
  {
    id: "cfa",
    company: "Code for America",
    title: "Engineering Manager",
    location: "Remote (U.S.)",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 3",
    ageHours: 210,
    prescore: 0.2,
    state: "new",
    kind: "lead",
    dims: [1, 3, 3, 2, 5, null],
  },
  {
    id: "apfm",
    company: "A Place For Mom",
    title: "Senior DevOps Engineer",
    location: "Remote",
    remote: "remote",
    employment: "Full-time",
    comp: "$150–180k",
    postedLabel: "Oct 10",
    ageHours: 130,
    prescore: 0.37,
    state: "new",
    kind: "platform",
    dims: [1, 2, 2, 4, 5, 3],
  },
  {
    id: "datagrail",
    company: "DataGrail",
    title: "Technical Success Engineer",
    location: "Remote, United States",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 8",
    ageHours: 150,
    prescore: 0.26,
    state: "new",
    kind: "other",
    dims: [1, 2, 2, 3, 5, null],
  },
  {
    id: "altruist",
    company: "Altruist",
    title: "Senior Back End Engineer, Platform",
    location: "Los Angeles, CA",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 13",
    ageHours: 90,
    prescore: 0.48,
    state: "new",
    kind: "backend",
    dims: [2, 3, 2, 4, 2, null],
  },
  {
    id: "zocdoc",
    company: "Zocdoc",
    title: "Senior Site Reliability Engineer",
    location: "New York, NY",
    remote: "hybrid",
    employment: "Full-time",
    postedLabel: "Oct 11",
    ageHours: 110,
    prescore: 0.33,
    state: "new",
    kind: "platform",
    dims: [1, 2, 2, 4, 2, null],
  },
  {
    id: "thermal",
    company: "Thermal Works",
    title: "Platform Engineer (ServiceNow)",
    location: "Remote, US",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 7",
    ageHours: 170,
    prescore: 0.27,
    state: "new",
    kind: "platform",
    dims: [1, 1, 2, 2, 5, null],
  },
  {
    id: "datadog-sales",
    company: "Datadog",
    title: "Senior Sales Engineer, AI Accounts",
    location: "California, USA",
    remote: "hybrid",
    employment: "Full-time",
    postedLabel: "Oct 12",
    ageHours: 120,
    prescore: 0.34,
    state: "new",
    kind: "other",
    dims: [1, 2, 2, 4, 2, null],
  },
  {
    id: "datadog-compute",
    company: "Datadog",
    title: "Staff Engineer, Compute",
    location: "Lisbon, Portugal",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 13",
    ageHours: 95,
    prescore: 0.48,
    state: "new",
    kind: "platform",
    dims: [2, 2, 3, 5, 1, null],
  },
  {
    id: "perplexity",
    company: "Perplexity",
    title: "Member of Data Staff, Analytics Engineering",
    location: "San Francisco, CA",
    remote: "onsite",
    employment: "Full-time",
    comp: "$175–330k",
    postedLabel: "Oct 14",
    ageHours: 80,
    prescore: 0.3,
    state: "new",
    kind: "other",
    dims: [1, 2, 3, 4, 2, 4],
  },
  {
    id: "tonal",
    company: "Tonal",
    title: "Senior Manager, Software Engineering",
    location: "San Francisco, CA",
    remote: "onsite",
    employment: "Full-time",
    comp: "$230–275k",
    postedLabel: "Oct 9",
    ageHours: 140,
    prescore: 0.42,
    state: "new",
    kind: "lead",
    dims: [1, 3, 4, 2, 2, 5],
  },
  {
    id: "ramp",
    company: "Ramp",
    title: "Software Engineering Intern, iOS",
    location: "New York, NY",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "Oct 15",
    ageHours: 60,
    prescore: 0.01,
    state: "new",
    kind: "other",
    dims: [1, 1, 2, 1, 2, null],
  },
  {
    id: "jetbrains",
    company: "JetBrains",
    title: "Customer Success Engineer, LATAM",
    location: "Remote",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 11",
    ageHours: 100,
    prescore: 0.15,
    state: "new",
    kind: "other",
    dims: [1, 2, 4, 2, 2, null],
  },
  {
    id: "cloudflare-tse",
    company: "Cloudflare",
    title: "Technical Support Engineer, Developer Platform",
    location: "Austin, TX",
    remote: "hybrid",
    employment: "Full-time",
    postedLabel: "Oct 14",
    ageHours: 70,
    prescore: 0.46,
    state: "new",
    kind: "other",
    dims: [1, 3, 4, 2, 2, null],
  },

  // Real postings found on public ATS boards on Oct 24, 2026, so the Where filter has local jobs to show.
  // Titles, companies, locations and comp are as posted; dimension scores are illustrative.
  {
    id: "smarsh",
    company: "Smarsh",
    title: "Sr. Full-Stack Developer, AI-forward",
    location: "US - Remote",
    remote: "remote",
    employment: "Full-time",
    comp: "$147–167k",
    postedLabel: "date not listed",
    ageHours: 6,
    prescore: 0.47,
    state: "new",
    kind: "fullstack",
    dims: [5, 4, 2, 4, 5, 3],
    summary:
      "Senior full-stack developer on AI features at a communications-compliance company headquartered in Portland. The role itself is remote in the US.",
    reasons: {
      domain: "Compliance and archiving software: a domain you didn't express interest in.",
      logistics: "Remote in the US. The company is based in Portland, which helps once you move.",
    },
    redFlags: ["The range tops out at $167k"],
  },
  {
    id: "fictiv",
    company: "Fictiv",
    title: "Senior Software Engineer (West Coast - Oakland, CA or Portland, OR Preferred)",
    location: "Oakland, CA or Portland, OR preferred | Open to remote in CA, OR, WA",
    remote: "onsite",
    employment: "Full-time",
    comp: "$160–200k",
    postedLabel: "date not listed",
    ageHours: 10,
    prescore: 0.45,
    state: "new",
    kind: "backend",
    dims: [3, 4, 3, 5, 5, 4],
    summary:
      "Senior backend engineer on event-driven Node.js, TypeScript and AWS services for a cloud manufacturing platform. Portland is a preferred office, and remote is allowed in CA, OR and WA.",
    reasons: {
      role: "Backend-leaning: services and APIs rather than product UI, though TypeScript end to end.",
      tech: "Node.js and TypeScript are core skills for you; SQS, Lambda and RDS are adjacent.",
      logistics: "Portland is one of the two preferred offices, and remote within Oregon also counts.",
    },
    redFlags: ["Remote is limited to CA, OR and WA, so it doesn't cover Phoenix"],
  },
  {
    id: "panthalassa",
    company: "Panthalassa",
    title: "Senior Software Engineer, Core Systems",
    location: "Portland, OR",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "date not listed",
    ageHours: 18,
    prescore: 0.44,
    state: "new",
    kind: "backend",
    dims: [3, 3, 3, 5, 5, null],
    summary: "Senior software engineer on core systems at an ocean-energy company, on-site in Portland.",
    reasons: {
      domain: "Renewable ocean energy: not games or audio, but software close to hardware with a clear mission.",
      logistics: "On-site in Portland, one of your places.",
    },
    redFlags: ["Core systems may lean toward embedded or controls work rather than product UI"],
  },
  {
    id: "smartrent",
    company: "SmartRent",
    title: "Senior Software Engineer",
    location: "Phoenix, Arizona",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "date not listed",
    ageHours: 22,
    prescore: 0.42,
    state: "new",
    kind: "fullstack",
    dims: [3, 3, 3, 5, 5, null],
    summary: "Senior software engineer at a smart-home and property-automation company, in Phoenix.",
    reasons: { logistics: "In Phoenix, one of your places." },
    redFlags: ["The board doesn't list the stack; check the posting"],
  },
  {
    id: "phoenix-co",
    company: "Phoenix",
    title: "Senior Frontend Developer (React)",
    location: "Toronto, ON",
    remote: "onsite",
    employment: "Full-time",
    postedLabel: "date not listed",
    ageHours: 4,
    prescore: 0.5,
    state: "new",
    kind: "frontend",
    dims: [5, 5, 3, 4, 1, null],
    summary: "Senior React developer at a Toronto telehealth company named Phoenix, on-site at its downtown HQ.",
    reasons: {
      logistics: "On-site in Toronto, Canada. Not workable from the US. The company is named Phoenix; it isn't in Phoenix.",
    },
    redFlags: ["On-site in Toronto; not workable from the US"],
  },

  // Jobs that already have applications
  {
    id: "linear-fs",
    company: "Linear",
    title: "Senior / Staff Fullstack Engineer",
    location: "North America",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Mar 3",
    ageHours: 58,
    prescore: 0.75,
    state: "prepped",
    kind: "fullstack",
    dims: [5, 4, 3, 5, 5, null],
  },
  {
    id: "canva",
    company: "Canva",
    title: "Senior Backend Engineer, Export",
    location: "Remote, US",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 12",
    ageHours: 120,
    prescore: 0.44,
    state: "submitted",
    kind: "backend",
    dims: [3, 3, 4, 4, 4, null],
  },
  {
    id: "mozilla-sse",
    company: "Mozilla",
    title: "Senior Software Engineer",
    location: "Remote, US",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 16",
    ageHours: 80,
    prescore: 0.45,
    state: "prepped",
    kind: "fullstack",
    dims: [4, 4, 3, 4, 5, null],
  },
  {
    id: "discord",
    company: "Discord",
    title: "Staff Software Engineer, Safety Processing",
    location: "Remote, US",
    remote: "remote",
    employment: "Full-time",
    postedLabel: "Oct 17",
    ageHours: 76,
    prescore: 0.42,
    state: "prepped",
    kind: "backend",
    dims: [3, 3, 3, 5, 5, null],
  },
  {
    id: "spotify",
    company: "Spotify",
    title: "Product Manager, Data Platform",
    location: "New York, NY",
    remote: "hybrid",
    employment: "Full-time",
    postedLabel: "Oct 18",
    ageHours: 72,
    prescore: 0.31,
    state: "prepped",
    kind: "other",
    dims: [1, 2, 3, 4, 2, null],
  },

  // Unscored, ordered by prescore. `pending` is what scoring will return in the prototype.
  { id: "u-veeam-mule", company: "Veeam Software", title: "Software Development Engineer III, MuleSoft", location: "Remote, United States", remote: "remote", employment: "Full-time", postedLabel: "Oct 12", ageHours: 120, prescore: 0.26, state: "new", kind: "backend", pending: [2, 2, 2, 3, 5, null] },
  { id: "u-disco", company: "DISCO", title: "Litigation Engineer", location: "Remote, USA", remote: "remote", employment: "Full-time", postedLabel: "Oct 10", ageHours: 140, prescore: 0.18, state: "new", kind: "other", pending: [1, 2, 2, 3, 5, null] },
  { id: "u-ocrolus", company: "Ocrolus", title: "Mortgage Forward Deployed Engineer", location: "Remote - US", remote: "remote", employment: "Full-time", postedLabel: "Oct 9", ageHours: 150, prescore: 0.14, state: "new", kind: "other", pending: [1, 2, 2, 3, 5, null] },
  { id: "u-abc", company: "ABC Legal Services", title: "Sr. Database Engineer, PostgreSQL/AWS Aurora", location: "US REMOTE", remote: "remote", employment: "Full-time", postedLabel: "Oct 8", ageHours: 160, prescore: 0.09, state: "new", kind: "backend", pending: [1, 2, 1, 4, 5, null] },
  { id: "u-veeam", company: "Veeam Software", title: "Staff Software Development Engineer in Test", location: "San Jose, CA", remote: "onsite", employment: "Full-time", postedLabel: "Oct 20", ageHours: 34, prescore: 0.49, state: "new", kind: "other", pending: [2, 2, 2, 5, 2, null] },
  { id: "u-cf-gtm", company: "Cloudflare", title: "Principal Engineer, GTM Data Platform", location: "Hybrid", remote: "hybrid", employment: "Full-time", postedLabel: "Oct 21", ageHours: 28, prescore: 0.48, state: "new", kind: "platform", pending: [2, 2, 3, 5, 3, null] },
  { id: "u-roblox-rel", company: "Roblox", title: "Senior Software Engineer, Release", location: "San Mateo, CA", remote: "onsite", employment: "Full-time", postedLabel: "Oct 22", ageHours: 22, prescore: 0.48, state: "new", kind: "platform", pending: [3, 3, 5, 5, 2, null] },
  { id: "u-roblox-data", company: "Roblox", title: "Senior Software Engineer, Data Infrastructure", location: "San Mateo, CA", remote: "onsite", employment: "Full-time", postedLabel: "Oct 22", ageHours: 22, prescore: 0.48, state: "new", kind: "backend", pending: [2, 2, 5, 5, 2, null] },
  { id: "u-dd-pmm", company: "Datadog", title: "Senior Product Marketing Manager", location: "New York, NY", remote: "onsite", employment: "Full-time", postedLabel: "Oct 19", ageHours: 44, prescore: 0.48, state: "new", kind: "other", pending: [1, 1, 3, 4, 2, null] },
  { id: "u-checkr", company: "Checkr", title: "Staff Product Manager", location: "San Francisco, CA", remote: "onsite", employment: "Full-time", postedLabel: "Oct 18", ageHours: 50, prescore: 0.48, state: "new", kind: "other", pending: [1, 1, 2, 4, 2, null] },
  { id: "u-aura", company: "Aura", title: "Senior Software Engineer, AI Intelligence Platform", location: "Remote, Poland", remote: "remote", employment: "Full-time", postedLabel: "Oct 23", ageHours: 14, prescore: 0.47, state: "new", kind: "fullstack", pending: [4, 4, 3, 4, 1, null] },
  { id: "u-dmatrix", company: "d-Matrix", title: "Principal Test Automation Engineer", location: "Santa Clara, CA", remote: "hybrid", employment: "Full-time", comp: "$195–285k", postedLabel: "Oct 17", ageHours: 60, prescore: 0.43, state: "new", kind: "other", pending: [1, 2, 2, 5, 2, 5] },
  { id: "u-lendbuzz", company: "Lendbuzz", title: "Platform Engineering Team Lead", location: "Tel Aviv", remote: "hybrid", employment: "Full-time", postedLabel: "Oct 16", ageHours: 70, prescore: 0.43, state: "new", kind: "lead", pending: [2, 3, 2, 3, 1, null] },
  { id: "u-flexe", company: "Flexe", title: "Software Development Engineer II", location: "Seattle, WA", remote: "hybrid", employment: "Full-time", postedLabel: "Oct 15", ageHours: 80, prescore: 0.39, state: "new", kind: "fullstack", pending: [4, 4, 2, 2, 2, null] },
  { id: "u-invisible", company: "Invisible Technologies", title: "Software Engineer, Agentic AI", location: "Brazil (Remote)", remote: "remote", employment: "Contract", postedLabel: "Oct 21", ageHours: 30, prescore: 0.36, state: "new", kind: "fullstack", pending: [4, 3, 3, 3, 1, null] },
  { id: "u-axion", company: "Axion", title: "Senior Forward Deployed Engineer", location: "New York, NY", remote: "hybrid", employment: "Full-time", comp: "$220–270k", postedLabel: "Oct 20", ageHours: 36, prescore: 0.35, state: "new", kind: "other", pending: [2, 3, 3, 4, 2, 5] },
  { id: "u-plasmid", company: "Plasmidsaurus", title: "Senior Platform Engineer, Lab Infrastructure", location: "San Francisco, CA", remote: "hybrid", employment: "Full-time", comp: "$205–250k", postedLabel: "Oct 19", ageHours: 46, prescore: 0.3, state: "new", kind: "platform", pending: [2, 2, 2, 4, 2, 5] },
  { id: "u-startree", company: "StarTree", title: "Technical Support Engineer", location: "India (Remote)", remote: "remote", employment: "Full-time", postedLabel: "Oct 18", ageHours: 52, prescore: 0.28, state: "new", kind: "other", pending: [1, 2, 3, 3, 1, null] },
  { id: "u-patch", company: "Patch", title: "VP, AI Product & Engineering", location: "New York, NY", remote: "onsite", employment: "Full-time", postedLabel: "Oct 14", ageHours: 96, prescore: 0.19, state: "new", kind: "lead", pending: [1, 2, 3, 2, 2, null] },
  { id: "u-practice", company: "Practice Better", title: "Intermediate DevOps Engineer", location: "Remote, Canada", remote: "remote", employment: "Full-time", postedLabel: "Oct 12", ageHours: 120, prescore: 0.16, state: "new", kind: "platform", pending: [1, 2, 2, 2, 1, null] },
  { id: "u-carwow", company: "Carwow", title: "Technical Engineering Manager", location: "United Kingdom", remote: "remote", employment: "Full-time", postedLabel: "Oct 11", ageHours: 130, prescore: 0.13, state: "new", kind: "lead", pending: [1, 3, 2, 2, 1, null] },
];

/* ---------- Generated reasons for jobs without hand-written ones ---------- */

const GENERIC: Record<DimKey, Record<number, string>> = {
  role: {
    5: "Squarely the product-focused full-stack work you want.",
    4: "Close to your core work, with some emphasis outside frontend.",
    3: "A partial fit: the role leans away from frontend product work.",
    2: "Mostly backend, platform or infrastructure work, adjacent to your strengths.",
    1: "A different job family (management, sales, support or data) from what you're looking for.",
  },
  tech: {
    5: "The stack matches your experience almost entirely.",
    4: "Most of the stack is in your skills; a few tools would be new.",
    3: "Some overlap, but the core of the stack is outside your recent work.",
    2: "Little overlap with your stack.",
    1: "The stack doesn't overlap with your experience.",
  },
  domain: {
    5: "Games, audio or creative tools: the domains you named first.",
    4: "Developer tools or creative-adjacent work you said you want.",
    3: "A general product domain: neither a draw nor a negative.",
    2: "A domain you didn't express interest in.",
    1: "A domain you said you're done with.",
  },
  seniority: {
    5: "Senior or staff individual contributor, the level you want.",
    4: "Senior level; scope or title is slightly ambiguous.",
    3: "The level is unclear from the posting.",
    2: "Not a senior IC role: people management, or a level outside what you want.",
    1: "Junior or intern level.",
  },
  logistics: {
    5: "Remote in the US, or in the Portland or Phoenix area. All workable for you.",
    4: "Workable, with minor constraints.",
    3: "Some friction: hybrid expectations or timezone limits.",
    2: "On-site outside Portland and Phoenix, which aren't your places.",
    1: "Not workable from the US.",
  },
  comp: {
    5: "The listed range clears your floor comfortably.",
    4: "The range is at or above your floor.",
    3: "The range overlaps your floor.",
    2: "The range sits mostly below your floor.",
    1: "The range is well below your floor.",
  },
};

export function reasonFor(job: DemoJob, key: DimKey, value: number | null): string {
  const custom = job.reasons?.[key];
  if (custom) return custom;
  if (value == null) return "Compensation isn't listed, so it's left out of the average instead of counting against the job.";
  return GENERIC[key][value] ?? "";
}

const BULLETS: Record<NonNullable<DemoJob["kind"]>, string[]> = {
  frontend: [
    "Build and ship product interfaces end to end",
    "Own performance and quality of the user experience",
    "Work closely with design on interaction details",
  ],
  fullstack: [
    "Ship product features across the frontend and the API",
    "Own features from data model to polished UI",
    "Improve performance, reliability and developer experience",
  ],
  backend: [
    "Design, build and operate backend services and APIs",
    "Improve reliability, scalability and observability",
    "Partner with product teams on platform needs",
  ],
  platform: [
    "Build and run the infrastructure other teams ship on",
    "Automate deployment, monitoring and incident response",
    "Improve cost, reliability and security across environments",
  ],
  lead: [
    "Lead a team's technical direction and delivery",
    "Hire, mentor and grow engineers",
    "Work with product and design on roadmap and priorities",
  ],
  other: [
    "Work with customers and internal teams on technical problems",
    "Turn findings into product and process improvements",
    "Communicate clearly across engineering and business teams",
  ],
};

export function descriptionFor(job: DemoJob): string {
  if (job.description) return job.description;
  const bullets = BULLETS[job.kind ?? "other"].map((b) => `- ${b}`).join("\n");
  return `About the role\n${job.summary ?? `${job.title} at ${job.company}.`}\n\nWhat you'll do\n${bullets}\n\nSample description. The real posting text renders here with its own headings and lists.`;
}

/* ---------- Applications ---------- */

export type AppStatus = "prepped" | "submitted" | "interviewing" | "offer" | "rejected";

export interface DemoApp {
  id: string;
  jobId: string;
  status: AppStatus;
  updatedLabel: string;
  submittedLabel?: string;
  followUpLabel?: string;
}

export const APPS: DemoApp[] = [
  { id: "linear", jobId: "linear-fs", status: "prepped", updatedLabel: "Today, 7:34 PM" },
  { id: "canva", jobId: "canva", status: "submitted", updatedLabel: "Today, 9:12 AM", submittedLabel: "Oct 24", followUpLabel: "Oct 31" },
  { id: "mozilla", jobId: "mozilla-sse", status: "prepped", updatedLabel: "Yesterday" },
  { id: "discord", jobId: "discord", status: "prepped", updatedLabel: "Yesterday" },
  { id: "spotify", jobId: "spotify", status: "prepped", updatedLabel: "Oct 22" },
];

const TELL_US_MORE = `The project I led end to end is Loopwell, a collaborative music sequencer that runs in the browser. The problem was that existing tools made sharing a work-in-progress track slow and lossy, so I made real-time collaboration the core of the product. I built the client in TypeScript and React on a Web Audio engine, with a Go sync service, PostgreSQL for projects, object storage for samples, and Stripe for billing. The hardest tradeoff was conflict resolution: I designed an operation log with per-track ordering, idempotent replays, and server-side snapshots, so two people editing the same pattern never lose work. I also built OAuth sign-in, shareable project links, and offline editing with background sync, then shipped the public beta to its first thousand users.`;

export const COVER_NOTE = `Dear Linear team,

Your posting asks for someone who can take a feature from database model to GraphQL resolver to polished UI, and who cares about speed. That is how I work. At Fabrikam Logistics I lead frontend for a real-time fleet-tracking platform in React and TypeScript. Last year I rebuilt its live map and vehicle list around virtualization and incremental updates, and the dashboard now opens in under a second. That maps closely to your virtualized list profiling and sync work.

I'm also building Loopwell, a collaborative music sequencer, on my own. I own everything from the Go backend and Postgres to auth, billing, and a launched public beta. I'm comfortable without PM oversight and shipping end to end.

Linear's focus on tools for teams and agents, with craft as the bar, is the work I want to do next. I'd love to talk.`;

const PROFILE_FIELDS: FillField[] = [
  { id: "resume", label: "Resume", value: "Kris_Tester_Resume.pdf", state: "filled", source: "resume" },
  { id: "name", label: "Name", value: "Kris Tester", state: "filled", source: "profile" },
  { id: "email", label: "Email", value: "k••••••@example.com", state: "filled", source: "profile" },
  { id: "cover", label: "Cover letter", value: `Attached, ${COVER_NOTE.split(/\s+/).filter(Boolean).length} words`, state: "filled", source: "cover-note" },
  { id: "github", label: "GitHub", value: "github.com/kris-tester", state: "filled", source: "profile" },
  { id: "linkedin", label: "LinkedIn", value: "linkedin.com/in/kris-tester", state: "filled", source: "profile" },
  { id: "country", label: "What country are you based in?", value: "United States", state: "filled", source: "profile" },
];

export function fieldsFor(appId: string): FillField[] {
  if (appId === "linear") {
    return [
      {
        id: "timezone",
        label: "Are you based in a US or equivalent timezone?",
        value: "Yes",
        state: "review",
        source: "drafted",
        required: true,
      },
      { id: "tell", label: "Tell us more", value: TELL_US_MORE, state: "review", source: "drafted", required: true },
      ...PROFILE_FIELDS,
      { id: "x", label: "X", state: "blank", note: "Blank on purpose: no answer recorded for this question" },
      {
        id: "referral",
        label: "Has someone at Linear referred you for this role? If so, please include their name here:",
        state: "blank",
        note: "Blank on purpose: no referral recorded",
      },
    ];
  }
  if (appId === "canva") {
    return [
      ...PROFILE_FIELDS,
      { id: "auth", label: "Are you authorized to work in the US?", value: "Yes", state: "filled", source: "profile" },
      { id: "sponsor", label: "Will you require sponsorship?", value: "No", state: "filled", source: "profile" },
    ];
  }
  return [
    ...PROFILE_FIELDS,
    { id: "auth", label: "Are you authorized to work in the US?", value: "Yes", state: "filled", source: "profile" },
    { id: "start", label: "Earliest start date", value: "Immediately", state: "filled", source: "profile" },
    { id: "hear", label: "How did you hear about us?", value: "Company careers page", state: "filled", source: "profile" },
  ];
}

export const STANDARD_ANSWERS: { id: string; label: string; value: string }[] = [
  { id: "auth", label: "Work authorization (US)", value: "Yes" },
  { id: "sponsor", label: "Require sponsorship", value: "No" },
  { id: "location", label: "Current location", value: "Portland, OR" },
  { id: "relocate", label: "Willing to relocate", value: "No" },
  { id: "start", label: "Earliest start date", value: "Immediately" },
  { id: "salary", label: "Salary expectation", value: "Negotiable, based on the full package" },
  { id: "hear", label: "How did you hear", value: "Company careers page" },
];

export const TIMELINE_LINEAR: TimelineGroup[] = [
  {
    day: "Today",
    items: [
      { id: "t1", time: "7:34 PM", title: "Filled the application in Chrome", detail: "9 fields filled, 2 drafted for review, resume attached", kind: "fill" },
      { id: "t2", time: "7:31 PM", title: "Re-prepared resume, cover note and answers", kind: "prep" },
      { id: "t3", time: "7:17 PM", title: "Filled the application in Chrome", detail: "9 fields filled", kind: "fill" },
      { id: "t4", time: "4:16 PM", title: "Re-prepared resume, cover note and answers", kind: "prep" },
      { id: "t5", time: "11:54 AM", title: "Prepared resume, cover note and answers", kind: "prep" },
      { id: "t6", time: "11:52 AM", title: "Shortlisted from triage", kind: "triage" },
    ],
  },
  {
    day: "Yesterday",
    items: [
      { id: "t7", time: "5:03 PM", title: "Drafted answers to the form's screening questions", detail: "2 answers drafted from your profile", kind: "draft" },
      { id: "t8", time: "4:18 PM", title: "Prepared resume and cover note", kind: "prep" },
      { id: "t9", time: "3:16 PM", title: "Scored 93, strong match", detail: "claude-haiku-5-5, rubric dims-v2", kind: "score" },
    ],
  },
];
