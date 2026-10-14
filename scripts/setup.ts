import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { USDC_DEVNET_ADDRESS } from "@x402/svm";
import { loadLocalEnv, localWallets } from "./local-env.js";

loadLocalEnv();
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

if (!existsSync(".wallets.json")) {
  console.log("Creating your two wallets...\n");
  const r = spawnSync("npx", ["tsx", "scripts/wallets.ts"], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, TOLLGATE_QUIET: "1" } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const w = localWallets();
if (!w) { console.error("Could not read .wallets.json"); process.exit(1); }

// Public addresses only (no secret keys), one per line, so they are easy to select and copy on a phone.
writeFileSync(
  "faucet-addresses.txt",
  `OWNER address (receives USDC). Paste this into the faucet first:\n${w.owner.address}\n\nAGENT address (pays USDC). Paste this into the faucet second:\n${w.agent.address}\n`,
);

console.log("\n==============================================================");
console.log(" YOUR ONLY MANUAL STEP: get free test money in your browser");
console.log("==============================================================");
console.log(" 1. Open https://faucet.circle.com  -> Solana, Devnet, USDC");
console.log(`      paste OWNER address:  ${w.owner.address}`);
console.log(" 2. Do it again for the AGENT address:");
console.log(`      paste AGENT address:  ${w.agent.address}`);
console.log(" 3. (Optional safety) https://faucet.solana.com -> devnet -> 1 SOL to the AGENT address");
console.log("\n On a phone: open faucet-addresses.txt in the file list; the addresses are easier to copy there.");
console.log(" This window will notice when the money arrives. Leave it open.\n");

async function usdc(owner: string): Promise<number> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [owner, { mint: USDC_DEVNET_ADDRESS }, { encoding: "jsonParsed" }] }),
  });
  const j = (await r.json()) as { result?: { value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] } };
  return (j.result?.value ?? []).reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

const deadline = Date.now() + 25 * 60_000;
let lastLine = "";
for (;;) {
  let line: string, ownerOk = false, agentOk = false;
  try {
    const [o, a] = await Promise.all([usdc(w.owner.address), usdc(w.agent.address)]);
    ownerOk = o > 0; agentOk = a >= 0.05;
    line = `  owner USDC: ${o} ${ownerOk ? "[ok]" : "[waiting]"}   agent USDC: ${a} ${agentOk ? "[ok]" : "[waiting]"}`;
  } catch (e) {
    line = `  cannot reach Solana yet (${(e as Error).message}); retrying. Check your internet / VPN.`;
  }
  if (line !== lastLine) { console.log(line); lastLine = line; }
  if (ownerOk && agentOk) break;
  if (Date.now() > deadline) { console.log("\nGave up waiting after 25 minutes. Re-run `npm run setup` after funding."); process.exit(1); }
  await new Promise((r) => setTimeout(r, 5000));
}

console.log("\nFunded. Running the health check...\n");
const p = spawnSync("npx", ["tsx", "scripts/preflight.ts"], { stdio: "inherit", shell: process.platform === "win32" });
console.log(p.status === 0 ? "\nAll good. Next command:  npm run demo" : "\nFix the FAIL lines above, then run `npm run setup` again.");
process.exit(p.status ?? 0);
