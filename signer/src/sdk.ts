/**
 * sdk.ts — casper-js-sdk re-export shim.
 *
 * casper-js-sdk@5 ships a CJS bundle (dist/lib.node.js) with no "import"
 * export condition. When a non-entry ESM `.ts` module does `import { X } from
 * "casper-js-sdk"`, Node's ESM loader runs cjs-module-lexer over the bundle and
 * fails to detect some named exports (e.g. the `KeyAlgorithm` enum), throwing
 * "does not provide an export named X". A namespace/default import sidesteps the
 * static named-export check and destructures at runtime, which works reliably.
 */
import casper from "casper-js-sdk";
import type * as CasperTypes from "casper-js-sdk";

const sdk = casper as unknown as typeof CasperTypes;

export const {
  PrivateKey,
  KeyAlgorithm,
  ContractCallBuilder,
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
