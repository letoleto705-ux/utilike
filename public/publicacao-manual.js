(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('manualPublishForm');if(!form)return;
function token(){try{return JSON.parse(sessionStorage.getItem('utilike_auth_session')||'null')?.token||''}catch{return ''}}
async function request(path,options={}){const t=token();if(!t)throw Error('Faça login como administrador na vitrine, nesta mesma aba.');const r=await fetch(path,{...options,headers:{Authorization:'Bearer '+t,...(options.headers||{})},cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.erro||`Falha HTTP ${r.status}`);return d}
const status=message=>{$('manualPublishStatus').textContent=message};
document.addEventListener('utilike:selecionar-publicacao',async e=>{
 try{
  status('Carregando produto do Neon...');const data=await request('/api/admin/publicacao/candidatos');const item=data.itens.find(x=>String(x.id)===String(e.detail.id));if(!item)throw Error('Produto não encontrado na fila de revisão.');
  $('manualId').value=item.id;$('manualNome').value=item.nome||item.dados_extraidos?.nome||'';$('manualCategoria').value=item.dados_extraidos?.categoria||'Tecnologia';$('manualPreco').value=item.preco??'';$('manualEstoque').value=item.estoque??'';$('manualDescricao').value=item.dados_extraidos?.descricao||'';$('manualConfirmado').checked=false;
  const fotos=Array.isArray(item.imagens)?item.imagens:[];$('manualFotos').textContent=`${fotos.length} imagem(ns) associada(s). Confira os links na fila antes de aprovar.`;
  form.hidden=false;status(`Produto ${item.id} selecionado. Preencha e confirme os dados comerciais.`);$('manualPublishPanel').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){status(err.message)}
});
$('manualCancelar').addEventListener('click',()=>{form.hidden=true;status('Seleção cancelada. Nenhum produto publicado.')});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(!form.reportValidity())return;
 if(!confirm('Publicar este produto na vitrine? Confirme que o preço e o estoque são reais e atuais.'))return;
 const b=$('manualPublicar');b.disabled=true;
 try{const id=$('manualId').value;const body={nome:$('manualNome').value,categoria:$('manualCategoria').value,descricao:$('manualDescricao').value,preco:Number($('manualPreco').value),estoque:Number($('manualEstoque').value),confirmado:$('manualConfirmado').checked};
 const d=await request(`/api/admin/publicacao/${encodeURIComponent(id)}/publicar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 status(`${d.mensagem} Abra a vitrine e atualize a página para conferir.`);form.hidden=true;
 $('bulkRefresh')?.click();
 }catch(err){status('Não foi possível publicar: '+err.message)}finally{b.disabled=false}
});
})();
