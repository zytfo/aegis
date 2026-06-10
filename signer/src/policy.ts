import type { Policy, PaymentIntent } from "../../shared/src/types.js";

export interface PolicyResult { ok: boolean; reason?: string }

/**
 * Static (off-chain) policy. Enforces:
 *  - payee MUST be in the allowlist        -> "PayeeNotAllowed"
 *  - amount MUST be <= perTxMaxMotes        -> "OverPerTx"
 * period_cap is NOT checked here — it is enforced on-chain only.
 */
export function checkStatic(pol: Policy, i: PaymentIntent): PolicyResult {
  if (!pol.allowlist.includes(i.payee)) return { ok: false, reason: "PayeeNotAllowed" };
  if (BigInt(i.amountMotes) > BigInt(pol.perTxMaxMotes)) return { ok: false, reason: "OverPerTx" };
  return { ok: true };
}
