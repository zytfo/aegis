import { describe, it, expect, vi } from "vitest";
import { makeSender, type FetchLike } from "../src/client.js";

const PAYEE = "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";

function mockFetch(status: number, body: any): { fetch: FetchLike; calls: any[] } {
  const calls: any[] = [];
  const fetch: FetchLike = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  });
  return { fetch, calls };
}

describe("makeSender", () => {
  it("POSTs to /sign-intent with Bearer auth and JSON body", async () => {
    const { fetch, calls } = mockFetch(200, { hash: "abc", status: "success", success: true });
    const send = makeSender("http://signer:8787", "secret-token", fetch);
    const res = await send({ payee: PAYEE, amountMotes: "1000000000", seq: 7 });

    expect(calls[0].url).toBe("http://signer:8787/sign-intent");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.authorization).toBe("Bearer secret-token");
    expect(JSON.parse(calls[0].init.body)).toEqual({ payee: PAYEE, amountMotes: "1000000000", seq: 7 });

    expect(res).toEqual({ status: 200, hash: "abc", execStatus: "success", success: true, reason: undefined });
  });

  it("strips trailing slash from baseUrl", async () => {
    const { fetch, calls } = mockFetch(200, {});
    const send = makeSender("http://signer:8787/", "t", fetch);
    await send({ payee: PAYEE, amountMotes: "1", seq: 0 });
    expect(calls[0].url).toBe("http://signer:8787/sign-intent");
  });

  it("surfaces non-2xx status without throwing (403)", async () => {
    const { fetch } = mockFetch(403, { reason: "PayeeNotAllowed" });
    const send = makeSender("http://signer:8787", "t", fetch);
    const res = await send({ payee: "account-hash-evil", amountMotes: "1", seq: 1 });
    expect(res.status).toBe(403);
    expect(res.reason).toBe("PayeeNotAllowed");
    expect(res.success).toBeUndefined();
  });
});
