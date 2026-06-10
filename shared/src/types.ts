export interface PaymentIntent { payee: string; amountMotes: string; seq: number; }
export interface Policy { perTxMaxMotes: string; allowlist: string[]; }
export function validateIntent(i: Partial<PaymentIntent>): { ok: boolean; reason?: string } {
  if (!i.payee) return { ok: false, reason: "missing payee" };
  if (typeof i.seq !== "number" || !Number.isInteger(i.seq) || i.seq < 0) return { ok: false, reason: "bad seq" };
  if (!i.amountMotes || !/^\d+$/.test(i.amountMotes) || i.amountMotes === "0") return { ok: false, reason: "bad amount" };
  return { ok: true };
}
