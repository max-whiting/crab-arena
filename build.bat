@echo off
rem Rebuild dist\CrabArena.exe
cd /d "%~dp0"
python -m PyInstaller --noconfirm --onefile --windowed --name CrabArena --icon icon.ico --add-data "web;web" app.py
