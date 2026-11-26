'use strict';
// Módulo independente de VITRINE. Não implementa checkout e não consulta módulos de afiliados.
const {Router}=require('express');
const {createHash}=require('node:crypto');
module.exports=function criarVitrine({pool,auth,soAdmin,lerCatalogoPublico}){
 const router=Router();
 const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);
 const q=(sql,params)=>pool.query(sql,params);
 const txt=(x,max=200)=>String(x??'').trim().slice(0,max);
 const publico=async()=>{const x=await lerCatalogoPublico();return Array.isArray(x)?x.filter(p=>p&&p.ativo!==false&&p.active!==false):[]};
 const nome=p=>txt(p?.nome||p?.name||'',250);
 const preco=p=>Number(p?.precoPor??p?.preco??p?.price??0);
 const valido=p=>p&&nome(p)&&Number.isFinite(preco(p))&&preco(p)>0;
 // Só envia dados apropriados ao público: nunca custoFornecedor, markup ou JSON bruto CJ.
 const produtoPublico=p=>({
  id:String(p.id),nome:nome(p),categoria:txt(p.categoria||p.category||'Outros',120),
  // A aba de descricao conserva os dados do fornecedor e do Robô Tradutor.
  descricao:txt(p.descricao_ptbr||p.descricao||p.desc||'',10000),
  // Copy comercial separada: so recebe texto quando status for 'publicada'.
  copyUtiLike:txt(p.copyUtiLike||'',2000),
  imagem:txt(p.imagem||p.image||'',500),
  imagens:(Array.isArray(p.imagens)?p.imagens:[]).slice(0,20),
  videos:(Array.isArray(p.videos)?p.videos:[]).slice(0,5),
  urlVideo:txt(p.urlVideo||p.url_video||'',500),
  precoPor:preco(p),precoDe:Number(p.precoDe||0)>preco(p)?Number(p.precoDe):0,
  sku:txt(p.sku||'',150),estoque:p.estoque??null,
  envioBrasil:p.envioBrasil===true,estoqueBrasil:p.estoqueBrasil===true,
  variantes:Array.isArray(p.variantes)?p.variantes.slice(0,50).map(x=>({id:String(x?.id??x?.vid??''),nome:txt(x?.nome||x?.name||x?.sku||'',120)})):[],
  especificacoes:p.especificacoes&&typeof p.especificacoes==='object'&&!Array.isArray(p.especificacoes)?p.especificacoes:{},
  avaliacoes:Array.isArray(p.avaliacoes)?p.avaliacoes.slice(0,100).filter(x=>x&&x.verificada===true).map(x=>({comentario:txt(x.comentario||'',300)})):[]
 });

 const lim=(n,min,max,d)=>Number.isInteger(Number(n))?Math.max(min,Math.min(max,Number(n))):d;
 const cliente=async(req)=>{
   if(req.user.perfil!=='cliente') {const e=Error('Apenas contas de clientes utilizam este recurso.');e.status=403;throw e;}
   const check=await q('SELECT 1 FROM public.contas WHERE usuario=$1',[req.user.usuario]);
   if(!check.rowCount){const e=Error('Conta não encontrada.');e.status=401;throw e;}
   const r=await q('INSERT INTO public.vitrine_clientes(usuario) VALUES($1) ON CONFLICT(usuario) DO UPDATE SET usuario=EXCLUDED.usuario RETURNING id',[req.user.usuario]);
   return r.rows[0].id;
 };
 const carrinho=async(clienteId)=>{const r=await q('INSERT INTO public.vitrine_carrinhos(cliente_id) VALUES($1) ON CONFLICT(cliente_id) DO UPDATE SET atualizado_em=public.vitrine_carrinhos.atualizado_em RETURNING id',[clienteId]);return r.rows[0].id};
 function destinoSeguro(x){const s=txt(x||'/index.html',400);if(!s.startsWith('/')||s.startsWith('//')||s.includes('\\')||/[\r\n\u0000]/.test(s))throw Object.assign(Error('Destino deve começar com / na Uti Like.'),{status:400});return s;}
 function imagemSegura(x){const s=txt(x,500);if(!s)return '';if(s.startsWith('/assets/')&&!s.startsWith('//'))return s;try{const u=new URL(s);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href}catch{}throw Object.assign(Error('Imagem deve ser HTTPS ou caminho /assets/.'),{status:400});}
 const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x||'');
 // Consulta individual reduz a transferência no celular; preserva o portão PT-BR do catálogo público.
 // Resumo público e em lote para mostrar itens da sacola mesmo antes do login.
 // Não retorna custo do fornecedor, comissão, markup ou dados não publicados.
 router.post('/produtos/resumo',wrap(async(req,res)=>{
  const ids=Array.isArray(req.body?.ids)?req.body.ids:[];
  if(ids.length>4000)return res.status(413).json({erro:'Envie a consulta em lotes menores.'});
  const conjunto=new Set(ids.map(x=>txt(x,250)).filter(Boolean));
  const dados=(await publico()).filter(p=>conjunto.has(String(p.id))).map(p=>({
   id:String(p.id),nome:nome(p),categoria:txt(p.categoria||p.category||'Outros',120),
   imagem:txt(p.imagem||p.image||'',500),precoPor:preco(p),
   disponivel:valido(p)&&!(p.estoque!==null&&p.estoque!==undefined&&Number(p.estoque)<=0),
   estoque:p.estoque??null
  }));
  res.set('Cache-Control','no-store').json({itens:dados});
 }));
 router.get('/produtos/:id',wrap(async(req,res)=>{
  const id=txt(req.params.id,250),list=await publico(),p=list.find(p=>String(p.id)===id&&valido(p));
  if(!p)return res.status(404).json({erro:'Produto indisponível.'});
  // Nao expor copys antigas se a publicacao estiver desativada ou nao aprovada.
  let exibicao={...p,copyUtiLike:''};
  // Apenas status='publicada' autoriza copy no destaque principal.
  // Erro/revisao/gerada => titulo e descricao originais preservados.
  if(process.env.ROBO_COPY_ENABLED==='true'){
   const r=await q("SELECT texto_copy FROM public.robo_copy_produtos WHERE produto_id=$1 AND status='publicada'",[id]);
   if(r.rowCount)exibicao={...p,copyUtiLike:r.rows[0].texto_copy};
  }
  res.set('Cache-Control','no-store').json(produtoPublico(exibicao));
 }));
 // Paginação estável da vitrine espelhada: sem limite global de 8/12 produtos.
 const resumoCard=p=>({id:String(p.id),nome:nome(p),categoria:txt(p.categoria||p.category||'Outros',120),imagem:txt(p.imagem||p.image||'',500),precoPor:preco(p),precoDe:Number(p.precoDe||0)>preco(p)?Number(p.precoDe):0});
 const normCat=v=>txt(v,160).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 function grupoCat(v){const s=normCat(v);if(!s)return '';
  const grupos=[['eletronicos',/electronic|eletronic|consumer electronics|headphone|audio|cell phone/],['tecnologia',/technology|tecnolog|computer|informatic|digital|smart|gadget/],['casa',/household|home|kitchen|casa|decor|jardim|garden|furniture/],['moda',/fashion|apparel|clothing|roupa|shoes|socks|meia|moda|accessor|acessor|bolsa|bag/],['beleza',/beauty|cosmetic|health|skin|hair|beleza|saude/],['esporte',/sport|fitness|running|gym|academia|esporte|camping/],['ferramentas',/tool|hardware|industrial|ferrament/],['brinquedos',/toy|baby|kids|brinqued|infantil/],['automotivo',/automot|vehicle|motor|carro/],['pets',/pet|animal|dog|cat|cachorro|gato/]];
  return grupos.find(([,re])=>re.test(s))?.[0]||'exato:'+s;
 }
 // Ordenação determinística por visita: a mesma chave mantém páginas coerentes,
 // mas cada nova visita recebe uma chave diferente do navegador. Não grava nada no Neon.
 function listaEmbaralhada(lista,req){
  const s=txt(req.query.ordem,80);
  if(!/^[a-f0-9]{16,64}$/i.test(s))return lista; // compatibilidade com clientes anteriores
  const ids=new Set();
  const unicos=lista.filter(p=>{const id=String(p.id);if(ids.has(id))return false;ids.add(id);return true});
  const ordenados=unicos.map(p=>({p,id:String(p.id),hash:createHash('sha256').update(s+'\0'+String(p.id)).digest('hex')}));
  ordenados.sort((a,b)=>a.hash.localeCompare(b.hash)||a.id.localeCompare(b.id));
  const anterior=txt(req.query.evitarPrimeiro,250);
  if(ordenados.length>1&&anterior&&ordenados[0].id===anterior){[ordenados[0],ordenados[1]]=[ordenados[1],ordenados[0]];}
  return ordenados.map(x=>x.p);
 }
 function paginaPublica(res,lista,req,categoria=''){
  const ordenada=listaEmbaralhada(lista,req);
  const pagina=lim(req.query.pagina,1,100000,1),porPagina=lim(req.query.limite,1,36,16),inicio=(pagina-1)*porPagina;
  const itens=ordenada.slice(inicio,inicio+porPagina).map(resumoCard);
  res.set('Cache-Control','public, max-age=20').json({itens,pagina,limite:porPagina,total:ordenada.length,temMais:inicio+itens.length<ordenada.length,categoria});
 }
 router.get('/catalogo',wrap(async(req,res)=>{const todos=(await publico()).filter(valido);paginaPublica(res,todos,req)}));
 router.get('/recomendacoes/:id',wrap(async(req,res)=>{
  const id=txt(req.params.id,250),todos=(await publico()).filter(valido),base=todos.find(p=>String(p.id)===id);
  if(!base){return req.query.pagina?paginaPublica(res,[],req):res.json([])}
  const categoria=txt(base.categoria||base.category||'Outros',120),group=grupoCat(categoria);
  // O produto aberto continua elegível na própria vitrine extra, como os demais da categoria.
  const relacionados=todos.filter(p=>grupoCat(p.categoria||p.category)===group);
  // Compatibilidade com clientes antigos que esperam array sem parâmetro "pagina".
  if(!req.query.pagina)return res.json(relacionados.slice(0,lim(req.query.limite,1,36,8)).map(resumoCard));
  paginaPublica(res,relacionados,req,categoria);
 }));
 router.get('/campanhas/ativas',wrap(async(req,res)=>{const r=await q("SELECT id,nome,tipo,titulo,mensagem,imagem_url,destino,botao_texto,intervalo_horas FROM public.vitrine_campanhas WHERE ativo=true AND (inicio_em IS NULL OR inicio_em<=now()) AND (fim_em IS NULL OR fim_em>now()) ORDER BY prioridade DESC,criado_em DESC LIMIT 10");res.set('Cache-Control','no-store').json(r.rows)}));
 router.get('/conta/resumo',auth,wrap(async(req,res)=>{const id=await cliente(req);const result=await q('SELECT usuario,nome,email,telefone,criado_em FROM public.contas WHERE usuario=$1',[req.user.usuario]);const fav=await q('SELECT count(*)::int AS total FROM public.vitrine_favoritos WHERE cliente_id=$1',[id]);res.set('Cache-Control','no-store').json({perfil:result.rows[0],favoritos:fav.rows[0].total,pedidos:{disponivel:false,mensagem:'Integração do histórico de pedidos reservada ao gatilho CHECKOUT.'}})}));
 router.get('/favoritos',auth,wrap(async(req,res)=>{const id=await cliente(req);const r=await q('SELECT produto_id FROM public.vitrine_favoritos WHERE cliente_id=$1 ORDER BY criado_em DESC',[id]);const set=new Set(r.rows.map(x=>x.produto_id));res.json((await publico()).filter(p=>set.has(String(p.id))&&valido(p)))}));
 router.post('/favoritos',auth,wrap(async(req,res)=>{const id=await cliente(req),prodId=txt(req.body?.produtoId,250),p=(await publico()).find(x=>String(x.id)===prodId&&valido(x));if(!p)return res.status(404).json({erro:'Produto indisponível.'});await q('INSERT INTO public.vitrine_favoritos(cliente_id,produto_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,prodId]);res.status(201).json({ok:true})}));
 router.delete('/favoritos/:id',auth,wrap(async(req,res)=>{const id=await cliente(req);await q('DELETE FROM public.vitrine_favoritos WHERE cliente_id=$1 AND produto_id=$2',[id,txt(req.params.id,250)]);res.json({ok:true})}));
 // Carrinho de compras futuras independente do perfil: cliente, admin ou afiliado.
 // Nunca altera a tabela de afiliados nem as regras de comissão.
 function idComprador(req){const perfil=txt(req.user?.perfil,30),usuario=txt(req.user?.usuario,80);if(!['cliente','admin','afiliado'].includes(perfil)||!usuario){const e=Error('Entre com sua conta da Uti Like para guardar produtos.');e.status=403;throw e}return {perfil,usuario}}
 async function idCarrinhoComprador(req){
  const comprador=idComprador(req),usuario=comprador.usuario,perfil=comprador.perfil==='admin'?'admin':'cliente',db=await pool.connect();
  try{await db.query('BEGIN');
   const r=await db.query(`INSERT INTO checkout_uk.carrinhos_guardados(perfil,usuario)
    VALUES($1,$2) ON CONFLICT(perfil,usuario) DO UPDATE SET atualizado_em=checkout_uk.carrinhos_guardados.atualizado_em
    RETURNING id,migrado_legado`,[perfil,usuario]);
   const id=r.rows[0].id;
   // Mesma pessoa conserva Carrinho UK ao trocar papel cliente/afiliado.
   if(perfil==='cliente'){
    const antigo=await db.query('SELECT id FROM checkout_uk.carrinhos_guardados WHERE perfil=$1 AND usuario=$2',['afiliado',usuario]);
    if(antigo.rowCount && antigo.rows[0].id!==id){
     await db.query(`INSERT INTO checkout_uk.carrinho_itens_guardados(carrinho_id,produto_id,variacao_id,quantidade)
      SELECT $1,produto_id,variacao_id,quantidade FROM checkout_uk.carrinho_itens_guardados WHERE carrinho_id=$2
      ON CONFLICT(carrinho_id,produto_id,variacao_id) DO UPDATE SET quantidade=GREATEST(checkout_uk.carrinho_itens_guardados.quantidade,EXCLUDED.quantidade)`,[id,antigo.rows[0].id]);
    }
   }
   if(!r.rows[0].migrado_legado){
    // Migra uma única vez os itens de clientes salvos na tabela anterior, sem duplicar.
    if(perfil==='cliente'){
     const antigo=await db.query(`SELECT to_regclass('public.vitrine_carrinho_itens') AS tabela`);
     if(antigo.rows[0].tabela){
      await db.query(`INSERT INTO checkout_uk.carrinho_itens_guardados(carrinho_id,produto_id,variacao_id,quantidade)
       SELECT $1,i.produto_id,i.variacao_id,i.quantidade
       FROM public.vitrine_carrinho_itens i
       JOIN public.vitrine_carrinhos c ON c.id=i.carrinho_id
       JOIN public.vitrine_clientes vc ON vc.id=c.cliente_id
       WHERE vc.usuario=$2
       ON CONFLICT(carrinho_id,produto_id,variacao_id) DO NOTHING`,[id,usuario]);
     }
    }
    await db.query('UPDATE checkout_uk.carrinhos_guardados SET migrado_legado=true WHERE id=$1',[id]);
   }
   await db.query('COMMIT');return id;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }
 async function listaCarrinho(req){const cart=await idCarrinhoComprador(req);
  const rows=await q('SELECT id,produto_id,variacao_id,quantidade FROM checkout_uk.carrinho_itens_guardados WHERE carrinho_id=$1 ORDER BY criado_em,id',[cart]);
  const produtos=new Map((await publico()).map(p=>[String(p.id),p]));
  return rows.rows.map(x=>{const p=produtos.get(x.produto_id);const disp=!!p&&valido(p)&&!(p.estoque!=null&&Number(p.estoque)<=0);
   return {id:x.id,produtoId:x.produto_id,variacaoId:x.variacao_id,quantidade:x.quantidade,disponivel:disp,
    produto:p?{nome:nome(p),imagem:p.imagem||p.image||'',preco:disp?preco(p):null,categoria:p.categoria||p.category||''}:null};});
 }
 router.get('/carrinho',auth,wrap(async(req,res)=>{res.set('Cache-Control','no-store').json({itens:await listaCarrinho(req),checkoutHabilitado:false})}));
 router.post('/carrinho/itens',auth,wrap(async(req,res)=>{
  const cart=await idCarrinhoComprador(req),pid=txt(req.body?.produtoId,250),v=txt(req.body?.variacaoId,160),n=Number(req.body?.quantidade??1);
  if(!pid||!Number.isInteger(n)||n<1||n>99)return res.status(400).json({erro:'Produto ou quantidade inválidos.'});
  const p=(await publico()).find(x=>String(x.id)===pid&&valido(x));if(!p)return res.status(404).json({erro:'Produto não encontrado na vitrine.'});
  const vars=Array.isArray(p.variantes)?p.variantes:[];
  if(vars.length&&!v)return res.status(400).json({erro:'Selecione a variação do produto antes de guardá-lo.'});
  if(v&&vars.length&&!vars.some(x=>String(x.id??x.vid??'')===v))return res.status(400).json({erro:'Variação inválida.'});
  await q(`INSERT INTO checkout_uk.carrinho_itens_guardados(carrinho_id,produto_id,variacao_id,quantidade)
   VALUES($1,$2,$3,$4) ON CONFLICT(carrinho_id,produto_id,variacao_id)
   DO UPDATE SET quantidade=LEAST(99,checkout_uk.carrinho_itens_guardados.quantidade+EXCLUDED.quantidade),atualizado_em=now()`,[cart,pid,v,n]);
  res.status(201).json({ok:true,itens:await listaCarrinho(req)});
 }));
 router.patch('/carrinho/itens/:id',auth,wrap(async(req,res)=>{const cart=await idCarrinhoComprador(req),n=Number(req.body?.quantidade);if(!uuid(req.params.id)||!Number.isInteger(n)||n<1||n>99)return res.status(400).json({erro:'Item ou quantidade inválidos.'});
  const r=await q('UPDATE checkout_uk.carrinho_itens_guardados SET quantidade=$3,atualizado_em=now() WHERE id=$1 AND carrinho_id=$2 RETURNING id',[req.params.id,cart,n]);if(!r.rowCount)return res.status(404).json({erro:'Item não encontrado.'});res.json({ok:true,itens:await listaCarrinho(req)});
 }));
 router.delete('/carrinho/itens/:id',auth,wrap(async(req,res)=>{const cart=await idCarrinhoComprador(req);if(!uuid(req.params.id))return res.status(400).json({erro:'Item inválido.'});await q('DELETE FROM checkout_uk.carrinho_itens_guardados WHERE id=$1 AND carrinho_id=$2',[req.params.id,cart]);res.json({ok:true,itens:await listaCarrinho(req)})}));
 router.get('/notificacoes',auth,wrap(async(req,res)=>{const id=await cliente(req);const r=await q('SELECT id,tipo,titulo,corpo,destino,criado_em,lida_em FROM public.vitrine_notificacoes WHERE cliente_id=$1 ORDER BY criado_em DESC LIMIT 100',[id]);res.set('Cache-Control','no-store').json({itens:r.rows,naoLidas:r.rows.filter(x=>!x.lida_em).length})}));
 router.patch('/notificacoes/:id/ler',auth,wrap(async(req,res)=>{const id=await cliente(req);if(!uuid(req.params.id))return res.status(400).json({erro:'ID inválido.'});const r=await q('UPDATE public.vitrine_notificacoes SET lida_em=COALESCE(lida_em,now()) WHERE id=$1 AND cliente_id=$2 RETURNING id',[req.params.id,id]);if(!r.rowCount)return res.status(404).json({erro:'Mensagem não encontrada.'});res.json({ok:true})}));
 // ADMIN: controles reais no Neon; nenhuma mensagem vai para e-mail ou Web Push nesta etapa.
 router.get('/admin/campanhas',auth,soAdmin,wrap(async(req,res)=>{const r=await q('SELECT * FROM public.vitrine_campanhas ORDER BY criado_em DESC LIMIT 100');res.json(r.rows)}));
 router.post('/admin/campanhas',auth,soAdmin,wrap(async(req,res)=>{const b=req.body||{},nome=txt(b.nome,100),tipo=txt(b.tipo,20),titulo=txt(b.titulo,150),mensagem=txt(b.mensagem,1000),botao=txt(b.botaoTexto||'Ver produtos',60),imagem=imagemSegura(b.imagemUrl),destino=destinoSeguro(b.destino),intervalo=lim(b.intervaloHoras,1,720,24),prioridade=lim(b.prioridade,-100,100,0);if(!nome||!titulo||!['popup','banner','aviso'].includes(tipo))return res.status(400).json({erro:'Nome, título ou tipo inválidos.'});const inicio=b.inicioEm?new Date(b.inicioEm):null,fim=b.fimEm?new Date(b.fimEm):null;if((inicio&&!Number.isFinite(+inicio))||(fim&&!Number.isFinite(+fim))||(inicio&&fim&&fim<=inicio))return res.status(400).json({erro:'Datas inválidas.'});const r=await q('INSERT INTO public.vitrine_campanhas(nome,tipo,titulo,mensagem,imagem_url,destino,botao_texto,ativo,inicio_em,fim_em,intervalo_horas,prioridade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',[nome,tipo,titulo,mensagem,imagem,destino,botao,b.ativo===true,inicio,fim,intervalo,prioridade]);res.status(201).json({ok:true,id:r.rows[0].id})}));
 router.patch('/admin/campanhas/:id/ativo',auth,soAdmin,wrap(async(req,res)=>{if(!uuid(req.params.id)||typeof req.body?.ativo!=='boolean')return res.status(400).json({erro:'Dados inválidos.'});const r=await q('UPDATE public.vitrine_campanhas SET ativo=$2,atualizado_em=now() WHERE id=$1 RETURNING id',[req.params.id,req.body.ativo]);if(!r.rowCount)return res.status(404).json({erro:'Campanha não encontrada.'});res.json({ok:true})}));
 router.delete('/admin/campanhas/:id',auth,soAdmin,wrap(async(req,res)=>{if(!uuid(req.params.id))return res.status(400).json({erro:'ID inválido.'});await q('DELETE FROM public.vitrine_campanhas WHERE id=$1',[req.params.id]);res.json({ok:true})}));
 router.post('/admin/mensagens',auth,soAdmin,wrap(async(req,res)=>{const usuario=txt(req.body?.usuario,30).toLowerCase(),tipo=txt(req.body?.tipo||'mensagem',20),titulo=txt(req.body?.titulo,150),corpo=txt(req.body?.corpo,1500);if(!usuario||!titulo||!corpo||!['mensagem','promocao','aviso'].includes(tipo))return res.status(400).json({erro:'Destinatário, título ou mensagem inválidos.'});const r=await q('SELECT id FROM public.vitrine_clientes WHERE usuario=$1',[usuario]);let cid=r.rows[0]?.id;if(!cid){const c=await q('SELECT 1 FROM public.contas WHERE usuario=$1',[usuario]);if(!c.rowCount)return res.status(404).json({erro:'Cliente não encontrado.'});const x=await q('INSERT INTO public.vitrine_clientes(usuario) VALUES($1) ON CONFLICT(usuario) DO UPDATE SET usuario=EXCLUDED.usuario RETURNING id',[usuario]);cid=x.rows[0].id;}await q('INSERT INTO public.vitrine_notificacoes(cliente_id,tipo,titulo,corpo) VALUES($1,$2,$3,$4)',[cid,tipo,titulo,corpo]);res.status(201).json({ok:true,mensagem:'Mensagem registrada na central do cliente; nenhum e-mail ou push foi disparado.'})}));
 return router;
};
