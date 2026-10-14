import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import express from "express";
import { base58 } from "@scure/base";
import { getTransactionDecoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { USDC_DEVNET_ADDRESS } from "@x402/svm";
import { createAgent, tollgate } from "../src/index.js";
import { FEE_PAYER, PAY_TO, listen, mockFacilitator, mockSolanaRpc } from "./helpers.js";

function newSecretKey(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return base58.encode(new Uint8Array([...seed, ...pub]));
}

/** Real agent (real signing) -> real middleware, with a mock Solana RPC and a mock facilitator. */
async function setup(budget: { perRequestUsd: number; totalUsd: number }) {
  const rpc = mockSolanaRpc();
  const rpcL = await listen(rpc.app);
  const agent = await createAgent({ secretKey: newSecretKey(), rpcUrl: rpcL.url, budget });

  const fac = mockFacilitator({ payer: agent.address });
  const facL = await listen(fac.app);

  const app = express();
  const tg = tollgate(app, {
    payTo: PAY_TO,
    routes: {
      "GET /api/cheap": { price: "$0.01", description: "cheap" },
      "GET /api/pricey": { price: "$0.10", description: "pricey" },
    },
    facilitatorClient: new HTTPFacilitatorClient({ url: facL.url }),
  });
  let pricey = 0;
  app.get("/api/cheap", (_req, res) => res.json({ ok: true }));
  app.get("/api/pricey", (_req, res) => { pricey++; res.json({ ok: true }); });
  const L = await listen(app);

  const close = async () => { await L.close(); await facL.close(); await rpcL.close(); };
  return { agent, tg, fac, rpc, L, close, priceyHandlerRuns: () => pricey };
}

test("agent signs a real transfer, pays, and the server records exactly what it was paid", async () => {
  const s = await setup({ perRequestUsd: 0.05, totalUsd: 1 });
  const res = await s.agent.fetch(`${s.L.url}/api/cheap`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const st = s.tg.ledger.stats();
  assert.equal(st.paidCalls, 1);
  assert.equal(st.totalUsd, 0.01);
  assert.equal(st.payers[0].payer, s.agent.address);
  assert.equal(Number(s.agent.spentUsd().toFixed(4)), 0.01);

  // Inspect the transaction the agent actually signed.
  const body = s.fac.verifyBodies[0];
  const b64: string = body.paymentPayload.payload.transaction;
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  const tx = getTransactionDecoder().decode(bytes);
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const accounts = msg.staticAccounts.map(String);
  assert.equal(accounts[0], FEE_PAYER, "facilitator must be the fee payer");
  assert.ok(accounts.includes(s.agent.address), "agent must be in the transaction");
  assert.ok(accounts.includes(USDC_DEVNET_ADDRESS), "devnet USDC mint must be referenced");
  assert.ok(tx.signatures[s.agent.address as keyof typeof tx.signatures], "agent must have signed");
  assert.equal(tx.signatures[FEE_PAYER as keyof typeof tx.signatures], null, "fee payer signs later, at settlement");

  assert.ok(s.rpc.seen.includes("getAccountInfo"), "agent should read the mint before paying");
  await s.close();
});

test("agent stops by itself when the next payment would exceed its total budget", async () => {
  const s = await setup({ perRequestUsd: 0.05, totalUsd: 0.025 });
  assert.equal((await s.agent.fetch(`${s.L.url}/api/cheap`)).status, 200);
  assert.equal((await s.agent.fetch(`${s.L.url}/api/cheap`)).status, 200);
  await assert.rejects(() => s.agent.fetch(`${s.L.url}/api/cheap`), /budget/i);

  assert.equal(s.tg.ledger.stats().paidCalls, 2, "third payment must never reach the server");
  assert.equal(s.fac.calls.settle, 2);
  assert.equal(Number(s.agent.spentUsd().toFixed(4)), 0.02);
  assert.equal(Number(s.agent.remainingUsd().toFixed(4)), 0.005);
  await s.close();
});

test("agent refuses a single price above its per-request cap and the data is never served", async () => {
  const s = await setup({ perRequestUsd: 0.05, totalUsd: 1 });
  await assert.rejects(() => s.agent.fetch(`${s.L.url}/api/pricey`));
  assert.equal(s.tg.ledger.stats().paidCalls, 0);
  assert.equal(s.priceyHandlerRuns(), 0);
  assert.equal(s.agent.spentUsd(), 0);
  await s.close();
});
