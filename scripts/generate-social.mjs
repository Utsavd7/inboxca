import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const scratch = await mkdtemp(join(tmpdir(), "inboxca-social-"));
const mark = await readFile("app/icon.svg", "utf8");
const font = pathToFileURL(resolve("app/fonts/plus-jakarta-sans-latin-variable.woff2"));
const mono = pathToFileURL(resolve("app/fonts/ibm-plex-mono-latin-500-normal.woff2"));
const browser = await chromium.launch();
try {
  const html = `<!doctype html><html lang="en"><style>
  @font-face{font-family:Jakarta;src:url('${font}');font-weight:500 800}@font-face{font-family:Plex;src:url('${mono}');font-weight:500}
  *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#fff;color:#0B1F3A;font-family:Jakarta,sans-serif;font-weight:800;padding:66px 78px;position:relative}
  .logo{display:flex;align-items:center;gap:13px;font-size:35px;letter-spacing:-2px}.logo svg{width:51px;height:48px}.label{font:500 17px Plex;color:#153E94;margin-top:61px}h1{font-size:83px;line-height:1.1;letter-spacing:-5px;margin:25px 0 0;position:relative;z-index:1}h1 span{color:#1A4BB0}.maker{font:500 16px Plex;color:#51607A;margin-top:39px}
  .ledger{position:absolute;right:0;top:0;bottom:0;width:280px;background:#0B1F3A;background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 53px,rgba(194,211,247,.14) 53px,rgba(194,211,247,.14) 54px)}.ledger:before{content:'';position:absolute;top:0;bottom:0;left:31px;width:1px;background:rgba(194,211,247,.2)}.paper{position:absolute;right:75px;top:212px;width:195px;height:210px;border:1px solid #C2D3F7;border-radius:12px;background:#F2F5F9;transform:rotate(-5deg);box-shadow:0 25px 50px rgba(0,0,0,.13)}.paper:before,.paper:after{content:'';position:absolute;height:1px;background:#C2D3F7;left:29px;right:29px;top:119px}.paper:after{top:148px}.paper svg{width:65px;height:61px;margin:27px 27px}
  </style><body><div class="ledger"></div><div class="logo">${mark}InboxCA</div><p class="label">For Indian CA firms</p><h1>Less chasing.<br><span>More doing.</span></h1><p class="maker">A product by Orelu</p><div class="paper">${mark}</div></body></html>`;
  const file = join(scratch, "social.html");
  await writeFile(file, html);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "public/brand/social.png" });
} finally { await browser.close(); await rm(scratch, { recursive: true }); }
