#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== [1/10] Agent governance and documentation sync check ==="
./bin/check-agent-docs.sh

echo "=== [2/10] TypeScript typecheck across all packages ==="
(cd packages/llm && npm run typecheck)
(cd packages/memory && npm run typecheck)
(cd packages/workflow-engine && npm run typecheck)
(cd apps/studio && npm run typecheck)

echo "=== [3/10] Biome lint (apps/studio) ==="
npm --prefix apps/studio run lint

echo "=== [4/10] Next.js production build (apps/studio) ==="
npm --prefix apps/studio run build

echo "=== [5/10] pi-sandbox:latest extension smoke test (Sosho root + external Git repo) ==="
docker run --rm -v "$ROOT_DIR:$ROOT_DIR" -w "$ROOT_DIR" -e "PI_CODING_AGENT_DIR=$ROOT_DIR/.pi" pi-sandbox:latest --help >/dev/null
TMP_EXT_REPO="$(mktemp -d /tmp/sosho-smoke.XXXXXX)"
trap 'rm -rf "$TMP_EXT_REPO"' EXIT
git -C "$TMP_EXT_REPO" init -q
(cd "$TMP_EXT_REPO" && "$ROOT_DIR/bin/pi-launcher.sh" --help >/dev/null)
python3 - "$TMP_EXT_REPO/.pi/settings.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
exts = data.get("extensions", [])
for name in ("langfuse", "scratchpad", "subagents", "memory"):
    assert any(f"/opt/sosho/.pi/extensions/{name}/src/index.ts" == e for e in exts), f"Missing {name} in {exts}"
print("External repo extensions verified:", len(exts))
PY

echo "=== [6/10] packages/memory unit suite ==="
(cd packages/memory && npx tsx test/memory.test.ts && npx tsx test/capture.test.ts)

echo "=== [7/10] packages/llm and subagents unit suite ==="
(cd packages/llm && npx tsx test/llm.test.ts && npx tsx test/subagents.test.ts)

echo "=== [8/10] packages/workflow-engine unit suite ==="
(cd packages/workflow-engine && npx tsx test/schema.test.ts && npx tsx test/max-steps.test.ts && npx tsx test/activities.test.ts && npx tsx test/engine.test.ts)

echo "=== [9/10] apps/studio server tests ==="
(cd apps/studio && npx tsx server/server.test.ts)

echo "=== [10/10] yue2/gateway pytest suite ==="
if [ -x "$ROOT_DIR/yue2/gateway/.venv/bin/pytest" ]; then
  (cd yue2/gateway && ./.venv/bin/pytest -q test_gateway.py)
else
  (cd yue2/gateway && pytest -q test_gateway.py)
fi

echo "=== ALL 10 SOSHO TEST SUITES PASSED ==="
