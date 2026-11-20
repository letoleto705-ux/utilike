'use strict';
const { Router } = require('express');
const crypto = require('crypto');
const KEY = 'cronjob_automacao_v1';
const DEFAULT = { ativo:false, intervalo:15, margem:30, frete:20, reserva:0, ultimaExecucao:null, proximaExecucao:null };
const MAX_BATCH = 100;
const lockKey = 20481120;
const number = (v) => typeof v === 'number' ? v : Number(v);
const money = n => Math.ceil((n-1e-9)*100)/100;
function validateSettings(x) {
  if (![5,15,30].includes(x.intervalo) || typeof x.ativo !== 'boolean') throw Error('Intervalo inválido.');
  for(const k of ['margem','frete','reserva']) if (!Number.isFinite(x[k]) || x[k]<0) throw Error('Valor inválido: '+k);
  if(x.margem>80 || x.reserva>50 || x.margem+x.reserva>=95 || x.frete>100000) throw Error('Markup fora dos limites permitidos.');
}
function createAutomation(pool) {
  let running = false;
  let state = {executando:false, processados:0, publicados:0, atualizados:0, revisao:0, ignorados:0, erros:0, mensagem:'Aguardando execução', inicio:null, fim:null};
  async function getConfig(client=pool) {
    const r=await client.query('SELECT valor FROM config WHERE chave=$1',[KEY]);
    const cfg={...DEFAULT,...(r.rows[0]?.valor||{})};
    validateSettings(cfg);return cfg;
  }
  async function putConfig(cfg, client=pool) {
    await client.query('INSERT INTO config(chave,valor) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor',[KEY,JSON.stringify(cfg)]);
  }
  async function runCycle(trigger='manual') {
    if(running)return {iniciado:false,motivo:'Execução já em andamento nesta instância.'};
    running=true;
    const db=await pool.connect();
    let locked=false;
    try {
      const lock=await db.query('SELECT pg_try_advisory_lock($1) AS ok',[lockKey]);
      if(!lock.rows[0].ok)return {iniciado:false,motivo:'Outro servidor já está executando o Cronjob.'};
      locked=true;
      state={executando:true,processados:0,publicados:0,atualizados:0,revisao:0,ignorados:0,erros:0,mensagem:'Processando produtos recebidos no Neon',inicio:new Date().toISOString(),fim:null,trigger};
      const cfg=await getConfig(db);
      // Seleciona todos os registros, não somente os 100 exibidos no painel.
      // O cursor é pelo ID para não perder linhas quando status/atualizado_em mudarem.
      let lastId=0;
      while(true) {
        const batch=await db.query(`SELECT u.id,u.url,u.nome,u.imagem,u.status,u.dados_extraidos,
          COALESCE((SELECT jsonb_agg(i.url_imagem ORDER BY i.ordem) FROM importacao_imagens i WHERE i.importacao_url_id=u.id),'[]'::jsonb) AS imagens
          FROM importacao_urls u WHERE u.id>$1 AND u.fornecedor='AliExpress' ORDER BY u.id LIMIT $2`,[lastId,MAX_BATCH]);
        if(!batch.rows.length)break;
        for(const row of batch.rows) {
          lastId=Number(row.id);state.processados++;
          const data=row.dados_extraidos||{};
          if(data.desativado_vitrine===true || data.bloqueado_automacao===true){state.ignorados++;continue;}
          const images=(Array.isArray(row.imagens)?row.imagens:[]).filter(x=>typeof x==='string'&&/^https:\/\//.test(x)).slice(0,12);
          if(!images.length && typeof row.imagem==='string' && /^https:\/\//.test(row.imagem))images.push(row.imagem);
          const videos=[...new Set((Array.isArray(data.videos)?data.videos:[data.url_video].filter(Boolean)).filter(x=>typeof x==='string'&&/^https:\/\//i.test(x)))].slice(0,5);
          const cost=number(data.preco_observado);
          const priceOk=data.preco_status==='observado_na_pagina_nao_confirmado' && data.moeda_observada==='BRL' && data.preco_observado!==null && data.preco_observado!==undefined && Number.isFinite(cost)&&cost>0&&cost<=1000000;
          const name=String(row.nome||data.nome||'').trim().slice(0,250);
          const category=String(data.categoria||'Tecnologia').trim().slice(0,120);
          if(!priceOk || !images.length || !name) {
            // Não apagar um anúncio antigo nem substituir seu preço por uma captura incompleta.
            if(row.status==='pendente' || row.status==='processando') await db.query("UPDATE importacao_urls SET status='revisao', erro=$2,atualizado_em=NOW() WHERE id=$1",[row.id,!priceOk?'Preço atual não confirmado':!images.length?'Sem imagem válida':'Sem título']);
            state.revisao++;continue;
          }
          const sale=money((cost+cfg.frete)/(1-(cfg.margem+cfg.reserva)/100));
          const signature=crypto.createHash('sha256').update(JSON.stringify({cost,images,videos,descricao:data.descricao||'',name,category,margem:cfg.margem,frete:cfg.frete,reserva:cfg.reserva})).digest('hex');
          if(data.automacao_assinatura===signature && row.status==='pronto'){state.ignorados++;continue;}
          try {
            await db.query('BEGIN');
            await db.query("INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING");
            const lockedCatalog=await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");
            const list=lockedCatalog.rows[0].valor;
            if(!Array.isArray(list))throw Error('Catálogo inválido');
            const fresh=await db.query('SELECT dados_extraidos FROM importacao_urls WHERE id=$1 FOR UPDATE',[row.id]);
            if(!fresh.rows.length || fresh.rows[0].dados_extraidos?.desativado_vitrine===true || fresh.rows[0].dados_extraidos?.bloqueado_automacao===true){await db.query('ROLLBACK');state.ignorados++;continue;}
            const id='garimpagem-'+row.id;
            const prev=list.find(p=>String(p.id)===id || String(p.importacaoUrlId??'')===String(row.id));
            const product={...(prev||{}),id,importacaoUrlId:Number(row.id),urlFornecedor:row.url,nome:name,categoria:category,desc:String(data.descricao||prev?.desc||'').slice(0,2000),imagem:images[0],imagens,videos,urlVideo:videos[0]||null,precoPor:sale,custoFornecedor:cost,margemMarkup:cfg.margem,freteEstimado:cfg.frete,reservaSeguranca:cfg.reserva,estoque:prev?.estoque??null,ativo:true};
            // Nunca exibe rótulo de encomenda; também não inventa estoque.
            delete product.sobEncomenda;
            await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify([...list.filter(p=>String(p.id)!==id && String(p.importacaoUrlId??'')!==String(row.id)),product])]);
            await db.query("UPDATE importacao_urls SET status='pronto',nome=$2,imagem=$3,preco=$4,erro=NULL,dados_extraidos=COALESCE(dados_extraidos,'{}'::jsonb)||$5::jsonb,atualizado_em=NOW() WHERE id=$1",[row.id,name,images[0],sale,JSON.stringify({automacao_assinatura:signature,automacao_publicado_em:new Date().toISOString(),preco_venda:sale,margem_markup:cfg.margem,frete_universal:cfg.frete,reserva_seguranca:cfg.reserva})]);
            await db.query('COMMIT');
            if(prev)state.atualizados++;else state.publicados++;
          } catch(e) {
            await db.query('ROLLBACK').catch(()=>{});
            state.erros++;state.mensagem='Erro em '+row.id+': '+String(e.message).slice(0,130);
          }
        }
      }
      state.mensagem=`Concluído: ${state.publicados} novos, ${state.atualizados} atualizados, ${state.revisao} para revisão, ${state.erros} erros.`;
      state.fim=new Date().toISOString();
      const updated={...cfg,ultimaExecucao:state.fim,proximaExecucao:cfg.ativo?new Date(Date.now()+cfg.intervalo*60000).toISOString():null};
      await putConfig(updated,db);
      return {iniciado:true,...state};
    } finally {
      state.executando=false;
      if(locked)await db.query('SELECT pg_advisory_unlock($1)',[lockKey]).catch(()=>{});
      db.release();running=false;
    }
  }
  // A requisição HTTP não fica aberta até terminar centenas de produtos.
  function start(trigger) {
    if(running)return {iniciado:false,motivo:'Já existe execução em andamento.'};
    running=true;
    setImmediate(()=>{running=false;runCycle(trigger).catch(e=>{state={...state,executando:false,erros:state.erros+1,mensagem:'Erro geral: '+String(e.message).slice(0,200),fim:new Date().toISOString()};})});
    return {iniciado:true,mensagem:'Execução solicitada.'};
  }
  const router=Router();
  router.get('/config',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await getConfig())}catch(e){next(e)}});
  router.put('/config',async(req,res,next)=>{try{
    const old=await getConfig();const b=req.body||{};
    const cfg={...old,ativo:b.ativo,intervalo:Number(b.intervalo),margem:Number(b.margem),frete:Number(b.frete),reserva:Number(b.reserva)};
    validateSettings(cfg);cfg.proximaExecucao=cfg.ativo?new Date(Date.now()+cfg.intervalo*60000).toISOString():null;
    await putConfig(cfg);res.json({ok:true,...cfg});
  }catch(e){if(e.message.includes('inválido')||e.message.includes('limites'))res.status(400).json({erro:e.message});else next(e)}});
  router.post('/executar-agora',(req,res)=>res.json(start('manual')));
  router.get('/status',(req,res)=>{res.set('Cache-Control','no-store').json(state)});
  // Verificação periódica no servidor, independente de a aba estar aberta.
  const timer=setInterval(async()=>{
    try{const cfg=await getConfig();if(cfg.ativo && !running && (!cfg.proximaExecucao || Date.parse(cfg.proximaExecucao)<=Date.now())){
      const claimed=await pool.query(`UPDATE config SET valor=jsonb_set(valor,'{proximaExecucao}',to_jsonb($2::text),true) WHERE chave=$1 AND (valor->>'proximaExecucao' IS NULL OR (valor->>'proximaExecucao')::timestamptz<=NOW()) RETURNING chave`,[KEY,new Date(Date.now()+cfg.intervalo*60000).toISOString()]);
      if(claimed.rowCount)start('agendado');
    }}
    catch(e){console.error('Cronjob automático:',e.message)}
  },30000);
  timer.unref?.();
  return router;
}
module.exports=createAutomation;
