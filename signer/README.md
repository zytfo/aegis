# Aegis — Pi Signer daemon

A hardware-style signer (TypeScript / Node 24) for the live **GuardedWallet** Casper
testnet contract. It holds the **device** Ed25519 key, enforces static policy, builds the
`pay` contract-call **itself**, signs only `pay`, and exposes one authenticated endpoint.

The brain (caller) supplies **only** `payee` + `amountMotes` + a monotonic `seq`. It never
supplies gas, bytes, entry point, or contract hash — those are fixed server-side.

## Layout
- `spike/pay-smoke.ts` — STEP 1 spike: build+sign+submit a live `pay` as the device key.
- `src/sdk.ts` — casper-js-sdk re-export shim (works around CJS named-export detection).
- `src/casper.ts` — spike-confirmed casper-js-sdk v5 wrapper (build/sign/submit/wait).
- `src/deploy.ts` — `buildAndSignPay` with HARDCODED gas (env `PAY_GAS_MOTES`, default 5 CSPR).
- `src/policy.ts` — static allowlist + per-tx cap (period_cap is on-chain only).
- `src/seq.ts` — disk-persisted monotonic replay guard (survives restart).
- `src/key.ts` — AES-256-GCM (scrypt) encrypted-at-rest Ed25519 store; imports the device PEM.
- `src/audit.ts` — append-only JSONL audit log.
- `src/server.ts` — `POST /sign-intent`, `GET /audit` (express).
- `src/main.ts` — wires it together and listens.

## casper-js-sdk
Version **5.0.12**. Key symbols used: `PrivateKey.fromPem(pem, KeyAlgorithm.ED25519)`,
`ContractCallBuilder().from(pub).byPackageHash(pkg).entryPoint("pay").runtimeArgs(Args.fromMap(...)).chainName(c).payment(gas).build()`,
`Args.fromMap`, `CLValue.newCLKey(Key.newKey("account-hash-.."))`, `CLValue.newCLUInt512(motes)`,
`tx.sign(privateKey)`, `new RpcClient(new HttpHandler(NODE+"/rpc")).putTransaction(tx)`,
`rpc.waitForTransaction(tx, ms)` → `executionInfo.executionResult.errorMessage`.

The `pay` entry point args: `payee: Key` (account-hash) and `amount: U512`.

## Gas
`pay()` consumes ~3.15 CSPR. 3 CSPR was **Out-of-gas**; 5 CSPR (default) and 8 CSPR succeed.
Minimum is 2.5 CSPR.

## Run
```bash
npm install
cp .env.example .env   # set SIGNER_TOKEN, KEY_PASS
npm run spike          # optional: prove a live pay end-to-end (~5 CSPR gas)
npx vitest run         # local module tests
npm start              # launch the daemon
```

## Channel auth — honest scope (by design)
The `Bearer <token>` on `/sign-intent` protects against **third parties** reaching the
endpoint. It does **NOT** protect against a compromised brain host: a brain that holds the
token can submit any policy-compliant intent. That is intentional. The signer's real defense
is the layered policy: off-chain static checks (allowlist + per-tx cap + replay `seq`) plus
**on-chain enforcement** (device-only `pay`, allowlist, per-tx and period caps) by the
GuardedWallet contract. Compromising the brain still cannot exfiltrate the device key or
exceed on-chain caps.
