// Screenshots of the live site for the video. Read-only: a test wallet that can only report its address is
// injected so connected pages show real chain data for that address. It cannot sign or send anything.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = "https://talaria-pi.vercel.app";
const WALLET = "0xE66581C8f5B91d257b5EAa90168B547Ba28f8e19";
const out = new URL("./public/shots/", import.meta.url);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

async function open(path, { connect = false, wait = 6000 } = {}) {
  const page = await browser.newPage();
  if (connect) {
    await page.evaluateOnNewDocument((address) => {
      const provider = {
        request: async ({ method }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
          if (method === "eth_chainId") return "0x190f1ca9";
          if (method === "wallet_switchEthereumChain") return null;
          throw new Error("read-only");
        },
        on() {},
        removeListener() {},
      };
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "read-only", name: "Read only", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "read.only" }, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    }, WALLET);
  }
  await page.goto(SITE + path, { waitUntil: "networkidle2", timeout: 90000 });
  if (connect) {
    await page.evaluate(async () => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Connect wallet");
      button?.click();
      await new Promise((r) => setTimeout(r, 600));
      [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.includes("Read only"))?.click();
    });
  }
  await sleep(wait);
  return page;
}

async function shot(page, name, { selector, scrollTo, offset = 0 } = {}) {
  if (selector) {
    await page.evaluate((s, o) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90 + o); }, selector, offset);
  } else if (scrollTo !== undefined) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
  }
  await sleep(1200);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)), type: "png" });
  console.log("saved", name);
}

let page = await open("/");
await shot(page, "landing-hero", { scrollTo: 0 });
await shot(page, "landing-story", { selector: "#story" });
await shot(page, "landing-story-2", { selector: "#story", offset: 520 });
await page.evaluate(() => { const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.includes("Reputation sets")); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 140); });
await sleep(1000);
await page.screenshot({ path: fileURLToPath(new URL("landing-tiers.png", out)) });
await page.evaluate(() => { const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.includes("Pay from Base or BNB")); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 140); });
await sleep(1000);
await page.screenshot({ path: fileURLToPath(new URL("landing-chains.png", out)) });
await page.close();

page = await open("/payment/4", { wait: 14000 });
await shot(page, "payment-4", { scrollTo: 200 });
await shot(page, "payment-4-timeline", { scrollTo: 820 });
await page.close();

page = await open("/payment/6", { wait: 14000 });
await shot(page, "payment-6", { scrollTo: 200 });
await shot(page, "payment-6-timeline", { scrollTo: 1250 });
await page.close();

page = await open("/pay/2", { connect: true, wait: 10000 });
await shot(page, "pay-2", { scrollTo: 200 });
await page.close();

page = await open("/wallet", { connect: true, wait: 12000 });
await shot(page, "wallet", { scrollTo: 200 });
await page.close();

page = await open("/agent", { wait: 8000 });
await shot(page, "agent", { scrollTo: 260 });
await page.evaluate(async () => {
  const input = document.querySelector("main input");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(input, "what is the trust of trusted coffee");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Preview").click();
  await new Promise((r) => setTimeout(r, 3500));
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Run").click();
});
await sleep(8000);
await shot(page, "agent-result", { scrollTo: 520 });
await page.close();

page = await open("/streams", { connect: true, wait: 10000 });
await shot(page, "streams", { scrollTo: 200 });
await page.close();

page = await open("/docs/sdk", { wait: 4000 });
await shot(page, "docs-sdk", { scrollTo: 0 });
await page.close();
page = await open("/docs/mcp", { wait: 4000 });
await shot(page, "docs-mcp", { scrollTo: 900 });
await page.close();

await browser.close();
