# Security

Talaria is a hackathon build on testnets, using test tokens with no value. It has had no third-party audit. Do not use it with real funds.

## Trust assumptions

| Who | Can do | Cannot do |
|---|---|---|
| Relayer | Credit any address from the bridge reserve; choose which intents and locks to submit; delay or censor them | Forge signed intents; spend internal balances; credit the same source transaction twice; exceed the reserve |
| Core owner | Change the relayer; register rail contracts, **which can move anyone's internal balance** | Upgrade Core, which has no proxy |
| Lockbox owner | Release any locked mUSDC | Affect Portaldot balances directly |
| tUSD owner | Mint any amount | Move other holders' tokens |
| Session key | Spend within its on-chain policy; queue intents for the owner | Exceed its limits unapproved; manage keys; act after expiry or revocation |

In the current deployment one key is the deployer, Core owner, lockbox owner, tUSD owner and relayer. A production system would separate these and use multi-signer control.

## Trust-priced settlement

- **Attester.** One key signs reputation scores. If it is compromised, it can make any merchant look trusted, removing buyers' hold window, or give an agent a higher cap up to its mandate. The contract's attester is fixed at deploy, so replacing it needs a redeploy.
- **Arbiter.** One address decides every dispute. It can give the funds to either side.
- **Score scope.** Only the settlement wallet's feedback counts. This resists fake reviews, but the wallet is another trusted party.
- **Tiers are fixed at deploy,** to save about 28 tPOT of bytecode.
- **Gasless disputes carry no reason hash.** A direct `dispute` call can include one.
- **A merchant can refuse to refund after release,** and a released payment can no longer be disputed. That is why new merchants have a hold.
- **Mandates move funds without Core's session-key policy.** The owner's mandate signature is the authority, with its own limits.
- **The hosted agent's rate limits are in memory,** per process. Forwarded addresses are ignored unless `TRUST_PROXY=1`, which should only be set behind a known proxy.
- **Bridge-out locks tUSD and does not burn it.** Total supply stays the same.

## Bridge

A single trusted relayer means locks and credits are not linked trustlessly. If the relayer is offline, or the reserve is empty, a lock is not credited, and only the lockbox owner can release it. The app turns off "Pay from Base" when the reserve is too low. Multi-signer bridging is on the roadmap only.

## Known limitations

- **Hand-written token and signature code.** `TalariaUSD` and intent verification avoid OpenZeppelin in places to reduce deposits. `ecrecover` is used without an s-value malleability check. Nonces and cumulative amounts prevent replay, and malleability gives no extra spend.
- **Single-step ownership on tUSD**, and an immutable owner on Core, chosen for size.
- **Global faucet cap**, with no per-user limit: one person could drain the 10M tUSD test allowance.
- **Sequential nonces per signer.** Two simultaneous intents from one signer can conflict, and the second must be re-signed.
- **Queue griefing.** A valid session key can keep queuing intents, which costs the relayer deposits. Revoke the key to stop this. The relayer's hourly cap limits the damage.
- **Subscriptions.** After subscribing, anyone can trigger a due charge, up to the plan's period limit, until cancelled. Each intent-based subscription is checked against the policy only when it is created, not on each later charge.
- **Stale approvals.** Owner approval of a queued intent does not re-check the key, since approving is an explicit owner action.
- **Paywall state is in memory**, in one process. After a restart it trusts the on-chain redeemed amount, so an unredeemed voucher could buy repeat calls. On-chain settlement stays correct.
- **Claim links hold a one-time key in the URL fragment.** Anyone holding the link can claim. Claims sign the receiver, so a watcher of pending transactions cannot redirect them.
- **Pruned logs.** The eth-rpc may prune old data, so the app's receipt lists can be incomplete. `evidence/` keeps the demo receipts.

## Keys

- Keys live only in git-ignored `.env` files. `.env.example` holds no secrets.
- A pre-commit hook in `.githooks/` blocks likely private keys, mnemonics and `.env` files. Enable it with `git config core.hooksPath .githooks`.
- No HTTP route or MCP tool accepts a key. The relayer and agent reject unknown fields.
- Browser users sign in their own wallet, and the app never sees the key.

## Relayer spending controls

Writes are refused unless `RELAYER_LIVE=1`. Calls are simulated first, an hourly cap applies, and retried requests return the earlier result.
