-- Execute uma única vez no SQL Editor do Neon, após o schema original da Loja Tech.
CREATE TABLE IF NOT EXISTS importacao_lotes (
 id BIGSERIAL PRIMARY KEY,
 total INTEGER NOT NULL CHECK (total BETWEEN 1 AND 1000),
 inseridos INTEGER NOT NULL DEFAULT 0,
 criado_por TEXT NOT NULL,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS importacao_urls (
 id BIGSERIAL PRIMARY KEY,
 url TEXT NOT NULL UNIQUE,
 fornecedor TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','revisao','pronto','erro')),
 lote_id BIGINT REFERENCES importacao_lotes(id),
 nome TEXT,
 sku TEXT,
 preco NUMERIC(12,2),
 custo NUMERIC(12,2),
 estoque INTEGER,
 imagem TEXT,
 video TEXT,
 dados_extraidos JSONB,
 erro TEXT,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS importacao_urls_status_idx ON importacao_urls(status,criado_em);
-- 'pronto' significa dados revisados, NÃO publicação automática na vitrine.
