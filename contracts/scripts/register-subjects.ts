// Registers the demo subjects in the ERC-8004 IdentityRegistry on Base Sepolia, then links each to
// its Portaldot address through the relayer. Spends test ETH. Each subject needs ETH in its own wallet.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatEther, parseAbi } from "viem";
import { base, baseWallet, fail, keyAccount, preview, recordTx, root } from "./lib/env";

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const abi = parseAbi(["function register(string agentURI) returns (uint256 agentId)"]);

const SUBJECTS = [
  { env: "AGENT_SESSION_KEY", label: "Talaria Autopilot", kind: "agent" },
  { env: "TRUSTED_COFFEE_KEY", label: "Trusted Coffee", kind: "merchant" },
  { env: "NEW_SHOP_KEY", label: "New Shop", kind: "merchant" },
];

const uri = (label: string, kind: string) => `data:application/json,${encodeURIComponent(JSON.stringify({ name: label, description: `Talaria demo ${kind} on testnets. Its history comes from demo runs.` }))}`;

async function main() {
  const file = resolve(root, "deployments/identities.json");
  const done: Record<string, any> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const relayerUrl = process.env.RELAYER_URL;
  console.log(preview ? "PREVIEW: nothing is sent." : "LIVE");

  for (const subject of SUBJECTS) {
    const account = keyAccount(subject.env);
    const balance = await base.getBalance({ address: account.address });
    console.log(`\n${subject.label}\n  wallet  ${account.address}\n  balance ${formatEther(balance)} ETH\n  agentId ${done[subject.label]?.agentId ?? "not registered"}`);
    if (preview) continue;

    if (!done[subject.label]) {
      const { request, result } = await base.simulateContract({ account, address: IDENTITY, abi, functionName: "register", args: [uri(subject.label, subject.kind)] });
      const hash = await baseWallet(account).writeContract(request);
      const receipt = await base.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error(`Registration failed in ${hash}`);
      recordTx("identity (Base Sepolia)", `register ${subject.label}`, receipt, "test ETH");
      done[subject.label] = { wallet: account.address, agentId: result.toString(), registerTx: hash };
      writeFileSync(file, JSON.stringify(done, null, 2) + "\n");
    }

    if (relayerUrl) {
      const agentId = BigInt(done[subject.label].agentId);
      const message = `Link ERC-8004 agent ${agentId} on Base Sepolia to Portaldot address ${account.address.toLowerCase()} for Talaria`;
      const response = await fetch(`${relayerUrl}/identity/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: account.address, agentId: agentId.toString(), signature: await account.signMessage({ message }) }),
      });
      console.log(`  linked: ${response.status} ${await response.text()}`);
    }
  }
}

main().catch(fail);
