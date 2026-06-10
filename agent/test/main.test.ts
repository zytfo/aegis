import { describe, it, expect } from "vitest";
import { makeSeqCounter } from "../src/main.js";

describe("makeSeqCounter", () => {
  it("returns a monotonically increasing seq", () => {
    const next = makeSeqCounter(100);
    expect(next()).toBe(100);
    expect(next()).toBe(101);
    expect(next()).toBe(102);
  });

  it("default start is derived from time and is a non-negative integer", () => {
    const next = makeSeqCounter();
    const a = next();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(next()).toBe(a + 1);
  });
});
