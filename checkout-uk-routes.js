'use strict';
/* Checkout UK: cotacao do catalogo/Neon + recomendacoes progressivas + rascunho TESTE.
   Não executa cobrança, não chama Mercado Pago, não altera afiliados nem Cronjob. */
const {Router}=require('express');
const {createHash}=require('node:crypto');
module.exports=function checkoutUk({pool,auth,lerCatalogoPublico}){
 const router=Router(),wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);
 const txt=(x,n=250)=>String(x??'').trim().slice(0,n);
 const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
 const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x||''));
 const price=p=>Number(p?.precoPor??p?.preco??p?.price);
 const active=p=>p&&p.id&&p.ativo!==false&&p.active!==false&&Number.isFinite(price(p))&&price(p)>0;
 const stock=p=>!(p.estoque!==null&&p.estoque!==undefined&&Number(p.estoque)<=0);
 const publicList=async()=>{const a=await lerCatalogoPublico();return Array.isArray(a)?a.filter(p=>p&&p.ativo!==false&&p.active!==false):[]};
 const key=p=>String(p.id);
 const normalize=x=>txt(x,160).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 function group(cat){const s=normalize(cat);const sets=[['eletronicos',/eletron|electron|audio|headphone|fone|cell phone|celular|telefone/],['tecnologia',/tecnolog|computer|informat|smart|digital|gadget|notebook/],['casa',/house|casa|decor|kitchen|cozinha|home|garden|utensil|jardim/],['moda',/moda|fashion|apparel|clothing|socks|meia|shoes|calcado|roupa|bag|bolsa|acessor/],['beleza',/beleza|beauty|cosmetic|skin|hair|maquiag|saude/],['esporte',/esport|sport|fitness|running|gym|academia|camping/],['ferramentas',/ferrament|tool|hardware|industrial/],['automotivo',/automot|vehicle|car|moto/],['brinquedos',/toy|brinqued|baby|kids|infantil/],['pets',/pet|animal|dog|cat|cachorro|gato/]];return sets.find(([,re])=>re.test(s))?.[0]||'exato:'+s}
 function inputList(b){
  const from=Array.isArray(b?.adicionais)?b.adicionais:Array.isArray(b?.itens)?b.itens:[];
  // Limite de segurança técnica por requisição, não limite da vitrine nem das recomendações.
  if(from.length>4000)throw Object.assign(Error('Envie até 4.000 linhas por compra; agrupe quantidades do mesmo produto.'),{status:413});
  const map=new Map();
  for(const x of [...from,...(b?.produtoId?[{produtoId:b.produtoId,variacaoId:b.variacaoId,quantidade:b.quantidade||1}]:[])]){
   const id=txt(x?.produtoId??x?.id,250),v=txt(x?.variacaoId??'',160),q=Number(x?.quantidade);
   if(!id||!Number.isSafeInteger(q)||q<1||q>99)throw Object.assign(Error('Produto, variação ou quantidade inválida na sacola.'),{status:400});
   const k=JSON.stringify([id,v]);if(map.has(k)){map.get(k).quantidade+=q;if(map.get(k).quantidade>99)throw Object.assign(Error('Quantidade máxima por variação: 99.'),{status:400})}
   else map.set(k,{produtoId:id,variacaoId:v,quantidade:q});
  }
  return [...map.values()];
 }
 function detail(p){return {id:String(p.id),nome:txt(p.nome||p.name||'Produto Uti Like',250),imagem:txt(p.imagem||p.image||'',500),categoria:txt(p.categoria||p.category||'Outros',120),precoPor:price(p),estoque:p.estoque??null,temVariantes:Array.isArray(p.variantes)&&p.variantes.length>0}}
 async function getCartRows(req,ids){if(!req.user)throw Object.assign(Error('Entre para comprar os itens guardados no carrinho.'),{status:401});
  if(ids.some(x=>!uuid(x)))throw Object.assign(Error('Seleção do carrinho inválida.'),{status:400});
  const tables=await pool.query("SELECT to_regclass('public.uk_identidades') AS identidades,to_regclass('public.uk_carrinho_itens') AS itens");
  const canonical=tables.rows[0]?.identidades&&tables.rows[0]?.itens;
  const r=canonical
   ?await pool.query(`SELECT i.id,i.produto_id,i.variacao_id,i.quantidade FROM public.uk_carrinho_itens i JOIN public.uk_identidades u ON u.id=i.identidade_id
    WHERE u.usuario=$1 AND i.id=ANY($2::uuid[])`,[req.user.usuario,ids])
   :await pool.query(`SELECT i.id,i.produto_id,i.variacao_id,i.quantidade FROM checkout_uk.carrinho_itens_guardados i JOIN checkout_uk.carrinhos_guardados c ON c.id=i.carrinho_id
    WHERE c.usuario=$1 AND c.perfil=$2 AND i.id=ANY($3::uuid[])`,[req.user.usuario,req.user.perfil,ids]);
  if(r.rows.length!==new Set(ids).size)throw Object.assign(Error('Seu carrinho mudou. Atualize a seleção.'),{status:409});
  return r.rows.map(x=>({produtoId:x.produto_id,variacaoId:x.variacao_id,quantidade:x.quantidade}));
 }
 async function calcular(req,b){const raw=inputList(b);const ids=Array.isArray(b?.carrinhoIds)?[...new Set(b.carrinhoIds.map(String))]:[];
  if(ids.length){if(ids.length>4000)throw Object.assign(Error('Seleção muito grande.'),{status:413});raw.push(...await getCartRows(req,ids))}
  if(!raw.length)throw Object.assign(Error('Sacola vazia. Adicione produtos antes de continuar.'),{status:400});
  const map=new Map((await publicList()).map(p=>[key(p),p]));const combined=new Map();
  for(const row of raw){const key=JSON.stringify([row.produtoId,row.variacaoId]);if(combined.has(key)){combined.get(key).quantidade+=row.quantidade;if(combined.get(key).quantidade>99)throw Object.assign(Error('Quantidade total por variação acima de 99.'),{status:400})}else combined.set(key,{...row})}
  const itens=[];for(const x of combined.values()){
   const p=map.get(x.produtoId),v=Array.isArray(p?.variantes)?p.variantes:[];
   const sel=v.find(y=>String(y.id??y.vid??'')===x.variacaoId);
   const variantOk=(!v.length&&!x.variacaoId)||(v.length&&!!sel)||(!v.length&&!!p?.cjVariantId&&String(p.cjVariantId)===x.variacaoId);
   const reason=!p?'Produto não encontrado no catálogo público.':!active(p)?'Produto sem preço válido.':!stock(p)?'Produto esgotado no fornecedor ou na loja.':v.length&&!x.variacaoId?'Selecione uma variação na página do produto.':!variantOk?'Variação indisponível.':'';
   let unit=reason?null:price(p);if(!reason&&sel){const alt=Number(sel.precoPor??sel.preco??sel.price);if(Number.isFinite(alt)&&alt>0)unit=alt}
   const available=!reason&&Number.isFinite(unit)&&unit>0;
   itens.push({produtoId:x.produtoId,variacaoId:x.variacaoId,quantidade:x.quantidade,
    nome:p?txt(p.nome||p.name||'Produto Uti Like',250):'Produto não disponível',imagem:p?txt(p.imagem||p.image||'',500):'',categoria:p?txt(p.categoria||p.category||'Outros',120):'',
    disponivel:available,indisponivelMotivo:reason||'',precoUnitario:available?money(unit):null,totalItem:available?money(unit*x.quantidade):null});
  }
  const subtotal=money(itens.reduce((sum,x)=>sum+Number(x.totalItem||0),0));
  return {itens,subtotal,desconto:0,frete:null,total:null,moeda:'BRL',pendencias:['frete','pagamento'],indisponiveis:itens.filter(x=>!x.disponivel).length};
 }
 // Mini-vitrine de sugestões com mistura variável das categorias realmente presentes na sacola.
 router.post('/sugestoes',wrap(async(req,res)=>{
  const raw=inputList(req.body);const catalogo=await publicList(),list=catalogo.filter(p=>active(p)&&stock(p));
  const index=new Map(catalogo.map(p=>[key(p),p]));const bought=new Set(raw.map(x=>x.produtoId));
  const groups=[...new Set(raw.filter(x=>index.has(x.produtoId)).map(x=>group(index.get(x.produtoId)?.categoria||index.get(x.produtoId)?.category)).filter(Boolean))];
  const selected=groups.length?list.filter(p=>groups.includes(group(p.categoria||p.category))):list;
  const buckets=new Map();for(const p of selected){if(bought.has(key(p)))continue;const g=group(p.categoria||p.category);if(!buckets.has(g))buckets.set(g,[]);buckets.get(g).push(p)}
  const seed=/^[a-f0-9]{16,64}$/i.test(req.body?.ordem||'')?req.body.ordem:'fixa';
  const hashed=v=>createHash('sha256').update(seed+'|'+v).digest('hex');
  for(const [g,arr] of buckets)arr.sort((a,b)=>hashed(key(a)).localeCompare(hashed(key(b))));
  const categories=[...buckets.keys()].sort((a,b)=>hashed('categoria:'+a).localeCompare(hashed('categoria:'+b)));
  // Distribuição round-robin: alterna categorias até esgotar todas.
  const mixed=[];let left=true;let pointer=0;while(left){left=false;for(const g of categories){const arr=buckets.get(g);if(pointer<arr.length){mixed.push(arr[pointer]);left=true}}pointer++}
  const pagina=Number(req.body?.pagina)||1,limite=Math.max(1,Math.min(36,Number(req.body?.limite)||18));
  if(!Number.isInteger(pagina)||pagina<1)return res.status(400).json({erro:'Página inválida.'});
  const inicio=(pagina-1)*limite,itens=mixed.slice(inicio,inicio+limite).map(detail);
  res.set('Cache-Control','no-store').json({itens,pagina,limite,total:mixed.length,temMais:inicio+itens.length<mixed.length,categorias:groups});
 }));
 // Cotação pública usa apenas IDs, quantidades e variações; preço SEMPRE do catálogo publicado.
 router.post('/cotacao',wrap(async(req,res)=>{const data=await calcular(req,req.body);res.set('Cache-Control','no-store').json(data)}));
 // Autenticação obrigatória apenas para perfil e registro de rascunho.
 router.use(auth,(req,res,next)=>req.user&&['cliente','admin','afiliado'].includes(req.user.perfil)?next():res.status(401).json({erro:'Entre com uma conta da Uti Like para registrar o pedido.'}));
 router.get('/perfil',wrap(async(req,res)=>{
  const usuario=req.user.usuario,perfil=req.user.perfil;
  const own=(await pool.query('SELECT nome,email,telefone FROM checkout_uk.compradores_dados WHERE perfil=$1 AND usuario=$2',[perfil,usuario])).rows[0];
  const base=perfil==='cliente'?(await pool.query('SELECT nome,email,telefone FROM public.contas WHERE usuario=$1',[usuario])).rows[0]:null;
  const p={usuario,perfil,nome:own?.nome||base?.nome||(perfil==='admin'?'Administrador':usuario),email:own?.email||base?.email||'',telefone:own?.telefone||base?.telefone||''};
  const existe=await pool.query("SELECT to_regclass('public.vitrine_endereco_cliente_uk') AS tabela,to_regclass('public.uk_identidades') AS identidades,to_regclass('public.uk_enderecos') AS enderecos");
  let end=null;
  if(perfil==='cliente'&&existe.rows[0]?.tabela)end=(await pool.query('SELECT destinatario,cep,logradouro,numero,complemento,bairro,cidade,uf FROM public.vitrine_endereco_cliente_uk WHERE usuario=$1',[usuario])).rows[0]||null;
  else if(existe.rows[0]?.identidades&&existe.rows[0]?.enderecos)end=(await pool.query('SELECT e.destinatario,e.cep,e.logradouro,e.numero,e.complemento,e.bairro,e.cidade,e.uf FROM public.uk_enderecos e JOIN public.uk_identidades i ON i.id=e.identidade_id WHERE i.usuario=$1',[usuario])).rows[0]||null;
  res.set('Cache-Control','no-store').json({perfil:p,endereco:end,modoTeste:process.env.CHECKOUT_UK_TEST_MODE==='true'});
 }));
 router.post('/pedido-teste',wrap(async(req,res)=>{
  if(process.env.CHECKOUT_UK_TEST_MODE!=='true')return res.status(403).json({erro:'Rascunhos de teste não habilitados no servidor. Nenhuma cobrança foi efetuada.'});
  const b=req.body||{},uuidId=txt(b.chaveIdempotencia,60),e=b.endereco||{},p=b.contato||{};
  const endereco={destinatario:txt(e.destinatario,100),cep:txt(e.cep,12).replace(/\D/g,''),logradouro:txt(e.logradouro,150),numero:txt(e.numero,20),complemento:txt(e.complemento,120),bairro:txt(e.bairro,100),cidade:txt(e.cidade,100),uf:txt(e.uf,2).toUpperCase()};
  const contato={nome:txt(p.nome||endereco.destinatario,120),email:txt(p.email,190),telefone:txt(p.telefone,40)};
  if(!uuid(uuidId)||!/^\d{8}$/.test(endereco.cep)||!/^[A-Z]{2}$/.test(endereco.uf)||[endereco.destinatario,endereco.logradouro,endereco.numero,endereco.bairro,endereco.cidade].some(x=>!x||/[<>]/.test(x)))return res.status(400).json({erro:'Confira o endereço de entrega.'});
  if(!contato.nome||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contato.email)||contato.telefone.replace(/\D/g,'').length<10)return res.status(400).json({erro:'Informe nome, e-mail válido e telefone para o pedido.'});
  const metodo=txt(b.metodo,20);if(!['pix','credito','debito'].includes(metodo))return res.status(400).json({erro:'Método de pagamento inválido.'});
  const cotacao=await calcular(req,b);
  if(cotacao.indisponiveis||cotacao.itens.some(x=>!x.disponivel))return res.status(409).json({erro:'Há itens esgotados ou variações inválidas na sacola. Remova-os antes de registrar o rascunho.'});
  const db=await pool.connect();try{
   await db.query('BEGIN');
   const old=await db.query('SELECT id FROM checkout_uk.pedidos WHERE chave_idempotencia=$1 AND usuario=$2 AND perfil=$3',[uuidId,req.user.usuario,req.user.perfil]);
   if(old.rowCount){await db.query('COMMIT');return res.json({id:old.rows[0].id,status:'rascunho',teste:true,cobranca:false})}
   await db.query(`INSERT INTO checkout_uk.compradores_dados(perfil,usuario,nome,email,telefone) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(perfil,usuario) DO UPDATE SET nome=EXCLUDED.nome,email=EXCLUDED.email,telefone=EXCLUDED.telefone,atualizado_em=now()`,[req.user.perfil,req.user.usuario,contato.nome,contato.email,contato.telefone]);
   const result=await db.query(`INSERT INTO checkout_uk.pedidos(chave_idempotencia,usuario,perfil,nome_comprador,email_comprador,telefone_comprador,endereco_entrega,subtotal,status)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'rascunho') RETURNING id`,[uuidId,req.user.usuario,req.user.perfil,contato.nome,contato.email,contato.telefone,JSON.stringify(endereco),cotacao.subtotal]);
   for(const i of cotacao.itens)await db.query(`INSERT INTO checkout_uk.pedido_itens(pedido_id,produto_id,variacao_id,titulo_snapshot,imagem_snapshot,quantidade,preco_unitario,total_item)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[result.rows[0].id,i.produtoId,i.variacaoId,i.nome,i.imagem,i.quantidade,i.precoUnitario,i.totalItem]);
   // Apenas atribuição informativa do pedido. NÃO paga comissões nesta fase.
   const pessoa=req.user.perfil==='admin'?'admin:'+req.user.usuario:'pessoa:'+req.user.usuario;
   await db.query(`INSERT INTO checkout_uk.uk_pedido_atribuicoes(pedido_id,afiliado_usuario)
    SELECT $1,afiliado_usuario FROM checkout_uk.uk_atribuicoes
    WHERE identidade=$2 AND expira_em>now() ON CONFLICT DO NOTHING`,[result.rows[0].id,pessoa]);
   await db.query('COMMIT');return res.status(201).json({id:result.rows[0].id,status:'rascunho',teste:true,cobranca:false});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }));
 router.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.status)return res.status(err.status).json({erro:err.message});console.error('Checkout UK:',err);return res.status(500).json({erro:'Falha interna no checkout. Confira as migrations e o servidor.'})});
 return router;
};
