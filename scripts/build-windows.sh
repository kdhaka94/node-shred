#!/bin/bash

echo "Building Node Shred for Windows..."

# Install required dependencies if not already installed
brew install mingw-w64 llvm

# Add Windows target if not already added
rustup target add x86_64-pc-windows-msvc

# Install cargo-tauri if not already installed
cargo install cargo-tauri --locked

# Build the application
echo "Building application..."
bun install
cargo tauri build --target x86_64-pc-windows-msvc 