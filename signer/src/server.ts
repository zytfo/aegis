/**
 * server.ts — authenticated signer HTTP endpoint.
 *
 * Channel auth note: the Bearer token protects against THIRD PARTIES reaching
 * the endpoint. It does NOT protect against a compromised brain host — a brain
 * that holds the token can submit any policy-compliant intent. That is by design:
 * the hardware signer's real defense is the static policy + on-chain enforcement
 * (device-only pay, allowlist, per-tx & period caps), not the transport token.
 *
 * Seq lifecycle (two-phase, avoids burning a seq on a failed pay):
 *   1. After policy passes, reject if seq is not fresh OR already in-flight (409).
 *   2. Mark seq in-flight; call pay().
 *   3. On CONFIRMED success -> commit(seq) (persist) and return 200.
 *      On reverted/throw  -> do NOT commit; seq stays retryable -> 502.
 *      On "unknown" (pending/timeout) -> do NOT commit; return 202 with a
 *        distinct status so the brain does NOT reissue with a new seq (which
 *        would risk a double-pay if the original tx later lands).
 *   4. The seq is always removed from in-flight in a finally block.
 */
import crypto from "node:crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { validateIntent, type Policy, type PaymentIntent } from "../../shared/src/types.js";
import { checkStatic } from "./policy.js";
import { makeSeqStore } from "./seq.js";
import { makeAudit } from "./audit.js";
import type { WaitResult } from "./casper.js";

export interface PayFn {
  (payee: string, amountMotes: string): Promise<{ hash: string; status: WaitResult; success: boolean }>;
}

export interface MakeAppOpts {
  token: string;
  policy: Policy;
  seqPath: string;
  auditPath?: string;
  pay: PayFn;
}

/** Constant-time bearer-token comparison. Returns false on a missing/short header. */
function tokenOk(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; the length check itself is not secret.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function makeApp(opts: MakeAppOpts): Express {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  const seqStore = makeSeqStore(opts.seqPath);
  const audit = makeAudit(opts.auditPath ?? `${opts.seqPath}.audit.jsonl`);

  // Seqs currently being paid. Prevents a concurrent duplicate from racing in
  // before commit, and prevents a retry while a pay is still outstanding.
  const inFlight = new Set<number>();

  // Malformed JSON body -> 400 AND a denied audit entry (no gap in the trail).
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError || err.status === 400)) {
      audit.record({ event: "denied", reason: "BadJson" });
      return res.status(400).json({ reason: "BadJson" });
    }
    if (err && err.type === "entity.too.large") {
      audit.record({ event: "denied", reason: "BodyTooLarge" });
      return res.status(413).json({ reason: "BodyTooLarge" });
    }
    return next(err);
  });

  app.post("/sign-intent", async (req: Request, res: Response) => {
    // 1. auth (constant-time)
    if (!tokenOk(req.header("authorization"), opts.token)) {
      return res.status(401).json({ reason: "unauthorized" });
    }

    // 2. validate shape
    const intent = req.body as Partial<PaymentIntent>;
    const v = validateIntent(intent);
    if (!v.ok) return res.status(400).json({ reason: v.reason });
    const i = intent as PaymentIntent;

    // 3. static policy
    const p = checkStatic(opts.policy, i);
    if (!p.ok) {
      audit.record({ event: "denied", payee: i.payee, amountMotes: i.amountMotes, seq: i.seq, reason: p.reason });
      return res.status(403).json({ reason: p.reason });
    }

    // 4. replay protection (check-only; seq is committed ONLY on confirmed success)
    if (!seqStore.isFresh(i.seq) || inFlight.has(i.seq)) {
      audit.record({ event: "denied", payee: i.payee, amountMotes: i.amountMotes, seq: i.seq, reason: "ReplaySeq" });
      return res.status(409).json({ reason: "ReplaySeq" });
    }

    // 5. sign + submit (two-phase: commit only after confirmed success)
    inFlight.add(i.seq);
    try {
      const { hash, status, success } = await opts.pay(i.payee, i.amountMotes);
      if (status === "success" && success) {
        seqStore.commit(i.seq);
        audit.record({ event: "approved", payee: i.payee, amountMotes: i.amountMotes, seq: i.seq, hash, success: true });
        return res.status(200).json({ hash, status, success: true });
      }
      if (status === "unknown") {
        // Pending/timeout: tx MAY still land. Do NOT commit; do NOT invite a
        // fresh-seq reissue. Distinct 202 so the brain can poll/await, not re-pay.
        audit.record({ event: "denied", payee: i.payee, amountMotes: i.amountMotes, seq: i.seq, hash, success: false, reason: "Pending" });
        return res.status(202).json({ hash, status: "unknown", success: false, reason: "Pending" });
      }
      // reverted (or success:false): no funds moved; seq stays retryable.
      audit.record({ event: "denied", payee: i.payee, amountMotes: i.amountMotes, seq: i.seq, hash, success: false, reason: "Reverted" });
      return res.status(502).json({ hash, status, success: false, reason: "Reverted" });
    } catch (e: any) {
      // Submission/network error: seq NOT committed -> retryable. Keep detail
      // server-side only; return a generic message to the client.
      audit.record({ event: "denied", payee: i.payee, amountMotes: i.amountMotes, seq: i.seq, reason: `PayError: ${e?.message ?? e}` });
      return res.status(502).json({ reason: "pay failed" });
    } finally {
      inFlight.delete(i.seq);
    }
  });

  app.get("/audit", (_req: Request, res: Response) => {
    res.status(200).json(audit.readAll());
  });

  return app;
}
