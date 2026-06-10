/**
 * deploy.ts — high-level "build + sign + submit a pay" used by the daemon.
 *
 * Gas is HARDCODED here (env PAY_GAS_MOTES, default 5_000_000_000 = 5 CSPR).
 * The brain supplies ONLY payee + amount, NEVER gas or bytes. The spike found
 * pay() consumes ~3.15 CSPR; 5 CSPR gives comfortable headroom above the 2.5 min.
 */
import { buildPayTx, sign, submit, waitForSuccess, type DeviceKey, type WaitResult } from "./casper.js";
import type { PublicKey } from "./sdk.js";

const DEFAULT_GAS = 5_000_000_000;

/**
 * Resolve and validate the gas amount. PAY_GAS_MOTES must be a positive integer;
 * NaN / non-integer / non-positive throws rather than passing junk to the tx builder.
 */
export function resolveGasMotes(override?: number): number {
  const gas = override ?? Number(process.env.PAY_GAS_MOTES ?? DEFAULT_GAS);
  if (!Number.isInteger(gas) || gas <= 0) {
    throw new Error(
      `invalid gas: PAY_GAS_MOTES must be a positive integer, got ${JSON.stringify(
        process.env.PAY_GAS_MOTES ?? gas,
      )}`,
    );
  }
  return gas;
}

export interface BuildAndSignPayOpts {
  node: string;
  chainName: string;
  contractPackageHash: string;
  payee: string;
  amountMotes: string;
  key: DeviceKey;
  senderPubKey: PublicKey;
  /** optional override; otherwise env PAY_GAS_MOTES or DEFAULT_GAS */
  gasMotes?: number;
  /** if false, skip waiting for execution (status = "success") */
  wait?: boolean;
}

/**
 * Result of a pay attempt.
 *   - status "success"  : confirmed on-chain (or wait disabled).
 *   - status "reverted" : executed but reverted/errored — safe to NOT commit; a
 *                         fresh-seq reissue is acceptable (no funds moved).
 *   - status "unknown"  : pending/timeout — tx MAY still land. Do NOT commit and
 *                         do NOT signal "retry with a new seq"; surface distinctly.
 * `success` is kept for back-compat (true iff status === "success").
 */
export interface PayResult {
  hash: string;
  status: WaitResult;
  success: boolean;
}

export async function buildAndSignPay(opts: BuildAndSignPayOpts): Promise<PayResult> {
  const gasMotes = resolveGasMotes(opts.gasMotes);

  const tx = buildPayTx({
    chainName: opts.chainName,
    contractPackageHash: opts.contractPackageHash,
    payee: opts.payee,
    amountMotes: opts.amountMotes,
    senderPubKey: opts.senderPubKey,
    gasMotes,
  });
  sign(tx, opts.key);
  const hash = await submit(opts.node, tx);
  const status: WaitResult =
    opts.wait === false ? "success" : await waitForSuccess(opts.node, tx);
  return { hash, status, success: status === "success" };
}
