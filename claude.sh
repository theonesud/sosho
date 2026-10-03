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

echo "Starting Claude Code connected to local Gemma..."

# Start Claude Code
# The --model must match the MODEL_ALIAS we set in run.sh (Gemma-2B)
claude \
    --model Sosho \
    --bare \
    --exclude-dynamic-system-prompt-sections