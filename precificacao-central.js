
'use strict';
// Fonte única de regras comerciais. Nunca substitui custo por preço de venda.
const {Router}=require('express');
const {ensureCuradoria,validarMargem}=require('./cj-curadoria');
const KEY='cronjob_automacao_v1';
const DEFAULT={margem:30,frete:20,reserva:0,taxaPagamento:0,tributos:0,reservaAfiliados:0,despesaFixa:0,protecao:0};
const money=n=>Math.ceil((n-1e-9)*100)/100;
function validar(c){
 for(const k of Object.keys(DEFAULT)){if(typeof c[k]!=='number'||!Number.isFinite(c[k])||c[k]<0)throw Error('Valor inválido em '+k);}
 const total=c.margem+c.reserva+c.taxaPagamento+c.tributos+c.reservaAfiliados+c.protecao;
 if(total>=100)throw Error('A soma das taxas percentuais precisa ser menor que 100% para permitir o cálculo divisor.');
 return c;
}
async function getConfig(db){const x=await db.query('SELECT valor FROM config WHERE chave=$1',[KEY]);return validar({...DEFAULT,...(x.rows[0]?.valor||{})});}
function calc(custo,c){
 const n=Number(custo);if(!Number.isFinite(n)||n<=0)throw Error('Custo do fornecedor inválido');
 validar(c);
 return money((n+c.frete+c.despesaFixa)/(1-(c.margem+c.reserva+c.taxaPagamento+c.tributos+c.reservaAfiliados+c.protecao)/100));
}
function createPricing(pool){const router=Router();let busy=false;let state={executando:false,mensagem:'Aguardando'};
 router.get('/config',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await getConfig(pool))}catch(e){next(e)}});
 router.put('/config',async(req,res,next)=>{try{
  const db=await pool.connect();try{await db.query('BEGIN');
   await db.query("INSERT INTO config(chave,valor) VALUES($1,'{}'::jsonb) ON CONFLICT(chave) DO NOTHING",[KEY]);
   const old=await db.query('SELECT valor FROM config WHERE chave=$1 FOR UPDATE',[KEY]);
   const changes={};for(const k of Object.keys(DEFAULT)){if(req.body?.[k]!==undefined){if(req.body[k]===''||req.body[k]===null)throw Error('Informe '+k);changes[k]=Number(req.body[k]);}}
   const cfg=validar({...DEFAULT,...old.rows[0].valor,...changes});
   await db.query('UPDATE config SET valor=$2::jsonb WHERE chave=$1',[KEY,JSON.stringify(cfg)]);await db.query('COMMIT');res.json({ok:true,...cfg});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }catch(e){res.status(400).json({erro:e.message})}});
 router.get('/status',(req,res)=>res.json(state));
 router.post('/recalcular',async(req,res)=>{
  if(busy)return res.status(409).json({erro:'Recálculo já em andamento'});
  busy=true;state={executando:true,mensagem:'Recalculando',alterados:0,ignorados:0,erros:0};
  res.status(202).json({iniciado:true,mensagem:'Recálculo iniciado. Consulte o status.'});
  setImmediate(async()=>{const db=await pool.connect().catch(()=>null);if(!db){busy=false;state={executando:false,mensagem:'Neon indisponível'};return}
   let locked=false;try{
    await ensureCuradoria(pool);
    const lock=await db.query('SELECT pg_try_advisory_lock($1) AS ok',[20481121]);if(!lock.rows[0].ok)throw Error('Outro recálculo está em andamento');locked=true;
    await db.query('BEGIN');const cfg=await getConfig(db);
    await db.query("INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING");
    const r=await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");const list=r.rows[0].valor;if(!Array.isArray(list))throw Error('Catálogo inválido');
    const aprov=await db.query("SELECT id_externo,margem_percentual FROM public.cj_curadoria WHERE decisao='aprovado'");
    const margensCJ=new Map(aprov.rows.map(x=>[String(x.id_externo),x.margem_percentual===null?null:Number(x.margem_percentual)]));
    const updated=[];
    for(const p of list){
     const prod={...p};
     if(prod.ativo===false){state.ignorados++;updated.push(prod);continue}
     let custo=Number(prod.custoFornecedor);
     if(!(custo>0)&&prod.cjProductId&&Number(prod.precoOriginalUSD)>0&&Number(prod.cambioAplicado)>0)custo=money(Number(prod.precoOriginalUSD)*Number(prod.cambioAplicado));
     if(!(custo>0)){state.ignorados++;updated.push(prod);continue}
     try{if(prod.cjProductId&&(!margensCJ.has(String(prod.cjProductId))||margensCJ.get(String(prod.cjProductId))===null)){state.ignorados++;updated.push(prod);continue}
      const margem=prod.cjProductId?validarMargem(margensCJ.get(String(prod.cjProductId)),cfg):cfg.margem;
      const preco=calc(custo,{...cfg,margem});prod.precoPor=preco;prod.custoFornecedor=custo;prod.margemMarkup=margem;prod.freteEstimado=cfg.frete;prod.reservaSeguranca=cfg.reserva;prod.precificacaoAtualizadaEm=new Date().toISOString();state.alterados++;
      if(prod.cjProductId)await db.query("UPDATE cj_produtos SET preco_brl=$2,atualizado_em=NOW() WHERE id_externo=$1 AND status<>'desativado'",[String(prod.cjProductId),preco]);
     }catch(e){state.erros++;}
     updated.push(prod);
    }
    await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify(updated)]);
    await db.query('COMMIT');state.mensagem='Concluído';
   }catch(e){await db.query('ROLLBACK').catch(()=>{});state.mensagem='Falha: '+e.message;state.erros++}
   finally{if(locked)await db.query('SELECT pg_advisory_unlock($1)',[20481121]).catch(()=>{});db.release();busy=false;state.executando=false;state.fim=new Date().toISOString()}
  });
 });
 return router;
}
module.exports={createPricing,getConfig,calc,validar};
