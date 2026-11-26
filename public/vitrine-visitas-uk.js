'use strict';
// Controle próprio de acessos à página pública. Sessão temporária por aba, sem IP, nome ou cookies.
(()=>{try{
 if(navigator.webdriver||/bot|crawler|spider|headless/i.test(navigator.userAgent))return;
 const key='uk_analytics_sessao_temporaria_v1';let sessao=sessionStorage.getItem(key);
 if(!sessao){const b=new Uint8Array(24);crypto.getRandomValues(b);sessao=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');sessionStorage.setItem(key,sessao)}
 fetch('/api/vitrine/visitas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessao}),keepalive:true,credentials:'same-origin'}).catch(()=>{});
}catch(e){/* métricas opcionais não podem impedir a navegação */}})();
