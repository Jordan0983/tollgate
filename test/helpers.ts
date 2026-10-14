import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SOLANA_DEVNET_CAIP2 } from "@x402/svm";

export const PAY_TO = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
export const FEE_PAYER = "EwWqGE4ZFKLofuestmU4LDdK7XM1N4ALgdZccwYugwGd";

export interface Listening {
  url: string;
  close(): Promise<void>;
}

export function listen(app: express.Express): Promise<Listening> {
  return new Promise((resolve) => {
    const srv: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

/** A stand-in for the x402 facilitator: accepts any payment and "settles" it. */
export function mockFacilitator(opts: { payer?: string; failSettle?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  const calls = { verify: 0, settle: 0 };
  const verifyBodies: any[] = [];
  let n = 0;
  app.get("/supported", (_req, res) => {
    res.json({
      kinds: [{ x402Version: 2, scheme: "exact", network: SOLANA_DEVNET_CAIP2, extra: { feePayer: FEE_PAYER } }],
      extensions: [],
      signers: { "solana:*": [FEE_PAYER] },
    });
  });
  app.post("/verify", (req, res) => {
    calls.verify++;
    verifyBodies.push(req.body);
    res.json({ isValid: true, payer: opts.payer ?? "PayerAgent111111111111111111111111111111111" });
  });
  app.post("/settle", (_req, res) => {
    calls.settle++;
    if (opts.failSettle) return void res.json({ success: false, errorReason: "boom", transaction: "", network: SOLANA_DEVNET_CAIP2 });
    res.json({
      success: true,
      payer: opts.payer ?? "PayerAgent111111111111111111111111111111111",
      transaction: `MockTx${++n}`,
      network: SOLANA_DEVNET_CAIP2,
    });
  });
  return { app, calls, verifyBodies };
}

/** Minimal local stand-in for a Solana RPC node: only what the x402 client needs to build a payment. */
export function mockSolanaRpc() {
  const app = express();
  app.use(express.json());
  const seen: string[] = [];
  const BLOCKHASH = "EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k"; // any valid 32-byte base58 value
  // 82-byte SPL Token mint: decimals = 6 at offset 44, is_initialized = 1 at offset 45.
  const mint = Buffer.alloc(82);
  mint[44] = 6;
  mint[45] = 1;
  app.post("/", (req, res) => {
    const { id, method } = req.body as { id: number; method: string };
    seen.push(method);
    if (method === "getAccountInfo") {
      return void res.json({
        jsonrpc: "2.0", id,
        result: {
          context: { slot: 1 },
          value: {
            data: [mint.toString("base64"), "base64"],
            executable: false, lamports: 1461600, rentEpoch: 0, space: 82,
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          },
        },
      });
    }
    if (method === "getLatestBlockhash") {
      return void res.json({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 } } });
    }
    res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `mock RPC does not implement ${method}` } });
  });
  return { app, seen };
}
