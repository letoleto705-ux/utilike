# Uti Like - Robo Copy | executa em Windows PowerShell 5.1+
# Este script nao contem senha. Protege a conexao com DPAPI do usuario do Windows.
$ErrorActionPreference = 'Stop'
$base = $PSScriptRoot
$python = Join-Path $base '.venv\Scripts\python.exe'
$scriptPy = Join-Path $base 'robo_copy.py'
$segredos = Join-Path $env:LOCALAPPDATA 'UtiLike\RoboCopy'
$arquivo = Join-Path $segredos 'neon_connection.dpapi'
$modelo = 'qwen3.5:0.8b'

function Conferir-Arquivos {
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw 'Python do projeto nao encontrado. Crie .venv e instale requirements.txt na pasta robo-copy.'
    }
    if (-not (Test-Path -LiteralPath $scriptPy -PathType Leaf)) {
        throw 'Falta robo-copy\robo_copy.py. Confira a pasta do projeto.'
    }
}

function Configurar-Neon {
    Write-Host ''
    Write-Host 'Cole sua DATABASE_URL do Neon (senha oculta).' -ForegroundColor Cyan
    Write-Host 'A conexao sera protegida com a criptografia DPAPI do seu usuario Windows.'
    Write-Host 'Nao envie a URL ao chat nem salve no codigo ou no Git.'
    $segura = Read-Host -AsSecureString 'DATABASE_URL'
    if ($segura.Length -eq 0) { throw 'Conexao vazia.' }
    $valor = (New-Object System.Net.NetworkCredential('', $segura)).Password
    if ($valor -notmatch '^postgres(?:ql)?://') { throw 'A conexao deve comecar com postgresql:// ou postgres://.' }
    $uri = $null
    if (-not [System.Uri]::TryCreate($valor,[System.UriKind]::Absolute,[ref]$uri)) {
        throw 'DATABASE_URL nao parece uma URL valida.'
    }
    New-Item -ItemType Directory -Path $segredos -Force | Out-Null
    $segura | ConvertFrom-SecureString | Set-Content -LiteralPath $arquivo -Encoding ASCII
    $env:DATABASE_URL = $valor
    $valor = $null
    Write-Host 'Conexao salva de forma criptografada para este usuario do Windows.' -ForegroundColor Green
}

function Carregar-Neon {
    if ($env:DATABASE_URL) { return }
    if (-not (Test-Path -LiteralPath $arquivo -PathType Leaf)) {
        Configurar-Neon
        return
    }
    try {
        $criptografado = (Get-Content -LiteralPath $arquivo -Raw).Trim()
        $segura = ConvertTo-SecureString $criptografado
        $env:DATABASE_URL = (New-Object System.Net.NetworkCredential('', $segura)).Password
        if ($env:DATABASE_URL -notmatch '^postgres(?:ql)?://') { throw 'Formato invalido.' }
    } catch {
        throw 'Nao foi possivel abrir a conexao protegida. Use opcao 4 para configura-la novamente.'
    }
}

function Conferir-Ollama {
    try {
        $result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 8
    } catch {
        throw 'Ollama local nao respondeu. Abra o aplicativo Ollama no Windows e tente de novo.'
    }
    $disponiveis = @($result.models | ForEach-Object { $_.name })
    if ($disponiveis -notcontains $modelo) {
        throw "Modelo $modelo nao encontrado. No PowerShell, execute uma vez: ollama pull $modelo"
    }
}

function Rodar([string]$tipo) {
    Conferir-Arquivos
    Carregar-Neon
    $env:ROBO_COPY_MODELO = $modelo
    $env:UTI_LIKE_BASE_URL = 'https://utilike.onrender.com'
    $env:OLLAMA_HOST = 'http://localhost:11434'
    $argsPy = @($scriptPy, '--modelo', $modelo)
    if ($tipo -eq 'simular') {
        Conferir-Ollama
        $argsPy += @('--modo','simular','--limite','2','--visivel')
        Write-Host 'SIMULACAO: 2 produtos; nao grava no Neon.' -ForegroundColor Cyan
    } elseif ($tipo -eq 'gravar') {
        Conferir-Ollama
        Write-Host ''
        Write-Warning 'GRAVACAO REAL: percorre os produtos pendentes e grava as copies no Neon configurado.'
        Write-Host 'Copies geradas nao sao publicadas pelo Python; o Cronjob do Render publica quando habilitado.'
        $resposta = Read-Host 'Digite GRAVAR para autorizar (ou Enter para cancelar)'
        if ($resposta -cne 'GRAVAR') { Write-Host 'Operacao cancelada.'; return }
        $env:ROBO_COPY_PERMITIR_ESCRITA = 'SIM'
        $argsPy += @('--modo','gravar','--visivel')
    } elseif ($tipo -eq 'status') {
        $argsPy += @('--modo','status')
    }
    try {
        & $python @argsPy
        $codigo = $LASTEXITCODE
        if ($codigo -eq 0) { Write-Host 'Execucao encerrada sem erro geral.' -ForegroundColor Green }
        else { Write-Warning "Robô retornou codigo $codigo. Confira os erros acima." }
    } finally {
        Remove-Item Env:\ROBO_COPY_PERMITIR_ESCRITA -ErrorAction SilentlyContinue
    }
}

try {
    while ($true) {
        Write-Host ''
        Write-Host '=======================================' -ForegroundColor Cyan
        Write-Host '         UTI LIKE - ROBO COPY' -ForegroundColor Cyan
        Write-Host '=======================================' -ForegroundColor Cyan
        Write-Host '1 - SIMULAR 2 produtos (sem gravar)'
        Write-Host '2 - GERAR copies de TODOS os pendentes (grava no Neon)'
        Write-Host '3 - CONSULTAR quantidade por status no Neon'
        Write-Host '4 - CONFIGURAR / TROCAR conexao Neon'
        Write-Host '0 - SAIR'
        $escolha = Read-Host 'Selecione uma opcao'
        try {
            switch ($escolha) {
                '1' { Rodar 'simular' }
                '2' { Rodar 'gravar' }
                '3' { Rodar 'status' }
                '4' {
                    if ($env:DATABASE_URL) { Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }
                    Configurar-Neon
                }
                '0' { return }
                default { Write-Host 'Escolha 0, 1, 2, 3 ou 4.' -ForegroundColor Yellow }
            }
        } catch {
            Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
        }
        if ($escolha -ne '0') { [void](Read-Host 'Pressione Enter para voltar ao menu') }
    }
} finally {
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\ROBO_COPY_PERMITIR_ESCRITA -ErrorAction SilentlyContinue
}
