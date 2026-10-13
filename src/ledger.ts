import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface PaymentRecord {
  id: number;
  at: string; // ISO timestamp
  route: string; // e.g. "GET /api/research"
  payer: string;
  amountAtomic: string; // USDC atomic units (6 decimals)
  network: string;
  tx: string;
}

export interface RefusalRecord {
  at: string;
  route: string;
  payer: string;
  reason: string;
}

export interface LedgerSnapshot {
  payments: PaymentRecord[];
  refusals: RefusalRecord[];
}

const USDC_DECIMALS = 6;
const MAX_KEPT = 5000;

export const atomicToUsd = (atomic: string | bigint): number =>
  Number(typeof atomic === "bigint" ? atomic : BigInt(atomic)) / 10 ** USDC_DECIMALS;

/** Append-only payment ledger with optional JSON-file persistence. */
export class Ledger {
  private payments: PaymentRecord[] = [];
  private refusals: RefusalRecord[] = [];
  private nextId = 1;

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const snap = JSON.parse(readFileSync(file, "utf8")) as LedgerSnapshot;
        this.payments = snap.payments ?? [];
        this.refusals = snap.refusals ?? [];
        this.nextId = (this.payments.at(-1)?.id ?? 0) + 1;
      } catch {
        // Corrupt file: start clean rather than crash the paywall.
      }
    }
  }

  recordPayment(p: Omit<PaymentRecord, "id" | "at">): PaymentRecord {
    // A settlement hook can fire twice for the same tx; never double-count revenue.
    const dupe = this.payments.find((x) => x.tx === p.tx && p.tx !== "");
    if (dupe) return dupe;
    const rec: PaymentRecord = { id: this.nextId++, at: new Date().toISOString(), ...p };
    this.payments.push(rec);
    if (this.payments.length > MAX_KEPT) this.payments.shift();
    this.persist();
    return rec;
  }

  recordRefusal(r: Omit<RefusalRecord, "at">): void {
    this.refusals.push({ at: new Date().toISOString(), ...r });
    if (this.refusals.length > MAX_KEPT) this.refusals.shift();
    this.persist();
  }

  /** USDC (atomic) a payer has paid since the given UTC day start. */
  spentToday(payer: string, now = new Date()): bigint {
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    let total = 0n;
    for (const p of this.payments) {
      if (p.payer === payer && Date.parse(p.at) >= dayStart) total += BigInt(p.amountAtomic);
    }
    return total;
  }

  stats() {
    const byRoute = new Map<string, { calls: number; atomic: bigint }>();
    const byPayer = new Map<string, { calls: number; atomic: bigint; last: string }>();
    let total = 0n;
    for (const p of this.payments) {
      const amt = BigInt(p.amountAtomic);
      total += amt;
      const r = byRoute.get(p.route) ?? { calls: 0, atomic: 0n };
      r.calls++;
      r.atomic += amt;
      byRoute.set(p.route, r);
      const a = byPayer.get(p.payer) ?? { calls: 0, atomic: 0n, last: p.at };
      a.calls++;
      a.atomic += amt;
      a.last = p.at;
      byPayer.set(p.payer, a);
    }
    return {
      totalUsd: atomicToUsd(total),
      paidCalls: this.payments.length,
      refusedCalls: this.refusals.length,
      routes: [...byRoute].map(([route, v]) => ({ route, calls: v.calls, usd: atomicToUsd(v.atomic) })),
      payers: [...byPayer].map(([payer, v]) => ({
        payer,
        calls: v.calls,
        usd: atomicToUsd(v.atomic),
        usdToday: atomicToUsd(this.spentToday(payer)),
        last: v.last,
      })),
      recent: this.payments.slice(-25).reverse().map((p) => ({ ...p, usd: atomicToUsd(p.amountAtomic) })),
      recentRefusals: this.refusals.slice(-10).reverse(),
    };
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ payments: this.payments, refusals: this.refusals }));
      renameSync(tmp, this.file); // atomic swap so a crash never leaves a half-written file
    } catch {
      // Persistence is best-effort; the in-memory ledger stays authoritative.
    }
  }
}
