import { describe, it, expect } from "vitest";
import { requireSecret } from "../src/main.js";

const tokens = new Set(["dev-token-change-me", "change-me-to-a-long-random-string", "change-me"]);

describe("requireSecret (#4 fail-closed on dev defaults)", () => {
  it("throws when unset", () => {
    expect(() => requireSecret("SIGNER_TOKEN", undefined, tokens)).toThrow(/SIGNER_TOKEN/);
  });

  it("throws on an empty / whitespace value", () => {
    expect(() => requireSecret("SIGNER_TOKEN", "", tokens)).toThrow();
    expect(() => requireSecret("SIGNER_TOKEN", "   ", tokens)).toThrow();
  });

  it("throws on a known dev-default value", () => {
    expect(() => requireSecret("SIGNER_TOKEN", "dev-token-change-me", tokens)).toThrow();
    expect(() => requireSecret("SIGNER_TOKEN", "change-me", tokens)).toThrow();
  });

  it("returns a strong unique value", () => {
    expect(requireSecret("SIGNER_TOKEN", "a-real-long-random-secret", tokens)).toBe("a-real-long-random-secret");
  });
});
