#!/bin/bash

# Get version from tauri.conf.json
VERSION=$(cat src-tauri/tauri.conf.json | grep version | head -n 1 | awk -F'"' '{print $4}')
echo "Building Node Shred v${VERSION}..."

# Build for macOS
echo "Building for macOS..."
cargo tauri build --target universal-apple-darwin

# Build for Windows using Docker
echo "Building for Windows..."
docker run --rm -v "$(pwd):/src" -w /src rust:latest bash -c "
  rustup target add x86_64-pc-windows-msvc && \
  apt-get update && \
  apt-get install -y gcc-mingw-w64 && \
  cargo tauri build --target x86_64-pc-windows-msvc
"

# Create release notes
cat > release_notes.md << EOL
# Node Shred v${VERSION}

A desktop application to find and delete node_modules folders to free up disk space.

## Downloads

### macOS
- [node-shred_${VERSION}_universal.dmg](https://github.com/kdhaka94/node-shred/releases/download/v${VERSION}/node-shred_${VERSION}_universal.dmg) - Universal binary (Intel/Apple Silicon)

### Windows
- [node-shred_${VERSION}_x64-setup.exe](https://github.com/kdhaka94/node-shred/releases/download/v${VERSION}/node-shred_${VERSION}_x64-setup.exe) - Windows 64-bit installer

## System Requirements

### macOS
- macOS 10.15 or later
- Intel or Apple Silicon processor

### Windows
- Windows 10 or later (64-bit)

## Installation Instructions

### macOS
1. Download the DMG file
2. Open the DMG file
3. Drag Node Shred to your Applications folder
4. When opening for the first time, right-click (or Control-click) the app and select "Open"
   - You may see a security warning since the app is not signed with an Apple Developer ID
   - Click "Open" in the warning dialog to proceed

### Windows
1. Download the installer (.exe)
2. Run the installer
3. Follow the installation wizard
4. Launch Node Shred from the Start menu

## Security Notes
- The macOS application is signed with a development certificate
- You may see a security warning on first launch on macOS
- This is normal for applications not distributed through the Mac App Store

## Features
- Scan your system for node_modules folders
- View size and location of each folder
- Delete selected folders to free up space
- Modern and intuitive user interface
EOL

# Create GitHub release
echo "Creating GitHub release..."
gh release create "v${VERSION}" \
  --title "Node Shred v${VERSION}" \
  --notes-file release_notes.md \
  "src-tauri/target/universal-apple-darwin/release/bundle/dmg/node-shred_${VERSION}_universal.dmg" \
  "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/node-shred_${VERSION}_x64-setup.exe"

# Check if release was successful
if [ $? -eq 0 ]; then
  echo "Release v${VERSION} created successfully!"
  rm release_notes.md
else
  echo "Failed to create release"
  exit 1
fi 