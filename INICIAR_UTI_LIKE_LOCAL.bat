@echo off
setlocal
cd /d "%~dp0"

set "UTI_LIKE_CREDENTIAL_DIR=%LOCALAPPDATA%\UtiLikeLocal"
set "UTI_LIKE_CREDENTIAL_FILE=%UTI_LIKE_CREDENTIAL_DIR%\credentials.json"

if /I "%~1"=="redefinir" goto configurar
if not exist "%UTI_LIKE_CREDENTIAL_FILE%" goto configurar
goto iniciar

:configurar
echo Uti Like - configuracao protegida por DPAPI
echo As credenciais serao vinculadas ao usuario Windows atual.
echo Banco exclusivo: 127.0.0.1:5432/utilike_local (sem SSL)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; $dir = $env:UTI_LIKE_CREDENTIAL_DIR; $path = $env:UTI_LIKE_CREDENTIAL_FILE; New-Item -ItemType Directory -Path $dir -Force | Out-Null; $dbUser = Read-Host 'Usuario do PostgreSQL local (Enter = postgres)'; if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = 'postgres' }; $dbSecure = Read-Host 'Senha do PostgreSQL local' -AsSecureString; $adminSecure = Read-Host 'Senha do administrador local (admin)' -AsSecureString; $record = [pscustomobject]@{ version = 1; dbUser = $dbUser; dbPassword = (ConvertFrom-SecureString $dbSecure); adminPassword = (ConvertFrom-SecureString $adminSecure) }; $record | ConvertTo-Json -Compress | Set-Content -LiteralPath $path -Encoding UTF8; Write-Host ('Credenciais DPAPI salvas em ' + $path)"
if errorlevel 1 (
  echo.
  echo ERRO: nao foi possivel salvar as credenciais protegidas.
  pause
  exit /b 1
)
echo.
goto iniciar

:iniciar
echo Uti Like - inicializacao local segura
echo Banco exclusivo: 127.0.0.1:5432/utilike_local (sem SSL)
echo Nenhuma migracao sera executada por este iniciador.
echo.
start "Uti Like Local" "http://localhost:3000"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; $record = Get-Content -Raw -LiteralPath $env:UTI_LIKE_CREDENTIAL_FILE | ConvertFrom-Json; if ($record.version -ne 1 -or [string]::IsNullOrWhiteSpace($record.dbUser) -or [string]::IsNullOrWhiteSpace($record.dbPassword) -or [string]::IsNullOrWhiteSpace($record.adminPassword)) { throw 'Arquivo de credenciais invalido. Use REDEFINIR_CREDENCIAIS_UTI_LIKE_LOCAL.bat.' }; $dbSecure = ConvertTo-SecureString $record.dbPassword; $adminSecure = ConvertTo-SecureString $record.adminPassword; $dbPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbSecure); $adminPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecure); try { $dbPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($dbPtr); $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPtr); $env:DATABASE_URL = 'postgresql://' + [Uri]::EscapeDataString([string]$record.dbUser) + ':' + [Uri]::EscapeDataString($dbPassword) + '@127.0.0.1:5432/utilike_local'; $env:PGSSLMODE = 'disable'; $env:JWT_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N'); $env:ADMIN_USUARIO = 'admin'; $env:ADMIN_SENHA = $adminPassword; $env:NODE_ENV = 'development'; $env:PORT = '3000'; $env:UTI_LIKE_LOCAL_SAFE_MODE = 'true'; & node server.js } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($dbPtr); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr); Remove-Item Env:DATABASE_URL,Env:PGSSLMODE,Env:JWT_SECRET,Env:ADMIN_USUARIO,Env:ADMIN_SENHA,Env:NODE_ENV,Env:PORT,Env:UTI_LIKE_LOCAL_SAFE_MODE -ErrorAction SilentlyContinue }"

if errorlevel 1 (
  echo.
  echo A Uti Like foi encerrada. Se a senha mudou, execute o arquivo de redefinicao.
  pause
)
endlocal
