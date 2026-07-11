#!/bin/bash
set -e

TOOLS_DIR="/mnt/e/tools"
mkdir -p "$TOOLS_DIR"
cd "$TOOLS_DIR"

# Download platform-tools if not already present
if [ ! -f "$TOOLS_DIR/platform-tools/adb" ]; then
    echo "Downloading Android platform-tools..."
    curl -L -o platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-linux.zip
    
    # Extract using python since unzip may not be installed
    python3 -c "import zipfile; zipfile.ZipFile('platform-tools.zip').extractall('.')"
    rm -f platform-tools.zip
    chmod +x "$TOOLS_DIR/platform-tools/adb"
    chmod +x "$TOOLS_DIR/platform-tools/fastboot"
    echo "ADB installed successfully!"
else
    echo "ADB already installed."
fi

"$TOOLS_DIR/platform-tools/adb" version
