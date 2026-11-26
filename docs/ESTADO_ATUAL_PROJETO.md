# Estado atual do projeto

## Visão geral

O projeto usa Node.js, Express, PostgreSQL/Neon e frontend HTML/CSS/JavaScript. O ponto de entrada é `server.js`, que serve `public/` e registra APIs de autenticação, vitrine, administração, fornecedores, automação e checkout UK.

## Módulos preservados

- Vitrine e carrinho UK.
- Minha Conta e autenticação.
- Checkout UK em homologação.
- CJ Dropshipping, curadoria, publicação e reprecificação.
- Importação, Cronjob e Precificação Central.
- Robô Copy e Robô Tradutor.
- APIs e dados de afiliados.
- `admin_operacoes.html`, classificado como ativo para operações administrativas.

## Checkout

`public/checkout.html`, `public/checkout-uk.js` e `checkout-uk-routes.js` formam o fluxo oficial atual. O fluxo ainda é de homologação: calcula o subtotal, valida cliente/produtos e pode gravar pedido de teste quando `CHECKOUT_UK_TEST_MODE=true`; não realiza cobrança real.

## Banco e migrações

As migrações 001–008 estão no diretório `database/`. A migração 008 cria o schema `checkout_uk` e foi preservada, mas não foi executada nesta fase. O estado real do Neon não foi consultado.

## Implementado, testado e homologado

- **Implementado:** código dos módulos descritos e rotas registradas.
- **Testado:** sintaxe JavaScript e teste local do publicador do Robô Copy.
- **Homologado:** nenhum fluxo de produção foi homologado nesta limpeza.
- **Pendente:** frete, cupons, pagamento, webhook e validação do checkout UK no Neon de teste.

## Próximo gatilho

CHECKOUT: validar o schema 008 em branch de teste e completar o fluxo sem cobrança real antes de qualquer integração de pagamento.

## Investigação de estabilidade após c31d5eb

O commit c31d5eb apresenta localmente `ReferenceError` na inicialização por remoção da função compartilhada `lerCatalogoPublico`. A correção local restaura as duas funções de catálogo e o filtro compartilhado; a inicialização e rotas selecionadas foram verificadas com banco simulado, sem SQL real. Os logs completos do Render ainda são necessários para confirmar a exceção observada no deploy; os fluxos autenticados e o ambiente de produção não foram homologados.
