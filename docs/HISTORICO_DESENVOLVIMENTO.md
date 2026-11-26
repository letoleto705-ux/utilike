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
