# Demo script (under 3 minutes)

Built around the money shot. **Only record what has really happened.** Show Portaldot hashes on screen. If the trust flow has not run on testnets yet, use "Version B" and label local parts `LOCAL` on screen.

Before recording, check `pnpm stats`, have the web app and relayer running, and open `evidence/TRANSACTIONS.md`. Build Trusted Coffee's history first with `pnpm demo:trust -- --seed`, which needs real purchases and a 30-minute hold.

## Version A: after the batch is deployed on testnet

| Time | Screen | Say |
|---|---|---|
| 0:00–0:20 | Overview page | "Reputation is stuck on one chain, and money moves the same way for a stranger as for a trusted merchant. Talaria changes that. Reputation from any chain decides how fast money moves on Portaldot, and what happens on Portaldot writes reputation back." |
| 0:20–0:45 | `pnpm demo:trust`, steps 1–2, then the payment page with its badge | "An agent buys from New Shop, under a mandate, with funds locked on Base. New Shop has no history, so the badge says protected for 30 minutes, and the money is held on Portaldot. Here's the hash." |
| 0:45–1:10 | Steps 3–4, then the Base release | "The purchase goes wrong. A dispute freezes the funds, the arbiter refunds them, and bridge-out sends the money back to Base." |
| 1:10–1:30 | Step 5, Base feedback transaction | "That outcome becomes reputation: negative feedback for New Shop on the ERC-8004 registry on Base, referencing the Portaldot payment." |
| 1:30–1:55 | Step 6, Trusted Coffee with its badge and instant release | "Now Trusted Coffee, with real history from settled payments. Same agent, same flow, but it settles instantly, and positive feedback is written back." |
| 1:55–2:20 | Agent page: cap and mandate screen | "Agents get a budget, not a key. A mandate binds one agent to one merchant and amount, and the agent's cap rises with its own reputation. All of it is enforced on-chain." |
| 2:20–2:45 | README status table and `pnpm stats` | "These are real counts from our records. We have no customers yet. The attester, relayer and arbiter are single trusted parties today, and we publish that." |
| 2:45–3:00 | Overview | "Next: more attesters, a multi-signer bridge and mainnet. Talaria: trust-priced settlement for Portaldot." |

## Version B: if tPOT has not arrived

Use only what is live, and show the rest as `LOCAL`.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:20 | Overview page | Same opening. |
| 0:20–1:00 | `evidence/TRANSACTIONS.md`, then `/pay/1` | "This is live on testnet. Ten test USDC locked on Base. Our relayer credited Portaldot. A payer with no tPOT signed once and paid invoice 1. Here it is, read from the chain." |
| 1:00–2:10 | Terminal with `LOCAL` caption: `pnpm --filter @talaria-pay/contracts exec hardhat test test/TrustFlow.test.ts` | "This next part is a local chain, not testnet, with the Base registry stubbed. A new merchant's payment is held and disputed, refunded back through bridge-out, and negative feedback is written. Then a trusted merchant settles instantly. Our contracts for this are built, and need about 789 tPOT to deploy." |
| 2:10–2:40 | `docs/ARCHITECTURE.md` cost table | "We measured what V3 deployment really costs, and published it, with an MIT SDK." |
| 2:40–3:00 | README status table | "We say plainly what's live and what isn't, and what you have to trust." |

## Check before submitting

- [ ] Under 3 minutes, at a public link.
- [ ] Every hash shown matches `evidence/TRANSACTIONS.md`.
- [ ] Nothing local is described as live.
