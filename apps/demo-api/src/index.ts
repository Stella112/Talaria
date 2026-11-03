import { createTalaria, portaldotClient } from "@talaria-pay/sdk";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { Address } from "viem";
import { buildApi, chainReader, type Gate } from "./api";

loadEnv({ path: resolve(__dirname, "../../../.env") });

const client = portaldotClient(process.env.PORTALDOT_EVM_RPC);
const talaria = createTalaria({ publicClient: client });
const provider = process.env.API_PROVIDER_ADDRESS as Address | undefined;
const relayer = process.env.RELAYER_URL;
const replacer = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

let gate: Gate = null;
if (talaria.addresses.channels && provider) {
  gate = talaria
    .paywall({
      price: process.env.API_PRICE || "0.01",
      provider,
      onVoucher: async (voucher) => {
        if (!relayer) return;
        await fetch(`${relayer}/vouchers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(voucher, replacer) });
      },
    })
    .fastify();
}

buildApi(chainReader(client), gate)
  .listen({ port: Number(process.env.API_PORT || 8788), host: "0.0.0.0" })
  .then((address) => console.log(`[demo-api] ${address}, paywall ${gate ? "active" : "unavailable: rail not deployed or no provider set"}`));
