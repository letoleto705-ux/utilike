'use strict';
// Tradução local opcional (Argos Translate), cache no Neon; sem API paga.
const crypto=require('crypto');
const path=require('path');
const {spawn}=require('child_process');
const KEY='cj_traducao_';
const labels=[[/computer|electronic|phone|digital|smart|audio|office|camera|tablet/i,'Eletrônicos'],[/home|garden|furniture|kitchen|decor|household/i,'Casa e Decoração'],[/beauty|health|makeup|skin|hair/i,'Beleza e Cuidados'],[/toy|baby|kids|children/i,'Brinquedos'],[/tool|hardware|industrial/i,'Ferramentas'],[/automotive|car|motorcycle|vehicle/i,'Automotivo'],[/pet|animal/i,'Pet Shop'],[/sport|fitness|outdoor|camping/i,'Esporte e Lazer'],[/clothing|fashion|apparel|shoes|jewelry|bag/i,'Moda e Acessórios']];
function categoriaPt(nome){return labels.find(([re])=>re.test(nome||''))?.[1]||'Outros';}
function cacheKey(text){return KEY+crypto.createHash('sha256').update(text).digest('hex')}
function offline(texts){return new Promise((resolve,reject)=>{
 const child=spawn(process.env.CJ_PYTHON_BIN||'python3',[path.join(__dirname,'robot','traduzir_offline.py')],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';const timeout=setTimeout(()=>child.kill('SIGKILL'),Math.min(180000,30000+texts.length*4000));
 child.stdout.on('data',b=>{output+=b;if(output.length>1200000)child.kill('SIGKILL')});
 child.stderr.on('data',b=>{errors+=b;if(errors.length>2000)errors=errors.slice(-2000)});
 child.on('error',e=>{clearTimeout(timeout);reject(e)});
 child.on('close',code=>{clearTimeout(timeout);if(code!==0)return reject(Error('Tradutor local indisponível: '+errors.slice(0,180)));try{const result=JSON.parse(output).translations;if(!Array.isArray(result)||result.length!==texts.length)throw Error('Resposta inválida');resolve(result)}catch(e){reject(e)}});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({texts}));
})}
async function traduzirLote(pool,originais){
 const inputs=originais.map(x=>String(x||'').trim().slice(0,10000));
 const result=new Array(inputs.length);const missing=new Map();
 for(let i=0;i<inputs.length;i++){
  const t=inputs[i];if(!t){result[i]={texto:'',traduzido:false};continue}
  const key=cacheKey(t);if(!missing.has(key))missing.set(key,{text:t,indices:[]});missing.get(key).indices.push(i);
 }
 const toTranslate=[];
 for(const [key,entry] of missing){
  const found=await pool.query('SELECT valor FROM config WHERE chave=$1',[key]);
  if(typeof found.rows[0]?.valor?.texto==='string'&&found.rows[0].valor.texto){for(const i of entry.indices)result[i]={texto:found.rows[0].valor.texto,traduzido:true}}
  else toTranslate.push({key,...entry});
 }
 // Batches limit model memory and timeout. Failure preserves original and marks pending.
 for(let start=0;start<toTranslate.length;start+=15){
  const batch=toTranslate.slice(start,start+15);let translations=[];
  try{translations=await offline(batch.map(e=>e.text))}catch(e){console.warn('[CJ tradução]',e.message)}
  for(let j=0;j<batch.length;j++){
   const entry=batch[j];const translated=String(translations[j]||'').trim().slice(0,10000);
   const ok=!!translated&&translated!==entry.text;
   for(const i of entry.indices)result[i]={texto:ok?translated:entry.text,traduzido:ok};
   if(ok)await pool.query('INSERT INTO config(chave,valor) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor',[entry.key,JSON.stringify({texto:translated,original:entry.text})]);
  }
 }
 return result;
}
async function traduzir(pool,original){return (await traduzirLote(pool,[original]))[0]}
module.exports={traduzir,traduzirLote,categoriaPt};
