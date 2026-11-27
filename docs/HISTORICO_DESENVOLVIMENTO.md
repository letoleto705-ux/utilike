# Histórico de desenvolvimento — Uti Like

## Registro — correção integrada de convite, vitrines e checkout — 2026-11-26

**Gatilho:** VITRINE, CHECKOUT e AFILIADOS
**Solicitação:** Corrigir URL de convite sem duplicação, login limpo para convidados, vitrines completas no Carrinho/Sacola e enquadramento do checkout, preservando o Produto Teste local.
**Arquivos modificados:** `public/vitrine-uk.js`, `public/login-uk.js`, `public/checkout-uk.js` e `checkout-uk-routes.js`.
**Diagnóstico confirmado:** O contexto era apenas mesclado por `set` condicional; o login permitia autofill; o Carrinho carregava uma página de 12 produtos e a Sacola não tinha espelho; o checkout não recebia descrição estruturada.
**Produto Teste:** ID `produto-teste`, SKU `UTI-TESTE-100`, R$ 100,00; dados locais em `uk_produto_teste_v1`, `uk_produto_teste_id_v1`, `uk_produto_teste_sku_v1` e `uk_produto_teste_resultado_v1`.
**Banco/pagamento:** Nenhum SQL, pedido real, cobrança, fornecedor, Mercado Pago ou acesso ao Neon foi executado.
**Testes:** `node --check`, `npm.cmd run check`, `node --test tests/entrega-integrada.test.js` e `git diff --check` passaram; `npm test` não existe no projeto.
**Commit/Push/Deploy:** Não realizados.
**Situação:** Implementado e testado localmente; não homologado em Neon/Render.
**Próxima etapa:** Validar visualmente em navegador e executar o roteiro manual com contas de teste, sem habilitar cobrança.

## Fase 1 — limpeza e consolidação

**Data:** 2026-11-25
**Gatilho:** limpeza de códigos legados
**Objetivo:** remover páginas antigas e o checkout legado, preservando o checkout UK e os módulos operacionais.

### Ações realizadas

- Removidos `public/afiliados.html`, `public/checkout-da-sacola.html` e `public/status_compra.html`.
- Removidas referências de navegação às páginas excluídas.
- Removidas as rotas e o webhook exclusivos do checkout legado em `server.js`.
- Preservadas as APIs, tabelas e dados de afiliados.
- Mantido `admin_operacoes.html` por utilizar operações administrativas atuais.
- Mantido `database/008_checkout_uti_like.sql` sem execução.
- Criados `AGENTS.md` e `docs/ESTADO_ATUAL_PROJETO.md`.

### Verificações

- `node --check` nos arquivos JavaScript: passou.
- Busca por referências às páginas removidas e rotas antigas: nenhuma ocorrência fora do histórico/documentação.
- `node testes/testar-robo-copy-publicador.js`: passou.
- `node --test tests/etapa7.test.js`: 1 teste passou e 3 falharam por mocks/expectativas incompatíveis com o código atual; nenhuma falha foi mascarada.
- Git: alterações locais presentes; nenhum `git add`, commit ou push executado.

### Pendências

- Homologar o checkout UK em branch de teste do Neon.
- Implementar frete, cupons e pagamentos em fases futuras autorizadas.
- Reavaliar e atualizar testes legados incompatíveis.

## Verificação final antes da publicação

**Data:** 2026-11-25

- Branch confirmada: `main`.
- Remote `origin` confirmado como `https://github.com/letoleto705-ux/utilike.git`.
- `checkoutHabilitado` mantido como `false`; a navegação para inspeção do checkout UK permanece, mas a API não anuncia checkout comercial.
- `CHECKOUT_UK_TEST_MODE` não foi verificado no Render; no código, o padrão é desabilitado e o pedido de teste exige valor explícito `true`.
- Sintaxe JavaScript, rotas essenciais, referências legadas e arquivos preservados foram conferidos.
- Um BOM UTF-8 não intencional causado pela edição anterior foi removido dos arquivos afetados.
- Corrigido o fechamento condicional em `public/minha-conta-uk.js` após a remoção do acesso antigo de afiliados.
- Nenhum pedido, cobrança, SQL, migração ou acesso ao Neon de produção foi executado.

## Investigação de inicialização após c31d5eb

**Data:** 2026-11-25
**Gatilho:** estabilidade do servidor

- O deploy no Render foi informado como falho; o log completo e a primeira exceção do Render não estavam disponíveis para confirmação.
- No Node.js 26.13.1, a inicialização local do commit c31d5eb reproduziu `ReferenceError: lerCatalogoPublico is not defined` em `server.js:861`, durante o registro da vitrine, antes de conectar ao banco. A limpeza removeu as funções compartilhadas de catálogo e o filtro CJ, apesar de ainda serem necessários às rotas atuais.
- Em `server.js`, restauradas somente `lerCatalogoSincronizado`, `lerCatalogoPublico` e a importação do filtro existente; o checkout legado não foi restaurado.
- `npm run check` passou. Com `pg.Pool.query` simulado em memória e conexão real bloqueada, o servidor iniciou e `/api/produtos` e `/api/vitrine/catalogo` responderam 200; carrinho, administração e perfil do checkout UK responderam 401 sem autenticação; login vazio respondeu 401. Uma expectativa inicial incorreta de 400 para login foi corrigida para o comportamento observado e o teste passou.
- Busca pelas páginas removidas e pelas rotas antigas de checkout e webhook no servidor e frontend não encontrou ocorrências. Não houve SQL real, cobrança ou acesso ao Neon. Os fluxos autenticados, dados reais e o deploy Render não foram homologados; falta conferir os logs do deploy.
\n+## Registro complementar — entrega integrada 2026-11-26\n+\n+Implementação registrada em `docs/ESTADO_ATUAL_PROJETO.md`; testes focados, sintaxe e `npm.cmd run check` passaram. Nenhum SQL, pagamento, commit, push ou deploy foi executado.

## Registro — ajustes integrados de interface e vitrines 2026-11-26

**Gatilho:** VITRINE, CHECKOUT e AFILIADOS.
**Solicitação:** Corrigir cabeçalho mobile/desktop, vitrine espelhada do login/carrinho/sacola, enquadramento do checkout, links de convite e cópia responsiva, sem SQL, pagamentos, commit, push ou deploy.
**Diagnóstico:** O cartão administrativo mobile não acionava a área de opções; a identificação do usuário não tinha bloco nome/papel; login, carrinho e sacola não tinham todas as vitrines com rolagem própria; preço do carrinho ficava junto da imagem; checkout mostrava descrição extensa e só o nome era clicável; links de afiliado e botão de cópia não tinham canonização/feedback uniforme.
**Arquivos modificados:** `public/index.html`, `public/login-uk.js`, `public/carrinho-uk.js`, `public/sacola-uk.js`, `public/checkout-uk.js`, `public/vitrine-uk.js`, `public/afiliados-uk.js`.
**Banco/pagamentos:** Nenhum SQL foi executado; nenhum pedido real, pagamento, fornecedor, commit, push ou deploy foi executado.
**Testes:** `node --check` nos JavaScripts alterados, validação dos scripts inline de `index.html` e `login.html`, `npm.cmd run check`, `node --test tests/entrega-integrada.test.js tests/afiliados-3-niveis.test.js` e `git diff --check`.
**Resultado:** Verificações passaram; homologação visual/autenticada local ainda é necessária.
**Situação:** Preparado para revisão local; não homologado em produção.

## Registro — pós-cadastro e patrocinador direto 2026-11-26

**Gatilho:** AFILIADOS.
**Solicitação:** Exigir login próprio após cadastro de afiliado, limpar link de produto e destacar o patrocinador direto, sem vitrine exclusiva, SQL, pagamentos, commit, push ou deploy.
**Diagnóstico:** O cadastro retornava usuário autenticado e redirecionava diretamente ao painel; o painel não possuía limpeza do link específico nem saudação com patrocinador.
**Arquivos modificados:** `public/login-uk.js`, `public/afiliados.html`, `public/afiliados-uk.js`.
**Banco/pagamentos:** Nenhum SQL, pagamento, commit, push ou deploy foi executado.
**Testes:** `node --check`, validação dos scripts inline, `npm.cmd run check`, testes integrados de afiliados e `git diff --check`.
**Resultado:** Verificações passaram; falta homologação visual autenticada no navegador local.
**Situação:** Preparado para revisão local.

## Registro — aprovação pendente e gerência de afiliados 2026-11-26

**Gatilho:** AFILIADOS.
**Solicitação:** Criar ID automático, manter hierarquia de até três gerações, deixar novos afiliados pendentes por até 72 horas e adicionar aprovação/busca na Gerência de Afiliados.
**Diagnóstico:** O cadastro gerava ID e patrocinador, mas ativava imediatamente; a gerência não possuía aprovação nem seleção dinâmica para recuperação/comunicados.
**Arquivos modificados:** `server.js`, `public/gerencia-afiliados.html`, `public/gerencia-afiliados-uk.js`.
**Comissões:** Nenhuma fórmula ou rotina de cálculo central foi alterada.
**Banco/pagamentos:** Nenhum SQL foi executado; nenhuma cobrança, commit, push ou deploy foi executado. Foram apenas preparadas garantias de colunas no bootstrap existente.
**Testes:** `node --check`, validação inline, `npm.cmd run check`, testes integrados de afiliados e `git diff --check`.
**Situação:** Preparado para revisão local e aplicação controlada do schema no ambiente autorizado.

## Registro — persistência da referência do afiliado autenticado 2026-11-26

**Gatilho:** AFILIADOS e VITRINE.
**Solicitação:** Manter a referência do usuário afiliado autenticado visível na barra de endereço durante a navegação, preservando prioridade da URL e fallback de 15 dias.
**Diagnóstico:** A referência dependia apenas de parâmetros presentes na URL ou do estado temporário salvo; quando ambos desapareciam, a navegação mostrava somente o nome da página.
**Arquivo modificado:** `public/vitrine-uk.js`.
**Alteração:** Após consultar a sessão autenticada, o frontend reconstrói `?afiliado=usuario` apenas para afiliados, sem substituir `ref` ou `afiliado` explícitos na URL.
**Banco/pagamentos:** Nenhum SQL, pagamento, commit, push ou deploy foi executado.
**Testes:** `node --check`, validação dos scripts inline, `npm.cmd run check`, testes integrados de afiliados e `git diff --check`.
**Situação:** Preparado para revisão local.

## Registro — inicializador local seguro 2026-11-27

**Gatilho:** preparação do ambiente local Windows 10.
**Solicitação:** Criar um iniciador para abrir a Uti Like em `http://localhost:3000` usando exclusivamente o PostgreSQL local `127.0.0.1:5432/utilike_local`, sem expor senha, sem migrar banco e sem executar o servidor durante a preparação.
**Diagnóstico:** O `server.js` carrega rotas operacionais e os módulos CJ, cronjob e reprecificação criavam timers de agendamento durante o bootstrap. Também havia endpoints administrativos capazes de importar, consultar fornecedor, sincronizar e publicar.
**Arquivos criados:** `INICIAR_UTI_LIKE_LOCAL.bat`.
**Arquivos modificados:** `server.js`, `cj-dropshipping-routes.js`, `cj-reprecificacao.js` e este histórico.
**Arquivos excluídos:** Nenhum.
**Banco/dados:** Nenhuma migração, exclusão, SQL manual, consulta ao Neon, alteração de produção ou pagamento executado. O inicializador não altera `.env`.
**Proteção local:** `UTI_LIKE_LOCAL_SAFE_MODE=true` desliga os timers de cronjob, sincronização CJ e reprecificação CJ; operações não-GET dos módulos de importação, publicação, automação, precificação, CJ e garimpagem são bloqueadas com HTTP 423 durante a execução local.
**Credenciais:** O BAT solicita as senhas com `Read-Host -AsSecureString`, não grava senha em arquivo e cria `DATABASE_URL` em memória com host local, banco local e SSL desabilitado. O segredo JWT é efêmero por execução.
**Testes executados:** `node --check` nos módulos JavaScript modificados e `git diff --check`; inspeção textual do BAT sem executá-lo.
**Resultado:** Preparação concluída e não executada; não houve inicialização do servidor, abertura de conexão PostgreSQL ou homologação do fluxo.
**Commit/Push/Deploy:** Não realizados.
**Situação:** Concluído quanto à preparação; pendente executar manualmente o BAT e validar o ambiente local.

## Registro — credenciais locais persistentes com DPAPI 2026-11-27

**Gatilho:** inicialização local automática da Uti Like.
**Solicitação:** Evitar novas perguntas de senha no iniciador, armazenando as credenciais protegidas e oferecendo redefinição manual.
**Backup:** O BAT anterior foi preservado fora do projeto em `%LOCALAPPDATA%\UtiLikeLocal\backups\` antes da modificação.
**Arquivos criados:** `REDEFINIR_CREDENCIAIS_UTI_LIKE_LOCAL.bat`.
**Arquivos modificados:** `INICIAR_UTI_LIKE_LOCAL.bat` e este histórico.
**Proteção:** As senhas são convertidas com DPAPI via `ConvertFrom-SecureString`, vinculadas ao usuário Windows atual e armazenadas fora do projeto em `%LOCALAPPDATA%\UtiLikeLocal\credentials.json`.
**Redefinição:** Executar `REDEFINIR_CREDENCIAIS_UTI_LIKE_LOCAL.bat` quando uma senha for alterada; o fluxo solicita novamente as credenciais e substitui o arquivo protegido.
**Banco/ambiente:** Mantidos `127.0.0.1:5432/utilike_local`, `PGSSLMODE=disable`, porta 3000 e `UTI_LIKE_LOCAL_SAFE_MODE=true`. Nenhuma migração, alteração de registro, conexão ao banco, Neon, Render, Cronjob ou robô foi executada.
**Testes:** Inspeção do BAT, verificação de ausência de senha literal e `git diff --check`; o servidor não foi iniciado.
**Situação:** Preparado para inicialização automática; ainda não homologado em execução.

## Registro — organização do controle de código-fonte 2026-11-27

**Gatilho:** organização do Git do projeto Uti Like.
**Solicitação:** Consolidar o `.gitignore`, preservar `package-lock.json`, não apagar nem reverter alterações e revisar as proteções de desenvolvimento local sem executar operações Git de staging ou publicação.
**Arquivo modificado:** `.gitignore`.
**Revisão realizada:** `server.js`, `cj-dropshipping-routes.js` e `cj-reprecificacao.js` foram revisados estaticamente. O modo seguro só é ativado com `UTI_LIKE_LOCAL_SAFE_MODE=true`; sem essa variável, o comportamento de produção permanece no caminho normal. Hosts locais usam SSL desabilitado e hosts externos continuam usando SSL.
**Proteção de arquivos:** `node_modules/`, ambientes `.env`, backups e temporários passaram a ser ignorados; `package-lock.json`, migrations e arquivos reais do projeto permanecem elegíveis para versionamento.
**Testes:** `npm.cmd run check`, `git diff --check` e `git check-ignore` para confirmar as regras e as exceções.
**Git:** Nenhum `git add`, commit, push, deploy, Neon ou Render foi executado.
**Situação:** Concluído; staging futuro deve ser seletivo e revisar as alterações preexistentes de `server.js` antes do commit.
