/**
 * casper.ts — the SPIKE-CONFIRMED casper-js-sdk v5 wrapper.
 *
 * Confirmed against casper-js-sdk@5.0.12 on live Casper testnet (chain casper-test):
 *   - PrivateKey.fromPem(pem, KeyAlgorithm.ED25519)            -> device key
 *   - new ContractCallBuilder().from(pub).byPackageHash(hash)
 *       .entryPoint("pay").runtimeArgs(args).chainName(c).payment(gas).build()
 *   - Args.fromMap({ payee: CLValue.newCLKey(Key.newKey("account-hash-..")),
 *                    amount: CLValue.newCLUInt512(motes) })
 *   - tx.sign(privateKey)
 *   - new RpcClient(new HttpHandler(NODE_URL+"/rpc")).putTransaction(tx)
 *   - rpc.waitForTransaction(tx, timeoutMs) -> executionInfo.executionResult.errorMessage
 *
 * Working pay tx: f9b38d4b6bae6071eb242feba01f66c440c5329879f291a44bd4fab976e3428f (SUCCESS).
 * Gas finding: consumed ~3.15 CSPR for pay(); 3 CSPR was Out-of-gas, 8 CSPR succeeded.
 */
import { readFileSync } from "node:fs";
import {
  PrivateKey,
  KeyAlgorithm,
  ContractCallBuilder,
  Args,
  CLValue,
  Key,
  RpcClient,
  HttpHandler,
  type PublicKey,
  type Transaction,
  type PrivateKeyT,
  type RpcClientT,
} from "./sdk.js";

export type DeviceKey = PrivateKeyT;

/** Load the device Ed25519 key directly from a PEM file. */
export function loadDeviceKey(pemPath: string): DeviceKey {
  return PrivateKey.fromPem(readFileSync(pemPath, "utf8"), KeyAlgorithm.ED25519);
}

export interface BuildPayOpts {
  chainName: string;
  /** contract package hash, with or without the "hash-" prefix */
  contractPackageHash: string;
  /** payee account hash, e.g. "account-hash-..." */
  payee: string;
  /** amount in motes as a decimal string */
  amountMotes: string;
  /** sender (device) public key */
  senderPubKey: PublicKey;
  /** gas payment in motes */
  gasMotes: number;
}

/** Build an unsigned contract-call Transaction for the `pay` entry point. */
export function buildPayTx(opts: BuildPayOpts): Transaction {
  const pkg = opts.contractPackageHash.replace(/^hash-/, "");
  const args = Args.fromMap({
    payee: CLValue.newCLKey(Key.newKey(opts.payee)),
    amount: CLValue.newCLUInt512(opts.amountMotes),
  });
  return new ContractCallBuilder()
    .from(opts.senderPubKey)
    .byPackageHash(pkg)
    .entryPoint("pay")
    .runtimeArgs(args)
    .chainName(opts.chainName)
    .payment(opts.gasMotes)
    .build();
}

/** Sign a transaction in place with the device key. */
export function sign(tx: Transaction, key: DeviceKey): void {
  tx.sign(key);
}

function rpcOf(node: string): RpcClientT {
  const url = node.endsWith("/rpc") ? node : `${node.replace(/\/$/, "")}/rpc`;
  return new RpcClient(new HttpHandler(url));
}

/** Submit a signed transaction; returns the tx hash hex. */
export async function submit(node: string, signed: Transaction): Promise<string> {
  const res = await rpcOf(node).putTransaction(signed);
  return res.transactionHash.toHex();
}

/**
 * Tri-state execution outcome:
 *   - "success"  : an execution result is present with NO errorMessage.
 *   - "reverted" : an execution result is present WITH an errorMessage.
 *   - "unknown"  : no execution result yet (still pending / timed out).
 *
 * The "unknown" state is critical: the tx may have been submitted and may still
 * land on-chain. Callers MUST NOT treat "unknown" like "reverted" (which would
 * free the seq for a fresh-seq reissue and risk a double-pay).
 */
export type WaitResult = "success" | "reverted" | "unknown";

/** Poll for execution; returns a tri-state result (never throws on pending). */
export async function waitForSuccess(node: string, tx: Transaction, timeoutMs = 180000): Promise<WaitResult> {
  const res = await rpcOf(node).waitForTransaction(tx, timeoutMs);
  const exec = res.executionInfo?.executionResult;
  if (!exec) return "unknown";
  return exec.errorMessage ? "reverted" : "success";
}
