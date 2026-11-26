'use strict';
// Cotação obtida no servidor, cache persistente no Neon; nenhuma chave é exposta ao navegador.
const CACHE_KEY = 'cambio_usd_brl_awesome_v1';
const ENDPOINT = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_FALLBACK_AGE_MS = 48 * 60 * 60 * 1000;
function validRate(value) { const n=Number(value); return Number.isFinite(n)&&n>0&&n<100?n:null; }
function parseDate(value) { const n=Date.parse(value||''); return Number.isFinite(n)?n:0; }
async function getSaved(pool) {
  const result=await pool.query('SELECT valor FROM config WHERE chave=$1',[CACHE_KEY]);
  const row=result.rows[0]?.valor;
  return row && validRate(row.taxa) && parseDate(row.consultadoEm) ? row : null;
}
async function getRate(pool,{force=false}={}) {
  const saved=await getSaved(pool);
  const now=Date.now();
  if(!force && saved && now-parseDate(saved.consultadoEm)<MAX_AGE_MS)
    return {taxa:Number(saved.taxa),fonte:'awesomeapi-cache',consultadoEm:saved.consultadoEm,atualizadoAgora:false};
  const key=String(process.env.AWESOME_API_KEY||'').trim();
  if(!key) {
    const manual=validRate(process.env.CJ_USD_BRL);
    if(manual)return {taxa:manual,fonte:'CJ_USD_BRL-manual',consultadoEm:null,atualizadoAgora:false};
    throw Error('Configure AWESOME_API_KEY no Render ou CJ_USD_BRL com cotação numérica.');
  }
  try {
    const response=await fetch(ENDPOINT,{headers:{'Accept':'application/json','x-api-key':key},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('AwesomeAPI HTTP '+response.status);
    const json=await response.json();
    const quote=json?.USDBRL;
    // ask = venda; evita usar preço de compra como custo de conversão.
    const taxa=validRate(quote?.ask);
    if(!taxa)throw Error('AwesomeAPI retornou cotação USD/BRL inválida.');
    const consultadoEm=new Date().toISOString();
    const data={taxa,consultadoEm,fonte:'AwesomeAPI',cotacaoEm:quote?.create_date||null};
    await pool.query('INSERT INTO config(chave,valor) VALUES($1,$2::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor',[CACHE_KEY,JSON.stringify(data)]);
    return {taxa,fonte:'awesomeapi',consultadoEm,atualizadoAgora:true};
  } catch(err) {
    if(saved && now-parseDate(saved.consultadoEm)<MAX_FALLBACK_AGE_MS)
      return {taxa:Number(saved.taxa),fonte:'awesomeapi-cache-contingencia',consultadoEm:saved.consultadoEm,atualizadoAgora:false,aviso:'Falha na consulta; usando última cotação recente: '+err.message};
    throw Error('Não foi possível obter cotação segura da AwesomeAPI: '+err.message);
  }
}
module.exports={getRate,getSaved,CACHE_KEY,ENDPOINT};
