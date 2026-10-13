# Tollgate

Charge AI agents per request, in USDC on Solana, with a few lines of Express middleware. Built on the open [x402](https://github.com/x402-foundation/x402) protocol. MIT licensed.

An agent hits your endpoint, gets an HTTP 402 with a price, pays on-chain, retries, and gets the data. No accounts, no API keys, no card processor. Tollgate adds what the raw protocol does not: a **revenue ledger**, an **owner dashboard**, an **owner-side daily cap per wallet**, and an **agent-side budget** so an agent cannot overspend.

> Status: hackathon build for the Colosseum Crypto World's Fair. Payment logic runs on the official `@x402/*` packages. See [Limits](#limits-read-this) for exactly what is and is not verified.

## Quickstart (devnet, about 15 minutes)

```bash
npm install
npm test                 # 5 tests, runs offline against a mock facilitator
npm run setup            # creates two wallets, shows the faucet steps, waits for your test money, runs a health check
npm run demo             # starts the server, sends a real agent, prints Solana explorer links as proof
```

The only manual step is in your browser: get free **devnet USDC** for both wallets from https://faucet.circle.com (and optionally devnet SOL from https://faucet.solana.com). `npm run setup` prints the exact addresses to paste and notices when the money arrives.

Then open `http://localhost:3000/tollgate` to see the dashboard. Manual alternatives: `npm run wallets`, `npm run preflight`, `npm start`, `npm run demo:agent`. Settings live in `.env` (copy `.env.example`); locally, `PAY_TO` defaults to the owner wallet.

## Use it in your API

```ts
import express from "express";
import { tollgate } from "./src/index.js";

const app = express();
tollgate(app, {
  payTo: "YourSolanaAddress",
  network: "devnet",
  maxPerPayerPerDayUsd: 0.5,
  dashboardToken: process.env.DASHBOARD_TOKEN,
  routes: { "GET /api/brief": { price: "$0.01", description: "Research brief" } },
});
app.get("/api/brief", (_req, res) => res.json({ data: "only runs after payment settles" }));
```

Call `tollgate()` before defining the paid handlers.

## Use it from an agent

```ts
import { createAgent } from "./src/index.js";

const agent = await createAgent({
  secretKey: process.env.AGENT_SECRET_KEY!,           // base58 64-byte key
  budget: { perRequestUsd: 0.05, totalUsd: 1.0 },      // hard limits
});
const res = await agent.fetch("https://api.example.com/api/brief?topic=x402");
```

`agent.fetch` is a normal `fetch` that pays 402s automatically and throws before signing anything that would exceed the budget.

## How it works

```
agent ──GET /api/brief──────────────▶ Tollgate middleware
      ◀─402 + price, payTo, asset────
agent signs a USDC transfer (fee paid by facilitator)
      ──GET + PAYMENT-SIGNATURE─────▶ verify (facilitator) ─▶ owner cap check
                                      settle on Solana  ─▶ ledger.record()
      ◀─200 + data + PAYMENT-RESPONSE
```

- Revenue is recorded only in the `afterSettle` hook, after the transaction succeeded.
- The owner cap runs in the `afterVerify` hook, before settlement, so a refused payer is never charged.
- The ledger de-duplicates by transaction signature.

## Configuration

| Option | Meaning |
|---|---|
| `payTo` | Solana address that receives USDC |
| `network` | `devnet` (default), `mainnet`, or a CAIP-2 id |
| `routes` | `{ "METHOD /path": { price: "$0.01", description } }` |
| `maxPerPayerPerDayUsd` | Refuse a wallet once it has paid this much today (UTC) |
| `dashboardToken` | Protects `/tollgate` and its stats API |
| `ledgerFile` | JSON file for the ledger (omit for memory only) |
| `facilitatorUrl`, `rpcUrl` | Override facilitator / RPC |

## Deploy

Needs a long-running Node server (not serverless). `render.yaml` and a `Dockerfile` are included.

1. Push to GitHub, create a Render "Blueprint" from the repo.
2. Set `PAY_TO` (your owner address). Render generates `DASHBOARD_TOKEN`.
3. Visit `https://<your-app>.onrender.com/tollgate?token=...`.

## Limits (read this)

- **Verified by automated tests:** 402 challenge contents, paid retry returns data, revenue recorded once, failed settlement not counted, owner cap refusal, dashboard token. These use a mock facilitator.
- **Not covered by tests:** a real on-chain payment. Run `npm run preflight` and the demo against devnet and confirm a transaction on the Solana explorer before relying on it.
- The default facilitator (`x402.org`) supports **testnet/devnet only**. Mainnet needs a different facilitator.
- Ledger is a JSON file in one process. On hosts with ephemeral disks it resets on redeploy. A database-backed ledger is the obvious next step.
- If the facilitator is unreachable at startup, paid routes return an error instead of a 402 (they fail closed: no data is served without payment).
- The agent's total budget is per process; the owner cap is per wallet address.

## License

MIT
