#!/bin/sh
set -eu

mkdir -p "$CODEX_HOME"
chown -R authy:authy "$CODEX_HOME"

exec runuser --user authy -- "$@"
