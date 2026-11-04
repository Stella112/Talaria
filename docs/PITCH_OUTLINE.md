# Pitch outline

Update slides 4 and 7 from `pnpm stats` before submitting. Every number comes from `evidence/` or `deployments/`. Use no market-size figure without a source link.

## 1. Title
Talaria: trust-priced settlement for Portaldot.

## 2. Problem
- Money moves the same way for a stranger as for a trusted merchant: instantly with no recourse, or slowly for everyone.
- Reputation is stuck on the chain where it was earned.
- AI agents need spending limits that grow with their track record, not an owner's whole key.

## 3. Solution
Reputation from any chain decides how fast money moves on Portaldot, and what happens on Portaldot writes reputation back.
- Pay from anywhere: Base → Portaldot, and bridge-out back.
- Agents you can trust: mandates, plus caps priced by reputation.
- Money that can come back: disputes and refunds, with the hold set by trust.

## 4. Proof it works
- Live: 10 mUSDC locked on Base Sepolia, credited on Portaldot, and invoice 1 paid by a payer holding 0 tPOT. Show the three hashes from the README.
- Live: the full money shot on testnets. A new merchant's payment held, disputed, refunded to Base, negative feedback written, then instant settlement for a merchant with real history. Show the hashes from the README.
- Live: three ERC-8004 identities with real feedback on Base Sepolia.
- Live on Base Sepolia, settling to Portaldot: subscriptions, streaming, pay-per-call and remittance. Say they are not on Portaldot itself.

## 5. Why Portaldot is essential
- V3's EVM compatibility through pallet-revive lets standard Solidity settle on Portaldot.
- Multi-chain capability makes it a settlement and trust hub for value and reputation from elsewhere.
- Storage deposits reward the low-storage design: inline attestations, events for history, vouchers for micro-payments.

## 6. Ecosystem contribution
- MIT-licensed SDK, MCP server and address tools.
- A reputation layer other apps can use.
- Measured V3 costs and findings, in `docs/ARCHITECTURE.md`.

## 7. Business
Proposals, not traction: we have no users or revenue yet. Show the real `pnpm stats` output.
- Customers: Portaldot merchants, API sellers to agents, cross-border senders, agent builders.
- Revenue: a basis-point checkout fee, a protection premium priced by reputation, paid relayer and SDK tiers, bridge fees. All untested.
- Moat: reputation compounds with each settled payment, and is portable through ERC-8004.
- Go-to-market: Hacker House teams, Portaldot merchants, agent builders on Base, then remittance corridors with licensed off-ramp partners.

## 8. Trust assumptions
Single attester, single relayer, admin arbiter, no audit. Publishing this is part of the pitch.

## 9. Why continue supporting it
Roadmap: mainnet migration, multiple attesters, a reputation API, off-ramp partners.
Ask: testnet tPOT for the batch and remaining rails, a technical review of the bridge, mainnet migration support, and an ecosystem grant.
