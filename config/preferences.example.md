# Job preferences

<!--
Copy to config/preferences.md (gitignored) and rewrite it in your own words.
This is the single source of taste (FR-12). Nothing here is matched as a literal:
the scoring model reads it as prose and scores each job on six dimensions
(role, tech, domain interest, seniority, logistics, compensation). Say what you
want, what you would trade for it, and what is a dealbreaker. Facts about your
experience belong in profile.yaml, not here. Editing this file re-scores jobs on
the next scoring run; changing weights in criteria.yaml does not.

The zero-cost prescore also extracts stemmed terms from this prose to prioritize
which jobs are scored first. That lexical signal never makes a job ineligible:
repeated capped runs eventually score every job that passes the four gates.

Everything below is an example. Replace it with what is true for you.
-->

## Roles I want

Senior or staff individual-contributor engineering: frontend-heavy full-stack
work, product engineering, internal tools and developer tooling. Titles vary a
lot between companies; judge the work, not the exact title.

## Roles I don't want

No people management (engineering manager, director). Not junior, new-grad or
intern roles. Not sales, recruiting, solutions or support roles, even when the
title says "engineer".

## Where I can work

Name the places from `criteria.yaml` and say how each one fits.

- Portland: on-site, hybrid and remote are all fine.
- Phoenix: hybrid or remote.
- Remote: anywhere in the US.
- Any other city: fully remote only.

## Employment type

Full-time. Contract only for six months or longer.

## Compensation

Say a floor here if you have one. A posting without pay listed counts as neutral.

## What I would be most excited about

- developer tools
- creative tools
- products with a strong design culture
