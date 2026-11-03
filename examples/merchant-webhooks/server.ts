// Tiny merchant server that verifies Talaria webhooks and ignores repeats.
// Run from the repo root: WEBHOOK_SECRET=whsec_... pnpm exec tsx examples/merchant-webhooks/server.ts
import { createServer } from "node:http";
import { verifyWebhook } from "../../packages/sdk/src/webhooks";

const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error("Set WEBHOOK_SECRET to the secret you got when registering the webhook");

const seen = new Set<string>();

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!(await verifyWebhook(raw, req.headers["talaria-signature"] as string | undefined, secret))) {
      res.statusCode = 401;
      return res.end("bad signature");
    }
    const event = JSON.parse(raw) as { id: string; type: string; data: unknown };
    if (seen.has(event.id)) {
      res.statusCode = 200;
      return res.end("already handled");
    }
    seen.add(event.id);
    console.log(event.type, event.id, event.data);
    res.end("ok");
  });
}).listen(Number(process.env.PORT || 4242), () => console.log("Listening for Talaria webhooks"));
