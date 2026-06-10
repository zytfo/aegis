import { describe, it, expect, vi } from "vitest";
import { payAndFetch, type FetchLike, type X402Deps } from "../src/x402.js";

const REQS = {
  scheme: "exact",
  network: "casper-test",
  asset: "cep18-test-token",
  payTo: "account-hash-merchant",
  maxAmountRequired: "1000",
};

describe("payAndFetch (x402 SECONDARY, mocked flow)", () => {
  it("on 402: reads requirements, signs via Pi dep, retries with X-PAYMENT, returns 200", async () => {
    let call = 0;
    const seen: any[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      call++;
      seen.push(init);
      if (call === 1) {
        return { status: 402, json: async () => ({ accepts: [REQS] }), text: async (): Promise<string> => "" };
      }
      return { status: 200, json: async () => ({ data: "secret resource" }), text: async (): Promise<string> => "" };
    });

    const signAuthorization = vi.fn(async (req) => {
      expect(req.asset).toBe("cep18-test-token");
      return { xPayment: "base64-pi-signed-auth" };
    });

    const deps: X402Deps = { fetchImpl, signAuthorization };
    const res = await payAndFetch("https://api/paid-thing", deps);

    expect(call).toBe(2);
    expect(signAuthorization).toHaveBeenCalledTimes(1);
    expect(seen[1].headers["X-PAYMENT"]).toBe("base64-pi-signed-auth");
    expect(res.paid).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "secret resource" });
  });

  it("non-402 first response: returns unchanged, no payment, no signing", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      status: 200,
      json: async () => ({ data: "free" }),
      text: async (): Promise<string> => "",
    }));
    const signAuthorization = vi.fn(async () => ({ xPayment: "should-not-be-called" }));
    const res = await payAndFetch("https://api/free", { fetchImpl, signAuthorization });
    expect(res.paid).toBe(false);
    expect(res.status).toBe(200);
    expect(signAuthorization).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
