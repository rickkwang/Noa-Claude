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

echo "Building Noa Claude..."
bun run build

mkdir -p "$BIN_DIR"
ln -sf "$ROOT_DIR/bin/noa.js" "$BIN_DIR/noa"

echo "Installed: Noa Claude"
echo "  $BIN_DIR/noa"
echo ""

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "Run: noa --version"
    ;;
  *)
    echo "Warning: $BIN_DIR is not in your PATH."
    echo ""
    case "${SHELL##*/}" in
      zsh)  rc="$HOME/.zshrc" ;;
      bash) rc="$HOME/.bashrc" ;;
      *)    rc="your shell profile" ;;
    esac
    echo "Add this to $rc, then restart your shell:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo ""
    echo "Or run noa directly: $BIN_DIR/noa --version"
    ;;
esac
