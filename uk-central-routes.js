'use strict';
/* Uti Like — identidade e sacola central no Neon. Nunca usa localStorage para sacola. */
const express=require('express');
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const { MAX_AFFILIATE_LEVELS, resolveAffiliateChain } = require('./affiliate-chain');
module.exports=function centralUK({pool,auth,soAdmin,jwtSecret,limitarTentativas,adminUsuario='admin'}){
 const r=express.Router(),wrap=f=>(req,res,next)=>Promise.resolve().then(()=>f(req,res,next)).catch(next);
 const text=(x,n=250)=>String(x??'').trim().slice(0,n);
 const nick=x=>text(x,80).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'-');
 const ck=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>{const i=s.indexOf('=');return i<0?['','']:[s.slice(0,i).trim(),s.slice(i+1).trim()]}));
 const secure=req=>req.secure || req.get('x-forwarded-proto')==='https';
 function cookie(req,res,name,value,maxAge){res.append('Set-Cookie',`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; ${secure(req)?'Secure; ':''}Priority=High`)}
 function decode(req,name){try{return jwt.verify(decodeURIComponent(ck(req)[name]||''),jwtSecret)}catch{return null}}
 const identity=req=>req.user ? (req.user.perfil==='admin'?'admin:'+nick(req.user.usuario):'pessoa:'+nick(req.user.usuario)) : null;
 const publicUser=async req=>{
  if(!req.user)return null;
  const {usuario,perfil}=req.user;
  if(perfil==='admin')return {usuario,nome:'Administrador (Central)',perfil};
  const table=perfil==='afiliado'?'afiliados':'contas';
  const x=await pool.query(`SELECT usuario,nome,email,telefone FROM ${table} WHERE usuario=$1`,[usuario]);
  if(!x.rowCount)return null;return {...x.rows[0],perfil};
 };
 function anonymous(req,res){const data=decode(req,'uk_visitante');if(data?.tipo==='visitante' && /^[a-f0-9-]{36}$/i.test(data.id))return 'visitante:'+data.id;
  const id=crypto.randomUUID();cookie(req,res,'uk_visitante',jwt.sign({tipo:'visitante',id},jwtSecret,{expiresIn:'90d'}),90*86400);return 'visitante:'+id;
 }
 function owner(req,res){return identity(req)||anonymous(req,res)}
 const items=async id=>(await pool.query('SELECT produto_id AS "produtoId",variacao_id AS "variacaoId",quantidade FROM checkout_uk.uk_sacola_itens WHERE identidade=$1 ORDER BY atualizado_em,produto_id',[id])).rows;
 function parsed(raw){const a=Array.isArray(raw)?raw:[];if(a.length>4000)throw Object.assign(Error('Excesso de linhas na sacola.'),{status:413});const out=[];for(const x of a){const produtoId=text(x?.produtoId??x?.id,250),variacaoId=text(x?.variacaoId??'',160),quantidade=Number(x?.quantidade??x?.qtd);if(!produtoId||!Number.isSafeInteger(quantidade)||quantidade<1||quantidade>99)throw Object.assign(Error('Item ou quantidade inválida.'),{status:400});out.push({produtoId,variacaoId,quantidade})}return out}
 async function merge(from,to,marker){if(from===to)return;const db=await pool.connect();try{await db.query('BEGIN');const got=await db.query('INSERT INTO checkout_uk.uk_sacola_migracoes(identidade,origem) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING identidade',[to,marker]);if(got.rowCount){await db.query(`INSERT INTO checkout_uk.uk_sacola_itens(identidade,produto_id,variacao_id,quantidade)
 SELECT $1,produto_id,variacao_id,quantidade FROM checkout_uk.uk_sacola_itens WHERE identidade=$2
 ON CONFLICT(identidade,produto_id,variacao_id) DO UPDATE SET quantidade=LEAST(99,checkout_uk.uk_sacola_itens.quantidade+EXCLUDED.quantidade),atualizado_em=now()`,[to,from]);await db.query('DELETE FROM checkout_uk.uk_sacola_itens WHERE identidade=$1',[from])}await db.query('COMMIT')}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}}
 async function reconcile(req,res){const id=owner(req,res);if(req.user){
  const ref=decode(req,'uk_indicacao');if(ref?.tipo==='indicacao'&&ref.exp>Date.now()&&ref.usuario!==req.user.usuario){
   await pool.query(`INSERT INTO checkout_uk.uk_atribuicoes(identidade,afiliado_usuario,origem,expira_em)
    VALUES($1,$2,$3,to_timestamp($4/1000.0)) ON CONFLICT(identidade) DO UPDATE SET
    afiliado_usuario=EXCLUDED.afiliado_usuario,origem=EXCLUDED.origem,registrado_em=now(),expira_em=EXCLUDED.expira_em
    WHERE checkout_uk.uk_atribuicoes.expira_em<now()`,[id,ref.usuario,ref.origem,ref.exp]);
  }
const visitor=decode(req,'uk_visitante');if(visitor?.tipo==='visitante'&&visitor.id)await merge('visitante:'+visitor.id,id,'visita:'+visitor.id);
  // Conserva a sacola 009 anterior para ambos perfis, se existir, sem copiar repetidamente.
  const exists=await pool.query("SELECT to_regclass('checkout_uk.sacola_itens') AS tabela");if(exists.rows[0]?.tabela){const db=await pool.connect();try{await db.query('BEGIN');const marker='sacola_009:'+req.user.usuario;const got=await db.query('INSERT INTO checkout_uk.uk_sacola_migracoes(identidade,origem) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING identidade',[id,marker]);if(got.rowCount)await db.query(`INSERT INTO checkout_uk.uk_sacola_itens(identidade,produto_id,variacao_id,quantidade)
 SELECT $1,produto_id,variacao_id,quantidade FROM checkout_uk.sacola_itens WHERE usuario=$2
 ON CONFLICT(identidade,produto_id,variacao_id) DO NOTHING`,[id,req.user.usuario]);await db.query('COMMIT')}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}}}
 return id}
 // As rotas públicas só utilizam cookie assinado e um identificador aleatório de visitante.
 r.get('/sacola',wrap(async(req,res)=>{const id=await reconcile(req,res);res.set('Cache-Control','no-store').json({itens:await items(id),autenticado:!!req.user})}));
 r.post('/sacola/itens',wrap(async(req,res)=>{const id=await reconcile(req,res),[x]=parsed([req.body]);await pool.query(`INSERT INTO checkout_uk.uk_sacola_itens(identidade,produto_id,variacao_id,quantidade) VALUES($1,$2,$3,$4)
 ON CONFLICT(identidade,produto_id,variacao_id) DO UPDATE SET quantidade=LEAST(99,checkout_uk.uk_sacola_itens.quantidade+EXCLUDED.quantidade),atualizado_em=now()`,[id,x.produtoId,x.variacaoId,x.quantidade]);res.status(201).json({itens:await items(id)})}));
 r.patch('/sacola/itens',wrap(async(req,res)=>{const id=await reconcile(req,res),[x]=parsed([req.body]);const changed=await pool.query(`UPDATE checkout_uk.uk_sacola_itens SET quantidade=$4,atualizado_em=now() WHERE identidade=$1 AND produto_id=$2 AND variacao_id=$3`,[id,x.produtoId,x.variacaoId,x.quantidade]);if(!changed.rowCount)return res.status(404).json({erro:'Item não encontrado na sacola.'});res.json({itens:await items(id)})}));
 r.delete('/sacola/itens',wrap(async(req,res)=>{const id=await reconcile(req,res),produtoId=text(req.body?.produtoId,250),variacaoId=text(req.body?.variacaoId,160);if(!produtoId)return res.status(400).json({erro:'Informe o produto.'});await pool.query('DELETE FROM checkout_uk.uk_sacola_itens WHERE identidade=$1 AND produto_id=$2 AND variacao_id=$3',[id,produtoId,variacaoId]);res.json({itens:await items(id)})}));
 // Migra UMA VEZ os dados legados de cada navegador, sem armazenar novos dados nele.
 r.post('/sacola/importar',wrap(async(req,res)=>{const id=await reconcile(req,res);const origem=text(req.body?.origem,120);if(!/^legado:[a-z0-9_.:-]{10,110}$/i.test(origem))return res.status(400).json({erro:'Origem inválida.'});const arr=parsed(req.body?.itens),db=await pool.connect();try{await db.query('BEGIN');const mark=await db.query('INSERT INTO checkout_uk.uk_sacola_migracoes(identidade,origem) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING identidade',[id,origem]);if(mark.rowCount){for(const x of arr)await db.query(`INSERT INTO checkout_uk.uk_sacola_itens(identidade,produto_id,variacao_id,quantidade) VALUES($1,$2,$3,$4) ON CONFLICT(identidade,produto_id,variacao_id) DO UPDATE SET quantidade=GREATEST(checkout_uk.uk_sacola_itens.quantidade,EXCLUDED.quantidade)`,[id,x.produtoId,x.variacaoId,x.quantidade])}await db.query('COMMIT')}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}res.json({itens:await items(id)})}));
 r.get('/sessao',wrap(async(req,res)=>{res.set('Cache-Control','no-store').json({autenticado:!!req.user,user:await publicUser(req),identidade:identity(req)})}));
 r.post('/sair',wrap(async(req,res)=>{cookie(req,res,'uk_sessao','',0);cookie(req,res,'uk_visitante','',0);res.json({ok:true})}));
 // Referência comercial não é autenticação. Nunca concede privilégios.
 r.post('/referencia',wrap(async(req,res)=>{const indicador=nick(req.body?.afiliado||req.body?.indicador||'admin');const origem=nick(req.body?.origem||'loja');if(!/^[a-z0-9_.-]{3,30}$/.test(indicador))return res.status(400).json({erro:'Referência inválida.'});if(indicador!=='admin'){const found=await pool.query('SELECT usuario FROM afiliados WHERE usuario=$1',[indicador]);if(!found.rowCount)return res.status(404).json({erro:'Afiliado indicado não encontrado.'})}
  // Primeiro indicador válido durante 30 dias. Visitante não consegue falsificar cookie sem segredo.
  const prev=decode(req,'uk_indicacao');const saved=prev?.tipo==='indicacao'&&prev.exp>Date.now()?prev:null;
  const ref=saved||{tipo:'indicacao',usuario:indicador,origem,exp:Date.now()+30*86400*1000};
  cookie(req,res,'uk_indicacao',jwt.sign(ref,jwtSecret,{expiresIn:'30d'}),30*86400);
  if(req.user && ref.usuario!==req.user.usuario){const id=identity(req);await pool.query(`INSERT INTO checkout_uk.uk_atribuicoes(identidade,afiliado_usuario,origem,expira_em) VALUES($1,$2,$3,to_timestamp($4/1000.0)) ON CONFLICT(identidade) DO UPDATE SET afiliado_usuario=EXCLUDED.afiliado_usuario,origem=EXCLUDED.origem,registrado_em=now(),expira_em=EXCLUDED.expira_em WHERE checkout_uk.uk_atribuicoes.expira_em<now()`,[id,ref.usuario,ref.origem,ref.exp])}
  res.json({ok:true,afiliado:ref.usuario,origem:ref.origem})}));
 r.get('/referencia',wrap(async(req,res)=>{const ref=decode(req,'uk_indicacao');const id=identity(req);const row=id?(await pool.query('SELECT afiliado_usuario,origem FROM checkout_uk.uk_atribuicoes WHERE identidade=$1 AND expira_em>now()',[id])).rows[0]:null;res.json({afiliado:row?.afiliado_usuario||ref?.usuario||'admin',origem:row?.origem||ref?.origem||'loja'})}));

 // Converte a conta de cliente existente em afiliado; NÃO duplica cadastro da pessoa.
 r.post('/afiliar',auth,wrap(async(req,res)=>{
  if(req.user.perfil==='admin')return res.status(403).json({erro:'A Central já possui gestão própria.'});
  const usuario=nick(req.user.usuario),pix=text(req.body?.pix,100);
  if(!pix||pix.length<3||/[<>\x00-\x1f]/.test(pix))return res.status(400).json({erro:'Informe uma chave Pix válida.'});
  const referral=decode(req,'uk_convite');
  const venda=decode(req,'uk_indicacao');const indicador=nick((referral?.tipo==='convite'&&referral.exp>Date.now()?referral.usuario:null)||(venda?.tipo==='indicacao'&&venda.exp>Date.now()?venda.usuario:null)||req.body?.indicador||'admin');
  const db=await pool.connect();try{await db.query('BEGIN');
   const account=(await db.query('SELECT usuario,nome,email,cpf,telefone,senha_hash FROM contas WHERE usuario=$1 FOR UPDATE',[usuario])).rows[0];
   if(!account)throw Object.assign(Error('Conta de cliente não encontrada.'),{status:404});
   let existing=(await db.query('SELECT id,patrocinador_id FROM afiliados WHERE usuario=$1',[usuario])).rows[0];
   let sponsor='admin';if(!existing&&indicador!=='admin'&&indicador!==usuario){const pai=(await db.query('SELECT id,usuario FROM afiliados WHERE usuario=$1',[indicador])).rows[0];if(!pai)throw Object.assign(Error('Patrocinador não existe.'),{status:400});const chain=await resolveAffiliateChain(pai.id,async ref=>(await db.query('SELECT id,usuario,patrocinador_id FROM afiliados WHERE usuario=$1 OR lower(id)=$1 LIMIT 1',[String(ref).toLowerCase()])).rows[0]||null);if(chain.length>=MAX_AFFILIATE_LEVELS)throw Object.assign(Error('A rede de afiliados permite no máximo 3 níveis.'),{status:400});sponsor=pai.id}
   if(!existing){const id='AF-'+usuario.toUpperCase();await db.query(`INSERT INTO afiliados(id,usuario,nome,email,cpf,pix,telefone,senha_hash,patrocinador_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,usuario,account.nome,account.email,account.cpf,pix,account.telefone,account.senha_hash,sponsor]);existing={id,patrocinador_id:sponsor}}
   else await db.query('UPDATE afiliados SET pix=$2 WHERE usuario=$1',[usuario,pix]);
   await db.query('COMMIT');
   // Mantém mesmo usuário; somente permissão muda. JWT antigo não transforma um cliente em admin.
   const token=jwt.sign({usuario,perfil:'afiliado',trocar:false},jwtSecret,{expiresIn:'7d'});
   cookie(req,res,'uk_sessao',token,7*86400);
   res.json({ok:true,user:{usuario,nome:account.nome,email:account.email,perfil:'afiliado'},id:existing.id,patrocinadorId:existing.patrocinador_id});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }));
 // Link de convites separado do link comercial de vendas (e seu prazo de atribuição).
 r.post('/convite',wrap(async(req,res)=>{
  const indicador=nick(req.body?.indicador||'admin');if(!/^[a-z0-9_.-]{3,30}$/.test(indicador))return res.status(400).json({erro:'Convite inválido.'});
  if(indicador!=='admin'){const a=await pool.query('SELECT 1 FROM afiliados WHERE usuario=$1',[indicador]);if(!a.rowCount)return res.status(404).json({erro:'Afiliado não encontrado.'})}
  const prev=decode(req,'uk_convite');const ref=prev?.tipo==='convite'&&prev.exp>Date.now()?prev:{tipo:'convite',usuario:indicador,exp:Date.now()+30*86400*1000};
  cookie(req,res,'uk_convite',jwt.sign(ref,jwtSecret,{expiresIn:'30d'}),30*86400);
  res.json({ok:true,patrocinador:ref.usuario});
 }));
 r.get('/recovery-status',auth,soAdmin,wrap(async(req,res)=>{const usuario=nick(req.query.usuario);if(!usuario)return res.status(400).json({erro:'Informe usuário.'});const a=(await pool.query('SELECT nome,email,telefone FROM contas WHERE usuario=$1',[usuario])).rows[0]||(await pool.query('SELECT nome,email,telefone FROM afiliados WHERE usuario=$1',[usuario])).rows[0];if(!a)return res.status(404).json({erro:'Conta não encontrada.'});const mask=x=>x?String(x).slice(0,2)+'***'+String(x).slice(-2):'não informado';res.json({usuario,nome:mask(a.nome),email:mask(a.email),telefone:mask(a.telefone)})}));
 r.post('/recuperacao/emitir',auth,soAdmin,limitarTentativas,wrap(async(req,res)=>{const usuario=nick(req.body?.usuario);if(!usuario||usuario===adminUsuario)return res.status(400).json({erro:'Conta inválida.'});const a=await pool.query('SELECT 1 FROM contas WHERE usuario=$1 UNION SELECT 1 FROM afiliados WHERE usuario=$1',[usuario]);if(!a.rowCount)return res.status(404).json({erro:'Conta não encontrada.'});if(req.body?.identidadeConfirmada!==true)return res.status(400).json({erro:'Confirme a identidade usando o contato cadastrado antes de emitir.'});const codigo=crypto.randomBytes(16).toString('base64url');const hash=crypto.createHmac('sha256',jwtSecret).update(usuario+':'+codigo).digest('hex');await pool.query(`INSERT INTO checkout_uk.uk_recuperacoes(usuario,token_hash,expira_em,utilizado_em,tentativas) VALUES($1,$2,now()+interval '1 hour',NULL,0) ON CONFLICT(usuario) DO UPDATE SET token_hash=EXCLUDED.token_hash,expira_em=EXCLUDED.expira_em,utilizado_em=NULL,tentativas=0,emitido_em=now()`,[usuario,hash]);res.set('Cache-Control','no-store').json({usuario,codigo,validadeMinutos:60,exibicaoUnica:true})}));
 r.post('/recuperacao/trocar',limitarTentativas,wrap(async(req,res)=>{const usuario=nick(req.body?.usuario),codigo=text(req.body?.codigo,120),senha=String(req.body?.novaSenha||'');if(senha.length<10||senha.length>128||!usuario||!codigo)return res.status(400).json({erro:'Dados inválidos. Use uma senha de 10 a 128 caracteres.'});const db=await pool.connect();try{await db.query('BEGIN');const row=(await db.query('SELECT * FROM checkout_uk.uk_recuperacoes WHERE usuario=$1 FOR UPDATE',[usuario])).rows[0];if(!row||row.utilizado_em||new Date(row.expira_em)<=new Date()||row.tentativas>=5){await db.query('ROLLBACK');return res.status(400).json({erro:'Código vencido ou inválido.'})}const hash=crypto.createHmac('sha256',jwtSecret).update(usuario+':'+codigo).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(row.token_hash))){await db.query('UPDATE checkout_uk.uk_recuperacoes SET tentativas=tentativas+1 WHERE usuario=$1',[usuario]);await db.query('COMMIT');return res.status(400).json({erro:'Código vencido ou inválido.'})}const password=await bcrypt.hash(senha,12);await db.query('UPDATE contas SET senha_hash=$2,trocar_senha=false,temp_expira=NULL WHERE usuario=$1',[usuario,password]);await db.query('UPDATE afiliados SET senha_hash=$2 WHERE usuario=$1',[usuario,password]);await db.query('UPDATE checkout_uk.uk_recuperacoes SET utilizado_em=now() WHERE usuario=$1',[usuario]);await db.query('COMMIT');res.json({ok:true,mensagem:'Senha alterada. Faça login com a nova senha.'})}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}}));
 r.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.status)return res.status(err.status).json({erro:err.message});console.error('UK central',err);res.status(500).json({erro:'Falha na operação central. Confira a migration 010 e o servidor.'})});
 return r;
};
