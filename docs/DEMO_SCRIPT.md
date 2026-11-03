# Demo script (under 3 minutes)

Rule: show only what is real. Anything local is labelled `LOCAL` on screen, and nothing undeployed is presented as live.

Before recording: have the app running with `pnpm --filter @talaria-pay/web start`, the evidence file open, and a terminal ready at the repo root. Check the Status page first, and use the "if more tPOT arrives" shots only if they have actually happened.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:20 | Status page on a phone-sized window | "Paying with crypto means the right token, on the right chain, with gas. Agents have it worse. Talaria makes every payment one path: signed intent, policy check, execute, receipt. This page is reading Portaldot live." |
| 0:20–0:40 | Scroll to Contracts, then the README's deployed table | "Core and the token are live on Portaldot V3, and the lockbox is live on Base Sepolia. There's no EVM explorer here, so every receipt is saved in the repo." |
| 0:40–1:25 | `evidence/TRANSACTIONS.md`, highlight lock, credit, payInvoice, then open `/pay/1` | "This is the real flow. Ten test USDC locked on Base Sepolia. Our relayer saw it and credited Portaldot. Then a brand-new payer, holding zero tPOT, signed one intent and paid invoice 1. The relayer paid the gas. Here's that invoice, read live from the chain." |
| 1:25–1:50 | `contracts/contracts/TalariaCore.sol`, the `_withinPolicy` function | "For agents, session keys carry limits enforced on-chain: per payment, per day, expiry, rail and payee. Over the limit, the payment doesn't fail silently and doesn't go through: it waits for the owner." |
| 1:50–2:20 | Terminal: `pnpm --filter @talaria-pay/contracts test`, showing the SDK integration tests, with `LOCAL` in a caption | "Pay-per-call and the other three rails are built and tested. This is a local chain, not testnet: an agent pays a real 402 API ten times, and it settles once. Deposits on V3 use about 3.84 tPOT per new storage slot, so these rails are waiting on more testnet tokens." |
| 2:20–2:45 | `docs/ARCHITECTURE.md` cost table and findings | "We measured what deploying really costs on V3, and published it with an MIT SDK, so the next builder doesn't have to find out the hard way." |
| 2:45–3:00 | README status table | "The bridge today is one trusted relayer, and we say so. Next: deploy the remaining rails, then a multi-signer bridge. Talaria: payments with wings." |

## If more tPOT arrives before recording

Replace 1:50–2:20 with the live version, only after the transaction is recorded in `evidence/`:

- Authorise a session key in the Agent page, and pay within limits and over limits.
- Show `TalariaChannels` settling 10 calls in one batch.

## Check before submitting

- [ ] Under 3 minutes, at a public link.
- [ ] Every hash shown matches `evidence/TRANSACTIONS.md`.
- [ ] Nothing local is described as live.
