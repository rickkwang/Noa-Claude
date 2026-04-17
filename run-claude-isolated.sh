#!/bin/bash
# Isolated Noa Claude launcher - uses a separate product directory.
export CLAUDE_CODE_PRODUCT_NAMESPACE="claude-agent-isolated"
export CLAUDE_CODE_PRODUCT_NAME="Noa Claude Isolated"
export CLAUDE_CODE_PRODUCT_DIR="$HOME/.claude-agent-isolated"
cd "$(dirname "$0")"
exec bun ./run-noa.js "$@"
