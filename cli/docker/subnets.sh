#!/bin/bash
# ================================================================================================
# Pass the directory to inspect as the argument.
# 
# Prerequisites for practical scan speed.
# Project directories must contain .git and compose files under the server directory.
# ================================================================================================
if [ ! -d "$1" ]; then
    echo "Please specify the directory to search."
    exit 1
fi
# Get the core count for parallel processing on macOS.
cores=$(sysctl -n hw.ncpu)
# Use find then grep in two stages to skip unnecessary directories.
find "$1" -mindepth 2 -maxdepth 2 -name ".git" -type d -print0 | \
xargs -0 -P "$cores" -I {} sh -c '
    git_path="$1"
    # Remove "/.git" from the path with parameter expansion.
    repo_root="${git_path%/.git}"
    # Path used to inspect under the project server directory.
    server_dir="${repo_root}/server"
    # Run grep when the directory exists.
    if [ -d "$server_dir" ]; then
        grep --color=auto --include="*.yaml" --include="*.yml" -Hr "subnet:" "$server_dir"
    fi
' _ {}