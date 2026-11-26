'use strict';
/* INSTALADOR LOCAL E CONSERVADOR. Nunca conecta ao Neon nem publica no Render.
   Uso: node INSTALAR_BACKEND_UK.js "C:\\caminho\\uti like"
   Compara e copia apenas as duas rotas novas; acrescenta um registro ao server.js,
   com backup completo. Recusa estruturas desconhecidas para não danificar o projeto. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(process.argv[2]||process.cwd()),source=path.resolve(__dirname,'backend');
const files=['vitrine-routes.js','checkout-uk-routes.js'];
function stop(message){console.error('\nINSTALAÇÃO CANCELADA: '+message);process.exit(1)}
const serverFile=path.join(root,'server.js');if(!fs.existsSync(serverFile))stop('server.js não localizado. Informe o diretório RAIZ do seu projeto.');
for(const f of files)if(!fs.existsSync(path.join(source,f)))stop('Arquivo ausente no ZIP: backend/'+f);
let original=fs.readFileSync(serverFile,'utf8'),updated=original;
const vitrineRE=/app\.use\(\s*['"]\/api\/vitrine['"]\s*,\s*require\(['"]\.\/vitrine-routes['"]\)\(\{\s*pool\s*,\s*auth\s*,\s*soAdmin\s*,\s*lerCatalogoPublico\s*\}\)\s*\);/;
if(!vitrineRE.test(updated))stop('Não encontrei a montagem esperada de /api/vitrine. Não modifiquei seu servidor; verifique a versão instalada.');
if(!updated.includes('async function lerCatalogoPublico()'))stop('Não encontrei a função lerCatalogoPublico. Nenhum arquivo foi alterado.');
const mount="app.use('/api/checkout-uk', (req,res,next)=>req.get('authorization')?auth(req,res,next):next(), require('./checkout-uk-routes')({ pool, lerCatalogoPublico }));";
if(updated.includes("app.use('/api/checkout-uk'")||updated.includes('app.use("/api/checkout-uk"')){
 const exact=/app\.use\(\s*['"]\/api\/checkout-uk['"]\s*,\s*auth\s*,\s*require\(['"]\.\/checkout-uk-routes['"]\)\(\{\s*pool\s*,\s*lerCatalogoPublico\s*\}\)\s*\);/;
 if(exact.test(updated))updated=updated.replace(exact,mount);
 else if(!updated.includes(mount))stop('Já existe uma rota /api/checkout-uk com assinatura diferente. Revise o server.js manualmente; nada foi alterado.');
}else updated=updated.replace(vitrineRE,m=>m+'\n// CHECKOUT UK: cotação/sugestões públicas; perfil/rascunho exigem JWT.\n'+mount);
updated=updated.replace("app.use(express.json({ limit: '200kb' }));","app.use(express.json({ limit: '1mb' }));");
const tag=new Date().toISOString().replace(/[:.]/g,'-'),backup=path.join(root,'BACKUP_ANTES_CHECKOUT_UK_'+tag);
fs.mkdirSync(backup,{recursive:true});
const targets=[serverFile,...files.map(f=>path.join(root,f))];
for(const file of targets)if(fs.existsSync(file))fs.copyFileSync(file,path.join(backup,path.basename(file)));
try{
 fs.writeFileSync(serverFile,updated,'utf8');
 for(const f of files)fs.copyFileSync(path.join(source,f),path.join(root,f));
 for(const file of targets)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
 console.log('Instalação LOCAL concluída; arquivo de servidor integrado e rotas verificadas.');
 console.log('Backup:',backup);console.log('Ainda NÃO houve deploy, SQL ou pagamentos.');
}catch(e){
 for(const file of targets){const saved=path.join(backup,path.basename(file));if(fs.existsSync(saved))fs.copyFileSync(saved,file);else if(fs.existsSync(file))fs.unlinkSync(file)}
 stop('Erro de instalação; backups restaurados: '+e.message);
}
