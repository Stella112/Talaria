import Anthropic from "@anthropic-ai/sdk";
import { createTalaria } from "@talaria-pay/sdk";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { z } from "zod";
import { anthropicParser } from "./anthropic";
import type { Llm } from "./parser";
import { buildAgent, type AgentOptions } from "./server";

loadEnv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const env = process.env;
if (!env.AGENT_SESSION_KEY) throw new Error("AGENT_SESSION_KEY must be set");
const toAccount = (key: string) => privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const common = { relayerUrl: env.RELAYER_URL, rpcUrl: env.PORTALDOT_EVM_RPC };

const agentAccount = toAccount(env.AGENT_SESSION_KEY);
const talaria = createTalaria({ account: agentAccount, owner: (env.AGENT_OWNER as Address) || undefined, ...common });

const options: AgentOptions = {
  card: {
    name: "Talaria Autopilot",
    description: "Demo agent that pays on the Portaldot testnet under on-chain spending limits. Test tokens only.",
    url: env.AGENT_PUBLIC_URL ?? null,
    wallet: agentAccount.address,
  },
};

// The hosted setup is optional: without it, the buy and dispute actions report that they are unavailable.
if (env.DEMO_BUYER_KEY && env.DEMO_MERCHANTS) {
  options.hosted = {
    buyer: createTalaria({ account: toAccount(env.DEMO_BUYER_KEY), ...common }),
    merchants: z.record(z.string(), z.string().regex(/^0x[0-9a-fA-F]{40}$/)).parse(JSON.parse(env.DEMO_MERCHANTS)) as Record<string, Address>,
  };
}

// Ratings come from a separate wallet, and the tag keeps them out of the settlement score.
if (env.DEMO_CLIENT_KEY && env.AGENT_ERC8004_ID) {
  const abi = parseAbi(["function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)"]);
  const transport = http(env.BASE_SEPOLIA_RPC || "https://sepolia.base.org", { retryCount: 5 });
  const base = createPublicClient({ chain: baseSepolia, transport });
  const wallet = createWalletClient({ account: toAccount(env.DEMO_CLIENT_KEY), chain: baseSepolia, transport });
  options.rate = async (paymentId, stars) => {
    const payment = await talaria.getPayment(paymentId);
    if (payment.status !== "released") throw new Error("Only a settled payment can be rated");
    const uri = `portaldot:420420777:payment:${paymentId}`;
    const { request } = await base.simulateContract({
      account: wallet.account,
      address: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      abi,
      functionName: "giveFeedback",
      args: [BigInt(env.AGENT_ERC8004_ID!), BigInt(stars * 20), 0, "demo-client", "job-rating", "", uri, keccak256(toHex(uri))],
    });
    return wallet.writeContract(request);
  };
}

const openAiCompatible: Llm | undefined =
  env.LLM_PROVIDER === "openai-compatible" && env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL ? { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL } : undefined;
const llm = env.ANTHROPIC_API_KEY ? anthropicParser(new Anthropic()) : openAiCompatible;

buildAgent(talaria, llm, undefined, options)
  .listen({ port: Number(env.AGENT_PORT || 8789), host: "0.0.0.0" })
  .then((address) => console.log(`[agent] ${address}, parser: rules${llm ? " + LLM" : " only"}, hosted: ${Boolean(options.hosted)}`));
