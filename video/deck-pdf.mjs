// Renders the pitch deck's slides to a 16:9 PDF, one slide per page.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [slidesDir, out] = process.argv.slice(2);
const order = JSON.parse(readFileSync(`${slidesDir}/../deck.json`, "utf8")).order;
const font = pathToFileURL(new URL("./public/fonts/inter.woff2", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")).href;
const logo = pathToFileURL(new URL("./public/logo-white.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")).href;

const slides = order
  .map((id) => readFileSync(`${slidesDir}/${id}.html`, "utf8"))
  .map((html) => html.replace(/<aside>[\s\S]*?<\/aside>/, "").replace(/\/_blob\/[0-9a-f]+/g, logo))
  .join("\n");

const arrow = (dir) => (dir === "right" ? "polygon(0 30%,60% 30%,60% 0,100% 50%,60% 100%,60% 70%,0 70%)" : "polygon(100% 30%,40% 30%,40% 0,0 50%,40% 100%,40% 70%,100% 70%)");
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${font}) format("woff2");font-weight:400 700}
@page{size:1920px 1080px;margin:0}
*{margin:0;box-sizing:border-box}
html,body{background:#24100a}
section{position:relative;width:1920px;height:1080px;overflow:hidden;break-after:page;page-break-after:always}
h1,h2,h3{font-weight:600}
ul{padding-left:1.2em}
table{border-collapse:collapse}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e8dcd0}
tr:last-child td{border-bottom:none}
x-shape{display:block;flex-shrink:0}
x-shape[kind="arrow-right"]{clip-path:${arrow("right")}}
x-shape[kind="arrow-left"]{clip-path:${arrow("left")}}
</style></head><body>${slides}</body></html>`;

const htmlPath = out.replace(/\.pdf$/, ".html");
writeFileSync(htmlPath, page);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--allow-file-access-from-files"] });
const tab = await browser.newPage();
await tab.setViewport({ width: 1920, height: 1080 });
await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
await tab.evaluate(() => document.fonts.ready);
await tab.pdf({ path: out, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
const sections = await tab.$$("section");
for (let i = 0; i < sections.length; i++) await sections[i].screenshot({ path: out.replace(/\.pdf$/, `-${i + 1}.png`) });
await browser.close();
console.log("slides", sections.length);
