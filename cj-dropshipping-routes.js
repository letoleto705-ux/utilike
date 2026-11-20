'use strict';
// Integração CJ isolada: não altera o fluxo AliExpress.
const {Router} = require('express');
const {getRate,getSaved} = require('./cambio-awesome');
const SCHEDULE_KEY='cj_automacao_v2';
const DEFAULT_SCHEDULE={ativo:false,intervaloHoras:24,palavra:'electronics',quantidade:20,pagina:1,proximaExecucao:null,ultimaExecucao:null};
const HOURS=[2,3,4,5,6,7,8,10,12,18,20,24];
const BASE='https://developers.cjdropshipping.com/api2.0/v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const httpsUrl=x=>{try{const u=new URL(String(x));return u.protocol==='https:'?u.href:null}catch{return null}};
const roundUp=n=>Math.ceil((n-1e-9)*100)/100;
function createCJ(pool){
 const r=Router(); let token=null, expiry=0, busy=false, last={executando:false,mensagem:'Aguardando importação'};
 let lastRequest=0;
  async function schedule(){const x=await pool.query('SELECT valor FROM config WHERE chave=$1',[SCHEDULE_KEY]);return {...DEFAULT_SCHEDULE,...(x.rows[0]?.valor||{})};}
  async function saveSchedule(x){await pool.query('INSERT INTO config(chave,valor) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor',[SCHEDULE_KEY,JSON.stringify(x)]);}
  function validateSchedule(x){if(typeof x.ativo!=='boolean'||!HOURS.includes(x.intervaloHoras)||!Number.isInteger(x.quantidade)||x.quantidade<1||x.quantidade>30||!Number.isInteger(x.pagina)||x.pagina<1||x.pagina>1000||!x.palavra||x.palavra.length>100)throw Error('Configuração CJ inválida.');}
 async function call(path,{method='GET',body,authorized=true}={}){
   const wait=Math.max(0,1100-(Date.now()-lastRequest));if(wait)await sleep(wait);lastRequest=Date.now();
   const headers={Accept:'application/json'};
   if(body)headers['Content-Type']='application/json';
   if(authorized)headers['CJ-Access-Token']=await getToken();
   const response=await fetch(BASE+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result||result.result===false||result.success===false)throw Error(`CJ: ${result?.message||'Resposta inválida'} (HTTP ${response.status})`);
   return result.data;
 }
 async function getToken(){
   if(token && Date.now()<expiry)return token;
   const key=process.env.CJ_API_KEY?.trim();if(!key)throw Error('Configure CJ_API_KEY no Render.');
   const data=await call('/authentication/getAccessToken',{method:'POST',body:{apiKey:key},authorized:false});
   if(!data?.accessToken)throw Error('CJ não retornou accessToken.');
   token=data.accessToken;
   const expiration=Date.parse(data.accessTokenExpiryDate||'');
   expiry=Number.isFinite(expiration)?expiration-24*3600000:Date.now()+12*3600000;
   return token;
 }
 function priceUSD(v){
   // A CJ pode retornar faixa de preços. Não usar a menor variante como preço universal.
   if(typeof v==='string' && !/^\d+(?:\.\d+)?$/.test(v.trim()))return null;
   const n=Number(v);return Number.isFinite(n)&&n>0&&n<100000?n:null;
 }
 function normalize(p){
   const id=String(p.id||p.pid||'').trim();
   const nome=String(p.nameEn||p.productNameEn||'').trim().slice(0,250);
   const imagem=httpsUrl(p.bigImage||p.productImage);
   return {id,nome,imagem,custoUsd:priceUSD(p.sellPrice),sku:String(p.sku||p.productSku||'').slice(0,150),categoria:String(p.oneCategoryName||p.categoryName||'Tecnologia').slice(0,120),raw:p};
 }
 async function ensureTable(){
   const x=await pool.query("SELECT to_regclass('public.cj_produtos') AS tabela");
   if(!x.rows[0].tabela)throw Error('Execute primeiro o arquivo SQL 005_cj_dropshipping.sql no Neon.');
 }
 r.get('/status',async(req,res,next)=>{try{const cache=await getSaved(pool);res.set('Cache-Control','no-store');res.json({configurada:!!process.env.CJ_API_KEY,cambioConfigurado:!!process.env.AWESOME_API_KEY||!!process.env.CJ_USD_BRL,awesomeConfigurada:!!process.env.AWESOME_API_KEY,cambioCache:cache?{taxa:Number(cache.taxa),consultadoEm:cache.consultadoEm}:null,executando:busy,...last})}catch(e){next(e)}});
 r.post('/cambio/atualizar',async(req,res,next)=>{try{const cambio=await getRate(pool,{force:true});res.set('Cache-Control','no-store');res.json({ok:true,cambio})}catch(e){next(e)}});
 r.get('/produtos',async(req,res,next)=>{try{await ensureTable();const x=await pool.query('SELECT id_externo,nome,sku,preco_usd,preco_brl,imagem,status,motivo,atualizado_em FROM cj_produtos ORDER BY atualizado_em DESC LIMIT 100');res.json({itens:x.rows})}catch(e){next(e)}});
 async function startImport(b,source='manual'){
   if(busy)return {iniciado:false,motivo:'Importação CJ já em execução.'};
   const quantidade=Number(b.quantidade||10),pagina=Number(b.pagina||1);
   if(!Number.isInteger(quantidade)||quantidade<1||quantidade>30||!Number.isInteger(pagina)||pagina<1||pagina>1000)throw Error('Quantidade 1–30 e página 1–1000.');
   const palavra=String(b.palavra||'').trim().slice(0,100);
   if(!palavra)throw Error('Informe uma palavra-chave para buscar produtos específicos.');
   if(!process.env.CJ_API_KEY)throw Error('Configure CJ_API_KEY no Render.');
   let cambioInfo;
   cambioInfo=await getRate(pool,{force:source==='agendado'});
   const cambio=cambioInfo.taxa;
   busy=true;last={executando:true,mensagem:'Consultando CJ...',importados:0,publicados:0,revisao:0,erros:0,cambioUsado:cambio,fonteCambio:cambioInfo.fonte,avisoCambio:cambioInfo.aviso||null};
   const started={iniciado:true,mensagem:'Importação CJ iniciada. Acompanhe em Status.'};
   setImmediate(async()=>{
    try{
      await ensureTable();
      const data=await call('/product/listV2?'+new URLSearchParams({page:String(pagina),size:String(quantidade),keyWord:palavra,features:'enable_category'}));
      // CJ V2: data.content[].productList[]; tolerância a variações documentadas.
      const content=Array.isArray(data?.content)?data.content:[];
      const products=content.flatMap(x=>Array.isArray(x.productList)?x.productList:[]);
      if(!products.length)throw Error('CJ não retornou produtos nessa busca. Verifique a palavra-chave e a resposta da API.');
      const config=await pool.query("SELECT valor FROM config WHERE chave='cronjob_automacao_v1'");
      const cfg={margem:30,frete:20,reserva:0,...(config.rows[0]?.valor||{})};
      if(![cfg.margem,cfg.frete,cfg.reserva].every(x=>Number.isFinite(Number(x))&&Number(x)>=0)||Number(cfg.margem)+Number(cfg.reserva)>=95)throw Error('Markup do Cronjob inválido.');
      for(const p of products){
       try{
        const item=normalize(p);if(!item.id)continue;
        const custoBrl=item.custoUsd===null?null:roundUp(item.custoUsd*cambio);
        const precoBrl=custoBrl===null?null:roundUp((custoBrl+Number(cfg.frete))/(1-(Number(cfg.margem)+Number(cfg.reserva))/100));
        const valid=!!item.nome&&!!item.imagem&&precoBrl!==null;
        const reason=valid?null:!item.nome?'Título ausente':!item.imagem?'Imagem ausente':'Preço em USD inválido ou faixa de variantes';
        const db=await pool.connect();
        try{
          await db.query('BEGIN');
          await db.query(`INSERT INTO cj_produtos(id_externo,sku,nome,categoria,imagem,preco_usd,cambio_usd_brl,preco_brl,status,motivo,dados,atualizado_em)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
            ON CONFLICT(id_externo) DO UPDATE SET sku=EXCLUDED.sku,nome=EXCLUDED.nome,categoria=EXCLUDED.categoria,imagem=EXCLUDED.imagem,preco_usd=EXCLUDED.preco_usd,cambio_usd_brl=EXCLUDED.cambio_usd_brl,preco_brl=EXCLUDED.preco_brl,status=CASE WHEN cj_produtos.status='desativado' THEN 'desativado' ELSE EXCLUDED.status END,motivo=EXCLUDED.motivo,dados=EXCLUDED.dados,atualizado_em=NOW()`,
            [item.id,item.sku,item.nome,item.categoria,item.imagem,item.custoUsd,cambio,precoBrl,valid?'publicado':'revisao',reason,JSON.stringify(item.raw)]);
          const status=await db.query('SELECT status FROM cj_produtos WHERE id_externo=$1',[item.id]);
          if(valid&&status.rows[0].status!=='desativado'){
           await db.query("INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING");
           const catalog=await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");
           const list=catalog.rows[0].valor;if(!Array.isArray(list))throw Error('Catálogo inválido');
           const id='cj-'+item.id;const prev=list.find(x=>String(x.id)===id);
           const product={...(prev||{}),id,nome:item.nome,categoria:item.categoria,imagem:item.imagem,imagens:[item.imagem],precoPor:precoBrl,custoFornecedor:custoBrl,moedaFornecedor:'USD',precoOriginalUSD:item.custoUsd,cambioAplicado:cambio,freteEstimado:Number(cfg.frete),margemMarkup:Number(cfg.margem),reservaSeguranca:Number(cfg.reserva),fornecedor:'CJ Dropshipping',cjProductId:item.id,sku:item.sku,estoque:prev?.estoque??null,ativo:true};
           await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify([...list.filter(x=>String(x.id)!==id),product])]);
           last.publicados++;
          }else last.revisao++;
          await db.query('COMMIT');last.importados++;
         }catch(e){await db.query('ROLLBACK').catch(()=>{});last.erros++;last.mensagem=String(e.message).slice(0,180)}finally{db.release()}
       }catch(e){last.erros++;last.mensagem=String(e.message).slice(0,180)}
      }
      last.mensagem=`Concluído: ${last.importados} importados, ${last.publicados} publicados, ${last.revisao} em revisão, ${last.erros} erros.`;
    }catch(e){last.erros++;last.mensagem='Falha CJ: '+String(e.message).slice(0,240)}
    finally{busy=false;last.executando=false;last.finalizadoEm=new Date().toISOString();
      if(source==='agendado'){try{const c=await schedule();await saveSchedule({...c,ultimaExecucao:last.finalizadoEm});}catch(e){console.error('CJ agendamento:',e.message)}}}
   });
   return started;
  }
  r.post('/importar',async(req,res)=>{try{const x=await startImport(req.body||{});res.status(x.iniciado?202:409).json(x)}catch(e){res.status(400).json({erro:e.message})}});
  r.get('/automacao/config',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await schedule())}catch(e){next(e)}});
  r.put('/automacao/config',async(req,res,next)=>{try{const old=await schedule(),b=req.body||{};const cfg={...old,ativo:b.ativo,intervaloHoras:Number(b.intervaloHoras),palavra:String(b.palavra||'').trim(),quantidade:Number(b.quantidade),pagina:Number(b.pagina)};validateSchedule(cfg);cfg.proximaExecucao=cfg.ativo?new Date(Date.now()+cfg.intervaloHoras*3600000).toISOString():null;await saveSchedule(cfg);res.json({ok:true,...cfg})}catch(e){res.status(400).json({erro:e.message})}});
  r.post('/automacao/executar-agora',async(req,res)=>{try{const cfg=await schedule();const x=await startImport(cfg,'manual');res.status(x.iniciado?202:409).json(x)}catch(e){res.status(400).json({erro:e.message})}});
  // Agendamento persistido no Neon, com reserva atômica do próximo horário.
  const timer=setInterval(async()=>{try{const cfg=await schedule();if(!cfg.ativo||busy||!cfg.proximaExecucao||Date.parse(cfg.proximaExecucao)>Date.now())return;const next=new Date(Date.now()+cfg.intervaloHoras*3600000).toISOString();const claimed=await pool.query(`UPDATE config SET valor=jsonb_set(valor,'{proximaExecucao}',to_jsonb($2::text),true) WHERE chave=$1 AND (valor->>'ativo')::boolean=true AND (valor->>'proximaExecucao')::timestamptz<=NOW() RETURNING chave`,[SCHEDULE_KEY,next]);if(claimed.rowCount){try{await startImport(cfg,'agendado')}catch(e){console.error('CJ automático:',e.message)}}}catch(e){console.error('CJ scheduler:',e.message)}},60000);timer.unref?.();
 return r;
}
module.exports=createCJ;
