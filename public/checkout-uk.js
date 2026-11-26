'use strict';
/* CHECKOUT UTI LIKE — todos os itens da SACOLA ATUAL, nunca a lista inteira de favoritos.
   Valores calculados pelo catálogo público no servidor. NÃO processa cobranças. */
(()=>{
 const $=id=>document.getElementById(id),money=n=>UK.money(n),params=new URLSearchParams(location.search);
 let quote=null,profile=null,modoTeste=false,working=false,method='pix',draftKey='',loadingPromise=null;
 let recPage=0,recMore=true,recBusy=false,recOrder=UK.novaOrdem(),observer=null,recSeen=new Set(),recLoadEpoch=0;
 const fmtQty=items=>items.reduce((n,x)=>n+Number(x.quantidade||0),0);
 function node(tag,cls,txt){return UK.el(tag,cls,txt)}
 function set(id,v){const e=$(id);if(e)e.textContent=String(v??'')}
 function status(s,err=false){set('operationStatus',s);const box=$('operationStatus');if(box)box.style.color=err?'#b42318':''}
 function toast(s,err=false){const e=$('toast');if(!e)return;e.textContent=s;e.className='toast show'+(err?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.className='toast',3300)}
 function showEmpty(message){const wrap=$('cartItems');wrap.replaceChildren(node('p','cart-loading',message));set('itemCount','('+UK.sacola().length+' item(ns) na sacola)');set('subtotalLabel','Subtotal');}
 function organizarMobile(){const grid=$('checkoutGrid');if(!grid||grid.querySelector('.uk-mobile-sequence'))return;const [left,mid,right]=grid.children;
  const sections={experience:$('experience-panel'),recommend:$('recommend-panel'),cart:$('cart-panel'),coupon:$('coupons-panel'),summary:right.querySelector('.summary-panel'),delivery:$('delivery-panel'),payment:$('payment-panel'),assurances:$('assurances-panel'),preparation:$('preparation-panel'),testInfo:$('testInfo')};
  const mobile=node('section','uk-mobile-sequence stack');mobile.setAttribute('aria-label','Etapas do checkout');grid.prepend(mobile);
  const desktop=[[left,['cart','delivery','coupon']],[mid,['payment','recommend','experience']],[right,['summary','assurances','preparation','testInfo']]];
  const mobileSequence=['experience','recommend','cart','coupon','summary','delivery','payment','assurances','preparation','testInfo'];
  const media=window.matchMedia('(max-width:800px)');function sync(){if(media.matches){for(const k of mobileSequence)if(sections[k])mobile.append(sections[k])}else{for(const [dest,keys] of desktop)for(const k of keys)if(sections[k])dest.append(sections[k])}}
  sync();if(media.addEventListener)media.addEventListener('change',sync);else media.addListener(sync);
 }
 function currentItems(){return UK.sacola().map(x=>({...x}))}
 function renderCart(){const wrap=$('cartItems');wrap.replaceChildren();
  if(!quote?.itens?.length){showEmpty('Sua sacola está vazia. Escolha produtos na vitrine ou no Carrinho UK.');return}
  for(const p of quote.itens){const item=node('article','product uk-checkout-item'+(p.disponivel?'':' uk-unavailable'));const photo=node('div','product-visual'),url=UK.image(p.imagem);
   if(url){const img=node('img');img.loading='lazy';img.alt=p.nome;img.referrerPolicy='no-referrer';img.src=url;photo.append(img)}else photo.append(node('span','missing','Sem foto'));
   const content=node('div','product-main'),link=node('a','product-name',p.nome);link.href='produto.html?id='+encodeURIComponent(p.produtoId);content.append(link);
   if(p.variacaoId)content.append(node('div','product-attr','Variação: '+p.variacaoId));
   if(!p.disponivel)content.append(node('div','uk-item-alert',p.indisponivelMotivo||'Produto indisponível no momento.'));
   else content.append(node('div','product-footer',p.quantidade+' × '+money(p.precoUnitario)+' = '+money(p.totalItem)));
   const controls=node('div','uk-item-actions');const minus=node('button','uk-mini-btn','−'),count=node('strong','',String(p.quantidade)),plus=node('button','uk-mini-btn','+'),remove=node('button','uk-remove-btn','Remover');
   minus.type=plus.type=remove.type='button';minus.disabled=p.quantidade<=1;plus.disabled=p.quantidade>=99;
   minus.setAttribute('aria-label','Diminuir quantidade de '+p.nome);plus.setAttribute('aria-label','Aumentar quantidade de '+p.nome);
   minus.onclick=()=>updateQty(p,p.quantidade-1);plus.onclick=()=>updateQty(p,p.quantidade+1);
   remove.onclick=async()=>{try{await UK.removerSacola(p.produtoId,p.variacaoId);await reload(true)}catch(e){toast(e.message,true)}};
   controls.append(minus,count,plus,remove);content.append(controls);item.append(photo,content);wrap.append(item);
  }
  const count=fmtQty(quote.itens);set('itemCount','('+count+' itens)');set('subtotalLabel','Subtotal ('+count+' itens)');
 }
 function updateAmounts(){renderCart();const subtotal=quote?.subtotal||0;set('subtotal',money(subtotal));set('mobileTotal',money(subtotal));
  set('total',quote?.total!=null?money(quote.total):'A confirmar');
  if($('totalNotice'))set('totalNotice','Subtotal dos produtos: '+money(subtotal)+'. Frete, descontos e total final serão confirmados antes da cobrança.');
  // Gateway real ainda não conectado: nunca liberar botão com registro de teste.
  const enabled=false;
  for(const b of ['finishBtn','mobileFinish'])if($(b))$(b).disabled=!enabled;
 }
 async function updateQty(p,quantity){try{await UK.atualizarSacola(p.produtoId,p.variacaoId,quantity);await reload(true)}catch(e){toast(e.message,true)}}
 async function carregarCotacao(){const items=currentItems();
  if(!items.length){quote=null;updateAmounts();status('Sacola vazia. Adicione produtos para preparar a compra.');return}
  set('itemCount','(verificando)');
  try{quote=await UK.api('/api/checkout-uk/cotacao',{method:'POST',body:JSON.stringify({adicionais:items})});updateAmounts();
   status(quote.indisponiveis?quote.indisponiveis+' item(ns) indisponível(is). Eles permanecem na sacola até você remover ou o estoque voltar.':'Produtos atualizados com o catálogo do Neon. O pagamento será liberado após a integração do gateway.');
  }catch(e){quote=null;updateAmounts();showEmpty('Falha ao consultar os produtos: '+e.message);status(e.message,true)}
 }
 async function transferirOrigemLegada(){
  // Compatibilidade com URLs antigas, sem transformar compra direta em compra isolada.
  const direct=params.get('produto')||params.get('produtoId')||params.get('product');
  if(direct){const id=String(direct),q=Math.max(1,Math.min(99,Number(params.get('quantidade'))||1)),v=params.get('variacaoId')||params.get('variacao')||'';
   const key='uk:direto:'+id+':'+v+':'+q;if(!sessionStorage.getItem(key)){await UK.adicionarSacola(id,v,q);sessionStorage.setItem(key,'1')}
  }
  if(params.get('origem')==='carrinho'&&UK.auth()){
   let chosen=[];try{const x=JSON.parse(sessionStorage.getItem('uk_checkout_selecao_itens')||'[]');chosen=Array.isArray(x)?x.map(String):[]}catch{}
   if(chosen.length){const result=await UK.api('/api/vitrine/carrinho');const selected=(result.itens||[]).filter(x=>x.disponivel&&(chosen.includes(String(x.id))||chosen.includes(String(x.produtoId))));
    for(const x of selected)await UK.adicionarSacola(x.produtoId,x.variacaoId,x.quantidade);
    sessionStorage.removeItem('uk_checkout_selecao_itens');
   }
  }
  if(direct||params.get('origem')==='carrinho')history.replaceState(null,'','checkout.html?origem=sacola');
 }
 function renderRecommend(p){const card=node('article','rec'),photo=node('div','rec-img'),url=UK.image(p.imagem);
  if(url){const img=node('img');img.src=url;img.alt=p.nome;img.referrerPolicy='no-referrer';img.loading='lazy';img.decoding='async';photo.append(img)}else photo.append(node('span','missing','Sem foto'));
  const name=node('a','rec-name',p.nome);name.href='produto.html?id='+encodeURIComponent(p.id);
  const price=node('span','rec-price',money(p.precoPor));const btn=node('button','rec-btn',p.temVariantes?'Escolher variação':'+ Sacola');btn.type='button';
  btn.onclick=async()=>{if(p.temVariantes){location.href='produto.html?id='+encodeURIComponent(p.id);return}
   try{await UK.adicionarSacola(p.id,'',1);btn.textContent='Adicionado ✓';toast('Produto incluído na sacola');await reload(true)}catch(e){toast(e.message,true)}
  };
  card.append(photo,name,price,btn);return card;
 }
 async function sugestoes(reset=false){if(recBusy)return;if(reset){recPage=0;recMore=true;recBusy=false;recSeen.clear();recOrder=UK.novaOrdem();recLoadEpoch++;$('recommendations').replaceChildren();}
  if(!recMore)return;recBusy=true;const epoch=recLoadEpoch,root=$('recommendations');
  try{const d=await UK.api('/api/checkout-uk/sugestoes',{method:'POST',body:JSON.stringify({adicionais:currentItems(),pagina:recPage+1,limite:18,ordem:recOrder})});
   if(epoch!==recLoadEpoch)return;
   for(const p of d.itens||[]){const id=String(p.id);if(recSeen.has(id))continue;recSeen.add(id);root.append(renderRecommend(p))}
   recPage=d.pagina;recMore=d.temMais===true;
   set('suggestionsStatus',recMore?'Role dentro deste quadro para ver mais sugestões.':'Todas as sugestões disponíveis já foram apresentadas.');
   const b=$('suggestionsMore');if(b)b.hidden=!recMore;
   if(!recSeen.size)root.append(node('p','cart-loading','Ainda não há recomendações disponíveis para estas categorias.'));
  }catch(e){set('suggestionsStatus','Não foi possível carregar mais sugestões: '+e.message);const b=$('suggestionsMore');if(b)b.hidden=false}
  finally{recBusy=false}
 }
 async function reload(resetRec=false){if(loadingPromise)return;loadingPromise=(async()=>{try{await carregarCotacao();if(resetRec){recPage=0;recMore=true;recBusy=false;recSeen.clear();recOrder=UK.novaOrdem();recLoadEpoch++;$('recommendations').replaceChildren()}await sugestoes()}finally{loadingPromise=null}})();return loadingPromise}
 function initSuggestionScroll(){const list=$('recommendations');list.addEventListener('scroll',()=>{if(recMore&&!recBusy&&list.scrollTop+list.clientHeight>=list.scrollHeight-180)sugestoes()},{passive:true});
  if($('suggestionsMore'))$('suggestionsMore').onclick=()=>sugestoes();
 }
 async function carregarPerfil(){const a=UK.auth();if(!a){set('profileMessage','Entre na Uti Like para registrar um pedido. Os produtos continuam visíveis na sacola.');set('operationStatus','Confira os produtos; faça login antes de registrar o pedido.');if($('checkoutLoginLink'))$('checkoutLoginLink').hidden=false;return}
  try{const d=await UK.api('/api/checkout-uk/perfil');modoTeste=d.modoTeste===true;profile=d.perfil;
   const p=d.perfil||{},address=d.endereco||{};
   for(const id of ['destinatario','cep','logradouro','numero','complemento','bairro','cidade','uf'])if($(id)&&!$(id).value)$(id).value=address[id]||(id==='destinatario'?p.nome:'')||'';
   for(const [id,val] of [['contatoNome',p.nome],['contatoEmail',p.email],['contatoTelefone',p.telefone]])if($(id)&&!$(id).value)$(id).value=val||'';
   set('profileMessage','Conta conectada: '+(p.nome||p.usuario)+' ('+(p.perfil||'comprador')+'). Confira o endereço e contato.');
   if(!modoTeste)set('testInfo','Rascunhos desativados no servidor. Nenhuma cobrança está habilitada.');
  }catch(e){set('profileMessage','Conta identificada, mas dados do perfil indisponíveis: '+e.message);status('Verifique a migration 009 e a rota de perfil: '+e.message,true)}
  updateAmounts();
 }
 function uuid(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
 function endereco(){return Object.fromEntries(['destinatario','cep','logradouro','numero','complemento','bairro','cidade','uf'].map(k=>[k,($(k)?.value||'').trim()]))}
 async function salvarRascunho(){if(working||!modoTeste||!quote?.itens?.length||quote.indisponiveis)return;
  const e=endereco(),contact={nome:$('contatoNome').value.trim(),email:$('contatoEmail').value.trim(),telefone:$('contatoTelefone').value.trim()};
  if(!/^\d{8}$/.test(e.cep.replace(/\D/g,''))||!/^[a-zA-Z]{2}$/.test(e.uf)||[e.destinatario,e.logradouro,e.numero,e.bairro,e.cidade].some(x=>!x))return status('Preencha todos os campos obrigatórios do endereço.',true);
  if(!contact.nome||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.email)||contact.telefone.replace(/\D/g,'').length<10)return status('Informe nome, e-mail e telefone válidos.',true);
  if(!draftKey)draftKey=uuid();working=true;updateAmounts();
  try{const data=await UK.api('/api/checkout-uk/pedido-teste',{method:'POST',body:JSON.stringify({adicionais:currentItems(),chaveIdempotencia:draftKey,endereco:e,contato:contact,metodo:method})});
   const receipt=$('modalReceipt');receipt.replaceChildren(node('p','','Número do pedido de homologação: '+data.id),node('p','','Rascunho — SEM cobrança ou compra real.'));
   $('demoModal').classList.add('open');status('Rascunho criado. Nenhuma cobrança foi efetuada.');
  }catch(err){status(err.message,true);toast(err.message,true)}finally{working=false;updateAmounts()}
 }
 function eventos(){document.querySelectorAll('[data-method]').forEach(btn=>btn.addEventListener('click',()=>{method=btn.dataset.method;document.querySelectorAll('[data-method]').forEach(el=>{const active=el===btn;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active))});set('paymentView',method==='pix'?'Pix selecionado. Pagamento em preparação.':method==='credito'?'Cartão de crédito selecionado. Parcelamento será informado pelo gateway em etapa própria.':'Débito selecionado. Dados de cartão serão coletados pelo provedor seguro.')}));
  $('finishBtn').onclick=()=>status('Pagamento indisponível até integrar o gateway e validar o webhook.');$('mobileFinish').onclick=()=>status('Pagamento indisponível até integrar o gateway e validar o webhook.');
  $('closeModal').onclick=()=>$('demoModal').classList.remove('open');$('demoModal').onclick=e=>{if(e.target===$('demoModal'))$('demoModal').classList.remove('open')};
  $('cep').addEventListener('input',e=>{const s=e.target.value.replace(/\D/g,'').slice(0,8);e.target.value=s.length>5?s.slice(0,5)+'-'+s.slice(5):s});$('uf').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2));
  window.addEventListener('uk:sacola-alterada',()=>{draftKey=''});
  window.addEventListener('storage',e=>{if(e.key?.startsWith('uk_sacola_atual_v2:'))reload(true)});
 }
 async function init(){await UK.ready;await UK.sincronizarSacola();organizarMobile();initSuggestionScroll();eventos();
  try{await transferirOrigemLegada()}catch(e){status('Não foi possível transferir itens do carrinho: '+e.message,true)}
  await reload(true);await carregarPerfil();updateAmounts();
 }
 init().catch(e=>{showEmpty('Falha ao iniciar: '+e.message);status(e.message,true)});
})();
