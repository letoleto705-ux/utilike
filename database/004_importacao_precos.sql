BEGIN;
CREATE TABLE IF NOT EXISTS public.importacao_precos (
 id BIGSERIAL PRIMARY KEY,
 importacao_url_id BIGINT NOT NULL REFERENCES public.importacao_urls(id) ON DELETE CASCADE,
 preco_custo NUMERIC(12,2) CHECK (preco_custo > 0),
 moeda VARCHAR(3) NOT NULL DEFAULT 'BRL',
 preco_status TEXT NOT NULL DEFAULT 'nao_verificado',
 frete_gratis BOOLEAN,
 valor_frete NUMERIC(12,2) CHECK (valor_frete >= 0),
 frete_status TEXT NOT NULL DEFAULT 'frete_nao_confirmado',
 preco_venda NUMERIC(12,2) CHECK (preco_venda > 0),
 margem_aplicada NUMERIC(6,2) CHECK (margem_aplicada >= 0 AND margem_aplicada <= 80),
 origem TEXT NOT NULL DEFAULT 'garimpagem',
 capturado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_importacao_precos_produto_data ON public.importacao_precos(importacao_url_id,capturado_em DESC,id DESC);
INSERT INTO public.importacao_precos(importacao_url_id,preco_custo,moeda,preco_status,frete_gratis,valor_frete,frete_status,origem,capturado_em)
SELECT u.id,(u.dados_extraidos->>'preco_observado')::numeric,'BRL','observado_na_pagina_nao_confirmado',NULL,NULL,'frete_nao_confirmado','migracao_historica',COALESCE(u.atualizado_em,NOW())
FROM public.importacao_urls u
WHERE u.dados_extraidos->>'moeda_observada'='BRL'
 AND u.dados_extraidos->>'preco_status'='observado_na_pagina_nao_confirmado'
 AND (u.dados_extraidos->>'preco_observado') ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
 AND (u.dados_extraidos->>'preco_observado')::numeric > 0
 AND NOT EXISTS(SELECT 1 FROM public.importacao_precos p WHERE p.importacao_url_id=u.id AND p.origem='migracao_historica');
COMMIT;
