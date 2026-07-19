#!/bin/bash
set -e

cleanup() {
    docker compose --project-name tsreport-editor-build -f ./build/compose.yaml down
}

trap cleanup EXIT

rm -rf ./boot/web/dist/
mkdir ./boot/web/dist
rm -rf ./build/src
rm -rf ./build/output
rsync -a --exclude=".next" --exclude="node_modules" ../src ./build
# Remove containers explicitly before starting.
cleanup
# Start the build.
docker compose --project-name tsreport-editor-build -f ./build/compose.yaml up --build --abort-on-container-exit --exit-code-from tsreport_editor_build
# Use -P to preserve symlinks because some modules expect symlinks.
cp -rfP ./build/output/.next/standalone ./boot/web/dist/
cp -rfP ./build/output/.next/static ./boot/web/dist/standalone/.next/
cp -rfP ./build/src/public ./boot/web/dist/standalone/
# First-boot seed data read by SystemInitLogic at process.cwd()/seed.
cp -rfP ./build/src/seed ./boot/web/dist/standalone/
cp -rfP ./boot/web/ecosystem.config.js ./boot/web/dist/standalone/
