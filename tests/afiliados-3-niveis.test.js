'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_AFFILIATE_LEVELS, resolveAffiliateChain, commissionDistribution } = require('../affiliate-chain');

function lookupFactory(rows) {
  return async referencia => rows.find(row => row.usuario === referencia || row.id.toLowerCase() === String(referencia).toLowerCase()) || null;
}

test('resolve exatamente afiliado, pai e avô, sem quarto nível', async () => {
  const rows = [
    { id: 'AF-A1', usuario: 'a1', patrocinador_id: 'admin' },
    { id: 'AF-A2', usuario: 'a2', patrocinador_id: 'AF-A1' },
    { id: 'AF-A3', usuario: 'a3', patrocinador_id: 'AF-A2' },
    { id: 'AF-A4', usuario: 'a4', patrocinador_id: 'AF-A3' }
  ];
  const chain = await resolveAffiliateChain('a4', lookupFactory(rows));
  assert.equal(MAX_AFFILIATE_LEVELS, 3);
  assert.deepEqual(chain.map(row => row.usuario), ['a4', 'a3', 'a2']);
});

test('comissão da venda no nível 3 sobe para nível 2 e nível 1', () => {
  const result = commissionDistribution(100, { taxaComissao: 30, taxaPatrocinador: 10, taxaAvo: 10 }, [
    { usuario: 'a3' }, { usuario: 'a2' }, { usuario: 'a1' }
  ]);
  assert.deepEqual(result.niveis.map(item => [item.nivel, item.usuario, item.valor]), [
    [1, 'a3', 30], [2, 'a2', 10], [3, 'a1', 10]
  ]);
  assert.equal(result.comissaoCentral, 50);
});
