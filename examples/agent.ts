import { createAgent } from "../src/index.js";
import { loadLocalEnv, localWallets } from "../scripts/local-env.js";

loadLocalEnv();
const secret = process.env.AGENT_SECRET_KEY || localWallets()?.agent.secretKey;
if (!secret) {
  console.error("No agent wallet. Run `npm run wallets` first (or set AGENT_SECRET_KEY).");
  process.exit(1);
}
const server = process.env.SERVER_URL || "http://localhost:3000";

const agent = await createAgent({
  secretKey: secret,
  rpcUrl: process.env.RPC_URL || undefined,
  budget: { perRequestUsd: 0.05, totalUsd: Number(process.env.AGENT_BUDGET_USD ?? "0.03") },
  onPayment: ({ url, usd, totalUsd }) =>
    console.log(`  paid $${usd.toFixed(4)} -> ${url}  (spent so far $${totalUsd.toFixed(4)})`),
});

console.log(`Agent ${agent.address}`);
console.log(`Budget $${agent.remainingUsd().toFixed(4)} total. Server ${server}\n`);

const topics = ["agent payments", "stablecoin settlement", "x402 adoption", "micropayments", "api monetization"];
for (const t of topics) {
  console.log(`> GET /api/brief?topic=${t}`);
  try {
    const res = await agent.fetch(`${server}/api/brief?topic=${encodeURIComponent(t)}`);
    if (!res.ok) {
      console.log(`  stopped: HTTP ${res.status}`);
      break;
    }
    const body = (await res.json()) as { brief: string };
    console.log(`  got: ${body.brief}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.log(/budget/i.test(msg) ? `  stopped by the agent's own budget guard: ${msg}` : `  request failed: ${msg} (is the server running? is the wallet funded?)`);
    break;
  }
}
console.log(`\nDone. Spent $${agent.spentUsd().toFixed(4)}, remaining $${agent.remainingUsd().toFixed(4)}.`);
