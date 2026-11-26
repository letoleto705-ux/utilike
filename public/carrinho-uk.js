'use strict';
// Carrinho UK = reserva para compras futuras, persistente no Neon e sem expiração automática.
(()=>{
 const $=id=>document.getElementById(id);let items=[],selecionados=new Set(),iniciado=false;
 const cartLayoutStyle=document.createElement('style');cartLayoutStyle.textContent='.cart-media{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0}.cart-media .cart-image{display:block}.cart-media .cart-price{display:block;text-align:center;margin:0;white-space:normal}';document.head.append(cartLayoutStyle);
 function localTestItem(){const x=UK.carrinhoTeste();return x?{id:'local:produto-teste',produtoId:'produto-teste',variacaoId:'',quantidade:x.quantidade,disponivel:true,produto:UK.produtoTeste()}:null}
 function renderMirror(){if($('cartMirror'))return;const style=document.createElement('style');style.textContent='.cart-mirror{margin:18px 0}.cart-mirror-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;max-height:520px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.cart-mirror-grid .recommend-card{min-width:0}@media(max-width:850px){.cart-mirror-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){.cart-mirror-grid{grid-template-columns:1fr}}';document.head.append(style);const section=UK.el('section','section-card cart-mirror');section.id='cartMirror';section.setAttribute('aria-labelledby','cartMirrorTitle');const title=UK.el('div','section-title'),h=UK.el('h2','', 'Adicione mais produtos ao seu carrinho'),sub=UK.el('span','muted','Você também pode gostar'),grid=UK.el('div','cart-mirror-grid');grid.id='cartRecommendations';title.append(h,sub);section.append(title,grid);document.querySelector('main').append(section);UK.catalogoCompleto().then(products=>{const ids=new Set(items.map(x=>String(x.produtoId)));for(const p of products){if(ids.has(String(p.id))||String(p.id)==='produto-teste')continue;grid.append(UK.card(p))}if(!grid.children.length)grid.append(UK.el('p','note','Nenhuma sugestão disponível no momento.'))}).catch(()=>{grid.append(UK.el('p','note','Não foi possível carregar sugestões agora.'))})}
 function status(t,bad=false){$('feedback').textContent=t;$('feedback').className=bad?'error':'note'}
 function totals(){const disponiveis=items.filter(x=>x.disponivel);const sel=disponiveis.filter(x=>selecionados.has(x.id));const qtd=sel.reduce((n,x)=>n+x.quantidade,0);const sum=sel.reduce((n,x)=>n+Number(x.produto?.preco||0)*x.quantidade,0);
  $('selected').textContent=qtd+' item(ns)';$('subtotal').textContent=UK.money(sum);$('total').textContent=UK.money(sum);$('quantity').textContent=items.reduce((s,i)=>s+i.quantidade,0)+' item(ns) guardado(s)';
  $('selectAll').checked=disponiveis.length>0&&disponiveis.every(x=>selecionados.has(x.id));$('goCheckoutBtn').disabled=sel.length===0;
 }
 function render(){const root=$('cartRows');root.replaceChildren();root.className='';
  if(!items.length){root.className='loading';root.textContent='Seu Carrinho UK está vazio. Guarde produtos da vitrine para comprar quando quiser.';totals();return}
  for(const x of items){const row=UK.el('article','cart-row'+(x.disponivel?'':' unavailable')),check=UK.el('input');check.type='checkbox';check.checked=x.disponivel&&selecionados.has(x.id);check.disabled=!x.disponivel;check.setAttribute('aria-label','Selecionar '+(x.produto?.nome||x.produtoId));check.onchange=()=>{check.checked?selecionados.add(x.id):selecionados.delete(x.id);totals()};
   const url=UK.image(x.produto?.imagem),im=url?UK.el('img','cart-image'):UK.el('div','cart-image muted','Sem foto');if(url){im.src=url;im.alt=x.produto.nome;im.loading='lazy';im.referrerPolicy='no-referrer'}
   const info=UK.el('div'),link=UK.el('a','cart-title',x.produto?.nome||'Produto temporariamente indisponível');link.href=UK.contextHref('produto.html?id='+encodeURIComponent(x.produtoId));info.append(link,UK.el('div','cart-price',x.disponivel&&x.produto?UK.money(x.produto.preco):'Esgotado ou indisponível — permanece guardado'));
   if(x.variacaoId)info.append(UK.el('div','note','Variação: '+x.variacaoId));const right=UK.el('div','cart-actions-cell'),step=UK.el('div','stepper');
   for(const [sym,n] of [['−',-1],['+',1]]){const b=UK.el('button','',sym);b.type='button';b.disabled=x.quantidade+n<1||x.quantidade+n>99;b.onclick=()=>change(x,x.quantidade+n);if(n===-1)step.append(b);else step.append(UK.el('strong','',x.quantidade),b)}
   const rem=UK.el('button','cart-remove','Remover');rem.type='button';rem.onclick=()=>remove(x);right.append(step,rem);const media=UK.el('div','cart-media');row.insertBefore(media,info);media.append(im,info.querySelector('.cart-price'));row.append(check,media,info,right);root.append(row)
  }totals()
 }
 async function load(){if(!UK.auth()){$('cartRows').replaceChildren();const a=UK.el('a','btn btn-blue','Entrar ou cadastrar');a.href=UK.contextHref('login.html?retorno=carrinho');$('cartRows').append(UK.el('p','note','Entre com sua conta para visualizar produtos guardados no Neon.'),a);status('O Carrinho UK exige login. A sacola atual pode ser montada durante a navegação.');$('goCheckoutBtn').disabled=true;return}
  try{const r=await UK.api('/api/vitrine/carrinho');items=r.itens||[];const test=localTestItem();if(test)items.push(test);const ativos=new Set(items.filter(x=>x.disponivel).map(x=>x.id));selecionados=iniciado?new Set([...selecionados].filter(id=>ativos.has(id))):new Set(items.filter(x=>x.disponivel).map(x=>x.id));iniciado=true;render();renderMirror();status('Seus produtos ficam guardados pelo tempo que desejar, inclusive quando estiverem esgotados.')}catch(e){$('cartRows').textContent='Não foi possível consultar os produtos guardados.';status(e.message,true)}
 }
 async function change(x,n){try{if(String(x.id).startsWith('local:'))await UK.alterarCarrinhoTeste(n);else await UK.api('/api/vitrine/carrinho/itens/'+encodeURIComponent(x.id),{method:'PATCH',body:JSON.stringify({quantidade:n})});await load()}catch(e){status(e.message,true)}}
 async function remove(x){if(!confirm('Remover este produto do Carrinho UK?'))return;try{if(String(x.id).startsWith('local:'))await UK.removerCarrinhoTeste();else await UK.api('/api/vitrine/carrinho/itens/'+encodeURIComponent(x.id),{method:'DELETE'});selecionados.delete(x.id);await load()}catch(e){status(e.message,true)}}
 $('selectAll').onchange=e=>{selecionados=e.target.checked?new Set(items.filter(x=>x.disponivel).map(x=>x.id)):new Set();render()};
 $('goCheckoutBtn').onclick=async()=>{
  const escolhidos=items.filter(x=>x.disponivel&&selecionados.has(x.id));if(!escolhidos.length)return status('Selecione pelo menos um item disponível.',true);
  // Transferência EXPRESSA para a sacola; os guardados permanecem até exclusão voluntária.
  try{sessionStorage.setItem('uk_checkout_selecao_itens',JSON.stringify(escolhidos.map(x=>String(x.produtoId))))}catch{};
  location.href=UK.contextHref('checkout.html?origem=carrinho');
 };
 $('refresh').onclick=load;UK.bottom('carrinho.html');UK.ready.then(load).catch(e=>status(e.message,true));
})();
