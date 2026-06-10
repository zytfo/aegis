/**
 * STEP 1 spike: prove casper-js-sdk v5 can build + sign + submit a contract-call
 * Transaction (Casper 2.0) to the live GuardedWallet `pay` entry point, signed by
 * the device Ed25519 key, and that it executes SUCCESS on testnet.
 *
 * Run: npx tsx spike/pay-smoke.ts
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
} from "casper-js-sdk";

const NODE = "https://node.testnet.casper.network/rpc";
const CHAIN = "casper-test";
// package hash WITHOUT the "hash-" prefix
const CONTRACT_PACKAGE = "1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3";
const DEVICE_PEM = "/Users/zytfo/Desktop/Projects/hackathon/keys/device/secret_key.pem";
const PAYEE = "account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a";
const AMOUNT = "1000000000"; // 1 CSPR
const GAS = 8_000_000_000; // 8 CSPR — pay() does an internal transfer; 3 CSPR was OOG

async function main() {
  // 1. load device key
  const pem = readFileSync(DEVICE_PEM, "utf8");
  const key = PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
  const pub = key.publicKey;
  console.log("device pub:", pub.toHex());

  // 2. build contract-call Transaction (Casper 2.0)
  const args = Args.fromMap({
    payee: CLValue.newCLKey(Key.newKey(PAYEE)),
    amount: CLValue.newCLUInt512(AMOUNT),
  });
  const tx = new ContractCallBuilder()
    .from(pub)
    .byPackageHash(CONTRACT_PACKAGE)
    .entryPoint("pay")
    .runtimeArgs(args)
    .chainName(CHAIN)
    .payment(GAS)
    .build();

  // 3. sign with device key
  tx.sign(key);

  // 4. submit
  const rpc = new RpcClient(new HttpHandler(NODE));
  const put = await rpc.putTransaction(tx);
  const hash = put.transactionHash.toHex();
  console.log("submitted tx hash:", hash);
  console.log("explorer:", `https://testnet.cspr.live/transaction/${hash}`);

  // 5. poll for execution result
  const res = await rpc.waitForTransaction(tx, 180000);
  const exec = res.executionInfo?.executionResult;
  if (!exec) {
    console.log("NO EXECUTION RESULT YET");
    process.exit(1);
  }
  if (exec.errorMessage) {
    console.log("FAILURE:", exec.errorMessage, "cost:", exec.cost);
    process.exit(1);
  }
  console.log("SUCCESS — cost:", exec.cost, "consumed:", exec.consumed);
}

main().catch((e) => {
  console.error("SPIKE ERROR:", e);
  process.exit(1);
});
