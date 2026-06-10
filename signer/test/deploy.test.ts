import { describe, it, expect, afterEach } from "vitest";
import { resolveGasMotes } from "../src/deploy.js";

const original = process.env.PAY_GAS_MOTES;
afterEach(() => {
  if (original === undefined) delete process.env.PAY_GAS_MOTES;
  else process.env.PAY_GAS_MOTES = original;
});

describe("resolveGasMotes (#8 gas validation)", () => {
  it("uses the override when provided", () => {
    expect(resolveGasMotes(7_000_000_000)).toBe(7_000_000_000);
  });

  it("reads a valid positive integer from env", () => {
    process.env.PAY_GAS_MOTES = "5000000000";
    expect(resolveGasMotes()).toBe(5_000_000_000);
  });

  it("falls back to the default when env is unset", () => {
    delete process.env.PAY_GAS_MOTES;
    expect(resolveGasMotes()).toBe(5_000_000_000);
  });

  it("throws on NaN / non-numeric env", () => {
    process.env.PAY_GAS_MOTES = "abc";
    expect(() => resolveGasMotes()).toThrow(/invalid gas/);
  });

  it("throws on zero / negative", () => {
    process.env.PAY_GAS_MOTES = "0";
    expect(() => resolveGasMotes()).toThrow(/invalid gas/);
    process.env.PAY_GAS_MOTES = "-5";
    expect(() => resolveGasMotes()).toThrow(/invalid gas/);
  });

  it("throws on a non-integer override", () => {
    expect(() => resolveGasMotes(1.5)).toThrow(/invalid gas/);
  });
});
