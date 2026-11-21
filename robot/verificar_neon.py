
import os
from pathlib import Path

import psycopg

arquivo = Path(__file__).with_name(".env.teste")

if not arquivo.is_file():
    raise SystemExit("ERRO: arquivo robot/.env.teste nao encontrado.")

conteudo = arquivo.read_text(encoding="utf-8-sig").splitlines()
linhas = [
    linha.strip().split("=", 1)[1].strip().strip('"').strip("'")
    for linha in conteudo
    if linha.strip().startswith("DATABASE_URL=")
]

if not linhas or not linhas[0].startswith(("postgresql://", "postgres://")):
    raise SystemExit("ERRO: DATABASE_URL nao configurada.")

url = linhas[0]

from urllib.parse import urlsplit

# Confere se o endereco pertence a um endpoint Neon.
# A identidade da branch foi conferida no painel Neon.
host = (urlsplit(url).hostname or "").lower()

if not host.endswith(".neon.tech"):
    raise SystemExit(
        "BLOQUEADO: o endereco nao pertence ao Neon. "
        "Nenhuma conexao foi realizada."
    )
try:
    with psycopg.connect(
        url,
        connect_timeout=10,
        options="-c default_transaction_read_only=on",
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user")
            banco, usuario = cur.fetchone()

            cur.execute("SELECT COUNT(*) FROM cj_produtos")
            total = cur.fetchone()[0]

            print("CONEXAO REALIZADA COM SUCESSO")
            print("Banco:", banco)
            print("Usuario:", usuario)
            print("Produtos CJ encontrados:", total)
            print("MODO: SOMENTE LEITURA")

except Exception as erro:
    print("FALHA NA CONEXAO:", type(erro).__name__)
    print("Confira a branch selecionada no Neon e a DATABASE_URL.")
