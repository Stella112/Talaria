import { createTalaria } from "@talaria-pay/sdk";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Llm } from "./parser";
import { buildAgent } from "./server";

loadEnv({ path: resolve(__dirname, "../../../.env") });

const { AGENT_SESSION_KEY, AGENT_OWNER, RELAYER_URL, LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
if (!AGENT_SESSION_KEY || !AGENT_OWNER) throw new Error("AGENT_SESSION_KEY and AGENT_OWNER must be set");

const talaria = createTalaria({
  account: privateKeyToAccount((AGENT_SESSION_KEY.startsWith("0x") ? AGENT_SESSION_KEY : `0x${AGENT_SESSION_KEY}`) as Hex),
  owner: AGENT_OWNER as Address,
  relayerUrl: RELAYER_URL,
  rpcUrl: process.env.PORTALDOT_EVM_RPC,
});

const llm: Llm | undefined =
  LLM_PROVIDER === "openai-compatible" && LLM_API_KEY && LLM_BASE_URL && LLM_MODEL ? { baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY, model: LLM_MODEL } : undefined;

buildAgent(talaria, llm)
  .listen({ port: Number(process.env.AGENT_PORT || 8789), host: "0.0.0.0" })
  .then((address) => console.log(`[agent] ${address}, parser: rules${llm ? " + LLM" : " only"}`));
