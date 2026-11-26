@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0ABRIR_ROBO_COPY.vbs" (
 echo ERRO: ABRIR_ROBO_COPY.vbs nao encontrado na raiz do projeto.
 pause
 exit /b 1
)
start "" wscript.exe "%~dp0ABRIR_ROBO_COPY.vbs"
exit /b 0
