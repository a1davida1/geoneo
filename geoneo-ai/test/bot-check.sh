#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[bot-check] syntax: server.js"
node --check "$ROOT_DIR/server.js"

echo "[bot-check] syntax: script.js"
node --check "$ROOT_DIR/script.js"

echo "[bot-check] syntax: services/serpProvider.js"
node --check "$ROOT_DIR/services/serpProvider.js"

echo "[bot-check] syntax: services/localSearchVisibility.js"
node --check "$ROOT_DIR/services/localSearchVisibility.js"

echo "[bot-check] unit/regression tests"
node --test "$ROOT_DIR/test/server.test.js"

echo "[bot-check] market guard agents"
node --test "$ROOT_DIR/test/market-guard-agents.test.js"

echo "[bot-check] PASS"
