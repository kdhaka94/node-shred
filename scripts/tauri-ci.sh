#!/usr/bin/env bash
# Keep compiler output available in GitHub's job summary when packaging fails.
set -euo pipefail
mkdir -p src-tauri/target
bun run tauri "$@" 2>&1 | tee src-tauri/target/ci-build.log
