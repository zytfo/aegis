# Aegis — GuardedWallet Casper Testnet Deploy & Exercise Log

Recorded 2026-06-09. Network: **Casper testnet (Condor / Casper 2.0)**.
Tooling: cargo-odra 0.1.7, Odra 2.7.2, casper-client 5.0.1, binaryen 130 (wasm-opt).
Project: `/Users/zytfo/Desktop/Projects/hackathon/guarded_wallet/`

## Network / endpoint

- Node address: `https://node.testnet.casper.network`
- Events URL:   `https://node.testnet.casper.network/events`
- Chain name:   `casper-test`
- Explorer:     https://testnet.cspr.live

## Accounts

| Role   | Public key (hex)                                                     | Account hash |
|--------|----------------------------------------------------------------------|--------------|
| Owner  | `01ad6aba27155a6744a4105401a5dd3cbc8624f127e0e7b9587054ed2f9baeba95` | `account-hash-490b0886bc1778c13be7cb47c38abbeae187c9d6f30756992abe98ca55a44d0e` |
| Device | `011ac2c8321b60f261878d20804a8bd79dfc64f9e638adfa975e3082bfd87413e6` | `account-hash-cea489622d8b613397d65a5c4ecda7c4157491247458387e6d6da86a3a74aae7` |
| Payee  | `01fa6d5db331b47d77b71460963ae0b68d20e894ffa17f32d68e011dbff9bed5bc` | `account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a` |

Secret keys:
- Owner:  `/Users/zytfo/Desktop/Projects/hackathon/keys/owner/secret_key.pem`
- Device: `/Users/zytfo/Desktop/Projects/hackathon/keys/device/secret_key.pem`
- Payee:  `/Users/zytfo/Desktop/Projects/hackathon/keys/payee/secret_key.pem` (receive-only, never funded)

Derive an account hash from a pubkey hex:
```bash
casper-client account-address --public-key <HEX>
```

### Funding confirmed (faucet landed)

Both owner and device held **5000 CSPR** (`5000000000000` motes) before deploy:
```bash
NODE=https://node.testnet.casper.network
casper-client query-balance --node-address $NODE \
  --purse-identifier account-hash-490b0886bc1778c13be7cb47c38abbeae187c9d6f30756992abe98ca55a44d0e
casper-client query-balance --node-address $NODE \
  --purse-identifier account-hash-cea489622d8b613397d65a5c4ecda7c4157491247458387e6d6da86a3a74aae7
# -> "balance": "5000000000000"
```

## Contract

- Package hash: **`hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3`**
- Recorded in `resources/casper-test-contracts.toml`

### Init args (deployed)

| arg        | value         | meaning            |
|------------|---------------|--------------------|
| owner      | owner hash    | owner account      |
| device     | device hash   | device account     |
| per_tx_max | `5000000000`  | 5 CSPR per tx      |
| period_cap | `20000000000` | 20 CSPR per period |
| period_len | `3600000`     | 1 hour (ms)        |

On-chain `get_state` after deploy+deposit confirmed all of the above plus `balance=30000000000`, `spent_in_period=1000000000` (after the pay).

## Build (WASM)

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
# wasm32 target must be present on the toolchain pinned by rust-toolchain (nightly-2026-01-01):
rustup target add wasm32-unknown-unknown --toolchain nightly-2026-01-01
# wasm-opt required for the optimize step:
brew install binaryen
cargo odra build
```
Artifact: `wasm/GuardedWallet.wasm` (optimized ~289 KB).
The **proxy_caller** wasm is NOT emitted into `wasm/` — Odra's livenet backend ships it inside the
crate: `~/.cargo/registry/src/.../odra-casper-rpc-client-2.7.2/resources/proxy_caller_with_return.wasm`,
and uses it automatically for payable / non-direct calls (see deposit below).

## Odra 2.7.2 livenet deploy procedure (odra-cli flavour)

This project uses the **`odra-cli`** crate (`OdraCli` builder in `bin/cli.rs`), not the classic
`--features livenet` binary. The CLI reads the standard `ODRA_CASPER_LIVENET_*` env vars from a
`.env` file at the project root.

`.env` (created at project root):
```
ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.casper.network
ODRA_CASPER_LIVENET_EVENTS_URL=https://node.testnet.casper.network/events
ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test
ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/Users/zytfo/Desktop/Projects/hackathon/keys/owner/secret_key.pem
ODRA_CASPER_LIVENET_KEY_1=/Users/zytfo/Desktop/Projects/hackathon/keys/device/secret_key.pem
```
- `ODRA_CASPER_LIVENET_SECRET_KEY_PATH` = **account 0** (the deployer / `env.get_account(0)` = owner, pays gas).
- `ODRA_CASPER_LIVENET_KEY_1` = **account 1** (`env.get_account(1)` = device). Used by the DeployScript
  for the `device` init arg.

CLI surface:
```bash
cargo run --bin guarded_wallet_cli -- --help
cargo run --bin guarded_wallet_cli -- whoami          # prints current caller (account 0)
cargo run --bin guarded_wallet_cli -- deploy          # runs DeployScript, writes resources/casper-test-contracts.toml
cargo run --bin guarded_wallet_cli -- contract GuardedWallet <entrypoint> [--arg ...] [--gas <motes>] [--attached_value <motes>] [-p]
cargo run --bin guarded_wallet_cli -- print-events GuardedWallet -n 10
```

Deploy command actually run (signed by owner):
```bash
cargo run --bin guarded_wallet_cli -- deploy
# -> tx e8614af9... ; package hash-1359b301...
```

### GOTCHAS / surprises
- **Minimum gas is 2.5 CSPR** (`2500000000` motes); the CLI rejects anything lower client-side.
- `--gas` / `--attached_value` are given in **motes** here (NOT CSPR), despite the help text saying `<CSPR>`.
  Values used: gas `5000000000` (5 CSPR) for simple state calls; mutating/proxy calls need more.
- The CLI has **NO `--caller` flag**. The caller is always account 0
  (`ODRA_CASPER_LIVENET_SECRET_KEY_PATH`). To sign as the **device**, override that env var per command:
  ```bash
  ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/Users/zytfo/Desktop/Projects/hackathon/keys/device/secret_key.pem \
    cargo run --bin guarded_wallet_cli -- contract GuardedWallet pay ...
  ```
- The CLI **panics at startup** if `ODRA_CASPER_LIVENET_NODE_ADDRESS` is unset (even for `--help`).

## How `deposit` / proxy_caller works on livenet

`deposit` is `#[odra(payable)]`. A payable / value-attached call cannot be a direct contract call on
Casper, so Odra runs a **session** that executes `proxy_caller_with_return.wasm`: the session takes the
attached motes from the caller's main purse, forwards them into the contract entrypoint, and the contract
receives them via `env().attached_value()`. The CLI logs `... entrypoint "deposit" through proxy`.
- First deposit also **creates the contract main purse** (`__contract_main_purse` named key). Before any
  deposit, `balance` / `get_state` revert with `Contract missing __contract_main_purse named key` — this is
  expected, not a bug.
- The proxy session is **gas-hungry**: 5 CSPR gas ran **out of gas**; **15 CSPR** succeeded. Budget
  ~15 CSPR gas for the first payable deposit.

Command run (signed by owner):
```bash
cargo run --bin guarded_wallet_cli -- contract GuardedWallet deposit \
  --attached_value 30000000000 --gas 15000000000 -p
# -> Deposited{from: owner, amount: 30000000000}; balance() == 30000000000
```

## caller() LIVE confirmation (the load-bearing spike)  ✅

On LIVE testnet the two-account auth model behaved EXACTLY as in the 22 OdraVM tests:

| Scenario                                   | Signer  | Result on testnet            | OdraVM equiv test          |
|--------------------------------------------|---------|------------------------------|----------------------------|
| `add_payee` (owner-only)                   | owner   | SUCCESS                      | owner_adds_payee...        |
| `pay` (device-only) called by owner        | owner   | REVERT `User error: 5` NotDevice | non_device_cannot_pay  |
| `pay` in-policy to allowlisted payee       | device  | SUCCESS, `Paid` event        | device_pays_within_limits  |
| `pay` to non-allowlisted account           | device  | REVERT `User error: 3` PayeeNotAllowed | rejects_non_allowlisted |

Error codes (src/errors.rs): `PayeeNotAllowed=3`, `NotOwner=4`, `NotDevice=5`. On-chain reverts surface as
`User error: <n>`.

## All transactions

| Step               | Signer | Tx hash | cspr.live |
|--------------------|--------|---------|-----------|
| Deploy             | owner  | `e8614af94cfd73b4480ec8833f5b7212baece629b0d4f7ff8895990a0565a4a0` | https://testnet.cspr.live/transaction/e8614af94cfd73b4480ec8833f5b7212baece629b0d4f7ff8895990a0565a4a0 |
| add_payee (success)| owner  | `601956fad1fea8d685f7f62ea03b4965300a3f6378457c674cb990ebe96eeaf4` | https://testnet.cspr.live/transaction/601956fad1fea8d685f7f62ea03b4965300a3f6378457c674cb990ebe96eeaf4 |
| owner pay (REVERT NotDevice) | owner | `112c7b29e7b8e9d5c9b442cbadb5b7a0312f9f536c7de6e9b3799ce0ff36525b` | https://testnet.cspr.live/transaction/112c7b29e7b8e9d5c9b442cbadb5b7a0312f9f536c7de6e9b3799ce0ff36525b |
| deposit (1st try, OOG @5 CSPR gas) | owner | `4ea949169170bb295003a5fff22acd307be76e3bf29913b4663906b49bd0d9c1` | https://testnet.cspr.live/transaction/4ea949169170bb295003a5fff22acd307be76e3bf29913b4663906b49bd0d9c1 |
| deposit 30 CSPR (success) | owner | `3bf0fb08c79a1da594a5c6a9de45c916458005436da5feddcf4bbe81b9250b56` | https://testnet.cspr.live/transaction/3bf0fb08c79a1da594a5c6a9de45c916458005436da5feddcf4bbe81b9250b56 |
| pay 1 CSPR (success, Paid) | device | `65356ccb100c36e74ea07952bb3c7130708ccc1f740aab386a29da8d9311393b` | https://testnet.cspr.live/transaction/65356ccb100c36e74ea07952bb3c7130708ccc1f740aab386a29da8d9311393b |
| pay stranger (REVERT PayeeNotAllowed) | device | `e66c455f72f4203066034293da9b0e9259ff50e81d83fb62eba3c7acd2e62a91` | https://testnet.cspr.live/transaction/e66c455f72f4203066034293da9b0e9259ff50e81d83fb62eba3c7acd2e62a91 |

Post-exercise on-chain state: contract `balance = 30000000000` (30 CSPR), `spent_in_period = 1000000000`
(1 CSPR), payee purse `balance = 1000000000` (1 CSPR received).

## Reproducible read-only checks

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
cd /Users/zytfo/Desktop/Projects/hackathon/guarded_wallet
cargo run --bin guarded_wallet_cli -- contract GuardedWallet get_state
cargo run --bin guarded_wallet_cli -- contract GuardedWallet balance
cargo run --bin guarded_wallet_cli -- contract GuardedWallet list_payees
cargo run --bin guarded_wallet_cli -- contract GuardedWallet is_allowed \
  --payee account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a
```
