#!/bin/bash
set -e

docker compose --project-name tsreport-editor-db -f ./boot/db/compose.yaml up -d --build
