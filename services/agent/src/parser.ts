import { actionSchema, type Action } from "./schema";

const AMOUNT = String.raw`(\d+(?:\.\d{1,6})?)`;
const ADDRESS = String.raw`(0x[0-9a-fA-F]{40})`;
const UNIT = String.raw`(?:\s*(?:tusd|usd|dollars?))?`;

type Rule = [RegExp, (m: RegExpMatchArray) => Action];

const rules: Rule[] = [
  [new RegExp(String.raw`^(?:pay|settle)\s+invoice\s+#?(\d+)$`, "i"), (m) => ({ action: "pay_invoice", invoiceId: m[1] })],
  [
    new RegExp(String.raw`^(?:create|make|new)\s+(?:an?\s+)?(?:invoice|checkout)\s+for\s+\$?${AMOUNT}${UNIT}(?:\s+(?:for|memo)\s+(.+))?$`, "i"),
    (m) => ({ action: "create_checkout", amount: m[1], ...(m[2] ? { memo: m[2] } : {}) }),
  ],
  [new RegExp(String.raw`^cancel\s+(?:subscription|sub)\s+#?(\d+)$`, "i"), (m) => ({ action: "cancel_subscription", subId: m[1] })],
  [new RegExp(String.raw`^subscribe\s+(?:to\s+)?plan\s+#?(\d+)$`, "i"), (m) => ({ action: "subscribe", planId: m[1] })],
  [
    new RegExp(String.raw`^stream\s+\$?${AMOUNT}${UNIT}\s+(?:a|per)\s+month\s+to\s+${ADDRESS}\s+(?:with\s+)?(?:a\s+)?deposit\s+(?:of\s+)?\$?${AMOUNT}${UNIT}$`, "i"),
    (m) => ({ action: "start_stream", ratePerMonth: m[1], to: m[2], deposit: m[3] }),
  ],
  [new RegExp(String.raw`^stop\s+stream\s+#?(\d+)$`, "i"), (m) => ({ action: "stop_stream", streamId: m[1] })],
  [
    new RegExp(String.raw`^(?:fetch|call|get)\s+(https?://\S+)\s+(?:for\s+)?(?:max|at\s+most|up\s+to)\s+\$?${AMOUNT}${UNIT}(?:\s+deposit\s+\$?${AMOUNT}${UNIT})?$`, "i"),
    (m) => ({ action: "paid_fetch", url: m[1], maxPrice: m[2], ...(m[3] ? { channelDeposit: m[3] } : {}) }),
  ],
  [new RegExp(String.raw`^(?:send|remit)\s+\$?${AMOUNT}${UNIT}\s+to\s+${ADDRESS}$`, "i"), (m) => ({ action: "send_remit", amount: m[1], to: m[2] })],
  [new RegExp(String.raw`^(?:send|remit)\s+\$?${AMOUNT}${UNIT}\s+(?:as|by|via|with)\s+(?:a\s+)?(?:claim\s+)?(?:link|code)$`, "i"), (m) => ({ action: "send_remit", amount: m[1] })],
  [/^(?:show\s+|what(?:'s| is)\s+)?(?:my\s+)?balance\??$/i, () => ({ action: "get_balance" })],
  [/^(?:show\s+|list\s+)?(?:my\s+)?receipts$/i, () => ({ action: "get_receipts" })],
  [/^(?:show\s+|what(?:'s| is)\s+)?(?:my\s+)?(?:policy|limits?)\??$/i, () => ({ action: "get_policy" })],
];

/** Deterministic parser. Returns null for anything it does not recognise: it never guesses. */
export function parseCommand(command: string): Action | null {
  const text = command.trim().replace(/\s+/g, " ");
  for (const [pattern, build] of rules) {
    const match = text.match(pattern);
    if (match) return actionSchema.parse(build(match));
  }
  return null;
}

export type Llm = { baseUrl: string; apiKey: string; model: string };

const SYSTEM = `Turn the user's payment command into one JSON object and output nothing else.
Allowed actions and fields:
create_checkout{amount,memo?} pay_invoice{invoiceId} subscribe{planId} cancel_subscription{subId}
start_stream{to,ratePerMonth,deposit} stop_stream{streamId} paid_fetch{url,maxPrice,channelDeposit?}
send_remit{to?,amount} get_balance{} get_receipts{} get_policy{}
Include the "action" field. Amounts are decimal strings in tUSD, ids are digit strings, addresses are 0x hex.
Never invent an amount, id or address: if one is missing, output {"action":"unknown"}.`;

/** Optional LLM route using any OpenAI-compatible endpoint. Its output is untrusted and must pass the schema. */
export async function parseWithLlm(command: string, llm: Llm, fetchImpl: typeof fetch = fetch): Promise<Action | null> {
  const response = await fetchImpl(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({ model: llm.model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: command }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const parsed = actionSchema.safeParse(JSON.parse(body.choices?.[0]?.message?.content ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Rules first, so the demo never depends on an LLM. */
export async function understand(command: string, llm?: Llm, fetchImpl?: typeof fetch): Promise<{ action: Action; source: "rules" | "llm" } | null> {
  const ruled = parseCommand(command);
  if (ruled) return { action: ruled, source: "rules" };
  if (!llm) return null;
  try {
    const action = await parseWithLlm(command, llm, fetchImpl);
    return action ? { action, source: "llm" } : null;
  } catch {
    return null;
  }
}
