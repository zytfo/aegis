/**
 * ============================================================================
 * software_signer.ts — THE ANTI-PATTERN. THIS IS THE CONTRAST, NOT THE PRODUCT.
 * ============================================================================
 *
 * !!! DO NOT SHIP THIS. DO NOT USE THIS IN AEGIS. !!!
 *
 * This file exists ONLY to demonstrate the hardware moat by showing what the
 * "naive" agent — the one everyone else builds — actually does, and why it is
 * catastrophic.
 *
 * The naive agent HOLDS the Ed25519 secret key itself (in process.env or a
 * local PEM file) and signs transactions DIRECTLY with casper-js-sdk, with no
 * Pi, no allowlist, no per-tx cap, no on-chain device-only enforcement.
 *
 * Consequences — all TRIVIALLY achievable for any attacker with shell on this
 * host (or who reads an env var, a log, a swapfile, a backup):
 *   1. COPY THE KEY. The plaintext key sits in memory and on disk. `cat
 *      secret_key.pem` or dumping `process.env` exfiltrates it in one command.
 *   2. SIGN FROM ANOTHER MACHINE. With the copied key, the attacker signs valid
 *      transactions from their OWN laptop. Wiping/rebuilding THIS host changes
 *      nothing — the key is already gone and works anywhere.
 *   3. NATIVE-TRANSFER THE WHOLE BALANCE. `nativeTransfer` below moves the
 *      ACCOUNT'S native CSPR directly — no contract, no policy, no cap. The
 *      attacker drains the entire account to themselves.
 *
 * NONE of this is possible with Aegis:
 *   - The key NEVER leaves the Pi (generated/imported into an encrypted store,
 *     decrypted only in the signer process on the device).
 *   - The signer emits ONLY a contract `pay` to an ALLOWLISTED payee under a
 *     per-tx cap; it will not build a native transfer at all.
 *   - The compromised brain can at most POST {payee, amountMotes, seq} and is
 *     blocked by 403 PayeeNotAllowed (see inject.ts).
 *   - The owner can `rotate_device_key` on-chain to instantly neutralize a
 *     leaked/old device key.
 *
 * Implemented with the spike-confirmed casper-js-sdk v5 API (patterns reused
 * from signer/src/casper.ts). Submission is injected so unit tests can mock it
 * and we never need a funded throwaway key.
 * ============================================================================
 */
import { readFileSync } from "node:fs";
import {
  PrivateKey,
  KeyAlgorithm,
  ContractCallBuilder,
  NativeTransferBuilder,
  Args,
  CLValue,
  Key,
  RpcClient,
  HttpHandler,
  type Transaction,
  type PrivateKeyT,
  type RpcClientT,
} from "./sdk.js";

const DEFAULT_GAS = 5_000_000_000;
const NATIVE_TRANSFER_GAS = 100_000_000; // native transfers are cheap (~0.1 CSPR)

export interface SoftwareSignerConfig {
  chainName?: string;
  contractPackageHash?: string;
  node?: string;
}

const DEFAULTS = {
  chainName: "casper-test",
  contractPackageHash: "hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3",
  node: "https://node.testnet.casper.network/rpc",
};

/**
 * DANGER: loads the plaintext secret key into THIS process. In the naive design
 * the key lives here (env/file) — exactly the material Aegis keeps on the Pi.
 */
function loadKeyFromPem(keyPem: string): PrivateKeyT {
  return PrivateKey.fromPem(keyPem, KeyAlgorithm.ED25519);
}

/** Resolve key PEM from an explicit string, a file path, or process.env. */
export function resolveKeyPem(opts: { pem?: string; pemPath?: string; envVar?: string }): string {
  if (opts.pem) return opts.pem;
  if (opts.pemPath) return readFileSync(opts.pemPath, "utf8");
  if (opts.envVar && process.env[opts.envVar]) return process.env[opts.envVar] as string;
  throw new Error("no key material provided (pem/pemPath/envVar)");
}

/** Inject the submit step so tests don't need a funded key or live node. */
export type Submit = (signed: Transaction) => Promise<string>;

/** Real submitter: PUTs the signed tx to the node and returns the hash hex. */
export function rpcSubmit(node: string = DEFAULTS.node): Submit {
  const url = node.endsWith("/rpc") ? node : `${node.replace(/\/$/, "")}/rpc`;
  const rpc: RpcClientT = new RpcClient(new HttpHandler(url));
  return async (signed: Transaction) => {
    const res = await rpc.putTransaction(signed);
    return res.transactionHash.toHex();
  };
}

/**
 * NAIVE: build + sign a contract `pay` DIRECTLY with the in-process key.
 * (Aegis would have the Pi do this; here the agent holds the key.)
 */
export async function signPayDirectly(
  keyPem: string,
  args: { payee: string; amountMotes: string },
  submit: Submit,
  cfg: SoftwareSignerConfig = {},
): Promise<{ hash: string }> {
  const chainName = cfg.chainName ?? DEFAULTS.chainName;
  const pkg = (cfg.contractPackageHash ?? DEFAULTS.contractPackageHash).replace(/^hash-/, "");

  const key = loadKeyFromPem(keyPem);
  const runtimeArgs = Args.fromMap({
    payee: CLValue.newCLKey(Key.newKey(args.payee)),
    amount: CLValue.newCLUInt512(args.amountMotes),
  });
  const tx = new ContractCallBuilder()
    .from(key.publicKey)
    .byPackageHash(pkg)
    .entryPoint("pay")
    .runtimeArgs(runtimeArgs)
    .chainName(chainName)
    .payment(DEFAULT_GAS)
    .build();
  tx.sign(key);
  const hash = await submit(tx);
  return { hash };
}

/**
 * THE CATASTROPHE: a DIRECT native CSPR transfer of the account's own balance to
 * an arbitrary recipient. No contract, no allowlist, no cap, no device check —
 * just the raw key moving money. This is precisely what the hardware moat makes
 * impossible: the Pi signer can ONLY emit a policy-bounded contract `pay`, never
 * a native transfer of the account balance.
 */
export async function nativeTransfer(
  keyPem: string,
  args: { to: string; amountMotes: string },
  submit: Submit,
  cfg: SoftwareSignerConfig = {},
): Promise<{ hash: string }> {
  const chainName = cfg.chainName ?? DEFAULTS.chainName;
  const key = loadKeyFromPem(keyPem);
  const tx = new NativeTransferBuilder()
    .from(key.publicKey)
    .targetAccountHash(Key.newKey(args.to).account!)
    .amount(args.amountMotes)
    .chainName(chainName)
    .payment(NATIVE_TRANSFER_GAS)
    .build();
  tx.sign(key);
  const hash = await submit(tx);
  return { hash };
}
