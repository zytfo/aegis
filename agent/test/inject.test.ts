import { describe, it, expect, vi } from "vitest";
import { injectedDrainAttempt } from "../src/inject.js";
import type { SendIntent } from "../src/client.js";

const ATTACKER = "account-hash-attacker000000000000000000000000000000000000000000000000";

describe("injectedDrainAttempt (THE MONEY-SHOT)", () => {
  it("attacker payee -> signer 403 PayeeNotAllowed -> surfaced as BLOCKED", async () => {
    // The signer rejects the off-policy payee statically, BEFORE touching the key.
    const send: SendIntent = vi.fn(async (intent) => {
      // prove the brain could only emit {payee, amountMotes, seq}
      expect(Object.keys(intent).sort()).toEqual(["amountMotes", "payee", "seq"]);
      return { status: 403, reason: "PayeeNotAllowed" };
    });

    const outcome = await injectedDrainAttempt({
      attacker: ATTACKER,
      amountMotes: "5000000000",
      send,
      nextSeq: () => 1,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.blocked).toBe(true);
    expect(outcome.status).toBe(403);
    expect(outcome.reason).toBe("PayeeNotAllowed");
    expect(outcome.intent.payee).toBe(ATTACKER);
  });

  it("a (hypothetical) 200 success would be flagged NOT blocked (moat failure)", async () => {
    const send: SendIntent = vi.fn(async () => ({ status: 200, success: true, hash: "drained" }));
    const outcome = await injectedDrainAttempt({
      attacker: ATTACKER,
      amountMotes: "5000000000",
      send,
      nextSeq: () => 2,
    });
    expect(outcome.blocked).toBe(false);
  });
});
