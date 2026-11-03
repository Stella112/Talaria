# Pitch outline

Update slides 4 and 6 if more rails go live. Every number here comes from `evidence/` or `deployments/`.

## 1. Title
Talaria: payments with wings. The payment and agentic commerce layer for Portaldot.

## 2. Problem
- Payers need the right token, on the right chain, plus gas.
- Merchants on a new chain have no checkout, subscriptions or refunds to build on.
- AI agents need spending limits, not an owner's whole key, and a transaction per API call doesn't work.

## 3. Solution
One path for every payment: signed intent → policy check → execute → receipt.
Five rails: checkout, subscriptions, streaming, pay-per-call, remittance. On top of them: session keys, an approval queue, 402 paywalls, Autopilot and an MCP server.

## 4. Proof it works
- Live: 10 mUSDC locked on Base Sepolia, credited on Portaldot by the relayer, and invoice 1 paid by a payer holding 0 tPOT.
- Show the three hashes from the README.
- Built and tested: all five rails, with the tests on a local chain.
- Not yet deployed: four rail contracts. Say so, and say why.

## 5. Why Portaldot is essential
- V3 runs standard Solidity through pallet-revive, on a Substrate chain with native account mapping.
- Multi-chain funding gives Portaldot a way to receive value from other ecosystems.
- It's early. Payments infrastructure here unlocks every merchant and agent app that follows.
- Storage deposits reward the low-storage design: events for history, vouchers for micro-payments.

## 6. Ecosystem contribution
- MIT-licensed SDK and address utilities for H160 and SS58.
- Measured costs: about 0.08 tPOT per byte, and about 3.84 tPOT per new slot.
- Findings for other builders, including the balance rule and funding route, in `docs/ARCHITECTURE.md`.

## 7. Business potential
These are proposals, not traction. There are no users or revenue yet.
- Users: merchants and API providers on Portaldot, plus agent developers.
- Model: a small fee per settled payment, and hosted relayer plans. Both untested.
- Growth: start with API providers, since pay-per-call needs the least merchant change.

## 8. Why keep supporting it
- A clear plan for the funding: deploy the remaining rails, then exercise them live.
- Honest engineering: trust limits and undeployed parts are published.
- Next milestones: remaining rails on testnet, multi-signer bridge, audit, mainnet.

## 9. Ask
Testnet tPOT for the remaining rails, technical review of the bridge, and mainnet migration support.
