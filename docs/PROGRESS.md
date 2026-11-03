# Progress

## Phase 0: Setup and chain probes (2026-11-03)

Measured by `pnpm probe`, full output in `evidence/probe-chain.json`:

- Chain ID `0x190f1ca9`, runtime `portaldot-v3` spec 3002, 14 decimals, symbol tPOT, SS58 42, block time 6000 ms.
- `Revive.originalAccount` samples (5 of 5) match keccak256(account) last 20 bytes.
- EVM balance = (free - existential deposit) x 10^4 on all 5 samples. Existential deposit is 0.1 tPOT.
- `debug_traceCall` responds with a call trace on a zero-address call (`debugEnabled` const is false; other tracers untested).
- Revive constants: `depositPerByte` 0.06 tPOT, `depositPerItem` 0.15 tPOT, `autoMap` true.

Open:

- Deployer and native wallet balances: waiting on public addresses in `.env`.
- `autoMap` behaviour: UNVERIFIED, may remove the need for an explicit `map_account`.
- Real per-contract deposit: measured in Phase 1.

Balances at 2026-11-03T10:37Z: native wallet 1000 tPOT free, EVM deployer 0 tPOT.

## Phase 1: First deployment
- Native-to-EVM funding verified: 1 tPOT sent to the H160 + 0xEE account shows as 0.9 tPOT over EVM RPC (existential deposit withheld).
- TalariaUSD rewritten without OpenZeppelin: 3018 runtime bytes, down from 4595.
- TalariaUSD live at `0x44bc5dcfba3f36fb03623a27e553cdbb0b8877f0`. Deployment cost 252.69 tPOT, about 0.084 tPOT per byte.
- Faucet, permit and transferFrom succeeded on-chain; see `evidence/TRANSACTIONS.md`. A new storage slot costs about 3.84 tPOT.

## Phase 3: Deploy and live flows
- TalariaCore live at `0x69d4105479e25503f296797b91901ab558c830ac`, 8539 bytes, 683.89 tPOT.
- MockUSDC and TalariaLockbox live on Base Sepolia (`deployments/base-sepolia.json`).
- Live end-to-end: lock on Base Sepolia, relayer credit on V3, gasless invoice payment by a payer holding 0 tPOT. Hashes in `evidence/TRANSACTIONS.md`. The relayer ran in-process using the real relayer code, with the deployer key. The payer key was one-time and not stored, so its remaining 5 tUSD balance is unreachable.

## Phase 6: Docs and submission pack
- README, architecture, security, demo script, pitch outline and SDK README written from recorded evidence.

## Addenda 2 and 3
- TalariaLockboxV2 live on Base Sepolia at `0xc8675f5a54bdfd78d6ffbed8551393c8e462b1bd`.
- TalariaProtect (8,401 bytes) and TalariaBridgeOut (1,161 bytes) built and tested locally. Live estimate for the batch: 789.14 tPOT.
- Trust attester, feedback, webhooks, idempotency, x402 v2 headers, hosted agent and scripts built. Tested locally or with stubs.
- Waiting on tPOT for the batch and the live trust flow.
