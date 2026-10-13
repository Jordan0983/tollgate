import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, USDC_DEVNET_ADDRESS, USDC_MAINNET_ADDRESS } from "@x402/svm";
import { loadLocalEnv, localWallets } from "./local-env.js";

loadLocalEnv();
const wallets = localWallets();
const env = (k: string): string | undefined =>
  process.env[k] || (k === "PAY_TO" ? wallets?.owner.address : k === "AGENT_ADDRESS" ? wallets?.agent.address : undefined);
let failed = 0;
const ok = (m: string) => console.log(`  OK    ${m}`);
const bad = (m: string, fix?: string) => { failed++; console.log(`  FAIL  ${m}${fix ? `\n        fix: ${fix}` : ""}`); };

const network = env("NETWORK") ?? "devnet";
const caip = network === "mainnet" ? SOLANA_MAINNET_CAIP2 : network === "devnet" ? SOLANA_DEVNET_CAIP2 : network;
const usdc = network === "mainnet" ? USDC_MAINNET_ADDRESS : USDC_DEVNET_ADDRESS;
const facilitator = env("FACILITATOR_URL") ?? "https://x402.org/facilitator";
const rpc = env("RPC_URL") ?? (network === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");

async function rpcCall(method: string, params: unknown[] = []) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()) as { result?: any; error?: { message: string } };
}
async function usdcBalance(owner: string) {
  const j = await rpcCall("getTokenAccountsByOwner", [owner, { mint: usdc }, { encoding: "jsonParsed" }]);
  const accts = j.result?.value ?? [];
  return accts.reduce((s: number, a: any) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

console.log(`Tollgate preflight  (network: ${network}, ${caip})\n`);

if (!env("PAY_TO")) bad("PAY_TO is not set", "run `npm run wallets`, copy the owner address into .env");
else ok(`PAY_TO set (${env("PAY_TO")})`);
if (!env("DASHBOARD_TOKEN")) console.log("  WARN  DASHBOARD_TOKEN is not set: fine on your own computer, but set one before deploying or the dashboard is public");
else ok("DASHBOARD_TOKEN set");
if (network === "mainnet" && facilitator.includes("x402.org")) bad("x402.org facilitator is testnet-only", "set FACILITATOR_URL to a mainnet facilitator, or use NETWORK=devnet");

try {
  const r = await fetch(`${facilitator.replace(/\/$/, "")}/supported`);
  const j = (await r.json()) as { kinds?: { network: string; scheme: string }[] };
  const hit = j.kinds?.some((k) => k.network === caip && k.scheme === "exact");
  hit ? ok(`facilitator supports exact on ${caip}`) : bad(`facilitator ${facilitator} does not list exact on ${caip}`, "check NETWORK / FACILITATOR_URL");
} catch (e) { bad(`cannot reach facilitator ${facilitator}: ${(e as Error).message}`, "check your internet connection"); }

try {
  const j = await rpcCall("getHealth");
  j.result === "ok" ? ok(`RPC healthy (${rpc})`) : bad(`RPC unhealthy: ${JSON.stringify(j)}`, "set RPC_URL to a Helius/QuickNode free endpoint");
  if (env("PAY_TO")) {
    const b = await usdcBalance(env("PAY_TO")!);
    b > 0 ? ok(`owner has a USDC account (balance ${b})`) : bad("owner has no USDC token account yet", "request devnet USDC for the owner address at https://faucet.circle.com");
  }
  if (env("AGENT_ADDRESS")) {
    const b = await usdcBalance(env("AGENT_ADDRESS")!);
    b >= 0.05 ? ok(`agent USDC balance ${b}`) : bad(`agent USDC balance too low (${b})`, "fund the agent at https://faucet.circle.com");
  } else console.log("  --    set AGENT_ADDRESS to also check the agent's USDC balance");
} catch (e) { bad(`cannot reach RPC ${rpc}: ${(e as Error).message}`); }

console.log(failed ? `\n${failed} problem(s). Fix them before running the demo.` : "\nAll checks passed. Run `npm start`, then `npm run demo:agent`.");
process.exit(failed ? 1 : 0);
