'use strict';
/**
 * Robô Copy Uti Like — publicação incremental.
 * Reutilizado pelo Cronjob existente; NÃO agenda um novo processo.
 * A copy comercial é independente da tradução e das especificações.
 */
const TAMANHO_LOTE = 60;

async function publicarUmLote(db) {
  let transacao = false;
  try {
    await db.query('BEGIN'); transacao = true;
    // Mesma ordem de bloqueio dos demais publicadores: primeiro config.produtos.
    const catalogResult = await db.query("SELECT valor FROM public.config WHERE chave = 'produtos' FOR UPDATE");
    if (!catalogResult.rowCount || !Array.isArray(catalogResult.rows[0].valor)) {
      throw Error('Catálogo config.produtos indisponível ou não é array JSONB.');
    }
    const catalogo = catalogResult.rows[0].valor;
    const pendentes = await db.query(`
      SELECT produto_id, texto_copy FROM public.robo_copy_produtos
       WHERE status = 'gerada'
       ORDER BY gerado_em, produto_id
       FOR UPDATE SKIP LOCKED
       LIMIT $1`, [TAMANHO_LOTE]);
    if (!pendentes.rowCount) {
      await db.query('COMMIT'); transacao = false;
      return {lidas: 0, publicadas: 0, revisao: 0};
    }
    const indice = new Map();
    for (let i = 0; i < catalogo.length; i++) {
      const p = catalogo[i];
      if (p && p.id != null) indice.set(String(p.id), i);
    }
    const publicadas = [];
    const revisao = [];
    for (const row of pendentes.rows) {
      const i = indice.get(String(row.produto_id));
      if (i === undefined) {
        // Produto foi removido: não ficar tentando republicar eternamente.
        revisao.push(row.produto_id);
        continue;
      }
      const produto = catalogo[i];
      if (!produto || produto.ativo === false || produto.active === false) {
        revisao.push(row.produto_id);
        continue;
      }
      const texto = String(row.texto_copy || '').trim();
      if (!texto || texto.length > 2000 || texto.split('\n').length > 15) {
        revisao.push(row.produto_id);
        continue;
      }
      // Nunca toca em descricao/descricao_ptbr/desc; publicamos em campo NOVO.
      catalogo[i] = {...produto, copyUtiLike: texto};
      publicadas.push(row.produto_id);
    }
    if (publicadas.length) {
      await db.query("UPDATE public.config SET valor = $1::jsonb WHERE chave = 'produtos'", [JSON.stringify(catalogo)]);
      await db.query(`UPDATE public.robo_copy_produtos
         SET status='publicada', publicado_em=NOW(), atualizado_em=NOW(), erro=NULL
         WHERE produto_id=ANY($1::text[]) AND status='gerada'`, [publicadas]);
    }
    if (revisao.length) {
      await db.query(`UPDATE public.robo_copy_produtos
         SET status='revisao', erro='Produto ausente, inativo ou copy inválida no catálogo atual', atualizado_em=NOW()
         WHERE produto_id=ANY($1::text[]) AND status='gerada'`, [revisao]);
    }
    await db.query('COMMIT'); transacao = false;
    return {lidas: pendentes.rowCount, publicadas: publicadas.length, revisao: revisao.length};
  } catch (e) {
    if (transacao) await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

async function publicarPendentes(db) {
  const totais = {publicadas: 0, revisao: 0, lotes: 0};
  for (;;) {
    const lote = await publicarUmLote(db);
    if (!lote.lidas) break;
    totais.publicadas += lote.publicadas;
    totais.revisao += lote.revisao;
    totais.lotes += 1;
  }
  return totais;
}

async function statusCopy(db) {
  const r = await db.query(`SELECT status, count(*)::int AS quantidade
      FROM public.robo_copy_produtos GROUP BY status ORDER BY status`);
  return Object.fromEntries(r.rows.map(x => [x.status, x.quantidade]));
}

module.exports = {publicarPendentes, statusCopy};
