import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader } from "@x402/core/http";
import { tollgate } from "../src/index.js";
import { listen, mockFacilitator, PAY_TO } from "./helpers.js";

async function setup(opts: { cap?: number; token?: string; failSettle?: boolean; payer?: string } = {}) {
  const fac = mockFacilitator({ failSettle: opts.failSettle, payer: opts.payer });
  const facL = await listen(fac.app);
  const app = express();
  const tg = tollgate(app, {
    payTo: PAY_TO,
    routes: { "GET /api/research": { price: "$0.01", description: "Research brief" } },
    facilitatorClient: new HTTPFacilitatorClient({ url: facL.url }),
    maxPerPayerPerDayUsd: opts.cap,
    dashboardToken: opts.token,
  });
  app.get("/api/research", (_req, res) => res.json({ data: "secret" }));
  const L = await listen(app);
  const pay = async () => {
    const first = await fetch(L.url + "/api/research");
    const required = decodePaymentRequiredHeader(first.headers.get("payment-required")!);
    const sig = encodePaymentSignatureHeader({
      x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { transaction: "fake" },
    } as never);
    return fetch(L.url + "/api/research", { headers: { "PAYMENT-SIGNATURE": sig } });
  };
  const close = async () => { await L.close(); await facL.close(); };
  return { L, tg, fac, pay, close };
}

test("unpaid request gets a 402 challenge with the configured price and payee", async () => {
  const s = await setup();
  const r = await fetch(s.L.url + "/api/research");
  assert.equal(r.status, 402);
  const req = decodePaymentRequiredHeader(r.headers.get("payment-required")!);
  assert.equal(req.accepts[0].amount, "10000"); // $0.01 in 6-decimal USDC
  assert.equal(req.accepts[0].payTo, PAY_TO);
  assert.equal(s.tg.ledger.stats().paidCalls, 0);
  await s.close();
});

test("paid request returns data and is recorded exactly once", async () => {
  const s = await setup();
  const r = await s.pay();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { data: "secret" });
  const st = s.tg.ledger.stats();
  assert.equal(st.paidCalls, 1);
  assert.equal(st.totalUsd, 0.01);
  assert.equal(st.routes[0].route, "GET /api/research");
  await s.close();
});

test("a failed settlement is not counted as revenue", async () => {
  const s = await setup({ failSettle: true });
  const r = await s.pay();
  assert.notEqual(r.status, 200);
  assert.equal(s.tg.ledger.stats().paidCalls, 0);
  await s.close();
});

test("owner daily cap refuses a payer once reached and logs the refusal", async () => {
  const s = await setup({ cap: 0.02 });
  assert.equal((await s.pay()).status, 200);
  assert.equal((await s.pay()).status, 200);
  const third = await s.pay();
  assert.notEqual(third.status, 200, "third paid call must be refused");
  const st = s.tg.ledger.stats();
  assert.equal(st.paidCalls, 2);
  assert.equal(st.refusedCalls, 1);
  assert.match(st.recentRefusals[0].reason, /daily cap/);
  await s.close();
});

test("dashboard stats are public without a token and locked with one", async () => {
  const open = await setup();
  assert.equal((await fetch(open.L.url + "/tollgate/api/stats")).status, 200);
  await open.close();
  const locked = await setup({ token: "s3cret" });
  assert.equal((await fetch(locked.L.url + "/tollgate/api/stats")).status, 401);
  assert.equal((await fetch(locked.L.url + "/tollgate/api/stats?token=s3cret")).status, 200);
  await locked.close();
});
