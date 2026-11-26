'use strict';

const MAX_AFFILIATE_LEVELS = 3;

const normalize = value => String(value == null ? '' : value).trim().toLowerCase();
const money = value => Math.round(Number(value || 0) * 100) / 100;

/**
 * Resolve somente o afiliado atribuído e seus dois superiores imediatos.
 * O lookup deve aceitar usuario ou id e retornar { id, usuario, patrocinadorId }.
 */
async function resolveAffiliateChain(affiliate, lookup) {
  const chain = [];
  const visited = new Set();
  let current = normalize(affiliate);

  while (current && current !== 'admin' && chain.length < MAX_AFFILIATE_LEVELS) {
    if (visited.has(current)) break;
    const row = await lookup(current);
    if (!row) break;
    const usuario = normalize(row.usuario);
    if (!usuario || visited.has(usuario)) break;
    visited.add(current);
    visited.add(usuario);
    chain.push({
      nivel: chain.length + 1,
      usuario: row.usuario,
      id: row.id,
      patrocinadorId: row.patrocinadorId ?? row.patrocinador_id ?? 'admin'
    });
    current = normalize(row.patrocinadorId ?? row.patrocinador_id);
  }

  return chain;
}

function commissionDistribution(value, rates, chain) {
  const total = money(value);
  const percentages = [
    Number(rates?.taxaComissao || 0),
    Number(rates?.taxaPatrocinador || 0),
    Number(rates?.taxaAvo || 0)
  ];
  const levels = chain.slice(0, MAX_AFFILIATE_LEVELS).map((affiliate, index) => ({
    nivel: index + 1,
    usuario: affiliate.usuario,
    percentual: percentages[index],
    valor: money(total * percentages[index] / 100)
  }));
  const distribuido = levels.reduce((sum, item) => sum + item.valor, 0);
  return {
    niveis: levels,
    comissaoCentral: money(total - distribuido),
    percentualCentral: money(100 - percentages.reduce((sum, item) => sum + item, 0))
  };
}

module.exports = { MAX_AFFILIATE_LEVELS, resolveAffiliateChain, commissionDistribution };
