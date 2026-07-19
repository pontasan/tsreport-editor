#!/bin/bash
set -e

docker compose --project-name tsreport-editor -f ./boot/compose.yaml up -d --build
