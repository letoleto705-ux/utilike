'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {filtrarCatalogoPublicoCJ,sincronizarAprovadosCJ}=require('../cj-publicacao-segura');
function row(id, overrides={}) {
 return {id_externo:id,nome:'English Source',nome_ptbr:'Nome brasileiro',descricao_ptbr:'Descrição em português',
  status_traducao:'aprovado',traduzido_em:new Date(),status:'publicado',preco_usd:10,preco_brl:99.9,
  cambio_usd_brl:5,imagem:'https://example.com/img.jpg',sku:'SKU',categoria:'Casa',dados:{},...overrides};
}
const cj=(id)=>({id:'cj-'+id,cjProductId:id,fornecedor:'CJ Dropshipping',nome:'English Source',descricao:'Original English',imagem:'https://example.com/img.jpg',precoPor:99.9});

test('public API: somente aprovados PT-BR; produtos não CJ preservados', async()=>{
 const registros=[row('a'),row('b',{status_traducao:null}),row('c',{status:'desativado'}),row('d',{nome_ptbr:''}),row('e',{preco_brl:null})];
 const pool={query:async()=>({rows:registros})};
 const outro={id:'aliexpress-10',nome:'Produto nacional',fornecedor:'AliExpress'};
 const result=await filtrarCatalogoPublicoCJ(pool,[cj('a'),cj('b'),cj('c'),cj('d'),cj('e'),outro]);
 assert.deepEqual(result.map(x=>x.id),['cj-a','aliexpress-10']);
 assert.equal(result[0].nome,'Nome brasileiro');
 assert.equal(result[0].descricao,'Descrição em português');
 assert.equal(result[0].nomeOriginalEn,undefined);
 assert.deepEqual(result[1],outro);
});
test('public API: status revisão, produto sem registro e catálogo desativado nunca vazam',async()=>{
 const registros=[row('a',{status:'revisao'}),row('b')];
 const p={query:async()=>({rows:registros})};
 const r=await filtrarCatalogoPublicoCJ(p,[cj('a'),cj('fantasma'),{...cj('b'),ativo:false}]);
 assert.equal(r.length,0);
});
test('sincronizador publica apenas aprovados e limpa anúncios CJ antigos sem alterar AliExpress',async()=>{
 const original=[{id:'aliexpress-2',nome:'AliExpress',fornecedor:'AliExpress'},cj('stale'),{...cj('a'),nome:'Old English Name'}];
 const logs=[];
 const db={query:async(sql,args=[])=>{
    logs.push([sql,args]);
    if(sql.includes('FOR UPDATE'))return {rows:[{valor:original}]};
    if(sql.includes('FROM public.cj_produtos WHERE status <>'))return {rows:[row('a',{status:'revisao'}),row('b',{status:'revisao'}),row('bad',{status_traducao:null})]};
    if(sql.includes("WHERE chave='cronjob_automacao_v1'"))return {rows:[{valor:{margem:25,frete:12,reserva:5}}]};
    return {rows:[],rowCount:1};
 },release:()=>{}};
 const pool={connect:async()=>db};
 const out=await sincronizarAprovadosCJ(pool);
 assert.equal(out.publicados,2);
 assert.equal(out.adicionados,1);
 assert.equal(out.removidos,1);
 const saved=logs.find(x=>x[0].includes("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'"));
 const cat=JSON.parse(saved[1][0]);
 assert.deepEqual(cat.map(x=>x.id),['aliexpress-2','cj-a','cj-b']);
 assert.equal(cat[0].nome,'AliExpress');
 assert.equal(cat[1].nome,'Nome brasileiro');
 assert.equal(cat[1].freteEstimado,12);
 assert.equal(cat[1].descricao,'Descrição em português');
 assert.ok(logs.some(x=>x[0]==='COMMIT'));
});
test('sincronizador em erro executa rollback',async()=>{
 const logs=[];const client={query:async(sql)=>{logs.push(sql);if(sql.includes('FOR UPDATE'))throw Error('Falha simulada');return {rows:[]}},release:()=>{}};
 await assert.rejects(()=>sincronizarAprovadosCJ({connect:async()=>client}),/Falha simulada/);
 assert.ok(logs.includes('ROLLBACK'));
});
