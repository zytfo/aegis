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

// Read the full NDJSON stream body into an array of parsed line objects.
async function readNdjson(res: Response): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const out: Record<string, unknown>[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  buf += decoder.decode();
  for (const line of buf.split("\n")) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t));
  }
  return out;
}
function finalResult(lines: Record<string, unknown>[]) {
  return lines.filter((l) => l.type === "result").at(-1)!;
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
    const lines = await readNdjson(res);
    expect(lines.some((l) => l.type === "log")).toBe(true);
    const r = finalResult(lines) as { agentReply: string; verdict: { kind: string }; action: { payee: string } };
    expect(r.agentReply).toContain("Data API");
    expect(r.verdict.kind).toBe("paid");
    expect(r.action.payee).toMatch(/^account-hash-/);
    // Paid verdict narrates an on-chain broadcast, not a generic "responded".
    const logText = lines.filter((l) => l.type === "log").map((l) => l.text).join("\n");
    expect(logText).toMatch(/broadcast.*on-chain/i);
  });

  it("poisoned page -> agent pays attacker -> verdict blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("openai")
        ? openaiReply({ action: "pay", payee: "account-hash-1111111111111111111111111111111111111111111111111111111111111111", amountCspr: 1, message: "Updating billing address." })
        : signerReply(403, { reason: "PayeeNotAllowed" })));
    const res = await POST(req({ message: "pay my Data API subscription", poisoned: true }, "10.0.0.2"));
    const lines = await readNdjson(res);
    expect(lines.some((l) => l.type === "log")).toBe(true);
    expect(lines.some((l) => l.type === "page")).toBe(true);
    const r = finalResult(lines) as { verdict: unknown; action: { payee: string } };
    expect(r.verdict).toEqual({ kind: "blocked", reason: "PayeeNotAllowed" });
    expect(r.action.payee).toContain("account-hash-1111");
    // The chat must explain the attack: a non-vendor address from the untrusted page,
    // and a REFUSED-to-sign outcome (the security win), not an ambiguous "responded".
    const logText = lines.filter((l) => l.type === "log").map((l) => l.text).join("\n");
    expect(logText).toMatch(/NOT one of your saved vendors/i);
    expect(logText).toMatch(/untrusted page/i);
    expect(logText).toMatch(/REFUSED to sign/i);
  });

  it("plain chat -> reply, never calls the signer", async () => {
    const f = vi.fn(async () => openaiReply({ action: "reply", message: "Hello!" }));
    vi.stubGlobal("fetch", f);
    const res = await POST(req({ message: "hi" }, "10.0.0.3"));
    const lines = await readNdjson(res);
    expect(lines.some((l) => l.type === "log")).toBe(true);
    const r = finalResult(lines) as { agentReply: string; verdict?: unknown };
    expect(r.agentReply).toBe("Hello!");
    expect(r.verdict).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1); // signer never called
  });

  it("429 after the per-IP burst (6th request in the window from one IP)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => openaiReply({ action: "reply", message: "hi" })));
    let last;
    for (let i = 0; i < 6; i++) last = await POST(req({ message: "x" }, "10.0.0.9"));
    expect(last!.status).toBe(429); // default burst limit is 5/min; still a non-stream JSON
    const j = await last!.json();
    expect(j.error).toBeTruthy();
  });
});
