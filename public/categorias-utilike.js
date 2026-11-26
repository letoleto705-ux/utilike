/* Uti Like - categorias para a vitrine (mantem o cadastro original no Neon). */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UtiLikeCategorias = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function normalizar(valor) {
    return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  // A ordem é importante: testar grupos específicos antes dos mais gerais.
  const regras = [
    ['Utensílios Domésticos', /utensil|household utensils|kitchenware|utilidade domestica/],
    ['Casa e Decoração', /\bcasa\b|decor|\bhome\b|garden|jardim|moveis|furniture|cozinha|kitchen|lar/],
    ['Beleza e Cuidados', /beleza|cosmet|maquiag|beauty|health|saude|skincare|skin care|cuidado pessoal|cabelo|hair care/],
    ['Ferramentas', /ferrament|\btools?\b|hardware|industrial|construcao|construction/],
    ['Brinquedos', /brinqued|\btoys?\b|baby|bebe|criancas?|infantil|kids|children/],
    ['Automotivo', /automot|\bcars?\b|\bauto\b|vehicle|motorcycle|moto|veiculo/],
    ['Esporte e Lazer', /esporte|fitness|sport|outdoor|camping|lazer|academia/],
    ['Pet Shop', /\bpets?\b|animal|cachorro|gato|dog|cat/],
    ['Moda e Acessórios', /moda|fashion|apparel|cloth|roupa|calcado|shoes|jewelry|bijuter|bolsa|\bbags?\b|acessor|vestuario/],
    ['Eletrônicos', /eletronic|electronics|electronic|audio|video|camera|fone|celular|telefone|phone|carregador|charger|\btv\b/],
    ['Tecnologia', /tecnolog|technology|informatica|computer|computador|notebook|tablet|smart|digital|software|gadget/],
  ];
  function grupoDaCategoria(categoria) {
    const texto = normalizar(categoria);
    if (!texto || /^(outros?|geral|variedades?|miscellaneous?|uncategorized|sem categoria)$/.test(texto)) return 'Outros';
    for (const [nome, padrao] of regras) if (padrao.test(texto)) return nome;
    return 'Outros';
  }
  function coincide(produto, filtro) {
    const selecionado = normalizar(filtro);
    if (!selecionado || selecionado === 'todos' || selecionado === 'todas as categorias') return true;
    const grupo = grupoDaCategoria(produto?.category ?? produto?.categoria);
    const canonico = normalizar(grupo);
    if (selecionado === canonico) return true;
    if (selecionado === 'casa') return grupo === 'Casa e Decoração' || grupo === 'Utensílios Domésticos';
    if (selecionado === 'beleza') return grupo === 'Beleza e Cuidados';
    if (selecionado === 'eletronicos') return grupo === 'Eletrônicos';
    if (selecionado === 'tecnologia') return grupo === 'Tecnologia' || grupo === 'Eletrônicos';
    if (selecionado === 'acessorios' || selecionado === 'moda') return grupo === 'Moda e Acessórios';
    if (selecionado === 'esporte') return grupo === 'Esporte e Lazer';
    if (selecionado === 'utensilios') return grupo === 'Utensílios Domésticos';
    if (selecionado === 'pet') return grupo === 'Pet Shop';
    return false;
  }
  const rotulos = [
    ['','Todos'], ['Eletrônicos','Eletrônicos'], ['Tecnologia','Tecnologia'],
    ['Casa','Casa e Decoração'], ['Utensílios','Utensílios Domésticos'],
    ['Ferramentas','Ferramentas'], ['Brinquedos','Brinquedos'],
    ['Beleza','Beleza e Cuidados'], ['Acessórios','Moda e Acessórios'],
    ['Esporte','Esporte e Lazer'], ['Automotivo','Automotivo'],
    ['Pet','Pet Shop'], ['Outros','Outros']
  ];
  function filtrosDisponiveis(produtos) {
    return rotulos.map(([chave, rotulo]) => ({
      chave, rotulo, quantidade: produtos.filter(p => coincide(p, chave)).length
    })).filter(x => !x.chave || x.quantidade > 0);
  }
  return Object.freeze({normalizar, grupoDaCategoria, coincide, filtrosDisponiveis});
});
