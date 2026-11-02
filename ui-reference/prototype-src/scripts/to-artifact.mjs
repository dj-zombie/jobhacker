// Turn Vite's single-file build into an artifact page fragment (no html/head/body tags).
import fs from "node:fs";
const html = fs.readFileSync("dist/index.html", "utf8");
const headStart = html.indexOf("<head>");
const headEnd = html.indexOf("</head>");
let head = html.slice(headStart + 6, headEnd);

// Pull the module script out first: its JS can contain "<style>" text that a naive regex would match.
const sOpen = head.search(/<script type="module"[^>]*>/);
if (sOpen < 0) throw new Error("no module script");
const sTagEnd = head.indexOf(">", sOpen) + 1;
const sClose = head.indexOf("</script>", sTagEnd);
const js = head.slice(sTagEnd, sClose);
head = head.slice(0, sOpen) + head.slice(sClose + 9);

const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? "<title>JobHacker</title>";
const styles = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => `<style>${m[1]}</style>`);
if (!styles.length) throw new Error("no inlined styles");

const out = [title, ...styles, '<div id="root"></div>', `<script type="module">${js}</script>`].join("\n");
fs.mkdirSync("artifact", { recursive: true });
fs.writeFileSync("artifact/jobhacker.html", out);

const host = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n${out}\n</body></html>`;
fs.writeFileSync("artifact/host-preview.html", host);
console.log("fragment bytes", out.length, "styles", styles.length);
