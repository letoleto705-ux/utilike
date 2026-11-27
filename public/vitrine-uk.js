'use strict';
/* UTI LIKE — Contrato central de compra.
   Sacola: Neon (inclusive para visitante via cookie aleatório).
   Carrinho: Neon, separado, por identidade autenticada.
   Exceção explícita: Produto Teste é uma simulação local, nunca vai ao Neon.
*/
(function(root){
  const OLD_KEY='uk_sacola_compra_v1',OLD_PREFIX='uk_sacola_atual_v2:',TEST_ID='produto-teste',TEST_PRODUCT={id:TEST_ID,nome:'Produto Teste',descricao:'Produto exclusivo para homologação local, sem cobrança e sem pedido real.',categoria:'Homologação',precoPor:100,preco:100,ativo:true,estoque:999,imagem:''};
 const text=(v,n=250)=>String(v??'').trim().slice(0,n);
 const norm=x=>Array.isArray(x)?x.map(v=>({produtoId:text(v.produtoId??v.id),variacaoId:text(v.variacaoId??v.variante??'',160),quantidade:Number(v.quantidade??v.qtd??1)})).filter(v=>v.produtoId&&Number.isSafeInteger(v.quantidade)&&v.quantidade>0&&v.quantidade<=99):[];
 function old(store,key){try{return norm(JSON.parse(store.getItem(key)||'[]'))}catch{return []}}
  let cached=[],currentUser=null,queue=Promise.resolve(),loaded=false;
  const localRead=(key,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback}catch{return fallback}};
  const localWrite=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}};
  const userKey=()=>currentUser?String(currentUser.perfil||'cliente')+':'+String(currentUser.usuario||''): 'visitante';
  const testBagKey=()=>`uk_produto_teste_sacola_v1:${userKey()}`;
  const testCartKey=()=>`uk_produto_teste_carrinho_v1:${userKey()}`;
  const testQuantity=key=>Math.max(0,Math.min(99,Number(localRead(key,0))||0));
  const testEntry=quantity=>quantity>0?{produtoId:TEST_ID,variacaoId:'',quantidade:quantity}:null;
  function mergeTest(items){const arr=norm(items).filter(x=>x.produtoId!==TEST_ID),entry=testEntry(testQuantity(testBagKey()));return entry?[...arr,entry]:arr}
  function saveTestQuantity(key,quantity){if(quantity>0)localWrite(key,quantity);else{try{localStorage.removeItem(key)}catch{}}}
 const emit=()=>{UK.refreshSacolaCount();root.dispatchEvent(new CustomEvent('uk:sacola-alterada',{detail:{itens:cached}}))};
 const UK={
  auth(){return currentUser?{user:currentUser}:null},
  setUser(user){currentUser=user||null;root.dispatchEvent(new Event('uk:conta-autenticada'))},
  get ready(){return started},
  money(n){return Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})},
  novaOrdem(){const a=new Uint8Array(16);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('')},
   async api(url,opts={}){if(String(url).includes('/api/vitrine/produtos/'+TEST_ID))return this.produtoTeste();const h={...(opts.body!==undefined?{'Content-Type':'application/json'}:{}),...(opts.headers||{})};let r;try{r=await fetch(url,{...opts,headers:h,credentials:'same-origin',cache:'no-store'})}catch{throw Error('Falha de conexão com o servidor.')}const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.erro||'Falha HTTP '+r.status),{status:r.status});return d},
  image(v){try{const u=new URL(String(v||''),location.origin);return !u.username&&!u.password&&(u.protocol==='https:'||u.origin===location.origin&&u.protocol==='http:')?u.href:null}catch{return null}},
  el(tag,cls,content){const x=document.createElement(tag);if(cls)x.className=cls;if(content!==undefined)x.textContent=content;return x},
    normalizeContextUrl(href){try{const u=new URL(href,location.href),keys=['ref','afiliado','modo','cad'],values={};for(const k of keys){const v=text(u.searchParams.get(k),80).toLowerCase();if(/^[a-z0-9._-]{1,80}$/.test(v))values[k]=v;u.searchParams.delete(k)}if(values.modo==='afiliado'||values.modo==='recuperar')u.searchParams.set('modo',values.modo);if(values.cad){u.searchParams.set('cad',values.cad);if(values.cad!=='admin')u.searchParams.set('modo','afiliado')}const ref=values.ref,af=values.afiliado;if(af&&af!==ref)u.searchParams.set('afiliado',af);else if(ref&&ref!=='admin')u.searchParams.set('ref',ref);return u.href}catch{return href}},
    tracking(){const p=new URLSearchParams(location.search),out=new URLSearchParams(),saved=(()=>{try{const x=JSON.parse(sessionStorage.getItem('uk_ref_context_v2')||'{}');return Number(x.expiraEm)>Date.now()?x:{}}catch{return {}}})();const hasUrl=p.has('ref')||p.has('afiliado'),clean=x=>{const v=text(x,80).toLowerCase();return /^[a-z0-9._-]{1,80}$/.test(v)?v:''},ref=clean(hasUrl?p.get('ref'):saved.ref),afiliado=clean(hasUrl?p.get('afiliado'):saved.afiliado);if(ref)out.set('ref',ref);if(afiliado)out.set('afiliado',afiliado);if(ref||afiliado)try{sessionStorage.setItem('uk_ref_context_v2',JSON.stringify({ref,afiliado,expiraEm:Date.now()+15*86400000}))}catch{}return out},
   ensureAuthenticatedAffiliateUrl(){if(!currentUser||currentUser.perfil!=='afiliado')return;const current=new URL(location.href);if(current.searchParams.has('ref')||current.searchParams.has('afiliado'))return;const afiliado=text(currentUser.usuario,30).toLowerCase();if(!/^[a-z0-9._-]{3,30}$/.test(afiliado))return;try{sessionStorage.setItem('uk_ref_context_v2',JSON.stringify({ref:'',afiliado,expiraEm:Date.now()+15*86400000}))}catch{};current.searchParams.set('afiliado',afiliado);history.replaceState(history.state,'',this.normalizeContextUrl(current.href))},
   contextHref(href){try{const u=new URL(href,location.href);if(u.origin!==location.origin)return href;const t=this.tracking();for(const [k,v] of t)u.searchParams.set(k,v);return u.pathname.split('/').pop()+u.search+u.hash}catch{return href}},
   ensureTrackingUrl(){const current=new URL(this.normalizeContextUrl(location.href)),t=this.tracking();for(const [k,v] of t)current.searchParams.set(k,v);const canonical=this.normalizeContextUrl(current.href);if(canonical!==location.href)history.replaceState(history.state,'',canonical)},
   async catalogoCompleto(){const all=[],seen=new Set();for(let pagina=1;;pagina++){const d=await this.api('/api/vitrine/catalogo?pagina='+pagina+'&limite=36');for(const p of d.itens||[]){const id=String(p.id);if(!seen.has(id)){seen.add(id);all.push(p)}}if(!d.temMais||!(d.itens||[]).length)break}return all},
   async completeMirror(){const style=document.createElement('style');style.textContent='.bag-mirror,.cart-mirror{margin:18px 0}.bag-mirror-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;max-height:520px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.cart-mirror-grid{max-height:520px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.bag-mirror-grid .recommend-card{min-width:0}';document.head.append(style);const path=location.pathname.toLowerCase();if(!path.endsWith('/carrinho.html')&&!path.endsWith('/sacola.html'))return;for(let attempt=0;attempt<40;attempt++){const grid=document.querySelector(path.endsWith('/carrinho.html')?'#cartRecommendations':'#bagRecommendations');if(grid){const existing=new Set([...grid.querySelectorAll('[href*="produto.html?id="]')].map(a=>{try{return new URL(a.href,location.href).searchParams.get('id')}catch{return null}}));const products=await this.catalogoCompleto();for(const p of products){if(!existing.has(String(p.id))&&String(p.id)!=='produto-teste'){grid.append(this.card(p));existing.add(String(p.id))}}return}if(path.endsWith('/sacola.html')){const main=document.querySelector('main');if(main){const section=this.el('section','section-card bag-mirror'),title=this.el('div','section-title'),grid=this.el('div','bag-mirror-grid');section.id='bagMirror';grid.id='bagRecommendations';title.append(this.el('h2','', 'Adicione mais produtos a sua sacola'),this.el('span','muted','Voce tambem pode gostar'));section.append(title,grid);main.append(section);continue}}await new Promise(resolve=>setTimeout(resolve,50))}},
   async captureTracking(){let p=this.tracking(),urlHas=new URLSearchParams(location.search).has('ref')||new URLSearchParams(location.search).has('afiliado');if(!urlHas){const saved=await this.api('/api/uk/referencia').catch(()=>null);if(saved?.ref||saved?.afiliado){try{sessionStorage.setItem('uk_ref_context_v2',JSON.stringify({ref:saved.ref||'',afiliado:saved.afiliado||'',expiraEm:Date.now()+15*86400000}))}catch{};p=this.tracking();this.ensureTrackingUrl()}}else this.ensureTrackingUrl();const afiliado=p.get('afiliado')||(p.get('ref')==='admin'?'admin':'');if(afiliado||urlHas)await this.api('/api/uk/referencia',{method:'POST',body:JSON.stringify({ref:p.get('ref')||'',afiliado,origem:'loja'})}).catch(()=>{});document.querySelectorAll('a[href]').forEach(a=>{const href=a.getAttribute('href');if(href&&!href.startsWith('#')&&!href.startsWith('http'))a.setAttribute('href',this.contextHref(href))})},
  card(p){const a=this.el('a','recommend-card');a.href=this.contextHref('produto.html?id='+encodeURIComponent(String(p.id)));const photo=this.el('div','recommend-photo'),url=this.image(p.imagem||p.image);if(url){const im=this.el('img');im.src=url;im.alt=text(p.nome||p.name||'Produto');im.loading='lazy';im.decoding='async';im.referrerPolicy='no-referrer';photo.append(im)}else photo.textContent='Imagem indisponível';a.append(photo,this.el('div','recommend-details'));a.lastChild.append(this.el('div','recommend-name',text(p.nome||p.name)),this.el('div','recommend-price',this.money(p.precoPor??p.preco??p.price)));return a},
   produtoTeste(){const product={...TEST_PRODUCT,sku:'UTI-TESTE-100'};try{localStorage.setItem('uk_produto_teste_v1',JSON.stringify(product));localStorage.setItem('uk_produto_teste_id_v1',TEST_ID);localStorage.setItem('uk_produto_teste_sku_v1',product.sku)}catch{}return product},
   ehProdutoTeste(id){return String(id)===TEST_ID},
   carrinhoTeste(){return testEntry(testQuantity(testCartKey()))},
   sacola(){return mergeTest(cached).map(x=>({...x}))},
  refreshSacolaCount(){const n=cached.reduce((s,x)=>s+x.quantidade,0);document.querySelectorAll('[data-bag-count]').forEach(el=>{el.textContent=n>99?'99+':String(n);el.hidden=n===0});return n},
  async refreshCartCount(){const els=[...document.querySelectorAll('[data-cart-count]')];if(!currentUser){els.forEach(e=>{e.textContent='0';e.hidden=true});return 0}try{const d=await this.api('/api/vitrine/carrinho');const n=(d.itens||[]).reduce((s,x)=>s+Number(x.quantidade||0),0);els.forEach(e=>{e.textContent=n>99?'99+':String(n);e.hidden=n===0});return n}catch{els.forEach(e=>{e.textContent='?';e.hidden=false});return 0}},
   async guardarCarrinho(produtoId,variacaoId='',quantidade=1){await started;if(!currentUser)throw Error('Entre na Uti Like para guardar produtos no Carrinho UK.');if(this.ehProdutoTeste(produtoId)){saveTestQuantity(testCartKey(),testQuantity(testCartKey())+Number(quantidade));return true}await this.api('/api/vitrine/carrinho/itens',{method:'POST',body:JSON.stringify({produtoId:String(produtoId),variacaoId:String(variacaoId),quantidade})});await this.refreshCartCount();return true},
   async alterarCarrinhoTeste(quantidade){if(!currentUser)throw Error('Entre na Uti Like para guardar produtos no Carrinho UK.');saveTestQuantity(testCartKey(),quantidade);return this.carrinhoTeste()},
   async removerCarrinhoTeste(){saveTestQuantity(testCartKey(),0);return true},
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
    await queue;await this._legacy();const result=await this.api('/api/uk/sacola');cached=mergeTest(result.itens);loaded=true;emit();return this.sacola()},
  _enqueue(action){const task=queue.catch(()=>{}).then(async()=>{const r=await action();cached=norm(r.itens);emit();return true});queue=task.catch(()=>{});return task},
   async adicionarSacola(produtoId,variacaoId='',quantidade=1){await started;if(this.ehProdutoTeste(produtoId)){saveTestQuantity(testBagKey(),testQuantity(testBagKey())+Number(quantidade));emit();return true}return this._enqueue(()=>this.api('/api/uk/sacola/itens',{method:'POST',body:JSON.stringify({produtoId,variacaoId,quantidade})}))},
   async atualizarSacola(produtoId,variacaoId='',quantidade=1){await started;if(this.ehProdutoTeste(produtoId)){saveTestQuantity(testBagKey(),quantidade);emit();return true}return this._enqueue(()=>this.api('/api/uk/sacola/itens',{method:'PATCH',body:JSON.stringify({produtoId,variacaoId,quantidade})}))},
   async removerSacola(produtoId,variacaoId=''){await started;if(this.ehProdutoTeste(produtoId)){saveTestQuantity(testBagKey(),0);emit();return true}return this._enqueue(()=>this.api('/api/uk/sacola/itens',{method:'DELETE',body:JSON.stringify({produtoId,variacaoId})}))},
  async salvarSacola(lista){throw Error('Use adicionarSacola, atualizarSacola ou removerSacola. Substituição cega desativada para não perder dados entre dispositivos.')},
  async comprarAgora(id,v='',q=1){await this.adicionarSacola(id,v,q);location.href=this.contextHref('checkout.html?origem=sacola')},
  bottom(current){if(document.querySelector('.uk-bottom'))return;const nav=this.el('nav','uk-bottom');nav.setAttribute('aria-label','Navegação inferior');for(const [file,ico,label] of [['index.html','⌂','Início'],['sacola.html','▣','Sacola'],['carrinho.html','🛒','Carrinho'],['minhas-notificacoes.html','♧','Avisos'],['minha-conta.html','♙','Minha Conta']]){const a=this.el('a');a.href=this.contextHref(file);if(file===current)a.style.color='#0758b9';a.append(this.el('span','',ico),this.el('small','',label));nav.append(a)}document.body.append(nav);this.refreshCartCount();this.refreshSacolaCount()}
 };
 root.UK=UK;
  const started=(async()=>{
   try{const canonical=UK.normalizeContextUrl(location.href);if(canonical!==location.href)history.replaceState(history.state,'',canonical)}catch{}
  try{const s=await UK.api('/api/uk/sessao');currentUser=s.user||null;UK.ensureAuthenticatedAffiliateUrl()}catch{currentUser=null}
  try{await UK.captureTracking()}catch{}
   try{await UK._legacy();const d=await UK.api('/api/uk/sacola');cached=mergeTest(d.itens);loaded=true;emit()}catch(e){console.warn('Sacola central indisponível:',e.message)}
   root.dispatchEvent(new Event('uk:sessao-pronta'));setTimeout(()=>UK.completeMirror().catch(()=>{}),0);return UK.auth();
 })();
 if(root.addEventListener)root.addEventListener('focus',()=>{if(loaded)UK.sincronizarSacola().catch(()=>{})});
})(window);
