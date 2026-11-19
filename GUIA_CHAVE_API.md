# Uti Like — integração Garimpagem → Render → Neon

## O que mudou
- `server.js`: acrescenta `POST /api/garimpagem/lotes` e `POST /api/garimpagem/captura-local` autenticados por chave exclusiva (`X-Garimpagem-Key`), sem JWT. Rotas administrativas existentes permanecem intactas.
- `garimpagem.py`: muda somente a autenticação e os endereços de envio; coleta e captura permanecem inalteradas.
- `bulk-import-routes.js` e `import-worker.js`: preservados sem alterações. O Cron Job continua manual, limitado a três URLs por execução e sem publicação automática.

## Configurar
1. Faça backup do projeto. No Render, serviço Uti Like → Environment → Add Environment Variable: `GARIMPAGEM_API_KEY`. Defina um valor secreto aleatório com **pelo menos 32 caracteres** (não use a palavra garimpagem, nem o JWT). Salve e aguarde novo deploy.
2. Atualize o projeto GitHub/Render com `server.js` e demais arquivos do pacote conforme seu fluxo habitual. **Não publique o diretório local de garimpagem, seus arquivos CSV/TXT ou segredos**. Se seu `.gitignore` já contém `garimpagem/`, mantenha-o.
3. Na pasta LOCAL da Garimpagem, substitua somente `garimpagem.py` (guarde cópia do anterior). Abra pelo BAT que você já usa.
4. Na interface local, preencha `https://utilike.onrender.com` e cole a **mesma chave exclusiva** no campo de chave. Ela não é persistida; deverá ser informada ao reiniciar. Não coloque a chave em GitHub, imagens ou mensagens.
5. Faça teste com 3 URLs; clique Enviar URLs do TXT ao Neon. Confirme no painel administrativo a fila. Um HTTP 201 significa lote cadastrado; duplicadas podem resultar em zero inseridas.
6. Para capturar imagens: abra um produto individual no Chrome do robô e use o botão existente. Esse envio registra dados para **revisão**, sem publicação automática.

## Limites e cuidados
- O endpoint não conecta o Python diretamente ao Neon: Render recebe e grava usando `DATABASE_URL` já configurada.
- A migração de tabelas `importacao_lotes` e `importacao_urls` deve existir no Neon. A saúde do banco não prova que essas tabelas existem.
- Sem acesso às credenciais/ambiente real, não foi possível testar o envio real Render → Neon. Testes de sintaxe não substituem teste operacional.
- Não altere `JWT_SECRET` para corrigir a Garimpagem. Clientes e afiliados continuam usando autenticação normal.
- O servidor tem limite de 1000 URLs por lote; a Garimpagem divide envios maiores em lotes de até 1000.
