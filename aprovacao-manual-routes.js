'use strict';
const { Router } = require('express');
module.exports = (pool) => {
  const r = Router();
  // Configuração isolada no JSONB existente: não requer migração.
  r.get('/markup', async(req,res,next)=>{try{
    const x=await pool.query("SELECT valor FROM config WHERE chave='markup_divisor_margem'");
    const margem=x.rows.length?Number(x.rows[0].valor):30;
    res.json({margem:Number.isFinite(margem)&&margem>=0&&margem<100?margem:30});
  }catch(e){next(e)}});
  r.put('/markup', async(req,res,next)=>{try{
    const margem=Number(req.body?.margem);
    if(!Number.isFinite(margem)||margem<0||margem>80)return res.status(400).json({erro:'Margem entre 0% e 80%.'});
    await pool.query("INSERT INTO config(chave,valor) VALUES('markup_divisor_margem',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET valor=EXCLUDED.valor",[JSON.stringify(margem)]);
    res.json({ok:true,margem});
  }catch(e){next(e)}});
  r.get('/candidatos', async (req,res,next) => {
    try {
      const result = await pool.query(`SELECT u.id,u.url,u.nome,u.fornecedor,u.status,u.imagem,u.preco,u.estoque,u.dados_extraidos,
        (SELECT p.preco_custo FROM importacao_precos p WHERE p.importacao_url_id=u.id AND p.preco_custo IS NOT NULL ORDER BY p.capturado_em DESC,p.id DESC LIMIT 1) AS preco_custo_observado,
        (SELECT p.frete_status FROM importacao_precos p WHERE p.importacao_url_id=u.id ORDER BY p.capturado_em DESC,p.id DESC LIMIT 1) AS frete_status_observado,
        (SELECT p.valor_frete FROM importacao_precos p WHERE p.importacao_url_id=u.id AND p.valor_frete IS NOT NULL ORDER BY p.capturado_em DESC,p.id DESC LIMIT 1) AS frete_valor_observado,
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
    const custo = Number(req.body?.custo);
    const margem = Number(req.body?.margem);
    const freteConfirmado = req.body?.freteConfirmado === true;
    const precoConfirmado = req.body?.precoConfirmado === true;
    if (!Number.isSafeInteger(id) || id <= 0 || !nome || nome.length > 250 || !categoria || categoria.length > 120 || descricao.length > 2000 || !Number.isFinite(preco) || preco <= 0 || preco > 10000000 || !Number.isInteger(estoque) || estoque < 0 || estoque > 10000000 || !Number.isFinite(custo) || custo<=0 || !Number.isFinite(margem) || margem<0 || margem>80 || !precoConfirmado || !freteConfirmado || !confirmado) {
      return res.status(400).json({erro:'Informe nome, categoria, preço positivo, estoque inteiro e confirme a revisão manual.'});
    }
    const esperado=Math.ceil((custo/(1-margem/100)-1e-9)*100)/100;
    if(Math.abs(preco-esperado)>0.011)return res.status(400).json({erro:'Preço de venda divergente do markup divisor. Atualize o cálculo.'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT id,url,nome,imagem,status,dados_extraidos FROM importacao_urls WHERE id=$1 FOR UPDATE`,[id]);
      const u = found.rows[0];
      if(u?.dados_extraidos?.desativado_vitrine===true){await client.query('ROLLBACK');return res.status(409).json({erro:'Produto desativado. Reative-o na fila do Cronjob antes de publicar.'})}
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
      const produto = {...(anterior||{}),custoFornecedor:custo,margemMarkup:margem,id:produtoId,nome,categoria,desc:descricao,precoPor:preco,estoque,imagem:imagens[0],imagens,ativo:true,urlFornecedor:u.url,importacaoUrlId:id};
      const novaLista = [...lista.filter(p=>String(p.id)!==produtoId),produto];
      await client.query(`UPDATE config SET valor=$1::jsonb WHERE chave='produtos'`,[JSON.stringify(novaLista)]);
      await client.query(`UPDATE importacao_urls SET dados_extraidos=COALESCE(dados_extraidos,'{}'::jsonb)||$2::jsonb WHERE id=$1`,[id,JSON.stringify({preco_custo_confirmado:custo,moeda:'BRL',margem_markup:margem,preco_venda:preco,preco_confirmado:true,frete_revisado:true,confirmacao_manual_em:new Date().toISOString()})]);
      await client.query(`INSERT INTO importacao_precos(importacao_url_id,preco_custo,moeda,preco_status,frete_status,preco_venda,margem_aplicada,origem,capturado_em)
        VALUES($1,$2,'BRL','confirmado_manualmente','frete_confirmado_manualmente',$3,$4,'aprovacao_manual',NOW())`,[id,custo,preco,margem]);
      await client.query(`UPDATE importacao_urls SET status='pronto',nome=$2,preco=$3,estoque=$4,imagem=$5,atualizado_em=NOW() WHERE id=$1`,[id,nome,preco,estoque,imagens[0]]);
      await client.query('COMMIT');
      res.json({ok:true,produtoId,mensagem:'Produto publicado manualmente no catálogo da vitrine.'});
    } catch(e){try{await client.query('ROLLBACK')}catch{}next(e)}finally{client.release()}
  });
  return r;
};
