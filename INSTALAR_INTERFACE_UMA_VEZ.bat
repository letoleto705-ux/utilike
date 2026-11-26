@echo off
setlocal
cd /d "%~dp0"
set "PY=%~dp0robo-copy\.venv\Scripts\python.exe"
if not exist "%PY%" (
 echo.
 echo ERRO: Ambiente Python nao encontrado em robo-copy\.venv
 echo Use o Python ja instalado e recrie o venv somente se necessario.
 pause
 exit /b 1
)
echo Instalando somente bibliotecas Python necessarias para a interface...
"%PY%" -m pip install -r "%~dp0robo-copy\requirements.txt"
if errorlevel 1 (
 echo ERRO: confira o texto de instalacao acima.
 pause
 exit /b 1
)
echo.
echo Instalacao concluida. Para abrir sem janela preta:
echo ABRIR_ROBO_COPY.vbs
pause
