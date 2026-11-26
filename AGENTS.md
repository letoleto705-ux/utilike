# Uti Like — instruções permanentes

## Identidade

Uti Like é uma plataforma de comércio eletrônico em Node.js, Express e PostgreSQL/Neon, hospedada no Render. O frontend está em `public/`; integrações, automações e módulos de fornecedores ficam na raiz, em `robot/` e em `robo-copy/`.

## Regras

- Preservar funcionalidades existentes e trabalhar em alterações pequenas.
- Não duplicar módulos nem misturar gatilhos sem autorização.
- Não expor credenciais, dados pessoais ou tokens.
- Não executar SQL, migrações, cobranças ou deploys sem autorização específica.
- Não excluir arquivos fora do escopo autorizado.
- Executar verificações seguras antes de concluir.
- Não executar `git add .`, commit, push, merge, reset ou rebase sem autorização explícita.

## Gatilhos

- **VITRINE:** catálogo, busca, categorias, produto, conta, carrinho e experiência visual.
- **CHECKOUT:** checkout UK, cliente, pedido, frete, cupons e futura integração de pagamento.
- **CRONJOB:** automações, sincronização e publicação.
- **ROBÔ COPY:** geração e publicação de textos comerciais.
- **ROBÔ TRADUTOR:** tradução, aprovação e publicação PT-BR.
- **AFILIADOS:** APIs e dados preservados, interface antiga removida nesta fase.

## Continuidade

## IDENTIDADE DO PROJETO

- Nome: Uti Like.
- Plataforma de comercio eletronico.
- Frontend: HTML, CSS e JavaScript.
- Backend: Node.js e Express.
- Banco de dados: Neon PostgreSQL.
- Hospedagem: Render.
- Desenvolvimento: VS Code e Git.
- Ambiente local: Windows 10.

## GATILHOS DE DESENVOLVIMENTO

- **VITRINE:** `index.html`, apresentacao dos produtos, pesquisa, categorias, detalhes e experiencia visual.
- **CHECKOUT:** `checkout.html`, carrinho, identificacao de clientes, enderecos, pedidos e pagamentos.
- **CRONJOB:** automacoes, importacoes, fornecedores e sincronizacoes.
- **CJ:** integracao, importacao, publicacao e reprecificacao.
- **ROBO COPY:** textos comerciais por IA local.
- **ROBO TRADUTOR:** traducao dos produtos.
- **AFILIADOS:** modulo independente, sujeito a autorizacao especifica.

Os gatilhos devem permanecer separados.

## REGRAS PERMANENTES

1. Preservar todas as funcionalidades existentes.
2. Nao reconstruir modulos do zero sem autorizacao.
3. Nao excluir arquivos antigos apenas por parecerem desnecessarios.
4. Nao alterar modulos fora do gatilho autorizado.
5. Nao executar SQL de producao sem autorizacao.
6. Nao modificar credenciais.
7. Nao realizar cobrancas reais durante testes.
8. Nao fazer commit ou push sem autorizacao expressa.
9. Executar testes adequados apos alteracoes.
10. Documentar cada servico realizado.
11. Diferenciar codigo implementado, testado e homologado.
12. Nunca afirmar que uma alteracao funciona em producao apenas por passar na verificacao de sintaxe.

## HISTÓRICO DE PROCESSOS E ALTERAÇÕES

O historico deve permanecer em ordem cronologica e registrar somente fatos verificados. Para cada tarefa futura, utilizar este modelo:

**Data:**
**Gatilho:**
**Solicitacao do administrador:**
**Diagnostico realizado:**
**Arquivos analisados:**
**Arquivos modificados:**
**Arquivos criados:**
**Arquivos excluidos:**
**Alteracoes no backend:**
**Alteracoes no frontend:**
**Alteracoes no banco de dados:**
**Testes executados:**
**Resultado dos testes:**
**Commit realizado:** Sim/Nao
**Push realizado:** Sim/Nao
**Situacao atual:** Concluido/Parcial/Bloqueado
**Pendencias:**
**Proxima etapa recomendada:**

### Registro inicial - documentacao local

**Data:** 2026-11-25
**Gatilho:** Documentacao de continuidade
**Solicitacao do administrador:** Criar ou completar este manual local e adicionar sua regra ao `.gitignore`.
**Diagnostico realizado:** O arquivo ja existia e estava rastreado pelo Git; seu conteudo original foi preservado e as secoes solicitadas foram acrescentadas.
**Arquivos analisados:** `AGENTS.md`, `.gitignore` e estado do Git.
**Arquivos modificados:** `AGENTS.md`, `.gitignore`.
**Arquivos criados:** Nenhum; `AGENTS.md` ja existia.
**Arquivos excluidos:** Nenhum.
**Alteracoes no backend:** Nenhuma.
**Alteracoes no frontend:** Nenhuma.
**Alteracoes no banco de dados:** Nenhuma.
**Testes executados:** Verificacao de existencia, secoes, regra de ignore, rastreamento e `git status --short`.
**Resultado dos testes:** As secoes e a regra foram confirmadas. O `AGENTS.md` continua rastreado pelo Git, portanto o ignore nao interrompe seu rastreamento atual.
**Commit realizado:** Nao
**Push realizado:** Nao
**Situacao atual:** Concluido
**Pendencias:** Remover o arquivo do indice do Git somente mediante autorizacao explicita, caso ele precise se tornar exclusivamente local.
**Proxima etapa recomendada:** Consultar este arquivo antes de qualquer novo servico.

## REGRA DE CONTINUIDADE

Antes de iniciar um novo servico, consultar este arquivo para compreender o contexto do projeto. Ao concluir uma alteracao autorizada, atualizar o historico com as operacoes efetivamente realizadas. O historico deve ser compreensivel para o administrador e nunca deve conter senhas, tokens, dados pessoais ou connection strings.

Antes de iniciar uma tarefa, consultar este arquivo, `docs/HISTORICO_DESENVOLVIMENTO.md`, `docs/ESTADO_ATUAL_PROJETO.md`, o código do módulo e os testes correspondentes.

Nenhuma funcionalidade deve ser descrita como homologada sem evidência no ambiente pretendido.

### Registro - integracao local Vitrine, Sacola e Checkout

**Data:** 2026-11-25
**Gatilho:** VITRINE e CHECKOUT
**Solicitacao do administrador:** Integrar a vitrine, uma sacola independente, compra direta, carrinho existente e o checkout, sem commit, push, deploy, SQL, pagamentos reais ou alteracoes nos demais gatilhos.
**Diagnostico realizado:** O projeto possuia carrinho persistente no Neon e checkout existente, mas nao possuia uma sacola independente para visitantes. O checkout tambem apresentava faixa visual de etapas e valores iniciais ficticios no HTML.
**Arquivos analisados:** `AGENTS.md`, `docs/HISTORICO_DESENVOLVIMENTO.md`, `docs/ESTADO_ATUAL_PROJETO.md`, `public/index.html`, `public/produto.html`, `public/produto-uk.js`, `public/vitrine-uk.js`, `public/carrinho.html`, `public/carrinho-uk.js`, `public/checkout.html`, `public/checkout-uk.js`, `vitrine-routes.js`, `checkout-uk-routes.js` e testes relacionados.
**Arquivos modificados:** `public/index.html`, `public/produto-uk.js`, `public/vitrine-uk.js`, `public/checkout.html`, `public/checkout-uk.js`, `vitrine-routes.js` e `checkout-uk-routes.js`.
**Arquivos criados:** `public/sacola.html`, `public/sacola-uk.js` e `tests/checkout-sacola.test.js`.
**Arquivos excluidos:** Nenhum.
**Alteracoes no backend:** A resposta publica de recomendacoes passou a informar variacoes publicas; o checkout passou a aceitar ate 100 itens da sacola e exigir variacao quando o produto possui variacoes. Os precos continuam sendo validados no backend.
**Alteracoes no frontend:** A sacola independente usa armazenamento local do navegador, possui contagem propria, permite adicionar sem login, recuperar itens apos autenticacao, alterar quantidades e iniciar o checkout. A vitrine e a pagina de produto foram conectadas a adicionar a sacola e compra direta. O checkout deixou de exibir a faixa azul de etapas e valores ficticios iniciais.
**Alteracoes no banco de dados:** Nenhuma. Nao foi executado SQL, migracao, pedido ou pagamento.
**Testes executados:** `git diff --check`; `npm.cmd run check`; verificacao de sintaxe JavaScript dos arquivos alterados e modulos preservados; `node --test tests/checkout-sacola.test.js`; `node testes/testar-robo-copy-publicador.js`; `node --test tests/etapa7.test.js`.
**Resultado dos testes:** As verificacoes de sintaxe, o check do projeto, o contrato da sacola e o teste do Robô Copy passaram. `tests/etapa7.test.js` permaneceu com 1 teste aprovado e 3 falhos, pelos mesmos problemas preexistentes de `pool.connect` no mock e da expectativa do sincronizador. Nao houve homologacao autenticada contra Neon ou Render.
**Commit realizado:** Nao
**Push realizado:** Nao
**Situacao atual:** Parcial
**Pendencias:** Validar visualmente com servidor local e ambiente de teste autenticado, confirmar catalogo e fluxo de checkout sem producao, e revisar os tres testes legados quando o mock do banco puder ser corrigido.
**Proxima etapa recomendada:** Executar a homologacao local com credenciais de teste, sem criar pedidos nem cobranças, e somente depois avaliar eventual publicacao autorizada.

### Registro - correção integrada de compras, perfis e frete embutido

**Data:** 2026-11-25  
**Gatilho:** CHECKOUT, dependências mínimas da VITRINE  
**Solicitação do administrador:** Preservar o login existente em `index.html`; permitir compra com sessão de cliente, afiliado ou administrador; adicionar Comprar agora à sacola inteira, manter o carrinho futuro isolado, destacar o frete já embutido pela Precificação Central sem cobrança dupla, recuperar endereço do cadastro e organizar controles de conta e sacola.  
**Diagnóstico:** A compra direta anterior enviava um único item; o checkout aceitava apenas o perfil cliente; a sacola usava a mesma chave local para todos; `produto.html` não possuía ícone/contador de sacola; o backend tratava todo frete como pendente apesar do campo de preço `freteEstimado`.  
**Arquivos alterados:** `checkout-uk-routes.js`, `vitrine-routes.js`, `public/index.html`, `public/vitrine-uk.js`, `public/produto.html`, `public/produto-uk.js`, `public/sacola-uk.js`, `public/carrinho-uk.js`, `public/minha-conta.html`, `public/minha-conta-uk.js`, `public/checkout.html`, `public/checkout-uk.js`, `tests/checkout-sacola.test.js` e este arquivo.  
**Arquivo criado:** `database/009_sacola_perfis_compradores.sql` (migração preparada, **NÃO executada**).  
**Arquivos excluídos:** Nenhum.  
**Banco de dados:** Nenhum acesso ao Neon de produção realizado. A persistência da sacola entre dispositivos e o rascunho administrativo dependem de revisão e aplicação manual da migração 009, após backup. Sem ela a sacola utiliza armazenamento local separado por perfil.  
**Frete:** A Precificação Central soma o frete ao custo antes do cálculo de `precoPor` e registra `freteEstimado`. O checkout informa `subtotalSemFrete + freteEmbutido = total`, sem cobrança dupla. Zero representa frete grátis. Ausência do campo NÃO representa frete grátis.  
**Pagamento:** Mercado Pago e webhooks não alterados nem ativados; pedido-teste continua dependendo de `CHECKOUT_UK_TEST_MODE=true`.  
**Testes:** `node --check` nos JavaScripts envolvidos e checagem de sintaxe dos scripts inline; oito verificações `node --test tests/checkout-sacola.test.js` aprovadas, incluindo perfis, cálculo do frete, isolamento de contas e alterações da sacola. Visualização estática do checkout em 1366 px e 390 px sem overflow horizontal. A execução end-to-end em navegador com backend real não foi possível no ambiente de análise (navegação bloqueada), e requer homologação local.  
**Commit realizado:** Não  
**Push realizado:** Não  
**Situação atual:** Implementação preparada para homologação; não considerar produção concluída.  
**Pendências:** Validar integração com o repositório completo no VS Code, revisar e aprovar SQL 009, aplicar em ambiente apropriado, realizar testes reais de login/conta/sacola/checkout e confirmar o campo `freteEstimado` dos produtos publicados antes do deploy.

### Registro - auditoria de carrinho, referências e enquadramento

**Data:** 2026-11-26
**Gatilho:** VITRINE e CHECKOUT
**Solicitação do administrador:** Auditar e corrigir referências `ref`/`afiliado`, erro interno de `carrinho.html`, vínculo do carrinho à sessão/perfil, favoritos, Sacola e layout responsivo, sem SQL, pagamento ou deploy.
**Diagnóstico realizado:** As rotas do carrinho consultavam somente `checkout_uk.carrinhos_guardados`/`carrinho_itens_guardados`, embora o conjunto de identidade mais novo disponibilize `public.uk_identidades`/`public.uk_carrinho_itens`; isso causa erro 500 quando a migration 009 não está presente. A rota também convertia afiliado para cliente ao criar o carrinho, divergindo da consulta do checkout. O favorito da página de produto bloqueava qualquer perfil diferente de cliente no frontend.
**Arquivos analisados:** `vitrine-routes.js`, `checkout-uk-routes.js`, `uk-central-routes.js`, `public/vitrine-uk.js`, `public/carrinho-uk.js`, `public/produto.html`, `public/produto-uk.js`, `public/index.html`, `public/checkout.html`, `public/checkout-uk.js`, migrations 006/009/010 e testes existentes.
**Arquivos modificados:** `vitrine-routes.js`, `checkout-uk-routes.js`, `public/vitrine-uk.js`, `public/produto-uk.js`, `public/index.html`, `public/checkout.html`, `public/checkout-uk.js` e este arquivo.
**Arquivos criados:** Nenhum.
**Arquivos excluídos:** Nenhum.
**Alterações no backend:** Seleção compatível entre tabelas de identidade e schema legado; carrinho agora é indexado pelo usuário autenticado, sem usar ID do corpo; checkout consulta o mesmo armazenamento; favoritos usam identidade para admin/afiliado quando disponível; endereço do checkout pode ser recuperado de `public.uk_enderecos`.
**Alterações no frontend:** Captura e propagação de `ref`/`afiliado`; favoritar respeita a sessão ativa; feedback da Sacola ficou explícito; links internos preservam contexto; checkout foi reordenado para produtos, cupom, endereço e resumo, com contenção de overflow; busca/cabeçalho foram reorganizados responsivamente.
**Alterações no banco de dados:** Nenhuma. Nenhum SQL foi executado.
**Testes executados:** `node --check` nos módulos alterados, `npm.cmd run check`, `git diff --check` e `node --test tests/checkout-sacola.test.js`.
**Resultado dos testes:** Sintaxe e check do projeto passaram. O teste legado `tests/checkout-sacola.test.js` permaneceu incompatível com o estado atual (8 falhas, incluindo expectativas antigas de contrato e mock incompleto); não houve acesso autenticado ao Neon/Render. A validação runtime especializada não estava disponível como ferramenta executável nesta sessão e não foi simulada.
**Commit realizado:** Não
**Push realizado:** Não
**Situação atual:** Parcial, preparada para homologação local.
**Pendências:** Confirmar no Neon de homologação qual conjunto de migrations está instalado; testar login admin/cliente/afiliado, carrinho, favoritos, referência e checkout sem criar pedido; validar visualmente em Render antes de publicar.
**Próxima etapa recomendada:** Executar smoke test autenticado em ambiente de homologação, sem cobrança, e revisar os testes legados para o contrato atual.
