#!/bin/bash
set -e

docker compose --project-name tsreport-editor-web -f ./boot/web/compose.yaml up -d --build
