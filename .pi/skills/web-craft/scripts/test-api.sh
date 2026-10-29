#!/usr/bin/env bash
# ==============================================================================
# test-api.sh: Test API endpoints cleanly without dumping huge stdout
# ==============================================================================
set -euo pipefail

URL="${1:-}"
METHOD="${2:-GET}"
DATA="${3:-}"

if [ -z "$URL" ]; then
    echo "Usage: $0 <url> [method=GET] [json_data]" >&2
    exit 1
fi

CURL_ARGS=(-s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}s\n" -X "$METHOD")

if [ -n "$DATA" ]; then
    CURL_ARGS+=(-H "Content-Type: application/json" -d "$DATA")
fi

RESP="$(curl "${CURL_ARGS[@]}" "$URL")"
BODY="$(echo "$RESP" | sed -e '/HTTP_STATUS:/,$d')"
META="$(echo "$RESP" | grep -E 'HTTP_STATUS:|TIME_TOTAL:') || true"

echo "=== [API TEST: $METHOD $URL] ==="
echo "$META"
echo "------------------------------------------------------------"
echo "Response Body (first 30 lines):"
if command -v jq >/dev/null 2>&1 && echo "$BODY" | jq . >/dev/null 2>&1; then
    echo "$BODY" | jq . | head -n 30
else
    echo "$BODY" | head -n 30
fi
echo "============================================================"
