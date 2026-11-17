-- DORAVANTE / UTI LIKE - 001: estrutura base para banco Neon NOVO.
-- Executar no SQL Editor ANTES do primeiro deploy do server.js.
-- Não contém DROP, TRUNCATE ou exclusão de dados.
BEGIN;
CREATE TABLE IF NOT EXISTS contas (
 usuario TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL,
 cpf TEXT NOT NULL DEFAULT '', pix TEXT NOT NULL DEFAULT '',
 senha_hash TEXT NOT NULL, telefone TEXT NOT NULL DEFAULT '',
 trocar_senha BOOLEAN NOT NULL DEFAULT FALSE, temp_expira TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS afiliados (
 id TEXT PRIMARY KEY, usuario TEXT UNIQUE NOT NULL,
 nome TEXT NOT NULL, email TEXT NOT NULL,
 cpf TEXT NOT NULL DEFAULT '', pix TEXT NOT NULL DEFAULT '',
 senha_hash TEXT NOT NULL, patrocinador_id TEXT NOT NULL DEFAULT 'admin',
 vendas_diretas INTEGER NOT NULL DEFAULT 0,
 comissao_direta NUMERIC(12,2) NOT NULL DEFAULT 0,
 telefone TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pedidos (
 id TEXT PRIMARY KEY, afiliado_usuario TEXT, produto_id TEXT NOT NULL,
 valor NUMERIC(12,2) NOT NULL DEFAULT 0,
 comissao NUMERIC(12,2) NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'aguardando',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), pago_em TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS afiliado_cupons (
 id SERIAL PRIMARY KEY,
 afiliado_usuario TEXT NOT NULL UNIQUE REFERENCES afiliados(usuario) ON DELETE CASCADE,
 codigo_cupom VARCHAR(50) NOT NULL UNIQUE,
 ativo BOOLEAN NOT NULL DEFAULT FALSE, data_validade DATE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS afiliado_cupons_codigo_lower_uidx ON afiliado_cupons(lower(codigo_cupom));
CREATE TABLE IF NOT EXISTS notificacoes_afiliados (
 id SERIAL PRIMARY KEY, titulo VARCHAR(255) NOT NULL,
 mensagem TEXT NOT NULL, data_criacao TIMESTAMPTZ NOT NULL DEFAULT now(),
 ativa BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS vendas_aprovadas (
 payment_id TEXT PRIMARY KEY, cpf TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '', produto TEXT NOT NULL DEFAULT '',
 valor NUMERIC(12,2) NOT NULL DEFAULT 0, hwid TEXT,
 status TEXT NOT NULL DEFAULT 'APROVADO', ativa BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO config(chave,valor) VALUES
 ('taxaComissao','30'::jsonb),('taxaPatrocinador','10'::jsonb),('taxaAvo','10'::jsonb),
 ('freteFixo','0'::jsonb),('whatsappSuporte','""'::jsonb),
 ('valorMinimoSaque','50'::jsonb),
 ('cupom_global_ativo','false'::jsonb),('cupom_porcentagem_maxima','0'::jsonb),
 ('produtos','[]'::jsonb)
ON CONFLICT (chave) DO NOTHING;
COMMIT;
-- O servidor legado ainda adiciona colunas de pedidos no boot; esta é uma
-- estrutura de compatibilidade, não o schema final normalizado para 1000 produtos.
