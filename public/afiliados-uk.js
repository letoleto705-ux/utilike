'use strict';(async()=>{
 const $=id=>document.getElementById(id),linkBase=location.origin+'/';
 const text=(s,n=180)=>String(s??'').slice(0,n),money=n=>UK.money(n);
 try{await UK.ready;const u=UK.auth()?.user;
  if(!u){$('feedback').replaceChildren(UK.el('span','','Entre para acessar sua área: '));const a=UK.el('a','','Fazer login');a.href='login.html?retorno=afiliados';$('feedback').append(a);return}
  if(!['afiliado','admin'].includes(u.perfil)){$('feedback').textContent='Sua conta é de cliente. Para se afiliar, acesse o cadastro.';const a=UK.el('a','','Quero me afiliar');a.href='login.html?modo=afiliado';$('feedback').append(' ',a);return}
  const username=u.perfil==='admin'?'admin':u.usuario;
  const makeContextLink=(path,values)=>{const url=new URL(path,linkBase);for(const [key,value] of Object.entries(values)){if(value!==undefined&&value!==null&&String(value)!=='')url.searchParams.set(key,String(value))}return UK.normalizeContextUrl(url.href)};
  $('vendaLink').value=makeContextLink('index.html',username==='admin'?{ref:'admin'}:{ref:'admin',afiliado:username});
  $('conviteLink').value=makeContextLink('login.html',{modo:'afiliado',cad:username});
  $('adminLink').hidden=u.perfil!=='admin';$('dashboard').hidden=false;
  const copyStyle=document.createElement('style');copyStyle.textContent='.links{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.links input{flex:1 1 240px;min-width:0}.links button.copied{background:#16874e!important;border-color:#16874e!important;color:#fff!important}';document.head.append(copyStyle);
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const x=$(b.dataset.copy);if(!x?.value)return;let copied=false;try{await navigator.clipboard.writeText(x.value);copied=true}catch{try{x.select();copied=document.execCommand('copy')}catch{}}if(copied){b.dataset.originalText??=b.textContent;b.textContent='Copiado';b.classList.add('copied');$('feedback').textContent='Link copiado com sucesso.';setTimeout(()=>{b.textContent=b.dataset.originalText||'Copiar';b.classList.remove('copied')},2200)}else{$('feedback').textContent='Selecione e copie o link.'}});
  $('makeProductLink').onclick=()=>{const id=$('productId').value.trim();if(!id)return;$('productLink').value=makeContextLink('produto.html',username==='admin'?{id,ref:'admin'}:{id,ref:'admin',afiliado:username})};
  $('clearProductLink').onclick=()=>{$('productId').value='';$('productLink').value='';$('productId').focus()};
  const rede=await UK.api('/api/rede');const sponsor=rede.eu?.patrocinadorNome||'Central (Administrador)';const welcome=$('welcome');welcome.replaceChildren(document.createTextNode('Olá, '+(u.nome||u.usuario)+'. Você foi indicada(o) por '));const sponsorName=document.createElement('strong');sponsorName.className='sponsor-highlight';sponsorName.textContent=sponsor;welcome.append(sponsorName,document.createTextNode(' e já está autorizada(o) a divulgar produtos da Uti Like e ganhar comissões.'));const sponsorStyle=document.createElement('style');sponsorStyle.textContent='.sponsor-highlight{color:#a64b00;font-weight:800}';document.head.append(sponsorStyle);$('feedback').textContent='Seu painel está conectado ao servidor.';
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
