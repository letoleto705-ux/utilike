'use strict';
// Teste inteiramente local, sem conectar Neon nem modificar dados reais.
const assert=require('node:assert/strict');
const {publicarPendentes}=require('../robo-copy-publicador');

const base=[
 {id:'cj-99',nome:'Fone de ouvido',descricao:'Texto original traduzido da CJ',precoPor:50,ativo:true,especificacoes:{marca:'Marca X'}},
 {id:'garimpagem-82',nome:'Relógio',desc:'Descrição da AliExpress',precoPor:72,ativo:true},
 {id:'cj-inativo',nome:'Produto inativo',ativo:false},
];
const copy1='Conheça esse fone de ouvido e descubra uma opção prática para acompanhar seus momentos. Uma apresentação clara, sem inventar informações técnicas.';
const copy2='Uma alternativa para conhecer este relógio e sua proposta de uso cotidiano. Confira as informações e escolha o produto que combina com o que procura.';
let produtos=structuredClone(base);
const jobs=[
 {produto_id:'cj-99',texto_copy:copy1,status:'gerada'},
 {produto_id:'garimpagem-82',texto_copy:copy2,status:'gerada'},
 {produto_id:'nao-existe',texto_copy:copy2,status:'gerada'},
 {produto_id:'cj-inativo',texto_copy:copy2,status:'gerada'}
];
const db={async query(sql, params=[]){
 if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {rowCount:0, rows:[]};
 if(sql.includes("FROM public.config WHERE chave = 'produtos'")) return {rowCount:1,rows:[{valor:structuredClone(produtos)}]};
 if(sql.includes("FROM public.robo_copy_produtos")&&sql.includes("status = 'gerada'")){
   const rows=jobs.filter(j=>j.status==='gerada').slice(0,params[0]);return {rowCount:rows.length,rows};
 }
 if(sql.includes('UPDATE public.config')){produtos=JSON.parse(params[0]);return {rowCount:1,rows:[]};}
 if(sql.includes('SET status=\'publicada\'')){
   for(const j of jobs){if(params[0].includes(j.produto_id))j.status='publicada';}return {rowCount:params[0].length,rows:[]};
 }
 if(sql.includes('SET status=\'revisao\'')){
   for(const j of jobs){if(params[0].includes(j.produto_id))j.status='revisao';}return {rowCount:params[0].length,rows:[]};
 }
 throw Error('Unexpected query '+sql);
}};
(async()=>{
 const r=await publicarPendentes(db);
 assert.deepEqual(r,{publicadas:2,revisao:2,lotes:1});
 assert.equal(produtos[0].descricao,base[0].descricao);
 assert.deepEqual(produtos[0].especificacoes,base[0].especificacoes);
 assert.equal(produtos[1].desc,base[1].desc);
 assert.equal(produtos[0].copyUtiLike,copy1);
 assert.equal(produtos[1].copyUtiLike,copy2);
 const second=await publicarPendentes(db);
 assert.deepEqual(second,{publicadas:0,revisao:0,lotes:0});
 console.log('OK: publicação única, sem sobrescrever tradução/especificações, sem repetição.');
})().catch(e=>{console.error(e);process.exitCode=1});
