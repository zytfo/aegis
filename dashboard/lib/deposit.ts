/**
 * deposit.ts — CLIENT-SIDE ONLY. Build, sign, and submit a deposit into the live
 * GuardedWallet contract's payable `deposit` entry point on Casper testnet.
 *
 * Unlike `casper.ts` (server-side, read-only, raw JSON-RPC), everything here runs
 * in the browser: it builds an unsigned Transaction with casper-js-sdk v5, hands
 * the JSON to the Casper Wallet extension popup for the user to sign, then submits
 * the signed transaction to the node.
 *
 * The contract is an Odra contract. Calling a payable entry point on a *package*
 * with attached value is done via Odra's `proxy_caller_with_return.wasm`: a session
 * (account-context) wasm that forwards `attached_value` from the caller's purse and
 * dispatches into `package_hash::entry_point(inner_args)`. We pass the proxy wasm as
 * session code via SessionBuilder().wasm(...) — NOT installOrUpgrade(), which is for
 * deploying contracts, not running proxy session code.
 *
 * IMPORTANT: do not import this from server components. It pulls the in-browser
 * casper-js-sdk build and reads the wallet provider injected into `window`.
 */
import {
  SessionBuilder,
  NativeTransferBuilder,
  PublicKey,
  Args,
  CLValue,
  Key,
  Transaction,
  TransactionV1,
  RpcClient,
  HttpHandler,
} from "casper-js-sdk";

export const NODE = "https://node.testnet.casper.network/rpc";
export const CHAIN = "casper-test";
export const PACKAGE_HASH =
  "hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3";
const PACKAGE_HASH_HEX = PACKAGE_HASH.replace(/^hash-/, "");

/** 1 CSPR = 10^9 motes. */
export const MOTES_PER_CSPR = 1_000_000_000n;
/** Gas for the proxy-caller deposit. 5 CSPR was Out-of-Gas; 15 is the safe value. */
const DEPOSIT_PAYMENT = 15_000_000_000;
/** Gas for a plain native transfer (cheap). */
const NATIVE_PAYMENT = 100_000_000;

export type PackageHashEncoding = "key" | "bytes";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** CSPR (decimal string or number) -> motes (bigint). */
export function csprToMotes(cspr: string | number): bigint {
  const s = String(cspr).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid CSPR amount: ${cspr}`);
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "000000000").slice(0, 9);
  return BigInt(whole) * MOTES_PER_CSPR + BigInt(fracPadded || "0");
}

/**
 * Build the package_hash runtime arg in one of two CL encodings.
 *
 * Why two: the exact CL type the node/Odra proxy expects for `package_hash` is the
 * single fragile detail of this call. The two plausible encodings are:
 *   - "key"   : CLKey wrapping a Hash key  (`hash-1359b3…`)         <- default
 *   - "bytes" : a raw 32-byte ByteArray of the package hash         <- alternate
 * If the first click is rejected by the node with a parse/type error, flip the
 * `packageHashEncoding` flag (single place to change) and retry — no other code
 * change needed. Default is "key".
 */
function packageHashArg(encoding: PackageHashEncoding): CLValue {
  return encoding === "bytes"
    ? CLValue.newCLByteArray(hexToBytes(PACKAGE_HASH_HEX))
    : CLValue.newCLKey(Key.newKey(PACKAGE_HASH));
}

export interface DepositTxParams {
  /** active public key hex from the connected wallet */
  activePubKeyHex: string;
  /** deposit amount in motes */
  amountMotes: bigint;
  /** bytes of /proxy_caller_with_return.wasm (fetched from /public) */
  proxyBytes: Uint8Array;
  /** package_hash CL encoding; default "key" (see packageHashArg) */
  packageHashEncoding?: PackageHashEncoding;
}

/**
 * Build the UNSIGNED deposit transaction. Pure/synchronous given the proxy bytes;
 * the caller fetches /proxy_caller_with_return.wasm and passes it in.
 */
export function depositTx({
  activePubKeyHex,
  amountMotes,
  proxyBytes,
  packageHashEncoding = "key",
}: DepositTxParams): Transaction {
  const amount = amountMotes.toString();

  // The proxy forwards `attached_value` from our purse and calls
  // package_hash::entry_point(args). `args` is the *inner* entry-point args,
  // CL-serialized; deposit() takes none, so it's an empty Args byte array.
  const innerArgs = new Args(new Map()).toBytes();

  const args = Args.fromMap({
    package_hash: packageHashArg(packageHashEncoding),
    entry_point: CLValue.newCLString("deposit"),
    args: CLValue.newCLByteArray(innerArgs),
    attached_value: CLValue.newCLUInt512(amount),
    amount: CLValue.newCLUInt512(amount),
  });

  return new SessionBuilder()
    .from(PublicKey.fromHex(activePubKeyHex))
    .wasm(proxyBytes)
    .runtimeArgs(args)
    .chainName(CHAIN)
    .payment(DEPOSIT_PAYMENT)
    .build();
}

/**
 * FALLBACK: a plain native CSPR transfer to fund the device/owner gas-float
 * account directly. Zero proxy-caller risk — used behind the "top up gas float"
 * button so the demo still works if the deposit encoding needs tuning.
 */
export function nativeTopUp(params: {
  activePubKeyHex: string;
  targetPubKeyHex: string;
  amountMotes: bigint;
}): Transaction {
  return new NativeTransferBuilder()
    .from(PublicKey.fromHex(params.activePubKeyHex))
    .target(PublicKey.fromHex(params.targetPubKeyHex))
    .amount(params.amountMotes.toString())
    .chainName(CHAIN)
    .payment(NATIVE_PAYMENT)
    .build();
}

/** Fetch the proxy wasm bytes from /public (browser). */
export async function fetchProxyBytes(): Promise<Uint8Array> {
  const res = await fetch("/proxy_caller_with_return.wasm");
  if (!res.ok) throw new Error(`failed to load proxy wasm: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// --- Casper Wallet provider (injected by the browser extension) ----------------
// The extension injects `window.CasperWalletProvider` (a constructor factory) and
// `window.CasperWalletEventTypes`. There is NO installable npm SDK for this — the
// provider only exists at runtime in the page. Minimal typings for what we use.
export interface CasperWalletSignResult {
  cancelled: boolean;
  /** raw signature bytes (present when not cancelled) */
  signature?: Uint8Array;
  signatureHex?: string;
}
export interface CasperWalletProvider {
  requestConnection(): Promise<boolean>;
  disconnectFromSite(): Promise<boolean>;
  isConnected(): Promise<boolean>;
  getActivePublicKey(): Promise<string>;
  sign(deployOrTxJson: string, signingPublicKeyHex: string): Promise<CasperWalletSignResult>;
}
type ProviderFactory = (options?: { timeout?: number }) => CasperWalletProvider;

declare global {
  interface Window {
    CasperWalletProvider?: ProviderFactory;
  }
}

/** 30 min request timeout (matches Casper Wallet docs default). */
const REQUESTS_TIMEOUT_MS = 30 * 60 * 1000;

/** Get the injected provider, or throw if the extension is not installed. */
export function getProvider(): CasperWalletProvider {
  if (typeof window === "undefined" || typeof window.CasperWalletProvider !== "function") {
    throw new Error(
      "Casper Wallet extension is not installed. Install it from the Chrome Web Store and reload.",
    );
  }
  return window.CasperWalletProvider({ timeout: REQUESTS_TIMEOUT_MS });
}

export interface SubmitResult {
  /** transaction hash hex (for the explorer link) */
  hash: string;
}

/**
 * Full round-trip: take an unsigned Transaction, ask the wallet to sign it, apply
 * the signature, submit to the node, and wait for execution. Throws on cancel/fail.
 *
 * `onStatus` lets the UI surface each phase.
 */
export async function signAndSubmit(
  tx: Transaction,
  activePubKeyHex: string,
  onStatus?: (phase: string, detail?: string) => void,
): Promise<SubmitResult> {
  const provider = getProvider();

  // 1. Get the V1 body and serialize to JSON for the wallet.
  const v1 = tx.getTransactionV1();
  if (!v1) throw new Error("expected a TransactionV1 (got a legacy deploy)");
  const json = JSON.stringify(TransactionV1.toJSON(v1));

  // 2. Ask the wallet to sign (popup; human-driven).
  onStatus?.("awaiting signature");
  const res = await provider.sign(json, activePubKeyHex);
  if (res.cancelled) throw new Error("signature cancelled in the wallet");
  if (!res.signature) throw new Error("wallet returned no signature");

  // 3. Apply the signature and rewrap into a submittable Transaction.
  TransactionV1.setSignature(v1, res.signature, PublicKey.fromHex(activePubKeyHex));
  const signed = Transaction.fromTransactionV1(v1);

  // 4. Submit. Prefer the SDK RpcClient; fall back to raw JSON-RPC if it misbehaves
  //    (the SDK's axios handler has corrupted bodies inside Next before — see casper.ts).
  onStatus?.("submitted");
  let hash: string;
  try {
    const client = new RpcClient(new HttpHandler(NODE));
    await client.putTransaction(signed);
    hash = signed.hash.toHex();
    await client.waitForTransaction(signed, 180_000);
  } catch (sdkErr) {
    // Fallback: raw account_put_transaction, mirroring the raw-fetch pattern in casper.ts.
    try {
      hash = await rawPutTransaction(signed);
    } catch (rawErr) {
      throw new Error(
        `submit failed (sdk: ${asMsg(sdkErr)}; raw: ${asMsg(rawErr)})`,
      );
    }
  }

  onStatus?.("confirmed", hash);
  return { hash };
}

function asMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Raw JSON-RPC `account_put_transaction` fallback (mirrors lib/casper.ts pattern). */
async function rawPutTransaction(signed: Transaction): Promise<string> {
  const txJson = signed.toJSON();
  const res = await fetch(NODE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "account_put_transaction",
      params: { transaction: txJson },
    }),
  });
  const body = (await res.json()) as {
    result?: { transaction_hash?: { Version1?: string } };
    error?: { code: number; message: string };
  };
  if (body.error) {
    throw new Error(`account_put_transaction: ${body.error.code} ${body.error.message}`);
  }
  return body.result?.transaction_hash?.Version1 ?? signed.hash.toHex();
}
