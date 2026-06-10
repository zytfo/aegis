import { describe, it, expect, vi } from "vitest";
import { runOnce, type Subscription } from "../src/loop.js";
import type { SendIntent } from "../src/client.js";

const A = "account-hash-aaa";
const B = "account-hash-bbb";
const C = "account-hash-ccc";

function seqFrom(start: number): () => number {
  let n = start;
  return () => n++;
}

describe("runOnce", () => {
  it("pays each DUE subscription with an incrementing seq", async () => {
    const send: SendIntent = vi.fn(async () => ({ status: 200, success: true, hash: "h" }));
    const subs: Subscription[] = [
      { name: "a", payee: A, amountMotes: "100", dueAt: 0 },
      { name: "b", payee: B, amountMotes: "200", dueAt: 500 },
    ];
    const results = await runOnce({ now: 1000, subs, send, nextSeq: seqFrom(10) });

    expect(send).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.intent)).toEqual([
      { payee: A, amountMotes: "100", seq: 10 },
      { payee: B, amountMotes: "200", seq: 11 },
    ]);
  });

  it("skips NOT-due subscriptions entirely (never sent, no seq burned)", async () => {
    const send: SendIntent = vi.fn(async () => ({ status: 200, success: true }));
    const subs: Subscription[] = [
      { name: "due", payee: A, amountMotes: "100", dueAt: 0 },
      { name: "future", payee: B, amountMotes: "200", dueAt: 9999 },
      { name: "due2", payee: C, amountMotes: "300", dueAt: 1000 },
    ];
    const results = await runOnce({ now: 1000, subs, send, nextSeq: seqFrom(0) });

    expect(send).toHaveBeenCalledTimes(2);
    // only the two due subs, with seqs 0 and 1 (the future one consumed no seq)
    expect(results.map((r) => r.subscription.name)).toEqual(["due", "due2"]);
    expect(results.map((r) => r.intent.seq)).toEqual([0, 1]);
  });

  it("returns the signer result per subscription", async () => {
    const send: SendIntent = vi.fn(async (i) => ({ status: 200, success: true, hash: `hash-${i.seq}` }));
    const subs: Subscription[] = [{ name: "a", payee: A, amountMotes: "100", dueAt: 0 }];
    const results = await runOnce({ now: 1, subs, send, nextSeq: seqFrom(5) });
    expect(results[0].result.hash).toBe("hash-5");
  });
});
