# Fund the agent — Connect Wallet + Deposit (human test steps)

The "💰 Fund the agent (connect wallet)" panel lets a visitor connect the **Casper
Wallet** browser extension and deposit their own test CSPR into the live
`GuardedWallet` contract treasury on Casper testnet (`casper-test`).

All of this is client-side. The signing step happens in the extension popup and is
human-driven — it cannot be automated, so it must be tested by clicking.

## Live facts

- Package hash: `hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3`
- Node: `https://node.testnet.casper.network/rpc`
- Chain: `casper-test`
- Contract call: payable `deposit` entry point, invoked via Odra's
  `proxy_caller_with_return.wasm` (served from `/public/proxy_caller_with_return.wasm`).
- Deposit gas: 15 CSPR (5 was Out-of-Gas). Native fallback gas: 0.1 CSPR.

## One-time setup

1. Install the **Casper Wallet** extension (Chrome Web Store) and create / import an
   account.
2. Fund that testnet account from the faucet (https://testnet.cspr.live/tools/faucet).
   You need: **the deposit amount you want to send + at least 15 CSPR for gas.**
3. Run the dashboard (`npm run dev`) and open it in the same browser profile.

## Deposit flow

1. In the panel, click **Connect Casper Wallet** → approve in the popup. The panel
   shows your truncated active public key.
2. Enter an amount (default **5 CSPR**).
3. Click **Deposit to treasury**.
4. Approve/sign in the wallet popup. The status line walks through:
   `building → awaiting signature → submitted <tx link> → confirmed`.
5. Watch the **Treasury (contract purse)** value: it polls `/api/state` every 5s and
   should rise after the tx confirms.

## The two things to verify on the first click

1. **package_hash encoding is accepted.** The `package_hash` runtime arg is sent as a
   `CLKey` (a Hash key) by default. If the node rejects the transaction with a
   parse/type error on `package_hash`, flip the encoding:
   - In `app/FundAgentPanel.tsx`, change
     `const PACKAGE_HASH_ENCODING: PackageHashEncoding = "key";` → `"bytes"`.
   - `"bytes"` sends the raw 32-byte package hash as a `ByteArray` instead.
   - The two encodings are implemented in `lib/deposit.ts` (`packageHashArg`). This is
     the single most likely thing to need tuning; it's a one-line change.
2. **Treasury balance rises.** After `confirmed`, the contract purse balance shown in
   the panel (and the Policy & Identity panel) should increase by your deposit amount
   on the next poll. If it doesn't, check the tx on the explorer
   (`https://testnet.cspr.live/transaction/<hash>`) for an execution error — the most
   likely cause is the package_hash encoding above.

## Fallback: top up gas float

If the proxy-caller deposit needs tuning and you just need the demo to move money,
tick **"fallback: top up gas float"**. This switches to a plain native CSPR transfer
(`NativeTransferBuilder`) to a target account (defaults to the device key shown), which
has zero proxy-caller risk. Enter/confirm the target public key hex and click **Top up
gas float**.

## Files

- `lib/deposit.ts` — tx builders (`depositTx`, `nativeTopUp`), `signAndSubmit`
  round-trip, wallet provider access. Client-side only.
- `app/FundAgentPanel.tsx` — the UI panel (client component).
- `app/page.tsx` — renders `<FundAgentPanel>` in the grid.
- `public/proxy_caller_with_return.wasm` — the Odra proxy session wasm (~184 KB),
  copied from the cargo cache so the build doesn't depend on it.
