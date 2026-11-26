-- UTI LIKE · ROBO COPY · 007 · A D I T I V A
-- Teste primeiro em BRANCH DE TESTE do Neon. Não executar em Primary sem homologação.
-- Não modifica config.produtos, traduções CJ, importação de mídia, pedidos ou afiliados.
BEGIN;
CREATE TABLE IF NOT EXISTS public.robo_copy_produtos (
    produto_id TEXT PRIMARY KEY,
    produto_url TEXT NOT NULL,
    texto_copy TEXT,
    status TEXT NOT NULL DEFAULT 'processando'
       CHECK (status IN ('processando','gerada','publicada','revisao','erro')),
    modelo_ia TEXT,
    origem TEXT NOT NULL DEFAULT 'selenium_produto_html',
    erro TEXT,
    tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
    iniciado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gerado_em TIMESTAMPTZ,
    publicado_em TIMESTAMPTZ,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (texto_copy IS NULL OR (CHAR_LENGTH(texto_copy) <= 2000
        AND ARRAY_LENGTH(STRING_TO_ARRAY(texto_copy, E'\n'), 1) <= 15)),
    CHECK (status NOT IN ('gerada','publicada') OR (texto_copy IS NOT NULL AND LENGTH(BTRIM(texto_copy)) > 0)),
    CHECK (status <> 'publicada' OR publicado_em IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS robo_copy_produtos_status_idx
    ON public.robo_copy_produtos(status,gerado_em,produto_id);
COMMIT;
