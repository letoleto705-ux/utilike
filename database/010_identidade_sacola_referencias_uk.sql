-- UTI LIKE | 010 — Identidade permanente, sacola/carrinho sincronizados e referência de origem.
-- ADITIVA; não apaga informações nem modifica pagamentos/comissões.
-- Aplicar em branch de homologação, depois de backup. Os SQL 009 antigos NÃO devem
-- ser executados automaticamente como parte desta atualização.
BEGIN;
CREATE TABLE IF NOT EXISTS public.uk_identidades (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario TEXT NOT NULL UNIQUE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.uk_sacolas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 identidade_id UUID UNIQUE REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 visitante_id UUID UNIQUE,
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT uk_sacola_um_dono CHECK((identidade_id IS NOT NULL) <> (visitante_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.uk_sacola_itens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 sacola_id UUID NOT NULL REFERENCES public.uk_sacolas(id) ON DELETE CASCADE,
 produto_id TEXT NOT NULL, variacao_id TEXT NOT NULL DEFAULT '',
 quantidade INTEGER NOT NULL CHECK(quantidade BETWEEN 1 AND 99),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(sacola_id,produto_id,variacao_id)
);
CREATE INDEX IF NOT EXISTS uk_sacola_itens_sacola ON public.uk_sacola_itens(sacola_id);
CREATE TABLE IF NOT EXISTS public.uk_carrinho_itens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 identidade_id UUID NOT NULL REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 produto_id TEXT NOT NULL, variacao_id TEXT NOT NULL DEFAULT '',
 quantidade INTEGER NOT NULL CHECK(quantidade BETWEEN 1 AND 99),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(identidade_id,produto_id,variacao_id)
);
CREATE INDEX IF NOT EXISTS uk_carrinho_identidade ON public.uk_carrinho_itens(identidade_id);
CREATE TABLE IF NOT EXISTS public.uk_perfis (
 identidade_id UUID PRIMARY KEY REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '',
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.uk_enderecos (
 identidade_id UUID PRIMARY KEY REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 destinatario TEXT NOT NULL DEFAULT '', cep TEXT NOT NULL DEFAULT '', logradouro TEXT NOT NULL DEFAULT '',
 numero TEXT NOT NULL DEFAULT '', complemento TEXT NOT NULL DEFAULT '', bairro TEXT NOT NULL DEFAULT '',
 cidade TEXT NOT NULL DEFAULT '', uf TEXT NOT NULL DEFAULT '', atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.uk_favoritos (
 identidade_id UUID NOT NULL REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 produto_id TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(identidade_id,produto_id)
);
CREATE TABLE IF NOT EXISTS public.uk_notificacoes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 identidade_id UUID NOT NULL REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 tipo TEXT NOT NULL DEFAULT 'mensagem',titulo TEXT NOT NULL,corpo TEXT NOT NULL DEFAULT '',
 destino TEXT NOT NULL DEFAULT '',lida_em TIMESTAMPTZ,criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uk_notificacoes_identidade ON public.uk_notificacoes(identidade_id,criado_em DESC);
ALTER TABLE public.uk_identidades ADD COLUMN IF NOT EXISTS senha_trocada_em TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS public.uk_ultimo_produto (
 identidade_id UUID PRIMARY KEY REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 produto_id TEXT NOT NULL, visto_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.uk_referencias_visitantes (
 visitante_id UUID PRIMARY KEY, indicador_usuario TEXT NOT NULL DEFAULT 'admin',
 patrocinador_usuario TEXT NOT NULL DEFAULT 'admin',
 origem TEXT NOT NULL DEFAULT 'central',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), expira_em TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 days'
);
CREATE INDEX IF NOT EXISTS uk_referencias_expira ON public.uk_referencias_visitantes(expira_em);
CREATE TABLE IF NOT EXISTS public.uk_referencias_contas (
 identidade_id UUID PRIMARY KEY REFERENCES public.uk_identidades(id) ON DELETE CASCADE,
 indicador_usuario TEXT NOT NULL DEFAULT 'admin',
 patrocinador_usuario TEXT NOT NULL DEFAULT 'admin',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Registro administrativo de comprovação de Pix já realizado, nunca executa transferência.
CREATE TABLE IF NOT EXISTS public.uk_repasses_comprovados (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 afiliado_id TEXT NOT NULL, afiliado_usuario TEXT NOT NULL,
 valor NUMERIC(14,2) NOT NULL CHECK(valor>0),
 comprovante_pix TEXT NOT NULL UNIQUE, comprovante_url TEXT NOT NULL DEFAULT '',
 confirmado_por TEXT NOT NULL, data_pagamento TIMESTAMPTZ NOT NULL DEFAULT now(),
 registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uk_repasses_usuario ON public.uk_repasses_comprovados(afiliado_usuario,registrado_em DESC);
CREATE TABLE IF NOT EXISTS public.uk_recuperacoes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 usuario TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 token_hash TEXT, gerado_em TIMESTAMPTZ, expira_em TIMESTAMPTZ,
 utilizado_em TIMESTAMPTZ,
 CHECK((token_hash IS NULL AND expira_em IS NULL) OR (token_hash IS NOT NULL AND expira_em IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS uk_recuperacoes_usuario ON public.uk_recuperacoes(usuario,criado_em DESC);
CREATE INDEX IF NOT EXISTS uk_recuperacoes_hash ON public.uk_recuperacoes(token_hash) WHERE token_hash IS NOT NULL;
CREATE SCHEMA IF NOT EXISTS checkout_uk;
CREATE TABLE IF NOT EXISTS checkout_uk.compradores_dados (
 perfil TEXT NOT NULL CHECK(perfil IN ('cliente','admin','afiliado')),
 usuario TEXT NOT NULL, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 telefone TEXT NOT NULL DEFAULT '', atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(perfil,usuario)
);
-- Vínculos de atribuição para futuros pedidos reais; estes campos NÃO acionam comissões.
DO $$ BEGIN
 IF to_regclass('checkout_uk.pedidos') IS NOT NULL THEN
   ALTER TABLE checkout_uk.pedidos ADD COLUMN IF NOT EXISTS perfil TEXT NOT NULL DEFAULT 'cliente';
   ALTER TABLE checkout_uk.pedidos ADD COLUMN IF NOT EXISTS indicador_afiliado TEXT;
   ALTER TABLE checkout_uk.pedidos ADD COLUMN IF NOT EXISTS referencia_central TEXT;
 END IF;
END $$;
-- Importação conservadora dos dois carrinhos legados. Não apaga as tabelas de origem.
INSERT INTO public.uk_identidades(usuario)
 SELECT DISTINCT usuario FROM public.contas WHERE usuario IS NOT NULL
 ON CONFLICT(usuario) DO NOTHING;
INSERT INTO public.uk_identidades(usuario)
 SELECT DISTINCT usuario FROM public.afiliados WHERE usuario IS NOT NULL
 ON CONFLICT(usuario) DO NOTHING;
INSERT INTO public.uk_identidades(usuario) VALUES('admin') ON CONFLICT(usuario) DO NOTHING;
-- Perfis existentes: a mesma pessoa conserva dados ao mudar de cliente para afiliado.
INSERT INTO public.uk_perfis(identidade_id,nome,email,telefone)
 SELECT ui.id,c.nome,c.email,COALESCE(c.telefone,'') FROM public.contas c
 JOIN public.uk_identidades ui ON ui.usuario=c.usuario ON CONFLICT(identidade_id) DO NOTHING;
INSERT INTO public.uk_perfis(identidade_id,nome,email,telefone)
 SELECT ui.id,a.nome,a.email,COALESCE(a.telefone,'') FROM public.afiliados a
 JOIN public.uk_identidades ui ON ui.usuario=a.usuario ON CONFLICT(identidade_id) DO NOTHING;
-- Endereços anteriormente informados pelos clientes, se a migration do perfil existir.
DO $$ BEGIN
 IF to_regclass('public.vitrine_endereco_cliente_uk') IS NOT NULL AND
   (SELECT COUNT(DISTINCT column_name) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vitrine_endereco_cliente_uk'
       AND column_name IN ('usuario','destinatario','cep','logradouro','numero','complemento','bairro','cidade','uf'))=9 THEN
  INSERT INTO public.uk_enderecos(identidade_id,destinatario,cep,logradouro,numero,complemento,bairro,cidade,uf)
   SELECT ui.id, COALESCE(e.destinatario,''),COALESCE(e.cep,''),COALESCE(e.logradouro,''),
      COALESCE(e.numero,''),COALESCE(e.complemento,''),COALESCE(e.bairro,''),COALESCE(e.cidade,''),COALESCE(e.uf,'')
   FROM public.vitrine_endereco_cliente_uk e JOIN public.uk_identidades ui ON ui.usuario=e.usuario
   ON CONFLICT(identidade_id) DO NOTHING;
 END IF;
END $$;
-- Favoritos legados (carrinho e sacola são migrados separadamente).
DO $$ BEGIN
 IF to_regclass('public.vitrine_favoritos') IS NOT NULL AND to_regclass('public.vitrine_clientes') IS NOT NULL THEN
  INSERT INTO public.uk_favoritos(identidade_id,produto_id)
   SELECT ui.id, f.produto_id FROM public.vitrine_favoritos f
   JOIN public.vitrine_clientes vc ON vc.id=f.cliente_id
   JOIN public.uk_identidades ui ON ui.usuario=vc.usuario
   ON CONFLICT(identidade_id,produto_id) DO NOTHING;
 END IF;
END $$;

DO $$ BEGIN
 IF to_regclass('checkout_uk.carrinho_itens_guardados') IS NOT NULL
 AND to_regclass('checkout_uk.carrinhos_guardados') IS NOT NULL THEN
   INSERT INTO public.uk_identidades(usuario)
     SELECT DISTINCT usuario FROM checkout_uk.carrinhos_guardados WHERE usuario IS NOT NULL
     ON CONFLICT(usuario) DO NOTHING;
   INSERT INTO public.uk_carrinho_itens(identidade_id,produto_id,variacao_id,quantidade)
     SELECT ui.id,i.produto_id,i.variacao_id,MAX(i.quantidade)
     FROM checkout_uk.carrinho_itens_guardados i
     JOIN checkout_uk.carrinhos_guardados c ON c.id=i.carrinho_id
     JOIN public.uk_identidades ui ON ui.usuario=c.usuario
     GROUP BY ui.id,i.produto_id,i.variacao_id
     ON CONFLICT(identidade_id,produto_id,variacao_id)
     DO UPDATE SET quantidade=GREATEST(public.uk_carrinho_itens.quantidade,EXCLUDED.quantidade),atualizado_em=now();
 END IF;
 IF to_regclass('public.vitrine_carrinho_itens') IS NOT NULL
  AND to_regclass('public.vitrine_carrinhos') IS NOT NULL
  AND to_regclass('public.vitrine_clientes') IS NOT NULL THEN
   INSERT INTO public.uk_carrinho_itens(identidade_id,produto_id,variacao_id,quantidade)
     SELECT ui.id,i.produto_id,i.variacao_id,MAX(i.quantidade)
     FROM public.vitrine_carrinho_itens i
     JOIN public.vitrine_carrinhos c ON c.id=i.carrinho_id
     JOIN public.vitrine_clientes vc ON vc.id=c.cliente_id
     JOIN public.uk_identidades ui ON ui.usuario=vc.usuario
     GROUP BY ui.id,i.produto_id,i.variacao_id
     ON CONFLICT(identidade_id,produto_id,variacao_id)
     DO UPDATE SET quantidade=GREATEST(public.uk_carrinho_itens.quantidade,EXCLUDED.quantidade),atualizado_em=now();
 END IF;
END $$;
COMMIT;
