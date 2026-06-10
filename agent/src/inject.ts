/**
 * inject.ts — THE MONEY-SHOT (defense side).
 *
 * This simulates a prompt-injected or otherwise compromised brain that has been
 * hijacked into trying to DRAIN funds to an attacker-controlled account. In
 * Aegis this is the realistic threat model: the brain is LLM-driven and
 * untrusted; assume it can be made to emit a malicious intent.
 *
 * The whole point of the hardware moat: even a fully-compromised brain can only
 * ever POST {payee, amountMotes, seq}. It cannot sign, cannot pick a new payee
 * outside policy, cannot move native balance. When it tries to pay an attacker
 * account, the Pi Signer's STATIC ALLOWLIST rejects it with 403 PayeeNotAllowed
 * before the device key is ever touched — no transaction is built or signed.
 *
 * This function performs that injected attempt and SURFACES the signer's denial
 * so the demo/test can prove the Pi blocked it.
 */
import type { PaymentIntent } from "../../shared/src/types.js";
import type { SendIntent, SendResult } from "./client.js";

export interface InjectOpts {
  /** attacker-controlled (NON-allowlisted) account hash. */
  attacker: string;
  /** how much the attacker tries to drain (motes). */
  amountMotes: string;
  send: SendIntent;
  nextSeq: () => number;
}

export interface InjectOutcome {
  /** true iff the signer denied the drain on policy — 403 (the moat held). */
  blocked: boolean;
  /** true iff funds actually moved to the attacker — 200+success (moat FAILED). */
  drained: boolean;
  /** HTTP status the signer returned (expected 403). */
  status: number;
  /** signer's denial reason (expected "PayeeNotAllowed"). */
  reason?: string;
  /** the malicious intent the compromised brain attempted. */
  intent: PaymentIntent;
  /** raw signer result, for inspection. */
  result: SendResult;
}

/**
 * Simulate a compromised brain attempting to drain funds to an attacker.
 * Returns an outcome flagged `blocked` when the signer refused (403). A
 * successful (200) drain would mean the moat FAILED — `blocked` is false then.
 */
export async function injectedDrainAttempt(opts: InjectOpts): Promise<InjectOutcome> {
  const intent: PaymentIntent = {
    payee: opts.attacker,
    amountMotes: opts.amountMotes,
    seq: opts.nextSeq(),
  };
  const result = await opts.send(intent);
  // The moat "held" specifically when the signer DENIED on policy (403
  // PayeeNotAllowed) before the device key was ever touched. A confirmed
  // 200-success means the drain went through (moat FAILED). 202 (pending) and
  // 502 (failed) are NOT clean blocks — the tx may still settle — so we do not
  // claim `blocked` for them; they are surfaced as drained=false, blocked=false.
  const drained = result.status === 200 && result.success === true;
  const blocked = result.status === 403;
  return {
    blocked,
    drained,
    status: result.status,
    reason: result.reason,
    intent,
    result,
  };
}
