'use strict';
/** Reprecificação EXCLUSIVA CJ — não consulta/publica produtos de outros fornecedores.
 * A consulta (manual ou programada) NUNCA altera preços de venda.
 * A aprovação individual é a única operação que pode alterar o preço.
 * Reutiliza a autenticação de /api/admin/cj (auth + soAdmin no server.js).
 */
const {Router}=require('express');
const {getRate}=require('./cambio-awesome');
const {getConfig,calc}=require('./precificacao-central');
const {validarMargem,ensureCuradoria}=require('./cj-curadoria');

const KEY_AGENDA='cj_reprecificacao_agenda_v1';
const KEY_RUN='cj_reprecificacao_execucao_v1';
const KEY_BUDGET='cj_reprecificacao_pontos_v1';
const BUDGET_DIA=35000; // Orçamento de segurança *desta rotina*, não o saldo total da CJ.
const MIN_RESTANTES_CJ=5000; // Preserve pontos para outras funcionalidades da loja.
const INTERVALOS=new Set([1,2,3,4,5,6,24]);
const LOCK=24112619;
const priceUSD=x=>{if(typeof x==='string'&&!/^\d+(?:\.\d+)?$/.test(x.trim()))return null;
 const n=Number(x);return Number.isFinite(n)&&n>0&&n<100000?n:null;};
const cent=n=>Math.ceil((n-1e-9)*100)/100;
const exactCents=(a,b)=>Math.round(Number(a)*100)===Math.round(Number(b)*100);
const safeUrl=x=>{try{const u=new URL(String(x));return u.protocol==='https:'&&/(^|\.)cjdropshipping\.com$/i.test(u.hostname)?u.href:null}catch{return null}};
const isCJ=p=>p&&typeof p==='object'&&p.ativo!==false&&(p.cjProductId!=null||/^cj-/.test(String(p.id||''))||String(p.fornecedor||'').trim().toLowerCase()==='cj dropshipping');
const productPid=p=>String(p.cjProductId||String(p.id||'').replace(/^cj-/,''));
const allowedId=id=>typeof id==='string'&&id.length>0&&id.length<=200&&/^[\w-]+$/i.test(id);
const errMsg=e=>String(e?.message||e).slice(0,190);
const json=val=>JSON.stringify(val);
const RUN_DEFAULT={executando:false,origem:null,inicio:null,fim:null,total:0,verificados:0,atualizados:0,erros:0,revisar:0,mensagem:'Aguardando consulta.',proximoIndice:0};
const AGENDA_DEFAULT={ativo:false,intervaloHoras:24,proximaExecucao:null,ultimaExecucao:null};
/**
 * Escolha conservadora de variante: nunca use o menor preço, a primeira opção,
 * uma semelhança de título ou apenas a foto. SKU exato único é suficiente;
 * variantKey só quando foi armazenada explicitamente como atributo da variante.
 */
function encontrarVariante(variants,produto,meta){
 const list=variants.filter(v=>v&&typeof v==='object');
 if(list.length===1)return {variante:list[0],criterio:'variante_unica'};
 if(list.length===0)return {variante:null,criterio:'sem_variantes'};
 const d=meta?.dados||{};
 // Atenção: produto.sku, meta.sku e dados.productSku são códigos PAI (SPU)
 // na importação listV2. Não usá-los para selecionar a primeira variante.
 const skuList=[produto.cjVariantSku,d.varianteSkuSelecionada,d.cjVariantSku]
   .filter(v=>typeof v==='string'&&v.trim());
 for(const sku of new Set(skuList.map(x=>x.trim().toUpperCase()))){
   const found=list.filter(v=>String(v.variantSku||'').trim().toUpperCase()===sku);
   if(found.length===1)return {variante:found[0],criterio:'sku_exato'};
 }
 const key=[produto.cjVariantKey,d.varianteChaveSelecionada,d.variantKeySelecionada]
   .find(x=>typeof x==='string'&&x.trim());
 if(key){const found=list.filter(v=>String(v.variantKey||'').trim().toLowerCase()===key.trim().toLowerCase());
   if(found.length===1)return {variante:found[0],criterio:'opcao_exata'};
 }
 return {variante:null,criterio:'multiplas_sem_correspondencia'};
}
function createCJRepricing(pool,{call, safeMode = false}){
 const r=Router();let running=false;
 let ready;
 const ensure=()=>{
  if(!ready)ready=(async()=>{
   await ensureCuradoria(pool);
   await pool.query(`CREATE TABLE IF NOT EXISTS public.cj_reprecificacao (
    produto_id TEXT PRIMARY KEY, cj_pid TEXT NOT NULL, cj_vid TEXT,
    custo_usd NUMERIC(14,4), cambio NUMERIC(14,6), custo_brl NUMERIC(14,2),
    preco_atual_consulta NUMERIC(14,2), margem_percentual NUMERIC(7,2),
    sugerido NUMERIC(14,2), consulta_status TEXT NOT NULL DEFAULT 'aguardando',
    estoque_brasil INTEGER, estoque_info TEXT, link_cj TEXT, erro TEXT,
    consultado_em TIMESTAMPTZ, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(margem_percentual IS NULL OR (margem_percentual>=0 AND margem_percentual<100))
   )`);
   await pool.query(`CREATE TABLE IF NOT EXISTS public.cj_reprecificacao_historico (
    id BIGSERIAL PRIMARY KEY, produto_id TEXT NOT NULL, cj_pid TEXT NOT NULL,
    preco_anterior NUMERIC(14,2), preco_novo NUMERIC(14,2),
    custo_usd NUMERIC(14,4), custo_brl NUMERIC(14,2), margem_percentual NUMERIC(7,2),
    acao TEXT NOT NULL, registrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`);
  })().catch(e=>{ready=null;throw e});return ready;
 };
 async function configGet(key,def,db=pool){const q=await db.query('SELECT valor FROM public.config WHERE chave=$1',[key]);return {...def,...(q.rows[0]?.valor||{})};}
 async function configPut(key,value,db=pool){await db.query(`INSERT INTO public.config(chave,valor) VALUES($1,$2::jsonb)
    ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor`,[key,json(value)]);}
 async function catalogo(db=pool){const q=await db.query("SELECT valor FROM public.config WHERE chave='produtos'");
   if(!q.rows.length||!Array.isArray(q.rows[0].valor))throw Error('Catálogo da vitrine não disponível em config.produtos.');
   return q.rows[0].valor;
 }
 async function publicados(db=pool){
   const all=(await catalogo(db)).filter(isCJ), ids=[...new Set(all.map(productPid).filter(allowedId))];
   if(!ids.length)return [];
   const q=await db.query(`SELECT p.id_externo,p.sku,p.dados,p.status,g.decisao FROM public.cj_produtos p
      JOIN public.cj_curadoria g ON g.id_externo=p.id_externo
      WHERE p.id_externo=ANY($1::text[])`,[ids]);
   const ok=new Map(q.rows.filter(row=>row.status==='publicado'&&row.decisao==='aprovado').map(row=>[String(row.id_externo),row]));
   return all.filter(p=>allowedId(productPid(p))&&ok.has(productPid(p)))
      .map(p=>({produto:p,pid:productPid(p),meta:ok.get(productPid(p))}));
 }
 async function getRows(pagina=1,tamanho=25,termo='',modo='catalogo'){
   const list=await publicados();const ids=list.map(p=>String(p.produto.id));
   const snapshots=ids.length?await pool.query('SELECT * FROM public.cj_reprecificacao WHERE produto_id=ANY($1::text[])',[ids]):{rows:[]};
   const byId=new Map(snapshots.rows.map(x=>[x.produto_id,x]));
   const run=modo==='lote'?await configGet(KEY_RUN,RUN_DEFAULT):null;
   const idsConsultados=Array.isArray(run?.idsConsultados)?new Set(run.idsConsultados.map(String)):null;
   const from=run?.inicio?Date.parse(run.inicio):NaN;
   const to=run?.fim?Date.parse(run.fim):Date.now();
   const filtered=list.filter(({produto,pid})=>{
     if(modo==='lote'){
       if(idsConsultados){if(!idsConsultados.has(String(produto.id)))return false;}
       else { // Compatibilidade com consultas feitas antes da atualização.
         const snapshot=byId.get(String(produto.id));
         const at=snapshot?.consultado_em?Date.parse(snapshot.consultado_em):NaN;
         if(!Number.isFinite(from)||!Number.isFinite(at)||at<from||at>to)return false;
       }
     }
     return !termo||String(produto.nome||'').toLowerCase().includes(termo)||pid.toLowerCase().includes(termo);
   });
   const totals={total:list.length,consultados:0,risco:0,alterados:0,pendentes:0};
   const cfg=await getConfig(pool);
   for(const {produto} of list){const s=byId.get(String(produto.id));if(!s||!s.consultado_em||!['ok','aplicado'].includes(s.consulta_status)){totals.pendentes++;continue}
     totals.consultados++;if(isRisk(s,cfg))totals.risco++;
     if(Number(s.custo_brl)>Number(produto.custoFornecedor||0)+.009)totals.alterados++;
   }
   const pages=Math.max(1,Math.ceil(filtered.length/tamanho));const page=Math.min(pagina,pages);
   return {pagina:page,paginas:pages,totalFiltrado:filtered.length,estatisticas:totals,
     modo,ultimaConsulta:run?{inicio:run.inicio,fim:run.fim,verificados:run.verificados,total:run.total}:null,
     itens:filtered.slice((page-1)*tamanho,page*tamanho).map(({produto,pid,meta})=>{
      const s=byId.get(String(produto.id)),d=meta.dados||{};
      return {id:String(produto.id),pid,vid:String(produto.cjVariantId||d.varianteSelecionada||s?.cj_vid||''),
       nome:String(produto.nome||'Produto CJ'),imagem:String(produto.imagem||''),
       urlCJ:safeUrl(s?.link_cj)||safeUrl(d.productUrl||d.productLink||d.url||produto.urlFornecedor),
       precoAtual:Number(produto.precoPor)||null,custoAnterior:Number(produto.custoFornecedor)||null,
       custoUSD:s?.custo_usd==null?null:Number(s.custo_usd),
       custoBRL:s?.custo_brl==null?null:Number(s.custo_brl),
       cambio:s?.cambio==null?null:Number(s.cambio),
       margem:s?.margem_percentual==null?null:Number(s.margem_percentual),
       precoSugerido:s?.sugerido==null?null:Number(s.sugerido),
       status:s?.consulta_status||'aguardando',erro:s?.erro||null,
       estoqueBR:s?.estoque_brasil,estoqueInfo:s?.estoque_info||'Não informado pela CJ',
       consultadoEm:s?.consultado_em||null,
       risco:s?isRisk(s,cfg):false};
   })};
 }
 function isRisk(s,cfg){
   const venda=Number(s.preco_atual_consulta),custo=Number(s.custo_brl);
   if(!['ok','aplicado'].includes(s.consulta_status)||!(custo>0)||!(venda>0))return false;
   try{return calc(custo,{...cfg,margem:0})>=venda-.005}catch{return false}
 }
 function inventoryBR(v){
   const entries=Array.isArray(v?.inventories)?v.inventories:[];
   const br=entries.find(x=>String(x.countryCode||'').toUpperCase()==='BR');
   if(!br)return {qtd:null,info:'Estoque BR não informado; frete sob consulta'};
   const n=Number(br.totalInventory??br.totalInventoryNum);
   return {qtd:Number.isInteger(n)&&n>=0?n:null,info:'Depósito BR: '+(Number.isInteger(n)&&n>=0?n+' unidades':'quantidade não informada')+' · frete sob consulta'};
 }
 async function spendTen(){
   const db=await pool.connect();try{
     await db.query('BEGIN');
     await db.query("INSERT INTO public.config(chave,valor) VALUES($1,'{}'::jsonb) ON CONFLICT(chave) DO NOTHING",[KEY_BUDGET]);
     const current=await db.query('SELECT valor FROM public.config WHERE chave=$1 FOR UPDATE',[KEY_BUDGET]);
     const today=new Date().toISOString().slice(0,10),v=current.rows[0]?.valor||{};
     const used=v.dia===today?Number(v.pontosEstimados)||0:0;
     if(used+10>BUDGET_DIA){await db.query('COMMIT');return false;}
     await db.query('UPDATE public.config SET valor=$2::jsonb WHERE chave=$1',[KEY_BUDGET,json({dia:today,pontosEstimados:used+10})]);
     await db.query('COMMIT');return true;
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }
 async function updateSnapshot(item,out,precoAtual,cfg,cambio){
   const p=item.produto,pid=item.pid,prev=await pool.query('SELECT margem_percentual FROM public.cj_reprecificacao WHERE produto_id=$1',[p.id]);
   const margin=prev.rows[0]?.margem_percentual;
   const marginValid=margin!=null;
   let suggested=null;
   if(out.status==='ok'&&marginValid){
     try {suggested=calc(cent(out.usd*cambio),{...cfg,margem:validarMargem(Number(margin),cfg)});}
     catch {out.erro='Margem anterior incompatível com taxas atuais. Revise a margem individual.';}
   }
   await pool.query(`INSERT INTO public.cj_reprecificacao
      (produto_id,cj_pid,cj_vid,custo_usd,cambio,custo_brl,preco_atual_consulta,margem_percentual,sugerido,
       consulta_status,estoque_brasil,estoque_info,link_cj,erro,consultado_em,atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT(produto_id) DO UPDATE SET cj_pid=EXCLUDED.cj_pid,cj_vid=EXCLUDED.cj_vid,
       custo_usd=EXCLUDED.custo_usd,cambio=EXCLUDED.cambio,custo_brl=EXCLUDED.custo_brl,
       preco_atual_consulta=EXCLUDED.preco_atual_consulta,
       sugerido=EXCLUDED.sugerido,consulta_status=EXCLUDED.consulta_status,
       estoque_brasil=EXCLUDED.estoque_brasil,estoque_info=EXCLUDED.estoque_info,
       link_cj=EXCLUDED.link_cj,erro=EXCLUDED.erro,consultado_em=NOW(),atualizado_em=NOW()`,
     [String(p.id),pid,out.vid||null,out.usd,cambio,out.usd==null?null:cent(out.usd*cambio),
      precoAtual,margin,suggested,out.status,out.qtd,out.info,out.url,out.erro]);
 }
 async function consultarVarianteExata(pid,vid){
   const result=await call('/product/variant/queryByVid?'+new URLSearchParams({vid,features:'enable_inventory'}),{withMeta:true});
   const v=result.data;
   if(!v||String(v.vid||v.id||'')!==vid||String(v.pid||'')!==pid)
     throw Error('Variante CJ não pertence ao produto publicado; nenhuma cotação foi confirmada.');
   return {v,pointsInfo:result.pointsInfo};
 }
 async function askCJ(item){
   const p=item.produto,pid=item.pid,d=item.meta.dados||{};
   const persistida=await pool.query('SELECT cj_pid,cj_vid FROM public.cj_reprecificacao WHERE produto_id=$1',[String(p.id)]);
   const anterior=persistida.rows[0];
   const vid=String(p.cjVariantId||d.varianteSelecionada||
     (anterior?.cj_pid===pid?anterior.cj_vid:'')||'').trim();
   const url=safeUrl(d.productUrl||d.productLink||d.url||p.urlFornecedor);
   if(vid){
     const result=await consultarVarianteExata(pid,vid),usd=priceUSD(result.v.variantSellPrice??result.v.sellPrice);
     if(usd===null)return {status:'revisao',erro:'CJ não retornou preço USD válido para a variante confirmada.',vid,usd:null,qtd:null,info:'Não informado',url};
     return {status:'ok',usd,vid,...inventoryBR(result.v),url,pointsInfo:result.pointsInfo};
   }
   const result=await call('/product/variant/query?'+new URLSearchParams({pid}),{withMeta:true});
   const variants=Array.isArray(result.data)?result.data:Array.isArray(result.data?.variants)?result.data.variants:[];
   const valid=variants.filter(v=>!v.pid||String(v.pid)===pid);
   const selected=encontrarVariante(valid,p,item.meta);
   if(!selected.variante)return {status:'revisao',erro:valid.length?
     'Produto possui múltiplas variantes sem SKU/opção exata comprovada. Escolha a variante na Reprecificação CJ.':
     'CJ não retornou variante para este produto.',usd:null,vid:null,qtd:null,info:'Não informado',url,pointsInfo:result.pointsInfo};
   const v=selected.variante,newVid=String(v.vid||v.id||'');
   if(!allowedId(newVid))return {status:'revisao',erro:'Variante sem identificador válido.',usd:null,vid:null,qtd:null,info:'Não informado',url,pointsInfo:result.pointsInfo};
   const usd=priceUSD(v.variantSellPrice??v.sellPrice);
   if(usd===null)return {status:'revisao',erro:'Preço da variante selecionada não confirmado.',usd:null,vid:newVid,qtd:null,info:'Não informado',url,pointsInfo:result.pointsInfo};
   return {status:'ok',usd,vid:newVid,...inventoryBR(v),url,pointsInfo:result.pointsInfo};
 }
 async function updateRun(patch){const state=await configGet(KEY_RUN,RUN_DEFAULT);await configPut(KEY_RUN,{...state,...patch});}
 async function runJob(db,origin,quantidade){
   const oldState=await configGet(KEY_RUN,RUN_DEFAULT);
   let progress={...RUN_DEFAULT,idsConsultados:[],proximoIndice:Number(oldState.proximoIndice)||0,executando:true,origem:origin,inicio:new Date().toISOString(),mensagem:'Consultando preços pela API CJ...'};
   await configPut(KEY_RUN,progress);
   try{
     const products=await publicados(),cfg=await getConfig(pool),fx=await getRate(pool);
     const start=Math.min(Number(progress.proximoIndice)||0,Math.max(0,products.length-1));
     // Lote manual: respeita a quantidade pedida; automático e 'todos' consultam o catálogo completo.
     // O cursor persistido no Neon garante continuidade entre dois lotes manuais consecutivos.
     const alvo=quantidade==='todos'?products.length:Math.min(quantidade,products.length);
     progress={...progress,total:alvo,proximoIndice:start};await configPut(KEY_RUN,progress);
     for(let i=0;i<alvo;i++){
       // Rotação de início: se a execução anterior parou por saldo/erro, retoma do ponto salvo.
       const idx=(start+i)%products.length;
       const item=products[idx];
       const ok=await spendTen();if(!ok){progress.mensagem='Pausado: orçamento diário de segurança da reprecificação CJ atingido.';break}
       try{
         const out=await askCJ(item);
         await updateSnapshot(item,out,Number(item.produto.precoPor)||null,cfg,fx.taxa);
         if(out.status==='ok')progress.atualizados++;else progress.revisar++;
         if(out.pointsInfo&&Number.isFinite(Number(out.pointsInfo.remaining))&&Number(out.pointsInfo.remaining)<MIN_RESTANTES_CJ){
           progress.mensagem='Pausado: saldo de pontos CJ baixo. Preserve pontos para a operação da loja.';
           progress.verificados++;progress.proximoIndice=(idx+1)%products.length;break;
         }
       }catch(e){
         const msg=errMsg(e);
         // Se a CJ continuar respondendo 429 após as tentativas, NÃO marcar o
         // produto como erro definitivo e NÃO apagar a última cotação válida.
         // O cursor permanece neste mesmo produto para a próxima execução.
         if(e?.status===429||/429|qps limit|too many requests|insufficient api points|cj_api_key|accesstoken/i.test(msg)){
           progress.mensagem='Consulta pausada; a CJ limitou as chamadas ou precisa de autenticação: '+msg;
           progress.proximoIndice=idx;
           break;
         }
         progress.erros++;
         try{await updateSnapshot(item,{status:'erro',usd:null,vid:null,qtd:null,info:'Não informado',url:null,erro:msg},Number(item.produto.precoPor)||null,cfg,fx.taxa)}catch{}
       }
       progress.verificados++;
       progress.idsConsultados.push(String(item.produto.id));
       progress.proximoIndice=(idx+1)%products.length;
       if(progress.verificados%5===0)await configPut(KEY_RUN,progress);
     }
     if(progress.verificados===alvo){
       // Só reinicia no primeiro produto quando varreu todos; lotes menores avançam a fila.
       if(alvo===products.length)progress.proximoIndice=0;
       progress.mensagem=alvo===products.length
         ?'Catálogo CJ consultado. Nenhum preço foi publicado automaticamente.'
         :'Lote de '+alvo+' produto(s) concluído. A próxima consulta começa do produto seguinte. Nenhum preço foi publicado.';
     }else if(progress.mensagem==='Consultando preços pela API CJ...')progress.mensagem='Consulta interrompida. O próximo lote retomará do último produto processado.';
   }catch(e){progress.erros++;progress.mensagem='Falha: '+errMsg(e)}
   finally{
     progress.executando=false;progress.fim=new Date().toISOString();await configPut(KEY_RUN,progress).catch(e=>console.error('[CJ reprecificação] status',e.message));
     if(origin==='automatica'){
       const agenda=await configGet(KEY_AGENDA,AGENDA_DEFAULT).catch(()=>AGENDA_DEFAULT);
       await configPut(KEY_AGENDA,{...agenda,ultimaExecucao:progress.fim}).catch(()=>{});
     }
   }
 }
 async function startJob(origin,quantidade='todos'){
   if(quantidade!=='todos'&&(!Number.isSafeInteger(quantidade)||quantidade<1||quantidade>100000))return {ok:false,mensagem:'Quantidade inválida.'};
   if(running)return {ok:false,mensagem:'Já existe uma consulta CJ nesta instância.'};
   const db=await pool.connect();let locked=false;
   try{
     const l=await db.query('SELECT pg_try_advisory_lock($1) AS ok',[LOCK]);
     if(!l.rows[0]?.ok)return {ok:false,mensagem:'Outra instância está verificando preços CJ.'};
     locked=true;running=true;
     setImmediate(async()=>{
       try{await runJob(db,origin,quantidade)}catch(e){console.error('[CJ reprecificação]',errMsg(e))}
       finally{await db.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});db.release();running=false;}
     });
     return {ok:true,mensagem:'Consulta iniciada. Acompanhe o progresso nesta página.'};
   }finally{if(!locked)db.release()}
 }
 r.get('/produtos',async(req,res)=>{try{await ensure();const page=Number(req.query.pagina||1),size=Number(req.query.tamanho||25),term=String(req.query.busca||'').trim().toLowerCase().slice(0,80);
   if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>100)return res.status(400).json({erro:'Paginação inválida.'});
   const modo=req.query.modo==='lote'?'lote':'catalogo';
   res.set('Cache-Control','no-store').json(await getRows(page,size,term,modo));
 }catch(e){res.status(500).json({erro:errMsg(e)})}});
 r.get('/status',async(req,res)=>{try{await ensure();const [agenda,run,budget]=await Promise.all([configGet(KEY_AGENDA,AGENDA_DEFAULT),configGet(KEY_RUN,RUN_DEFAULT),configGet(KEY_BUDGET,{dia:'',pontosEstimados:0})]);
   const today=new Date().toISOString().slice(0,10);
   res.set('Cache-Control','no-store').json({agenda,execucao:{...run,executando:Boolean(running||(run.executando&&run.inicio&&Date.now()-Date.parse(run.inicio)<35*60*1000))},
     limitePontosDiario:BUDGET_DIA,pontosEstimadosHoje:budget.dia===today?budget.pontosEstimados:0});
 }catch(e){res.status(500).json({erro:errMsg(e)})}});
 r.post('/consultar',async(req,res)=>{try{await ensure();
   // O cliente precisa escolher explicitamente uma quantidade ou 'todos'. Nunca iniciar 577 chamadas por omissão.
   const quantidade=req.body?.quantidade;
   if(quantidade!=='todos'&&(!Number.isSafeInteger(quantidade)||quantidade<1||quantidade>100000))
     return res.status(400).json({erro:'Informe a quantidade de 1 a 100000 ou selecione Todos os produtos.'});
   const started=await startJob('manual',quantidade);res.status(started.ok?202:409).json(started)
 }catch(e){res.status(500).json({erro:errMsg(e)})}});
 r.put('/agendamento',async(req,res)=>{try{await ensure();const ativado=req.body?.ativo,h=Number(req.body?.intervaloHoras);
   if(typeof ativado!=='boolean'||!INTERVALOS.has(h))return res.status(400).json({erro:'Informe ativo e intervalo de 1 a 6 ou 24 horas.'});
   const old=await configGet(KEY_AGENDA,AGENDA_DEFAULT);
   const agenda={...old,ativo:ativado,intervaloHoras:h,proximaExecucao:ativado?new Date(Date.now()+h*3600000).toISOString():null};
   await configPut(KEY_AGENDA,agenda);res.json({ok:true,agenda,mensagem:ativado?'Agendamento salvo no Neon. A execução ocorrerá se o serviço Render estiver ativo.':'Monitoramento CJ desativado.'});
 }catch(e){res.status(500).json({erro:errMsg(e)})}});
 r.post('/margem/:id',async(req,res)=>{try{await ensure();const id=req.params.id;
   if(!allowedId(id))return res.status(400).json({erro:'ID inválido.'});
   const cfg=await getConfig(pool),margin=validarMargem(req.body?.margem,cfg);
   const snap=await pool.query('SELECT custo_brl,consulta_status FROM public.cj_reprecificacao WHERE produto_id=$1',[id]);
   if(snap.rows[0]?.consulta_status!=='ok'||!(Number(snap.rows[0].custo_brl)>0))return res.status(409).json({erro:'Consulte o custo do produto antes de definir a margem.'});
   const suggested=calc(Number(snap.rows[0].custo_brl),{...cfg,margem:margin});
   await pool.query('UPDATE public.cj_reprecificacao SET margem_percentual=$2,sugerido=$3,atualizado_em=NOW() WHERE produto_id=$1',[id,margin,suggested]);
   res.json({ok:true,margem:margin,precoSugerido:suggested});
 }catch(e){res.status(400).json({erro:errMsg(e)})}});
 r.post('/decidir/:id',async(req,res)=>{const id=String(req.params.id||'');const decision=req.body?.decisao;
   if(!allowedId(id)||!['aprovar','rejeitar'].includes(decision))return res.status(400).json({erro:'ID ou decisão inválida.'});
   let db;
   try{await ensure();db=await pool.connect();await db.query('BEGIN');
     const shot=await db.query('SELECT * FROM public.cj_reprecificacao WHERE produto_id=$1 FOR UPDATE',[id]);
     const s=shot.rows[0];if(!s)throw Error('Consulte a CJ antes de decidir.');
     const current=await db.query("SELECT valor FROM public.config WHERE chave='produtos' FOR UPDATE");
     const arr=current.rows[0]?.valor;
     if(!Array.isArray(arr))throw Error('Catálogo inválido.');
     const idx=arr.findIndex(p=>String(p.id)===id&&isCJ(p));
     if(idx<0)throw Error('Produto não está publicado na vitrine CJ.');
     const p=arr[idx],pid=productPid(p);
     if(pid!==s.cj_pid)throw Error('Referência CJ divergente.');
     const gate=await db.query(`SELECT p.status,g.decisao,p.dados FROM public.cj_produtos p
       JOIN public.cj_curadoria g ON g.id_externo=p.id_externo WHERE p.id_externo=$1 FOR UPDATE OF p,g`,[pid]);
     if(gate.rows[0]?.status!=='publicado'||gate.rows[0]?.decisao!=='aprovado')throw Error('Produto não está comercialmente aprovado/publicado.');
     if(decision==='rejeitar'){
       await db.query("UPDATE public.cj_reprecificacao SET consulta_status='rejeitado',atualizado_em=NOW() WHERE produto_id=$1",[id]);
       await db.query(`INSERT INTO public.cj_reprecificacao_historico(produto_id,cj_pid,preco_anterior,custo_usd,custo_brl,acao)
         VALUES($1,$2,$3,$4,$5,'rejeitado')`,[id,pid,Number(p.precoPor)||0,s.custo_usd,s.custo_brl]);
       await db.query('COMMIT');return res.json({ok:true,mensagem:'Proposta rejeitada. Preço atual preservado.'});
     }
     if(s.consulta_status!=='ok'||s.custo_usd===null||s.cambio===null||!s.consultado_em)throw Error('Custo CJ não confirmado. Consulte novamente.');
     if(Date.now()-new Date(s.consultado_em).getTime()>24*3600000)throw Error('Cotação CJ com mais de 24 horas. Consulte novamente.');
     const originalVid=String(p.cjVariantId||gate.rows[0].dados?.varianteSelecionada||'');
     if(originalVid&&originalVid!==s.cj_vid)throw Error('Variante diferente. Consulte novamente.');
     if(!s.cj_vid)throw Error('Variante sem identificação confirmada.');
     if(!exactCents(p.precoPor,s.preco_atual_consulta))throw Error('Preço da vitrine mudou após a consulta. Atualize a lista.');
     const cfg=await getConfig(db),margin=validarMargem(req.body?.margem,cfg);
     const cost=cent(Number(s.custo_usd)*Number(s.cambio));
     const nextPrice=calc(cost,{...cfg,margem:margin});
     const prev=Number(p.precoPor);
     const next={...p,precoPor:nextPrice,custoFornecedor:cost,precoOriginalUSD:Number(s.custo_usd),
       cambioAplicado:Number(s.cambio),margemMarkup:margin,freteEstimado:cfg.frete,
       reservaSeguranca:cfg.reserva,cjVariantId:s.cj_vid,precificacaoAtualizadaEm:new Date().toISOString()};
     arr[idx]=next;
     await db.query("UPDATE public.config SET valor=$1::jsonb WHERE chave='produtos'",[json(arr)]);
     await db.query(`UPDATE public.cj_produtos SET preco_usd=$2,cambio_usd_brl=$3,preco_brl=$4,
        dados=dados||$5::jsonb,atualizado_em=NOW()
        WHERE id_externo=$1 AND status='publicado'`,[pid,s.custo_usd,s.cambio,nextPrice,json({varianteSelecionada:s.cj_vid})]);
     await db.query(`UPDATE public.cj_curadoria SET margem_percentual=$2,atualizado_em=NOW()
        WHERE id_externo=$1 AND decisao='aprovado'`,[pid,margin]);
     await db.query(`INSERT INTO public.cj_reprecificacao_historico
       (produto_id,cj_pid,preco_anterior,preco_novo,custo_usd,custo_brl,margem_percentual,acao)
        VALUES($1,$2,$3,$4,$5,$6,$7,'aprovado')`,[id,pid,prev,nextPrice,s.custo_usd,cost,margin]);
     await db.query(`UPDATE public.cj_reprecificacao SET margem_percentual=$2,sugerido=$3,
       preco_atual_consulta=$3,consulta_status='aplicado',atualizado_em=NOW() WHERE produto_id=$1`,[id,margin,nextPrice]);
     await db.query('COMMIT');res.json({ok:true,precoAnterior:prev,precoNovo:nextPrice,mensagem:'Preço CJ aprovado e atualizado no Neon. A vitrine lerá o novo preço na próxima consulta.'});
   }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});res.status(409).json({erro:errMsg(e)})}
   finally{db?.release()}
 });
 // Resolução assistida: só consulta variantes e grava cotação no snapshot.
 // NÃO altera preço da vitrine, descrição, imagem pública ou decisão comercial.
 r.get('/variantes/:id',async(req,res)=>{try{
   await ensure();const id=String(req.params.id||'');
   if(!allowedId(id))return res.status(400).json({erro:'Produto inválido.'});
   const item=(await publicados()).find(x=>String(x.produto.id)===id);
   if(!item)return res.status(404).json({erro:'Produto CJ não publicado ou não aprovado.'});
   if(!await spendTen())return res.status(429).json({erro:'Orçamento diário CJ desta rotina esgotado.'});
   const data=await call('/product/variant/query?'+new URLSearchParams({pid:item.pid}));
   const variants=(Array.isArray(data)?data:Array.isArray(data?.variants)?data.variants:[])
     .filter(v=>v&&(!v.pid||String(v.pid)===item.pid));
   res.set('Cache-Control','no-store').json({id,pid:item.pid,nome:String(item.produto.nome||''),
     imagemAtual:String(item.produto.imagem||''),quantidade:variants.length,
     variantes:variants.map(v=>({vid:String(v.vid||v.id||''),sku:String(v.variantSku||''),
       nome:String(v.variantNameEn||v.variantName||''),opcoes:String(v.variantKey||''),
       imagem:String(v.variantImage||''),precoUSD:priceUSD(v.variantSellPrice??v.sellPrice)}))});
 }catch(e){res.status(e.status===429?429:502).json({erro:errMsg(e)})}});
 r.post('/selecionar-variante/:id',async(req,res)=>{try{
   await ensure();if(running)return res.status(409).json({erro:'Aguarde terminar a consulta em andamento.'});
   const id=String(req.params.id||''),vid=String(req.body?.vid||'').trim();
   if(!allowedId(id)||!allowedId(vid))return res.status(400).json({erro:'Produto ou variante inválida.'});
   const item=(await publicados()).find(x=>String(x.produto.id)===id);
   if(!item)return res.status(404).json({erro:'Produto CJ não publicado ou não aprovado.'});
   const predefinida=String(item.produto.cjVariantId||item.meta.dados?.varianteSelecionada||'');
   if(predefinida&&predefinida!==vid)return res.status(409).json({erro:
     'Este produto já tem outra variante ativa na vitrine. Não é seguro substituí-la por esta tela.'});
   if(!await spendTen())return res.status(429).json({erro:'Orçamento diário CJ desta rotina esgotado.'});
   const ret=await consultarVarianteExata(item.pid,vid);
   const usd=priceUSD(ret.v.variantSellPrice??ret.v.sellPrice);
   if(usd===null)return res.status(422).json({erro:'A CJ não confirmou preço USD para essa variante.'});
   const [cfg,fx]=await Promise.all([getConfig(pool),getRate(pool)]);
   await updateSnapshot(item,{status:'ok',usd,vid,...inventoryBR(ret.v),
     url:safeUrl(item.meta.dados?.productUrl||item.meta.dados?.productLink||item.meta.dados?.url||item.produto.urlFornecedor),erro:null},
     Number(item.produto.precoPor)||null,cfg,fx.taxa);
   res.set('Cache-Control','no-store').json({ok:true,vid,custoUSD:usd,custoBRL:cent(usd*fx.taxa),
     mensagem:'Variante validada e cotação salva para revisão. Preço da vitrine preservado até aprovação.'});
 }catch(e){res.status(e.status===429?429:502).json({erro:errMsg(e)})}});
 r.get('/historico/:id',async(req,res)=>{try{await ensure();if(!allowedId(req.params.id))return res.status(400).json({erro:'ID inválido.'});
   const x=await pool.query('SELECT * FROM public.cj_reprecificacao_historico WHERE produto_id=$1 ORDER BY registrado_em DESC LIMIT 30',[req.params.id]);res.json({itens:x.rows});
 }catch(e){res.status(500).json({erro:errMsg(e)})}});
 // Verificação automática do agendamento a cada minuto, mesmo sem painel aberto.
 const timer=safeMode ? null : setInterval(async()=>{
   if(running)return;
   try{await ensure();const a=await configGet(KEY_AGENDA,AGENDA_DEFAULT);
     if(!a.ativo||!a.proximaExecucao||Date.parse(a.proximaExecucao)>Date.now())return;
     const started=await startJob('automatica');if(!started.ok)return;
     const next=new Date(Date.now()+a.intervaloHoras*3600000).toISOString();
     await configPut(KEY_AGENDA,{...a,proximaExecucao:next});
   }catch(e){console.error('[CJ reprecificação] agendamento:',errMsg(e))}
 },60000);
 timer?.unref?.();
 return r;
}
module.exports=createCJRepricing;
