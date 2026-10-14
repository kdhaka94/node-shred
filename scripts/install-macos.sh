#!/usr/bin/env bash
set -euo pipefail
if [ "$(uname -s)" != Darwin ]; then
  echo 'Run this installer on your Mac.' >&2
  exit 1
fi
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  echo 'Finish installing Apple Command Line Tools, then run this script again.'
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install oven-sh/bun/bun
  else
    echo 'Install Bun using https://bun.sh/docs/installation, then rerun this script.' >&2
    exit 1
  fi
fi
if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install rust
  else
    echo 'Install Rust using https://www.rust-lang.org/tools/install, then rerun this script.' >&2
    exit 1
  fi
fi
bun install --frozen-lockfile
bun run tauri build --bundles app -- --locked
built_app="$PWD/src-tauri/target/release/bundle/macos/node-shred.app"
if [ ! -d "$built_app" ]; then
  echo "Build completed without the expected app: $built_app" >&2
  exit 1
fi
applications_dir="$HOME/Applications"
mkdir -p "$applications_dir"
staging_dir=$(mktemp -d "$applications_dir/.node-shred-install.XXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
ditto "$built_app" "$staging_dir/NodeShred.app"
destination="$applications_dir/NodeShred.app"
backup=""
if [ -e "$destination" ]; then
  backup="$destination.backup-$(date +%Y%m%d-%H%M%S)"
  if [ -e "$backup" ]; then
    echo "Backup already exists: $backup" >&2
    exit 1
  fi
  mv "$destination" "$backup"
fi
if ! mv "$staging_dir/NodeShred.app" "$destination"; then
  if [ -n "$backup" ]; then mv "$backup" "$destination"; fi
  exit 1
fi
echo "Installed: $destination"
if [ -n "$backup" ]; then echo "Previous app preserved: $backup"; fi
open "$destination"
