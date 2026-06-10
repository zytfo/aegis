#!/usr/bin/env bash
# ============================================================================
# DEMO BEAT 2 — The policy leash holds (two layers).
#
#   (a) Over per-tx max      -> Pi Signer denies STATICALLY: HTTP 403 OverPerTx
#   (b) Non-allowlisted payee -> Pi Signer denies STATICALLY: HTTP 403 PayeeNotAllowed
#   (c) Over period cap       -> Pi signs, but the CONTRACT reverts on-chain
#                                (Layer 1, stateful). Shown as an on-chain
#                                failed deploy / revert path.
#
# (a) and (b) never touch the device key — the Pi refuses before signing.
# (c) is the on-chain backstop the Pi deliberately does NOT duplicate.
# ============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_token
beat "BEAT 2 — Blocked by policy (Pi static checks + on-chain cap)"
cam "Put the dashboard's RED 'Blocked by the Guardian' panel on screen."
require_signer

# (a) OVER PER-TX MAX -----------------------------------------------------------
OVER_AMOUNT=$(( PER_TX_MAX_MOTES + 1000000000 ))   # per-tx max + 1 CSPR
beat "(a) Over per-tx max  ($OVER_AMOUNT motes > $PER_TX_MAX_MOTES)"
say "The brain asks to pay an ALLOWLISTED payee, but ABOVE the per-tx cap."
sign_intent "$PAYEE_HASH" "$OVER_AMOUNT" "$(seq_seed)"
printf "   signer: HTTP %s  %s\n" "$LAST_STATUS" "$LAST_BODY"
if [[ "$LAST_STATUS" == "403" && "$LAST_BODY" == *OverPerTx* ]]; then
  ok "Pi denied STATICALLY (OverPerTx) — device key never touched"
else
  bad "unexpected response (expected 403 OverPerTx)"
fi
pause

# (b) NON-ALLOWLISTED PAYEE -----------------------------------------------------
beat "(b) Non-allowlisted payee  (the 'stranger')"
say "Stranger: $STRANGER_HASH  ${c_red}(NOT on the allowlist)${c_reset}"
sign_intent "$STRANGER_HASH" "$PAY_AMOUNT_MOTES" "$(( $(seq_seed) + 1 ))"
printf "   signer: HTTP %s  %s\n" "$LAST_STATUS" "$LAST_BODY"
if [[ "$LAST_STATUS" == "403" && "$LAST_BODY" == *PayeeNotAllowed* ]]; then
  ok "Pi denied STATICALLY (PayeeNotAllowed) — no tx built or signed"
else
  bad "unexpected response (expected 403 PayeeNotAllowed)"
fi
pause

# (c) OVER PERIOD CAP (on-chain revert) -----------------------------------------
beat "(c) Over period cap — the ON-CHAIN backstop (Layer 1)"
cam "Explain: this one the Pi WILL sign (each tx is within per-tx max), but the contract rejects it once cumulative spend would exceed the period cap."
say "Period cap is $PERIOD_CAP_MOTES motes ($(awk "BEGIN{print $PERIOD_CAP_MOTES/1e9}") CSPR)."
say "The Pi does NOT track the running total (no RPC dependency); the contract does."
say
say "On-chain proof already recorded (over-cap / off-policy revert path):"
say "  device pay to a stranger reverted PayeeNotAllowed (User error: 3):"
say "  ${EXPLORER}/e66c455f72f4203066034293da9b0e9259ff50e81d83fb62eba3c7acd2e62a91"
say "  owner calling pay reverted NotDevice (User error: 5):"
say "  ${EXPLORER}/112c7b29e7b8e9d5c9b442cbadb5b7a0312f9f536c7de6e9b3799ce0ff36525b"
say
say "To drive a LIVE period-cap revert, repeatedly pay in-policy until cumulative"
say "spend > period cap within one period; the next pay() reverts OverCap on-chain"
say "and surfaces as a failed deploy (no Paid event)."
say "  ${c_dim}# example loop (uses real gas — only run intentionally):${c_reset}"
say "  ${c_dim}for i in 1 2 3 4 5; do scripts/_post_intent \$PAYEE_HASH $PER_TX_MAX_MOTES; done${c_reset}"

cam "Point at the RED dashboard panel now showing the two static denials, then at cspr.live for the on-chain revert."
beat "BEAT 2 complete — damage stayed at zero; the leash held at both layers"
