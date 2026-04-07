#!/bin/bash
# Isolated Claude Agent launcher - uses a separate product directory.
export CLAUDE_CODE_PRODUCT_NAMESPACE="claude-agent-isolated"
export CLAUDE_CODE_PRODUCT_NAME="Claude Agent Isolated"
export CLAUDE_CODE_PRODUCT_DIR="$HOME/.claude-agent-isolated"
cd "$(dirname "$0")"
exec bun ./run-claude.js "$@"
