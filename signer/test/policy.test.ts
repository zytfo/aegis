import { describe, it, expect } from "vitest";
import { checkStatic } from "../src/policy.js";
import type { Policy, PaymentIntent } from "../../shared/src/types.js";

const PAYEE = "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";
const pol: Policy = { perTxMaxMotes: "5000000000", allowlist: [PAYEE] };

describe("checkStatic", () => {
  it("accepts allowlisted payee within cap", () => {
    const i: PaymentIntent = { payee: PAYEE, amountMotes: "1000000000", seq: 1 };
    expect(checkStatic(pol, i)).toEqual({ ok: true });
  });
  it("rejects non-allowlisted payee", () => {
    const i: PaymentIntent = { payee: "account-hash-deadbeef", amountMotes: "1", seq: 1 };
    expect(checkStatic(pol, i)).toEqual({ ok: false, reason: "PayeeNotAllowed" });
  });
  it("rejects over per-tx max", () => {
    const i: PaymentIntent = { payee: PAYEE, amountMotes: "5000000001", seq: 1 };
    expect(checkStatic(pol, i)).toEqual({ ok: false, reason: "OverPerTx" });
  });
  it("accepts exactly at the cap", () => {
    const i: PaymentIntent = { payee: PAYEE, amountMotes: "5000000000", seq: 1 };
    expect(checkStatic(pol, i)).toEqual({ ok: true });
  });
});
