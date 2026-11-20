-- Executar no SQL Editor do Neon, uma única vez. Não remove dados existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS cj_produtos (
 id_externo TEXT PRIMARY KEY,
 sku TEXT NOT NULL DEFAULT '',
 nome TEXT NOT NULL DEFAULT '',
 categoria TEXT NOT NULL DEFAULT 'Tecnologia',
 imagem TEXT,
 preco_usd NUMERIC(14,4),
 cambio_usd_brl NUMERIC(14,6),
 preco_brl NUMERIC(14,2),
 status TEXT NOT NULL DEFAULT 'revisao' CHECK (status IN ('revisao','publicado','desativado')),
 motivo TEXT,
 dados JSONB NOT NULL DEFAULT '{}'::jsonb,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cj_produtos_status_idx ON cj_produtos(status,atualizado_em DESC);
COMMIT;
