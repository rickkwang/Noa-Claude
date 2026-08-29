#!/usr/bin/env bash
set -euo pipefail

REPO="rickkwang/Noa-Claude"
# Used when the GitHub API is unreachable (rate limit, offline). Bump per
# release — see the Release Checklist in docs/product-governance.md.
FALLBACK_REF="v1.12.0"
PERSISTENT_INSTALL_DIR="${NOA_INSTALL_TARGET_DIR:-${HOME}/.noa/install}"
ROOT_DIR=""
TEMP_DIR=""
BIN_DIR="${HOME}/.local/bin"

# Install ref resolution: NOA_INSTALL_REF pins a tag/branch/commit; otherwise
# the latest release tag is resolved from the GitHub API (semver max over
# strict release tags) so installs and updates land on a released snapshot,
# not whatever master currently is. NOA_INSTALL_REPO_TARBALL_URL overrides
# the download URL entirely (escape hatch for mirrors/forks).
INSTALL_REF="${NOA_INSTALL_REF:-}"
REPO_TARBALL_URL="${NOA_INSTALL_REPO_TARBALL_URL:-}"

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

resolve_install_ref() {
  # Only needed for piped installs without an explicit tarball URL.
  if [[ -n "$REPO_TARBALL_URL" || -n "${NOA_INSTALL_SOURCE_DIR:-}" ]]; then
    return
  fi
  if [[ -n "$INSTALL_REF" ]]; then
    return
  fi

  echo "Resolving latest release tag..."
  local tags=""
  local page=1
  # Published releases, not raw tags: this repo also carries imported upstream
  # Claude Code tags (v2.1.x) that are valid-looking semver but were never Noa
  # releases, and a tag-based lookup would select one the moment it reached the
  # remote. Only a deliberately published release counts.
  while :; do
    local parsed page_count page_tags
    if ! parsed="$(
      curl --connect-timeout 5 --max-time 10 -fsSL \
        "https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}" \
        | bun -e '
            const payload = await Bun.stdin.json()
            if (!Array.isArray(payload)) process.exit(1)
            const pattern = /^v\d+\.\d+\.\d+$/
            const tags = payload
              .filter(release => release?.draft !== true && release?.prerelease !== true)
              .map(release => release?.tag_name)
              .filter(tag => typeof tag === "string" && pattern.test(tag))
            process.stdout.write(`${payload.length}\n${tags.join("\n")}`)
          '
    )"; then
      tags=""
      break
    fi

    page_count="${parsed%%$'\n'*}"
    if [[ ! "$page_count" =~ ^[0-9]+$ ]]; then
      tags=""
      break
    fi
    page_tags=""
    if [[ "$parsed" == *$'\n'* ]]; then
      page_tags="${parsed#*$'\n'}"
    fi
    if [[ -n "$page_tags" ]]; then
      if [[ -n "$tags" ]]; then
        tags+=$'\n'
      fi
      tags+="$page_tags"
    fi
    if (( page_count < 100 )); then
      break
    fi
    ((page += 1))
  done

  if [[ -n "$tags" ]]; then
    # API order is by creation date, not version — a maintenance release cut
    # later (v1.9.2 after v1.10.0) sorts first. Pick the semver max instead.
    # (Same reason /releases/latest is unusable: GitHub defines it by created_at.)
    INSTALL_REF="$(
      printf '%s\n' "$tags" | while IFS= read -r t; do
        printf '%s\t%s\n' "${t#v}" "$t"
      done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -f2
    )"
  fi

  if [[ -z "$INSTALL_REF" ]]; then
    echo "Warning: could not resolve the latest release from GitHub (rate limit or network)." >&2
    INSTALL_REF="$FALLBACK_REF"
    echo "Falling back to the release bundled with this installer: $INSTALL_REF" >&2
    echo "Set NOA_INSTALL_REF to install a different release." >&2
  fi
  echo "Installing release: $INSTALL_REF"
}

# Checked separately from sha256_of: that runs inside a command substitution,
# where an exit only kills the subshell and leaves an empty digest behind — the
# mismatch branch would then report a misleading blank "actual".
require_sha256_tool() {
  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    echo "Neither shasum nor sha256sum is available to verify the download." >&2
    exit 1
  fi
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

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

  resolve_install_ref

  if [[ -z "$REPO_TARBALL_URL" ]]; then
    REPO_TARBALL_URL="https://codeload.github.com/${REPO}/tar.gz/${INSTALL_REF}"
  fi

  TEMP_DIR="$(mktemp -d)"
  local tarball="$TEMP_DIR/noa.tar.gz"
  echo "Downloading Noa Claude source (${INSTALL_REF:-custom URL})..."
  curl -fsSL "$REPO_TARBALL_URL" -o "$tarball"

  # Optional integrity check: NOA_INSTALL_EXPECTED_SHA256 pins the exact
  # tarball bytes. When set, a mismatch aborts before anything is extracted.
  if [[ -n "${NOA_INSTALL_EXPECTED_SHA256:-}" ]]; then
    require_sha256_tool
    echo "Verifying sha256..."
    local actual
    actual="$(sha256_of "$tarball")"
    if [[ "$actual" != "$NOA_INSTALL_EXPECTED_SHA256" ]]; then
      echo "Checksum mismatch for $REPO_TARBALL_URL" >&2
      echo "  expected: $NOA_INSTALL_EXPECTED_SHA256" >&2
      echo "  actual:   $actual" >&2
      exit 1
    fi
  fi

  tar -xzf "$tarball" -C "$TEMP_DIR" --strip-components=1
  rm -f "$tarball"
  ROOT_DIR="$TEMP_DIR"
}

# Refuse to clobber a `noa` binary that does not belong to this installation
# — checked BEFORE the expensive build so refusal fails fast, not after the
# point of no return.
check_binary_conflict() {
  local link="$BIN_DIR/noa"
  if [[ ! -e "$link" && ! -L "$link" ]]; then
    return
  fi

  local existing=""
  if [[ -L "$link" ]]; then
    existing="$(readlink "$link")"
  fi

  case "$existing" in
    "$PERSISTENT_INSTALL_DIR/bin/noa.js"|"$PERSISTENT_INSTALL_DIR/dist/cli"|"$ROOT_DIR/bin/noa.js"|"$ROOT_DIR/dist/cli")
      return # already ours
      ;;
  esac

  if [[ "${NOA_INSTALL_FORCE_SYMLINK:-}" == "1" ]]; then
    echo "Warning: overwriting existing $link (${existing:-regular file}) per NOA_INSTALL_FORCE_SYMLINK=1"
    return
  fi

  echo "Error: $link already exists and does not point to a Noa Claude installation." >&2
  echo "It currently resolves to: ${existing:-a regular file}" >&2
  echo "Refusing to overwrite. Remove it yourself, or re-run with NOA_INSTALL_FORCE_SYMLINK=1." >&2
  exit 1
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

  # Smoke-test the swapped-in build before deleting the backup: a build that
  # exits 0 can still produce a runtime that fails to start. User env vars
  # that would fail launcher validation (e.g. a bearer token without a base
  # URL) say nothing about build health, so they are unset for the check.
  echo "Verifying installation..."
  local smoke_out
  if smoke_out="$(env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY \
      bun "$PERSISTENT_INSTALL_DIR/bin/noa.js" --version 2>&1)"; then
    if [[ -n "$backup" && -d "$backup" ]]; then
      rm -rf "$backup"
    fi
  else
    echo "The new install failed its smoke test (noa --version):" >&2
    echo "$smoke_out" >&2
    rm -rf "$PERSISTENT_INSTALL_DIR"
    if [[ -n "$backup" && -d "$backup" ]]; then
      if mv "$backup" "$PERSISTENT_INSTALL_DIR"; then
        echo "Restored previous install." >&2
      else
        echo "Failed to restore the previous install; backup left at $backup" >&2
      fi
    fi
    exit 1
  fi

  ROOT_DIR="$PERSISTENT_INSTALL_DIR"
  TEMP_DIR=""
}

resolve_root_dir

check_binary_conflict

cd "$ROOT_DIR"

echo "Installing dependencies..."
bun install

echo "Building Noa Claude..."
bun run build

persist_downloaded_source

mkdir -p "$BIN_DIR"
check_binary_conflict
rm -f -- "$BIN_DIR/noa"
ln -s "$ROOT_DIR/bin/noa.js" "$BIN_DIR/noa"

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
