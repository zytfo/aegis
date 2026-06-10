import { describe, it, expect } from "vitest";
import { parseDecision, csprToMotes, resolvePayment, buildMessages, mapSignerResponse, VENDORS } from "./agent";

describe("parseDecision", () => {
  it("parses a valid pay decision", () => {
    const d = parseDecision('{"action":"pay","vendor":"data-api","payee":null,"amountCspr":null,"message":"Paying Data API."}');
    expect(d.action).toBe("pay"); expect(d.vendor).toBe("data-api"); expect(d.message).toBe("Paying Data API.");
  });
  it("defaults to reply on garbage", () => { expect(parseDecision("not json").action).toBe("reply"); });
  it("coerces unknown action to reply", () => { expect(parseDecision('{"action":"frobnicate","message":"hi"}').action).toBe("reply"); });
});

describe("csprToMotes", () => {
  it("whole CSPR", () => { expect(csprToMotes(1)).toBe("1000000000"); });
  it("two CSPR", () => { expect(csprToMotes(2)).toBe("2000000000"); });
});

describe("resolvePayment", () => {
  it("vendor data-api -> PAYEE_HASH, 1 CSPR", () => {
    expect(resolvePayment({ action: "pay", vendor: "data-api", payee: null, amountCspr: null, message: "" }))
      .toEqual({ payee: VENDORS["data-api"].payee, amountMotes: "1000000000" });
  });
  it("vendor cloud-storage -> a DISTINCT payee, 2 CSPR", () => {
    const r = resolvePayment({ action: "pay", vendor: "cloud-storage", payee: null, amountCspr: null, message: "" });
    expect(r).toEqual({ payee: VENDORS["cloud-storage"].payee, amountMotes: "2000000000" });
  });
  it("free-form account-hash + amount", () => {
    const h = "account-hash-1111111111111111111111111111111111111111111111111111111111111111";
    expect(resolvePayment({ action: "pay", vendor: null, payee: h, amountCspr: 5, message: "" }))
      .toEqual({ payee: h, amountMotes: "5000000000" });
  });
  it("null for reply", () => { expect(resolvePayment({ action: "reply", vendor: null, payee: null, amountCspr: null, message: "hi" })).toBeNull(); });
  it("null for malformed payee", () => { expect(resolvePayment({ action: "pay", vendor: null, payee: "nope", amountCspr: 5, message: "" })).toBeNull(); });
  it("null for non-finite / non-positive amount", () => {
    const h = "account-hash-1111111111111111111111111111111111111111111111111111111111111111";
    expect(resolvePayment({ action: "pay", vendor: null, payee: h, amountCspr: 0, message: "" })).toBeNull();
    expect(resolvePayment({ action: "pay", vendor: null, payee: h, amountCspr: Number.NaN, message: "" })).toBeNull();
  });
  it("explicit payee WINS over vendor (injected address-swap is honored as free-form)", () => {
    const h = "account-hash-1111111111111111111111111111111111111111111111111111111111111111";
    expect(resolvePayment({ action: "pay", vendor: "data-api", payee: h, amountCspr: 1, message: "" }))
      .toEqual({ payee: h, amountMotes: "1000000000" });
  });
  it("null for an over-cap / overflow amount (no BigInt(Infinity) crash)", () => {
    const h = "account-hash-1111111111111111111111111111111111111111111111111111111111111111";
    expect(resolvePayment({ action: "pay", vendor: null, payee: h, amountCspr: 1e300, message: "" })).toBeNull();
    expect(resolvePayment({ action: "pay", vendor: null, payee: h, amountCspr: 2_000_000, message: "" })).toBeNull();
  });
});

describe("buildMessages", () => {
  it("system + user when not poisoned", () => { expect(buildMessages("hi", false)).toHaveLength(2); });
  it("inserts the poisoned billing-notice (with attacker hash) when poisoned", () => {
    const m = buildMessages("pay my Data API subscription", true);
    expect(m).toHaveLength(3);
    expect(JSON.stringify(m)).toContain("account-hash-1111");
  });
});

describe("mapSignerResponse", () => {
  it("paid on 200 success", () => { expect(mapSignerResponse(200, { hash: "h", success: true }).kind).toBe("paid"); });
  it("blocked on 403", () => { expect(mapSignerResponse(403, { reason: "PayeeNotAllowed" })).toEqual({ kind: "blocked", reason: "PayeeNotAllowed" }); });
  it("unreachable on 5xx", () => { expect(mapSignerResponse(502, {}).kind).toBe("unreachable"); });
  it("pending on 202", () => { expect(mapSignerResponse(202, { hash: "h" }).kind).toBe("pending"); });
});
