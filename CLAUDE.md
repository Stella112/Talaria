# TALARIA — Claude Code Build Prompt (Portaldot Hacker House 2026)

> Save this file as `CLAUDE.md` in the root of the new Talaria repository. Claude Code reads it automatically at the start of every session.
> Then start the session with the **Kickoff message** in Section 0.

---

## 0. Kickoff message (paste this into Claude Code to start)

```
Read CLAUDE.md fully before doing anything. Confirm you understand your role, the
mandates, the scope lock and the phase gates by summarising them back to me in under
15 bullet points. Then run Phase 0 only. Do not start Phase 1 until I reply "go".
```

---

## 1. Your role

You are the **lead engineer** on Talaria, building it with Maris (the product owner and only other team member). You write, test, deploy and document the code. Maris makes product decisions, holds the private keys, approves every on-chain spend, records the demo video and submits on DoraHacks.

You work **in phases with hard gates**. At the end of every phase you stop, report using the format in Section 12, and wait for Maris to reply `go` before the next phase. Maris prefers to discuss direction before code gets written — when a decision is not already settled in this file, **propose options and ask; do not decide alone.**

---

## 2. Strict mandates (non-negotiable)

### 2.1 Truthfulness — no hallucination
1. **Never invent** contract addresses, transaction hashes, block numbers, balances, RPC methods, precompile addresses, package names, API shapes or test results. Every one of these must come from a command you actually ran or a file that actually exists.
2. When you rely on something you have not verified on the live Portaldot V3 testnet, label it **`UNVERIFIED`** in code comments and in your report, and add a task to verify it.
3. If a command fails, show the real error. Never claim success you did not observe. Never "assume it worked".
4. **No fake data in the product.** The UI and docs must never present mock, simulated or hard-coded values as live chain data. Local/mock modes must be visibly labelled `MOCK` / `LOCAL`.
5. If you do not know how something works on Portaldot (pallet-revive), say so, then write a small probe script to find out. Facts in Section 5 marked "verified by others" must still be re-checked by your own probe in Phase 0 or Phase 1.

### 2.2 Scope lock
6. Build **only** what Section 4 lists, in the priority order in Section 7. No extra features, no "nice to have" additions, no rewrites of working code, no switching frameworks.
7. Do not add a dependency unless it is needed for a listed feature. State why for each new dependency in your report.
8. If something in this file is ambiguous or blocks you, **stop and ask**. Do not guess the product intent.

### 2.3 Money, keys and safety
9. **Testnet only.** Portaldot V3 testnet and Base Sepolia (and optionally BNB testnet). Never connect to Portaldot mainnet with a write operation. Mainnet may only be read (read-only RPC) if Maris asks.
10. **Never print, log, commit or echo private keys or mnemonics.** Keys live only in `.env` files that are git-ignored. Provide `.env.example` with empty values. Add a gitleaks-style check or at minimum a pre-commit grep for `PRIVATE_KEY=0x` / 12–24 word phrases.
11. **Every tPOT spend needs approval.** Before any deployment or write transaction on Portaldot, print: contract name, runtime bytecode size, estimated storage deposit (Section 5.4 formula), estimated gas, current deployer balance. Then wait for Maris to type `deploy` (or `send`). No batch deployments without per-batch approval.
12. Never run destructive commands (`rm -rf` outside build dirs, `git push --force`, history rewrites) without explicit permission.

### 2.4 Hackathon compliance
13. All code is written fresh in this repository during the event. You may follow the *design* of Maris's earlier project Qevie (QIE blockchain) but **never copy code from it**. Third-party libraries (OpenZeppelin, viem, etc.) are allowed and must be listed in `README.md → Credits & Dependencies`.
14. **Commit small and often** with clear messages (Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`). Commit at the end of every working unit. Never squash the history. The rules forbid committing core modules all at once in the last 24 hours before the deadline, so core contract and service code must be committed progressively and finished before **Wed Nov 5, 04:00 UTC**.
15. Record every deployment and every demo transaction in `deployments/portaldot-testnet.json` and `evidence/` (Section 10), because the Portaldot eth-rpc prunes old receipts and there is no EVM block explorer.

---

## 3. Product summary

**Talaria — payments with wings.** The account-abstraction payment and agentic commerce layer for Portaldot. People and AI agents can check out, subscribe, stream, pay per API call and send remittances — funded from any chain, gasless, policy-checked and receipted on Portaldot.

Core flow for every payment, from a person or an agent:

```
Intent (signed) → Policy check → Execute → Receipt
```

**Hackathon track:** Multi-Chain & Cross-Chain Infra (also eligible for the Grand Prize).

**Judging weights:** Technical Feasibility 30% (working code, sustained GitHub activity, real testnet interactions) · Innovation 30% (use of Portaldot V3 features: WASM/EVM, modular architecture, multi-chain) · Ecosystem Contribution 20% (open-source value for other builders) · Business Potential 20%.

---

## 4. Scope — what to build

### 4.1 On-chain (Portaldot V3 EVM, Solidity)
- **TalariaUSD (`tUSD`)** — test stablecoin, ERC-20 + EIP-2612 `permit`, 6 decimals, owner-mint for the bridge reserve and a capped public `faucet()` for demo users. Clearly named as a test token with no value.
- **TalariaCore** — the payment engine (may be split into 2 contracts if bytecode exceeds limits or costs; see 5.4):
  - **Internal accounts:** per-owner tUSD balances inside the contract (deposit via `permit` so users need no gas, withdraw).
  - **Signed intents (gasless):** EIP-712 typed intents signed by the owner or a session key; any relayer can submit; contract verifies signature, nonce, deadline and policy. The relayer pays gas (this is the "paymaster" role in the lean path).
  - **Session keys + policies:** owner registers a key with: `maxPerTx`, `maxPerDay`, `expiry`, allowed rails bitmask, optional single allowed payee or "any". Intents that exceed policy go to a **pending queue** the owner can approve or reject.
  - **Rail 1 — Checkout & payment links:** merchant creates an invoice (amount, merchant, metadata hash, expiry); payer pays it; merchant can refund fully or partly.
  - **Rail 2 — Subscriptions:** merchant creates a plan (amount, interval, max periods); subscriber approves once; **permissionless** `charge(subId)` works only when due and within caps; pause / cancel by subscriber.
  - **Rail 3 — Streaming:** `startStream(to, ratePerSecond, deposit)`, `withdraw(streamId)` by receiver for accrued amount, `stopStream` by sender refunds the unstreamed remainder. One storage record per stream; accrual is computed, never ticked.
  - **Rail 4 — Pay-per-call channels:** payer opens a prepaid channel to a provider; off-chain EIP-712 vouchers carry a **cumulative** amount; provider (or settler) redeems the latest voucher in one transaction; payer can close after a challenge window; batch redeem for many channels.
  - **Rail 5 — Remittance:** sender escrows an amount to a receiver address **or** to a claim-code hash (claim link); sender can cancel until claimed; expiry refunds the sender.
  - **Bridge credit:** `creditFromBridge(user, amount, srcChainId, srcTxHash)` callable only by the relayer role; replay-protected by `srcTxHash`; draws from the tUSD bridge reserve.
  - **Receipts:** every successful payment emits a `Receipt` event with a deterministic `receiptId = keccak256(...)`. Store only what must be stored (minimise storage slots — they cost tPOT).
- **Optional ERC-4337 module (Phase 3B, only if the tPOT gate in 7.4 passes):** EntryPoint v0.7 (official eth-infinitism release), a minimal smart-account factory, a verifying paymaster, and a minimal self-hosted bundler service. Never write your own EntryPoint.

### 4.2 Source chain (Base Sepolia; BNB testnet only if time allows)
- **TalariaLockbox** — accepts a test USDC (deploy `MockUSDC` on Base Sepolia if no usable official test USDC is confirmed), emits `Locked(payer, portaldotRecipient, amount, intentRef)`; owner-controlled `release()` for refunds. Bridge is a **trusted single relayer** in this build — disclose this honestly in the README and UI, with the multi-signer roadmap.

### 4.3 Off-chain services (TypeScript, Node 20+)
- **Relayer:** watches Lockbox events → calls `creditFromBridge`; submits signed intents to TalariaCore (gas sponsor); retries with backoff; idempotent; persists processed hashes (SQLite or JSON file).
- **Keeper:** periodically calls `charge(subId)` for due subscriptions.
- **Voucher settler:** batches the latest vouchers and redeems them.
- **Demo paid API (`apps/demo-api`):** a real HTTP API that returns **real Portaldot chain data** (e.g., latest block, finalized block, block time, account balance lookup via public RPC) behind `talaria.paywall()`; responds `402 Payment Required` with a JSON payment requirement when no valid voucher is attached.
- **Agent service (Autopilot):** natural-language command → structured intent JSON validated with `zod` → preview → sign with the agent's session key → submit via relayer. LLM provider is configurable via env (`LLM_PROVIDER`, `LLM_API_KEY`); a deterministic rule-based parser must work with no LLM key so the demo never depends on one.
- **MCP server:** exposes tools `create_checkout`, `pay_invoice`, `subscribe`, `start_stream`, `paid_fetch`, `send_remit`, `get_receipts`, `get_policy` using the official MCP TypeScript SDK. Tools call the SDK, never raw private keys from tool input.

### 4.4 SDK (`packages/sdk`, published name `@talaria-pay/sdk` — do not publish to npm unless Maris asks)
```ts
talaria.createCheckout({ amount, currency: "USD", metadata })
talaria.payInvoice(invoiceId)
talaria.refund(invoiceId, amount)
talaria.createPlan({ amount, interval, maxPeriods })
talaria.subscribe(planId) / talaria.cancel(subId)
talaria.startStream({ to, ratePerMonth, deposit }) / talaria.withdraw(streamId) / talaria.stopStream(streamId)
talaria.openChannel({ provider, deposit })
talaria.paywall({ price })            // Express/Fastify middleware (API side)
talaria.fetch(url, { maxPrice })      // auto-handles 402 → signs voucher → retries (agent side)
talaria.sendRemit({ to | claimCode, amount, cancellable: true }) / talaria.cancelRemit(id) / talaria.claimRemit(id)
talaria.addSessionKey({ key, maxPerTx, maxPerDay, expiry, rails, payee })
talaria.utils.ss58ToH160(), talaria.utils.h160ToSs58(), talaria.utils.plancksToWei()
```
Typed (TypeScript), built with `viem`, documented in `packages/sdk/README.md` with runnable examples.

### 4.5 Frontend (`apps/web`, mobile-first)
- **Checkout page** `/pay/[invoiceId]`: pay from Portaldot balance, or "Pay from Base" (lock on Base Sepolia → see credit land → invoice paid). QR code for the link.
- **Wallet:** balance, gasless deposit (permit), faucet button for tUSD, receipts list.
- **Merchant dashboard:** create invoice/plan, see payments, subscriptions, refunds.
- **Streams & subscriptions:** start/stop/withdraw; subscribe/cancel.
- **Agent console:** create session keys and policies, Autopilot command box, pending approvals queue, agent activity feed.
- **Remit:** send, share claim link, cancel, claim.
- Every on-chain action shows the real tx hash with a copy button and links to node-console where possible. Empty states when there is no data — never fake numbers.

### 4.6 Out of scope (do not build)
Real fiat ramps, real USDC on mainnets, a token/governance system, NFTs, ink! contracts (unless Maris explicitly requests it later), mobile native apps, multi-signer bridge (roadmap only), price oracles, a custom block explorer, AMMs/DEX features, ZK/privacy features.

---

## 5. Portaldot V3 facts and resources

### 5.1 Network (from the official hackathon page — use exactly)
| Item | Value |
|---|---|
| Substrate WebSocket | `wss://test-node-v3.portaldot.dev` |
| EVM JSON-RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| EVM chain ID | `420420777` (hex `0x190f1ca9`) |
| Node console (explorer) | `https://node-console.portaldot.dev/` |
| Native token | tPOT (testnet POT) |
| Mainnet (read-only only) | `wss://mainnet.portaldot.io`, SS58 format 42 |

### 5.2 Facts reported by other teams (verify yourself in Phase 0)
- Runtime `portaldot-v3`, spec version `3002`; EVM execution via **pallet-revive** behind an `eth-rpc` adapter. Standard EVM bytecode is accepted; standard tools (Hardhat, viem, ethers, MetaMask) work.
- Block time ≈ 6 s.
- Decimals: Substrate side **14 decimals** (planck); EVM RPC reports balances in **18-decimal wei**; `1 planck = 10^4 wei`.
- A separate Substrate explorer was reported at `https://scanner-testnet-v3.portaldot.dev` (UNVERIFIED — check it loads before referencing it).
- There is **no EVM block explorer** and **no contract verification service**; eth-rpc may prune old receipts → keep your own evidence files.
- Public EVM RPC can have occasional timeouts → all clients need retry with backoff.
- `debug_trace*` methods are probably unavailable (UNVERIFIED) → a bundler must not depend on them.
- Testnet tPOT comes only from admins (Discord ticket with the native `5…` address). There is no public faucet.
- Native assets: an Assets-pallet ERC-20 precompile was reported (address pattern UNVERIFIED). Do not depend on it unless Phase 0 proves it works.

### 5.3 Address mapping (pallet-revive) — critical
- An EVM address (H160) that has not been mapped corresponds to the Substrate AccountId32 **`H160 ‖ 0xEE × 12`** (20 bytes followed by twelve `0xEE` bytes).
- A native sr25519/ed25519 account must call **`Revive.map_account()`** before it can use EVM contracts; its H160 is the **last 20 bytes of `keccak256(publicKey)`**.
- **Never** use the legacy Frontier converter (`blake2_256("evm:" ‖ H160)`, e.g. `evmToAddress()` from `@polkadot/util-crypto`) — it gives the wrong account and funds become unrecoverable.
- To fund a fresh EVM deployer from a native wallet, transfer tPOT on the Substrate side to `H160 ‖ 0xEE×12` encoded as SS58 (prefix 42), or use a runtime call that resolves the account (verify which works).

### 5.4 Storage deposits — budget every deployment
Measured by another team (PortalNexus) on V3: deploying code locks **≈ 0.0589 tPOT per byte of runtime bytecode + ≈ 18.32 tPOT per contract**; writing a **new** storage slot locks **≈ 3.92–7.82 tPOT**. Deposits are refundable when storage is freed and are bundled into `eth_estimateGas`.

Examples they recorded: 1,482-byte token ≈ 128.9 tPOT; 3,305-byte AMM ≈ 278.9 tPOT.

Rules for you:
- Write `scripts/estimate-deploy.ts` that compiles, reads each contract's runtime bytecode size, and prints `estimate = 0.0589 × bytes + 18.32` per contract plus the total. Re-measure the real cost after the first deployment and update the constants.
- Design for low storage: emit events instead of storing history; pack structs; avoid per-call storage writes (that is why pay-per-call uses vouchers).
- Compile with the optimizer on; check `viaIR` effect on size.
- Contract size limit 24 KB per contract — split TalariaCore if needed.

Rough budgets (estimates, confirm with the script):
| Path | Rough tPOT |
|---|---|
| Lean (tUSD + TalariaCore, maybe split in two) + demo storage | **≈ 900–1,300** |
| Lean + full ERC-4337 module | **≈ 2,500–3,500** |

### 5.5 Hackathon requirements (from the official page)
- Deploy on Portaldot testnet with verifiable on-chain interactions.
- Public GitHub repo, complete README, deployment instructions, documentation, reproducible code.
- At least 3 valid commits in the event window; no bulk commit of core modules in the last 24 h; keep commit history.
- Demo video ≤ 3 minutes showing the real product, core functions and Portaldot integration.
- Pitch deck (PDF or link): problem, why Portaldot is essential, proof of functionality, why it deserves continued support.
- Contract addresses and transaction hashes.
- Open-source dependencies allowed but disclosed.
- **Deadlines (UTC):** final submission / code freeze **Thu Nov 6, 04:00 UTC** (05:00 Lagos). Core code finished and committed by **Wed Nov 5, 04:00 UTC**. Demo Day Nov 8–9.

### 5.6 Reference repositories (read for facts only — do not copy code)
- PortalNexus (storage-deposit benchmarks, address mapper notes): https://github.com/JimmyOgb/PortalNexus
- DotGas (funding EVM addresses from native, revive mapping notes): https://github.com/itsolaph/dotgas
- PortalLink (deploy flow on V3, revive-mapped funding): https://github.com/XachP/portallink
- potwatch (V3 RPC/explorer probes): https://github.com/sliarsgard/potwatch
- Polkadot pallet-revive docs (same stack): https://docs.polkadot.com/reference/polkadot-hub/smart-contracts/
- Parity address helpers (H160↔SS58 rules): https://paritytech.github.io/product-sdk/api/address/
- ERC-4337 reference (EntryPoint v0.7): https://github.com/eth-infinitism/account-abstraction
- x402 pattern (HTTP 402 payments): https://github.com/coinbase/x402
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- OpenZeppelin Contracts v5: https://github.com/OpenZeppelin/openzeppelin-contracts

If a URL does not load or contradicts what you observe on-chain, trust the chain and report the discrepancy.

---

## 6. Tech stack and repo layout

- **Package manager:** pnpm workspaces. **Node:** 20+. **Language:** TypeScript everywhere off-chain.
- **Contracts:** Solidity `^0.8.24`, Hardhat (TypeScript config) + `@nomicfoundation/hardhat-toolbox-viem` or ethers v6, OpenZeppelin v5. EVM target `cancun` unless Phase 0 shows a problem.
- **Client library:** `viem`. Substrate side (only where needed): `@polkadot/api`.
- **Frontend:** Next.js (App Router) or Vite + React, Tailwind, `wagmi` + `viem` with a custom Portaldot chain definition. Mobile-first.
- **Services:** Node + Fastify (or Express), `zod`, SQLite (`better-sqlite3`) or JSON persistence.
- **Tests:** Hardhat tests for every contract function and policy rule; Vitest for SDK and services.

```
talaria/
├─ CLAUDE.md                     # this file
├─ README.md
├─ .env.example
├─ contracts/                    # Hardhat project
│  ├─ contracts/ (TalariaUSD.sol, TalariaCore.sol, [TalariaRecurring.sol], TalariaLockbox.sol, MockUSDC.sol)
│  ├─ test/
│  └─ scripts/ (probe-*.ts, estimate-deploy.ts, deploy-*.ts, demo-*.ts)
├─ packages/sdk/
├─ services/relayer/  services/agent/  services/mcp/
├─ apps/web/  apps/demo-api/
├─ deployments/ (portaldot-testnet.json, base-sepolia.json)
├─ evidence/   (probe outputs, tx receipts JSON, screenshots list)
└─ docs/ (ARCHITECTURE.md, SECURITY.md, DEMO_SCRIPT.md, PITCH_OUTLINE.md, PROGRESS.md)
```

---

## 7. Phases, gates and definition of done

Times are Lagos time (UTC+1). If a phase runs long, report and propose cuts — do not silently skip.

### Phase 0 — Setup and chain probes (Mon Nov 2 evening)
- Init repo structure, pnpm workspace, Hardhat project, `.gitignore`, `.env.example`, secret-scan pre-commit hook, `README.md` skeleton, `docs/PROGRESS.md`.
- Probe scripts (read-only, no tPOT spent), save outputs to `evidence/`:
  - `eth_chainId`, `eth_blockNumber`, `web3_clientVersion`, `eth_gasPrice` on the EVM RPC.
  - Substrate: chain name, runtime spec name/version, token decimals/symbol, latest/finalized block.
  - Deployer balance on both sides (EVM wei and Substrate planck) and the mapping between them.
  - Check whether `debug_traceCall` exists.
- Implement and unit-test the address utils (H160 ↔ SS58 per 5.3) with test vectors.
- **DoD:** probes run and outputs committed; address utils tests pass; ≥ 3 commits pushed.
- **Gate:** report probe results + current tPOT balance; Maris says `go`.

### Phase 1 — Spike: first real deployment (Tue Nov 3 morning, time-box 3 hours)
- Deploy `TalariaUSD` only (after printing the estimate and getting `deploy`).
- Measure the real deposit; update constants in `estimate-deploy.ts`.
- Do one `faucet()` call and one `permit` + transfer, record tx hashes.
- **DoD:** tUSD live on V3 with recorded address/tx hashes; cost model calibrated.
- **Gate:** report real costs and the projected total for the remaining contracts. Maris decides **Lean** or **Lean + 4337** using 7.4.

### Phase 2 — TalariaCore contracts + tests (Tue Nov 3)
- Build in this order, committing after each: accounts & permit deposit → signed intents + nonces → session keys & policies & pending queue → checkout & refunds → subscriptions → streams → pay-per-call channels & batch redeem → remittance → bridge credit → receipts.
- Full Hardhat test suite: happy paths, policy violations, replay, expiry, over-cap, cancel, refund, reentrancy guard, access control.
- Run `estimate-deploy.ts`; if over budget, propose a split or cuts.
- **DoD:** all tests green; sizes and cost estimate reported.
- **Gate:** Maris approves deployment.

### Phase 3 — Deploy and first live flows (Tue night / Wed morning)
- Deploy TalariaCore (and split contracts) to V3; deploy MockUSDC + TalariaLockbox to Base Sepolia.
- Scripted demo transactions on V3 for every rail; record all hashes in `deployments/` and `evidence/`.
- **3B (only if approved):** deploy EntryPoint v0.7 + factory + paymaster, run one UserOp through a minimal bundler, record evidence. If it fails within 3 hours, stop and fall back to the lean path.
- **DoD:** every rail has at least one real V3 transaction recorded.

### Phase 4 — Services + SDK (Wed Nov 4)
- Relayer (bridge credit + intent submission), keeper, voucher settler.
- SDK with all methods in 4.4, typed, with examples and tests.
- Demo paid API with real chain data behind `paywall()`; `talaria.fetch()` handling 402 end-to-end.
- Agent service (deterministic parser first, LLM optional) and MCP server.
- **DoD:** end-to-end script: lock on Base Sepolia → credit on V3 → pay invoice; agent pays 10 API calls → one batch redeem; all hashes recorded.

### Phase 5 — Frontend (Wed Nov 4)
- Pages in 4.5, mobile-first, real data only, clear testnet labels, honest relayer disclosure.
- Deploy to Vercel (Maris connects the account); services to Railway/Render or run locally with documented commands.
- **DoD:** Maris can perform every rail from the web UI on a phone-sized screen.

### Phase 6 — Docs, evidence, submission pack (Thu Nov 5, before code freeze)
- README (Section 11), `docs/ARCHITECTURE.md` with a Mermaid diagram, `docs/SECURITY.md` (trust assumptions, known limits), `docs/DEMO_SCRIPT.md` (≤ 3 min shot list), `docs/PITCH_OUTLINE.md` (slide-by-slide content).
- Only bug fixes after **Nov 5, 04:00 UTC**. No new features.
- **DoD:** a judge can clone, follow the README and reproduce; every claim in the README is backed by `evidence/`.

### 7.4 tPOT decision gate (after Phase 1)
- If remaining tPOT ≥ (calibrated lean total × 1.3) + 1,500 **and** Maris approves → Lean + 4337 module.
- Else → Lean only. Describe it honestly as "account-abstraction-style: gasless signed intents, session keys, sponsored gas via relayer". Never claim ERC-4337 unless the EntryPoint path is actually live.
- If remaining tPOT < calibrated lean total → stop and tell Maris how much to request on Discord.

### 7.5 Cut order if time runs short
Cut from the bottom: (1) Checkout + cross-chain rail — never cut · (2) Pay-per-call + agent + MCP · (3) Subscriptions · (4) Streaming · (5) Remittance · (6) ERC-4337 module · (7) BNB testnet second source chain.

---

## 8. Contract design rules
- OpenZeppelin `ReentrancyGuard`, `EIP712`, `ECDSA`/`SignatureChecker`, `SafeERC20`, `Ownable2Step` or `AccessControl` for relayer role.
- Every external state-changing function: checks → effects → interactions; custom errors; events for every state change.
- Intents include: `rail`, `owner`, `signer`, `payee`, `amount`, `ref` (invoice/plan/stream/channel/remit id), `nonce`, `deadline`, `chainId` (domain), verifying contract (domain).
- Policies are enforced on-chain, never only in the UI or SDK.
- Pay-per-call vouchers: EIP-712 `{channelId, cumulativeAmount, nonce}`; redeem pays `cumulativeAmount − alreadyRedeemed`; reject non-increasing amounts.
- No `selfdestruct`, no `delegatecall` to untrusted targets, no upgradeable proxies in this build.
- Gas/storage: prefer `uint128`/`uint64` packing; avoid unbounded loops; batch functions take bounded arrays (max 50).

## 9. Off-chain rules
- All RPC calls through one client module with timeout, retry (exponential backoff, max 5) and logging.
- Idempotency: the relayer records processed `srcTxHash` and intent hashes before and after submission.
- Never accept private keys through HTTP, MCP tool input or the UI.
- `zod` validation on every API input and every LLM output.

## 10. Evidence and deployment records
`deployments/portaldot-testnet.json` per contract: `name, address, deployTxHash, blockNumber, runtimeBytecodeBytes, depositEstimateTPOT, depositActualTPOT, deployer, timestampUTC, gitCommit`.
`evidence/` holds: probe outputs, JSON receipts for every demo transaction (fetched right after sending), a `TRANSACTIONS.md` table (rail, action, tx hash, block, result). These feed the README and the DoraHacks form.

## 11. README must contain
Project name and one-liner · problem · solution · the five rails + agent layer · architecture diagram · why Portaldot (V3 features used) · deployed contracts table with addresses and tx hashes · how to run locally (exact commands) · how to test · how a judge can try it (wallet setup with chain ID 420420777, getting tUSD, no tPOT needed for gasless flows) · trust assumptions & limitations (trusted relayer, testnet tokens) · roadmap · credits & dependencies · prior work note (Qevie design inspiration, all code new) · license (MIT).

## 12. Report format (end of every phase, and whenever you stop)
```
PHASE: <n> — <name>
DONE: <bullet list, each with file paths>
VERIFIED ON-CHAIN: <tx hashes / addresses actually observed, or "none">
TESTS: <command run> → <real result>
UNVERIFIED / ASSUMPTIONS: <list>
tPOT: start <x> → spent <y> → remaining <z>
COMMITS: <count and short hashes>
PROBLEMS: <real errors and what you tried>
NEXT: <proposed next steps>
DECISIONS NEEDED FROM MARIS: <questions>
```

## 13. Stop-and-ask triggers
Stop and ask Maris when: a deployment or write transaction is next · the cost estimate exceeds the remaining budget · a fact in Section 5 is contradicted on-chain · a library or tool does not work on pallet-revive after two attempts · a requirement is ambiguous · you would need to add something outside Section 4 · any security concern.
