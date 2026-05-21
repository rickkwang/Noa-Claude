#!/usr/bin/env bash
set -euo pipefail

REPO_TARBALL_URL="${NOA_INSTALL_REPO_TARBALL_URL:-https://codeload.github.com/rickkwang/Noa-Claude/tar.gz/refs/heads/master}"
PERSISTENT_INSTALL_DIR="${NOA_INSTALL_TARGET_DIR:-${HOME}/.noa/install}"
ROOT_DIR=""
TEMP_DIR=""
BIN_DIR="${HOME}/.local/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install it first: https://bun.sh/docs/installation" >&2
  exit 1
fi

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

resolve_root_dir() {
  if [[ -n "${NOA_INSTALL_SOURCE_DIR:-}" ]]; then
    ROOT_DIR="${NOA_INSTALL_SOURCE_DIR}"
    return
  fi

  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required for piped installation." >&2
    exit 1
  fi

  if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required for piped installation." >&2
    exit 1
  fi

  TEMP_DIR="$(mktemp -d)"
  echo "Downloading Noa Claude source..."
  curl -fsSL "$REPO_TARBALL_URL" | tar -xzf - -C "$TEMP_DIR" --strip-components=1
  ROOT_DIR="$TEMP_DIR"
}

persist_downloaded_source() {
  if [[ "$ROOT_DIR" == "$PERSISTENT_INSTALL_DIR" ]]; then
    return
  fi

  mkdir -p "$(dirname "$PERSISTENT_INSTALL_DIR")"
  if [[ -z "$TEMP_DIR" ]]; then
    TEMP_DIR="$(mktemp -d)"
    cp -R "$ROOT_DIR"/. "$TEMP_DIR"/
    rm -rf "$TEMP_DIR/.git"
  fi

  local backup=""
  if [[ -d "$PERSISTENT_INSTALL_DIR" ]]; then
    backup="${PERSISTENT_INSTALL_DIR}.bak.$$"
    mv "$PERSISTENT_INSTALL_DIR" "$backup"
  fi

  if ! mv "$TEMP_DIR" "$PERSISTENT_INSTALL_DIR"; then
    echo "Failed to move build into $PERSISTENT_INSTALL_DIR" >&2
    if [[ -n "$backup" && -d "$backup" ]]; then
      mv "$backup" "$PERSISTENT_INSTALL_DIR" || true
      echo "Restored previous install." >&2
    fi
    exit 1
  fi

  if [[ -n "$backup" && -d "$backup" ]]; then
    rm -rf "$backup"
  fi
  ROOT_DIR="$PERSISTENT_INSTALL_DIR"
  TEMP_DIR=""
}

resolve_root_dir
cd "$ROOT_DIR"

echo "Installing dependencies..."
bun install

echo "Building Noa Claude..."
bun run build

persist_downloaded_source

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
