'use strict';
/** Aprovação comercial individual da CJ. Não muda produtos AliExpress/garimpagem.
 * Na PRIMEIRA instalação preserva publicações CJ existentes. Depois, falta de
 * aprovação significa que novos itens NÃO podem aparecer na vitrine. */
const memo = new WeakMap();
function ensureCuradoria(pool) {
  if (memo.has(pool)) return memo.get(pool);
  const promise=(async()=>{
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`CREATE TABLE IF NOT EXISTS public.cj_curadoria (
        id_externo TEXT PRIMARY KEY,
        decisao TEXT NOT NULL DEFAULT 'pendente' CHECK(decisao IN ('pendente','aprovado','rejeitado')),
        margem_percentual NUMERIC(7,2) CHECK(margem_percentual IS NULL OR (margem_percentual>=0 AND margem_percentual<100)),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      // Uma migração única, idempotente e protegida por bloqueio da chave.
      // Não transformar futuras importações em aprovações automáticas.
      await db.query("INSERT INTO public.config(chave,valor) VALUES('cj_curadoria_migracao_v1','{\"concluida\":false}'::jsonb) ON CONFLICT(chave) DO NOTHING");
      const mark=await db.query("SELECT valor FROM public.config WHERE chave='cj_curadoria_migracao_v1' FOR UPDATE");
      if(mark.rows[0]?.valor?.concluida !== true){
        // Legado publicado é preservado SEM atribuir margem nova artificial.
        // O gestor só define margem individual ao reaprovar esse produto.
        await db.query(`INSERT INTO public.cj_curadoria (id_externo,decisao,margem_percentual)
          SELECT id_externo,'aprovado',NULL FROM public.cj_produtos WHERE status='publicado'
          ON CONFLICT(id_externo) DO NOTHING`);
        await db.query("UPDATE public.config SET valor='{\"concluida\":true}'::jsonb WHERE chave='cj_curadoria_migracao_v1'");
      }
      await db.query('COMMIT');
    } catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
    finally{db.release()}
  })().catch(e=>{memo.delete(pool);throw e});
  memo.set(pool,promise);
  return promise;
}
function validarMargem(margem, cfg){
 const n=Number(margem), extra=['reserva','taxaPagamento','tributos','reservaAfiliados','protecao']
   .reduce((s,k)=>s+Number(cfg[k]||0),0);
 if(margem===null||margem===undefined||margem===''||!Number.isFinite(n)||n<0||n>=100||n+extra>=100)
   throw Error('Margem inválida: margem individual + taxas e reservas precisam somar menos de 100%.');
 return Math.round(n*100)/100;
}
module.exports={ensureCuradoria,validarMargem};
