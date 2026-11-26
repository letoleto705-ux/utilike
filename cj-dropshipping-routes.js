'use strict';
// Integração CJ isolada: não altera o fluxo AliExpress.
const {Router} = require('express');
const {getRate,getSaved} = require('./cambio-awesome');
const {calc,getConfig:getPricing} = require('./precificacao-central');
const {categoriaPt} = require('./traducao-cj');
const {sincronizarAprovadosCJ, tituloAprovado, extrairGaleriaCJ} = require('./cj-publicacao-segura');
const {ensureCuradoria,validarMargem}=require('./cj-curadoria');
const SCHEDULE_KEY='cj_automacao_v2';
const DEFAULT_SCHEDULE={ativo:false,intervaloHoras:24,palavra:'',categorias:[],quantidade:10,pagina:1,proximaExecucao:null,ultimaExecucao:null};
const HOURS=[2,3,4,5,6,7,8,10,12,18,20,24];
const BASE='https://developers.cjdropshipping.com/api2.0/v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const httpsUrl=x=>{try{const u=new URL(String(x));return u.protocol==='https:'?u.href:null}catch{return null}};
const roundUp=n=>Math.ceil((n-1e-9)*100)/100;
function createCJ(pool){
 const r=Router(); let token=null, expiry=0, busy=false, last={executando:false,mensagem:'Aguardando importação'};
  let syncBusy=false, lastSync={mensagem:'Aguardando sincronização PT-BR'};
  const previewCache=new Map();
  async function syncNow(){
    if(syncBusy)return {iniciado:false,motivo:'Sincronização CJ já em execução.'};
    syncBusy=true;
    try { const out=await sincronizarAprovadosCJ(pool); lastSync={...out,em:new Date().toISOString(),mensagem:'Sincronização concluída'}; return out; }
    catch(e){lastSync={mensagem:'Falha na sincronização: '+String(e.message).slice(0,140)}; throw e;}
    finally{syncBusy=false;}
  }
 // Fila ÚNICA para chamadas CJ desta instância, inclusive obtenção de token.
 // A antiga espera isolada de 1,1 s permitia chamadas simultâneas no mesmo segundo.
 const MIN_GAP_CJ_MS=2300; // Conservador em relação ao limite CJ de 1 chamada/s.
 const MAX_RETRIES_429=3; // Exclusivamente consultas idempotentes e autenticação.
 let lastRequest=0, cooldownUntil=0, requestTail=Promise.resolve(), tokenPending=null;
 let categoryCache=null,categoryAt=0;
 function enqueueCJ(fn){
   const task=requestTail.catch(()=>{}).then(fn);
   requestTail=task.catch(()=>{}); // Falhas não bloqueiam os próximos pedidos.
   return task;
 }
 function retryAfterMs(value){
   if(!value)return 0;
   const seconds=Number(value);
   if(Number.isFinite(seconds)&&seconds>=0)return Math.min(60000,Math.ceil(seconds*1000));
   const until=Date.parse(value);
   return Number.isFinite(until)?Math.max(0,Math.min(60000,until-Date.now())):0;
 }
  async function schedule(){const x=await pool.query('SELECT valor FROM config WHERE chave=$1',[SCHEDULE_KEY]);return {...DEFAULT_SCHEDULE,...(x.rows[0]?.valor||{})};}
  async function saveSchedule(x){await pool.query('INSERT INTO config(chave,valor) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor',[SCHEDULE_KEY,JSON.stringify(x)]);}
  function validateSchedule(x){if(typeof x.ativo!=='boolean'||!HOURS.includes(x.intervaloHoras)||!Number.isInteger(x.quantidade)||x.quantidade<1||!Number.isInteger(x.pagina)||x.pagina<1||x.pagina>1000||String(x.palavra||'').length>100||!Array.isArray(x.categorias)||(!x.categorias.length&&!String(x.palavra||'').trim()))throw Error('Configuração CJ inválida.');}
 async function call(path,{method='GET',body,authorized=true,withMeta=false}={}){
   // Token obtido antes de entrar na fila, evitando deadlock ao renovar a sessão.
   const accessToken=authorized?await getToken():null;
   const headers={Accept:'application/json'};
   if(body)headers['Content-Type']='application/json';
   if(authorized)headers['CJ-Access-Token']=accessToken;
   const safeRetry=method==='GET'||path==='/authentication/getAccessToken'||path==='/logistic/freightCalculate';
   const maxRetries=safeRetry?MAX_RETRIES_429:0;
   for(let attempt=0;attempt<=maxRetries;attempt++){
     try{
       const result=await enqueueCJ(async()=>{
         // Serializa requisições de importação, cotação, navegação e reprecificação.
         const wait=Math.max(0,lastRequest+MIN_GAP_CJ_MS-Date.now(),cooldownUntil-Date.now());
         if(wait>0)await sleep(wait);
         lastRequest=Date.now();
         const response=await fetch(BASE+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
         const data=await response.json().catch(()=>null);
         const msg=String(data?.message||'');
         const rateLimited=response.status===429||(!response.ok||data?.result===false||data?.success===false)&&/too many requests|qps limit|rate limit/i.test(msg);
         if(rateLimited){
           const wait429=Math.max(4000,retryAfterMs(response.headers?.get?.('retry-after')));
           cooldownUntil=Math.max(cooldownUntil,Date.now()+wait429);
           const error=new Error(`CJ: ${msg||'Too Many Requests'} (HTTP 429)`);
           error.status=429;error.retryAfterMs=wait429;
           throw error;
         }
         if(!response.ok||!data||data.result===false||data.success===false)
           throw Error(`CJ: ${msg||'Resposta inválida'} (HTTP ${response.status})`);
         return data;
       });
       return withMeta?{data:result.data,pointsInfo:result.pointsInfo||null}:result.data;
     }catch(error){
       // Nunca repetir pedidos de escrita que possam criar/cobrar algo na CJ.
       if(error.status!==429||attempt===maxRetries)throw error;
       const delay=Math.max(error.retryAfterMs||4000,4000*2**attempt);
       cooldownUntil=Math.max(cooldownUntil,Date.now()+Math.min(30000,delay));
       await sleep(Math.min(30000,delay));
     }
   }
 }
 async function getToken(){
   if(token && Date.now()<expiry)return token;
   if(tokenPending)return tokenPending; // Evita autenticações paralelas.
   tokenPending=(async()=>{
     const key=process.env.CJ_API_KEY?.trim();if(!key)throw Error('Configure CJ_API_KEY no Render.');
     const data=await call('/authentication/getAccessToken',{method:'POST',body:{apiKey:key},authorized:false});
     if(!data?.accessToken)throw Error('CJ não retornou accessToken.');
     token=data.accessToken;
     const expiration=Date.parse(data.accessTokenExpiryDate||'');
     expiry=Number.isFinite(expiration)?expiration-24*3600000:Date.now()+12*3600000;
     return token;
   })();
   try{return await tokenPending}finally{tokenPending=null}
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
 async function categories(force=false){
  if(!force&&categoryCache&&Date.now()-categoryAt<86400000)return categoryCache;
  const raw=await call('/product/getCategory');const all=[];
  for(const a of Array.isArray(raw)?raw:[]){
   for(const b of a.categoryFirstList||[]){
    for(const c of b.categorySecondList||[]){
     if(!c.categoryId)continue;
     const grupo=String(a.categoryFirstName||'Outros');
     all.push({id:String(c.categoryId),nomeEn:String(c.categoryName||''),grupoEn:grupo,subgrupoEn:String(b.categorySecondName||''),grupoPt:categoriaPt(grupo)});
    }
   }
  }
  categoryCache=all;categoryAt=Date.now();return all;
 }
 r.get('/categorias',async(req,res,next)=>{try{const list=await categories(req.query.atualizar==='1');res.set('Cache-Control','no-store').json({categorias:list,total:list.length})}catch(e){next(e)}});
 r.get('/variantes/:id',async(req,res,next)=>{try{
  const id=String(req.params.id);const x=await pool.query('SELECT id_externo,nome,dados FROM cj_produtos WHERE id_externo=$1',[id]);
  if(!x.rowCount)return res.status(404).json({erro:'Produto não encontrado'});
  const data=await call('/product/variant/query?'+new URLSearchParams({pid:id}));
  const list=Array.isArray(data)?data:Array.isArray(data?.variants)?data.variants:[];
  res.json({produto:x.rows[0].nome,variantes:list.slice(0,100).map(v=>({vid:String(v.vid||v.id||''),sku:v.variantSku||v.sku||'',nome:v.variantNameEn||v.variantName||'',precoUSD:priceUSD(v.variantSellPrice??v.sellPrice??v.sellprice),imagem:httpsUrl(v.variantImage||v.img)||null}))});
 }catch(e){next(e)}});
 r.post('/variantes/:id/publicar',async(req,res,next)=>{try{
  const id=String(req.params.id),vid=String(req.body?.vid||'');
  if(!vid||vid.length>150)return res.status(400).json({erro:'Selecione uma variante.'});
  const x=await pool.query('SELECT * FROM cj_produtos WHERE id_externo=$1',[id]);
  if(!x.rowCount)return res.status(404).json({erro:'Produto não encontrado'});
  if(x.rows[0].status==='desativado')return res.status(409).json({erro:'Produto desativado. Não será republicado.'});
  await ensureCuradoria(pool);
  const gate=await pool.query("SELECT margem_percentual FROM public.cj_curadoria WHERE id_externo=$1 AND decisao='aprovado'",[id]);
  if(!gate.rowCount)return res.status(409).json({erro:'Aprovação comercial individual ausente. Use o Filtro Inteligente primeiro.'});
  if(!tituloAprovado(x.rows[0]))return res.status(409).json({erro:'Aguarde aprovação PT-BR do Robô Tradutor antes de publicar a variante.'});
  const data=await call('/product/variant/query?'+new URLSearchParams({pid:id}));
  const list=Array.isArray(data)?data:Array.isArray(data?.variants)?data.variants:[];
  const v=list.find(a=>String(a.vid||a.id)===vid);
  if(!v)return res.status(400).json({erro:'Variante não pertence ao produto.'});
  const usd=priceUSD(v.variantSellPrice??v.sellPrice??v.sellprice);
  if(usd===null)return res.status(400).json({erro:'Variante sem preço USD único válido.'});
  const cambio=(await getRate(pool)).taxa;
  const c=await pool.query("SELECT valor FROM config WHERE chave='cronjob_automacao_v1'");
  const cfg={margem:30,frete:20,reserva:0,...(c.rows[0]?.valor||{})};
  if(![cfg.margem,cfg.frete,cfg.reserva].every(n=>Number.isFinite(Number(n))&&Number(n)>=0)||Number(cfg.margem)+Number(cfg.reserva)>=100)throw Error('Markup inválido');
  const custo=roundUp(usd*cambio),base=await getPricing(pool),preco=calc(custo,{...base,margem:validarMargem(gate.rows[0].margem_percentual,base)});
  const db=await pool.connect();try{await db.query('BEGIN');
   await db.query("INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING");
   const locked=await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");
   const catalog=locked.rows[0].valor;if(!Array.isArray(catalog))throw Error('Catálogo inválido');
   const check=await db.query("SELECT nome_ptbr,descricao_ptbr,status_traducao,traduzido_em,status FROM cj_produtos WHERE id_externo=$1 FOR UPDATE",[id]);
   const checkedGate=await db.query("SELECT 1 FROM public.cj_curadoria WHERE id_externo=$1 AND decisao='aprovado' FOR UPDATE",[id]);
   if(!checkedGate.rowCount||!check.rowCount||!tituloAprovado(check.rows[0])||check.rows[0].status==='desativado')throw Error('Produto sem aprovação comercial/PT-BR válida ou desativado; publicação cancelada.');
   const row=x.rows[0],key='cj-'+id,prev=catalog.find(z=>String(z.id)===key)||{};
   const prod={...prev,id:key,nome:check.rows[0].nome_ptbr,descricao:check.rows[0].descricao_ptbr||'',categoria:row.categoria,imagem:httpsUrl(v.variantImage||v.img)||row.imagem,imagens:extrairGaleriaCJ(row, prev, httpsUrl(v.variantImage||v.img)||row.imagem),precoPor:preco,custoFornecedor:custo,precoOriginalUSD:usd,cambioAplicado:cambio,freteEstimado:Number(cfg.frete),fornecedor:'CJ Dropshipping',cjProductId:id,cjVariantId:vid,sku:v.variantSku||v.sku||row.sku,ativo:true};
   delete prod.nomeOriginalEn; delete prod.descricaoOriginalEn; delete prod.traducaoPendente;
   await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify([...catalog.filter(z=>String(z.id)!==key),prod])]);
   await db.query("UPDATE cj_produtos SET status='publicado',motivo=NULL,preco_usd=$2,preco_brl=$3,cambio_usd_brl=$4,atualizado_em=NOW(),dados=dados||$5::jsonb WHERE id_externo=$1",[id,usd,preco,cambio,JSON.stringify({varianteSelecionada:vid})]);
   await db.query('COMMIT');res.json({ok:true,precoBRL:preco,vid});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }catch(e){next(e)}});
 r.post('/frete/cotar',async(req,res,next)=>{try{
  const vid=String(req.body?.vid||'');const origem=String(req.body?.origem||'CN').toUpperCase();const cep=String(req.body?.cep||'').replace(/\D/g,'');
  if(!/^[a-zA-Z0-9-]{8,100}$/.test(vid)||!/^[A-Z]{2}$/.test(origem)|| (cep&&cep.length!==8))return res.status(400).json({erro:'Informe variante válida, origem ISO e CEP com 8 dígitos.'});
  const body={startCountryCode:origem,endCountryCode:'BR',products:[{vid,quantity:1}]};if(cep)body.zip=cep;
  const data=await call('/logistic/freightCalculate',{method:'POST',body});
  const opcoes=(Array.isArray(data)?data:[]).map(x=>({transportadora:x.logisticName||'',freteUSD:priceUSD(x.logisticPrice),prazoInformado:x.logisticAging||null}));
  res.json({destino:'BR',origem,cep:cep||null,opcoes,observacao:'Estimativas da CJ, não incluem necessariamente impostos e taxas de importação. Não são promessas de entrega.'});
 }catch(e){next(e)}});
 async function ensureTable(){
   const x=await pool.query("SELECT to_regclass('public.cj_produtos') AS tabela");
   if(!x.rows[0].tabela)throw Error('Execute primeiro o arquivo SQL 005_cj_dropshipping.sql no Neon.');
 }
 r.get('/status',async(req,res,next)=>{try{const cache=await getSaved(pool);res.set('Cache-Control','no-store');res.json({sincronizacao:lastSync,configurada:!!process.env.CJ_API_KEY,cambioConfigurado:!!process.env.AWESOME_API_KEY||!!process.env.CJ_USD_BRL,awesomeConfigurada:!!process.env.AWESOME_API_KEY,cambioCache:cache?{taxa:Number(cache.taxa),consultadoEm:cache.consultadoEm}:null,executando:busy,...last})}catch(e){next(e)}});
 r.post('/cambio/atualizar',async(req,res,next)=>{try{const cambio=await getRate(pool,{force:true});res.set('Cache-Control','no-store');res.json({ok:true,cambio})}catch(e){next(e)}});
 // Desativação persistente: impede republicação nas próximas importações.
 r.post('/produtos/:id/desativar',async(req,res)=>{const id=String(req.params.id||'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return res.status(400).json({erro:'ID inválido'});
  const db=await pool.connect();try{await db.query('BEGIN');
   const p=await db.query("UPDATE cj_produtos SET status='desativado',motivo='Desativado pelo administrador',atualizado_em=NOW() WHERE id_externo=$1 RETURNING id_externo",[id]);
   if(!p.rowCount){await db.query('ROLLBACK');return res.status(404).json({erro:'Produto não encontrado'})}
   const cat=await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");
   if(cat.rows.length&&Array.isArray(cat.rows[0].valor))await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify(cat.rows[0].valor.filter(p=>String(p.id)!=='cj-'+id))]);
   await db.query('COMMIT');res.json({ok:true,status:'desativado',mensagem:'Retirado da vitrine; futuras importações não o republicam.'});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});res.status(500).json({erro:'Falha ao desativar produto'})}finally{db.release()}
 });
 r.post('/produtos/:id/reativar',async(req,res)=>{const id=String(req.params.id||'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return res.status(400).json({erro:'ID inválido'});
  try{const p=await pool.query("UPDATE cj_produtos SET status='revisao',motivo='Reativado: aguardando nova importação ou publicação de variante',atualizado_em=NOW() WHERE id_externo=$1 AND status='desativado' RETURNING id_externo",[id]);if(!p.rowCount)return res.status(404).json({erro:'Produto não está desativado'});await ensureCuradoria(pool);await pool.query("UPDATE cj_curadoria SET decisao='pendente',atualizado_em=NOW() WHERE id_externo=$1",[id]);res.json({ok:true,mensagem:'Reativado para revisão. Precisa de nova aprovação comercial e tradução PT-BR válida.'})}catch(e){res.status(500).json({erro:'Falha ao reativar'})}
 });
 r.get('/produtos',async(req,res,next)=>{try{await ensureTable();await ensureCuradoria(pool);const x=await pool.query("SELECT p.id_externo,p.nome,p.nome_ptbr,p.status_traducao,p.sku,p.preco_usd,p.preco_brl,p.imagem,p.status,p.motivo,p.atualizado_em,c.decisao,c.margem_percentual FROM cj_produtos p LEFT JOIN cj_curadoria c ON c.id_externo=p.id_externo ORDER BY p.atualizado_em DESC LIMIT 100");res.json({itens:x.rows})}catch(e){next(e)}});

 // Filtro Inteligente: consulta a API SEM IMPORTAR os produtos consultados.
 function produtoCJUrl(raw){
   for(const value of [raw.productUrl,raw.productLink,raw.url,raw.productDetailUrl]){
     try{const u=new URL(String(value));if(u.protocol==='https:'&&/(^|\.)cjdropshipping\.com$/i.test(u.hostname))return u.href}catch{}
   }
   return null; // Não inventar URL de detalhe da CJ.
 }
 function origemConfirmada(raw){
   const candidates=[raw.warehouseCountryCode,raw.warehouseCountry,
      raw.warehouse?.countryCode,raw.warehouse?.country];
   const v=candidates.find(x=>typeof x==='string'&&/^(BR|CN|US|DE|GB|ES|FR|AU)$/i.test(x.trim()));
   return v?String(v).toUpperCase():null; // Ausência de dado NÃO confirma estoque no BR.
 }
 r.get('/gerencial/regras',async(req,res,next)=>{try{
   await ensureCuradoria(pool);const [cfg,cambio]=await Promise.all([getPricing(pool),getRate(pool)]);
   res.set('Cache-Control','no-store').json({regras:{frete:cfg.frete,reserva:cfg.reserva,
      taxaPagamento:cfg.taxaPagamento,tributos:cfg.tributos,reservaAfiliados:cfg.reservaAfiliados,
      despesaFixa:cfg.despesaFixa,protecao:cfg.protecao},cambio:{taxa:cambio.taxa,fonte:cambio.fonte,
      aviso:cambio.aviso||null}});
 }catch(e){next(e)}});
 r.post('/gerencial/previsualizar',async(req,res)=>{try{
   await ensureCuradoria(pool);
   const b=req.body||{},palavra=String(b.palavra||'').trim().slice(0,100),pagina=Number(b.pagina||1);
   const quantidade=Number(b.quantidade||10);
   const apenasBR=b.origem==='BR';
   const maxUSD=b.maxUSD===''||b.maxUSD===null||b.maxUSD===undefined?null:Number(b.maxUSD);
   if(maxUSD!==null&&(!Number.isFinite(maxUSD)||maxUSD<=0||maxUSD>100000))throw Error('Custo máximo em USD inválido.');
   const categorias=Array.isArray(b.categorias)?[...new Set(b.categorias.map(String))]:[];
   if(!Number.isInteger(quantidade)||quantidade<1||quantidade>30||!Number.isInteger(pagina)||pagina<1||pagina>1000||categorias.length>10)
     throw Error('Informe de 1 a 30 produtos por categoria e até 10 categorias por consulta. Use as páginas para continuar.');
   if(!palavra&&!categorias.length)throw Error('Informe palavra-chave ou selecione categoria CJ.');
   if(categorias.length){const all=await categories();const valid=new Set(all.map(c=>c.id));
     if(categorias.some(id=>!valid.has(id)))throw Error('Categoria inválida. Recarregue as categorias CJ.');}
   const [cambio,cfg]=await Promise.all([getRate(pool),getPricing(pool)]);
   const products=[],seen=new Set(),erros=[];
   for(const job of categorias.length?categorias.map(categoryId=>({categoryId})): [{keyWord:palavra}]){
     try {
       const params={page:String(pagina),size:String(quantidade),features:'enable_category',...job};
       if(apenasBR)params.countryCode='BR'; // Filtro oficial listV2: estoque no país escolhido.
       if(maxUSD!==null)params.endSellPrice=String(maxUSD);
       if(palavra&&categorias.length)params.keyWord=palavra;
       const response=await call('/product/listV2?'+new URLSearchParams(params));
       const found=(Array.isArray(response?.content)?response.content:[])
         .flatMap(c=>Array.isArray(c.productList)?c.productList:[]);
       for(const raw of found){const item=normalize(raw);
         if(item.id&&!seen.has(item.id)){seen.add(item.id);products.push({raw,item});}}
     }catch(e){erros.push(String(e.message).slice(0,140));}
   }
   const ids=products.map(p=>p.item.id);
   const rows=ids.length?await pool.query(`SELECT c.id_externo,c.decisao,c.margem_percentual,
       p.status,p.status_traducao FROM public.cj_curadoria c
       LEFT JOIN public.cj_produtos p ON p.id_externo=c.id_externo
       WHERE c.id_externo=ANY($1::text[])`,[ids]):{rows:[]};
   const map=new Map(rows.rows.map(r=>[r.id_externo,r]));
   const now=Date.now();for(const [id,data] of previewCache)if(data.fim<now)previewCache.delete(id);
   const itens=products.map(({raw,item})=>{
     previewCache.set(item.id,{raw,fim:now+30*60*1000});
     const saved=map.get(item.id);
     const custoBRL=item.custoUsd===null?null:roundUp(item.custoUsd*cambio.taxa);
     return {id:item.id,nome:item.nome,sku:item.sku,imagem:item.imagem,categoria:
       categoriaPt(raw.oneCategoryName||raw.twoCategoryName||raw.threeCategoryName||item.categoria),
       urlCJ:produtoCJUrl(raw),origemEstoque:apenasBR?'BR':origemConfirmada(raw),
       frete:raw.addMarkStatus===1?'Selo frete grátis CJ; confirmar para BR':'Não cotado',
       custoUSD:item.custoUsd,custoBRL,precoIndividual:null,
       decisao:saved?.decisao||'pendente',margem:saved?.margem_percentual===null||saved?.margem_percentual===undefined?null:Number(saved.margem_percentual),
       statusNeon:saved?.status||null,statusTraducao:saved?.status_traducao||null};
   });
   res.set('Cache-Control','no-store').json({itens,total:itens.length,erros,cambio:{taxa:cambio.taxa,fonte:cambio.fonte},
     regras:{frete:cfg.frete,reserva:cfg.reserva,taxaPagamento:cfg.taxaPagamento,
       tributos:cfg.tributos,reservaAfiliados:cfg.reservaAfiliados,despesaFixa:cfg.despesaFixa,protecao:cfg.protecao},
     aviso:'Origem do estoque e frete só são confirmados quando a CJ fornece os dados da variante/logística.'});
 }catch(e){res.status(400).json({erro:String(e.message).slice(0,240)})}});
 r.post('/gerencial/decidir',async(req,res)=>{
   const b=req.body||{},id=String(b.id||'').trim(),decisao=b.decisao;
   if(!/^[A-Za-z0-9_-]{1,150}$/.test(id)||!['aprovado','rejeitado'].includes(decisao))
     return res.status(400).json({erro:'Produto/decisão inválidos.'});
   try{
     await ensureCuradoria(pool);
     const cached=previewCache.get(id);
     if(!cached||cached.fim<Date.now())return res.status(409).json({erro:'Prévia expirada. Consulte novamente a CJ antes de decidir.'});
     const item=normalize(cached.raw);
     if(item.id!==id)return res.status(409).json({erro:'Produto consultado não coincide com a seleção.'});
     const cfg=await getPricing(pool);
     const margin=decisao==='aprovado'?validarMargem(b.margem,cfg):null;
     if(decisao==='aprovado'&&(!item.nome||!item.imagem||item.custoUsd===null))
       return res.status(422).json({erro:'Produto sem título, imagem ou preço único. Revise a variante; não foi aprovado.'});
     const cambio=decisao==='aprovado'?(await getRate(pool)).taxa:null;
     const db=await pool.connect();
     let resultPreco=null;
     try{
       await db.query('BEGIN');
       if(decisao==='aprovado'){
         const prev=await db.query('SELECT status,preco_usd,dados FROM public.cj_produtos WHERE id_externo=$1 FOR UPDATE',[id]);
         if(prev.rows[0]?.status==='desativado')throw Error('Produto desativado: reative-o antes de aprovar.');
         const rawUsd=prev.rows[0]?.dados?.varianteSelecionada?Number(prev.rows[0].preco_usd):item.custoUsd;
         const usd=rawUsd>0?rawUsd:item.custoUsd;
         const preco=calc(roundUp(usd*cambio),{...cfg,margem:margin});resultPreco=preco;
         const dados=JSON.stringify({...item.raw,nomeOriginalEn:item.nome,
           descricaoOriginalEn:String(cached.raw.descriptionEn||cached.raw.productDescriptionEn||'').slice(0,10000)});
         await db.query(`INSERT INTO public.cj_produtos
           (id_externo,sku,nome,categoria,imagem,preco_usd,cambio_usd_brl,preco_brl,status,motivo,dados,atualizado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'revisao','Aprovado comercialmente; aguardando tradução PT-BR',$9::jsonb,NOW())
           ON CONFLICT(id_externo) DO UPDATE SET
           sku=EXCLUDED.sku,
           nome=CASE WHEN cj_produtos.status_traducao='aprovado' THEN cj_produtos.nome ELSE EXCLUDED.nome END,
           categoria=EXCLUDED.categoria,
           imagem=CASE WHEN cj_produtos.dados ? 'varianteSelecionada' THEN cj_produtos.imagem ELSE EXCLUDED.imagem END,
           preco_usd=EXCLUDED.preco_usd,cambio_usd_brl=EXCLUDED.cambio_usd_brl,preco_brl=EXCLUDED.preco_brl,
           status=CASE WHEN cj_produtos.status='publicado' THEN 'publicado' ELSE 'revisao' END,
           dados=COALESCE(cj_produtos.dados,'{}'::jsonb)||EXCLUDED.dados,
           atualizado_em=NOW()`,[id,item.sku,item.nome,
           categoriaPt(cached.raw.oneCategoryName||item.categoria),item.imagem,usd,cambio,preco,dados]);
       }
       if(decisao==='rejeitado')await db.query("UPDATE public.cj_produtos SET status='revisao',motivo='Rejeitado no Filtro Inteligente',atualizado_em=NOW() WHERE id_externo=$1 AND status<>'desativado'",[id]);
       await db.query(`INSERT INTO public.cj_curadoria (id_externo,decisao,margem_percentual,atualizado_em)
         VALUES ($1,$2,$3,NOW()) ON CONFLICT(id_externo) DO UPDATE SET
           decisao=EXCLUDED.decisao,
           margem_percentual=CASE WHEN EXCLUDED.decisao='aprovado' THEN EXCLUDED.margem_percentual
             ELSE cj_curadoria.margem_percentual END,atualizado_em=NOW()`,[id,decisao,margin]);
       await db.query('COMMIT');
     }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
     finally{db.release()}
     let sync=null;try{sync=await syncNow()}catch(e){sync={aviso:'Decisão gravada no Neon; sincronização pendente: '+String(e.message).slice(0,120)}}
     const translated=await pool.query('SELECT status,status_traducao FROM public.cj_produtos WHERE id_externo=$1',[id]);
     res.json({ok:true,id,decisao,margem:margin,precoVitrine:resultPreco,
       statusNeon:translated.rows[0]?.status||'não importado',statusTraducao:translated.rows[0]?.status_traducao||'pendente',
       sincronizacao:sync,mensagem:decisao==='aprovado'?'Aprovado e registrado no Neon. Publicação depende de PT-BR aprovado e dados válidos.':'Rejeitado. Não será publicado pela sincronização CJ.'});
   }catch(e){res.status(400).json({erro:String(e.message).slice(0,240)})}
 });
 r.get('/integracao/versao',(req,res)=>res.set('Cache-Control','no-store').json({versao:'7.1',portaoPtbr:true,sincronizacaoManual:true}));
 r.post('/sincronizar-aprovados',async(req,res)=>{try{res.json(await syncNow())}catch(e){res.status(500).json({erro:'Falha ao sincronizar produtos CJ aprovados. Consulte logs do servidor.'})}});
 async function startImport(b,source='manual'){
   if(busy)return {iniciado:false,motivo:'Importação CJ já em execução.'};
   const quantidade=Number(b.quantidade||10),pagina=Number(b.pagina||1);
   if(!Number.isInteger(quantidade)||quantidade<1||!Number.isInteger(pagina)||pagina<1||pagina>1000)throw Error('Quantidade deve ser positiva e página entre 1 e 1000.');
   const palavra=String(b.palavra||'').trim().slice(0,100);
   const categorias=Array.isArray(b.categorias)?[...new Set(b.categorias.map(String))]:[];
   if(!palavra&&!categorias.length)throw Error('Selecione categorias CJ ou informe palavra-chave em inglês.');
   if(!process.env.CJ_API_KEY)throw Error('Configure CJ_API_KEY no Render.');
   let cambioInfo;
   cambioInfo=await getRate(pool,{force:source==='agendado'});
   const cambio=cambioInfo.taxa;
   await ensureCuradoria(pool);
   busy=true;last={executando:true,mensagem:'Consultando CJ...',importados:0,publicados:0,revisao:0,erros:0,semAlteracao:0,precosAlterados:0,novos:0,desativadosIgnorados:0,variantesPreservadas:0,cambioUsado:cambio,fonteCambio:cambioInfo.fonte,avisoCambio:cambioInfo.aviso||null};
   const started={iniciado:true,mensagem:'Importação CJ iniciada (somente produtos aprovados na curadoria). Acompanhe em Status.'};
   setImmediate(async()=>{
    try{
      await ensureTable();
      const allowed=await categories();const ids=new Set(allowed.map(c=>c.id));
      if(categorias.some(c=>!ids.has(c)))throw Error('Categoria inválida ou removida da CJ. Recarregue categorias.');
      const jobs=categorias.length?categorias.map(id=>({categoryId:id})): [{keyWord:palavra}];
      const products=[];const seen=new Set();last.categorias=[];
      for(const job of jobs){
       // O administrador escolhe o total; a API recebe lotes pequenos e sequenciais.
       // Nunca solicitar mais de 30 itens por chamada CJ.
       let recebidos=0;
       try{
        for(let offset=0;offset<quantidade;){
         const pageSize=Math.min(30,quantidade-offset);
         // Páginas de tamanho fixo evitam repetir registros quando o lote final é menor.
         const params={page:String(pagina+Math.floor(offset/30)),size:'30',features:'enable_category',...job};
         if(palavra&&categorias.length)params.keyWord=palavra;
         const data=await call('/product/listV2?'+new URLSearchParams(params));
         const found=(Array.isArray(data?.content)?data.content:[]).flatMap(x=>Array.isArray(x.productList)?x.productList:[]);
         for(const p of found.slice(0,pageSize)){if(p.id&&!seen.has(String(p.id))){seen.add(String(p.id));products.push(p)}}
         recebidos+=Math.min(found.length,pageSize);
         offset+=pageSize;
         if(found.length<30)break;
        }
        last.categorias.push({id:job.categoryId||'busca',recebidos});
       }catch(e){last.erros++;last.categorias.push({id:job.categoryId||'busca',recebidos,erro:e.message.slice(0,140)})}
      }
      if(!products.length)throw Error('CJ não retornou produtos nessa busca. Verifique a palavra-chave e a resposta da API.');
      const cfg=await getPricing(pool); // Mesmas regras de precificação central.
      // ETAPA 7: somente importa dados de origem. NÃO traduz/publica diretamente.
      // O Robô Tradutor local escreve nome_ptbr e status_traducao no Neon.
      for(const p of products){
       try{
        const item=normalize(p); if(!item.id)continue;
        const picked=await pool.query("SELECT decisao,margem_percentual FROM public.cj_curadoria WHERE id_externo=$1",[item.id]);
        if(picked.rows[0]?.decisao!=='aprovado'){last.semAprovacao=(last.semAprovacao||0)+1;continue;}
        if(picked.rows[0].margem_percentual===null){last.legadosPreservados=(last.legadosPreservados||0)+1;continue;}
        item.categoria=categoriaPt(p.oneCategoryName||p.twoCategoryName||p.threeCategoryName||item.categoria);
        const descricaoOriginal=String(p.descriptionEn||p.productDescriptionEn||p.description||'').trim().slice(0,10000);
        const custoBrl=item.custoUsd===null?null:roundUp(item.custoUsd*cambio);
        const precoBrl=custoBrl===null?null:calc(custoBrl,{...cfg,margem:validarMargem(picked.rows[0].margem_percentual,cfg)});
        const valid=!!item.nome&&!!item.imagem&&precoBrl!==null;
        const existing=await pool.query("SELECT status, status_traducao, nome_ptbr, nome, preco_usd, preco_brl, imagem, dados->>'varianteSelecionada' AS vid FROM public.cj_produtos WHERE id_externo=$1",[item.id]);
        const anterior=existing.rows[0]||null;
        if(anterior?.status==='desativado'){last.desativadosIgnorados++;last.importados++;continue;}
        // Produto CJ já publicado: atualizar custo/preço SOMENTE pela Reprecificação CJ aprovada.
        // Nunca sobrescrever o preço aprovado durante reimportação ou sincronização.
        if(anterior?.status==='publicado'){last.publicadosPreservados=(last.publicadosPreservados||0)+1;last.importados++;continue;}
        if(anterior?.vid){last.variantesPreservadas++;last.importados++;continue;}
        const precoIgual=anterior && Number(anterior.preco_brl)===Number(precoBrl);
        const custoIgual=anterior && Number(anterior.preco_usd)===Number(item.custoUsd);
        const imagemIgual=anterior && String(anterior.imagem||'')===String(item.imagem||'');
        // Mesmo se os dados não mudaram, o sincronizador detecta aprovações novas.
        if(anterior && precoIgual && custoIgual && imagemIgual && anterior.nome===item.nome){
          last.semAlteracao++;last.importados++;continue;
        }
        const reason=!valid?(!item.nome?'Título original ausente':!item.imagem?'Imagem ausente':'Preço USD inválido ou faixa de variantes'):'Aguardando aprovação da tradução PT-BR';
        // SQL original mantido: apenas colunas da importação, nunca nome_ptbr/status_traducao.
        // Se a CJ mudar o título de um item já aprovado, preservar o original associado à tradução.
        await pool.query(`INSERT INTO public.cj_produtos
          (id_externo,sku,nome,categoria,imagem,preco_usd,cambio_usd_brl,preco_brl,status,motivo,dados,atualizado_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'revisao',$9,$10::jsonb,NOW())
          ON CONFLICT(id_externo) DO UPDATE SET
          sku=EXCLUDED.sku,
          nome=CASE WHEN cj_produtos.status_traducao='aprovado' THEN cj_produtos.nome ELSE EXCLUDED.nome END,
          categoria=EXCLUDED.categoria, imagem=EXCLUDED.imagem,
          preco_usd=EXCLUDED.preco_usd,cambio_usd_brl=EXCLUDED.cambio_usd_brl,preco_brl=EXCLUDED.preco_brl,
          status=CASE WHEN cj_produtos.status='desativado' THEN 'desativado'
            WHEN cj_produtos.status='publicado' AND cj_produtos.status_traducao='aprovado'
              AND NULLIF(BTRIM(cj_produtos.nome_ptbr),'') IS NOT NULL AND $11::boolean THEN 'publicado'
            ELSE 'revisao' END,
          motivo=CASE WHEN cj_produtos.status='publicado' AND cj_produtos.status_traducao='aprovado'
              AND NULLIF(BTRIM(cj_produtos.nome_ptbr),'') IS NOT NULL AND $11::boolean THEN NULL
            ELSE EXCLUDED.motivo END,
          dados=CASE WHEN cj_produtos.status_traducao='aprovado'
            THEN (cj_produtos.dados || EXCLUDED.dados) || jsonb_build_object('nomeOriginalEn',COALESCE(cj_produtos.dados->>'nomeOriginalEn',cj_produtos.nome))
            ELSE cj_produtos.dados || EXCLUDED.dados END,
          atualizado_em=NOW()`,
          [item.id,item.sku,item.nome,item.categoria,item.imagem,item.custoUsd,cambio,precoBrl,reason,
           JSON.stringify({...item.raw,nomeOriginalEn:item.nome,descricaoOriginalEn:descricaoOriginal||undefined}),valid]);
        last.importados++;
        if(!anterior)last.novos++;
        if(anterior && !precoIgual)last.precosAlterados++;
        if(!valid || anterior?.status_traducao!=='aprovado')last.revisao++;
       }catch(e){last.erros++;last.mensagem=String(e.message).slice(0,180)}
      }
      // Importação e publicação desacopladas. Aprovações existentes são sincronizadas
      // após a importação; novas só entram após o robô gravar no banco.
      try{const sincronizado=await syncNow();last.publicados=sincronizado.adicionados;last.totalPublicadosAprovados=sincronizado.publicados;}
      catch(e){last.avisoSincronizacao='Sincronização posterior pendente: '+String(e.message).slice(0,120);}
      last.mensagem=`Concluído: ${(last.semAprovacao||0)} não aprovados ignorados; ${last.importados} selecionados processados; ${last.novos} novos, ${last.precosAlterados} preços alterados, ${last.semAlteracao} sem alteração, ${last.variantesPreservadas} variantes preservadas, ${last.desativadosIgnorados} desativados ignorados, ${(last.legadosPreservados||0)} legados preservados sem alterar preço, ${last.revisao} em revisão, ${last.erros} erros.`;
    }catch(e){last.erros++;last.mensagem='Falha CJ: '+String(e.message).slice(0,240)}
    finally{busy=false;last.executando=false;last.finalizadoEm=new Date().toISOString();
      if(source==='agendado'){try{const c=await schedule();await saveSchedule({...c,ultimaExecucao:last.finalizadoEm});}catch(e){console.error('CJ agendamento:',e.message)}}}
   });
   return started;
  }
  r.post('/importar',async(req,res)=>{try{const x=await startImport(req.body||{});res.status(x.iniciado?202:409).json(x)}catch(e){res.status(400).json({erro:e.message})}});
  r.get('/automacao/config',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await schedule())}catch(e){next(e)}});
  r.put('/automacao/config',async(req,res,next)=>{try{const old=await schedule(),b=req.body||{};const cfg={...old,ativo:b.ativo,intervaloHoras:Number(b.intervaloHoras),palavra:String(b.palavra||'').trim(),categorias:Array.isArray(b.categorias)?[...new Set(b.categorias.map(String))]:[],quantidade:Number(b.quantidade),pagina:Number(b.pagina)};validateSchedule(cfg);cfg.proximaExecucao=cfg.ativo?new Date(Date.now()+cfg.intervaloHoras*3600000).toISOString():null;await saveSchedule(cfg);res.json({ok:true,...cfg})}catch(e){res.status(400).json({erro:e.message})}});
  r.post('/automacao/executar-agora',async(req,res)=>{try{const cfg=await schedule();const x=await startImport(cfg,'manual');res.status(x.iniciado?202:409).json(x)}catch(e){res.status(400).json({erro:e.message})}});
  // Agendamento persistido no Neon, com reserva atômica do próximo horário.
  // Sincroniza após aprovação gravada pelo Robô Tradutor, sem exigir nova importação CJ.
  const syncTimer=setInterval(()=>{syncNow().catch(e=>console.error('[CJ PT-BR] sync:',e.message));},60000);syncTimer.unref?.();
  const timer=setInterval(async()=>{try{const cfg=await schedule();if(!cfg.ativo||busy||!cfg.proximaExecucao||Date.parse(cfg.proximaExecucao)>Date.now())return;const next=new Date(Date.now()+cfg.intervaloHoras*3600000).toISOString();const claimed=await pool.query(`UPDATE config SET valor=jsonb_set(valor,'{proximaExecucao}',to_jsonb($2::text),true) WHERE chave=$1 AND (valor->>'ativo')::boolean=true AND (valor->>'proximaExecucao')::timestamptz<=NOW() RETURNING chave`,[SCHEDULE_KEY,next]);if(claimed.rowCount){try{await startImport(cfg,'agendado')}catch(e){console.error('CJ automático:',e.message)}}}catch(e){console.error('CJ scheduler:',e.message)}},60000);timer.unref?.();
 // Rotas da REPRECIFICAÇÃO CJ — módulo isolado, não interfere na importação.
 r.use('/reprecificacao',require('./cj-reprecificacao')(pool,{call}));
 return r;
}
module.exports=createCJ;
