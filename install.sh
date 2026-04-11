#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install it first: https://bun.sh/docs/installation" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Installing dependencies..."
bun install

echo "Building claude-agent..."
bun run build

mkdir -p "$BIN_DIR"
ln -sf "$ROOT_DIR/bin/claude-agent.js" "$BIN_DIR/claude-agent"
ln -sf "$ROOT_DIR/bin/claude-code.js" "$BIN_DIR/claude-code"

echo "Installed:"
echo "  $BIN_DIR/claude-agent"
echo "  $BIN_DIR/claude-code"
echo "Run: claude-agent --version"
