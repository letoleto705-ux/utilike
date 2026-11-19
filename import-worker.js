'use strict';
// Best-effort public metadata reader. No login, CAPTCHA bypass, browser emulation or invented values.
const decode = s => String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const attr = (tag,name) => {const m=tag.match(new RegExp(`\\b${name}\\s*=\\s*([\"'])(.*?)\\1`,"i"));return m?decode(m[2]):""};
function metadata(html){
  const tags=html.match(/<meta\b[^>]*>/gi)||[];const map={};
  for(const tag of tags){const key=(attr(tag,'property')||attr(tag,'name')).toLowerCase();if(key&&!map[key])map[key]=attr(tag,'content')}
  const images=[...new Set([map['og:image'],map['twitter:image']].filter(Boolean))].filter(x=>/^https:\/\//i.test(x)).slice(0,12);
  const title=map['og:title']||map['twitter:title']||'';
  const description=map['og:description']||map.description||'';
  return {nome:title.slice(0,250),descricao:description.slice(0,2000),imagem:images[0]||null,imagens:images};
}
async function extract(url){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!['pt.aliexpress.com','www.aliexpress.com','aliexpress.com'].includes(parsed.hostname)||!/^\/item\/\d+\.html$/.test(parsed.pathname))throw Error('Apenas URLs diretas de produto AliExpress são aceitas neste teste');
  const response=await fetch(parsed.toString(),{headers:{Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(`Fornecedor não disponibilizou a página publicamente (HTTP ${response.status})`);
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('text/html'))throw Error('Resposta não é HTML');
  const len=Number(response.headers.get('content-length')||0);if(len>1500000)throw Error('Página excede limite de leitura');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000)throw Error('Página excede limite de leitura');chunks.push(value)}}finally{reader.cancel().catch(()=>{})}
  const html=Buffer.concat(chunks).toString('utf8');const result=metadata(html);
  if(!result.nome||!result.imagem)throw Error('Página sem título/imagem públicos utilizáveis; requer API/feed autorizado ou cadastro assistido');
  return {...result,url_origem:parsed.toString(),origem:'metadados_publicos',preco:null,estoque:null};
}
function createWorker(pool){
  let running=false;let last={executando:false,processados:0,revisao:0,erros:0,mensagem:'Aguardando início'};
  async function start(){
    if(running)return {iniciado:false,motivo:'Processamento já em andamento'};
    running=true;last={executando:true,processados:0,revisao:0,erros:0,mensagem:'Processando até 3 URLs pendentes'};
    setImmediate(async()=>{
      try{
        for(let n=0;n<3;n++){
          const result=await pool.query(`UPDATE importacao_urls SET status='processando',atualizado_em=NOW(),erro=NULL WHERE id=(SELECT id FROM importacao_urls WHERE status='pendente' AND fornecedor='AliExpress' ORDER BY criado_em,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,url,nome,imagem,dados_extraidos`);
          if(!result.rowCount)break;
          const item=result.rows[0];
          try{
            // Prioriza captura local vinculada ao produto; não tenta substituir galeria validada.
            const stored=item.dados_extraidos||{};
            const gallery=Array.isArray(stored.imagens)?stored.imagens.filter(x=>typeof x==='string'&&x.startsWith('https://')).slice(0,12):[];
            let data;
            if (item.nome && (gallery.length || item.imagem)) {
              data={...stored,nome:item.nome,imagem:gallery[0]||item.imagem,imagens:gallery.length?gallery:[item.imagem],url_origem:item.url,origem:'captura_local_selenium',preco:null,estoque:null,preco_confirmado:false};
            } else {
              const extracted=await extract(item.url);
              data={...stored,...extracted,imagens:gallery.length?gallery:extracted.imagens,imagem:gallery[0]||extracted.imagem,nome:item.nome||extracted.nome,preco:null,estoque:null,preco_confirmado:false};
            }
            await pool.query(`UPDATE importacao_urls SET status='revisao',nome=$2,imagem=$3,dados_extraidos=$4,atualizado_em=NOW() WHERE id=$1`,[item.id,data.nome,data.imagem,JSON.stringify(data)]);
            last.revisao++;
          }catch(e){await pool.query(`UPDATE importacao_urls SET status='erro',erro=$2,atualizado_em=NOW() WHERE id=$1`,[item.id,String(e.message).slice(0,400)]);last.erros++}
          last.processados++;
        }
        last.mensagem=`Concluído: ${last.revisao} para revisão; ${last.erros} com erro. Nenhum produto foi publicado.`;
      }catch(e){last.mensagem='Erro no processamento: '+String(e.message).slice(0,200)}
      finally{running=false;last.executando=false}
    });
    return {iniciado:true,mensagem:'Processamento iniciado (máximo de 3 URLs)'};
  }
  return {start,status:()=>({...last})};
}
module.exports={createWorker,metadata};
