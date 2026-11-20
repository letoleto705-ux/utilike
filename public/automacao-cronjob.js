(()=>{'use strict';
const $=id=>document.getElementById(id);
function token(){try{return JSON.parse(sessionStorage.getItem('utilike_auth_session')||'null')?.token||''}catch{return ''}}
async function api(path,options={}){const t=token();if(!t)throw Error('Entre como administrador na vitrine, nesta aba.');const r=await fetch('/api/admin/automacao'+path,{...options,headers:{Authorization:'Bearer '+t,...(options.headers||{})},cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.erro||'HTTP '+r.status);return d}
const msg=x=>{$('autoMensagem').textContent=x};
let loading=false;
async function load(){try{const c=await api('/config');$('autoAtivo').checked=c.ativo;$('autoIntervalo').value=String(c.intervalo);$('autoMargem').value=c.margem;$('autoFrete').value=c.frete;$('autoReserva').value=c.reserva;msg('Configuração carregada. '+(c.ativo?'Próxima execução: '+(c.proximaExecucao?new Date(c.proximaExecucao).toLocaleString('pt-BR'):'em breve'):'Agendamento desligado.'));}catch(e){msg(e.message)}}
$('autoSalvar').onclick=async()=>{try{const cfg={ativo:$('autoAtivo').checked,intervalo:Number($('autoIntervalo').value),margem:Number($('autoMargem').value),frete:Number($('autoFrete').value),reserva:Number($('autoReserva').value)};await api('/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});msg('Configuração salva no Neon.')}catch(e){msg(e.message)}};
$('autoAgora').onclick=async()=>{try{const d=await api('/executar-agora',{method:'POST'});msg(d.mensagem||d.motivo||'Solicitação recebida');}catch(e){msg(e.message)}};
async function status(){if(loading)return;loading=true;try{const s=await api('/status');$('autoEstado').textContent=(s.executando?'⏳ Executando':'● Parado')+' · '+s.mensagem;$('autoOk').textContent='✓ '+(s.publicados+s.atualizados)+' publicados/atualizados';$('autoReview').textContent='✕ '+s.revisao+' revisão';$('autoError').textContent='⚠ '+s.erros+' erros';$('autoProcessed').textContent=s.processados+' analisados';}catch(e){$('autoEstado').textContent=e.message}finally{loading=false}}
load();status();setInterval(status,5000);
})();
