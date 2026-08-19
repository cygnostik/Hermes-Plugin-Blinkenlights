#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$CACHE_DIR"' EXIT
export PYTHONPYCACHEPREFIX="$CACHE_DIR/pycache"
export PYTHONDONTWRITEBYTECODE=1

PYTHON_BIN="${BLINKENBAR_PYTHON:-python3}"
if ! "$PYTHON_BIN" -c 'import fastapi, psutil' >/dev/null 2>&1; then
  HERMES_PYTHON="$HOME/.hermes/hermes-agent/venv/bin/python"
  if [[ -x "$HERMES_PYTHON" ]] && "$HERMES_PYTHON" -c 'import fastapi, psutil' >/dev/null 2>&1; then
    PYTHON_BIN="$HERMES_PYTHON"
  else
    echo "ERROR: fastapi and psutil are required; set BLINKENBAR_PYTHON to the Hermes runtime interpreter" >&2
    exit 1
  fi
fi
echo "Python runtime: $PYTHON_BIN"

echo "== JavaScript syntax =="
node --check desktop/plugin.js

echo "== Desktop reducer tests =="
node tests/test_roster.mjs

echo "== Python compile =="
"$PYTHON_BIN" -m compileall -q -f __init__.py dashboard tests

echo "== Unit tests =="
"$PYTHON_BIN" -m unittest discover -s tests -v

echo "== Metrics smoke test =="
"$PYTHON_BIN" - <<'PY'
import asyncio
from dashboard.plugin_api import metrics

payload = asyncio.run(metrics())
assert payload["ok"] is True
assert payload["degraded"] is False
assert payload["errors"] == []
assert 0 <= payload["cpu"] <= 100
assert 0 <= payload["memory"] <= 100
assert {"activity", "read_bps", "write_bps"} == set(payload["io"])
assert "available" in payload["gpu"]
assert {"available", "util", "memory", "memory_used_mb", "memory_total_mb", "error"} == set(payload["gpu"])
print("metrics payload: ok")
PY

echo "== Metadata and repository hygiene =="
"$PYTHON_BIN" - <<'PY'
import json
import re
from pathlib import Path

root = Path(".")
yaml_text = (root / "plugin.yaml").read_text(encoding="utf-8")
required = [
    "manifest_version: 1",
    "name: blinkenbar",
    "python_dependencies:",
]
missing = [item for item in required if item not in yaml_text]
if missing:
    raise SystemExit(f"plugin.yaml missing: {missing}")
version_match = re.search(r"^version:\s*\"([^\"]+)\"\s*$", yaml_text, re.MULTILINE)
if not version_match:
    raise SystemExit('plugin.yaml must carry a quoted version: "x.y.z..."')
manifest = json.loads((root / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
if manifest.get("version") != version_match.group(1):
    raise SystemExit("dashboard manifest version does not match plugin.yaml")
if not re.search(r"^license:\s*MIT\s*$", yaml_text, re.MULTILINE | re.IGNORECASE):
    raise SystemExit("plugin.yaml must declare license: MIT")

ignored_parts = {".git", "node_modules", "dist", "build", "__pycache__", ".pytest_cache"}
text_suffixes = {".js", ".py", ".json", ".yaml", ".yml", ".md", ".sh", ""}
files = [
    path for path in root.rglob("*")
    if path.is_file()
    and not any(part in ignored_parts for part in path.parts)
    and path.suffix.lower() in text_suffixes
]
forbidden = {
    "organization/machine marker": re.compile(
        "|".join(["PRA" + "XIS", "Leg" + "ion", "/Use" + "rs/"]),
        re.IGNORECASE,
    ),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "credential assignment": re.compile(
        r"(?im)^\s*(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)\s*[:=]\s*['\"]?[^\s'\"${}]{8,}"
    ),
}
source_hygiene = re.compile(r"\b(?:TODO|FIXME|HACK|XXX)\b")
failures = []
for path in files:
    text = path.read_text(encoding="utf-8", errors="replace")
    for label, pattern in forbidden.items():
        if pattern.search(text):
            failures.append(f"{path}: {label}")
    if path.suffix.lower() in {".js", ".py"} and source_hygiene.search(text):
        failures.append(f"{path}: unfinished-work marker")
if failures:
    raise SystemExit("repository scan failed:\n" + "\n".join(failures))
print(f"metadata and hygiene scan: ok ({len(files)} text files)")
PY

echo "== Hermes plugin doctor =="
if command -v hermes >/dev/null 2>&1; then
  hermes plugins doctor --ci .
else
  echo "SKIP: hermes command is not installed"
fi

echo "== Verification complete =="
