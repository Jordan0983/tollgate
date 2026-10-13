import express from "express";
import { tollgate } from "../src/index.js";
import { loadLocalEnv, localWallets } from "../scripts/local-env.js";

loadLocalEnv();
// Empty values (like `RPC_URL=` copied from .env.example) count as unset.
const env = (k: string, d?: string) => process.env[k] || d;
const payTo = env("PAY_TO") ?? localWallets()?.owner.address;
if (!payTo) {
  console.error("No receiving wallet. Run `npm run wallets` first (or set PAY_TO in .env).");
  process.exit(1);
}
if (!env("PAY_TO")) console.log("PAY_TO not set: using the owner wallet from .wallets.json (local development only).");

const app = express();
app.set("trust proxy", 1);

const cap = env("MAX_PER_PAYER_PER_DAY_USD");
const tg = tollgate(app, {
  payTo,
  network: env("NETWORK", "devnet"),
  facilitatorUrl: env("FACILITATOR_URL"),
  rpcUrl: env("RPC_URL"),
  maxPerPayerPerDayUsd: cap ? Number(cap) : undefined,
  ledgerFile: env("LEDGER_FILE", "data/ledger.json"),
  dashboardToken: env("DASHBOARD_TOKEN"),
  routes: {
    "GET /api/brief": { price: "$0.01", description: "One-page research brief on a topic" },
    "GET /api/quote": { price: "$0.002", description: "Latest demo price quote for a symbol" },
  },
});

// Free routes
app.get("/", (_req, res) => res.redirect("/tollgate"));
app.get("/healthz", (_req, res) => res.json({ ok: true, network: tg.network }));

// Paid routes. Handlers only run after the payment has verified and settled.
// NOTE: the payloads below are deterministic demo data, not live market or research data.
app.get("/api/brief", (req, res) => {
  const topic = String(req.query.topic ?? "agent payments").slice(0, 80);
  res.json({
    topic,
    brief: `Demo brief on "${topic}": three key points, two open questions, one recommended next step.`,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/api/quote", (req, res) => {
  const symbol = String(req.query.symbol ?? "SOL").toUpperCase().slice(0, 10);
  res.json({ symbol, price: 100 + (symbol.charCodeAt(0) % 50), note: "demo data", at: new Date().toISOString() });
});

const port = Number(env("PORT", "3000"));
app.listen(port, "0.0.0.0", () => {
  console.log(`Tollgate demo on :${port}`);
  console.log(`  network   ${tg.network}`);
  console.log(`  paid to   ${payTo}`);
  console.log(`  dashboard http://localhost:${port}/tollgate${env("DASHBOARD_TOKEN") ? "?token=<DASHBOARD_TOKEN>" : ""}`);
});
