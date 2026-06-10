/**
 * main.ts — the Aegis brain entrypoint.
 *
 * Wires `makeSender` (the ONLY money channel — POSTs intents to the Pi Signer)
 * into `runOnce` over a seeded subscription list. Reads the signer URL + Bearer
 * token from the environment. The brain holds NO key and never touches the
 * device key; it can only express {payee, amountMotes, seq}.
 *
 * Env:
 *   SIGNER_URL    (default http://127.0.0.1:8787)
 *   SIGNER_TOKEN  (REQUIRED — must match the running signer's token)
 *   PAYEE_HASH    (allowlisted demo payee; default = the deployed demo payee)
 *   PAY_AMOUNT_MOTES (default 1000000000 = 1 CSPR)
 */
import "dotenv/config";
import { makeSender } from "./client.js";
import { runOnce, type Subscription } from "./loop.js";

const SIGNER_URL = process.env.SIGNER_URL ?? "http://127.0.0.1:8787";
const PAYEE = process.env.PAYEE_HASH ??
  "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";
const AMOUNT = process.env.PAY_AMOUNT_MOTES ?? "1000000000"; // 1 CSPR

/**
 * Monotonic seq source seeded from epoch-ms (full, NOT modulo) so that re-runs
 * across process restarts always start ABOVE prior runs and never replay-collide
 * with seqs the signer already committed.
 */
export function makeSeqCounter(start = Date.now()): () => number {
  let n = start;
  return () => n++;
}

export async function runBrain(): Promise<void> {
  const token = process.env.SIGNER_TOKEN;
  if (!token) throw new Error("SIGNER_TOKEN is required (must match the running signer).");

  const send = makeSender(SIGNER_URL, token);
  const nextSeq = makeSeqCounter();

  // Seeded subscription list: a single due payment to the allowlisted payee.
  const subs: Subscription[] = [
    { name: "demo-subscription", payee: PAYEE, amountMotes: AMOUNT, dueAt: 0 },
  ];

  console.log(`[brain] signer=${SIGNER_URL} payee=${PAYEE} amount=${AMOUNT} motes`);
  const results = await runOnce({ now: Date.now(), subs, send, nextSeq });

  for (const r of results) {
    console.log(
      `[brain] ${r.subscription.name} seq=${r.intent.seq} -> status=${r.result.status}` +
        ` execStatus=${r.result.execStatus ?? "-"} success=${r.result.success ?? false}` +
        ` hash=${r.result.hash ?? "-"} reason=${r.result.reason ?? "-"}`,
    );
  }

  const ok = results.find((r) => r.result.status === 200 && r.result.success);
  if (ok) {
    console.log(`[brain] AUTONOMOUS PAY CONFIRMED ON-CHAIN. tx hash: ${ok.result.hash}`);
  } else {
    console.log(`[brain] no confirmed success this run.`);
  }
}

if (process.env.VITEST === undefined) {
  runBrain().catch((e) => {
    console.error(`[brain] fatal: ${e?.message ?? e}`);
    process.exit(1);
  });
}
