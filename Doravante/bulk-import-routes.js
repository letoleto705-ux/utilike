'use strict';
const { Router } = require('express');
const ALLOWED = new Set(['AliExpress','CJ Dropshipping','DSLite','Outro']);
function identify(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'aliexpress.com' || host.endsWith('.aliexpress.com')) return 'AliExpress';
  if (host === 'cjdropshipping.com' || host.endsWith('.cjdropshipping.com')) return 'CJ Dropshipping';
  return 'Outro';
}
function validate(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw Error('URL inválida ou muito longa');
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) throw Error('Apenas URL HTTPS pública sem credenciais');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':') || !host.includes('.')) throw Error('Domínio não permitido');
  url.hash = '';
  return url.toString();
}
module.exports = pool => {
  const r = Router();
  r.post('/lotes', async (req,res,next) => {
    try {
      const { urls, fornecedor = 'auto' } = req.body || {};
      if (!Array.isArray(urls) || urls.length < 1 || urls.length > 1000 || !['auto',...ALLOWED].includes(fornecedor)) return res.status(400).json({ erro:'Envie de 1 a 1000 URLs e fornecedor válido.' });
      const entries = [];
      for (const input of urls) {
        try { const url=validate(input); entries.push({url, fornecedor:fornecedor==='auto'?identify(url):fornecedor}); }
        catch(e){ return res.status(400).json({erro:`URL inválida na linha ${entries.length+1}: ${e.message}`}); }
      }
      const unique = [...new Map(entries.map(x=>[x.url,x])).values()];
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const job=await client.query('INSERT INTO importacao_lotes (total, criado_por) VALUES ($1,$2) RETURNING id',[unique.length,req.user.usuario]);
        let inserted=0;
        for(const x of unique){
          const result=await client.query(`INSERT INTO importacao_urls (url,fornecedor,status,lote_id) VALUES ($1,$2,'pendente',$3) ON CONFLICT (url) DO NOTHING RETURNING id`,[x.url,x.fornecedor,job.rows[0].id]);
          inserted+=result.rowCount;
        }
        await client.query('UPDATE importacao_lotes SET inseridos=$1 WHERE id=$2',[inserted,job.rows[0].id]);
        await client.query('COMMIT');
        res.status(201).json({ok:true,lote:job.rows[0].id,recebidas:urls.length,unicas:unique.length,inseridas:inserted,duplicadas:unique.length-inserted});
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }catch(e){next(e)}
  });
  r.get('/fila',async(req,res,next)=>{try{
    const [stats,rows]=await Promise.all([
      pool.query('SELECT status, count(*)::int AS quantidade FROM importacao_urls GROUP BY status'),
      pool.query('SELECT id,url,fornecedor,status,atualizado_em,erro FROM importacao_urls ORDER BY criado_em DESC LIMIT 100')
    ]);
    res.set('Cache-Control','no-store');res.json({resumo:stats.rows,itens:rows.rows,limite:100});
  }catch(e){next(e)}});
  return r;
};
