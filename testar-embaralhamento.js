'use strict';
/* Teste local sem acesso ao Neon/Render: npm install não é necessário. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const crypto = require('node:crypto');
const root=path.resolve(__dirname,'..');

// Validação estática de JavaScript incorporado nas duas variantes do index.
for(const page of ['public/index.html','extras/index-autonomo-com-banners-embutidos.html']){
 const html=fs.readFileSync(path.join(root,page),'utf8');
 const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
 for(const [,inline] of blocks)if(inline.trim())new vm.Script(inline,{filename:page});
 console.log('OK: sintaxe HTML/JS de',page, '(',blocks.length,'scripts)');
}

// Simula o navegador sem buscar imagens e sem alterar dados reais.
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const fn=index.match(/function embaralharVitrine\(\)\{[\s\S]*?\n\}\nasync function loadProducts/);
assert.ok(fn,'Função de embaralhamento não encontrada');
const storage=new Map();
const ctx={catalog:[],catalogOrder:[],category:'',Uint32Array,Math,
 window:{crypto:crypto.webcrypto,UtiLikeCategorias:{coincide:(p,c)=>!c||p.category===c}},
 sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
vm.createContext(ctx);vm.runInContext(fn[0].replace(/\nasync function loadProducts$/,''),ctx);
ctx.catalog=[...Array.from({length:300},(_,i)=>({id:'e-'+i,category:'Eletrônicos'})),...Array.from({length:200},(_,i)=>({id:'c-'+i,category:'Casa'}))];
for(const cat of ['', 'Eletrônicos','Casa']){
 ctx.category=cat;let previous='';
 for(let round=0;round<6;round++){
  vm.runInContext('embaralharVitrine()',ctx);
  const match=ctx.catalogOrder.filter(p=>ctx.window.UtiLikeCategorias.coincide(p,cat));
  assert.equal(match.length,cat===''?500:cat==='Eletrônicos'?300:200);
  assert.equal(new Set(match.map(x=>x.id)).size,match.length);
  if(round>0)assert.notEqual(match[0].id,previous,'primeiro deve mudar a cada seleção');
  previous=match[0].id;
 }
}
console.log('OK: index com 500 itens, categoria isolada e primeira posição alternada');

const handlers=new Map();
const fakeRouter={get:(url,...args)=>handlers.set('GET '+url,args.at(-1)),post(){},patch(){},delete(){}};
const original=Module._load;
Module._load=function(name,...rest){if(name==='express')return {Router:()=>fakeRouter};return original.call(this,name,...rest)};
let factory;try{factory=require(path.join(root,'backend/vitrine-routes.js'));}finally{Module._load=original}
const products=[
 ...Array.from({length:250},(_,i)=>({id:'ele-'+i,nome:'Eletrônico '+i,categoria:'Eletrônicos',precoPor:75,ativo:true})),
 ...Array.from({length:249},(_,i)=>({id:'casa-'+i,nome:'Casa '+i,categoria:'Casa e Decoração',precoPor:100,ativo:true})),
 {id:'inativo',nome:'Inativo',categoria:'Eletrônicos',precoPor:100,ativo:false},
 {id:'sem-preco',nome:'Sem preço',categoria:'Eletrônicos',precoPor:0,ativo:true}
];
factory({pool:{query:async()=>({rows:[]})},auth:()=>{},soAdmin:()=>{},lerCatalogoPublico:async()=>products});
async function get(route,params,query){
 let result;const h=handlers.get('GET '+route);
 assert.ok(h,route);
 const res={set(){return this},json(d){result=d;return this},status(){return this}};
 await h({params,query},res,e=>{throw e});
 return result;
}
async function collect(route,params,ordem,evitarPrimeiro=''){
 const out=[];let p=1,total=null;
 while(true){const r=await get(route,params,{pagina:String(p),limite:'16',ordem,evitarPrimeiro});
  if(total===null)total=r.total;
  assert.equal(total,r.total,'total consistente');
  assert.equal(r.pagina,p);
  out.push(...r.itens);
  if(!r.temMais)break;
  p++;
  assert.ok(p<100,'paginação não deve travar');
 }
 assert.equal(out.length,total);
 assert.equal(new Set(out.map(p=>p.id)).size,total,'não pode repetir anúncios na rodada');
 return out;
}
(async()=>{
 const a='0123456789abcdef0123456789abcdef',b='abcdef0123456789abcdef0123456789';
 const fullA=await collect('/catalogo',{},a),fullB=await collect('/catalogo',{},b,fullA[0].id);
 assert.equal(fullA.length,499,'filtro de produtos ativos e precificados');
 assert.notEqual(fullA[0].id,fullB[0].id,'primeiro varia');
 assert.notDeepEqual(fullA.map(x=>x.id),fullB.map(x=>x.id),'ordem muda');
 const recA=await collect('/recomendacoes/:id',{id:'ele-0'},a);
 const recB=await collect('/recomendacoes/:id',{id:'ele-0'},b,recA[0].id);
 assert.equal(recA.length,250);
 assert.equal(recB.length,250);
 assert.ok(recA.some(p=>p.id==='ele-0'),'produto aberto não pode ser excluído');
 assert.ok(recA.every(p=>p.categoria==='Eletrônicos'),'categoria precisa ser preservada');
 assert.notEqual(recA[0].id,recB[0].id,'revisita deve mudar o primeiro card');
 const withoutSeed=await get('/recomendacoes/:id',{id:'ele-0'},{});
 assert.ok(Array.isArray(withoutSeed),'API sem parâmetro pagina mantém contrato de array');
 console.log('OK: 499 anúncios ativos e 250 recomendações, ordem estável paginada, sem duplicação, categoria isolada, produto aberto incluído');
 console.log('TODOS OS TESTES LOCAIS PASSARAM.');
})().catch(e=>{console.error(e);process.exitCode=1});
