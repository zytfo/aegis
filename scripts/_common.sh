#!/usr/bin/env bash
# _common.sh — shared setup for the Aegis demo scripts.
#
# Sourced by demo-1/2/3. Loads config WITHOUT hardcoding secrets:
#   - reads signer/.env (SIGNER_TOKEN, PORT, PAYEE_HASH, PER_TX_MAX_MOTES, ...)
#   - pulls public, non-secret facts (contract hash, account hashes) from
#     guarded_wallet/scripts/owner.md so the camera-facing values are the real
#     recorded ones.
#
# Nothing here submits a transaction by itself; the signer does that only when an
# in-policy intent is approved. All values are testnet.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNER_DIR="$REPO_ROOT/signer"
AGENT_DIR="$REPO_ROOT/agent"
OWNER_MD="$REPO_ROOT/guarded_wallet/scripts/owner.md"

# --- load signer/.env if present (does not override already-set env) -----------
if [[ -f "$SIGNER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Z_]+=' "$SIGNER_DIR/.env" | sed 's/[[:space:]]*#.*$//')
  set +a
fi

# --- config (env wins; sane testnet defaults from owner.md) --------------------
SIGNER_PORT="${PORT:-8787}"
SIGNER_URL="${SIGNER_URL:-http://127.0.0.1:${SIGNER_PORT}}"
CHAIN_NAME="${CHAIN_NAME:-casper-test}"
NODE_ADDRESS="${NODE_ADDRESS:-https://node.testnet.casper.network}"

CONTRACT_PACKAGE_HASH="${CONTRACT_PACKAGE_HASH:-hash-1359b30133125889599ba0127868f83c06820677341e5eafa70eba49c0fe7bb3}"
# Allowlisted demo payee (the real recorded one).
PAYEE_HASH="${PAYEE_HASH:-account-hash-fed4d31a4c43bd2e527df1dbf01abf3ace959dda2ce712e45b327b608095e54a}"
# Owner / device account hashes (public, from owner.md).
OWNER_HASH="${OWNER_HASH:-account-hash-490b0886bc1778c13be7cb47c38abbeae187c9d6f30756992abe98ca55a44d0e}"
DEVICE_HASH="${DEVICE_HASH:-account-hash-cea489622d8b613397d65a5c4ecda7c4157491247458387e6d6da86a3a74aae7}"
# An account that is NOT on the allowlist (the "stranger"/attacker).
STRANGER_HASH="${STRANGER_HASH:-account-hash-1111111111111111111111111111111111111111111111111111111111111111}"

PER_TX_MAX_MOTES="${PER_TX_MAX_MOTES:-5000000000}"   # 5 CSPR
PERIOD_CAP_MOTES="${PERIOD_CAP_MOTES:-20000000000}"  # 20 CSPR
PAY_AMOUNT_MOTES="${PAY_AMOUNT_MOTES:-1000000000}"   # 1 CSPR in-policy demo pay

EXPLORER="https://testnet.cspr.live/transaction"

# --- pretty output -------------------------------------------------------------
c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_dim=$'\033[2m'
c_green=$'\033[32m'; c_red=$'\033[31m'; c_cyan=$'\033[36m'; c_yellow=$'\033[33m'

beat()   { printf "\n%s%s== %s ==%s\n" "$c_bold" "$c_cyan" "$1" "$c_reset"; }
cam()    { printf "%s🎥 CAMERA: %s%s\n" "$c_yellow" "$1" "$c_reset"; }
say()    { printf "   %s\n" "$1"; }
ok()     { printf "%s   ✓ %s%s\n" "$c_green" "$1" "$c_reset"; }
bad()    { printf "%s   ✗ %s%s\n" "$c_red" "$1" "$c_reset"; }
pause()  { printf "%s   …press Enter to continue…%s" "$c_dim" "$c_reset"; read -r _; }

# Require a signer token to be set (never hardcode it).
require_token() {
  if [[ -z "${SIGNER_TOKEN:-}" ]]; then
    bad "SIGNER_TOKEN is not set. Export it (or put it in signer/.env) — it must match the running signer."
    exit 1
  fi
}

# Check the signer is reachable; the /audit endpoint needs no auth.
require_signer() {
  if ! curl -fsS -m 4 "$SIGNER_URL/audit" >/dev/null 2>&1; then
    bad "Pi Signer not reachable at $SIGNER_URL. Start it:  cd signer && npm start"
    exit 1
  fi
  ok "Pi Signer is up at $SIGNER_URL"
}

# POST an intent to the signer. Args: payee amountMotes seq
# Prints "HTTP <status> <json-body>" and returns the HTTP status as exit-ish via global LAST_STATUS.
LAST_STATUS=""; LAST_BODY=""
sign_intent() {
  local payee="$1" amount="$2" seq="$3"
  local resp
  resp="$(curl -sS -m 200 -w '\n%{http_code}' \
    -X POST "$SIGNER_URL/sign-intent" \
    -H "content-type: application/json" \
    -H "authorization: Bearer ${SIGNER_TOKEN}" \
    -d "{\"payee\":\"${payee}\",\"amountMotes\":\"${amount}\",\"seq\":${seq}}")"
  LAST_STATUS="$(printf '%s' "$resp" | tail -n1)"
  LAST_BODY="$(printf '%s' "$resp" | sed '$d')"
}

# A monotonic-ish seq seed so reruns don't replay-collide.
seq_seed() { echo $(( $(date +%s) % 1000000 )); }
