# Talaria

Payments with wings: the account-abstraction payment and agentic commerce layer for Portaldot.

> Work in progress for the Portaldot Hacker House 2026. Testnet only. Progress is tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## Development

```bash
pnpm install
pnpm test
pnpm probe
```

`pnpm probe` is read-only and writes its output to `evidence/`. Copy `.env.example` to `.env` to include your own public addresses.

## Credits & Dependencies

Listed as they are added: viem, @polkadot/api, @polkadot/util-crypto, OpenZeppelin Contracts, Hardhat, Fastify, zod, dotenv, tsx, Vitest.

## License

MIT
