import { describe, it, expect, vi } from "vitest";
import { signPayDirectly, nativeTransfer, resolveKeyPem } from "../src/software_signer.js";
import { PrivateKey, KeyAlgorithm } from "../src/sdk.js";

// A throwaway, UNFUNDED key generated in-test. The whole point of the contrast
// is that a software signer holds plaintext key material — but unit tests must
// NOT require a funded key, so we mock submit and never hit the network.
const PEM = PrivateKey.generate(KeyAlgorithm.ED25519).toPem();
const PAYEE = "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";

describe("software_signer (THE ANTI-PATTERN CONTRAST)", () => {
  it("signPayDirectly builds, signs with the held key, and submits a pay", async () => {
    const submit = vi.fn(async (tx) => {
      // proves the agent signed locally with no Pi involvement
      expect(tx.approvals.length).toBe(1);
      return "deadbeefpayhash";
    });
    const res = await signPayDirectly(PEM, { payee: PAYEE, amountMotes: "1000000000" }, submit);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.hash).toBe("deadbeefpayhash");
  });

  it("nativeTransfer (the catastrophe): signs a DIRECT native CSPR transfer of the balance", async () => {
    const submit = vi.fn(async (tx) => {
      expect(tx.approvals.length).toBe(1); // signed entirely off the local key
      return "deadbeeftransferhash";
    });
    const res = await nativeTransfer(PEM, { to: PAYEE, amountMotes: "2500000000000" }, submit);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res.hash).toBe("deadbeeftransferhash");
  });

  it("resolveKeyPem reads key from process.env (demonstrating the leak surface)", () => {
    process.env.__TEST_NAIVE_KEY = PEM;
    expect(resolveKeyPem({ envVar: "__TEST_NAIVE_KEY" })).toBe(PEM);
    delete process.env.__TEST_NAIVE_KEY;
  });

  it("resolveKeyPem throws when no key material is provided", () => {
    expect(() => resolveKeyPem({})).toThrow(/no key material/);
  });
});
