#!/bin/bash

# Prevent sending unnecessary attribution headers
export CLAUDE_CODE_ATTRIBUTION_HEADER=0

# Point Claude to our local llama.cpp server
# Note: Our run.sh uses port 8080, not 8081!
export ANTHROPIC_BASE_URL="http://localhost:8080"

# Bypass API key requirements
export ANTHROPIC_API_KEY="local"
export ANTHROPIC_AUTH_TOKEN="local"

# Check if claude is installed
if ! command -v claude &> /dev/null; then
    echo "Claude Code not found. Installing..."
    curl -fsSL https://claude.ai/install.sh | bash
fi

echo "Setting up LSPs for code intelligence..."
# Python setup
if ! command -v pyright &> /dev/null; then
    echo "Installing pyright globally..."
    npm install -g pyright
fi
claude plugin install pyright-lsp@claude-plugins-official -y --scope project

# JS/TS setup
if ! command -v typescript-language-server &> /dev/null; then
    echo "Installing typescript-language-server globally..."
    npm install -g typescript typescript-language-server
fi
claude plugin install typescript-lsp@claude-plugins-official -y --scope project

echo "Starting Claude Code connected to local Gemma..."

# Start Claude Code
# The --model must match the MODEL_ALIAS we set in run.sh (Gemma-2B)
claude \
    --model Sosho \
    --bare \
    --exclude-dynamic-system-prompt-sections