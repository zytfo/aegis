<p align="center">
  <img src="assets/aegis.png" alt="Aegis logo" width="140">
</p>

# Aegis - a hardware key guard for autonomous AI payments

> [Casper Agentic Buildathon 2026](https://dorahacks.io/hackathon/casper-agentic-buildathon) · live on Casper testnet

## What it does

People are starting to let AI agents spend money on their behalf. The usual setup keeps the
agent's private key right next to the agent — so if the agent is tricked or hacked (for example
by a "prompt injection"), it can sign away everything. And whoever steals that key can keep
spending forever, from any machine.

Aegis splits the job in two:

- A **brain** (the AI agent) decides *what* to pay. It holds **no key** and can only say
  "pay this account this amount."
- A **Pi Signer** (a real Raspberry Pi) holds the key, checks the payment against your rules, and
  signs **only** an approved payment. The key never leaves the device.

So even a fully hacked brain can't steal: it has no key, and the Pi refuses anything outside your
rules. On top of that, a **GuardedWallet** smart contract on Casper keeps the money and enforces
the same rules a second time, on-chain.

## How it works

```mermaid
flowchart LR
    inj([prompt injection / hacked host]):::bad -.->|tries to corrupt| brain

    brain["🧠 Brain — AI agent<br/>untrusted · holds NO key<br/>can only ask: pay account, amount"]:::brain
    pi["🔒 Pi Signer — Raspberry Pi<br/>holds the key · checks rules<br/>signs ONLY an approved pay"]:::pi
    contract["📜 GuardedWallet — Casper testnet<br/>holds the money · enforces rules again"]:::chain
    dash["📊 Dashboard<br/>read-only view"]:::dash

    brain -->|"request: payee, amount, seq"| pi
    pi -->|"signed pay() transaction"| contract
    pi -.->|"tx result"| brain
    contract -.->|"free state reads"| dash
    pi -.->|"audit log"| dash

    classDef brain fill:#1f2937,stroke:#60a5fa,color:#e5e7eb;
    classDef pi fill:#064e3b,stroke:#34d399,color:#e5e7eb;
    classDef chain fill:#1e3a8a,stroke:#93c5fd,color:#e5e7eb;
    classDef dash fill:#3730a3,stroke:#a5b4fc,color:#e5e7eb;
    classDef bad fill:#7f1d1d,stroke:#f87171,color:#fee2e2;
```

The rules live in two places, each doing a different job:

- **On the Pi (fast, local):** the allowlist (who you may pay) and the per-payment limit. No
  network needed — the Pi just refuses to sign anything off-list or over the limit.
- **On-chain (the contract):** the same allowlist and limit, plus a spending cap per time window.
  This is the source of truth and the second line of defense.

A small design choice that matters: the **money lives in the contract**, while the **device account
the Pi signs with holds only a little gas** to pay fees. So even attacks on the device's gas can't
reach the treasury, and the Pi hardcodes the gas itself (the brain can't inflate it).

## Why this is different

A strong contract alone already caps *how much* can be lost per period — a software signer could do
that too. The point of using real hardware is what a software key can't give you:

| If the host running the agent is compromised… | Software key (in a file) | **Aegis** (key on the Pi) |
|---|---|---|
| Pay off-list / over the cap on-chain | blocked by contract | blocked by contract |
| Loss this period | ≤ cap | ≤ cap (same) |
| Copy the key and keep signing from another machine | yes, forever | **nothing to copy** |
| Drain the account's gas with the stolen key | yes | **key unreachable** |
| Reuse the key on other contracts/chains | yes | **signer only ever signs `pay`** |
| Cut off the attacker without the key having leaked | no — key already leaked | **rotate the device key** |

In short: with a good contract the *amount* at risk is the same either way. Aegis takes away the
attacker's ability to **walk off with a reusable key** — they get a narrow, temporary, instantly
revocable channel instead.

## Why a Raspberry Pi? (and why the design is signer-agnostic)

The security here doesn't come from the Pi being special hardware — it comes from putting the key in
a **separate trust domain** from the agent, where it can't be copied and can only ever sign a `pay`.
A Raspberry Pi is simply the cheapest, most tangible way to show that: a second physical box you can
hold, unplug, and prove the key isn't on the laptop.

So the **signer is deliberately swappable**. The exact same design works with a hardware security
module, a TEE / secure enclave (AWS Nitro, Intel SGX), a phone secure element, or a cloud signing
service — most of which are *stronger* than a bare Pi. In production you'd reach for one of those;
the Pi is the reference signer that makes the idea legible and demonstrable.

We're honest about the Pi's limit: it's a normal Raspberry Pi, not a secure chip, so someone with
physical root on it can read the key from memory (see below). What the design guarantees holds for
*any* signer that keeps the key off the agent host — the Pi just makes it something you can point a
camera at.

## What it protects (and what it doesn't)

**Protects — if the brain is hacked remotely:**
- the key never leaks (there's no copyable credential),
- nothing off your rules is ever signed,
- the signer only ever produces a `pay` (no arbitrary transaction),
- the most you can lose is the small gas float plus payments within your cap to people already on
  your allowlist,
- the owner can rotate the device key to cut access instantly — knowing nothing was signed with a
  stolen key.

**Doesn't protect (said plainly):**
- **Someone with physical root on the Pi itself.** Then the live key is in the Pi's memory. Aegis
  guards against *remote* compromise of the brain, not someone owning the box. The Pi is a normal
  Raspberry Pi, not a secure chip.
- **Spam within your own rules.** A hacked brain can keep paying an allowlisted account until the
  period cap is used up. That's the edge of the leash by design — you cut it with a key rotation.

## Live on Casper testnet

Everything below is real and recorded. Network `casper-test`, node
`https://node.testnet.casper.network`, explorer https://testnet.cspr.live.

GuardedWallet contract package:
[`hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3`](https://testnet.cspr.live/contract-package/1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3)

| What it shows | Transaction |
|---|---|
| **The whole point:** brain → Pi Signer → on-chain payment, fully autonomous | [`792192…6dde`](https://testnet.cspr.live/transaction/792192296fbf943f01ad8fe704ead59d9e0093268fd6e8bc3d5df14d85346dde) |
| Contract deployed | [`e8614a…a4a0`](https://testnet.cspr.live/transaction/e8614af94cfd73b4480ec8833f5b7212baece629b0d4f7ff8895990a0565a4a0) |
| Owner adds a payee to the allowlist | [`601956…eaf4`](https://testnet.cspr.live/transaction/601956fad1fea8d685f7f62ea03b4965300a3f6378457c674cb990ebe96eeaf4) |
| Owner trying to pay is rejected (only the device may pay) | [`112c7b…525b`](https://testnet.cspr.live/transaction/112c7b29e7b8e9d5c9b442cbadb5b7a0312f9f536c7de6e9b3799ce0ff36525b) |
| 30 CSPR deposited into the contract treasury | [`3bf0fb…0b56`](https://testnet.cspr.live/transaction/3bf0fb08c79a1da594a5c6a9de45c916458005436da5feddcf4bbe81b9250b56) |
| Device makes an allowed, in-limit payment | [`65356c…393b`](https://testnet.cspr.live/transaction/65356ccb100c36e74ea07952bb3c7130708ccc1f740aab386a29da8d9311393b) |
| Device paying a stranger is rejected (allowlist works) | [`e66c45…2a91`](https://testnet.cspr.live/transaction/e66c455f72f4203066034293da9b0e9259ff50e81d83fb62eba3c7acd2e62a91) |

Full deploy log and commands: [`guarded_wallet/scripts/owner.md`](guarded_wallet/scripts/owner.md).

## Repository layout

```
guarded_wallet/   GuardedWallet smart contract (Odra/Rust)
signer/           Pi Signer daemon (TypeScript) - holds the key, checks rules, signs payments
agent/            The brain (TypeScript) - autonomous payer + the "what NOT to do" contrast
dashboard/        Next.js read-only dashboard (live state + audit log)
scripts/          demo scripts
shared/           shared types
```

Secrets (`SIGNER_TOKEN`, `KEY_PASS`, key files in `keys/`) are never committed — copy each
component's `.env.example` and fill in your own.

## Run it

Requires Node v24. The contract is **already deployed on testnet**, so you can run the dashboard and
read live state without deploying anything.

**1. Contract** (`guarded_wallet/`) — only if you want to test/build/redeploy:
```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
cargo odra test
cargo odra build
```

**2. Pi Signer** (`signer/`) — runs on the Raspberry Pi:
```bash
cd signer && npm install
cp .env.example .env
npm start
```

**3. Brain** (`agent/`) — runs on your laptop:
```bash
cd agent && npm install
SIGNER_URL=http://<pi-ip>:8787 SIGNER_TOKEN=<same-token> npm start
```

**4. Dashboard** (`dashboard/`) — runs anywhere:
```bash
cd dashboard && npm install
cp .env.example .env
npm run dev
```

**5. Demo** (`scripts/`) — signer running and `SIGNER_TOKEN` exported:
```bash
./scripts/demo-1-normal.sh        # an autonomous, in-policy payment lands on-chain
./scripts/demo-2-policy-block.sh  # over-limit and not-allowlisted payments are refused
./scripts/demo-3-moneyshot.sh     # the brain has no key; an injected drain is blocked
```

## Built with the Casper AI Toolkit

- **Odra 2.7.2** — the GuardedWallet contract (Rust → WASM), with tests and a live testnet deploy.
- **casper-js-sdk 5.0.12** — the Pi Signer builds, signs (key stays on the device), and submits the
  `pay` transaction on Casper 2.0.
- **Public Casper node** — the dashboard's free, read-only state queries.

## Honest notes

- **Native CSPR is the real, live rail.** x402 on Casper turns out to be a fungible-token (CEP-18)
  flow settled by a separate facilitator, not a native-CSPR payment through our contract, and the
  test token isn't available on testnet — so x402 is a secondary path we sketch in code but don't
  run live. The contract does not govern that path.
- **`agent/src/software_signer.ts` is the deliberate "bad example"** used only to contrast against
  Aegis in the demo — Aegis itself never uses it.
- Owner setup (deploy, add payee, set policy) is done from the command line.
