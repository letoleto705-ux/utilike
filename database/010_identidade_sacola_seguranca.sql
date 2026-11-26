-- UTI LIKE 010 | ADITIVA: sacola central, atribuicao comercial e recuperação de acesso.
-- Execute após 001..009 revisadas em branch de homologação, após backup.
-- NÃO remove ou renomeia tabelas existentes; NÃO ativa cobranças/comissões.
BEGIN;
CREATE SCHEMA IF NOT EXISTS checkout_uk;
CREATE TABLE IF NOT EXISTS checkout_uk.uk_sacola_itens (
 identidade TEXT NOT NULL, produto_id TEXT NOT NULL, variacao_id TEXT NOT NULL DEFAULT '',
 quantidade INTEGER NOT NULL CHECK(quantidade BETWEEN 1 AND 99),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (identidade,produto_id,variacao_id)
);
CREATE INDEX IF NOT EXISTS uk_sacola_itens_atualizado_idx ON checkout_uk.uk_sacola_itens(atualizado_em);
CREATE TABLE IF NOT EXISTS checkout_uk.uk_sacola_migracoes (
 identidade TEXT NOT NULL, origem TEXT NOT NULL, migrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(identidade,origem)
);
CREATE TABLE IF NOT EXISTS checkout_uk.uk_atribuicoes (
 identidade TEXT PRIMARY KEY, afiliado_usuario TEXT NOT NULL,
 origem TEXT NOT NULL DEFAULT 'loja', registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 expira_em TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS checkout_uk.uk_pedido_atribuicoes (
 pedido_id UUID PRIMARY KEY REFERENCES checkout_uk.pedidos(id) ON DELETE CASCADE,
 afiliado_usuario TEXT NOT NULL,
 registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS checkout_uk.uk_recuperacoes (
 usuario TEXT PRIMARY KEY, token_hash TEXT NOT NULL,
 expira_em TIMESTAMPTZ NOT NULL, utilizado_em TIMESTAMPTZ,
 tentativas INTEGER NOT NULL DEFAULT 0,
 emitido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
