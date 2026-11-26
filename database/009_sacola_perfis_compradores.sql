-- UTI LIKE CHECKOUT - migração ADITIVA, pendente de aprovação e backup.
-- NÃO executar automaticamente nem aplicar em produção sem conferência do schema atual.
-- Pré-requisitos: 001, 006 e 008, além do schema checkout_uk existente.
BEGIN;
CREATE TABLE IF NOT EXISTS checkout_uk.sacola_itens (
  perfil TEXT NOT NULL CHECK (perfil IN ('cliente','afiliado','admin')),
  usuario TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  variacao_id TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 99),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil, usuario, produto_id, variacao_id)
);
CREATE INDEX IF NOT EXISTS sacola_itens_usuario_idx ON checkout_uk.sacola_itens(perfil,usuario);
-- Pedidos antigos mantêm a FK para public.contas. Admin tem usuario NULL e
-- identidade administrativa própria, sem criar cadastro de cliente falso.
ALTER TABLE checkout_uk.pedidos
  ADD COLUMN IF NOT EXISTS comprador_perfil TEXT,
  ADD COLUMN IF NOT EXISTS comprador_usuario TEXT;
UPDATE checkout_uk.pedidos SET comprador_perfil='cliente', comprador_usuario=usuario
  WHERE comprador_perfil IS NULL AND usuario IS NOT NULL;
ALTER TABLE checkout_uk.pedidos ALTER COLUMN usuario DROP NOT NULL;
-- A constraint FK em usuario NÃO é removida: clientes e afiliados continuam vinculados.
COMMIT;
