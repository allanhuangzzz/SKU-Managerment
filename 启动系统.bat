@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Product SKU Management System

REM ============================================================
REM  One-click launcher:
REM    1. Locate Python (py launcher first, then python on PATH)
REM    2. Run launcher.py (creates .venv, installs deps, starts
REM       the server and opens the browser automatically)
REM ============================================================

py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
    py -3 launcher.py
    goto after_run
)

python -c "import sys" >nul 2>nul
if not errorlevel 1 (
    python launcher.py
    goto after_run
)

echo.
echo [ERROR] Python was not found on this computer.
echo Please install Python 3.8+ from:
echo     https://www.python.org/downloads/
echo During installation, remember to check "Add Python to PATH".
echo.
pause
exit /b 1

:after_run
if errorlevel 1 (
    echo.
    echo [Launcher exited with an error]
    pause
)
