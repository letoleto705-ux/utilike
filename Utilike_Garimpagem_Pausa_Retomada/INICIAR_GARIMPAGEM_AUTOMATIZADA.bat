@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Uti Like - Garimpagem Automatizada
where python >nul 2>nul
if errorlevel 1 (
 echo Python nao encontrado no PATH.
 pause
 exit /b 1
)
python -c "import selenium" >nul 2>nul
if errorlevel 1 (
 echo Instalando Selenium...
 python -m pip install selenium
 if errorlevel 1 (pause & exit /b 1)
)
python garimpagem_automatizado.py
if errorlevel 1 (
 echo O programa encerrou com erro. Confira a mensagem acima.
 pause
)
