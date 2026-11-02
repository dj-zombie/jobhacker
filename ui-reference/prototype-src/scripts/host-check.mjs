import { chromium } from "playwright";
import path from "node:path";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const url = "file://" + path.resolve("artifact/host-preview.html");
const results = {};
for (const [name, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(url);
  await p.waitForTimeout(1500);
  results[name] = await p.evaluate(() => {
    const b = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    return {
      bodyFont: b.fontFamily.slice(0, 40),
      bodyBg: b.backgroundColor,
      colorScheme: root.colorScheme,
      geistLoaded: document.fonts.check('14px "Geist"'),
      pageScrollsX: document.documentElement.scrollWidth > window.innerWidth,
      pageScrollsY: document.documentElement.scrollHeight > window.innerHeight + 1,
      rows: document.querySelectorAll('[role="option"]').length,
    };
  });
  results[name].errors = errors;
  await p.screenshot({ path: `../shots/23-host-${name}.png` });
  await p.close();
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
