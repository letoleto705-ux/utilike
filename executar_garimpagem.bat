@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Uti Like - Garimpagem e Observador de Precos
python --version >nul 2>&1
if errorlevel 1 (
  echo Python nao encontrado. Instale Python e marque Add Python to PATH.
  pause
  exit /b 1
)
python -c "import selenium" >nul 2>&1
if errorlevel 1 (
  echo Instalando Selenium...
  python -m pip install selenium
  if errorlevel 1 (
    echo Falha ao instalar Selenium.
    pause
    exit /b 1
  )
)
python garimpagem.py
pause
