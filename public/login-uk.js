'use strict';
(async()=>{
 const $=id=>document.getElementById(id),query=new URLSearchParams(location.search);
 let modoAfiliado=query.get('modo')==='afiliado'||!!query.get('cad'),user=null;
 const status=(id,msg,err=false)=>{const e=$(id);e.textContent=msg;e.className='status'+(err?' error':'')};
 const button=(f,run)=>{f.addEventListener('submit',async ev=>{ev.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');b.disabled=true;try{await run(Object.fromEntries(new FormData(f).entries()))}catch(e){const el=f.parentElement.querySelector('.status');if(el)status(el.id,e.message,true)}finally{b.disabled=false}})};
 const show=id=>{for(const x of ['signupPanel','upgradePanel','recoveryPanel'])$(x).hidden=x!==id};
 function next(){const dest=query.get('retorno')||'minha-conta';const list={checkout:'checkout.html?origem=sacola',sacola:'sacola.html',carrinho:'carrinho.html','minha-conta':'minha-conta.html',afiliados:'afiliados.html',index:'index.html'};location.href=UK.contextHref(list[dest]||'minha-conta.html')}
 if(query.has('cad')){try{const x=await UK.api('/api/uk/convite',{method:'POST',body:JSON.stringify({indicador:query.get('cad')})});$('refInfo').textContent='Convite de rede: '+x.patrocinador;$('refInfo').hidden=false}catch(e){status('signupMsg','Convite inválido: '+e.message,true)}}
 if(query.has('afiliado')||query.has('ref'))try{await UK.api('/api/uk/referencia',{method:'POST',body:JSON.stringify({ref:query.get('ref')||'',afiliado:query.get('afiliado')||'admin',origem:'loja'})})}catch(e){console.warn(e.message)}
 await UK.ready;user=UK.auth()?.user||null;
 if(user)$('currentProfile').textContent='Você está conectado como '+user.usuario+' ('+user.perfil+').';
 if(modoAfiliado&&user?.perfil==='afiliado'){location.href='afiliados.html';return}
 if(modoAfiliado){show(user&&user.perfil==='cliente'?'upgradePanel':'signupPanel');$('pixField').hidden=false;$('signupTitle').textContent='Cadastrar como afiliado';$('pixField').querySelector('input').required=true}
 if(query.get('modo')==='recuperar')show('recoveryPanel');
 $('toggleCadastro').onclick=()=>{modoAfiliado=false;show('signupPanel');$('signupTitle').textContent='Criar conta de cliente';$('pixField').hidden=true;$('pixField').querySelector('input').required=false};
 $('toggleAfiliado').onclick=()=>{modoAfiliado=true;show(user&&user.perfil==='cliente'?'upgradePanel':'signupPanel');$('signupTitle').textContent='Cadastrar como afiliado';$('pixField').hidden=false;$('pixField').querySelector('input').required=true};
 $('toggleRecuperar').onclick=()=>show('recoveryPanel');
 button($('loginForm'),async d=>{const r=await UK.api('/api/login',{method:'POST',body:JSON.stringify({...d,ref:query.get('ref')||'',afiliado:query.get('afiliado')||''})});if(r.trocarSenha){show('recoveryPanel');throw Error('Esta conta exige troca de senha; entre em contato com o suporte.')}UK.setUser(r.user);await UK.captureTracking();await UK.sincronizarSacola();if(query.get('guardar'))await UK.guardarCarrinho(query.get('guardar'),'',1).catch(e=>{throw Error('Login realizado, mas o produto não foi guardado: '+e.message)});next()});
 button($('signupForm'),async d=>{if(modoAfiliado&&!d.pix)throw Error('Chave Pix obrigatória para afiliados.');d.perfil=modoAfiliado?'afiliado':'cliente';const r=await UK.api('/api/registrar',{method:'POST',body:JSON.stringify({...d,ref:query.get('ref')||'',afiliado:query.get('afiliado')||''})});UK.setUser(r.user);await UK.captureTracking();await UK.sincronizarSacola();location.href=UK.contextHref(modoAfiliado?'afiliados.html':'minha-conta.html')});
 button($('upgradeForm'),async d=>{const r=await UK.api('/api/uk/afiliar',{method:'POST',body:JSON.stringify({...d,ref:query.get('ref')||'',afiliado:query.get('afiliado')||''})});UK.setUser(r.user);await UK.captureTracking();await UK.sincronizarSacola();location.href=UK.contextHref('afiliados.html')});
 button($('recoveryForm'),async d=>{await UK.api('/api/uk/recuperacao/trocar',{method:'POST',body:JSON.stringify(d)});status('recoveryMsg','Senha alterada. Entre novamente com sua nova senha.');$('loginForm').querySelector('[name=usuario]').value=d.usuario;show('')});
})();
