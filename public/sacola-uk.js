'use strict';
// Sacola UK = compra atual; checkout sempre confere precos novamente no Neon.
(()=>{
 const $=id=>document.getElementById(id);let items=[],resumos=new Map();
 function status(s,erro=false){$('feedback').textContent=s;$('feedback').className=erro?'error':'note'}
 function atualizaTotal(){let qtd=0,total=0,ativos=0;
  for(const x of items){const p=resumos.get(x.produtoId);if(!p||p.disponivel===false)continue;const valor=Number(p.precoPor??p.preco??p.price);if(!(valor>0))continue;qtd+=x.quantidade;total+=valor*x.quantidade;ativos++}
  $('quantity').textContent=items.reduce((s,x)=>s+x.quantidade,0)+' item(ns)';$('selected').textContent=qtd;
  $('subtotal').textContent=UK.money(total);$('total').textContent=UK.money(total);
  $('goCheckoutBtn').disabled=ativos===0;
 }
 function render(){items=UK.sacola();const root=$('bagRows');root.replaceChildren();root.className='';
  if(!items.length){root.className='bag-empty';root.textContent='Sua sacola está vazia. Adicione produtos na vitrine ou na página de detalhes.';atualizaTotal();return}
  for(const x of items){const p=resumos.get(x.produtoId),row=UK.el('article','bag-row');const u=UK.image(p?.imagem||p?.image);
   if(u){const im=UK.el('img','bag-image');im.src=u;im.loading='lazy';im.alt=String(p?.nome||'Produto');im.referrerPolicy='no-referrer';row.append(im)}else row.append(UK.el('div','bag-image','Sem foto'));
   const info=UK.el('div'),name=UK.el('a','bag-title',p?.nome||'Produto indisponível no catálogo atual');name.href=UK.contextHref('produto.html?id='+encodeURIComponent(x.produtoId));info.append(name);
   if(x.variacaoId)info.append(UK.el('div','bag-variant','Variação: '+x.variacaoId));
   if(p&&p.disponivel!==false)info.append(UK.el('div','bag-price',UK.money(p.precoPor??p.preco??p.price)));
   else info.append(UK.el('div','bag-status','Produto indisponível no momento; não será apagado automaticamente.'));
   row.append(info);const actions=UK.el('div','bag-actions'),step=UK.el('div','bag-stepper');
   const minus=UK.el('button','','−'),plus=UK.el('button','','+'),number=UK.el('strong','',String(x.quantidade));
   minus.type=plus.type='button';minus.disabled=x.quantidade<=1;plus.disabled=x.quantidade>=99;
   minus.onclick=async()=>{try{await UK.atualizarSacola(x.produtoId,x.variacaoId,x.quantidade-1);await load()}catch(e){status(e.message,true)}};
   plus.onclick=async()=>{try{await UK.atualizarSacola(x.produtoId,x.variacaoId,x.quantidade+1);await load()}catch(e){status(e.message,true)}};
   step.append(minus,number,plus);const remove=UK.el('button','bag-remove','Remover');remove.type='button';remove.onclick=async()=>{try{await UK.removerSacola(x.produtoId,x.variacaoId);await load()}catch(e){status(e.message,true)}};
   actions.append(step,remove);row.append(actions);root.append(row)
  }
  atualizaTotal()
 }
 async function load(){await UK.sincronizarSacola();items=UK.sacola();if(!items.length){render();status('Nenhum item na sacola.');return}
  try{const d=await UK.api('/api/vitrine/produtos/resumo',{method:'POST',body:JSON.stringify({ids:[...new Set(items.map(x=>x.produtoId))]})});resumos=new Map((d.itens||[]).map(p=>[String(p.id),p]));render();status('Produtos carregados. O checkout confirmará os preços e o estoque antes da compra.')}
  catch(e){resumos.clear();render();status('Não foi possível consultar o catálogo: '+e.message,true)}
 }
 $('goCheckoutBtn').onclick=()=>{if(!UK.sacola().length)return;location.href=UK.contextHref('checkout.html?origem=sacola')};
 UK.bottom('sacola.html');UK.ready.then(load).catch(e=>status(e.message,true));
 window.addEventListener('uk:sacola-alterada',()=>{items=UK.sacola();render()});
})();
