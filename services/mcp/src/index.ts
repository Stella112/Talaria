import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTalaria } from "@talaria-pay/sdk";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildMcp } from "./server";

// dotenv must stay quiet here: stdout carries the MCP protocol.
loadEnv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const { AGENT_SESSION_KEY, AGENT_OWNER, RELAYER_URL, PORTALDOT_EVM_RPC } = process.env;
if (!AGENT_SESSION_KEY || !AGENT_OWNER) throw new Error("AGENT_SESSION_KEY and AGENT_OWNER must be set");

const talaria = createTalaria({
  account: privateKeyToAccount((AGENT_SESSION_KEY.startsWith("0x") ? AGENT_SESSION_KEY : `0x${AGENT_SESSION_KEY}`) as Hex),
  owner: AGENT_OWNER as Address,
  relayerUrl: RELAYER_URL,
  rpcUrl: PORTALDOT_EVM_RPC,
});

void buildMcp(talaria).connect(new StdioServerTransport());
