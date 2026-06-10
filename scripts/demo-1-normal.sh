#!/usr/bin/env bash
# ============================================================================
# DEMO BEAT 1 — Normal operation (the autonomous core rail).
#
# The brain (untrusted) decides a subscription is due and emits an in-policy
# intent to the Pi Signer. The Pi builds + signs a real `pay` TransactionV1 with
# the device key (which never leaves it) and submits it to Casper testnet.
# Result: a confirmed on-chain native-CSPR payment to an ALLOWLISTED payee,
# under the per-tx and period caps.
#
# Prereqs: signer running (cd signer && npm start), SIGNER_TOKEN exported,
#          device gas float funded. NO new owner setup needed — allowlist/policy
#          are already on-chain.
# ============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_token
beat "BEAT 1 — Autonomous in-policy payment (native CSPR)"
cam "Show BOTH machines: the brain host (left) and the Raspberry Pi (right). The key lives ONLY on the Pi."
require_signer

say "Contract : $CONTRACT_PACKAGE_HASH"
say "Payee    : $PAYEE_HASH  ${c_green}(allowlisted)${c_reset}"
say "Amount   : $PAY_AMOUNT_MOTES motes  ($(awk "BEGIN{print $PAY_AMOUNT_MOTES/1e9}") CSPR)  ≤ per-tx max $PER_TX_MAX_MOTES"
pause

cam "Point at the dashboard 'Payment History' panel — a new green row will appear."
beat "Brain → intent → Pi Signer → chain"

# Drive the real autonomous brain if it's available; otherwise POST the same
# wire-format intent the brain would send. Either way the Pi does the signing.
if [[ -d "$AGENT_DIR/node_modules" ]]; then
  say "Running the autonomous brain (agent/src/main.ts)…"
  ( cd "$AGENT_DIR" \
      && SIGNER_URL="$SIGNER_URL" SIGNER_TOKEN="$SIGNER_TOKEN" \
         PAYEE_HASH="$PAYEE_HASH" PAY_AMOUNT_MOTES="$PAY_AMOUNT_MOTES" \
         npm start --silent ) || true
else
  say "Agent deps not installed; POSTing the brain's exact intent directly…"
  sign_intent "$PAYEE_HASH" "$PAY_AMOUNT_MOTES" "$(seq_seed)"
  printf "   signer responded HTTP %s\n   %s\n" "$LAST_STATUS" "$LAST_BODY"
  HASH="$(printf '%s' "$LAST_BODY" | sed -n 's/.*"hash":"\([0-9a-f]*\)".*/\1/p')"
  if [[ "$LAST_STATUS" == "200" && -n "$HASH" ]]; then
    ok "AUTONOMOUS PAY CONFIRMED ON-CHAIN"
    printf "   tx: %s/%s\n" "$EXPLORER" "$HASH"
  else
    bad "no confirmed success (status $LAST_STATUS) — check device gas float / period cap"
  fi
fi

cam "Open the tx on cspr.live to show it is real and final. This whole payment happened with NO human and NO key on the brain."
beat "BEAT 1 complete"
