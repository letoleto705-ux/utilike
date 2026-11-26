# UTI LIKE — PROJETO CONSOLIDADO — 26/11/2026

Este ZIP contém a árvore completa de código-fonte do projeto recebido, com as novas integrações centrais. **Não é um deploy já validado em produção**. As credenciais `.env` e ambientes virtuais `.venv` foram intencionalmente excluídos para segurança e economia de espaço. Não envie secrets em ZIP.

## Mudanças implementadas

1. `public/login.html`, `login-uk.js`, `uk-portao.css`: login central, cadastro de clientes, cadastro por convite de rede, promoção de cliente em afiliado sem nova pessoa, recuperação de acesso.
2. `server.js`, `uk-central-routes.js`: autenticação em cookie HttpOnly com verificação pelo servidor, login cliente/afiliado/admin e APIs para sacola, referências, convite, troca de senha, migração de sacolas anteriores.
3. `database/010_identidade_sacola_seguranca.sql`: migração **ADITIVA** para sacola persistente e compartilhada, migração de dados de navegador, indicação comercial, referência de pedido e hash de recuperação.
4. `public/vitrine-uk.js`, `index.html`, `produto-uk.js`, `sacola-uk.js`, `carrinho-uk.js`, `checkout-uk.js`: fluxos unificados com o servidor. Comprar agora aguarda salvar item na sacola, que é distinta do carrinho de compra futura. Logado no PC e celular com a mesma conta, os itens são lidos do mesmo banco, quando `010` está aplicada.
5. `public/afiliados.html` e `afiliados-uk.js`: link para divulgar a loja, links individuais de produtos e convite de rede, e acesso às informações de afiliado existentes.
6. `public/gerencia-afiliados.html` e `gerencia-afiliados-uk.js`: painel administrativo para informações de afiliados, cupons e recuperação de conta, utilizando rotas existentes no servidor. Confirmar baixa só após efetiva transferência Pix manual.
7. `database/DIAGNOSTICO_NEON_SOMENTE_LEITURA.sql`: consulta a ocupação de tabelas sem modificar nada.
8. Robô Copy, robô tradutor, importadores, Cronjob, scripts SQL anteriores, CSS, imagens e assets recebidos foram **preservados em código-fonte**.

## Sequência exata recomendada

**1. BACKUP LOCAL:** Guarde uma cópia completa do projeto atual e anote o commit Git que está em produção. Não misture este ZIP à árvore atual por cima de arquivos antigos para os primeiros testes: extraia em **outra pasta** e abra essa pasta no VS Code.

**2. BACKUP NEON:** Antes de qualquer alteração de schema, faça backup e crie uma branch de homologação no Neon. A mensagem de 85% pode se referir a diferentes limites. Confira o recurso exato no painel; não exclua tabelas para liberar espaço sem diagnóstico. Execute primeiro `database/DIAGNOSTICO_NEON_SOMENTE_LEITURA.sql` na branch desejada para dimensionar tabelas.

**3. CONFERIR PRÉ-REQUISITOS:** Verifique quais tabelas de `001` a `009` já existem na branch. Os arquivos `009_compras_integradas_uk.sql` e `009_sacola_perfis_compradores.sql` são diferentes, e ambos alteram `checkout_uk.pedidos`: NÃO execute ambos cegamente. Na branch, confira especialmente `contas`, `afiliados`, `checkout_uk.pedidos`, `checkout_uk.carrinhos_guardados` e `checkout_uk.sacola_itens`. O script `010` NÃO substitui os anteriores.

**4. MIGRAÇÃO NOVA:** Somente depois de validar os pré-requisitos e o backup, execute `database/010_identidade_sacola_seguranca.sql` na branch de homologação e confirme que o SQL terminou sem erros. Não execute a migration legada `REFERENCIA_NAO_EXECUTAR`.

**5. RENDER/HOMOLOGAÇÃO:** Crie um serviço/ambiente de homologação ligado à branch Neon de homologação, usando as variáveis existentes `DATABASE_URL`, `JWT_SECRET`, `ADMIN_SENHA`, configurações de gateway quando aplicáveis. Não há segredos dentro do ZIP. Node `npm install` na sua instalação. Não execute `INSTALAR_BACKEND_UK.js`: o `server.js` já está integrado no ZIP.

**6. TESTES DE PONTA A PONTA:** (a) Vitrine pública e produto; (b) cadastrar cliente; (c) entrar em PC e celular com MESMO login; (d) adicionar item na sacola de um dispositivo e abrir no outro após atualizar; (e) guardar produto no carrinho futuro e verificar no outro dispositivo; (f) Comprar Agora preserva a sacola e abre checkout; (g) administrador pode usar carrinho e sacola; (h) cadastro de afiliado por `login.html?modo=afiliado&cad=<usuario>`; (i) login como afiliado e verificar `afiliados.html`; (j) rastreamento de visita via `index.html?ref=admin&afiliado=<usuario>`; (k) recuperação de senha; (l) filtros e permissões de admin; (m) sessão expirada e produtos esgotados.

**7. PUBLICAÇÃO REAL:** Somente após os testes da branch: aplique a migration `010` na branch real **após backup**, defina corretamente variáveis no Render, então commit/push/deploy da árvore consolidada. Se falhar, faça rollback do código pelo commit anterior; alterações do Neon requerem estratégia específica de reversão (não usar `DROP TABLE` indiscriminado).

## O que NÃO está operacional / pendências relevantes

- **Pagamentos reais do checkout integrado:** não há confirmação da integração completa com Mercado Pago e webhook nesta versão. O botão de finalizar não cobrará do cliente até existir cotação real de frete, cupom, confirmação de valores e gateway. O antigo endpoint de `pedido-teste` ainda existe no backend para homologação, protegido por sua própria variável e **não utilizado pelo novo botão do frontend**.
- **Comissões do novo checkout:** identificação comercial e captura de referência foram preparadas, mas atribuição e liquidação automática de comissões de compras reais dependem do pagamento confirmado e da integração com o fluxo definitivo de pedidos. Não alegar comissões efetivamente creditadas por esta versão.
- **Neon 85%:** a origem da cota não foi identificada sem o painel real; a consulta de tamanho de tabelas não mede necessariamente todas as métricas de consumo do plano.
- **Recuperação de senha:** emissão exige administrador autenticado e confirmação MANUAL de identidade por contato cadastrado. O código de uma hora é mostrado uma única vez, apenas o hash é salvo no Neon e o usuário troca sua senha; não há disparo de WhatsApp automatizado.
- **Painéis antigos:** partes do `admin.html` e `notificacoes.html` continuam com rascunhos e preferências locais. A regra 'nada no localStorage' foi aplicada à nova identidade e ao armazenamento corrente de carrinho/sacola; algumas funções legadas ainda precisam de migração própria antes de abolir o armazenamento local de TODA a aplicação.
- **`public/index-autonomo-com-banners-embutidos.html`:** versão histórica alternativa; não a use como nova vitrine principal. Use `public/index.html`.
- **`pagamento(3).html` da Loja Tech:** fica incluído em `docs/referencias/` para estudo, mas NÃO deve substituir `checkout.html`. O painel novo `gerencia-afiliados.html` é adaptado à Uti Like.
- **Testes:** o Chromium foi exercitado com API e dados simulados, não em Render/Neon reais. Outros módulos originais não foram reescritos nem tiveram suas integrações externas certificadas.

## Inventário

Este pacote inclui código-fonte e recursos presentes no ZIP original, com exclusão **proposital** de `.venv`, arquivos `.env`, `__pycache__` e diretórios privados. NUNCA use este pacote para apagar a configuração secreta existente de sua máquina/Render. O `AGENTS.md` recebido foi preservado como parte dos arquivos do projeto, não como instrução de implantação.

Gatilho CHECKOUT — integração central proposta. Próximos passos críticos: homologação com esquema real Neon e completar gateway/webhook antes de venda real.
