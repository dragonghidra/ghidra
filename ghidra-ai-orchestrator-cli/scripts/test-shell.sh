#!/bin/bash
set -e

echo "================================"
echo "Shell Application Test Suite"
echo "================================"
echo ""

# Check build output
echo "✓ Checking build output..."
if [ ! -f "dist/bin/apt.js" ]; then
    echo "✗ Build output missing"
    exit 1
fi
echo "  Binary found"
echo ""

# Check executability
echo "✓ Checking executability..."
if [ ! -x "dist/bin/apt.js" ]; then
    echo "✗ Binary not executable"
    exit 1
fi
echo "  Binary is executable"
echo ""

# Check API keys
echo "✓ Checking API keys..."
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠ OPENAI_API_KEY not set (APT Code profile will not work)"
fi
echo ""

# Test help command
echo "✓ Testing help command..."
if echo "help" | timeout 5 node dist/bin/apt.js 2>&1 | grep -q "Available Tools"; then
    echo "  Help command works"
else
    echo "✗ Help command failed"
    exit 1
fi
echo ""

# Verify tools are registered
echo "✓ Verifying tools are registered..."
HELP_OUTPUT=$(echo "help" | timeout 5 node dist/bin/apt.js 2>&1)

if echo "$HELP_OUTPUT" | grep -q "read_file"; then
    echo "  ✓ File tools registered"
else
    echo "  ✗ File tools not found"
    exit 1
fi

if echo "$HELP_OUTPUT" | grep -q "execute_bash"; then
    echo "  ✓ Bash tools registered"
else
    echo "  ✗ Bash tools not found"
    exit 1
fi

if echo "$HELP_OUTPUT" | grep -q "grep_search"; then
    echo "  ✓ Search tools registered"
else
    echo "  ✗ Search tools not found"
    exit 1
fi
echo ""

# Test immutable config
echo "✓ Testing immutable config..."
if APT_CODE_MODEL="gpt-4" node dist/bin/apt.js 2>&1 | grep -q "gpt-5.1-codex"; then
    echo "  Immutable config enforced (env vars ignored)"
else
    echo "✗ Immutable config not enforced"
    exit 1
fi
echo ""

echo "================================"
echo "All tests passed! ✓"
echo "================================"
echo ""
echo "Shell app is working correctly with:"
echo "  • All tools registered (file, bash, search)"
echo "  • Immutable configuration enforced"
echo "  • Interactive mode functional"
echo "  • Help system working"
