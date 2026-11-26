'use strict';
(()=>{
 const paramsProduto=new URLSearchParams(location.search);
 const indicadorProduto=paramsProduto.get('afiliado')||((paramsProduto.get('ref')||'')==='admin'?'admin':'');
 if(indicadorProduto)UK.api('/api/uk/referencia',{method:'POST',body:JSON.stringify({afiliado:indicadorProduto,origem:'produto'})}).catch(e=>console.warn('Referência não validada:',e.message));
 const $=id=>document.getElementById(id),id=(paramsProduto.get('id')||'').trim();let product=null,media=[],current=0,selectedVariant='',recPage=0,recBusy=false,recMore=true,recObserver=null;const recSeen=new Set();
 const recOrdem=UK.novaOrdem(),recPrimeiroChave='uk_vitrine_extra_primeiro_v1:'+id;
 let recEvitarPrimeiro='';try{recEvitarPrimeiro=sessionStorage.getItem(recPrimeiroChave)||''}catch{}
 const txt=(id,s)=>$(id).textContent=String(s??'');
function renderCopyPrincipal(p){
  // A IA escreve somente a copy. O preco vem da API atual, nunca fica gravado no texto.
  const caixa=$('productName');
  const original=String(p.nome||p.name||'Produto Uti Like');
  const copy=String(p.copyUtiLike||'').trim();
  caixa.replaceChildren();
  caixa.classList.toggle('copy-comercial',Boolean(copy));
  if(!copy){caixa.textContent=original;return}
  const re=/(Uti\s+Like)/gi;
  let inicio=0,resultado;
  while((resultado=re.exec(copy))!==null){
    if(resultado.index>inicio)caixa.append(document.createTextNode(copy.slice(inicio,resultado.index)));
    const marca=document.createElement('strong');marca.className='copy-marca';marca.textContent=resultado[0];
    caixa.append(marca);inicio=re.lastIndex;
  }
  if(inicio<copy.length)caixa.append(document.createTextNode(copy.slice(inicio)));
  const preco=Number(p.precoPor??p.preco??p.price);
  if(Number.isFinite(preco)&&preco>0){
    const frase=document.createElement('span');frase.className='copy-preco-frase';
    frase.append(document.createTextNode('E tudo isso por apenas '));
    const valor=document.createElement('strong');valor.className='copy-preco-atual';
    valor.textContent=UK.money(preco);frase.append(valor);caixa.append(frase);
  }
}

 function message(s,err=false){$('message').textContent=s;$('message').className='detail-message '+(err?'error':'success')}
 function medias(p){const arr=[p.imagem,p.image,...(Array.isArray(p.imagens)?p.imagens:[])];
 // Fotos estruturadas que venham dentro da descrição do fornecedor são tratadas como mídia,
 // nunca como HTML executável. Somente URLs web seguras são aceitas.
 const desc=String(p.descricao_ptbr||p.descricao||p.desc||'');
 if(desc.includes('<')){try{const doc=new DOMParser().parseFromString(desc,'text/html');doc.querySelectorAll('img[src]').forEach(im=>{if(arr.length<50)arr.push(im.getAttribute('src'))})}catch{}}
 const imageUrls=[];for(const x of arr){const u=UK.image(typeof x==='string'?x:x?.url||x?.imagem||'');if(u&&!imageUrls.includes(u))imageUrls.push(u)}const vids=[...(Array.isArray(p.videos)?p.videos:[]),p.urlVideo,p.url_video];const videoUrls=[];for(const x of vids){const u=UK.image(typeof x==='string'?x:x?.url||'');if(u&&!videoUrls.includes(u))videoUrls.push(u)}return [...imageUrls.map(url=>({url,type:'image'})),...videoUrls.slice(0,5).map(url=>({url,type:/\.(mp4|webm)(?:\?|$)/i.test(url)?'video':'link'}))].slice(0,20)}
 function show(i){if(!media.length){$('mediaFrame').querySelectorAll('img,video,.media-placeholder').forEach(n=>n.remove());$('mediaFrame').prepend(UK.el('div','media-placeholder muted','Foto indisponível'));txt('mediaCount','Sem mídia');return}current=(i+media.length)%media.length;const frame=$('mediaFrame');frame.querySelectorAll('img,video,.media-placeholder').forEach(n=>n.remove());const m=media[current];let x;if(m.type==='image'){x=UK.el('img');x.alt=String(product.nome||product.name);x.referrerPolicy='no-referrer';x.src=m.url;x.onerror=()=>{if(media.length>1)show(current+1);else{media=[];show(0)}}}else if(m.type==='video'){x=UK.el('video');x.controls=true;x.playsInline=true;x.preload='metadata';x.src=m.url;}else{x=UK.el('a','media-placeholder','Abrir vídeo do fornecedor');x.href=m.url;x.rel='noopener noreferrer';x.target='_blank';}frame.prepend(x);txt('mediaCount',`${current+1}/${media.length}`);[...$('thumbs').children].forEach((t,k)=>t.classList.toggle('active',k===current))}
 function mediaGallery(p){media=medias(p);const wrap=$('thumbs');wrap.replaceChildren();media.forEach((m,i)=>{const b=UK.el('button');b.type='button';b.setAttribute('aria-label',m.type==='image'?`Ver foto ${i+1}`:`Ver vídeo ${i+1}`);if(m.type==='image'){const img=UK.el('img');img.loading='lazy';img.referrerPolicy='no-referrer';img.src=m.url;img.alt='Miniatura '+(i+1);b.append(img)}else b.textContent='▶ Vídeo';b.onclick=()=>show(i);wrap.append(b)});show(0)}
 function variations(p){const arr=Array.isArray(p.variantes)?p.variantes:[];if(!arr.length)return;$('variations').classList.remove('hidden');const wrap=$('variantButtons');arr.slice(0,50).forEach(v=>{const val=String(v.id??v.vid??'');if(!val)return;const b=UK.el('button','',String(v.nome||v.name||v.sku||val));b.type='button';b.onclick=()=>{selectedVariant=val;[...wrap.children].forEach(x=>x.classList.toggle('active',x===b));message('Opção selecionada. Confira os detalhes antes de adicionar.')};wrap.append(b)})}
 function qty(){const n=Number($('quantity').value);if(!Number.isInteger(n)||n<1||n>99){message('Informe uma quantidade de 1 a 99.',true);return null}if(Array.isArray(product.variantes)&&product.variantes.length&&!selectedVariant){message('Selecione primeiro uma variação.',true);return null}return n}
 async function guardar(){if(!product)return;const n=qty();if(n===null)return;try{await UK.guardarCarrinho(product.id,selectedVariant,n);message('Produto guardado no Carrinho UK pelo tempo que desejar.')}catch(e){message(e.message,true)}}
 async function adicionarSacola(){if(!product)return;const n=qty();if(n===null)return;try{await UK.adicionarSacola(product.id,selectedVariant,n);message('🛍️ Produto adicionado à Sacola da compra atual. Continue navegando.')}catch(e){message(e.message,true)}}
 async function comprarAgora(){if(!product)return;const n=qty();if(n===null)return;try{await UK.comprarAgora(product.id,selectedVariant,n)}catch(e){message(e.message,true)}}
 async function updateCount(){return UK.refreshCartCount()}
 async function loadRecPage(first=false){
  if(recBusy||(!recMore&&!first))return;recBusy=true;
  const button=$('recommendLoadMore'),status=$('recommendFeedStatus');button.disabled=true;status.textContent='Carregando produtos da categoria...';
  try{
   const page=first?1:recPage+1;
   const d=await UK.api('/api/vitrine/recomendacoes/'+encodeURIComponent(id)+'?pagina='+page+'&limite=16&ordem='+recOrdem+'&evitarPrimeiro='+encodeURIComponent(recEvitarPrimeiro));
   const rows=Array.isArray(d.itens)?d.itens:[];
   if(first){$('recommendations').replaceChildren();recSeen.clear();$('recommendCategory').textContent='Mais produtos de '+String(d.categoria||product.categoria||'esta categoria')+' · catálogo Uti Like';try{if(rows[0]?.id)sessionStorage.setItem(recPrimeiroChave,String(rows[0].id))}catch{}}
   let added=0;for(const p of rows){if(!p.id||recSeen.has(String(p.id)))continue;recSeen.add(String(p.id));$('recommendations').append(UK.card(p));added++}
   recPage=d.pagina||page;recMore=d.temMais===true;
   button.hidden=!recMore;button.disabled=false;
   status.textContent=recMore?'Role para ver mais produtos desta categoria.':recSeen.size?'Você já viu todos os produtos disponíveis desta categoria.':'Ainda não há produtos desta categoria.';
  }catch(e){button.hidden=false;button.disabled=false;status.textContent='Não foi possível carregar mais produtos. Toque em Carregar mais para tentar novamente.'}
  finally{recBusy=false}
 }
 function initRecScroll(){if(!('IntersectionObserver' in window))return;recObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&recMore&&!recBusy&&recPage>0)loadRecPage()}, {rootMargin:'360px 0px'});recObserver.observe($('recommendSentinel'))}
 $('recommendLoadMore').addEventListener('click',()=>loadRecPage());
 initRecScroll();
 async function load(){if(!id||id.length>250){$('loading').textContent='Produto inválido.';return}try{product=await UK.api('/api/vitrine/produtos/'+encodeURIComponent(id));if(!product||!product.id)throw Error('Produto não disponível.');document.title=String(product.nome||product.name)+' | Uti Like';txt('crumb',String(product.nome||product.name).slice(0,85));renderCopyPrincipal(product);txt('category',product.categoria||product.category||'Produtos');txt('price',UK.money(product.precoPor??product.preco??product.price));const old=Number(product.precoDe||0),price=Number(product.precoPor??product.preco??product.price);txt('oldPrice',old>price?'De '+UK.money(old):'');txt('sku',product.sku?'Referência: '+product.sku:'');txt('stock',product.estoque!=null&&Number(product.estoque)>0?'Quantidade informada: '+product.estoque:'Disponibilidade a confirmar');const tags=$('tags');if(old>price)tags.append(UK.el('span','','Preço promocional informado'));if(product.estoqueBrasil===true||product.envioBrasil===true)tags.append(UK.el('span','','Origem de envio informada: Brasil'));mediaGallery(product);variations(product);const description=String(product.descricao_ptbr||product.descricao||product.desc||'').trim();let plain=description;try{plain=new DOMParser().parseFromString(description,'text/html').body.textContent||description}catch{}txt('description',plain||'Descrição detalhada ainda não disponibilizada para este produto.');const specs=product.especificacoes&&typeof product.especificacoes==='object'?product.especificacoes:null;txt('specifications',specs?Object.entries(specs).slice(0,60).map(([k,v])=>k+': '+String(v)).join('\n'):'O fornecedor ainda não disponibilizou especificações estruturadas.');const reviews=Array.isArray(product.avaliacoes)?product.avaliacoes:[];txt('reviews',reviews.length?reviews.filter(x=>x?.comentario).map(x=>String(x.comentario).slice(0,300)).join('\n\n'):'Ainda não há avaliações verificadas disponíveis para este produto.');$('loading').classList.add('hidden');$('view').classList.remove('hidden');$('details').classList.remove('hidden');document.querySelectorAll('.add-cart').forEach(b=>b.onclick=guardar);document.querySelectorAll('.add-bag').forEach(b=>b.onclick=adicionarSacola);document.querySelectorAll('.buy-now').forEach(b=>b.onclick=comprarAgora);updateCount();try{localStorage.setItem('uk_ultimo_produto_visto_v1',String(product.id))}catch{}await loadRecPage(true);}catch(e){$('loading').textContent=e.message||'Não foi possível carregar o produto.';}}
 $('prevMedia').onclick=()=>show(current-1);$('nextMedia').onclick=()=>show(current+1);$('favorite').onclick=async()=>{if(!UK.auth())return message('Entre na Uti Like para favoritar este produto.',true);try{await UK.api('/api/vitrine/favoritos',{method:'POST',body:JSON.stringify({produtoId:id})});message('Adicionado aos favoritos da sua conta.')}catch(e){message(e.message,true)}};
 $('share').onclick=async()=>{try{if(navigator.share)await navigator.share({title:document.title,url:location.href});else{await navigator.clipboard.writeText(location.href);message('Link copiado.')}}catch{}};
 $('tabs').addEventListener('click',e=>{const btn=e.target.closest('[data-tab]');if(!btn)return;for(const b of $('tabs').children)b.classList.toggle('active',b===btn);for(const [key,node] of [['descricao','description'],['especificacoes','specifications'],['avaliacoes','reviews']])$(node).classList.toggle('hidden',key!==btn.dataset.tab)});
 UK.bottom('');UK.ready.then(load).catch(e=>{document.getElementById('loading').textContent=e.message});
})();
