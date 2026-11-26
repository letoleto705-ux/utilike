'use strict';
/* UTI LIKE — Contrato central de compra.
   Sacola: Neon (inclusive para visitante via cookie aleatório).
   Carrinho: Neon, separado, por identidade autenticada.
   Nada novo é gravado em localStorage ou sessionStorage.
   Dados legados são lidos uma única vez para migração segura.
*/
(function(root){
 const OLD_KEY='uk_sacola_compra_v1',OLD_PREFIX='uk_sacola_atual_v2:';
 const text=(v,n=250)=>String(v??'').trim().slice(0,n);
 const norm=x=>Array.isArray(x)?x.map(v=>({produtoId:text(v.produtoId??v.id),variacaoId:text(v.variacaoId??v.variante??'',160),quantidade:Number(v.quantidade??v.qtd??1)})).filter(v=>v.produtoId&&Number.isSafeInteger(v.quantidade)&&v.quantidade>0&&v.quantidade<=99):[];
 function old(store,key){try{return norm(JSON.parse(store.getItem(key)||'[]'))}catch{return []}}
 let cached=[],currentUser=null,queue=Promise.resolve(),loaded=false;
 const emit=()=>{UK.refreshSacolaCount();root.dispatchEvent(new CustomEvent('uk:sacola-alterada',{detail:{itens:cached}}))};
 const UK={
  auth(){return currentUser?{user:currentUser}:null},
  setUser(user){currentUser=user||null;root.dispatchEvent(new Event('uk:conta-autenticada'))},
  get ready(){return started},
  money(n){return Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})},
  novaOrdem(){const a=new Uint8Array(16);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('')},
  async api(url,opts={}){const h={...(opts.body!==undefined?{'Content-Type':'application/json'}:{}),...(opts.headers||{})};let r;try{r=await fetch(url,{...opts,headers:h,credentials:'same-origin',cache:'no-store'})}catch{throw Error('Falha de conexão com o servidor.')}const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.erro||'Falha HTTP '+r.status),{status:r.status});return d},
  image(v){try{const u=new URL(String(v||''),location.origin);return !u.username&&!u.password&&(u.protocol==='https:'||u.origin===location.origin&&u.protocol==='http:')?u.href:null}catch{return null}},
  el(tag,cls,content){const x=document.createElement(tag);if(cls)x.className=cls;if(content!==undefined)x.textContent=content;return x},
  card(p){const a=this.el('a','recommend-card');a.href='produto.html?id='+encodeURIComponent(String(p.id));const photo=this.el('div','recommend-photo'),url=this.image(p.imagem||p.image);if(url){const im=this.el('img');im.src=url;im.alt=text(p.nome||p.name||'Produto');im.loading='lazy';im.decoding='async';im.referrerPolicy='no-referrer';photo.append(im)}else photo.textContent='Imagem indisponível';a.append(photo,this.el('div','recommend-details'));a.lastChild.append(this.el('div','recommend-name',text(p.nome||p.name)),this.el('div','recommend-price',this.money(p.precoPor??p.preco??p.price)));return a},
  sacola(){return cached.map(x=>({...x}))},
  refreshSacolaCount(){const n=cached.reduce((s,x)=>s+x.quantidade,0);document.querySelectorAll('[data-bag-count]').forEach(el=>{el.textContent=n>99?'99+':String(n);el.hidden=n===0});return n},
  async refreshCartCount(){const els=[...document.querySelectorAll('[data-cart-count]')];if(!currentUser){els.forEach(e=>{e.textContent='0';e.hidden=true});return 0}try{const d=await this.api('/api/vitrine/carrinho');const n=(d.itens||[]).reduce((s,x)=>s+Number(x.quantidade||0),0);els.forEach(e=>{e.textContent=n>99?'99+':String(n);e.hidden=n===0});return n}catch{els.forEach(e=>{e.textContent='?';e.hidden=false});return 0}},
  async guardarCarrinho(produtoId,variacaoId='',quantidade=1){await started;if(!currentUser)throw Error('Entre na Uti Like para guardar produtos no Carrinho UK.');await this.api('/api/vitrine/carrinho/itens',{method:'POST',body:JSON.stringify({produtoId:String(produtoId),variacaoId:String(variacaoId),quantidade})});await this.refreshCartCount();return true},
  async _legacy(){const keys=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(OLD_PREFIX))keys.push(k)}}catch{}
   const entries=keys.map(k=>[k,old(localStorage,k)]).filter(([,arr])=>arr.length);
   let session=[];try{session=old(sessionStorage,OLD_KEY)}catch{}if(session.length)entries.push([OLD_KEY,session]);
   // Não migra outras contas locais: só a do usuário atual ou visitante.
   const u=currentUser?text(currentUser.perfil,30)+':'+text(currentUser.usuario,80):'visitante';
   for(const [key,arr] of entries){if(key!==OLD_KEY && key!==OLD_PREFIX+'visitante' && key!==OLD_PREFIX+u && !(currentUser && key.endsWith(':'+text(currentUser.usuario,80))))continue;
    const str=JSON.stringify(arr.slice().sort((a,b)=>a.produtoId.localeCompare(b.produtoId)));const bytes=new TextEncoder().encode(str);
    const digest=await crypto.subtle.digest('SHA-256',bytes);const suffix=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
    await this.api('/api/uk/sacola/importar',{method:'POST',body:JSON.stringify({origem:'legado:'+suffix,itens:arr})});
    try{if(key===OLD_KEY)sessionStorage.removeItem(key);else localStorage.removeItem(key)}catch{}
   }
  },
  async sincronizarSacola(){// Operações anteriores sempre terminam antes de consultar.
   await queue;await this._legacy();const result=await this.api('/api/uk/sacola');cached=norm(result.itens);loaded=true;emit();return this.sacola()},
  _enqueue(action){const task=queue.catch(()=>{}).then(async()=>{const r=await action();cached=norm(r.itens);emit();return true});queue=task.catch(()=>{});return task},
  async adicionarSacola(produtoId,variacaoId='',quantidade=1){await started;return this._enqueue(()=>this.api('/api/uk/sacola/itens',{method:'POST',body:JSON.stringify({produtoId,variacaoId,quantidade})}))},
  async atualizarSacola(produtoId,variacaoId='',quantidade=1){await started;return this._enqueue(()=>this.api('/api/uk/sacola/itens',{method:'PATCH',body:JSON.stringify({produtoId,variacaoId,quantidade})}))},
  async removerSacola(produtoId,variacaoId=''){await started;return this._enqueue(()=>this.api('/api/uk/sacola/itens',{method:'DELETE',body:JSON.stringify({produtoId,variacaoId})}))},
  async salvarSacola(lista){throw Error('Use adicionarSacola, atualizarSacola ou removerSacola. Substituição cega desativada para não perder dados entre dispositivos.')},
  async comprarAgora(id,v='',q=1){await this.adicionarSacola(id,v,q);location.href='checkout.html?origem=sacola'},
  bottom(current){if(document.querySelector('.uk-bottom'))return;const nav=this.el('nav','uk-bottom');nav.setAttribute('aria-label','Navegação inferior');for(const [file,ico,label] of [['index.html','⌂','Início'],['sacola.html','▣','Sacola'],['carrinho.html','🛒','Carrinho'],['minhas-notificacoes.html','♧','Avisos'],['minha-conta.html','♙','Minha Conta']]){const a=this.el('a');a.href=file;if(file===current)a.style.color='#0758b9';a.append(this.el('span','',ico),this.el('small','',label));nav.append(a)}document.body.append(nav);this.refreshCartCount();this.refreshSacolaCount()}
 };
 root.UK=UK;
 const started=(async()=>{
  try{const s=await UK.api('/api/uk/sessao');currentUser=s.user||null}catch{currentUser=null}
  try{await UK._legacy();const d=await UK.api('/api/uk/sacola');cached=norm(d.itens);loaded=true;emit()}catch(e){console.warn('Sacola central indisponível:',e.message)}
  root.dispatchEvent(new Event('uk:sessao-pronta'));return UK.auth();
 })();
 root.addEventListener('focus',()=>{if(loaded)UK.sincronizarSacola().catch(()=>{})});
})(window);
