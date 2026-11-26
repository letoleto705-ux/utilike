"""Credenciais Neon: compatível com o arquivo DPAPI da versão PowerShell.

Somente Windows. Nunca armazena segredos na pasta do repositório, no CSV
ou na linha de comando de processos filhos.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit


SECRET_FILE = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'UtiLike' / 'RoboCopy' / 'neon_connection.dpapi'


def verificar_url(text: str) -> str:
    text = text.strip()
    try:
        u = urlsplit(text)
        if (u.scheme not in ('postgresql', 'postgres') or not u.hostname
                or not u.username or not u.password or not u.path.strip('/')):
            raise ValueError('A conexão deve ser uma DATABASE_URL completa do PostgreSQL/Neon.')
    except ValueError as exc:
        raise ValueError('DATABASE_URL inválida. Copie a Connection String completa do Neon.') from exc
    return text


def _powershell(codigo: str, entrada: str | None = None) -> str:
    if os.name != 'nt':
        raise RuntimeError('A proteção DPAPI desta versão exige Windows.')
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    p = subprocess.run(
        ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', codigo],
        input=entrada, text=True, capture_output=True,
        timeout=25, creationflags=flags, encoding='utf-8', errors='replace',
    )
    if p.returncode != 0:
        # Não ecoar stderr; PowerShell pode revelar trechos de valores sensíveis.
        raise RuntimeError('Não foi possível acessar a credencial protegida do Windows.')
    return p.stdout.strip()


def salvar(text: str) -> None:
    text = verificar_url(text)
    codigo = r'''
$ErrorActionPreference='Stop'
$p=Join-Path $env:LOCALAPPDATA 'UtiLike\RoboCopy\neon_connection.dpapi'
$plain=[Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($plain)) { throw 'vazio' }
$folder=Split-Path -Parent $p
[void](New-Item -ItemType Directory -Force -Path $folder)
$secure=ConvertTo-SecureString -String $plain -AsPlainText -Force
$secure | ConvertFrom-SecureString | Set-Content -LiteralPath $p -Encoding ASCII
[Console]::Out.Write('OK')
'''
    if _powershell(codigo, entrada=text) != 'OK':
        raise RuntimeError('Falha ao confirmar gravação protegida no Windows.')


def carregar() -> str:
    if not SECRET_FILE.is_file():
        raise FileNotFoundError('Conexão Neon não configurada. Clique em "Configurar Neon".')
    codigo = r'''
$ErrorActionPreference='Stop'
$p=Join-Path $env:LOCALAPPDATA 'UtiLike\RoboCopy\neon_connection.dpapi'
$criptografado=(Get-Content -LiteralPath $p -Raw).Trim()
$secure=ConvertTo-SecureString $criptografado
$plain=(New-Object System.Net.NetworkCredential('', $secure)).Password
[Console]::Out.Write($plain)
'''
    return verificar_url(_powershell(codigo))


def configurado() -> bool:
    return SECRET_FILE.is_file()
