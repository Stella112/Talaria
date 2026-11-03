const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;

export type RpcResult = { ok: true; result: unknown } | { ok: false; error: unknown };

/** JSON-RPC call with timeout and exponential backoff. RPC-level errors are returned, not retried. */
export async function rpc(url: string, method: string, params: unknown[] = []): Promise<RpcResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      if (body.error !== undefined) return { ok: false, error: body.error };
      return { ok: true, result: body.result };
    } catch (error) {
      lastError = String(error);
      console.warn(`[rpc] ${method} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, error: lastError };
}
