import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSeqStore } from "../src/seq.js";

let dirs: string[] = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), "seq-"));
  dirs.push(d);
  return d;
}
function tmpPath() {
  return join(tmpDir(), "seq.txt");
}
afterEach(() => { dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });

describe("makeSeqStore", () => {
  it("isFresh checks without writing; commit persists", () => {
    const s = makeSeqStore(tmpPath());
    expect(s.isFresh(1)).toBe(true);
    expect(s.last()).toBe(-1); // isFresh did not write
    expect(s.isFresh(1)).toBe(true); // still fresh, not committed
    s.commit(1);
    expect(s.last()).toBe(1);
    expect(s.isFresh(1)).toBe(false); // replay
    expect(s.isFresh(0)).toBe(false); // lower
    expect(s.isFresh(2)).toBe(true);
    s.commit(2);
    expect(s.isFresh(2)).toBe(false);
  });

  it("commit of a non-fresh seq throws", () => {
    const s = makeSeqStore(tmpPath());
    s.commit(5);
    expect(() => s.commit(5)).toThrow();
    expect(() => s.commit(4)).toThrow();
    expect(() => s.commit(1.5)).toThrow();
  });

  it("survives reload from disk", () => {
    const p = tmpPath();
    const s1 = makeSeqStore(p);
    s1.commit(5);
    const s2 = makeSeqStore(p); // reopen
    expect(s2.last()).toBe(5);
    expect(s2.isFresh(5)).toBe(false); // replay across restart
    expect(s2.isFresh(6)).toBe(true);
    s2.commit(6);
    expect(makeSeqStore(p).last()).toBe(6);
  });

  it("absent file means last=-1", () => {
    const s = makeSeqStore(join(tmpDir(), "does-not-exist.txt"));
    expect(s.last()).toBe(-1);
  });

  it("fails closed on a corrupt non-empty file (throws)", () => {
    const p = tmpPath();
    writeFileSync(p, "not-a-number", "utf8");
    expect(() => makeSeqStore(p)).toThrow(/corrupt/);
  });

  it("commit is durable via atomic write (file content matches)", () => {
    const p = tmpPath();
    const s = makeSeqStore(p);
    s.commit(7);
    expect(readFileSync(p, "utf8")).toBe("7");
  });
});
