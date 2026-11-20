'use strict';
// Tradução opcional: não inventar traduções. Nomes originais preservados.
const KEY='cj_traducao_';
const labels=[[/computer|electronic|phone|digital|smart|audio|office|camera|tablet/i,'Eletrônicos'],[/home|garden|furniture|kitchen|decor|household/i,'Casa e Decoração'],[/beauty|health|makeup|skin|hair/i,'Beleza e Cuidados'],[/toy|baby|kids|children/i,'Brinquedos'],[/tool|hardware|industrial/i,'Ferramentas'],[/automotive|car|motorcycle|vehicle/i,'Automotivo'],[/pet|animal/i,'Pet Shop'],[/sport|fitness|outdoor|camping/i,'Esporte e Lazer'],[/clothing|fashion|apparel|shoes|jewelry|bag/i,'Moda e Acessórios']];
function categoriaPt(nome){return labels.find(([re])=>re.test(nome||''))?.[1]||'Outros';}
async function traduzir(pool,original){
 const texto=String(original||'').trim().slice(0,250);if(!texto)return {texto:'',traduzido:false};
 const crypto=require('crypto');const hash=crypto.createHash('sha256').update(texto).digest('hex');
 const k=KEY+hash;const cached=await pool.query('SELECT valor FROM config WHERE chave=$1',[k]);
 if(cached.rows[0]?.valor?.texto)return {texto:cached.rows[0].valor.texto,traduzido:true};
 const endpoint=process.env.CJ_TRANSLATE_URL?.trim();
 if(!endpoint)return {texto,traduzido:false};
 const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password)throw Error('CJ_TRANSLATE_URL deve ser HTTPS');
 const headers={'Content-Type':'application/json'};if(process.env.CJ_TRANSLATE_KEY)headers.Authorization='Bearer '+process.env.CJ_TRANSLATE_KEY;
 const response=await fetch(u,{method:'POST',headers,body:JSON.stringify({q:texto,source:'en',target:'pt',format:'text',api_key:process.env.CJ_TRANSLATE_KEY||undefined}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Tradução HTTP '+response.status);
 const data=await response.json();const translated=String(data.translatedText||'').trim().slice(0,250);
 if(!translated)throw Error('Tradução vazia');
 await pool.query('INSERT INTO config(chave,valor) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor',[k,JSON.stringify({texto:translated,original:texto})]);
 return {texto:translated,traduzido:true};
}
module.exports={traduzir,categoriaPt};
