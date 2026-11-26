-- UTI LIKE · VITRINE · migration 006 (ADITIVA)
-- PRE-REQUISITOS: tabelas contas, config e catálogo existentes; backup/branch de teste.
-- Não executa pagamentos, não modifica pedidos, não modifica tabelas de afiliados.
-- Não executar a migration legada identificada como REFERENCIA_NAO_EXECUTAR.
BEGIN;
CREATE TABLE IF NOT EXISTS public.vitrine_clientes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 usuario TEXT NOT NULL UNIQUE REFERENCES public.contas(usuario) ON DELETE CASCADE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.vitrine_carrinhos (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_id UUID NOT NULL UNIQUE REFERENCES public.vitrine_clientes(id) ON DELETE CASCADE,
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.vitrine_carrinho_itens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 carrinho_id UUID NOT NULL REFERENCES public.vitrine_carrinhos(id) ON DELETE CASCADE,
 produto_id TEXT NOT NULL,
 variacao_id TEXT NOT NULL DEFAULT '',
 quantidade INTEGER NOT NULL DEFAULT 1 CHECK(quantidade BETWEEN 1 AND 99),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(carrinho_id,produto_id,variacao_id)
);
CREATE INDEX IF NOT EXISTS vitrine_carrinho_itens_carrinho_idx ON public.vitrine_carrinho_itens(carrinho_id);
CREATE TABLE IF NOT EXISTS public.vitrine_favoritos (
 cliente_id UUID NOT NULL REFERENCES public.vitrine_clientes(id) ON DELETE CASCADE,
 produto_id TEXT NOT NULL,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_id,produto_id)
);
CREATE TABLE IF NOT EXISTS public.vitrine_campanhas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nome TEXT NOT NULL CHECK(length(nome) BETWEEN 1 AND 100),
 tipo TEXT NOT NULL CHECK(tipo IN ('popup','banner','aviso')),
 titulo TEXT NOT NULL CHECK(length(titulo) BETWEEN 1 AND 150),
 mensagem TEXT NOT NULL DEFAULT '',
 imagem_url TEXT NOT NULL DEFAULT '',
 destino TEXT NOT NULL DEFAULT '/index.html',
 botao_texto TEXT NOT NULL DEFAULT 'Ver produtos',
 ativo BOOLEAN NOT NULL DEFAULT false,
 inicio_em TIMESTAMPTZ,
 fim_em TIMESTAMPTZ,
 intervalo_horas INTEGER NOT NULL DEFAULT 24 CHECK(intervalo_horas BETWEEN 1 AND 720),
 prioridade INTEGER NOT NULL DEFAULT 0,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(fim_em IS NULL OR inicio_em IS NULL OR fim_em>inicio_em)
);
CREATE INDEX IF NOT EXISTS vitrine_campanhas_ativas_idx ON public.vitrine_campanhas(tipo,ativo,prioridade DESC);
CREATE TABLE IF NOT EXISTS public.vitrine_notificacoes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_id UUID NOT NULL REFERENCES public.vitrine_clientes(id) ON DELETE CASCADE,
 tipo TEXT NOT NULL DEFAULT 'mensagem' CHECK(tipo IN ('mensagem','promocao','pedido','aviso')),
 titulo TEXT NOT NULL CHECK(length(titulo) BETWEEN 1 AND 150),
 corpo TEXT NOT NULL DEFAULT '',
 destino TEXT NOT NULL DEFAULT '',
 lida_em TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vitrine_notificacoes_cliente_idx ON public.vitrine_notificacoes(cliente_id,criado_em DESC);
COMMIT;
