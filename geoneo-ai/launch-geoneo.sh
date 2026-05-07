#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/matt/geoneo-ai"
PORT="4199"
HOST="127.0.0.1"

pkill -f "$ROOT/server.js" || true
cd "$ROOT"
nohup env PORT="$PORT" HOST="$HOST" node server.js > /tmp/geoneo-server.log 2>&1 &
sleep 1
xdg-open "http://${HOST}:${PORT}/" >/dev/null 2>&1 || true
