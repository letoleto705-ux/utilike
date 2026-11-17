# Doravante Corrigido — teste do Cron Job

## Instalação
1. Faça backup do repositório atual.
2. Copie o CONTEÚDO da pasta `Doravante/` para a mesma pasta onde estão `server.js`, `package.json`, `public/` e `database/` do seu projeto. Não crie uma segunda pasta Doravante dentro da primeira.
3. Suba as alterações ao GitHub e aguarde o novo deploy no Render (Web Service existente). Não crie outro Render ou Neon.
4. No navegador, faça login como administrador na vitrine, na mesma aba em que abrirá `/cronjob.html`.
5. No painel, clique em `Iniciar importação (até 3 URLs)` e depois `Atualizar fila` para acompanhar.

## Escopo e limitações
- O banco Neon já tem as tabelas de importação e três URLs pendentes. Não é necessário rodar SQL novo.
- O processador seleciona até 3 URLs AliExpress pendentes por execução, registra metadados públicos (título, descrição e imagens quando disponíveis) e atualiza status para `revisao` ou `erro`.
- Preço, estoque, variações e galeria completa não são garantidos. Não existe publicação automática na vitrine nem execução de Selenium/Chromium.
- O AliExpress pode negar acesso ao Render; nesse caso o registro ficará em `erro` com a causa. Para acesso estável, será necessária uma API/feed autorizado.
- Não mexa nas variáveis de ambiente existentes, no checkout ou no schema para esse teste.
- Se precisar testar novamente um registro que ficou em erro, faça isso somente após analisar o erro. Não rode UPDATE indiscriminado.

## Arquivos alterados
- `bulk-import-routes.js` — endpoints administrativos de processamento e status
- `import-worker.js` — novo processador restrito a URLs de produtos AliExpress
- `public/cronjob.html` — botão e área de progresso
- `public/bulk-queue.js` — ações do botão e consulta de progresso
- `package.json` — comando de verificação de sintaxe atualizado

## Verificação
`npm run check` — valida a sintaxe JS, sem acessar Render ou Neon.
