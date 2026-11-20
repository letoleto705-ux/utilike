@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Uti Like - Garimpagem Manual
where python >nul 2>nul
if errorlevel 1 (echo Python nao encontrado & pause & exit /b 1)
python -c "import selenium" >nul 2>nul
if errorlevel 1 (python -m pip install selenium)
python garimpagem_manual.py
if errorlevel 1 pause
