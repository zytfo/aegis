import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApp, type PayFn } from "../src/server.js";
import type { Policy } from "../../shared/src/types.js";

const PAYEE = "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";
const TOKEN = "secret-token";
const policy: Policy = { perTxMaxMotes: "5000000000", allowlist: [PAYEE] };

const okPay = (): PayFn => vi.fn(async () => ({ hash: "abc123", status: "success" as const, success: true }));

let dirs: string[] = [];
function paths() {
  const d = mkdtempSync(join(tmpdir(), "srv-"));
  dirs.push(d);
  return { seqPath: join(d, "seq.txt"), auditPath: join(d, "audit.jsonl") };
}
afterEach(() => { dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });

function app(pay: PayFn = okPay()) {
  const { seqPath, auditPath } = paths();
  return { app: makeApp({ token: TOKEN, policy, seqPath, auditPath, pay }), pay };
}

const good = { payee: PAYEE, amountMotes: "1000000000", seq: 1 };
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${TOKEN}`);

describe("POST /sign-intent", () => {
  it("401 without correct bearer token", async () => {
    const { app: a } = app();
    await request(a).post("/sign-intent").send(good).expect(401);
    await request(a).post("/sign-intent").set("Authorization", "Bearer wrong").send(good).expect(401);
  });

  it("400 on invalid intent", async () => {
    const { app: a } = app();
    const r = await auth(request(a).post("/sign-intent")).send({ payee: PAYEE, amountMotes: "0", seq: 1 }).expect(400);
    expect(r.body.reason).toBe("bad amount");
  });

  it("403 with reason when policy denies (non-allowlisted)", async () => {
    const { app: a, pay } = app();
    const r = await auth(request(a).post("/sign-intent"))
      .send({ payee: "account-hash-deadbeef", amountMotes: "1", seq: 1 }).expect(403);
    expect(r.body.reason).toBe("PayeeNotAllowed");
    expect(pay).not.toHaveBeenCalled();
  });

  it("403 OverPerTx", async () => {
    const { app: a } = app();
    const r = await auth(request(a).post("/sign-intent"))
      .send({ payee: PAYEE, amountMotes: "6000000000", seq: 1 }).expect(403);
    expect(r.body.reason).toBe("OverPerTx");
  });

  it("200 on success then 409 replay", async () => {
    const { app: a, pay } = app();
    const ok = await auth(request(a).post("/sign-intent")).send(good).expect(200);
    expect(ok.body).toEqual({ hash: "abc123", status: "success", success: true });
    expect(pay).toHaveBeenCalledWith(PAYEE, "1000000000");
    // same seq -> replay (committed)
    const replay = await auth(request(a).post("/sign-intent")).send(good).expect(409);
    expect(replay.body.reason).toBe("ReplaySeq");
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it("GET /audit returns approved + denied entries", async () => {
    const { app: a } = app();
    await auth(request(a).post("/sign-intent")).send(good).expect(200);
    await auth(request(a).post("/sign-intent"))
      .send({ payee: "account-hash-deadbeef", amountMotes: "1", seq: 2 }).expect(403);
    const r = await request(a).get("/audit").expect(200);
    expect(r.body.length).toBe(2);
    expect(r.body[0].event).toBe("approved");
    expect(r.body[1].event).toBe("denied");
    expect(r.body[1].reason).toBe("PayeeNotAllowed");
  });

  // ---- #1: seq must NOT be consumed by a failed pay ----

  it("failed pay (throw) leaves seq retryable; same seq later succeeds -> 200", async () => {
    let calls = 0;
    const pay: PayFn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return { hash: "ok", status: "success" as const, success: true };
    });
    const { app: a } = app(pay);
    const fail = await auth(request(a).post("/sign-intent")).send(good).expect(502);
    expect(fail.body.reason).toBe("pay failed");
    expect(fail.body.detail).toBeUndefined(); // #6: no detail leaked
    // retry SAME seq -> succeeds
    const ok = await auth(request(a).post("/sign-intent")).send(good).expect(200);
    expect(ok.body.success).toBe(true);
    expect(pay).toHaveBeenCalledTimes(2);
  });

  it("reverted pay leaves seq retryable; same seq later succeeds -> 200", async () => {
    let calls = 0;
    const pay: PayFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return { hash: "rev", status: "reverted" as const, success: false };
      return { hash: "ok", status: "success" as const, success: true };
    });
    const { app: a } = app(pay);
    const rev = await auth(request(a).post("/sign-intent")).send(good).expect(502);
    expect(rev.body.reason).toBe("Reverted");
    const ok = await auth(request(a).post("/sign-intent")).send(good).expect(200);
    expect(ok.body.success).toBe(true);
  });

  it("concurrent duplicate seq while in-flight -> 409 (only one pay)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const pay: PayFn = vi.fn(async () => {
      await gate;
      return { hash: "abc", status: "success" as const, success: true };
    });
    const { app: a } = app(pay);
    // Start the first request and ensure it actually hits the server (pay called).
    const first = auth(request(a).post("/sign-intent")).send(good).then((r) => r);
    await vi.waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    const dup = await auth(request(a).post("/sign-intent")).send(good).expect(409);
    expect(dup.body.reason).toBe("ReplaySeq");
    release();
    const ok = await first;
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it("replay of a committed seq -> 409", async () => {
    const { app: a } = app();
    await auth(request(a).post("/sign-intent")).send(good).expect(200);
    await auth(request(a).post("/sign-intent")).send(good).expect(409);
  });

  // ---- #2: "unknown" execution result is non-committing and distinct ----

  it("unknown pay result -> 202 distinct status, seq NOT committed (retryable with SAME seq)", async () => {
    let calls = 0;
    const pay: PayFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return { hash: "pending-hash", status: "unknown" as const, success: false };
      return { hash: "landed", status: "success" as const, success: true };
    });
    const { app: a } = app(pay);
    const r = await auth(request(a).post("/sign-intent")).send(good).expect(202);
    expect(r.body.status).toBe("unknown");
    expect(r.body.success).toBe(false);
    expect(r.body.hash).toBe("pending-hash");
    // seq NOT committed -> the SAME seq is retryable (brain must NOT mint a new seq,
    // which would risk a double-pay if the original pending tx later lands).
    const ok = await auth(request(a).post("/sign-intent")).send(good).expect(200);
    expect(ok.body.success).toBe(true);
  });

  // ---- #7: malformed JSON -> 400 + denied audit entry ----

  it("malformed JSON body -> 400 and writes a denied audit entry", async () => {
    const { app: a } = app();
    await auth(request(a).post("/sign-intent"))
      .set("Content-Type", "application/json")
      .send("{ not json ")
      .expect(400);
    const r = await request(a).get("/audit").expect(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0].event).toBe("denied");
    expect(r.body[0].reason).toBe("BadJson");
  });
});
