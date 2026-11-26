
from pathlib import Path
import psycopg

arquivo = Path(__file__).with_name(".env.teste")

if not arquivo.exists():
    raise SystemExit("Arquivo .env.teste nao encontrado.")

url = None

for linha in arquivo.read_text(encoding="utf-8-sig").splitlines():
    if linha.strip().startswith("DATABASE_URL="):
        url = linha.split("=", 1)[1].strip().strip('"').strip("'")
        break

if not url:
    raise SystemExit("DATABASE_URL nao encontrada.")

with psycopg.connect(
    url,
    options="-c default_transaction_read_only=on"
) as conexao:

    with conexao.cursor() as cursor:
        cursor.execute("""
            SELECT
                LEFT(nome, 150),
                LEFT(dados->>'nameEn', 150),
                LEFT(dados->>'nomeOriginalEn', 150),
                LEFT(dados->>'description', 300)
            FROM cj_produtos
            WHERE dados IS NOT NULL
            LIMIT 3
        """)

        for numero, produto in enumerate(cursor.fetchall(), 1):
            print(f"\n--- PRODUTO {numero} ---")
            print("Nome:", produto[0])
            print("NameEn:", produto[1])
            print("NomeOriginalEn:", produto[2])
            print("Descricao:", produto[3])

print("\nCONSULTA CONCLUIDA - SOMENTE LEITURA")
