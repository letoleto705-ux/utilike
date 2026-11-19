'use strict';
const { Router } = require('express');
module.exports = (pool) => {
  const r = Router();
  r.get('/candidatos', async (req,res,next) => {
    try {
      const result = await pool.query(`SELECT u.id,u.url,u.nome,u.fornecedor,u.status,u.imagem,u.preco,u.estoque,u.dados_extraidos,
        COALESCE((SELECT jsonb_agg(i.url_imagem ORDER BY i.ordem) FROM importacao_imagens i WHERE i.importacao_url_id=u.id),'[]'::jsonb) AS imagens
        FROM importacao_urls u WHERE u.status IN ('revisao','pronto') ORDER BY u.atualizado_em DESC LIMIT 100`);
      res.set('Cache-Control','no-store');res.json({itens:result.rows});
    } catch(e){next(e)}
  });
  r.post('/:id/publicar', async (req,res,next) => {
    const id = Number(req.params.id);
    const nome = String(req.body?.nome ?? '').trim();
    const categoria = String(req.body?.categoria ?? '').trim();
    const descricao = String(req.body?.descricao ?? '').trim();
    const preco = Number(req.body?.preco);
    const estoque = Number(req.body?.estoque);
    const confirmado = req.body?.confirmado === true;
    if (!Number.isSafeInteger(id) || id <= 0 || !nome || nome.length > 250 || !categoria || categoria.length > 120 || descricao.length > 2000 || !Number.isFinite(preco) || preco <= 0 || preco > 10000000 || !Number.isInteger(estoque) || estoque < 0 || estoque > 10000000 || !confirmado) {
      return res.status(400).json({erro:'Informe nome, categoria, preço positivo, estoque inteiro e confirme a revisão manual.'});
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT id,url,nome,imagem,status,dados_extraidos FROM importacao_urls WHERE id=$1 FOR UPDATE`,[id]);
      const u = found.rows[0];
      if(!u || !['revisao','pronto'].includes(u.status)){await client.query('ROLLBACK');return res.status(409).json({erro:'Registro não encontrado ou não está disponível para revisão.'})}
      const pics = await client.query('SELECT url_imagem FROM importacao_imagens WHERE importacao_url_id=$1 ORDER BY ordem LIMIT 12',[id]);
      const imagens = pics.rows.map(x=>x.url_imagem).filter(x=>typeof x==='string'&&/^https:\/\//.test(x));
      if(!imagens.length && typeof u.imagem==='string' && /^https:\/\//.test(u.imagem)) imagens.push(u.imagem);
      if(!imagens.length){await client.query('ROLLBACK');return res.status(409).json({erro:'Produto sem imagem válida; não pode ser publicado.'})}
      // Catálogo atual da vitrine: config.valor na chave produtos (JSONB).
      await client.query(`INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING`);
      const locked = await client.query(`SELECT valor FROM config WHERE chave='produtos' FOR UPDATE`);
      const lista = locked.rows[0].valor;
      if(!Array.isArray(lista)) throw Error('Catálogo de produtos não está em formato de lista.');
      const produtoId = `garimpagem-${id}`;
      const anterior = lista.find(p=>String(p.id)===produtoId);
      const produto = {...(anterior||{}),id:produtoId,nome,categoria,desc:descricao,precoPor:preco,estoque,imagem:imagens[0],imagens,ativo:true,urlFornecedor:u.url,importacaoUrlId:id};
      const novaLista = [...lista.filter(p=>String(p.id)!==produtoId),produto];
      await client.query(`UPDATE config SET valor=$1::jsonb WHERE chave='produtos'`,[JSON.stringify(novaLista)]);
      await client.query(`UPDATE importacao_urls SET status='pronto',nome=$2,preco=$3,estoque=$4,imagem=$5,atualizado_em=NOW() WHERE id=$1`,[id,nome,preco,estoque,imagens[0]]);
      await client.query('COMMIT');
      res.json({ok:true,produtoId,mensagem:'Produto publicado manualmente no catálogo da vitrine.'});
    } catch(e){try{await client.query('ROLLBACK')}catch{}next(e)}finally{client.release()}
  });
  return r;
};
