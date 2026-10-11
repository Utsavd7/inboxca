import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// Draws the link preview image (1200 x 630) in the same look as the home page.
const scratch = await mkdtemp(join(tmpdir(), "inboxca-social-"));
const mark = await readFile("app/icon.svg", "utf8");
const font = pathToFileURL(resolve("app/fonts/plus-jakarta-sans-latin-variable.woff2"));
const mono = pathToFileURL(resolve("app/fonts/ibm-plex-mono-latin-500-normal.woff2"));
const tick = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const rows = [
  ["Read", "GST data, September 2026"],
  ["Filed", "GST / FY 2026-27 / Patel Textiles"],
  ["Replied", "From your firm's own address"],
  ["Form ready", "Waiting for your approval"],
];
const browser = await chromium.launch();
try {
  const html = `<!doctype html><html lang="en"><style>
  @font-face{font-family:Jakarta;src:url('${font}');font-weight:500 800}@font-face{font-family:Plex;src:url('${mono}');font-weight:500}
  *{box-sizing:border-box;margin:0}body{width:1200px;height:630px;overflow:hidden;position:relative;background:#fff;color:#0B1F3A;font-family:Jakarta,sans-serif;font-weight:500;
    background-image:radial-gradient(700px 360px at 30% -80px,rgba(26,75,176,.2),transparent 70%),repeating-linear-gradient(to bottom,transparent 0 47px,rgba(11,31,58,.055) 47px 48px)}
  .left{position:absolute;left:72px;top:64px;width:600px}
  .logo{display:flex;align-items:center;gap:12px;font-size:32px;font-weight:800;letter-spacing:-1.4px}.logo svg{width:46px;height:43px}
  h1{margin-top:84px;font-size:68px;font-weight:800;line-height:1.04;letter-spacing:-3.4px}
  .sub{margin-top:26px;font-size:25px;line-height:1.4;color:#51607A}
  .maker{position:absolute;left:72px;bottom:58px;font-size:20px;font-weight:600;color:#51607A}
  .card{position:absolute;right:64px;top:96px;width:400px;padding:26px;border-radius:26px;background:#0B1F3A;color:#fff;box-shadow:0 50px 90px -40px rgba(11,31,58,.6);
    background-image:radial-gradient(360px 240px at 100% 0,rgba(26,75,176,.75),transparent 70%)}
  .from{display:flex;align-items:center;gap:12px;padding-bottom:18px;border-bottom:1px solid rgba(194,211,247,.2)}
  .av{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:rgba(194,211,247,.16);color:#C2D3F7;font-weight:800;font-size:15px}
  .from b{display:block;font-size:19px;font-weight:700}.from i{display:block;font-style:normal;font-size:15px;color:#C2D3F7}
  .row{display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid rgba(194,211,247,.14)}.row:last-child{border:0;padding-bottom:0}
  .dot{display:grid;place-items:center;flex-shrink:0;width:30px;height:30px;border-radius:50%;background:#12905F}.dot svg{width:17px;height:17px}
  .row b{display:block;font-size:18px;font-weight:700}.row i{display:block;font-style:normal;font-size:14.5px;color:#C2D3F7}
  </style><body>
  <div class="left"><div class="logo">${mark}InboxCA</div><h1>Every client email, read, filed and answered.</h1><p class="sub">An AI back office for Indian CA firms.</p></div>
  <p class="maker">A product by Orelu</p>
  <div class="card"><div class="from"><span class="av">PT</span><span><b>Patel Textiles</b><i>Purchase bills for September</i></span></div>
  ${rows.map(([what, detail]) => `<div class="row"><span class="dot">${tick}</span><span><b>${what}</b><i>${detail}</i></span></div>`).join("")}
  </div></body></html>`;
  const file = join(scratch, "social.html");
  await writeFile(file, html);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "public/brand/social.png" });
} finally {
  await browser.close();
  await rm(scratch, { recursive: true });
}
