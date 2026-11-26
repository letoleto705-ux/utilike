# AUDITORIA E LIMITES — UTI LIKE

## Problema observado
A mesma conta admin apresentava sete produtos de sacola no celular e cinco no PC; a sacola anterior era persistida no `localStorage`, que não sincroniza entre dispositivos. Existia também carrinho futuro separado e múltiplos SQL `009` conflitantes. A mudança principal cria sacola de servidor e reaproveita carrinho futuro persistente.

## Segurança e vínculo comercial
- Uma conta lógica por `usuario` no Neon; cliente e afiliado compartilham o mesmo identificador. Perfil administrativo continua separado e não pode ser reivindicado por URL.
- O endereço `?ref=admin&afiliado=<apelido>` identifica **origem comercial**, não permissão. Convite de rede `login.html?modo=afiliado&cad=<apelido>` é separado. O backend valida o apelido e assina cookies para atribuição de visita (30 dias, primeiro indicador válido); esta política é proposta e deve ser aprovada antes de remunerar vendas.
- O sistema de comissões existente foi preservado e o painel administrativo novo expõe rotas antigas. O checkout novo não cria comissões pagas antes de confirmação de pagamento, que não está integrada aqui.
- Cookies assinados HttpOnly protegem a sessão de API. Não se armazenam novas sacolas ou tokens de recuperação em browser storage. Alguns arquivos legados ainda usam localStorage e devem ser auditados independentemente.
- Token de recuperação: código aleatório de 128 bits, somente hash HMAC gravado no Neon, uso único, validade uma hora, até cinco tentativas; a autenticação via suporte exige confirmação manual de identidade.

## Dependências e risco
- Migration `010` cria tabelas; os dois scripts `009` anteriores são distintos e não devem ser aplicados cegamente no mesmo banco. A estrutura real da branch Neon não foi verificada.
- `checkout-uk-routes.js` usa consulta de produtos pública e autenticação nas operações privadas. Sem acesso ao gateway atual, o checkout ainda não executa cobrança.
- Admin e diversas telas legadas foram preservados. Nem toda interface administrativa está efetivamente alimentada pelo Neon.
- Não houve implantação em Render, execução de SQL ou alterações de contas reais.

## Arquivos novos mais importantes
`uk-central-routes.js`, `database/010_identidade_sacola_seguranca.sql`, `public/login.html`, `public/login-uk.js`, `public/afiliados.html`, `public/afiliados-uk.js`, `public/gerencia-afiliados.html`, `public/gerencia-afiliados-uk.js`.

## Teste realizado
Browser emulado 360/1366 px com backend simulado: duas sessões consultaram a mesma sacola do mock, adicionaram e alteraram quantidades, sem depender do storage local. Sintaxe dos JS verificada em Node. Isso NÃO é validação de Neon, autenticação real, CPF, webhook, frete ou pagamentos.
