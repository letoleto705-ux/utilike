'use strict';
const { Router } = require('express');
const { createWorker } = require('./import-worker');
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
  const worker = createWorker(pool);
  // Sincroniza a galeria com tabela própria, sem publicar produtos.
  async function salvarGaleria(db, produtoId, imagens) {
    if (!Array.isArray(imagens) || !imagens.length) return;
    await db.query('DELETE FROM importacao_imagens WHERE importacao_url_id=$1',[produtoId]);
    for(let i=0;i<imagens.length;i++) {
      await db.query('INSERT INTO importacao_imagens(importacao_url_id,url_imagem,ordem) VALUES($1,$2,$3)',[produtoId,imagens[i],i+1]);
    }
  }


  // Administração autenticada pelo server.js (auth + soAdmin).
  // Operações atômicas por URL, preservando produtos sem vínculo com a importação.
  async function alterarSituacao(req,res,next,acao){
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({erro:'ID inválido.'});
    if(acao==='excluir' && req.body?.confirmacao!=='EXCLUIR')return res.status(400).json({erro:'Digite EXCLUIR para confirmar.'});
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      // Mesmo lock utilizado na publicação manual para sincronizar a vitrine.
      await db.query("INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING");
      const locked=await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");
      const catalog=locked.rows[0].valor;
      if(!Array.isArray(catalog))throw Error('Catálogo inválido; nenhuma alteração foi feita.');
      const found=await db.query('SELECT id,url,dados_extraidos FROM importacao_urls WHERE id=$1 FOR UPDATE',[id]);
      if(!found.rows.length){await db.query('ROLLBACK');return res.status(404).json({erro:'URL não encontrada. Atualize a fila.'})}
      const record=found.rows[0];
      const data=record.dados_extraidos && typeof record.dados_extraidos==='object' && !Array.isArray(record.dados_extraidos)?record.dados_extraidos:{};
      const linked=p=>String(p.importacaoUrlId??'')===String(id) || String(p.id)==='garimpagem-'+id;
      const published=catalog.filter(linked);
      const clean=catalog.filter(p=>!linked(p));
      if(acao==='excluir'){
        // Preserva a integridade de pedidos já efetuados, inclusive testes registrados.
        const order=await db.query("SELECT to_regclass('public.pedidos') AS tabela");
        if(order.rows[0].tabela){
          const existing=await db.query("SELECT 1 FROM pedidos WHERE produto_id=ANY($1::text[]) LIMIT 1",[[...new Set(['garimpagem-'+id,...published.map(p=>String(p.id))])]]);
          if(existing.rowCount){await db.query('ROLLBACK');return res.status(409).json({erro:'Há pedidos vinculados a este produto. A exclusão definitiva foi bloqueada para preservar o histórico.'})}
        }
        await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify(clean)]);
        // Tabelas auxiliares: exclusão explícita para compatibilidade com esquemas antigos.
        await db.query('DELETE FROM importacao_imagens WHERE importacao_url_id=$1',[id]);
        if((await db.query("SELECT to_regclass('public.importacao_precos') AS tabela")).rows[0].tabela) await db.query('DELETE FROM importacao_precos WHERE importacao_url_id=$1',[id]);
        await db.query('DELETE FROM importacao_urls WHERE id=$1',[id]);
      }else if(acao==='desativar'){
        // Guarda cópia do anúncio publicado no registro da URL para futura reativação.
        const snapshot=published.length?published[0]:(data.catalogo_desativado||null);
        await db.query("UPDATE importacao_urls SET dados_extraidos=COALESCE(dados_extraidos,'{}'::jsonb)||$2::jsonb,atualizado_em=NOW() WHERE id=$1",[id,JSON.stringify({desativado_vitrine:true,catalogo_desativado:snapshot})]);
        await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify(clean)]);
      }else if(acao==='reativar'){
        const snapshot=data.catalogo_desativado;
        if(!data.desativado_vitrine){await db.query('ROLLBACK');return res.status(409).json({erro:'Esta URL não está desativada.'})}
        if(snapshot && typeof snapshot==='object' && !Array.isArray(snapshot)){
          const restored={...snapshot,ativo:true};
          await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'",[JSON.stringify([...clean,restored])]);
        }
        await db.query("UPDATE importacao_urls SET dados_extraidos=COALESCE(dados_extraidos,'{}'::jsonb)||$2::jsonb,atualizado_em=NOW() WHERE id=$1",[id,JSON.stringify({desativado_vitrine:false,catalogo_desativado:null})]);
      }
      await db.query('COMMIT');
      res.set('Cache-Control','no-store').json({ok:true,id,acao,removidosDaVitrine:published.length});
    }catch(e){try{await db.query('ROLLBACK')}catch{}next(e)}finally{db.release()}
  }
  r.post('/produto/:id/desativar',(req,res,next)=>alterarSituacao(req,res,next,'desativar'));
  r.post('/produto/:id/reativar',(req,res,next)=>alterarSituacao(req,res,next,'reativar'));
  r.delete('/produto/:id',(req,res,next)=>alterarSituacao(req,res,next,'excluir'));

  r.post('/processar',async(req,res,next)=>{try{res.json(await worker.start())}catch(e){next(e)}});
  r.get('/processamento',(req,res)=>res.json(worker.status()));
  r.post('/lotes', async (req,res,next) => {
    try {
      const { urls, produtos, fornecedor = 'auto' } = req.body || {};
      // Compatibilidade: clientes antigos enviam apenas urls; novos enviam produtos vinculados.
      const hasProducts = Array.isArray(produtos);
      const inputList = hasProducts ? produtos : urls;
      if (!Array.isArray(inputList) || inputList.length < 1 || inputList.length > 1000 || !['auto',...ALLOWED].includes(fornecedor)) return res.status(400).json({ erro:'Envie de 1 a 1000 produtos ou URLs e fornecedor válido.' });
      const entries = [];
      for (let i=0;i<inputList.length;i++) {
        try {
          const raw = hasProducts ? inputList[i] : {url:inputList[i]};
          if (!raw || typeof raw !== 'object') throw Error('Registro inválido');
          const url=validate(raw.url);
          const pics = Array.isArray(raw.imagens) ? raw.imagens : [];
          if (pics.length > 12) throw Error('Máximo de 12 imagens por produto');
          const imagens = [...new Set(pics.map(validate))];
          // Apenas CDN conhecida do fornecedor; evita associar imagem arbitrária.
          for (const pic of imagens) {
            const h=new URL(pic).hostname.toLowerCase();
            if (!['alicdn.com','aliexpress-media.com'].some(d=>h===d||h.endsWith('.'+d))) throw Error('Domínio de imagem não autorizado');
          }
          const nome=typeof raw.titulo==='string'?raw.titulo.trim().slice(0,250):'';
          const categoria=typeof raw.categoria==='string'?raw.categoria.trim().slice(0,120):'';
          const fornecedorReal=fornecedor==='auto'?identify(url):fornecedor;
          if (imagens.length && fornecedorReal !== 'AliExpress') throw Error('Galeria disponível apenas para AliExpress');
          const precoObs=raw.preco_observado;
          const precoValido=typeof precoObs==='number' && Number.isFinite(precoObs) && precoObs>0 && precoObs<=1000000 && raw.moeda_observada==='BRL' && raw.preco_status==='observado_na_pagina_nao_confirmado';
          const freteStatus=typeof raw.frete_status==='string'?raw.frete_status:'frete_nao_confirmado';
          const fretePermitidos=['frete_gratis_observado','frete_pago_observado','frete_nao_confirmado','revisao_frete_contraditorio','nao_verificado'];
          if(!fretePermitidos.includes(freteStatus)) throw Error('Situação do frete inválida');
          const freteValor=raw.frete_observado;
          const freteNumerico=typeof freteValor==='number' && Number.isFinite(freteValor) && freteValor>=0 && freteValor<=1000000 ? Math.round(freteValor*100)/100 : null;
          const freteCoerente=(freteStatus==='frete_gratis_observado' && freteNumerico===0)||(freteStatus==='frete_pago_observado' && freteNumerico!==null && freteNumerico>0);
          entries.push({url, fornecedor:fornecedorReal, nome, categoria, imagens, precoObservado:precoValido?Math.round(precoObs*100)/100:null,freteStatus:freteCoerente?freteStatus:'frete_nao_confirmado',freteValor:freteCoerente?freteNumerico:null});
        } catch(e){ return res.status(400).json({erro:`Registro ${i+1}: ${e.message}`}); }
      }
      const unique = [...new Map(entries.map(x=>[x.url,x])).values()];
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const job=await client.query('INSERT INTO importacao_lotes (total, criado_por) VALUES ($1,$2) RETURNING id',[unique.length,req.user.usuario]);
        let inserted=0, atualizadas=0, comImagens=0;
        for(const x of unique){
          const hasGallery=x.imagens.length>0;
          // Não apagar dados comerciais anteriores quando uma nova captura falhar.
          const dados=JSON.stringify({...(x.nome?{nome:x.nome}:{}),...(x.categoria?{categoria:x.categoria}:{}),...(x.imagens.length?{imagens:x.imagens,imagem:x.imagens[0]}:{}),url_origem:x.url,origem:'captura_local_selenium',preco_confirmado:false});
          // Mantém revisões já existentes. Nunca publica na vitrine.
          const result=await client.query(`INSERT INTO importacao_urls (url,fornecedor,status,lote_id,nome,imagem,dados_extraidos)
            VALUES ($1,$2,'pendente',$3,$4,$5,$6)
            ON CONFLICT (url) DO NOTHING RETURNING id`,[x.url,x.fornecedor,job.rows[0].id,x.nome||null,x.imagens[0]||null,dados]);
          inserted+=result.rowCount;
          if(hasGallery && result.rows[0]) await salvarGaleria(client,result.rows[0].id,x.imagens);
          if(hasGallery || x.precoObservado!==null || x.freteValor!==null){
            if(hasGallery) comImagens++;
            if(!result.rowCount){
              const updated=await client.query(`UPDATE importacao_urls SET
                nome=COALESCE(NULLIF($2,''),nome),imagem=COALESCE($3,imagem),
                dados_extraidos=COALESCE(dados_extraidos,'{}'::jsonb) || $4::jsonb,
                atualizado_em=NOW()
                WHERE url=$1 RETURNING id`,[x.url,x.nome,x.imagens[0],dados]);
              if(updated.rows[0] && hasGallery) await salvarGaleria(client,updated.rows[0].id,x.imagens);
              atualizadas+=updated.rowCount;
            }
          }
          const saved=await client.query('SELECT id FROM importacao_urls WHERE url=$1',[x.url]);
          if(saved.rows[0] && (x.precoObservado!==null || x.freteValor!==null)){
            const productId=saved.rows[0].id;
            const shippingFree=x.freteStatus==='frete_gratis_observado'?true:x.freteStatus==='frete_pago_observado'?false:null;
            await client.query(`INSERT INTO importacao_precos(importacao_url_id,preco_custo,moeda,preco_status,frete_gratis,valor_frete,frete_status,origem,capturado_em)
              VALUES($1,$2,'BRL',$3,$4,$5,$6,'garimpagem',NOW())`,[productId,x.precoObservado,x.precoObservado!==null?'observado_na_pagina_nao_confirmado':'nao_verificado',shippingFree,x.freteValor,x.freteStatus]);
            const commercial={};
            if(x.precoObservado!==null)Object.assign(commercial,{preco_observado:x.precoObservado,moeda_observada:'BRL',preco_status:'observado_na_pagina_nao_confirmado'});
            if(x.freteValor!==null)Object.assign(commercial,{frete_gratis:shippingFree,frete_observado:x.freteValor,frete_status:x.freteStatus});
            await client.query(`UPDATE importacao_urls SET dados_extraidos=COALESCE(dados_extraidos,'{}'::jsonb)||$2::jsonb,atualizado_em=NOW() WHERE id=$1`,[productId,JSON.stringify(commercial)]);
          }
        }
        await client.query('UPDATE importacao_lotes SET inseridos=$1 WHERE id=$2',[inserted,job.rows[0].id]);
        await client.query('COMMIT');
        res.status(201).json({ok:true,lote:job.rows[0].id,recebidas:inputList.length,unicas:unique.length,inseridas:inserted,duplicadas:unique.length-inserted,galeriasRecebidas:comImagens,registrosAtualizados:atualizadas});
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }catch(e){next(e)}
  });
  // Dados observados localmente no Chrome: somente revisão, nunca publicação automática.
  r.post('/captura-local',async(req,res,next)=>{try{
    const {url,nome,descricao,imagens,categoria,observacoes}=req.body||{};
    const clean=validate(url);
    if(!/^(pt\.|www\.)?aliexpress\.com$/.test(new URL(clean).hostname)||!/^\/item\/\d+\.html$/.test(new URL(clean).pathname))return res.status(400).json({erro:'Envie uma URL direta de produto AliExpress.'});
    const pics=[...new Set((Array.isArray(imagens)?imagens:[]).filter(x=>typeof x==='string'&&x.length<2048&&/^https:\/\//i.test(x)))].slice(0,12);
    const data={nome:String(nome||'').slice(0,250),descricao:String(descricao||'').slice(0,2000),imagens:pics,imagem:pics[0]||null,categoria:String(categoria||'').slice(0,120),observacoes:String(observacoes||'').slice(0,500),url_origem:clean,origem:'captura_local_selenium',preco:null,estoque:null,frete_gratis:null,envio_brasil:null,fornecedor_brasil:null,preco_confirmado:false};
    if(!data.nome||!pics.length)return res.status(400).json({erro:'Capture ao menos título e uma imagem antes de enviar.'});
    const r0=await pool.query(`INSERT INTO importacao_urls(url,fornecedor,status,nome,imagem,dados_extraidos,atualizado_em) VALUES ($1,'AliExpress','revisao',$2,$3,$4,NOW()) ON CONFLICT(url) DO UPDATE SET nome=EXCLUDED.nome,imagem=EXCLUDED.imagem,dados_extraidos=EXCLUDED.dados_extraidos,status='revisao',erro=NULL,atualizado_em=NOW() RETURNING id,status`,[clean,data.nome,data.imagem,JSON.stringify(data)]);
    await salvarGaleria(pool,r0.rows[0].id,pics);
    res.json({ok:true,id:r0.rows[0].id,status:'revisao',mensagem:'Captura recebida no Neon. Preço, estoque, origem e frete aguardam verificação.'});
  }catch(e){next(e)}});
     r.get('/fila',async(req,res,next)=>{try{
     const hasPrices=Boolean((await pool.query("SELECT to_regclass('public.importacao_precos') AS tabela")).rows[0].tabela);
     const stats=await pool.query('SELECT status,count(*)::int AS quantidade FROM importacao_urls GROUP BY status');
     const priceColumns=hasPrices ? `
       (SELECT p.preco_custo FROM importacao_precos p WHERE p.importacao_url_id=u.id AND p.preco_custo IS NOT NULL ORDER BY p.capturado_em DESC,p.id DESC LIMIT 1) AS preco_observado,
       (SELECT p.frete_status FROM importacao_precos p WHERE p.importacao_url_id=u.id ORDER BY p.capturado_em DESC,p.id DESC LIMIT 1) AS frete_status,
       (SELECT p.valor_frete FROM importacao_precos p WHERE p.importacao_url_id=u.id AND p.valor_frete IS NOT NULL ORDER BY p.capturado_em DESC,p.id DESC LIMIT 1) AS valor_frete,`
       : `CASE WHEN (u.dados_extraidos->>'preco_observado') ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (u.dados_extraidos->>'preco_observado')::numeric ELSE NULL END AS preco_observado,
       u.dados_extraidos->>'frete_status' AS frete_status,
       CASE WHEN (u.dados_extraidos->>'frete_observado') ~ '^[0-9]{1,8}(\\.[0-9]{1,2})?$' THEN (u.dados_extraidos->>'frete_observado')::numeric ELSE NULL END AS valor_frete,`;
     const rows=await pool.query(`SELECT u.id,u.url,u.fornecedor,u.status,u.atualizado_em,u.erro,
       COALESCE((u.dados_extraidos->>'desativado_vitrine')::boolean,false) AS desativado_vitrine,
       ${priceColumns}
       COALESCE((SELECT jsonb_agg(jsonb_build_object('url',i.url_imagem,'ordem',i.ordem) ORDER BY i.ordem) FROM importacao_imagens i WHERE i.importacao_url_id=u.id),'[]'::jsonb) AS imagens
       FROM importacao_urls u ORDER BY u.criado_em DESC LIMIT 100`);
     res.set('Cache-Control','no-store').json({resumo:stats.rows,itens:rows.rows,limite:100,precosDisponiveis:hasPrices});
   }catch(e){next(e)}});
return r;
};
