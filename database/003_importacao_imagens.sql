-- Execute uma única vez no SQL Editor do Neon (branch production).
-- Não apaga tabelas nem imagens anteriores.
BEGIN;
CREATE TABLE IF NOT EXISTS public.importacao_imagens (
 id BIGSERIAL PRIMARY KEY,
 importacao_url_id BIGINT NOT NULL REFERENCES public.importacao_urls(id) ON DELETE CASCADE,
 url_imagem TEXT NOT NULL,
 ordem INTEGER NOT NULL CHECK (ordem BETWEEN 1 AND 100),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(importacao_url_id,url_imagem)
);
CREATE INDEX IF NOT EXISTS idx_importacao_imagens_produto_ordem ON public.importacao_imagens(importacao_url_id,ordem);
-- Recupera galerias já guardadas em dados_extraidos; preserva a imagem principal.
WITH galeria AS (
 SELECT u.id AS produto_id, img.url AS url_imagem, img.ord::integer AS ordem
 FROM public.importacao_urls u
 CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(u.dados_extraidos->'imagens')='array'
  THEN u.dados_extraidos->'imagens' ELSE '[]'::jsonb END
 ) WITH ORDINALITY AS img(url,ord)
 WHERE img.url LIKE 'https://%' AND img.ord <= 100
), principal AS (
 SELECT u.id AS produto_id, u.imagem AS url_imagem, 1 AS ordem
 FROM public.importacao_urls u
 WHERE u.imagem LIKE 'https://%'
 AND NOT EXISTS(SELECT 1 FROM galeria g WHERE g.produto_id=u.id)
)
INSERT INTO public.importacao_imagens(importacao_url_id,url_imagem,ordem)
SELECT produto_id,url_imagem,ordem FROM galeria
UNION ALL SELECT produto_id,url_imagem,ordem FROM principal
ON CONFLICT(importacao_url_id,url_imagem) DO NOTHING;
COMMIT;
