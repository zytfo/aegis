/**
 * loop.ts — the autonomous scheduler core.
 *
 * `runOnce` is pure-ish: given the current time, a subscription list, a `send`
 * function (the Pi-Signer client), and a seq source, it pays every DUE
 * subscription (dueAt <= now) with a freshly-incrementing seq, and skips the
 * rest. It returns a per-subscription result array so callers/tests can assert.
 *
 * Note the brain only ever produces {payee, amountMotes, seq}. The actual
 * signing, policy enforcement and chain submission happen behind `send` (the
 * Pi Signer). The brain is untrusted by design.
 */
import type { PaymentIntent } from "../../shared/src/types.js";
import type { SendIntent, SendResult } from "./client.js";

export interface Subscription {
  /** human label for logging/audit. */
  name: string;
  /** allowlisted payee account hash. */
  payee: string;
  /** amount in motes (decimal string). */
  amountMotes: string;
  /** epoch ms at/after which this subscription is due. */
  dueAt: number;
}

export interface RunResult {
  subscription: Subscription;
  intent: PaymentIntent;
  result: SendResult;
}

export interface RunOnceOpts {
  /** current time (epoch ms). */
  now: number;
  subs: Subscription[];
  send: SendIntent;
  /** monotonic seq source; called once per due subscription. */
  nextSeq: () => number;
}

/**
 * Pay every due subscription once, in order, with an incrementing seq.
 * Not-due subscriptions (dueAt > now) are skipped entirely (never sent).
 */
export async function runOnce(opts: RunOnceOpts): Promise<RunResult[]> {
  const { now, subs, send, nextSeq } = opts;
  const out: RunResult[] = [];
  for (const sub of subs) {
    if (sub.dueAt > now) continue; // not due — skip
    const intent: PaymentIntent = {
      payee: sub.payee,
      amountMotes: sub.amountMotes,
      seq: nextSeq(),
    };
    const result = await send(intent);
    out.push({ subscription: sub, intent, result });
  }
  return out;
}
