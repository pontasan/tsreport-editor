#!/bin/bash

# ================================================================================================
# Upgrade Next.js to the latest release.
#
# Workflow:
# 1. Stop the development stack with docker compose down.
# 2. Run @next/codemod in a temporary tsreport_editor_node container.
#
# Prerequisites:
# - This script resides under tsreport-editor/cli/next/.
# - tsreport-editor/server/compose.yaml exists.
# - Docker Engine is running.
# ================================================================================================

set -euo pipefail

NODE_SERVICE="tsreport_editor_node"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/../../server" && pwd)"

cd "$SERVER_DIR"

echo "==> Stopping containers (docker compose down)..."
docker compose down

echo "==> Upgrading Next.js via @next/codemod..."
# @next/codemod 16.2.10 requires the object-shaped npm view --json output produced by npm 11.
docker compose run --rm "$NODE_SERVICE" bash -lc \
    'npm install && npm install --global npm@11.18.0 && hash -r && next_version="$(npm view next@latest version)" && NPM_CONFIG_CACHE=/tmp/tsreport-next-upgrade-npm-cache npx -y "@next/codemod@$next_version" upgrade "$next_version" && rm -rf .next'

echo "==> Done."
