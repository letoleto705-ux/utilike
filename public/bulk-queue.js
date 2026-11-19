(()=>{'use strict';const $=id=>document.getElementById(id);function token(){try{return JSON.parse(sessionStorage.getItem('utilike_auth_session')||'null')?.token||''}catch{return ''}}
async function situacao(item,acao){
  const isDelete=acao==='excluir';
  const texto=isDelete?'Excluir DEFINITIVAMENTE esta URL do Neon, suas imagens, seus preços e seu anúncio na vitrine?':acao==='desativar'?'Desativar esta URL? Ela continuará no Neon, mas sairá da vitrine.':'Reativar esta URL e restaurar seu anúncio na vitrine, se já havia sido publicado?';
  if(!window.confirm(texto))return;
  if(isDelete && window.prompt('Digite EXCLUIR para confirmar a remoção definitiva:')!=='EXCLUIR')return;
  try{
    const t=token();if(!t)throw Error('Entre como administrador.');
    const url='/api/admin/importacao/produto/'+encodeURIComponent(item.id)+(isDelete?'':'/'+acao);
    const r=await fetch(url,{method:isDelete?'DELETE':'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(isDelete?{confirmacao:'EXCLUIR'}:{})});
    const d=await r.json();if(!r.ok)throw Error(d.erro||'Falha na operação');
    await refresh();
    document.dispatchEvent(new CustomEvent('utilike:situacao-alterada',{detail:{id:item.id,acao}}));
  }catch(e){window.alert('Operação não concluída: '+e.message)}
}
async function refresh(){try{const t=token();if(!t)throw Error('Faça login como administrador no index.html nesta aba.');const r=await fetch('/api/admin/importacao/fila',{headers:{Authorization:'Bearer '+t},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.erro||'Falha ao consultar');$('bulkSummary').textContent=(d.resumo.map(x=>`${x.status}: ${x.quantidade}`).join(' · ')||'Nenhuma URL cadastrada')+' · Exibindo até 100 registros recentes';const tbody=$('bulkRows');tbody.replaceChildren();for(const item of d.itens){const tr=document.createElement('tr');function cell(value){const td=document.createElement('td');td.textContent=String(value??'—');td.style.overflowWrap='anywhere';tr.append(td);return td}function link(td,url,label){try{const u=new URL(url);if(u.protocol!=='https:')return;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;td.append(a)}catch{}}cell(item.fornecedor);const prod=cell('');link(prod,item.url,'Abrir produto');if(item.status==='revisao'||item.status==='pronto'){const select=document.createElement('button');select.type='button';select.textContent='Selecionar para publicação';select.style.cssText='display:block;margin-top:6px;padding:6px;border-radius:6px';select.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('utilike:selecionar-publicacao',{detail:{id:item.id}})));prod.append(select)}const pics=cell('');const imagens=Array.isArray(item.imagens)?item.imagens:[];if(!imagens.length)pics.textContent='Nenhuma imagem registrada';else{pics.append(document.createTextNode(imagens.length+' imagem(ns): '));imagens.forEach((im,i)=>{if(i)pics.append(document.createTextNode(' · '));link(pics,im.url,'Imagem '+(i+1))})}if(item.preco_observado!==null&&item.preco_observado!==undefined){const c=document.createElement('small');c.style.display='block';c.textContent='Custo observado: R$ '+Number(item.preco_observado).toFixed(2);pics.append(c)}
const f=document.createElement('small');f.style.display='block';f.textContent=item.frete_status==='frete_gratis_observado'?'Frete grátis observado':item.frete_status==='frete_pago_observado'?'Frete observado: R$ '+Number(item.valor_frete).toFixed(2):'Frete não confirmado';pics.append(f);
cell(item.status);
const actionCell=cell('');
const disabled=item.desativado_vitrine===true;
const state=document.createElement('strong');state.textContent=disabled?'Desativado':'Ativo na importação';state.style.display='block';actionCell.append(state);
function action(label,acao,color){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='display:block;margin-top:5px;padding:6px;border-radius:6px;border:1px solid '+color+';color:'+color+';background:white;cursor:pointer';b.addEventListener('click',()=>situacao(item,acao));actionCell.append(b)}
if(disabled)action('Reativar','reativar','#166534');else action('Desativar','desativar','#92400e');
action('Excluir definitivamente','excluir','#991b1b');
cell(item.atualizado_em?new Date(item.atualizado_em).toLocaleString('pt-BR'):'—');tbody.append(tr)}}catch(e){$('bulkSummary').textContent=e.message}}
async function progress(){try{const t=token();if(!t)return;const r=await fetch('/api/admin/importacao/processamento',{headers:{Authorization:'Bearer '+t},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.erro||'Erro');$('bulkProgress').textContent=`${d.executando?'Em execução':'Parado'} · ${d.processados} processados · ${d.revisao} para revisão · ${d.erros} erros. ${d.mensagem}`;}catch(e){$('bulkProgress').textContent=e.message}}
$('bulkStart')?.addEventListener('click',async()=>{const b=$('bulkStart');b.disabled=true;try{const t=token();if(!t)throw Error('Entre como administrador pela vitrine, na mesma aba.');const r=await fetch('/api/admin/importacao/processar',{method:'POST',headers:{Authorization:'Bearer '+t}});const d=await r.json();if(!r.ok)throw Error(d.erro||'Falha');$('bulkProgress').textContent=d.mensagem||d.motivo;await refresh();await progress()}catch(e){$('bulkProgress').textContent=e.message}finally{b.disabled=false}});
$('bulkRefresh')?.addEventListener('click',async()=>{await refresh();await progress()});refresh();progress();})();
