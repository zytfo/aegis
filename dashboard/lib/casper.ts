/**
 * casper.ts — READ-ONLY live reader for the GuardedWallet state on Casper testnet.
 *
 * No transactions, no gas, no keys. Everything here is a free JSON-RPC global-state
 * query against a public node. Verified against the live contract on `casper-test`.
 *
 * Why raw fetch instead of casper-js-sdk's RpcClient: the SDK's axios-based HTTP
 * handler, when run inside Next's server runtime, produced corrupted request
 * bodies that the node answered with `413 Payload Too Large`. The exact same
 * calls work from a plain Node script. Rather than fight the bundler/adapter
 * interaction, the read path here speaks the JSON-RPC wire protocol directly with
 * the global `fetch`. We still use the SDK's `byteHash` (blake2b-256) for the one
 * pure-CPU step: deriving Odra's dictionary item keys.
 *
 * How the read path was determined (the non-obvious part):
 *   - The deployed package (`hash-1359b3...`) is a *legacy* ContractPackage; its
 *     active version is a Contract entity (`hash-22cac3...`) whose `named_keys`
 *     include a single `state` URef and a `__contract_main_purse` URef.
 *   - Odra stores every `Var`/`Mapping` field as a DICTIONARY ITEM under the
 *     `state` URef. The item key for a top-level field at module index N is
 *     `hex(blake2b256( u32_be(N) ))`. Module fields are indexed from 1 (the macro
 *     reserves 0). For GuardedWallet:
 *       owner=1, device=2, allowlist=3, per_tx_max=4, period_cap=5,
 *       period_len=6, spent_in_period=7, period_start=8, payees=9.
 *   - Each item's CLValue is an Odra `Bytes` (CL `List<U8>`); its `parsed` array
 *     is the field's raw CL serialization, decoded here (U512/U64/Key/Vec<Key>).
 *   - The treasury balance is the balance of the contract main purse.
 */
import { createRequire } from "node:module";

// Only `byteHash` (blake2b-256) is needed from the SDK, loaded via real CJS
// require so the bundler never transforms it.
const require = createRequire(import.meta.url);
const { byteHash } = require("casper-js-sdk") as { byteHash: (b: Uint8Array) => Uint8Array };

const NODE = process.env.CASPER_NODE_ADDRESS ?? "https://node.testnet.casper.network/rpc";
const PACKAGE_HASH =
  process.env.CONTRACT_PACKAGE_HASH ??
  "hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3";

function nodeUrl(): string {
  return NODE.endsWith("/rpc") ? NODE : `${NODE.replace(/\/$/, "")}/rpc`;
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(nodeUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as RpcResponse<T>;
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  if (json.result === undefined) throw new Error(`${method}: empty result`);
  return json.result;
}

/** Odra dictionary item key for a top-level module field at the given index. */
function fieldKey(index: number): string {
  const idxBytes = new Uint8Array([0, 0, 0, index & 0xff]); // u32 big-endian, index <= 15
  return Buffer.from(byteHash(idxBytes)).toString("hex");
}

const FIELD_INDEX = {
  owner: 1,
  device: 2,
  per_tx_max: 4,
  period_cap: 5,
  period_len: 6,
  spent_in_period: 7,
  period_start: 8,
  payees: 9,
} as const;

/** Decode a CL U512/U256/U128 (1-byte length prefix + little-endian payload). */
function decodeUInt(bytes: number[]): string {
  const len = bytes[0];
  let v = 0n;
  for (let i = 0; i < len; i++) v += BigInt(bytes[1 + i]) << BigInt(8 * i);
  return v.toString();
}

/** Decode a CL U64 (8 little-endian bytes). */
function decodeU64(bytes: number[]): string {
  let v = 0n;
  for (let i = 0; i < 8; i++) v += BigInt(bytes[i] ?? 0) << BigInt(8 * i);
  return v.toString();
}

/** Decode a CL Key (tag 0 = Account -> "account-hash-...", tag 1 = Hash). */
function decodeAccountKey(bytes: number[], offset = 0): string {
  const tag = bytes[offset];
  const hash = bytes
    .slice(offset + 1, offset + 33)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (tag === 1 ? "hash-" : "account-hash-") + hash;
}

/** Decode a CL Vec<Key> (u32 LE length prefix + N keys of 33 bytes each). */
function decodeKeyVec(bytes: number[]): string[] {
  const count = bytes[0] + (bytes[1] << 8) + (bytes[2] << 16) + (bytes[3] << 24);
  const out: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    out.push(decodeAccountKey(bytes, off));
    off += 33;
  }
  return out;
}

// --- JSON-RPC result shapes (only the fields we read) --------------------------
interface PackageResult {
  stored_value: {
    ContractPackage?: { versions?: Array<{ contract_hash: string }> };
  };
}
interface EntityResult {
  stored_value: { Contract?: { named_keys?: Array<{ name: string; key: string }> } };
}
interface DictItemResult {
  stored_value: { CLValue?: { parsed?: number[] } };
}
interface BalanceResult {
  balance: string;
}

export interface WalletState {
  /** treasury balance in the contract purse, motes (decimal string) */
  balance: string;
  perTxMax: string;
  periodCap: string;
  spentInPeriod: string;
  /** block-time millis */
  periodStart: string;
  /** period length, millis */
  periodLen: string;
  owner: string;
  device: string;
  payees: string[];
  /** echoed metadata so the UI / health checks can confirm what was read */
  meta: { node: string; packageHash: string; contractHash: string; stateRootHash: string };
}

/**
 * Read the full live GuardedWallet state from the testnet node.
 * Read-only: a sequence of free JSON-RPC global-state queries.
 */
export async function readWalletState(): Promise<WalletState> {
  const root = (await rpc<{ state_root_hash: string }>("chain_get_state_root_hash", {}))
    .state_root_hash;
  const at = { state_identifier: { StateRootHash: root } };

  // 1. package -> active contract entity
  const pkg = await rpc<PackageResult>("query_global_state", { ...at, key: PACKAGE_HASH, path: [] });
  const versions = pkg.stored_value.ContractPackage?.versions ?? [];
  const contractHash = versions[versions.length - 1]?.contract_hash;
  if (!contractHash) throw new Error("no active contract version in package");
  const entityKey = "hash-" + contractHash.replace(/^(contract-|hash-)/, "");

  // 2. contract entity -> named keys (state dict uref + main purse uref)
  const entity = await rpc<EntityResult>("query_global_state", { ...at, key: entityKey, path: [] });
  const namedKeys = entity.stored_value.Contract?.named_keys ?? [];
  const lookup = (name: string): string => {
    const e = namedKeys.find((k) => k.name === name);
    if (!e) throw new Error(`named key ${name} not found`);
    return e.key;
  };
  const stateUref = lookup("state");
  const purseUref = lookup("__contract_main_purse");

  // 3. read each Var field out of the `state` dictionary by derived key
  const readField = async (index: number): Promise<number[]> => {
    const di = await rpc<DictItemResult>("state_get_dictionary_item", {
      state_root_hash: root,
      dictionary_identifier: { URef: { seed_uref: stateUref, dictionary_item_key: fieldKey(index) } },
    });
    return di.stored_value.CLValue?.parsed ?? [];
  };

  const [
    ownerBytes,
    deviceBytes,
    perTxMaxBytes,
    periodCapBytes,
    periodLenBytes,
    spentBytes,
    periodStartBytes,
    payeesBytes,
  ] = await Promise.all([
    readField(FIELD_INDEX.owner),
    readField(FIELD_INDEX.device),
    readField(FIELD_INDEX.per_tx_max),
    readField(FIELD_INDEX.period_cap),
    readField(FIELD_INDEX.period_len),
    readField(FIELD_INDEX.spent_in_period),
    readField(FIELD_INDEX.period_start),
    readField(FIELD_INDEX.payees),
  ]);

  // 4. treasury balance = contract main purse balance
  const bal = await rpc<BalanceResult>("query_balance", {
    purse_identifier: { purse_uref: purseUref },
  });

  return {
    balance: bal.balance,
    perTxMax: decodeUInt(perTxMaxBytes),
    periodCap: decodeUInt(periodCapBytes),
    spentInPeriod: decodeUInt(spentBytes),
    periodStart: decodeU64(periodStartBytes),
    periodLen: decodeU64(periodLenBytes),
    owner: decodeAccountKey(ownerBytes),
    device: decodeAccountKey(deviceBytes),
    payees: decodeKeyVec(payeesBytes),
    meta: { node: NODE, packageHash: PACKAGE_HASH, contractHash: entityKey, stateRootHash: root },
  };
}
