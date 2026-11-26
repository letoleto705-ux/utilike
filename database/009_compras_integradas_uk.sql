-- UTI LIKE · CHECKOUT 009 · Carrinho universal e compra atual — ADITIVA
-- Pré-requisitos: 006_vitrine_uk.sql e 008_checkout_uti_like.sql instalados.
-- RECOMENDAÇÃO: executar primeiro na branch de homologação Neon, após backup.
-- Não altera afiliados, comissões, Cronjob, catálogo ou gateway de pagamentos.
BEGIN;
CREATE SCHEMA IF NOT EXISTS checkout_uk;
CREATE TABLE IF NOT EXISTS checkout_uk.carrinhos_guardados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil TEXT NOT NULL CHECK(perfil IN ('cliente','admin','afiliado')),
  usuario TEXT NOT NULL,
  migrado_legado BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(perfil,usuario)
);
CREATE TABLE IF NOT EXISTS checkout_uk.carrinho_itens_guardados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrinho_id UUID NOT NULL REFERENCES checkout_uk.carrinhos_guardados(id) ON DELETE CASCADE,
  produto_id TEXT NOT NULL,
  variacao_id TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK(quantidade BETWEEN 1 AND 99),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(carrinho_id, produto_id, variacao_id)
);
CREATE INDEX IF NOT EXISTS checkout_uk_carrinho_itens_guardados_idx ON checkout_uk.carrinho_itens_guardados(carrinho_id,criado_em);
-- Dados de comprador no módulo de Checkout, separados do perfil de afiliado.
CREATE TABLE IF NOT EXISTS checkout_uk.compradores_dados (
  perfil TEXT NOT NULL CHECK(perfil IN ('cliente','admin','afiliado')),
  usuario TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(perfil,usuario)
);
-- Pedido de HOMOLOGAÇÃO pode pertencer a qualquer perfil autenticado.
-- Adaptação preserva linhas anteriores e remove somente a FK de checkout_uk.pedidos
-- que obrigava usuario existir em public.contas (admin/afiliado não pertencem a contas).
DO $$ DECLARE fk RECORD; BEGIN
 IF to_regclass('checkout_uk.pedidos') IS NOT NULL THEN
   FOR fk IN SELECT conname FROM pg_constraint
     WHERE conrelid='checkout_uk.pedidos'::regclass
       AND contype='f' AND confrelid='public.contas'::regclass
   LOOP
     EXECUTE format('ALTER TABLE checkout_uk.pedidos DROP CONSTRAINT %I',fk.conname);
   END LOOP;
 END IF;
END $$;
ALTER TABLE IF EXISTS checkout_uk.pedidos ADD COLUMN IF NOT EXISTS perfil TEXT NOT NULL DEFAULT 'cliente';
CREATE INDEX IF NOT EXISTS checkout_uk_pedidos_perfil_usuario_idx ON checkout_uk.pedidos(perfil,usuario,criado_em DESC);
COMMIT;
