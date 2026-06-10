import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPem, loadKey, publicKeyHex, generateAndStore } from "../src/key.js";

const DEVICE_PEM = "/Users/zytfo/Desktop/Projects/hackathon/keys/device/secret_key.pem";
const DEVICE_PUB = "011ac2c8321b60f261878d20804a8bd79dfc64f9e638adfa975e3082bfd87413e6";

let dirs: string[] = [];
function tmpStore() {
  const d = mkdtempSync(join(tmpdir(), "key-"));
  dirs.push(d);
  return join(d, "device.enc");
}
afterEach(() => { dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });

describe("encrypted key store", () => {
  it("imports the device pem and round-trips to the SAME funded account", () => {
    const path = tmpStore();
    const imported = importPem(DEVICE_PEM, path, "hunter2");
    expect(publicKeyHex(imported)).toBe(DEVICE_PUB);
    const loaded = loadKey(path, "hunter2");
    expect(publicKeyHex(loaded)).toBe(DEVICE_PUB);
  });

  it("wrong passphrase throws", () => {
    const path = tmpStore();
    importPem(DEVICE_PEM, path, "right");
    expect(() => loadKey(path, "wrong")).toThrow();
  });

  it("stored file contains NO plaintext key material", () => {
    const path = tmpStore();
    importPem(DEVICE_PEM, path, "pw");
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("BEGIN");
    // base64 of the device pem secret bytes must not appear
    expect(raw).not.toContain("MC4CAQAwBQYDK2Vw");
    const j = JSON.parse(raw);
    expect(j.alg).toBe("aes-256-gcm");
    expect(j.ct).toBeTruthy();
  });

  it("generateAndStore round-trips a fresh key", () => {
    const path = tmpStore();
    const kp = generateAndStore(path, "pw");
    expect(publicKeyHex(loadKey(path, "pw"))).toBe(publicKeyHex(kp));
  });
});
