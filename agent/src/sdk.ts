/**
 * sdk.ts — casper-js-sdk re-export shim (same workaround as signer/src/sdk.ts).
 *
 * casper-js-sdk@5 ships a CJS bundle with no "import" export condition; a
 * namespace/default import sidesteps Node's ESM static named-export check and
 * destructures at runtime, which works reliably.
 */
import casper from "casper-js-sdk";
import type * as CasperTypes from "casper-js-sdk";

const sdk = casper as unknown as typeof CasperTypes;

export const {
  PrivateKey,
  KeyAlgorithm,
  ContractCallBuilder,
  NativeTransferBuilder,
  Args,
  CLValue,
  Key,
  RpcClient,
  HttpHandler,
} = sdk;

export type PublicKey = CasperTypes.PublicKey;
export type Transaction = CasperTypes.Transaction;
export type PrivateKeyT = CasperTypes.PrivateKey;
export type RpcClientT = CasperTypes.RpcClient;
