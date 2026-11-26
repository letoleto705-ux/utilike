'use strict';
/**
 * Etapa 7 — portão central de publicação CJ.
 * Fonte de verdade: public.cj_produtos. A tradução preliminar/cache da CJ nunca aprova.
 * NÃO altera produtos de AliExpress/Garimpagem nem o esquema SQL.
 */
const PUBLICACAO_STATUS = 'publicado';
const {ensureCuradoria} = require('./cj-curadoria');

function ehCJ(produto) {
  if (!produto || typeof produto !== 'object') return false;
  return String(produto.fornecedor || '').trim().toLowerCase() === 'cj dropshipping'
    || produto.cjProductId != null
    || /^cj-/.test(String(produto.id || ''));
}
function idCJ(produto) {
  const id = produto.cjProductId != null ? String(produto.cjProductId) : String(produto.id || '').replace(/^cj-/, '');
  return id && id.length <= 200 ? id : '';
}
function tituloAprovado(registro) {
  return registro?.status_traducao === 'aprovado'
    && !!String(registro.nome_ptbr || '').trim()
    && !!registro.traduzido_em;
}
function urlImagem(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'https:' ? u.href : null; }
  catch { return null; }
}
/** Galeria conservadora: aproveita SOMENTE URLs HTTPS explícitas nos dados CJ publicados.
 * Sem chamada nova à API: imagens não retornadas no listV2 exigem importação futura de detalhes. */
function extrairGaleriaCJ(registro, anterior = {}, principal = null) {
  const dados=registro?.dados && typeof registro.dados==='object' ? registro.dados : {};
  const fontes=[principal, anterior.imagem, registro?.imagem];
  const listas=[anterior.imagens, dados.productImages, dados.productImageList,
    dados.imageList, dados.images, dados.imagens, dados.detailImages, dados.productImagesUrl,
    dados.productImage];
  for(const lista of listas){
    if(Array.isArray(lista)) fontes.push(...lista.slice(0,60));
    else if(typeof lista==='string'){
      const t=lista.trim();
      if(t.startsWith('[')){try{const a=JSON.parse(t);if(Array.isArray(a))fontes.push(...a.slice(0,60))}catch{}}
      else fontes.push(lista);
    }
  }
  const urls=[];
  for(const item of fontes){
    const value=typeof item==='string'?item:(item&&typeof item==='object'?
      item.url||item.imageUrl||item.imgUrl||item.image||item.src||'':'');
    const url=urlImagem(value);
    if(url&&!urls.includes(url))urls.push(url);
    if(urls.length>=12)break;
  }
  return urls;
}

function comercialValido(registro) {
  return registro?.status !== 'desativado'
    && Number.isFinite(Number(registro?.preco_brl))
    && Number(registro.preco_brl) > 0
    && !!urlImagem(registro.imagem);
}
function habilitado(registro) {
  return tituloAprovado(registro) && comercialValido(registro);
}
function produtoPublico(produto, registro) {
  const p = { ...produto, nome: String(registro.nome_ptbr).trim(), descricao: String(registro.descricao_ptbr || '').trim() };
  // Os textos de origem ficam no Neon, não são remetidos para visitantes.
  delete p.nomeOriginalEn;
  delete p.descricaoOriginalEn;
  delete p.traducaoPendente;
  delete p.dados;
  return p;
}
/** Verificação read-only em TODA requisição pública, inclusive produtos antigos em config.produtos. */
async function filtrarCatalogoPublicoCJ(pool, catalogo) {
  if (!Array.isArray(catalogo)) return [];
  const ids = [...new Set(catalogo.filter(ehCJ).map(idCJ).filter(Boolean))];
  if (!ids.length) return catalogo;
  await ensureCuradoria(pool);
  const result = await pool.query(`SELECT c.id_externo, c.nome_ptbr, c.descricao_ptbr, c.status_traducao,
     c.traduzido_em, c.status, c.preco_brl, c.imagem
     FROM public.cj_produtos c JOIN public.cj_curadoria g ON g.id_externo=c.id_externo
     AND g.decisao='aprovado' WHERE c.id_externo = ANY($1::text[])`, [ids]);
  const registros = new Map(result.rows.map(r => [String(r.id_externo), r]));
  return catalogo.flatMap(p => {
    if (!ehCJ(p)) return [p];
    const registro = registros.get(idCJ(p));
    if (!registro || registro.status !== PUBLICACAO_STATUS || !habilitado(registro) || p.ativo === false) return [];
    if (!(Number(p.precoPor) > 0) || !urlImagem(p.imagem)) return [];
    return [produtoPublico(p, registro)];
  });
}
/** Atualiza somente produtos CJ elegíveis e o catálogo JSONB. Não publica texto não aprovado. */
async function sincronizarAprovadosCJ(pool) {
  await ensureCuradoria(pool);
  const db = await pool.connect();
  let iniciada = false;
  try {
    await db.query('BEGIN'); iniciada = true;
    await db.query("INSERT INTO config(chave,valor) VALUES('produtos','[]'::jsonb) ON CONFLICT(chave) DO NOTHING");
    const locked = await db.query("SELECT valor FROM config WHERE chave='produtos' FOR UPDATE");
    const catalogo = locked.rows[0]?.valor;
    if (!Array.isArray(catalogo)) throw Error('Catálogo JSONB inválido; sincronização cancelada.');
    const found = await db.query(`SELECT c.id_externo, c.sku, c.nome, c.nome_ptbr, c.descricao_ptbr, c.idioma_origem,
      c.status_traducao, c.traduzido_em, c.categoria, c.imagem, c.preco_usd, c.preco_brl,
      c.cambio_usd_brl, c.status, c.dados, g.margem_percentual
      FROM public.cj_produtos c JOIN public.cj_curadoria g ON c.id_externo=g.id_externo
      AND g.decisao='aprovado' WHERE c.status <> 'desativado'
      AND c.status_traducao='aprovado' AND NULLIF(BTRIM(nome_ptbr),'') IS NOT NULL
      AND c.traduzido_em IS NOT NULL ORDER BY c.id_externo`);
    const aprovados = new Map(found.rows.filter(habilitado).map(r => [String(r.id_externo), r]));
    const prec = await db.query("SELECT valor FROM config WHERE chave='cronjob_automacao_v1'");
    const regra = {margem:30,frete:20,reserva:0,...(prec.rows[0]?.valor || {})};
    const usados = new Set();
    let removidos = 0;
    const resultado = [];
    function montar(registro, anterior = {}) {
      const id = String(registro.id_externo), imagem = urlImagem(registro.imagem);
      // Preserva variação comercial escolhida e dados operacionais anteriores.
      const variacao = Boolean(registro.dados?.varianteSelecionada);
      const anteriorImagem = variacao ? urlImagem(anterior.imagem) : null;
      const preco = Number(registro.preco_brl); // A margem individual é a fonte de preço CJ.
      const produto = {
        ...anterior, id: 'cj-' + id, fornecedor:'CJ Dropshipping', cjProductId:id,
        nome:String(registro.nome_ptbr).trim(), descricao:String(registro.descricao_ptbr || '').trim(),
        categoria:registro.categoria, imagem:anteriorImagem || imagem,
        imagens:extrairGaleriaCJ(registro, anterior, anteriorImagem || imagem), precoPor:preco,
        custoFornecedor: Number(registro.preco_usd) > 0 && Number(registro.cambio_usd_brl) > 0
          ? Math.ceil(Number(registro.preco_usd) * Number(registro.cambio_usd_brl) * 100) / 100
          : (anterior.custoFornecedor || null),
        precoOriginalUSD:Number(registro.preco_usd), cambioAplicado:Number(registro.cambio_usd_brl),
        moedaFornecedor:'USD', freteEstimado: Number(regra.frete),
        margemMarkup:registro.margem_percentual===null?(Number(anterior.margemMarkup)||Number(regra.margem)):Number(registro.margem_percentual),reservaSeguranca:Number(regra.reserva),
        sku:variacao && anterior.sku ? anterior.sku : registro.sku,
        cjVariantId:variacao ? (anterior.cjVariantId || registro.dados.varianteSelecionada) : (anterior.cjVariantId || null),
        ativo:true
      };
      delete produto.nomeOriginalEn;
      delete produto.descricaoOriginalEn;
      delete produto.traducaoPendente;
      return produto;
    }
    for (const p of catalogo) {
      if (!ehCJ(p)) { resultado.push(p); continue; }
      const id = idCJ(p), reg = aprovados.get(id);
      if (!reg || p.ativo === false || usados.has(id)) { removidos++; continue; }
      resultado.push(montar(reg, p)); usados.add(id);
    }
    for (const [id, reg] of aprovados) {
      if (usados.has(id)) continue;
      resultado.push(montar(reg)); usados.add(id);
    }
    const mudancas = JSON.stringify(resultado) !== JSON.stringify(catalogo);
    if (mudancas) await db.query("UPDATE config SET valor=$1::jsonb WHERE chave='produtos'", [JSON.stringify(resultado)]);
    const ids = [...usados];
    if (ids.length) await db.query("UPDATE public.cj_produtos SET status='publicado', motivo=NULL WHERE id_externo = ANY($1::text[]) AND status <> 'desativado' AND status <> 'publicado'", [ids]);
    await db.query('COMMIT'); iniciada = false;
    return {ok:true,publicados:ids.length,adicionados:ids.filter(id => !catalogo.some(p => ehCJ(p) && idCJ(p) === id)).length,
      removidos, alterouCatalogo:mudancas};
  } catch (err) {
    if (iniciada) await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}
module.exports = { ehCJ, idCJ, tituloAprovado, comercialValido, extrairGaleriaCJ, filtrarCatalogoPublicoCJ, sincronizarAprovadosCJ };
