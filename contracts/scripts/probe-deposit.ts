// Read-only: breaks down what a deployment locked, from Revive storage.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { h160ToSs58 } from "../../packages/sdk/src/utils/address";
const [contract, deployer] = process.argv.slice(2) as `0x${string}`[];
(async () => {
  const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
  const info = (await api.query.revive.accountInfoOf(contract)) as any;
  const human = info.toHuman() as any;
  console.log("accountInfoOf", JSON.stringify(info.toJSON()));
  const codeHash = info.unwrap().accountType.asContract.codeHash;
  console.log("codeInfoOf", JSON.stringify(((await api.query.revive.codeInfoOf(codeHash)) as any).toJSON()));
  for (const [label, a] of [["contract", contract], ["deployer", deployer]] as const) {
    const ss58 = h160ToSs58(a);
    const acc = (await api.query.system.account(ss58)) as any;
    const holds = api.query.balances.holds ? ((await api.query.balances.holds(ss58)) as any).toJSON() : null;
    console.log(label, ss58, JSON.stringify(acc.data.toJSON()), "holds", JSON.stringify(holds));
  }
  await api.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
