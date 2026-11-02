import { chromium } from "playwright";
import path from "node:path";

const url = "file://" + path.resolve("dist/index.html");
const out = process.argv[2] || "../screens";
const only = process.argv[3] || "";
const errors = [];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function page(w, h, query = "") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(url + query);
  await p.waitForTimeout(1400);
  return p;
}
const shot = async (p, name) => {
  if (only && !name.includes(only)) return;
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

// Desktop 1440
{
  const p = await page(1440, 900);
  await shot(p, "01-top-1440");
  await p.keyboard.press("j");
  await p.keyboard.press("j");
  await p.waitForTimeout(900);
  await shot(p, "02-top-j2-1440");
  // hover a row for quick actions
  const rows = p.locator('[role="option"]');
  await rows.nth(4).hover();
  await p.waitForTimeout(300);
  await shot(p, "03-row-hover-1440");
  // shortlist -> toast
  await p.keyboard.press("s");
  await p.waitForTimeout(500);
  await shot(p, "04-shortlist-toast-1440");
  // tune
  await p.keyboard.press("t");
  await p.waitForTimeout(500);
  await shot(p, "05-tune-1440");
  // move domain slider up 4 steps
  const thumbs = p.locator('[role="slider"]');
  await thumbs.nth(2).focus();
  for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(900);
  await shot(p, "06-tune-domain-1440");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  // palette
  await p.keyboard.press("Control+k");
  await p.waitForTimeout(400);
  await p.keyboard.type("roblox");
  await p.waitForTimeout(300);
  await shot(p, "07-palette-1440");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  // shortcuts
  await p.keyboard.press("?");
  await p.waitForTimeout(400);
  await shot(p, "08-shortcuts-1440");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  // unscored
  await p.getByRole("link", { name: /Unscored/ }).click();
  await p.waitForTimeout(1000);
  await shot(p, "09-unscored-1440");
  // applications
  await p.getByRole("link", { name: /In progress/ }).click();
  await p.waitForTimeout(800);
  await shot(p, "10-applications-1440");
  await p.getByRole("button", { name: /Senior \/ Staff Fullstack Engineer/ }).click();
  await p.waitForTimeout(900);
  await shot(p, "11-workspace-apply-1440");
  await p.mouse.wheel(0, 700);
  await p.waitForTimeout(400);
  await shot(p, "12-workspace-apply-scrolled-1440");
  await p.getByRole("button", { name: "Looks good" }).first().click();
  await p.waitForTimeout(900);
  await p.mouse.wheel(0, -2000);
  await p.waitForTimeout(400);
  await shot(p, "13-workspace-approved-1440");
  await p.getByRole("tab", { name: "Resume" }).click();
  await p.waitForTimeout(600);
  await shot(p, "14-workspace-resume-1440");
  await p.getByRole("tab", { name: "Answers" }).click();
  await p.waitForTimeout(600);
  await shot(p, "15a-workspace-answers-1440");
  await p.getByRole("tab", { name: "Activity" }).click();
  await p.waitForTimeout(600);
  await shot(p, "15-workspace-activity-1440");
  await p.context().close();
}

// Where filter
{
  const p = await page(1440, 900);
  await p.getByRole("button", { name: /^Anywhere$/ }).click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /^Portland/ }).click();
  await p.waitForTimeout(900);
  await shot(p, "22-where-portland-1440");
  await p.locator('[role="option"]', { hasText: "Fictiv" }).click();
  await p.waitForTimeout(900);
  await shot(p, "23-where-portland-fictiv-1440");
  await p.getByRole("button", { name: /^Anywhere$/ }).click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /^Phoenix/ }).click();
  await p.waitForTimeout(900);
  await shot(p, "24-where-phoenix-1440");
  await p.getByRole("button", { name: /^Anywhere$/ }).click();
  await p.waitForTimeout(900);
  await p.locator('[role="option"]', { hasText: "Senior Frontend Developer (React)" }).click();
  await p.waitForTimeout(900);
  await shot(p, "25-where-anywhere-toronto-1440");
  await p.context().close();
}

// 1024 laptop
{
  const p = await page(1024, 768);
  await shot(p, "16-top-1024");
  await p.context().close();
}

// compact density 1440
{
  const p = await page(1440, 900);
  await p.keyboard.press("d");
  await p.waitForTimeout(800);
  await shot(p, "17-compact-1440");
  await p.context().close();
}

// Phone
{
  const p = await page(390, 844);
  await shot(p, "18-phone-list");
  await p.locator('[role="option"]').first().click();
  await p.waitForTimeout(700);
  await shot(p, "19-phone-detail");
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(400);
  await shot(p, "20-phone-detail-scrolled");
  await p.getByRole("button", { name: /Top matches/ }).click();
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Open navigation" }).click();
  await p.waitForTimeout(600);
  await shot(p, "21-phone-nav");
  await p.context().close();
}

// Every main view at 1024 and 390 too, so each UI round has a frame at all three sizes.
// Names reuse the 1440 frame's number: 09-unscored-1440 → 09-unscored-1024, 09-unscored-390.
async function nav(p, name, mobile) {
  if (mobile) {
    await p.getByRole("button", { name: "Open navigation" }).first().click();
    await p.waitForTimeout(600);
  }
  await p.getByRole("link", { name }).first().click();
  await p.waitForTimeout(1000);
}
for (const [w, h, size, mobile] of [
  [1024, 768, "1024", false],
  [390, 844, "390", true],
]) {
  {
    const p = await page(w, h);
    await p.keyboard.press("t");
    await p.waitForTimeout(700);
    await shot(p, `05-tune-${size}`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    await p.keyboard.press("Control+k");
    await p.waitForTimeout(400);
    await p.keyboard.type("roblox");
    await p.waitForTimeout(300);
    await shot(p, `07-palette-${size}`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    await p.keyboard.press("?");
    await p.waitForTimeout(400);
    await shot(p, `08-shortcuts-${size}`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    await nav(p, /Unscored/, mobile);
    await shot(p, `09-unscored-${size}`);
    await nav(p, /In progress/, mobile);
    await shot(p, `10-applications-${size}`);
    await p.getByRole("button", { name: /Senior \/ Staff Fullstack Engineer/ }).click();
    await p.waitForTimeout(900);
    await shot(p, `11-workspace-apply-${size}`);
    await p.getByRole("tab", { name: "Resume" }).click();
    await p.waitForTimeout(600);
    await shot(p, `14-workspace-resume-${size}`);
    await p.getByRole("tab", { name: "Answers" }).click();
    await p.waitForTimeout(600);
    await shot(p, `15a-workspace-answers-${size}`);
    await p.getByRole("tab", { name: "Activity" }).click();
    await p.waitForTimeout(600);
    await shot(p, `15-workspace-activity-${size}`);
    await p.context().close();
  }
  {
    const p = await page(w, h);
    await p.getByRole("button", { name: /^Anywhere$/ }).click();
    await p.waitForTimeout(500);
    await p.getByRole("button", { name: /^Portland/ }).click();
    await p.waitForTimeout(900);
    await shot(p, `22-where-portland-${size}`);
    await p.context().close();
  }
}

// The scout card when the unattended scout needs Kris (status "attention", with notices).
{
  const p = await page(1440, 900, "?scout=attention");
  await shot(p, "26-scout-attention-1440");
  await p.context().close();
}
{
  const p = await page(390, 844, "?scout=attention");
  await p.getByRole("button", { name: "Open navigation" }).first().click();
  await p.waitForTimeout(700);
  await shot(p, "26-scout-attention-390");
  await p.context().close();
}

// Top matches with stand-in logos on about half the companies (frame 27).
for (const [w, h, size] of [
  [1440, 900, "1440"],
  [1024, 768, "1024"],
  [390, 844, "390"],
]) {
  const p = await page(w, h, "?logos=demo");
  await shot(p, `27-logos-${size}`);
  await p.context().close();
}

// Company logos page, and the picker at the two widths the round names.
for (const [w, h, size, mobile] of [
  [1440, 900, "1440", false],
  [1024, 768, "1024", false],
  [390, 844, "390", true],
]) {
  const p = await page(w, h);
  await nav(p, /Company logos/, mobile);
  await shot(p, `28-company-logos-${size}`);
  if (size !== "1024") {
    await p.getByRole("button", { name: "Change" }).first().click();
    await p.waitForTimeout(500);
    await shot(p, `29-logo-picker-${size}`);
  }
  await p.context().close();
}

// Job detail header (J11 design). Art from the stand-in icon, a monogram, and the stuck title.
async function selectRow(p, withLogo) {
  const row = p.locator('[role="option"]').filter(withLogo ? { has: p.locator("img") } : { hasNot: p.locator("img") }).first();
  await row.click();
  await p.waitForTimeout(500);
}

{
  const p = await page(1440, 900, "?logos=demo");
  await selectRow(p, true);
  await shot(p, "30-header-1440");
  await p.locator("[data-detail-scroll]").evaluate((el) => {
    el.scrollTop = 420;
  });
  await p.waitForTimeout(300);
  await shot(p, "32-header-scrolled-1440");
  await p.context().close();
}
{
  const p = await page(1440, 900, "?logos=demo");
  await selectRow(p, false);
  await shot(p, "31-header-monogram-1440");
  await p.context().close();
}
for (const [w, h, size] of [
  [1024, 768, "1024"],
  [390, 844, "390"],
]) {
  const p = await page(w, h, "?logos=demo");
  await selectRow(p, true);
  await p.waitForTimeout(size === "390" ? 400 : 0);
  await shot(p, `30-header-${size}`);
  await p.context().close();
}
for (const [w, h, size, mobile] of [
  [1440, 900, "1440", false],
  [390, 844, "390", true],
]) {
  const p = await page(w, h, "?logos=demo");
  await nav(p, /In progress/, mobile);
  await p.getByRole("button", { name: /Senior \/ Staff Fullstack Engineer/ }).click();
  await p.waitForTimeout(900);
  await shot(p, `33-workspace-header-${size}`);
  await p.context().close();
}

await browser.close();
console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
