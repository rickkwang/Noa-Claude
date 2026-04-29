#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-scan}"
ROOT="${2:-$HOME/.claude-agent/projects}"
LIST_FILE="${3:-/tmp/noa_session_candidates.txt}"

if command -v rg >/dev/null 2>&1; then
  MATCH_CMD='rg -qi'
else
  MATCH_CMD='grep -Eqi'
fi
export MATCH_CMD

scan_candidates() {
  : > "$LIST_FILE"
  find "$ROOT" -name '*.jsonl' -print0 | \
    xargs -0 sh -c '
      for f do
        if head -n 20 "$f" | $MATCH_CMD "\"content\":\"(ping|test|hello|/usage)\""; then
          echo "$f"
        fi
      done
    ' sh >> "$LIST_FILE"

  sort -u -o "$LIST_FILE" "$LIST_FILE"
  echo "Candidate list: $LIST_FILE"
  echo "Candidate count: $(wc -l < "$LIST_FILE" | tr -d " ")"
  sed -n '1,200p' "$LIST_FILE"
}

delete_candidates() {
  if [[ ! -f "$LIST_FILE" ]]; then
    echo "List not found: $LIST_FILE"
    exit 1
  fi
  if [[ ! -s "$LIST_FILE" ]]; then
    echo "List is empty: $LIST_FILE"
    exit 0
  fi

  local count
  count=$(wc -l < "$LIST_FILE" | tr -d ' ')
  echo "About to delete $count files listed in: $LIST_FILE"

  if [[ "${ASSUME_YES:-0}" != "1" ]]; then
    if [[ ! -t 0 ]]; then
      echo "Refusing to delete non-interactively. Re-run with ASSUME_YES=1 to confirm."
      exit 1
    fi
    printf "Proceed? [y/N] "
    read -r reply
    case "$reply" in
      y|Y|yes|YES) ;;
      *) echo "Aborted."; exit 0 ;;
    esac
  fi

  while IFS= read -r file; do
    rm -f "$file"
  done < "$LIST_FILE"

  echo "Deleted files from: $LIST_FILE"
}

case "$MODE" in
  scan)
    scan_candidates
    ;;
  delete)
    delete_candidates
    ;;
  *)
    echo "Usage:"
    echo "  $0 scan [root] [list_file]"
    echo "  $0 delete [root] [list_file]   # set ASSUME_YES=1 to skip prompt"
    exit 1
    ;;
esac
