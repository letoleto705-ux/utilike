-- UTI LIKE CHECKOUT: MIGRACAO 008 HOMOLOGACAO (ADITIVA)
-- Execute somente em branch de teste do Neon, apos backup e revisao.
-- NAO substitui public.pedidos, public.contas, carrinho ou afiliados.
BEGIN;
CREATE SCHEMA IF NOT EXISTS checkout_uk;
-- Se outra versao de 008 ja foi executada, nao mascarar incompatibilidade.
DO $$ BEGIN
 IF to_regclass('checkout_uk.pedidos') IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM information_schema.columns WHERE table_schema='checkout_uk' AND table_name='pedidos' AND column_name='usuario'
 ) THEN
  RAISE EXCEPTION 'checkout_uk.pedidos existe com estrutura anterior. Nao execute esta versao 008 sem migracao de compatibilidade.';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS checkout_uk.pedidos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 usuario TEXT NOT NULL REFERENCES public.contas(usuario),
 chave_idempotencia UUID NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','aguardando_pagamento','pago','cancelado')),
 nome_comprador TEXT NOT NULL,
 email_comprador TEXT NOT NULL,
 telefone_comprador TEXT NOT NULL,
 endereco_entrega JSONB NOT NULL DEFAULT '{}'::jsonb,
 moeda TEXT NOT NULL DEFAULT 'BRL' CHECK (moeda='BRL'),
 subtotal NUMERIC(14,2) NOT NULL CHECK(subtotal>=0),
 frete NUMERIC(14,2), -- NULL significa frete AINDA NAO COTADO
 desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
 total NUMERIC(14,2), -- NULL ate existir cotacao real
 criado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkout_uk_pedidos_usuario_idx ON checkout_uk.pedidos(usuario,criado_em DESC);
CREATE TABLE IF NOT EXISTS checkout_uk.pedido_itens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pedido_id uuid NOT NULL REFERENCES checkout_uk.pedidos(id),
 produto_id text NOT NULL,
 variacao_id text NOT NULL DEFAULT '',
 titulo_snapshot text NOT NULL,
 imagem_snapshot text NOT NULL DEFAULT '',
 quantidade integer NOT NULL CHECK(quantidade BETWEEN 1 AND 99),
 preco_unitario NUMERIC(14,2) NOT NULL CHECK(preco_unitario>0),
 total_item NUMERIC(14,2) NOT NULL CHECK(total_item>=0),
 UNIQUE(pedido_id,produto_id,variacao_id)
);
CREATE INDEX IF NOT EXISTS checkout_uk_pedido_itens_pedido_idx ON checkout_uk.pedido_itens(pedido_id);
COMMIT;
