/**
 * main.ts — Pi Signer daemon entrypoint.
 *
 * On first run, imports the existing funded device PEM into an encrypted-at-rest
 * key store. On subsequent runs, loads from that store. Wires `pay` to
 * buildAndSignPay (gas is hardcoded server-side; the brain supplies only
 * payee + amount). Exposes the authenticated /sign-intent endpoint.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { importPem, loadKey, publicKeyHex } from "./key.js";
import { buildAndSignPay } from "./deploy.js";
import { makeApp, type PayFn } from "./server.js";
import type { Policy } from "../../shared/src/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const NODE = process.env.NODE_ADDRESS ?? "https://node.testnet.casper.network";
const CHAIN = process.env.CHAIN_NAME ?? "casper-test";
const CONTRACT = process.env.CONTRACT_PACKAGE_HASH ??
  "hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3";
const PAYEE = process.env.PAYEE_HASH ??
  "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";
const KEY_STORE = process.env.KEY_STORE_PATH ?? "./device.enc";
const DEVICE_PEM = process.env.DEVICE_PEM_PATH ??
  "/Users/zytfo/Desktop/Projects/hackathon/keys/device/secret_key.pem";
const SEQ_PATH = process.env.SEQ_PATH ?? "./seq.txt";
const AUDIT_PATH = process.env.AUDIT_PATH ?? "./audit.jsonl";

const policy: Policy = {
  perTxMaxMotes: process.env.PER_TX_MAX_MOTES ?? "5000000000", // 5 CSPR
  allowlist: [PAYEE],
};

// Known dev-default credentials. Refuse to start with any of these (or unset),
// so the daemon never silently runs with publicly-known secrets.
const DEV_DEFAULT_TOKENS = new Set(["dev-token-change-me", "change-me-to-a-long-random-string", "change-me"]);
const DEV_DEFAULT_PASSES = new Set(["dev-pass-change-me", "change-me"]);

/** Validate a required secret env var; throw (fail closed) on unset/dev-default. */
export function requireSecret(name: string, value: string | undefined, devDefaults: Set<string>): string {
  if (!value || value.trim() === "" || devDefaults.has(value)) {
    throw new Error(
      `${name} is unset or set to a known dev default. Refusing to start. ` +
        `Set ${name} to a strong, unique value in the environment.`,
    );
  }
  return value;
}

function main() {
  const TOKEN = requireSecret("SIGNER_TOKEN", process.env.SIGNER_TOKEN, DEV_DEFAULT_TOKENS);
  const KEY_PASS = requireSecret("KEY_PASS", process.env.KEY_PASS, DEV_DEFAULT_PASSES);

  // load (or import on first run) the device key
  const key = existsSync(KEY_STORE)
    ? loadKey(KEY_STORE, KEY_PASS)
    : importPem(DEVICE_PEM, KEY_STORE, KEY_PASS);
  const pub = key.publicKey;
  console.log(`[signer] device key loaded: ${publicKeyHex(key)}`);

  const pay: PayFn = (payee, amountMotes) =>
    buildAndSignPay({
      node: NODE,
      chainName: CHAIN,
      contractPackageHash: CONTRACT,
      payee,
      amountMotes,
      key,
      senderPubKey: pub,
    });

  const app = makeApp({ token: TOKEN, policy, seqPath: SEQ_PATH, auditPath: AUDIT_PATH, pay });
  app.listen(PORT, () => {
    console.log(`[signer] listening on :${PORT}`);
    console.log(`[signer] node=${NODE} chain=${CHAIN}`);
    console.log(`[signer] contract=${CONTRACT}`);
    console.log(`[signer] policy: perTxMax=${policy.perTxMaxMotes} allowlist=${policy.allowlist.join(",")}`);
  });
}

// Only run the daemon when executed directly (not when imported by tests).
if (process.env.VITEST === undefined) main();
