@echo off
echo ============================================
echo   Reyy EV - Crash Log Capture
echo ============================================
echo.

set ADB=E:\tools\platform-tools-win\platform-tools\adb.exe

echo Checking phone connection...
%ADB% devices
echo.

echo Clearing old logs...
%ADB% logcat -c

echo.
echo ============================================
echo NOW: Open the Reyy EV app and reproduce the crash.
echo Press Ctrl+C when the crash happens.
echo ============================================
echo.
echo Capturing logs to: E:\Startup\reyy\crash_log.txt
echo.

%ADB% logcat -v time *:E ReactNative:V ReactNativeJS:V AndroidRuntime:E ExpoModulesCore:V > E:\Startup\reyy\crash_log.txt

echo.
echo Logs saved to E:\Startup\reyy\crash_log.txt
pause
