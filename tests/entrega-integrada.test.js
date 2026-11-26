'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('indicação híbrida mantém sessão separada e expiração de 15 dias',()=>{
 const route=read('uk-central-routes.js');
 assert.match(route,/INDICATION_COOKIE='uk_indicacao'/);
 assert.match(route,/INDICATION_MAX_AGE=15\*86400/);
 assert.match(route,/expiresIn:'15d'/);
 assert.match(route,/uk_sessao/);
});

test('carrinho seleciona itens, mantém guardados e possui vitrine espelhada responsiva',()=>{
 const cart=read('public/carrinho-uk.js');
 assert.match(cart,/uk_checkout_selecao_itens/);
 assert.match(cart,/origem=carrinho/);
 assert.match(cart,/Adicione mais produtos ao seu carrinho/);
 assert.match(cart,/cart-mirror-grid/);
 assert.match(cart,/localTestItem/);
});

test('Produto Teste é local, fixo em 100 e não depende da API de catálogo',()=>{
 const shared=read('public/vitrine-uk.js'),checkout=read('public/checkout-uk.js');
 assert.match(shared,/TEST_ID='produto-teste'/);
 assert.match(shared,/precoPor:100/);
 assert.match(shared,/uk_produto_teste_v1/);
 assert.match(shared,/if\(this\.ehProdutoTeste\(produtoId\)/);
 assert.match(checkout,/localTestQuote/);
 assert.match(checkout,/pago_simulado/);
 assert.match(checkout,/uk_produto_teste_resultado_v1/);
 assert.match(checkout,/Nenhuma cobrança, pedido Neon, fornecedor ou Mercado Pago/);
});

test('checkout normal continua limitado a três níveis',()=>{
 const chain=read('affiliate-chain.js');
 assert.match(chain,/MAX_AFFILIATE_LEVELS = 3/);
 const route=read('checkout-uk-routes.js');
 assert.match(route,/commissionDistribution/);
 assert.match(route,/cadeia\.slice\(0,MAX_AFFILIATE_LEVELS\)/);
});
