// Read-only: confirms the deployed batch answers on the live chain and is connected to Core.
import { TalariaBridgeOutAbi, TalariaCoreAbi, TalariaProtectAbi } from "../../packages/sdk/src/generated";
import { addressOf, BASE_CHAIN_ID, fail, keyAccount, portaldot } from "./lib/env";

async function main() {
  const core = addressOf("portaldot-testnet.json", "TalariaCore")!;
  const protect = addressOf("portaldot-testnet.json", "TalariaProtect")!;
  const bridgeOut = addressOf("portaldot-testnet.json", "TalariaBridgeOut")!;
  const read = (address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) => portaldot.readContract({ address, abi, functionName, args }) as Promise<any>;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const tiers = await read(protect, TalariaProtectAbi, "tiers");
  console.log("holds (s)", tiers.slice(0, 3).map(String).join(", "), "| caps (tUSD)", tiers.slice(3).map((c: any) => Number(c) / 1e6).join(", "));
  console.log("arbiter is deployer", same(await read(protect, TalariaProtectAbi, "arbiter"), keyAccount("DEPLOYER_PRIVATE_KEY").address));
  console.log("attester correct", same(await read(protect, TalariaProtectAbi, "attester"), keyAccount("ATTESTER_PRIVATE_KEY").address));
  console.log("protect's token correct", same(await read(protect, TalariaProtectAbi, "token"), addressOf("portaldot-testnet.json", "TalariaUSD")!));
  console.log("protect's core correct", same(await read(protect, TalariaProtectAbi, "core"), core));
  console.log("rail 6 is protect", same(await read(core, TalariaCoreAbi, "modules", [6]), protect));
  console.log("rail 7 is bridge-out", same(await read(core, TalariaCoreAbi, "modules", [7]), bridgeOut));
  console.log("base allowed", await read(bridgeOut, TalariaBridgeOutAbi, "allowedDest", [BigInt(BASE_CHAIN_ID)]));
  console.log("payments so far", String(await read(protect, TalariaProtectAbi, "paymentCount")));
}

main().catch(fail);
