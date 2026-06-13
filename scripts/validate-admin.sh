#!/usr/bin/env bash
# Validates read-only admin API actions against the deployed Vercel endpoint.
# Reads ADMIN_SECRET from .env.local — never hardcoded.
# macOS-safe: uses a temp file instead of `head -n -1`.
#
# Usage:
#   chmod +x scripts/validate-admin.sh
#   ADMIN_SECRET=xxx ./scripts/validate-admin.sh
#   # or add ADMIN_SECRET=xxx to .env.local and run without prefix

set -euo pipefail

# ── Locate .env.local ──────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$REPO_ROOT/.env.local"

# ADMIN_SECRET priority: shell env → .env.local → fatal error
if [[ -z "${ADMIN_SECRET:-}" ]] && [[ -f "$ENV_FILE" ]]; then
  ADMIN_SECRET="$(grep -E '^ADMIN_SECRET=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")"
fi

if [[ -z "${ADMIN_SECRET:-}" ]]; then
  echo ""
  echo "ERROR: ADMIN_SECRET is not set."
  echo ""
  echo "  Option A — pass inline:"
  echo "    ADMIN_SECRET=your_secret ./scripts/validate-admin.sh"
  echo ""
  echo "  Option B — add to .env.local:"
  echo "    echo 'ADMIN_SECRET=your_secret' >> .env.local"
  echo ""
  exit 1
fi

BASE="https://forexbattle.vercel.app/api/admin"
PASS=0
FAIL=0
TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT

# ── Helpers ────────────────────────────────────────────────────────────────

# curl_get <url>  — writes body to TMPFILE, returns HTTP status code in STATUS
curl_request() {
  local method="$1"
  local url="$2"
  STATUS="$(curl -s -o "$TMPFILE" -w "%{http_code}" \
    -X "$method" "$url" \
    -H "Authorization: Bearer $ADMIN_SECRET" \
    --max-time 30)"
  BODY="$(cat "$TMPFILE")"
}

curl_no_auth() {
  local url="$1"
  STATUS="$(curl -s -o "$TMPFILE" -w "%{http_code}" \
    "$url" \
    --max-time 10)"
  BODY="$(cat "$TMPFILE")"
}

pretty_body() {
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
}

check_success() {
  echo "$BODY" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else 1)" \
    2>/dev/null
}

pass() { echo "  ✓ PASS"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ FAIL: $1"; FAIL=$((FAIL + 1)); }

# ── Tests ──────────────────────────────────────────────────────────────────

run_tests() {
  echo ""
  echo "════════════════════════════════════════"
  echo "  Admin API Validation — read-only tests"
  echo "  Target: $BASE"
  echo "════════════════════════════════════════"

  # --- Auth guard ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: Rejects missing auth (expect 401)"
  echo "────────────────────────────────────────"
  curl_no_auth "$BASE?action=candle-counts"
  echo "  HTTP $STATUS"
  if [[ "$STATUS" == "401" ]]; then pass; else fail "expected 401, got $STATUS"; fi

  # --- Unknown action ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: Rejects unknown action (expect 400)"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=does-not-exist"
  echo "  HTTP $STATUS"
  if [[ "$STATUS" == "400" ]]; then pass; else fail "expected 400, got $STATUS"; fi

  # --- candle-counts ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: action=candle-counts"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=candle-counts"
  echo "  HTTP $STATUS"
  pretty_body
  if [[ "$STATUS" == "200" ]] && check_success; then pass; else fail "HTTP $STATUS or success!=true"; fi

  # --- strategies ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: action=strategies"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=strategies"
  echo "  HTTP $STATUS"
  pretty_body
  if [[ "$STATUS" == "200" ]] && check_success; then pass; else fail "HTTP $STATUS or success!=true"; fi

  # --- setup-counts ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: action=setup-counts"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=setup-counts&symbol=EUR_USD"
  echo "  HTTP $STATUS"
  pretty_body
  if [[ "$STATUS" == "200" ]] && check_success; then pass; else fail "HTTP $STATUS or success!=true"; fi

  # --- backtest-results ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: action=backtest-results"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=backtest-results&symbol=EUR_USD"
  echo "  HTTP $STATUS"
  pretty_body
  if [[ "$STATUS" == "200" ]] && check_success; then pass; else fail "HTTP $STATUS or success!=true"; fi

  # --- trade-analysis-results ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: action=trade-analysis-results"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=trade-analysis-results&symbol=EUR_USD"
  echo "  HTTP $STATUS"
  pretty_body
  if [[ "$STATUS" == "200" ]] && check_success; then pass; else fail "HTTP $STATUS or success!=true"; fi

  # --- ftmo-results (returns empty list if none run yet — still success) ---
  echo ""
  echo "────────────────────────────────────────"
  echo "  TEST: action=ftmo-results"
  echo "────────────────────────────────────────"
  curl_request GET "$BASE?action=ftmo-results&symbol=EUR_USD"
  echo "  HTTP $STATUS"
  pretty_body
  if [[ "$STATUS" == "200" ]] && check_success; then pass; else fail "HTTP $STATUS or success!=true"; fi
}

run_tests

# ── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"

# ── Write actions (manual only) ────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "  Write actions — run manually when ready"
echo "  (not executed by this script)"
echo "════════════════════════════════════════"
echo ""
cat <<'CMDS'
# Ingest EUR_USD M15 candles:
curl -X POST "$BASE?action=ingest" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EUR_USD","timeframe":"M15","from":"2024-01-08","to":"2024-01-12"}'

# Ingest EUR_USD M5 candles:
curl -X POST "$BASE?action=ingest" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EUR_USD","timeframe":"M5","from":"2024-01-08","to":"2024-01-12"}'

# Run setup detection (requires M15 candles):
curl -X POST "$BASE?action=run-setup-detection" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EUR_USD","from":"2024-01-08","to":"2024-01-12"}'

# Run backtest (requires M5 candles + valid setups):
curl -X POST "$BASE?action=run-backtest" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EUR_USD","from":"2024-01-08","to":"2024-01-12"}'

# Run trade path analysis — by backtestRunId (replace ID with actual value):
curl -X POST "$BASE?action=run-trade-analysis" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"backtestRunId":"<id-from-run-backtest-response>"}'

# OR run trade path analysis by date range:
curl -X POST "$BASE?action=run-trade-analysis" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EUR_USD","from":"2024-01-08","to":"2024-01-12"}'

# Run analytics (requires trade path analysis first; replace ID):
curl -X POST "$BASE?action=run-analytics" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"backtestRunId":"<id-from-run-backtest-response>"}'

# Retrieve analytics summaries (replace ID):
curl "$BASE?action=analytics-results&backtestRunId=<id>" \
  -H "Authorization: Bearer $ADMIN_SECRET"

# Run FTMO evaluation — 8% and 10% targets (replace ID):
curl -X POST "$BASE?action=run-ftmo-evaluation" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"backtestRunId":"<id-from-run-backtest-response>"}'

# Retrieve FTMO results:
curl "$BASE?action=ftmo-results&symbol=EUR_USD" \
  -H "Authorization: Bearer $ADMIN_SECRET"

# Run AI review (requires run-analytics first; uses claude-haiku; replace ID):
curl -X POST "$BASE?action=run-ai-review" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"backtestRunId":"<id-from-run-backtest-response>"}'

# Retrieve AI reviews for a run:
curl "$BASE?action=ai-review-results&backtestRunId=<id>" \
  -H "Authorization: Bearer $ADMIN_SECRET"

# Retrieve recommendations (all suggested):
curl "$BASE?action=recommendation-results&backtestRunId=<id>&status=suggested" \
  -H "Authorization: Bearer $ADMIN_SECRET"
CMDS

echo ""
echo "Set BASE and ADMIN_SECRET before running the above, e.g.:"
echo "  BASE=https://forexbattle.vercel.app/api/admin"
echo "  ADMIN_SECRET=your_secret"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
