'use strict';(async()=>{
 const $=id=>document.getElementById(id),money=n=>UK.money(n),status=(m,bad=false)=>{$('feedback').textContent=m;$('feedback').className='status'+(bad?' error':'')};let selectedUser=null;
 const box=(title,text)=>{const e=UK.el('div','entry');e.append(UK.el('strong','',title),UK.el('span','tiny muted',text));return e};
 async function load(){const [rede,aff,coupons,notices]=await Promise.all([UK.api('/api/rede'),UK.api('/api/afiliados'),UK.api('/api/admin/cupons'),UK.api('/api/admin/notificacoes')]);
  const list=Array.isArray(aff)?aff:aff.afiliados||[];const r=rede.resumo||{};
  $('financial').replaceChildren(box('Afiliados cadastrados',String(list.length)),box('Vendas pagas',String(r.vendasPagas??0)),box('Total a distribuir',money(r.totalADistribuir??0)));
  $('affiliates').replaceChildren();if(!list.length)$('affiliates').textContent='Nenhum afiliado cadastrado.';
  for(const a of list){const e=box(a.nome||a.usuario,'@'+a.usuario+' · Pendente: '+money(a.comissaoPendente||0)+' · Liberável: '+money(a.comissaoLiberar||0));const v=Number(a.comissaoLiberar||0),min=Number(rede.valorMinimoSaque||50);if(v>=min&&v>0){const b=UK.el('button','alt','Confirmar baixa de Pix já realizado');b.onclick=async()=>{if(!confirm('Você já transferiu o Pix, conferiu o comprovante e deseja dar baixa na comissão de '+a.usuario+'?'))return;try{const result=await UK.api('/api/admin/afiliados/'+encodeURIComponent(a.id)+'/pagar',{method:'POST'});status('Baixa registrada: '+money(result.valorPago||0));await load()}catch(err){status(err.message,true)}};e.append(b)}$('affiliates').append(e)}
  $('couponActive').checked=!!coupons.ativo;$('couponPercent').value=coupons.percentualMaximo??0;
  $('coupons').replaceChildren();for(const c of (coupons.afiliados||[]))$('coupons').append(box(c.nome||c.usuario,c.codigo||'Sem cupom'));
  $('notices').replaceChildren();for(const n of notices.slice(0,20))$('notices').append(box(n.titulo,n.mensagem));status('Painel de gerência conectado ao servidor.');
 }
 try{await UK.ready;if(UK.auth()?.user?.perfil!=='admin'){status('Acesso restrito. Entre como administrador.',true);return}
 $('dashboard').hidden=false;await load();$('refresh').onclick=()=>load().catch(e=>status(e.message,true));
 $('searchAccount').onsubmit=async e=>{e.preventDefault();selectedUser=new FormData(e.currentTarget).get('usuario')?.trim().toLowerCase()||'';$('issueCode').disabled=true;$('issuedCode').hidden=true;try{const d=await UK.api('/api/uk/recovery-status?usuario='+encodeURIComponent(selectedUser));$('maskedAccount').textContent='Nome: '+d.nome+' · E-mail: '+d.email+' · Telefone: '+d.telefone;$('issueCode').disabled=false}catch(err){$('maskedAccount').textContent=err.message}};
 $('issueCode').onclick=async()=>{if(!selectedUser)return;if(!confirm('Confirma que verificou a identidade do titular usando o contato previamente cadastrado?'))return;try{const d=await UK.api('/api/uk/recuperacao/emitir',{method:'POST',body:JSON.stringify({usuario:selectedUser,identidadeConfirmada:true})});$('secretCode').textContent=d.codigo;$('issuedCode').hidden=false;status('Código gerado. Validade: 60 minutos, utilização única.')}catch(err){status(err.message,true)}};
 $('couponForm').onsubmit=async e=>{e.preventDefault();try{await UK.api('/api/admin/cupons/config',{method:'PUT',body:JSON.stringify({ativo:$('couponActive').checked,percentualMaximo:Number($('couponPercent').value)})});await load()}catch(err){status(err.message,true)}};
 $('noticeForm').onsubmit=async e=>{e.preventDefault();try{await UK.api('/api/admin/notificacoes',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();await load()}catch(err){status(err.message,true)}};
 }catch(e){status('Falha de integração: '+e.message,true)}
})();
