@echo off
chcp 65001 >nul
title Garimpagem - Loja Tech
cd /d "%~dp0"

echo ============================================
echo   Iniciando o robo de garimpagem - Loja Tech
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Python nao encontrado. Instale o Python e marque "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

python -c "import nicegui, selenium, webdriver_manager" >nul 2>nul
if errorlevel 1 (
    echo Instalando as bibliotecas necessarias, aguarde...
    python -m pip install nicegui selenium webdriver-manager
    echo.
)

echo Abrindo o painel no navegador: http://localhost:8080
echo Deixe esta janela aberta enquanto usa o robo. Feche-a para encerrar.
echo.

python garimpagem.py

echo.
echo O painel da garimpagem foi encerrado.
pause
