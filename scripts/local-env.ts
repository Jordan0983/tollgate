import { existsSync, readFileSync } from "node:fs";

/** Load ./.env into process.env (real environment variables win). Safe if the file is missing. */
export function loadLocalEnv(): void {
  if (!existsSync(".env")) return;
  try {
    process.loadEnvFile(".env");
  } catch (e) {
    console.warn(`Could not read .env: ${(e as Error).message}`);
  }
}

export interface Wallet { address: string; secretKey: string }
export interface Wallets { owner: Wallet; agent: Wallet }

/** The wallets created by `npm run wallets`, if present. Local development convenience only. */
export function localWallets(): Wallets | undefined {
  try {
    return JSON.parse(readFileSync(".wallets.json", "utf8")) as Wallets;
  } catch {
    return undefined;
  }
}
