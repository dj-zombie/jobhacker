import type {
  EducationValue,
  ExperienceValue,
  KeyedValue,
  SelfIdValue,
  SkillGroupText,
} from "@/components/jobhacker";

/* Fictional profile for the Settings frames: Kris Tester, placeholder links, made-up employers. */

export interface DemoProfile {
  contact: { name: string; email: string; phone: string; location: string };
  links: { linkedin: string; github: string; portfolio: string };
  summary: string;
  skills: SkillGroupText[];
  experience: ExperienceValue[];
  education: EducationValue[];
  standard_answers: KeyedValue[];
  self_identification: SelfIdValue;
  preferences: string;
}

export const DEMO_PROFILE: DemoProfile = {
  contact: { name: "Kris Tester", email: "kris@example.com", phone: "+1 555 010 0199", location: "Portland, OR" },
  links: {
    linkedin: "https://linkedin.com/in/kris-tester",
    github: "https://github.com/kris-tester",
    portfolio: "https://example.com",
  },
  summary:
    "Full-stack engineer with 12 years building web products, most recently a fleet-tracking platform used by 400 logistics teams. Happiest owning a feature from schema to pixels, and pairing with designers on the hard interactions.\n",
  skills: [
    { group: "languages", items: "TypeScript, JavaScript, Go, SQL" },
    { group: "frontend", items: "React, Next.js, CSS, WebGL" },
    { group: "backend", items: "Node.js, PostgreSQL, Redis" },
  ],
  experience: [
    {
      id: "fabrikam",
      company: "Fabrikam",
      title: "Senior Full-Stack Engineer",
      start: "2021-03",
      end: "present",
      location: "Remote",
      bullets: [
        { id: "fabrikam-1", text: "Leads frontend for the fleet-tracking platform, a React and Go app used by 400 logistics teams." },
        { id: "fabrikam-2", text: "Rebuilt the live map and vehicle list, cutting time to first paint from 4.1s to 1.3s." },
      ],
    },
    {
      id: "loopwell",
      company: "Loopwell",
      title: "Full-Stack Developer",
      start: "2017-06",
      end: "2021-02",
      location: "Portland, OR",
      bullets: [{ id: "loopwell-1", text: "Built the scheduling API and its admin UI in Node.js and React." }],
    },
    {
      id: "northwind-games",
      company: "Northwind Games",
      title: "Web Developer",
      start: "2012",
      end: "2015",
      location: "",
      bullets: [{ id: "northwind-games-1", text: "Shipped the studio's community site and its tournament brackets." }],
    },
  ],
  education: [
    { id: "example-state", school: "Example State University", credential: "B.S. Computer Science", start: "2008", end: "2012" },
  ],
  standard_answers: [
    { key: "work_authorization_us", value: "Yes" },
    { key: "require_sponsorship", value: "No" },
    { key: "willing_to_relocate", value: "[NEEDS INPUT]" },
    { key: "current_location", value: "Portland, OR" },
    { key: "earliest_start_date", value: "Two weeks from offer" },
    { key: "salary_expectation", value: "[NEEDS INPUT]" },
    { key: "how_did_you_hear", value: "Company careers page" },
  ],
  self_identification: {
    gender: "decline",
    race_ethnicity: "decline",
    veteran_status: "decline",
    disability_status: "decline",
    overrides: [],
  },
  preferences:
    "# What I want\n\nSenior or staff full-stack roles where I own features end to end, at product companies with a real design culture.\n\nI like developer tools, maps and logistics, and games. I'd rather not work on ad tech or crypto.\n\nRemote in the US, or hybrid in Portland or Phoenix.\n",
};

/** The demo's stand-in for the re-score check: the sample's current scores, priced at a sample rate. */
export const DEMO_RESCORE = {
  stale: 1108,
  cost: "$16.62",
  costBasis: "November's mean of $0.015 a score, over 1,108 scoring calls",
  perRun: 150,
};
