import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { toClientSvmSigner } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

export interface AgentBudget {
  /** Max USD for any single request. */
  perRequestUsd: number;
  /** Max USD this agent may spend in total during this process lifetime. */
  totalUsd: number;
}

export interface AgentConfig {
  /** Base58-encoded 64-byte Solana secret key (as exported by Phantom / solana-keygen). */
  secretKey: string;
  budget: AgentBudget;
  /** Called after every successful payment. */
  onPayment?: (info: { url?: string; usd: number; totalUsd: number }) => void;
}

export interface TollgateAgent {
  fetch: typeof fetch;
  address: string;
  spentUsd(): number;
  remainingUsd(): number;
}

/**
 * A fetch() that pays x402 paywalls automatically in USDC on Solana,
 * and refuses to pay past the budget you set.
 */
export async function createAgent(config: AgentConfig): Promise<TollgateAgent> {
  const keyBytes = base58.decode(config.secretKey);
  const kp = await createKeyPairSignerFromBytes(keyBytes);
  const signer = toClientSvmSigner(kp);

  const client = new x402Client();
  registerExactSvmScheme(client, { signer });

  let spent = 0;
  // Spend control at the library level: hard per-request cap on recognized stablecoins.
  client.setSpendControls({ maxAmountPerPayment: `$${config.budget.perRequestUsd}` });

  // Total-budget guard: refuse to even sign a payment that would exceed the budget.
  client.onBeforePaymentCreation(async (ctx) => {
    const usd = Number(ctx.selectedRequirements.amount) / 1_000_000;
    if (spent + usd > config.budget.totalUsd) {
      return { abort: true as const, reason: `budget exhausted: $${spent.toFixed(4)} spent of $${config.budget.totalUsd}` };
    }
  });
  client.onAfterPaymentCreation(async (ctx) => {
    const usd = Number(ctx.selectedRequirements.amount) / 1_000_000;
    spent += usd;
    config.onPayment?.({ url: ctx.paymentRequired.resource?.url, usd, totalUsd: spent });
  });

  return {
    fetch: wrapFetchWithPayment(fetch, client) as typeof fetch,
    address: kp.address,
    spentUsd: () => spent,
    remainingUsd: () => Math.max(0, config.budget.totalUsd - spent),
  };
}
