import type { Express, Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from "@x402/svm";
import { fileURLToPath } from "node:url";
import { Ledger, atomicToUsd } from "./ledger.js";

export const DEFAULT_TESTNET_FACILITATOR = "https://x402.org/facilitator";

export interface TollgateRoute {
  /** Price in USD, e.g. "$0.01". Settled in USDC. */
  price: string;
  description?: string;
  mimeType?: string;
}

export interface TollgateConfig {
  /** Solana address that receives the USDC. */
  payTo: string;
  /** "devnet" | "mainnet" | a CAIP-2 id. Defaults to devnet. */
  network?: string;
  /** Route key is "METHOD /path", exactly as x402 expects, e.g. "GET /api/research". */
  routes: Record<string, TollgateRoute | string>;
  facilitatorUrl?: string;
  /** Optional RPC; lets the 402 challenge embed a blockhash so agents save a round trip. */
  rpcUrl?: string;
  /** Owner-side cap: refuse further payments from one payer once they have spent this much today (UTC). */
  maxPerPayerPerDayUsd?: number;
  /** JSON file for the ledger. Omit for in-memory only. */
  ledgerFile?: string;
  /** If set, the dashboard and stats API require ?token=... or an x-dashboard-token header. */
  dashboardToken?: string;
  /** Override the facilitator client (used by tests). */
  facilitatorClient?: FacilitatorClient;
  /** Where the dashboard is mounted. Defaults to /tollgate. */
  mountPath?: string;
}

export interface Tollgate {
  ledger: Ledger;
  network: string;
}

export function resolveNetwork(n?: string): string {
  if (!n || n === "devnet") return SOLANA_DEVNET_CAIP2;
  if (n === "mainnet" || n === "mainnet-beta") return SOLANA_MAINNET_CAIP2;
  if (!n.includes(":")) throw new Error(`Unknown network "${n}". Use "devnet", "mainnet" or a CAIP-2 id like "solana:...".`);
  return n;
}

const normalizeRoute = (r: TollgateRoute | string): TollgateRoute => (typeof r === "string" ? { price: r } : r);

function tokenOk(req: Request, token?: string): boolean {
  if (!token) return true;
  const given = (req.query.token as string | undefined) ?? req.get("x-dashboard-token");
  return given === token;
}

/**
 * Put a pay-per-request paywall in front of the routes in `config.routes`,
 * record every settled payment, and mount the owner dashboard.
 *
 * Call this BEFORE you define the paid route handlers.
 */
export function tollgate(app: Express, config: TollgateConfig): Tollgate {
  const network = resolveNetwork(config.network);
  const ledger = new Ledger(config.ledgerFile);
  const mount = config.mountPath ?? "/tollgate";

  const facilitator =
    config.facilitatorClient ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl ?? DEFAULT_TESTNET_FACILITATOR });
  const server = new x402ResourceServer(facilitator);
  registerExactSvmScheme(server, { networks: [network as never], rpcUrl: config.rpcUrl });

  const capAtomic =
    config.maxPerPayerPerDayUsd !== undefined ? BigInt(Math.round(config.maxPerPayerPerDayUsd * 1_000_000)) : undefined;

  const routeOf = (ctx: { transportContext?: unknown }): string => {
    const req = (ctx.transportContext as { request?: { method?: string; path?: string; routePattern?: string } } | undefined)
      ?.request;
    return req?.routePattern ?? `${req?.method ?? "GET"} ${req?.path ?? "unknown"}`;
  };

  // Owner-side spending cap: runs after the payment verifies, before the handler or settlement.
  server.onAfterVerify(async (ctx) => {
    const payer = ctx.result.payer;
    if (capAtomic === undefined || !payer) return;
    const spent = ledger.spentToday(payer);
    const price = BigInt(ctx.requirements.amount);
    if (spent + price > capAtomic) {
      ledger.recordRefusal({
        route: routeOf(ctx),
        payer,
        reason: `daily cap $${config.maxPerPayerPerDayUsd} reached (spent $${atomicToUsd(spent).toFixed(4)})`,
      });
      return { abort: true as const, reason: "daily_cap_reached", message: "This payer reached its daily spending cap on this API." };
    }
  });

  // Record revenue only after the money actually moved on-chain.
  server.onAfterSettle(async (ctx) => {
    if (!ctx.result.success) return;
    ledger.recordPayment({
      route: routeOf(ctx),
      payer: ctx.result.payer ?? "unknown",
      amountAtomic: ctx.result.amount ?? ctx.requirements.amount,
      network: String(ctx.result.network ?? ctx.requirements.network),
      tx: ctx.result.transaction ?? "",
    });
  });

  // Dashboard + stats API are mounted first so they are never paywalled.
  const guard = (req: Request, res: Response, next: NextFunction) =>
    tokenOk(req, config.dashboardToken) ? next() : void res.status(401).json({ error: "dashboard token required" });

  app.get(`${mount}/api/stats`, guard, (_req, res) => {
    res.json({
      ...ledger.stats(),
      config: {
        network,
        payTo: config.payTo,
        maxPerPayerPerDayUsd: config.maxPerPayerPerDayUsd ?? null,
        routes: Object.entries(config.routes).map(([key, r]) => ({ key, ...normalizeRoute(r) })),
      },
    });
  });
  app.get([mount, `${mount}/`], guard, (_req, res) => {
    res.sendFile(fileURLToPath(new URL("../public/index.html", import.meta.url)));
  });

  const routes = Object.fromEntries(
    Object.entries(config.routes).map(([key, raw]) => {
      const r = normalizeRoute(raw);
      return [
        key,
        {
          accepts: [{ scheme: "exact", price: r.price, network: network as never, payTo: config.payTo }],
          description: r.description,
          mimeType: r.mimeType ?? "application/json",
        },
      ];
    }),
  );

  app.use(paymentMiddleware(routes as never, server));
  return { ledger, network };
}
