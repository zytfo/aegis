# Aegis — a hardware-rooted payment guardian for autonomous AI agents

> Casper Agentic Buildathon 2026 · Casper Innovation Track · **live on Casper testnet**

**What & why.** Autonomous AI agents are being handed money, but the standard design puts the
agent's private key in a `.env` next to the agent — so a prompt-injected or compromised brain can
sign *anything*, and anyone who reads that key can sign **forever, from anywhere, even after you
wipe the host**. Aegis breaks the "brain = key" coupling. The decision still comes from an
untrusted AI **brain**, but the signature comes from a **physical Raspberry Pi (the Pi Signer)**
that holds the device key, never releases it, and will assemble and sign **only** a policy-checked
`pay`. On-chain, an Odra `GuardedWallet` contract keeps the treasury in a contract purse and
enforces a two-account model (owner vs. device), an allowlist, a per-transaction max, and a period
spending cap. Native CSPR is the core rail; x402 is a secondary, gated rail (see below).

---

## Architecture

```
                          (untrusted)                         (hardware enforcer + signer)
  external text ──► ┌──────────────┐   intent {payee,amount,seq}   ┌───────────────────────┐
  prompt-injection  │   BRAIN      │ ─────────  HTTPS  ──────────► │   PI SIGNER (Raspberry │
  ───────────────►  │ (AI agent,   │   Bearer token / mTLS         │   Pi, headless)       │
                    │  TypeScript) │                               │                       │
                    │  HOLDS NO KEY│ ◄──── {hash, status} ──────── │  • device Ed25519 key │
                    └──────────────┘                               │    (encrypted at rest,│
                          │                                        │     never leaves Pi)  │
                          │ can only express                       │  • STATIC policy:     │
                          │ {payee, amount, seq}                   │    allowlist + per-tx │
                          │                                        │  • builds deploy from │
                          │                                        │    primitive fields   │
                          │                                        │  • HARDCODES gas/     │
                          │                                        │    entrypoint         │
                          │                                        │  • signs ONLY pay()   │
                          │                                        │  • monotonic seq      │
                          │                                        │  • append-only audit  │
                          │                                        └───────────┬───────────┘
                          │                                       signed pay() TransactionV1
                          ▼                                                    ▼
                    ┌───────────────────────────────────────────────────────────────────┐
                    │           GuardedWallet  (Odra/Rust → WASM)  ·  Casper testnet      │
                    │  treasury in CONTRACT PURSE   owner acct (policy)  device acct (pay)│
                    │  STATEFUL policy: allowlist + per_tx_max + period_cap + spent       │
                    │  pay() = device-only · add_payee/set_policy/rotate_device_key=owner │
                    └───────────────────────────────────────────────────────────────────┘
                          ▲                                                    ▲
                          │  free read-only global-state queries (no gas)      │
                    ┌─────┴───────────────┐                                    │
                    │  DASHBOARD (Next.js)│ ◄─── GET /audit (Pi Signer log) ───┘
                    │  policy · allowlist │
                    │  history · denials  │
                    └─────────────────────┘
```

Two complementary policy layers, by responsibility (not duplication):

- **Layer 1 — on-chain (`GuardedWallet`):** allowlist + per-tx max + **stateful** period cap.
  Bounds the *damage per period*. (This bound is the same for a hardware or a software signer —
  so it is not, by itself, the moat.)
- **Layer 2 — hardware (Pi):** static allowlist + per-tx checks with **no RPC dependency**, the
  device key that **cannot be exfiltrated**, a signer that **emits only `pay`**, and **clean
  revocation**. This is the moat (see the table below).

---

## The honest invariant (threat model)

**Gas/float vs. treasury separation (the key design choice).** The treasury lives in the
`GuardedWallet` **contract purse**. The **device account** (the one the Pi signs with) holds only a
small **gas float** to pay `pay()` fees. Attacks on the device account's gas therefore cannot reach
the treasury. The Pi **hardcodes** the payment/gas amount (it never reads gas from the intent), so
the brain cannot gas-grief.

**Invariant — under *remote* compromise of the brain:**

- **No portable key leaks.** There is no transferable credential to copy.
- **Off-policy withdrawal = 0.** Off-allowlist / over-cap requests are refused.
- **Only `pay` is ever signed.** No arbitrary deploy can be produced by the signer.
- **Damage ≤ cap.** The treasury can be touched only within `per_tx_max` / `period_cap` to
  **allowlisted** payees.
- **Clean revocation.** The owner's `rotate_device_key` (or token revocation) cuts off access
  **without any key having leaked** — so you also know nothing was signed with a stolen key.

Maximum loss from a remote brain compromise = the small gas float + payments within the cap to
already-allowlisted payees.

**Explicitly out of scope (stated honestly):**

- **Root / physical compromise of the Pi itself.** With live root, the decrypted key is reachable
  in RAM — a different, heavier threat class. Aegis protects against the *remote* brain-compromise
  vector (mass prompt-injection / RCE), not Pi root. The Pi is **not** a TEE/TPM; at-rest
  encryption only covers theft of a powered-off device.
- **Bounded DoS within the leash.** A compromised brain (or token thief) can spam *policy-valid*
  payments to an allowlisted payee until the `period_cap` is exhausted — by design, that is the
  edge of the leash. Mitigated by fast token revocation / device-key rotation.

---

## Aegis vs. a software-signer (same on-chain policy)

| Scenario | Software-signer (key on the brain host) | **Aegis** (hardware-signer) |
|---|---|---|
| Off-policy withdrawal on-chain | ✅ blocked by contract | ✅ blocked by contract |
| Damage per period under host compromise | ≤ cap | ≤ cap (same) |
| Copy the key and sign **from another machine, after wiping the host** | ❌ can, indefinitely | ✅ nothing to copy |
| Native-transfer the gas float with the stolen key | ❌ can | ✅ key unreachable |
| Reuse the key on another contract / chain | ❌ can (full account rights) | ✅ signer emits only `pay` |
| Revoke access without the key having leaked | ❌ key already leaked | ✅ rotate / revoke token |

**Message:** with a strong contract, the *per-period damage bound is identical*. Aegis removes the
**portability and reusability** of a compromised access — the attacker gets a temporary, narrow,
instantly-revocable channel instead of a forever-key.

---

## Live testnet artifacts (real, recorded)

- **Chain:** `casper-test` · **Node:** `https://node.testnet.casper.network` · **Explorer:**
  https://testnet.cspr.live
- **GuardedWallet contract package:**
  [`hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3`](https://testnet.cspr.live/contract-package/1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3)

| What it proves | Tx | Link |
|---|---|---|
| **Autonomous end-to-end** — brain → Pi Signer → chain `pay()` | `7921922…6dde` | https://testnet.cspr.live/transaction/792192296fbf943f01ad8fe704ead59d9e0093268fd6e8bc3d5df14d85346dde |
| Contract **deploy** (signed by owner) | `e8614af…a4a0` | https://testnet.cspr.live/transaction/e8614af94cfd73b4480ec8833f5b7212baece629b0d4f7ff8895990a0565a4a0 |
| **add_payee** populates the allowlist (owner-only) | `601956f…eaf4` | https://testnet.cspr.live/transaction/601956fad1fea8d685f7f62ea03b4965300a3f6378457c674cb990ebe96eeaf4 |
| Owner calling `pay` **reverts NotDevice** (two-account auth works) | `112c7b2…525b` | https://testnet.cspr.live/transaction/112c7b29e7b8e9d5c9b442cbadb5b7a0312f9f536c7de6e9b3799ce0ff36525b |
| **deposit** 30 CSPR into the contract purse (via proxy_caller) | `3bf0fb0…0b56` | https://testnet.cspr.live/transaction/3bf0fb08c79a1da594a5c6a9de45c916458005436da5feddcf4bbe81b9250b56 |
| Device `pay` **succeeds** (in-policy, `Paid` event) | `65356cc…393b` | https://testnet.cspr.live/transaction/65356ccb100c36e74ea07952bb3c7130708ccc1f740aab386a29da8d9311393b |
| Device paying a stranger **reverts PayeeNotAllowed** (allowlist works) | `e66c455…2a91` | https://testnet.cspr.live/transaction/e66c455f72f4203066034293da9b0e9259ff50e81d83fb62eba3c7acd2e62a91 |

Full deploy/exercise log: [`guarded_wallet/scripts/owner.md`](guarded_wallet/scripts/owner.md).

---

## Repository layout

```
guarded_wallet/   Odra/Rust GuardedWallet contract (+ odra-cli deploy tool, 22 OdraVM tests)
signer/           Pi Signer daemon (TypeScript/Node) — device key, static policy, /sign-intent, /audit
agent/            The brain (TypeScript) — autonomous payer; also the software_signer ANTI-PATTERN contrast
dashboard/        Next.js read-only dashboard (live state + audit)
scripts/          5-beat demo driver scripts
shared/           shared intent/policy types
keys/             local testnet keypairs (gitignored; NOT in this repo)
docs/             design spec
```

---

## Setup & run

> All real secrets (`SIGNER_TOKEN`, `KEY_PASS`, key PEMs) live in `.env` files and `keys/`, which
> are **not** committed. Copy the `.env.example` in each component and fill in your own values.
> Node v24.

### 1. Contract (`guarded_wallet/`) — cargo-odra
```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
rustup target add wasm32-unknown-unknown --toolchain nightly-2026-01-01
cargo odra test            # 22 OdraVM tests (auth, allowlist, per-tx, period cap, rotate, ...)
cargo odra build           # -> wasm/GuardedWallet.wasm
# Deploy + owner setup (needs funded owner/device keys + a project-root .env):
cargo run --bin guarded_wallet_cli -- deploy
cargo run --bin guarded_wallet_cli -- contract GuardedWallet add_payee --payee <ACCT> --gas 5000000000
cargo run --bin guarded_wallet_cli -- contract GuardedWallet deposit --attached_value <MOTES> --gas 15000000000 -p
```
The contract is **already deployed and exercised** on testnet (see artifacts above) — you do not
need to redeploy to run the dashboard or read state.

### 2. Pi Signer (`signer/`)
```bash
cd signer
npm install
cp .env.example .env        # set SIGNER_TOKEN, KEY_PASS (daemon refuses dev-defaults)
npx vitest run              # module tests
npm start                   # listens on :8787 — holds the device key, exposes /sign-intent + /audit
```

### 3. Brain / agent (`agent/`)
```bash
cd agent
npm install
SIGNER_URL=http://127.0.0.1:8787 SIGNER_TOKEN=<same-token> npm start   # one autonomous run
npx vitest run             # includes the injected-drain and software-signer contrast tests
```

### 4. Dashboard (`dashboard/`)
```bash
cd dashboard
npm install
cp .env.example .env        # CASPER_NODE_ADDRESS, CONTRACT_PACKAGE_HASH, SIGNER_URL
npm run dev                 # http://localhost:3000  (reads are FREE — no gas, no keys)
# or: npm run build && npm run start
```
`GET /api/state` returns the live `GuardedWallet` state — `{ balance, perTxMax, periodCap,
spentInPeriod, periodStart, periodLen, owner, device, payees }` — read directly from the node.
`GET /api/audit` proxies the Pi Signer's audit log (degrades to `[]` if the signer is offline).

### 5. Demo (`scripts/`)
With the signer running and `SIGNER_TOKEN` exported:
```bash
./scripts/demo-1-normal.sh        # autonomous in-policy native-CSPR pay -> on-chain tx
./scripts/demo-2-policy-block.sh  # 403 OverPerTx, 403 PayeeNotAllowed, + on-chain period-cap revert path
./scripts/demo-3-moneyshot.sh     # brain has no key; injected drain denied; software-signer contrast; rotate_device_key
```
The scripts print camera cues and never hardcode secrets (they read `signer/.env` and public facts
from `owner.md`). The live key-copy/native-transfer drain in beat 3 runs **only** if you provide a
funded throwaway key via `THROWAWAY_KEY_PEM` / `THROWAWAY_DRAIN_TO`.

---

## How the dashboard reads Odra state (no transaction, no gas)

`dashboard/lib/casper.ts` resolves the contract package → active Contract entity, then reads each
Odra `Var`/`Mapping` field out of the contract's single `state` **dictionary**. Odra's dictionary
item key for a top-level field at module index *N* is `hex(blake2b256( u32_be(N) ))` (fields are
indexed from 1). The contract's main-purse balance is read with `query_balance`. All of this is
free global-state JSON-RPC — no speculative-exec, no funds, no keys.

---

## Casper AI Toolkit components used

- **Odra (2.7.2)** — the `GuardedWallet` contract (Rust → WASM), `proxy_caller` for the payable
  `deposit`, 22 OdraVM tests, and live testnet deploy via the odra-cli.
- **casper-js-sdk (v5.0.12)** — the Pi Signer builds, signs (Ed25519, key on-device), and submits
  the `pay` contract-call **TransactionV1** (Casper 2.0 / Condor); also the software-signer contrast.
- **CSPR.cloud / public node** — the dashboard's free read-only global-state queries for live policy,
  balance, allowlist, and spend.
- **x402** — *secondary rail.* Implemented as a flow (`agent/src/x402.ts`) only; see "what's mocked".

---

## What's mocked / secondary (honest)

- **x402 is secondary and gated.** On Casper, x402 is **not** native CSPR — it is a **CEP-18
  (fungible-token)** transfer authorized off-chain (EIP-712-style `transfer_with_authorization`) and
  settled by a facilitator. The required CEP-18 **test token is not obtainable on `casper-test`**, so
  a live x402 round-trip cannot be exercised. We implement the flow and unit-test it against a mocked
  fetch + mocked authorization; the on-chain `GuardedWallet` does **not** gate this rail (different
  asset, settled by the facilitator) — for x402 the policy is hardware-only. **Native CSPR via the Pi
  Signer is the core, fully-live rail.**
- **The x402 inbound "beacon" / earning demo** (design §6) is a stretch goal and is **not** built.
- **`software_signer.ts` is the deliberate ANTI-PATTERN** used for the moat contrast — it is never
  used by Aegis itself.
- **Owner setup is CLI-driven** (`casper-client` / odra-cli); CSPR.click wallet integration is out
  of scope.

---

## Demo video

_📹 Placeholder — add the recorded 5-beat walkthrough link here._

---

## License

ISC (see component `package.json` files).
