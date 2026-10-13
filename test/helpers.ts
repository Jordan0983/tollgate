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
  let n = 0;
  app.get("/supported", (_req, res) => {
    res.json({
      kinds: [{ x402Version: 2, scheme: "exact", network: SOLANA_DEVNET_CAIP2, extra: { feePayer: FEE_PAYER } }],
      extensions: [],
      signers: { "solana:*": [FEE_PAYER] },
    });
  });
  app.post("/verify", (_req, res) => {
    calls.verify++;
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
  return { app, calls };
}
