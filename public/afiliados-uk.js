'use strict';(async()=>{
 const $=id=>document.getElementById(id),linkBase=location.origin+'/';
 const text=(s,n=180)=>String(s??'').slice(0,n),money=n=>UK.money(n);
 try{await UK.ready;const u=UK.auth()?.user;
  if(!u){$('feedback').replaceChildren(UK.el('span','','Entre para acessar sua área: '));const a=UK.el('a','','Fazer login');a.href='login.html?retorno=afiliados';$('feedback').append(a);return}
  if(!['afiliado','admin'].includes(u.perfil)){$('feedback').textContent='Sua conta é de cliente. Para se afiliar, acesse o cadastro.';const a=UK.el('a','','Quero me afiliar');a.href='login.html?modo=afiliado';$('feedback').append(' ',a);return}
  const username=u.perfil==='admin'?'admin':u.usuario;
  $('welcome').textContent='Olá, '+(u.nome||u.usuario)+'! Compartilhe seus links para divulgar a Uti Like.';
  $('vendaLink').value=linkBase+'index.html?ref=admin'+(username==='admin'?'':'&afiliado='+encodeURIComponent(username));
  $('conviteLink').value=linkBase+'login.html?modo=afiliado&cad='+encodeURIComponent(username);
  $('adminLink').hidden=u.perfil!=='admin';$('dashboard').hidden=false;
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{const x=$(b.dataset.copy);if(x.value)navigator.clipboard.writeText(x.value).then(()=>{$('feedback').textContent='Link copiado.'}).catch(()=>{x.select();$('feedback').textContent='Selecione e copie o link.'})});
  $('makeProductLink').onclick=()=>{const id=$('productId').value.trim();if(!id)return;const url=new URL('produto.html',linkBase);url.searchParams.set('id',id);url.searchParams.set('ref','admin');if(username!=='admin')url.searchParams.set('afiliado',username);$('productLink').value=url.href};
  const rede=await UK.api('/api/rede');$('feedback').textContent='Seu painel está conectado ao servidor.';
  const resumo=rede.resumo||{};
  $('sales').textContent=String(resumo.vendasPagas??rede.eu?.vendasDiretas??0);
  $('commission').textContent=money(resumo.comissaoCentral??rede.eu?.comissaoDireta??0);
  $('networkCommission').textContent=money(rede.eu?.comissaoRede??0);
  const filhos=rede.filhos||rede.afiliados||[];$('network').replaceChildren();
  if(!filhos.length)$('network').textContent='Nenhum afiliado vinculado à sua rede até agora.';
  for(const f of filhos){const box=UK.el('div','entry');box.append(UK.el('strong','',text(f.nome||f.usuario)),UK.el('span','tiny muted','@'+text(f.usuario)+' · Vendas: '+text(f.vendas??f.vendasDiretas??0)));$('network').append(box)}
  const extrato=rede.extrato||[];if(!extrato.length)$('statements').textContent='Nenhuma comissão confirmada registrada até o momento.';
  else for(const item of extrato.slice(0,100)){const box=UK.el('div','entry');box.textContent=[item.geracao,item.situacao,money(item.valor)].filter(Boolean).join(' · ');$('statements').append(box)}
 }catch(e){$('feedback').textContent='Não foi possível abrir o painel: '+e.message;}
})();
