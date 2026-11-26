'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 let recPage=0,recMore=true,recBusy=false,recObserver=null;const recSeen=new Set();
 let recEndpoint='/api/vitrine/catalogo',recPrimeiroChave='uk_vitrine_extra_primeiro_v1:catalogo',recEvitarPrimeiro='';
 const recOrdem=UK.novaOrdem();
 async function loadRecommendations(first=false){
  if(recBusy||(!recMore&&!first))return;
  recBusy=true;const btn=$('recommendLoadMore'),info=$('recommendFeedStatus');btn.disabled=true;info.textContent='Buscando produtos na vitrine...';
  let last='';if(first){try{last=localStorage.getItem('uk_ultimo_produto_visto_v1')||''}catch{}
   recEndpoint=last?'/api/vitrine/recomendacoes/'+encodeURIComponent(last):'/api/vitrine/catalogo';
   recPrimeiroChave='uk_vitrine_extra_primeiro_v1:'+(last||'catalogo');
   try{recEvitarPrimeiro=sessionStorage.getItem(recPrimeiroChave)||''}catch{recEvitarPrimeiro=''}
  }
  const endpoint=recEndpoint;
  const url=(base,p)=>base+'?pagina='+p+'&limite=16&ordem='+recOrdem+'&evitarPrimeiro='+encodeURIComponent(recEvitarPrimeiro);
  try{
   const page=first?1:recPage+1;
   let d=await UK.api(url(endpoint,page));
   // Caso o último anúncio tenha saído da vitrine, mostrar o catálogo completo.
   if(first&&last&&Number(d.total)===0&&!d.categoria){
    recEndpoint='/api/vitrine/catalogo';recPrimeiroChave='uk_vitrine_extra_primeiro_v1:catalogo';
    try{recEvitarPrimeiro=sessionStorage.getItem(recPrimeiroChave)||''}catch{recEvitarPrimeiro=''}
    d=await UK.api(url(recEndpoint,1));try{localStorage.removeItem('uk_ultimo_produto_visto_v1')}catch{}
   }
   if(first){$('recommendations').replaceChildren();recSeen.clear();$('recommendCategory').textContent=d.categoria?'Mais produtos de '+d.categoria+' · categoria que você visitou':'Produtos disponíveis na vitrine Uti Like';try{if(d.itens?.[0]?.id)sessionStorage.setItem(recPrimeiroChave,String(d.itens[0].id))}catch{}}
   for(const p of d.itens||[]){if(!p.id||recSeen.has(String(p.id)))continue;recSeen.add(String(p.id));$('recommendations').append(UK.card(p))}
   recPage=d.pagina||page;recMore=d.temMais===true;btn.hidden=!recMore;btn.disabled=false;
   info.textContent=recMore?'Continue descendo para descobrir mais produtos.':recSeen.size?'Você chegou ao fim dos produtos disponíveis.':'Ainda não há sugestões disponíveis.';
  }catch(e){btn.hidden=false;btn.disabled=false;info.textContent='Não foi possível consultar o catálogo. Toque em Carregar mais para tentar novamente.'}
  finally{recBusy=false}
 }
 $('recommendLoadMore').onclick=()=>loadRecommendations();
 if('IntersectionObserver' in window){recObserver=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)&&recMore&&!recBusy&&recPage>0)loadRecommendations()},{rootMargin:'360px 0px'});recObserver.observe($('recommendSentinel'))}
 async function run(){
  const a=UK.auth();
  if(a?.user?.perfil==='cliente'){
   try{
    const d=await UK.api('/api/vitrine/conta/resumo');
    $('greeting').textContent='Olá, '+String(d.perfil.nome||d.perfil.usuario);
    $('username').textContent='@'+d.perfil.usuario;
    $('accountInfo').textContent='Área de cliente conectada. Favoritos e notificações associados à sua conta.';
    const fav=await UK.api('/api/vitrine/favoritos');const box=$('favoriteList');box.replaceChildren();
    if(fav.length)fav.forEach(p=>box.append(UK.card(p)));
    else box.append(UK.el('p','muted','Você ainda não favoritou produtos. Use o botão ♡ nas páginas de detalhes.'));
   }catch(e){$('accountInfo').textContent='Não foi possível carregar seus dados: '+e.message;}
  }else if(a?.user?.perfil==='admin'){
   $('greeting').textContent='Olá, '+String(a.user.nome||'Administrador');
   $('username').textContent='Administrador · Uti Like';
   $('accountInfo').textContent='Sua sessão administrativa está ativa. Use o botão Administração abaixo para abrir a Central da Administração.';
  }else if(a?.user?.perfil==='afiliado'){
   $('greeting').textContent='Olá, '+String(a.user.nome||a.user.usuario||'Afiliado');
   $('username').textContent='Conta de afiliado · Uti Like';
   $('accountInfo').textContent='Sua conta de afiliado está conectada. Acesse o painel de afiliados em Configurações.';
  }else{
   $('accountInfo').replaceChildren();
   $('accountInfo').append(UK.el('span','','Entre na sua conta na vitrine para acessar seus dados e funções disponíveis para seu perfil. '));
   const link=UK.el('a','','Fazer login');link.href='index.html#entrar';$('accountInfo').append(link);
  }
  await loadRecommendations(true);UK.sincronizarSacola().then(()=>UK.refreshSacolaCount()).catch(()=>{});
 }

 // P2/P3: Configurações integradas na Minha Conta, inclusive em telas pequenas.
 function montarConfiguracoes(){
  const main=document.querySelector('main')||document.body;
  const panel=document.createElement('section');panel.id='configuracoes';panel.className='section-card uk-account-settings';
  panel.setAttribute('aria-label','Configurações da conta');
  panel.innerHTML=`<h2>⚙ Configurações da conta</h2>
    <p class="muted">Consulte seus dados, ajuste seu endereço e controle a segurança do seu acesso.</p>
    <div class="setting-links" id="ukLinksAcesso"><a href="index.html">Voltar à vitrine</a><a href="carrinho.html">Meu carrinho</a><a href="minhas-notificacoes.html">Avisos</a></div>
    <div id="ukContaForms">
      <form id="ukPerfilForm"><h3>Perfil e contato</h3><div class="settings-grid">
        <label>Nome completo<input name="nome" autocomplete="name" required maxlength="100"></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" required maxlength="120"></label>
        <label>Telefone / WhatsApp<input name="telefone" type="tel" autocomplete="tel" required maxlength="18"></label></div>
        <button type="submit">Salvar perfil</button><p class="settings-message" id="ukPerfilMsg" role="status"></p></form>
      <form id="ukEnderecoForm"><h3>Meu endereço de entrega</h3><p class="note">Um endereço principal. O checkout utilizará a integração própria quando ativado.</p><div class="settings-grid">
        <label>Destinatário<input name="destinatario" autocomplete="name" required maxlength="100"></label>
        <label>CEP<input name="cep" autocomplete="postal-code" inputmode="numeric" required maxlength="9"></label>
        <label>Rua / avenida<input name="logradouro" autocomplete="address-line1" required maxlength="140"></label>
        <label>Número<input name="numero" required maxlength="20"></label>
        <label>Complemento<input name="complemento" maxlength="120"></label>
        <label>Bairro<input name="bairro" required maxlength="100"></label>
        <label>Cidade<input name="cidade" autocomplete="address-level2" required maxlength="100"></label>
        <label>UF (ex.: PE)<input name="uf" autocomplete="address-level1" required maxlength="2"></label></div>
        <button type="submit">Salvar endereço</button><p class="settings-message" id="ukEnderecoMsg" role="status"></p></form>
      <form id="ukSenhaForm"><h3>Conta e segurança</h3><div class="settings-grid">
        <label>Senha atual<input name="atual" autocomplete="current-password" type="password" required></label>
        <label>Nova senha<input name="nova" autocomplete="new-password" type="password" required minlength="8"></label></div>
        <button type="submit">Alterar minha senha</button><p class="settings-message" id="ukSenhaMsg" role="status"></p></form>
    </div><p id="ukAcessoRecado" class="note"></p>`;
  main.append(panel);
  const a=UK.auth(),links=panel.querySelector('#ukLinksAcesso'),forms=panel.querySelector('#ukContaForms');
  const adminBox=document.getElementById('ukAdminEntry');
  if(adminBox)adminBox.hidden=!(a?.token&&a?.user?.perfil==='admin');
  const link=(href,nome)=>{const el=document.createElement('a');el.href=href;el.textContent=nome;links.append(el)};
  if(a?.user?.perfil==='admin'){
    link('admin.html','Administração');link('cronjob.html','Meu Cronjob');link('notificacoes.html','Notificações administrativas');
  }
  if(a?.user?.perfil!=='cliente'){
   forms.hidden=true;
   panel.querySelector('#ukAcessoRecado').textContent=a?.user?.perfil==='admin'?'Administrador: os acessos permitidos estão acima. Configurações de clientes só aparecem em contas de clientes.':a?.user?.perfil==='afiliado'?'Use o painel de afiliados para seus dados e configurações.':'Faça login como cliente na vitrine para editar perfil, senha e endereço.';
  }else{
   const setForm=(form,values)=>{for(const [key,val] of Object.entries(values||{})){const el=form.elements.namedItem(key);if(el)el.value=val??''}};
   UK.api('/api/vitrine/conta/configuracoes').then(data=>{setForm(panel.querySelector('#ukPerfilForm'),data.perfil);setForm(panel.querySelector('#ukEnderecoForm'),data.endereco)}).catch(err=>{panel.querySelector('#ukPerfilMsg').textContent=err.message});
   const handle=async(id,path,method,msg)=>{const f=panel.querySelector('#'+id);f.addEventListener('submit',async ev=>{ev.preventDefault();const btn=f.querySelector('[type="submit"]'),place=panel.querySelector('#'+msg);btn.disabled=true;place.textContent='Salvando...';try{const body=Object.fromEntries(new FormData(f).entries());const data=await UK.api(path,{method,body:JSON.stringify(body)});place.textContent=data.mensagem||'Informações atualizadas.';if(id==='ukSenhaForm')f.reset();if(id==='ukPerfilForm'&&data.perfil){const ses=UK.auth();if(ses){ses.user.nome=data.perfil.nome;}}}catch(e){place.textContent=e.message}finally{btn.disabled=false}})};
   handle('ukPerfilForm','/api/vitrine/conta/perfil','PATCH','ukPerfilMsg');
   handle('ukEnderecoForm','/api/vitrine/conta/endereco','PUT','ukEnderecoMsg');
   handle('ukSenhaForm','/api/vitrine/conta/alterar-senha','POST','ukSenhaMsg');
  }
  if(location.hash==='#configuracoes')setTimeout(()=>panel.scrollIntoView({behavior:'smooth',block:'start'}),100);
 }

 function montarDestaquesConta(){
  const main=document.querySelector('main');if(!main)return;
  const section=document.createElement('section');section.className='uk-account-showcase section-card';section.setAttribute('aria-label','Destaques da Minha Conta');
  section.innerHTML='<span class="uk-showcase-eyebrow">UTI LIKE · MINHA CONTA</span><h2>Descubra novidades enquanto cuida da sua conta.</h2><p id="ukShowcaseText">Seus favoritos e novos produtos estão a um toque de distância.</p><div class="uk-showcase-buttons"><a id="ukShowcaseLink" href="index.html">Explorar vitrine</a><button type="button" id="ukShowcasePrev" aria-label="Destaque anterior">‹</button><button type="button" id="ukShowcasePause">Pausar</button><button type="button" id="ukShowcaseNext" aria-label="Próximo destaque">›</button></div>';
  main.prepend(section);
  const defaults=[{text:'Seus favoritos e novos produtos estão a um toque de distância.',href:'index.html',action:'Explorar vitrine'},{text:'Confira os detalhes e as condições dos produtos antes de escolher.',href:'index.html#catalogo',action:'Ver produtos'},{text:'Acompanhe avisos e mensagens da sua conta com facilidade.',href:'minhas-notificacoes.html',action:'Ver avisos'}];
  let slides=defaults.slice(),index=0,auto=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  const update=()=>{const item=slides[index];section.querySelector('#ukShowcaseText').textContent=item.text;const a=section.querySelector('#ukShowcaseLink');a.textContent=item.action;a.href=item.href;};
  const move=delta=>{index=(index+delta+slides.length)%slides.length;update()};
  section.querySelector('#ukShowcasePrev').onclick=()=>move(-1);
  section.querySelector('#ukShowcaseNext').onclick=()=>move(1);
  section.querySelector('#ukShowcasePause').onclick=e=>{auto=!auto;e.currentTarget.textContent=auto?'Pausar':'Reproduzir'};
  setInterval(()=>{if(auto&&!document.hidden)move(1)},4300);
  UK.api('/api/vitrine/campanhas/ativas').then(data=>{
    const extra=Array.isArray(data)?data.filter(c=>c.tipo==='banner'&&c.titulo&&String(c.destino||'').startsWith('/')&&!String(c.destino||'').startsWith('//')).slice(0,4):[];
    slides=defaults.concat(extra.map(x=>({text:[x.titulo,x.mensagem].filter(Boolean).join(' · '),href:x.destino,action:x.botao_texto||'Conferir novidade'})));update();
  }).catch(()=>{});
 }
 montarDestaquesConta();
 montarConfiguracoes();
 UK.bottom('minha-conta.html');UK.ready.then(run).catch(e=>console.warn(e));
})();
