'use strict';
// Carrinho UK = reserva para compras futuras, persistente no Neon e sem expiração automática.
(()=>{
 const $=id=>document.getElementById(id);let items=[],selecionados=new Set(),iniciado=false;
 function status(t,bad=false){$('feedback').textContent=t;$('feedback').className=bad?'error':'note'}
 function totals(){const disponiveis=items.filter(x=>x.disponivel);const sel=disponiveis.filter(x=>selecionados.has(x.id));const qtd=sel.reduce((n,x)=>n+x.quantidade,0);const sum=sel.reduce((n,x)=>n+Number(x.produto?.preco||0)*x.quantidade,0);
  $('selected').textContent=qtd+' item(ns)';$('subtotal').textContent=UK.money(sum);$('total').textContent=UK.money(sum);$('quantity').textContent=items.reduce((s,i)=>s+i.quantidade,0)+' item(ns) guardado(s)';
  $('selectAll').checked=disponiveis.length>0&&disponiveis.every(x=>selecionados.has(x.id));$('goCheckoutBtn').disabled=sel.length===0;
 }
 function render(){const root=$('cartRows');root.replaceChildren();root.className='';
  if(!items.length){root.className='loading';root.textContent='Seu Carrinho UK está vazio. Guarde produtos da vitrine para comprar quando quiser.';totals();return}
  for(const x of items){const row=UK.el('article','cart-row'+(x.disponivel?'':' unavailable')),check=UK.el('input');check.type='checkbox';check.checked=x.disponivel&&selecionados.has(x.id);check.disabled=!x.disponivel;check.setAttribute('aria-label','Selecionar '+(x.produto?.nome||x.produtoId));check.onchange=()=>{check.checked?selecionados.add(x.id):selecionados.delete(x.id);totals()};
   const url=UK.image(x.produto?.imagem),im=url?UK.el('img','cart-image'):UK.el('div','cart-image muted','Sem foto');if(url){im.src=url;im.alt=x.produto.nome;im.loading='lazy';im.referrerPolicy='no-referrer'}
   const info=UK.el('div'),link=UK.el('a','cart-title',x.produto?.nome||'Produto temporariamente indisponível');link.href='produto.html?id='+encodeURIComponent(x.produtoId);info.append(link,UK.el('div','cart-price',x.disponivel&&x.produto?UK.money(x.produto.preco):'Esgotado ou indisponível — permanece guardado'));
   if(x.variacaoId)info.append(UK.el('div','note','Variação: '+x.variacaoId));const right=UK.el('div','cart-actions-cell'),step=UK.el('div','stepper');
   for(const [sym,n] of [['−',-1],['+',1]]){const b=UK.el('button','',sym);b.type='button';b.disabled=x.quantidade+n<1||x.quantidade+n>99;b.onclick=()=>change(x,x.quantidade+n);if(n===-1)step.append(b);else step.append(UK.el('strong','',x.quantidade),b)}
   const rem=UK.el('button','cart-remove','Remover');rem.type='button';rem.onclick=()=>remove(x);right.append(step,rem);row.append(check,im,info,right);root.append(row)
  }totals()
 }
 async function load(){if(!UK.auth()){$('cartRows').replaceChildren();const a=UK.el('a','btn btn-blue','Entrar ou cadastrar');a.href='login.html?retorno=carrinho';$('cartRows').append(UK.el('p','note','Entre com sua conta para visualizar produtos guardados no Neon.'),a);status('O Carrinho UK exige login. A sacola atual pode ser montada durante a navegação.');$('goCheckoutBtn').disabled=true;return}
  try{const r=await UK.api('/api/vitrine/carrinho');items=r.itens||[];const ativos=new Set(items.filter(x=>x.disponivel).map(x=>x.id));selecionados=iniciado?new Set([...selecionados].filter(id=>ativos.has(id))):new Set();iniciado=true;render();status('Seus produtos ficam guardados pelo tempo que desejar, inclusive quando estiverem esgotados.')}catch(e){$('cartRows').textContent='Não foi possível consultar os produtos guardados.';status(e.message,true)}
 }
 async function change(x,n){try{await UK.api('/api/vitrine/carrinho/itens/'+encodeURIComponent(x.id),{method:'PATCH',body:JSON.stringify({quantidade:n})});await load()}catch(e){status(e.message,true)}}
 async function remove(x){if(!confirm('Remover este produto do Carrinho UK?'))return;try{await UK.api('/api/vitrine/carrinho/itens/'+encodeURIComponent(x.id),{method:'DELETE'});selecionados.delete(x.id);await load()}catch(e){status(e.message,true)}}
 $('selectAll').onchange=e=>{selecionados=e.target.checked?new Set(items.filter(x=>x.disponivel).map(x=>x.id)):new Set();render()};
 $('goCheckoutBtn').onclick=async()=>{
  const escolhidos=items.filter(x=>x.disponivel&&selecionados.has(x.id));if(!escolhidos.length)return status('Selecione pelo menos um item disponível.',true);
  // Transferência EXPRESSA para a sacola; os guardados permanecem até exclusão voluntária.
  try{for(const x of escolhidos)await UK.adicionarSacola(x.produtoId,x.variacaoId,x.quantidade)}catch(e){return status('Erro ao transferir para a sacola: '+e.message,true)}
  location.href='checkout.html?origem=sacola';
 };
 $('refresh').onclick=load;UK.bottom('carrinho.html');UK.ready.then(load).catch(e=>status(e.message,true));
})();
