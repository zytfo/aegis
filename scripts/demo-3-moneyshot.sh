#!/usr/bin/env bash
# ============================================================================
# DEMO BEAT 3 — THE MONEY-SHOT: a portable key vs a temporary, narrow channel.
#
#   (a) Prove the BRAIN HOST holds NO key material (grep the agent dir/env).
#   (b) Injected DRAIN attempt (compromised brain) -> Pi denies; nothing signed.
#   (c) CONTRAST with a software-signer (key in .env): copy key, reuse offsite,
#       native-transfer the whole balance. We EXPLAIN it always; we only PERFORM
#       a live drain if a funded THROWAWAY key is provided via env (never a real
#       Aegis key).
#   (d) Owner rotate_device_key — instantly neutralizes a compromised device,
#       WITHOUT any key having leaked.
# ============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_token
beat "BEAT 3 — Hardware moat: key vs temporary access"
cam "Wide shot of both machines. We are about to 'compromise' the brain host."

# (a) THE BRAIN HOST HAS NO KEY -------------------------------------------------
beat "(a) The brain host holds NO key"
cam "Run this grep live on the brain host."
say "Searching the agent source/env for any private key material…"
HITS="$(grep -RInE 'BEGIN (EC |OPENSSH |)PRIVATE KEY|secret_key|PRIVATE KEY' \
         "$AGENT_DIR/src" 2>/dev/null \
         | grep -vE 'software_signer\.ts|//|\*' || true)"
if [[ -z "$HITS" ]]; then
  ok "No usable private key in the brain (agent/src). The brain can only POST {payee, amount, seq}."
else
  say "References found (these are the ANTI-PATTERN contrast file / comments, not a live key):"
  printf '%s\n' "$HITS" | sed 's/^/     /'
fi
say "The device key lives ONLY on the Pi:  ${DEVICE_PEM_PATH:-<signer DEVICE_PEM_PATH>}  (encrypted at rest, never on the brain)."
pause

# (b) INJECTED DRAIN ATTEMPT ----------------------------------------------------
beat "(b) Compromised brain tries to DRAIN to an attacker"
cam "Point at the RED dashboard panel; a PayeeNotAllowed denial is about to appear."
say "Attacker account (non-allowlisted): $STRANGER_HASH"
say "Injected intent: pay the attacker the in-policy amount…"
sign_intent "$STRANGER_HASH" "$PAY_AMOUNT_MOTES" "$(seq_seed)"
printf "   signer: HTTP %s  %s\n" "$LAST_STATUS" "$LAST_BODY"
if [[ "$LAST_STATUS" == "403" ]]; then
  ok "Pi REFUSED before touching the device key. No transaction was built or signed."
  ok "Even a fully prompt-injected brain can only request {payee, amount, seq} — the moat held."
else
  bad "expected a 403 denial (PayeeNotAllowed) — investigate"
fi
pause

# (c) SOFTWARE-SIGNER CONTRAST --------------------------------------------------
beat "(c) CONTRAST — what a software-signer (key in .env) loses"
cam "Split screen: Aegis (Pi) on one side, the 'naive' software-signer on the other."
say "A naive agent holds the Ed25519 key itself. With shell on that host an attacker can:"
say "  1. COPY the key            (cat secret_key.pem / dump process.env) — portable, forever."
say "  2. SIGN FROM ANOTHER BOX   — wiping the host changes nothing; the key already left."
say "  3. NATIVE-TRANSFER the balance — no contract, no allowlist, no cap. Total drain."
say "Reference (deliberately NOT shipped in Aegis): agent/src/software_signer.ts"
say

if [[ -n "${THROWAWAY_KEY_PEM:-}" && -f "${THROWAWAY_KEY_PEM}" && -n "${THROWAWAY_DRAIN_TO:-}" ]]; then
  cam "We now PERFORM the drain with a FUNDED THROWAWAY key (never an Aegis key)."
  say "Throwaway key : $THROWAWAY_KEY_PEM"
  say "Draining to   : $THROWAWAY_DRAIN_TO"
  say "Running the software_signer native-transfer (the catastrophe Aegis prevents)…"
  if [[ -d "$AGENT_DIR/node_modules" ]]; then
    ( cd "$AGENT_DIR" && cat > /tmp/aegis_drain.mjs <<'JS'
import { readFileSync } from "node:fs";
import { nativeTransfer, rpcSubmit } from "./src/software_signer.ts";
const pem = readFileSync(process.env.THROWAWAY_KEY_PEM, "utf8");
const to = process.env.THROWAWAY_DRAIN_TO;
const amt = process.env.THROWAWAY_DRAIN_MOTES || "1000000000";
const node = process.env.NODE_ADDRESS ? process.env.NODE_ADDRESS.replace(/\/$/,"") + "/rpc" : undefined;
const { hash } = await nativeTransfer(pem, { to, amountMotes: amt }, rpcSubmit(node), { chainName: process.env.CHAIN_NAME });
console.log("DRAINED via copied key. tx:", hash);
JS
      THROWAWAY_KEY_PEM="$THROWAWAY_KEY_PEM" THROWAWAY_DRAIN_TO="$THROWAWAY_DRAIN_TO" \
      THROWAWAY_DRAIN_MOTES="${THROWAWAY_DRAIN_MOTES:-1000000000}" \
      NODE_ADDRESS="$NODE_ADDRESS" CHAIN_NAME="$CHAIN_NAME" \
      npx tsx /tmp/aegis_drain.mjs ) || bad "drain script failed (check throwaway key funding)"
    rm -f /tmp/aegis_drain.mjs
  else
    bad "agent deps not installed; cannot run the live drain demo."
  fi
  ok "That native-transfer is exactly what the Pi signer can NEVER emit — it only builds policy-bounded pay()."
else
  say "${c_dim}(No THROWAWAY_KEY_PEM + THROWAWAY_DRAIN_TO provided — explaining only, not draining.${c_reset}"
  say "${c_dim} To perform the live contrast, export THROWAWAY_KEY_PEM, THROWAWAY_DRAIN_TO, THROWAWAY_DRAIN_MOTES.)${c_reset}"
fi
pause

# (d) OWNER ROTATES THE DEVICE KEY ----------------------------------------------
beat "(d) Owner cuts off a compromised device — rotate_device_key"
cam "Show the owner machine running the contract call."
say "If a device IS ever compromised, the owner rotates it on-chain. The OLD device account"
say "can no longer call pay() — and NO Aegis key ever leaked, so there's nothing to reuse."
say
say "Owner-signed call (owner key required; run from the contract project):"
cat <<EOF
   export PATH="/opt/homebrew/opt/rustup/bin:\$HOME/.cargo/bin:\$PATH"
   cd guarded_wallet
   cargo run --bin guarded_wallet_cli -- contract GuardedWallet rotate_device_key \\
     --new_device <NEW_DEVICE_ACCOUNT_HASH> --gas 5000000000
EOF
say
say "After rotation, re-running BEAT 1 with the OLD device key reverts NotDevice (User error: 5)."
say "Reference recorded NotDevice revert:"
say "  ${EXPLORER}/112c7b29e7b8e9d5c9b442cbadb5b7a0312f9f536c7de6e9b3799ce0ff36525b"

beat "BEAT 3 complete — temporary, narrow, instantly-revocable access; never a portable key"
