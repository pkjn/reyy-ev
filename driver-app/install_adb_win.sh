#!/bin/bash
set -e

TOOLS_DIR="/mnt/e/tools"
cd "$TOOLS_DIR"

if [ ! -f "$TOOLS_DIR/platform-tools-win/platform-tools/adb.exe" ]; then
    echo "Downloading Windows Android platform-tools..."
    curl -L -o platform-tools-win.zip https://dl.google.com/android/repository/platform-tools-latest-windows.zip
    python3 -c "
import zipfile
z = zipfile.ZipFile('platform-tools-win.zip')
z.extractall('platform-tools-win')
z.close()
"
    rm -f platform-tools-win.zip
    echo "Windows ADB installed!"
else
    echo "Windows ADB already installed."
fi

echo "ADB path: E:\\tools\\platform-tools-win\\platform-tools\\adb.exe"
