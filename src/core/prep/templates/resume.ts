/**
 * The resume template. ARCHITECTURE listed this as `templates/resume.html`; it
 * is a `.ts` module instead so it bundles identically for the `tsx` CLI and the
 * Next server runtime with no fragile runtime file reads (DECISIONS D19). The
 * markup is deliberately plain and single-column so it survives ATS parsing.
 */

export const RESUME_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111;
    font-size: 11pt;
    line-height: 1.4;
    margin: 0;
  }
  .page { padding: 0.6in 0.7in; }
  h1 { font-size: 20pt; margin: 0 0 2px; }
  .contact { color: #333; font-size: 10pt; margin-bottom: 2px; }
  .links { color: #333; font-size: 10pt; }
  .links a { color: #111; text-decoration: none; }
  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid #999;
    padding-bottom: 2px;
    margin: 18px 0 8px;
  }
  .summary { margin: 0; }
  .skills p { margin: 2px 0; }
  .skills .group { font-weight: 600; }
  .entry { margin-bottom: 12px; }
  .entry-head { display: flex; justify-content: space-between; gap: 12px; }
  .entry-title { font-weight: 600; }
  .entry-meta { color: #555; font-size: 10pt; white-space: nowrap; }
  ul { margin: 4px 0 0; padding-left: 18px; }
  li { margin: 2px 0; }
  .letter { margin-top: 24px; }
  .letter p { margin: 0 0 12px; }
`;

/** Wrap rendered section HTML in a full, self-contained document. */
export function resumeDocument(innerHtml: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${RESUME_CSS}</style>
</head>
<body>
<div class="page">
${innerHtml}
</div>
</body>
</html>`;
}
