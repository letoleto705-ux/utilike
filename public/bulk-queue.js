(()=>{'use strict';const $=id=>document.getElementById(id);function token(){try{return JSON.parse(sessionStorage.getItem('utilike_auth_session')||'null')?.token||''}catch{return ''}}
async function excluir(id, label){
  const isAll=id===null;
  const msg=isAll
    ?'ATENÇÃO: excluir DEFINITIVAMENTE todas as URLs importadas, suas imagens, preços e produtos vinculados na vitrine? O catálogo cadastrado manualmente será preservado.'
    :'Excluir DEFINITIVAMENTE o registro '+id+' ('+label+') do Neon, incluindo imagens, preços e produto publicado na vitrine?';
  if(!window.confirm(msg))return;
  const required=isAll?'EXCLUIR TODOS':'EXCLUIR';
  if(window.prompt('Digite exatamente '+required+' para confirmar:')!==required)return;
  try{
    const t=token();if(!t)throw Error('Faça login como administrador.');
    const url=isAll?'/api/admin/importacao/excluir-todos':'/api/admin/importacao/produto/'+encodeURIComponent(id);
    const response=await fetch(url,{method:isAll?'POST':'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({confirmacao:required})});
    const result=await response.json();if(!response.ok)throw Error(result.erro||'Falha na exclusão');
    window.alert(result.excluidos+' registro(s) excluído(s) do Neon; '+result.removidosDaVitrine+' produto(s) retirado(s) da vitrine.');
    document.dispatchEvent(new CustomEvent('utilike:produto-excluido',{detail:{id}}));
    await refresh();
  }catch(e){window.alert('Exclusão não concluída: '+e.message)}
}
async function refresh(){try{const t=token();if(!t)throw Error('Faça login como administrador no index.html nesta aba.');const r=await fetch('/api/admin/importacao/fila',{headers:{Authorization:'Bearer '+t},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.erro||'Falha ao consultar');$('bulkSummary').textContent=(d.resumo.map(x=>`${x.status}: ${x.quantidade}`).join(' · ')||'Nenhuma URL cadastrada')+' · Exibindo até 100 registros recentes';const tbody=$('bulkRows');tbody.replaceChildren();for(const item of d.itens){const tr=document.createElement('tr');function cell(value){const td=document.createElement('td');td.textContent=String(value??'—');td.style.overflowWrap='anywhere';tr.append(td);return td}function link(td,url,label){try{const u=new URL(url);if(u.protocol!=='https:')return;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;td.append(a)}catch{}}cell(item.fornecedor);const prod=cell('');link(prod,item.url,'Abrir produto');if(item.status==='revisao'||item.status==='pronto'){const select=document.createElement('button');select.type='button';select.textContent='Selecionar para publicação';select.style.cssText='display:block;margin-top:6px;padding:6px;border-radius:6px';select.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('utilike:selecionar-publicacao',{detail:{id:item.id}})));prod.append(select)}
const del=document.createElement('button');del.type='button';del.textContent='Excluir definitivamente';del.style.cssText='display:block;margin-top:6px;padding:6px;border-radius:6px;color:#991b1b;border:1px solid #991b1b;background:white;cursor:pointer';del.addEventListener('click',()=>excluir(item.id,item.url));prod.append(del);
const pics=cell('');const imagens=Array.isArray(item.imagens)?item.imagens:[];if(!imagens.length)pics.textContent='Nenhuma imagem registrada';else{pics.append(document.createTextNode(imagens.length+' imagem(ns): '));imagens.forEach((im,i)=>{if(i)pics.append(document.createTextNode(' · '));link(pics,im.url,'Imagem '+(i+1))})}if(item.preco_observado!==null&&item.preco_observado!==undefined){const c=document.createElement('small');c.style.display='block';c.textContent='Custo observado: R$ '+Number(item.preco_observado).toFixed(2);pics.append(c)}
const f=document.createElement('small');f.style.display='block';f.textContent=item.frete_status==='frete_gratis_observado'?'Frete grátis observado':item.frete_status==='frete_pago_observado'?'Frete observado: R$ '+Number(item.valor_frete).toFixed(2):'Frete não confirmado';pics.append(f);
cell(item.status);cell(item.atualizado_em?new Date(item.atualizado_em).toLocaleString('pt-BR'):'—');tbody.append(tr)}}catch(e){$('bulkSummary').textContent=e.message}}
async function progress(){try{const t=token();if(!t)return;const r=await fetch('/api/admin/importacao/processamento',{headers:{Authorization:'Bearer '+t},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.erro||'Erro');$('bulkProgress').textContent=`${d.executando?'Em execução':'Parado'} · ${d.processados} processados · ${d.revisao} para revisão · ${d.erros} erros. ${d.mensagem}`;}catch(e){$('bulkProgress').textContent=e.message}}
$('bulkStart')?.addEventListener('click',async()=>{const b=$('bulkStart');b.disabled=true;try{const t=token();if(!t)throw Error('Entre como administrador pela vitrine, na mesma aba.');const r=await fetch('/api/admin/importacao/processar',{method:'POST',headers:{Authorization:'Bearer '+t}});const d=await r.json();if(!r.ok)throw Error(d.erro||'Falha');$('bulkProgress').textContent=d.mensagem||d.motivo;await refresh();await progress()}catch(e){$('bulkProgress').textContent=e.message}finally{b.disabled=false}});
const bulkActions=$('bulkRefresh')?.parentElement;
if(bulkActions){
 const all=document.createElement('button');all.type='button';all.textContent='Excluir todas as URLs de teste';
 all.style.cssText='padding:10px;border-radius:7px;border:1px solid #991b1b;color:#991b1b;background:#fff;cursor:pointer';
 all.addEventListener('click',()=>excluir(null,''));bulkActions.append(all);
}
$('bulkRefresh')?.addEventListener('click',async()=>{await refresh();await progress()});refresh();progress();})();
