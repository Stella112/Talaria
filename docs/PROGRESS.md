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
