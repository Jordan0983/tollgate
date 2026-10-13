import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const OUT = ".wallets.json";
if (existsSync(OUT) && !process.argv.includes("--force")) {
  console.error(`${OUT} already exists. Refusing to overwrite wallets (use --force only if they hold nothing).`);
  process.exit(1);
}

async function make() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const secret64 = new Uint8Array([...seed, ...pub]);
  const signer = await createKeyPairSignerFromBytes(secret64);
  const address = base58.encode(pub);
  if (signer.address !== address) throw new Error("Key derivation mismatch; refusing to continue.");
  return { address, secretKey: base58.encode(secret64) };
}

const owner = await make();
const agent = await make();
writeFileSync(OUT, JSON.stringify({ owner, agent }, null, 2), { mode: 0o600 });

const quiet = process.env.TOLLGATE_QUIET === "1";
console.log("Created .wallets.json (gitignored, mode 600). Never commit or share the secret keys.\n");
console.log(`Owner (receives USDC)  ${owner.address}`);
console.log(`Agent (pays USDC)      ${agent.address}`);
if (!quiet) console.log("\nNext: run `npm run setup`. It shows the faucet steps and waits for your test money.");
