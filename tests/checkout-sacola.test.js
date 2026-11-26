'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('vitrine e detalhes enviam Comprar agora à sacola, sem trocar o carrinho',()=>{
 const index=read('public/index.html'),produto=read('public/produto-uk.js'),detail=read('public/produto.html');
 assert.match(index,/function comprarAgora\(p\)[\s\S]*?UK\.adicionarSacola\(p\.id,'',1\)/);
 assert.match(index,/location\.href='checkout\.html\?origem=sacola'/);
 assert.match(produto,/async function comprarAgora\(\)[\s\S]*?UK\.adicionarSacola\(product\.id,selectedVariant,n\)/);
 assert.match(detail,/href="sacola\.html"/);
 assert.match(detail,/data-bag-count/);
 assert.match(index,/id="sidebarAdministracao" class="hidden"/);
});

test('checkout reconhece sacola, perfis e frete da precificação sem cobrar duas vezes',()=>{
 const checkout=read('public/checkout-uk.js'),route=read('checkout-uk-routes.js'),html=read('public/checkout.html');
 assert.match(checkout,/origem=\{adicionais:UK\.sacola\(\)\}/);
 assert.match(checkout,/sessao\.user\?\.perfil/);
 assert.match(route,/freteEstimado\?\?p\.freteEmbutido/);
 assert.match(route,/subtotalSemFrete/);
 assert.match(route,/freteIncluidoNoPreco:true/);
 assert.match(html,/id="shipping"/);assert.match(html,/id="freightExplain"/);
 assert.match(html,/id="editAddressBtn"/);assert.match(html,/id="saveAddressBtn"/);
 assert.doesNotMatch(html,/class="steps"/);
 assert.match(read('database/009_sacola_perfis_compradores.sql'),/CREATE TABLE IF NOT EXISTS checkout_uk\.sacola_itens/);
});

function montarCheckout(produtos){
 const rotas={GET:new Map(),PUT:new Map(),POST:new Map(),middlewares:[]};
 const router={use(fn){rotas.middlewares.push(fn)},get(p,fn){rotas.GET.set(p,fn)},put(p,fn){rotas.PUT.set(p,fn)},post(p,fn){rotas.POST.set(p,fn)}};
 const mod={exports:{}};
 const context={module:mod,exports:mod.exports,require(n){if(n==='express')return {Router:()=>router};return require(n)},process:{env:{}},console};
 vm.runInNewContext(read('checkout-uk-routes.js'),context,{filename:'checkout-uk-routes.js'});
 const calls=[];
 const pool={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('to_regclass'))return {rows:[{tabela:'checkout_uk.sacola_itens'}]};if(sql.includes('SELECT usuario,nome,email,telefone'))return {rowCount:1,rows:[{usuario:args[0],nome:'Cliente',email:'cliente@example.com',telefone:'81999999999'}]};return {rows:[],rowCount:0}}};
 mod.exports({pool,lerCatalogoPublico:async()=>produtos});
 return {rotas,calls,pool};
}
async function request(fn,req){let resposta,code=200;
 const res={set(){return this},status(n){code=n;return this},json(x){resposta=x;return this}};
 let rejected;
 await fn(req,res,e=>{rejected=e});
 if(rejected)throw rejected;
 return {code,data:resposta};
}

test('backend aceita administrador, cliente e afiliado para cotar sem pedido de pagamento',async()=>{
 const {rotas,calls}=montarCheckout([
  {id:'a',nome:'Produto A',precoPor:100,freteEstimado:15,ativo:true},
  {id:'b',nome:'Produto B',precoPor:50,freteEstimado:0,ativo:true}
 ]);
 for(const perfil of ['admin','cliente','afiliado']){
  const resposta=await request(rotas.POST.get('/cotacao'),{user:{usuario:perfil,perfil},body:{adicionais:[{produtoId:'a',quantidade:2},{produtoId:'b',quantidade:1}]}});
  assert.equal(resposta.data.total,250);assert.equal(resposta.data.subtotalSemFrete,220);assert.equal(resposta.data.freteEmbutido,30);
  assert.equal(resposta.data.itens.length,2);assert.equal(resposta.data.freteIncluidoNoPreco,true);
 }
 assert.equal(calls.length,0,'nenhuma transação SQL na cotação de produtos informados em memória');
});

test('frete gratuito só aparece quando o campo é zero; campo ausente não vira frete grátis',async()=>{
 const {rotas}=montarCheckout([{id:'gratis',nome:'Grátis',precoPor:45,freteEstimado:0},{id:'antigo',nome:'Sem dado',precoPor:12}]);
 const a=await request(rotas.POST.get('/cotacao'),{user:{usuario:'a',perfil:'admin'},body:{adicionais:[{produtoId:'gratis',quantidade:1}]}});
 assert.equal(a.data.freteGratis,true);assert.equal(a.data.freteEmbutido,0);assert.equal(a.data.total,45);
 const b=await request(rotas.POST.get('/cotacao'),{user:{usuario:'a',perfil:'admin'},body:{adicionais:[{produtoId:'antigo',quantidade:1}]}});
 assert.equal(b.data.freteEmbutido,null);assert.equal(b.data.freteGratis,false);
 assert.ok(b.data.pendencias.includes('frete_nao_informado_em_alguns_produtos'));
});

test('itens duplicados são agrupados e preços do navegador não são aceitos',async()=>{
 const {rotas}=montarCheckout([{id:'a',nome:'Original',precoPor:80,freteEstimado:10}]);
 const r=await request(rotas.POST.get('/cotacao'),{user:{usuario:'a',perfil:'cliente'},body:{adicionais:[
  {produtoId:'a',quantidade:2,preco:0.01},{produtoId:'a',quantidade:1,preco:0.01}]}});
 assert.equal(r.data.itens.length,1);assert.equal(r.data.itens[0].quantidade,3);
 assert.equal(r.data.total,240);assert.equal(r.data.freteEmbutido,30);
});

test('pedido-teste não grava nem cobra quando modo de homologação está desativado',async()=>{
 const {rotas,calls}=montarCheckout([{id:'a',precoPor:20,freteEstimado:0}]);
 const r=await request(rotas.POST.get('/pedido-teste'),{user:{usuario:'admin',perfil:'admin'},body:{}});
 assert.equal(r.code,403);assert.match(r.data.erro,/desabilitados/);assert.equal(calls.length,0);
});

test('sacola persistida usa perfil e usuário autenticados, não um ID do corpo',async()=>{
 const {rotas,calls}=montarCheckout([]);
 const r=await request(rotas.GET.get('/sacola'),{user:{perfil:'admin',usuario:'admin'},body:{usuario:'outro'}});
 assert.deepEqual(JSON.parse(JSON.stringify(r.data.itens)),[]);
 const query=calls.find(c=>c.sql.includes('FROM checkout_uk.sacola_itens WHERE'));
 assert.deepEqual(Array.from(query.args),['admin','admin']);
});

test('sacola do visitante migra para a conta certa e não reaparece em outra conta',async()=>{
 const storage=new Map(),session=new Map(),servidor=new Map();
 const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const sessionStorage={getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,String(v)),removeItem:k=>session.delete(k)};
 const document={querySelector:()=>({}),querySelectorAll:()=>[],body:{},documentElement:{}};
 const window={dispatchEvent:()=>{},crypto:{getRandomValues:a=>a.fill(4)}};
 const fetch=async(url,opts)=>{
   const token=String(opts.headers.Authorization||'').replace(/^Bearer /,''),items=servidor.get(token)||[];
   if(url==='/api/checkout-uk/sacola'){
     if(opts.method==='PUT'){servidor.set(token,JSON.parse(opts.body).itens);return {ok:true,json:async()=>({ok:true})}}
     return {ok:true,json:async()=>({itens:items})};
   }
   return {ok:true,json:async()=>({})};
 };
 const context={window,location:{pathname:'/index.html',origin:'https://loja.teste'},document,localStorage,sessionStorage,fetch,Event:class Event{constructor(name){this.type=name}},URL,console,Uint8Array};
 vm.runInNewContext(read('public/vitrine-uk.js'),context,{filename:'vitrine-uk.js'});
 const uk=window.UK;
 assert.equal(uk.adicionarSacola('fone','',2),true);
 assert.equal(uk.sacola().length,1);
 sessionStorage.setItem('utilike_auth_session',JSON.stringify({token:'admin-token',user:{usuario:'admin',perfil:'admin'}}));
 await uk.sincronizarSacola();
 assert.equal(uk.sacola()[0].quantidade,2);assert.equal((servidor.get('admin-token')||[])[0].quantidade,2);
 sessionStorage.setItem('utilike_auth_session',JSON.stringify({token:'cliente-token',user:{usuario:'clienteA',perfil:'cliente'}}));
 await uk.sincronizarSacola();
 assert.equal(uk.sacola().length,0,'cliente B não enxerga sacola do administrador');
 sessionStorage.setItem('utilike_auth_session',JSON.stringify({token:'admin-token',user:{usuario:'admin',perfil:'admin'}}));
 assert.equal(uk.sacola()[0].quantidade,2);
 assert.equal(uk.atualizarSacola('fone','',1),true);
 await uk.sincronizarSacola();
 assert.equal(uk.sacola()[0].quantidade,1,'redução de quantidade não pode ser revertida pela leitura do banco');
 assert.equal(uk.removerSacola('fone',''),true);
 await uk.sincronizarSacola();
 assert.equal(uk.sacola().length,0,'item removido não pode ressurgir na sincronização');
});
