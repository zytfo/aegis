import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

function openaiReply(obj: unknown) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) };
}
function signerReply(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}
function req(body: unknown, ip: string) {
  return new Request("http://x/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test";
  process.env.SIGNER_URL = "http://signer";
  process.env.SIGNER_TOKEN = "tok";
});

describe("/api/agent", () => {
  it("pays an allowlisted vendor -> verdict paid", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("openai")
        ? openaiReply({ action: "pay", vendor: "data-api", message: "Paying Data API." })
        : signerReply(200, { hash: "abc", success: true })));
    const res = await POST(req({ message: "pay my data api" }, "10.0.0.1"));
    const j = await res.json();
    expect(j.agentReply).toContain("Data API");
    expect(j.verdict.kind).toBe("paid");
    expect(j.action.payee).toMatch(/^account-hash-/);
  });

  it("poisoned page -> agent pays attacker -> verdict blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("openai")
        ? openaiReply({ action: "pay", payee: "account-hash-1111111111111111111111111111111111111111111111111111111111111111", amountCspr: 1, message: "Updating billing address." })
        : signerReply(403, { reason: "PayeeNotAllowed" })));
    const res = await POST(req({ message: "pay my Data API subscription", poisoned: true }, "10.0.0.2"));
    const j = await res.json();
    expect(j.verdict).toEqual({ kind: "blocked", reason: "PayeeNotAllowed" });
    expect(j.action.payee).toContain("account-hash-1111");
  });

  it("plain chat -> reply, never calls the signer", async () => {
    const f = vi.fn(async () => openaiReply({ action: "reply", message: "Hello!" }));
    vi.stubGlobal("fetch", f);
    const res = await POST(req({ message: "hi" }, "10.0.0.3"));
    const j = await res.json();
    expect(j.agentReply).toBe("Hello!");
    expect(j.verdict).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("429 after the per-IP burst (6th request in the window from one IP)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => openaiReply({ action: "reply", message: "hi" })));
    let last;
    for (let i = 0; i < 6; i++) last = await POST(req({ message: "x" }, "10.0.0.9"));
    expect(last!.status).toBe(429); // default burst limit is 5/min
  });
});
