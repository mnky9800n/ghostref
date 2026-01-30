#!/bin/bash
# Run CitationLint regression tests
# Usage: ./run_tests.sh [--update-baseline]

set -e
cd "$(dirname "$0")"

echo "🔬 Running CitationLint test suite..."
python3 -m pytest tests/test_regression.py -v "$@"

echo ""
echo "✓ All tests passed!"
