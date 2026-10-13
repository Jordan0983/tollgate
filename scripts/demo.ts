import { spawn, spawnSync } from "node:child_process";
import { loadLocalEnv } from "./local-env.js";

loadLocalEnv();
const port = process.env.PORT || "3000";
const base = `http://localhost:${port}`;
const token = process.env.DASHBOARD_TOKEN;
const win = process.platform === "win32";

console.log("Starting the toll booth server...");
const server = spawn("npx", ["tsx", "examples/server.ts"], { stdio: ["ignore", "inherit", "inherit"], shell: win, env: { ...process.env, PORT: port } });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("exit", stop);

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await new Promise((r) => setTimeout(r, 750));
  try { up = (await fetch(`${base}/healthz`)).ok; } catch { /* not ready yet */ }
}
if (!up) { console.error("Server did not start. Scroll up for the error."); process.exit(1); }

console.log("\nSending the robot (agent)...\n");
spawnSync("npx", ["tsx", "examples/agent.ts"], { stdio: "inherit", shell: win, env: { ...process.env, SERVER_URL: base } });

try {
  const r = await fetch(`${base}/tollgate/api/stats${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  const s = (await r.json()) as { paidCalls: number; totalUsd: number; recent: { tx: string; network: string; usd: number }[] };
  console.log("\n==================== RESULT ====================");
  if (!s.paidCalls) {
    console.log("No payment settled. Scroll up: the agent's error line says why.");
    console.log("Common causes: wallet not funded (run `npm run setup`), facilitator unreachable (internet/VPN).");
  } else {
    console.log(`${s.paidCalls} real payment(s) settled, total $${s.totalUsd.toFixed(4)} USDC (devnet).`);
    console.log("Proof: open each transaction on the Solana explorer and screenshot it:");
    for (const p of s.recent) console.log(`  $${p.usd.toFixed(4)}  https://explorer.solana.com/tx/${p.tx}?cluster=devnet`);
  }
  console.log(`\nDashboard (leave this window open, then open it in your browser):\n  ${base}/tollgate${token ? `?token=${token}` : ""}`);
  console.log("\nPress Ctrl+C here when you are done.");
} catch (e) {
  console.error(`Could not read stats: ${(e as Error).message}`);
}
await new Promise(() => {}); // keep the server alive for the dashboard
