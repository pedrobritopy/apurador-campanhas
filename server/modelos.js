// Modelos prontos de campanha (galeria "Nova campanha").
// Inspirados em práticas de incentivo da indústria farmacêutica (positivação, mix mínimo, cobertura,
// kits, campeonatos, rateio de verba) e calibrados com as medianas reais por vendedor da base
// (ex.: ~6 clientes ativos e ~45 pedidos por vendedor/mês).
//
// Datas usam MARCADORES relativos, resolvidos quando o modelo é aplicado (front ou servidor):
//   @mes_atual_inicio / @mes_atual_fim          primeiro / último dia do mês corrente
//   @mes_anterior_inicio / @mes_anterior_fim    mês anterior
//   @proximo_mes_inicio / @proximo_mes_fim      próximo mês
//   @trimestre_inicio / @trimestre_fim          trimestre corrente
//   @hoje, @hoje+N, @hoje-N                     hoje deslocado N dias
// Use `resolverModelo(definicao, hoje)` para obter uma definição pronta.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (a, m, d) => new Date(Date.UTC(a, m, d));

/** Resolve um marcador de data ('@mes_atual_inicio', '@hoje+7'...) relativo a `hoje` (AAAA-MM-DD). */
export function resolverMarcadorData(valor, hoje) {
  if (typeof valor !== 'string' || !valor.startsWith('@')) return valor;
  const [a, m, d] = hoje.split('-').map(Number);
  const mes = m - 1;
  const desloc = valor.match(/^@hoje([+-]\d+)?$/);
  if (desloc) return iso(utc(a, mes, d + Number(desloc[1] || 0)));
  const tri = Math.floor(mes / 3) * 3;
  const tabela = {
    '@mes_atual_inicio': utc(a, mes, 1),
    '@mes_atual_fim': utc(a, mes + 1, 0),
    '@mes_anterior_inicio': utc(a, mes - 1, 1),
    '@mes_anterior_fim': utc(a, mes, 0),
    '@proximo_mes_inicio': utc(a, mes + 1, 1),
    '@proximo_mes_fim': utc(a, mes + 2, 0),
    '@trimestre_inicio': utc(a, tri, 1),
    '@trimestre_fim': utc(a, tri + 3, 0),
  };
  return tabela[valor] ? iso(tabela[valor]) : valor;
}

/** Cópia profunda da definição com todos os marcadores de data resolvidos. */
export function resolverModelo(definicao, hoje = iso(new Date())) {
  const copia = structuredClone(definicao);
  const visitar = (o) => {
    if (Array.isArray(o)) return o.forEach(visitar);
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v.startsWith('@')) o[k] = resolverMarcadorData(v, hoje);
      else visitar(v);
    }
  };
  visitar(copia);
  return copia;
}

export const CATEGORIAS_MODELO = [
  { chave: 'Simples', descricao: 'Regras de uma linha: a cada X unidades, R$ Y; R$ por unidade; ranking com prêmio para quem bater a meta.' },
  { chave: 'Volume', descricao: 'Unidades e faturamento: o "sell-in" clássico do fornecedor.' },
  { chave: 'Cobertura e positivação', descricao: 'Quantos clientes (PDVs) compraram. A métrica nº 1 das distribuidoras.' },
  { chave: 'Mix', descricao: 'Amplitude do portfólio vendido: SKUs, cestas e mix mínimo.' },
  { chave: 'Venda casada', descricao: 'Kits e combos: itens levados juntos no mesmo pedido ou cliente.' },
  { chave: 'Crescimento', descricao: 'Evolução contra o período anterior e participação na categoria.' },
  { chave: 'Competição', descricao: 'Campeonatos, rankings, rateio de verba e desafios de equipe.' },
  { chave: 'Rentabilidade', descricao: 'Margem, desconto e qualidade (devolução): vender bem, não só vender.' },
  { chave: 'Recuperação', descricao: 'Reativar clientes parados e lançar produtos na carteira.' },
];

const FAIXAS_PADRAO = [
  { min: 90, fixo: 80, variavel: 0, rotulo: 'Bronze' },
  { min: 100, fixo: 150, variavel: 0, rotulo: 'Prata' },
  { min: 120, fixo: 250, variavel: 0, rotulo: 'Ouro' },
];

const SUBCATEGORIAS_DOR = ['Analgésicos e Antitérmicos'];
// Centrum Mulher (todas as apresentações), usado como "lançamento"
const CENTRUM_MULHER = [66, 203, 340, 477, 614, 751, 888];

const base = (extra) => ({
  inicio: '@mes_atual_inicio',
  fim: '@mes_atual_fim',
  data_base: 'pedido',
  status_venda: ['Faturado'],
  calendario: null,
  participantes: { nivel: 'vendedor', ids: [], equipes: [] },
  filtros: { canais: [], segmentos: [], portes: [], estados: [], cidades: [], curvas: [], clientes: [], cfops: [], cfops_excluir: [] },
  apuracao: { regra: 'ponderada' },
  ...extra,
});

const crit = (id, extra) => ({
  id,
  produtos: {},
  meta: { tipo: 'fixa', valor: 0 },
  peso: 1,
  gatilho: 0,
  teto: null,
  ...extra,
});

export const MODELOS_CAMPANHA = [
  // ------------------------------------------------------------------ Simples (campanhas de balcão, uma regra só)
  {
    chave: 'bloco_unidades',
    nome: 'A cada 15 unidades, R$ 10',
    categoria: 'Simples',
    icone: 'Coins',
    descricao: 'Campanha de balcão: cada 15 unidades vendidas dos produtos valem R$ 10 para o vendedor. Sem meta, sem cálculo complicado.',
    mede: 'Unidades vendidas, pagas em blocos de 15',
    definicao: base({
      nome: 'Neo Química: a cada 15 un, R$ 10',
      fornecedor: 'Neo Química',
      cor: '#1baf7a',
      descricao: 'A cada 15 unidades Neo Química vendidas no mês, o vendedor ganha R$ 10. Vale pedido faturado.',
      criterios: [
        crit('c1', {
          nome: 'Unidades Neo Química',
          produtos: { fabricantes: ['Neo Química'] },
          metrica: 'quantidade',
          meta: { tipo: 'sem_meta' },
        }),
      ],
      premiacao: {
        tipo: 'bloco',
        bloco: { tamanho: 15, valor: 10, sobre: 'total', exigencia: 'nenhuma', minimo: 0, max_blocos: null },
        criterio_base: 'c1',
        teto_participante: 400,
        orcamento: 10000,
      },
    }),
  },
  {
    chave: 'por_unidade',
    nome: 'R$ por unidade vendida',
    categoria: 'Simples',
    icone: 'DollarSign',
    descricao: 'Cada unidade vendida da marca rende um valor fixo ao vendedor. Ótimo para empurrar um item específico no mês.',
    mede: 'Unidades vendidas (R$ 0,25 cada)',
    definicao: base({
      nome: 'Lavitan: R$ 0,25 por unidade',
      fornecedor: 'Cimed',
      cor: '#eda100',
      descricao: 'Cada unidade Lavitan vendida no mês vale R$ 0,25 para o vendedor, até R$ 150.',
      criterios: [
        crit('c1', {
          nome: 'Unidades Lavitan',
          produtos: { fabricantes: ['Cimed'], marcas: ['Lavitan'] },
          metrica: 'quantidade',
          meta: { tipo: 'sem_meta' },
        }),
      ],
      premiacao: {
        tipo: 'bloco',
        bloco: { tamanho: 1, valor: 0.25, sobre: 'total', exigencia: 'nenhuma', minimo: 0, max_blocos: null },
        criterio_base: 'c1',
        teto_participante: 150,
        orcamento: 12000,
      },
    }),
  },
  {
    chave: 'ranking_bonus_meta',
    nome: 'Ranking + prêmio para quem bater a meta',
    categoria: 'Simples',
    icone: 'Trophy',
    descricao: 'Os 3 primeiros levam o prêmio de pódio e, além disso, todo mundo que bater a meta já ganha um prêmio fixo.',
    mede: 'Unidades do fornecedor: meta de crescimento + ranking',
    definicao: base({
      nome: 'Haleon: pódio + prêmio por meta',
      fornecedor: 'Haleon',
      cor: '#6250d6',
      descricao: 'Meta: 10% a mais de unidades Haleon do que no mês anterior. Quem bater a meta ganha R$ 50; os 3 melhores ganham também o prêmio do pódio.',
      criterios: [
        crit('c1', {
          nome: 'Unidades Haleon',
          produtos: { fabricantes: ['Haleon'] },
          metrica: 'quantidade',
          meta: { tipo: 'historico', crescimento: 10, piso: 20 },
        }),
      ],
      premiacao: {
        tipo: 'ranking',
        ranking: { por: 'score', minimo: 100, posicoes: [{ de: 1, ate: 1, valor: 300 }, { de: 2, ate: 2, valor: 200 }, { de: 3, ate: 3, valor: 100 }] },
        bonus: { ativo: true, min: 100, valor: 50 },
        criterio_base: 'c1',
        orcamento: 6000,
      },
    }),
  },

  // ------------------------------------------------------------------ Volume
  {
    chave: 'unidades_fabricante',
    nome: 'Meta de unidades do fornecedor',
    categoria: 'Volume',
    icone: 'Package',
    descricao: 'O fornecedor passa um volume total e o sistema distribui entre os vendedores pelo histórico de cada um.',
    mede: 'Unidades vendidas dos produtos do fornecedor',
    definicao: base({
      nome: 'Cimed: volume do mês',
      fornecedor: 'Cimed',
      cor: '#2a78d6',
      descricao: 'Meta total de 24.000 unidades Cimed, distribuída pelo histórico de cada vendedor no mês anterior.',
      criterios: [
        crit('c1', {
          nome: 'Unidades Cimed',
          produtos: { fabricantes: ['Cimed'] },
          metrica: 'quantidade',
          meta: { tipo: 'distribuida', valor: 24000, distribuir_por: 'historico' },
          teto: 150,
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 90, fixo: 80, variavel: 0, rotulo: 'Bronze' },
          { min: 100, fixo: 150, variavel: 0.2, rotulo: 'Prata' },
          { min: 120, fixo: 250, variavel: 0.3, rotulo: 'Ouro' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: 600,
        orcamento: 30000,
      },
    }),
  },
  {
    chave: 'faturamento_marca',
    nome: 'Faturamento da linha',
    categoria: 'Volume',
    icone: 'DollarSign',
    descricao: 'Meta em reais para uma linha de produtos, com crescimento sobre o mês anterior de cada vendedor.',
    mede: 'Faturamento (R$) das marcas escolhidas',
    definicao: base({
      nome: 'Dermocosméticos L’Oréal: faturamento',
      fornecedor: "L'Oréal",
      cor: '#e87ba4',
      descricao: 'CeraVe + La Roche-Posay: crescer 12% sobre o faturamento do mês anterior.',
      criterios: [
        crit('c1', {
          nome: 'Faturamento CeraVe + La Roche-Posay',
          produtos: { marcas: ['CeraVe', 'La Roche-Posay'] },
          metrica: 'valor',
          meta: { tipo: 'historico', crescimento: 12, piso: 8000 },
          teto: 150,
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 95, fixo: 100, variavel: 0, rotulo: 'Quase lá' },
          { min: 100, fixo: 200, variavel: 0.01, rotulo: 'Meta' },
          { min: 115, fixo: 350, variavel: 0.015, rotulo: 'Supermeta' },
        ],
        variavel_sobre: 'excedente',
        criterio_base: 'c1',
        teto_participante: 900,
        orcamento: 40000,
      },
    }),
  },
  {
    chave: 'meta_geral_mes',
    nome: 'Meta geral do mês',
    categoria: 'Volume',
    icone: 'Target',
    descricao: 'Usa a meta de faturamento de cada vendedor cadastrada no ERP (fato_metas), sem digitar nada.',
    mede: 'Faturamento total contra a meta mensal do ERP',
    definicao: base({
      nome: 'Meta geral do mês',
      fornecedor: '',
      cor: '#6250d6',
      descricao: 'Apuração automática da meta mensal de faturamento de cada vendedor (fato_metas).',
      criterios: [
        crit('c1', {
          nome: 'Faturamento total',
          produtos: {},
          metrica: 'valor',
          meta: { tipo: 'meta_geral', campo: 'meta_valor', fator: 100 },
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 90, fixo: 150, variavel: 0, rotulo: '90%' },
          { min: 100, fixo: 300, variavel: 0, rotulo: '100%' },
          { min: 110, fixo: 450, variavel: 0, rotulo: '110%' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: null,
        orcamento: null,
      },
    }),
  },

  // ------------------------------------------------------------------ Cobertura e positivação
  {
    chave: 'positivacao_clientes',
    nome: 'Positivação de clientes',
    categoria: 'Cobertura e positivação',
    icone: 'UserCheck',
    descricao: 'Quantos clientes da carteira compraram o fornecedor no mês, com volume mínimo por cliente para valer.',
    mede: 'Clientes positivados (≥ 12 unidades cada)',
    definicao: base({
      nome: 'Positivação Hypera',
      fornecedor: 'Hypera Pharma',
      cor: '#1baf7a',
      descricao: 'Cada cliente que levar pelo menos 12 unidades Hypera no mês conta como positivado. Meta: 5 clientes.',
      criterios: [
        crit('c1', {
          nome: 'Clientes positivados Hypera',
          produtos: { fabricantes: ['Hypera Pharma'] },
          metrica: 'positivacao',
          regra_cliente: { min_qtd: 12, min_valor: 0 },
          meta: { tipo: 'fixa', valor: 5 },
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 80, fixo: 60, variavel: 0, rotulo: '4 clientes' },
          { min: 100, fixo: 120, variavel: 10, rotulo: '5 clientes' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: 250,
        orcamento: 20000,
      },
    }),
  },
  {
    chave: 'positivacao_qualificada',
    nome: 'Positivação qualificada (mix mínimo)',
    categoria: 'Cobertura e positivação',
    icone: 'BadgeCheck',
    descricao: 'Cliente só conta se levar uma cesta mínima: pelo menos 3 SKUs diferentes da linha (must-have).',
    mede: 'Clientes que compraram ≥ 3 SKUs da linha',
    definicao: base({
      nome: 'Linha Dor: positivação com mix mínimo',
      fornecedor: '',
      cor: '#eb6834',
      descricao: 'Analgésicos e antitérmicos: o cliente é positivado quando compra 3 ou mais SKUs da linha no mês.',
      criterios: [
        crit('c1', {
          nome: 'Clientes com 3+ SKUs da Linha Dor',
          produtos: { subcategorias: SUBCATEGORIAS_DOR },
          metrica: 'positivacao',
          regra_cliente: { min_qtd: 0, min_valor: 0, min_skus: 3 },
          meta: { tipo: 'fixa', valor: 4 },
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 75, fixo: 50, variavel: 0, rotulo: '3 clientes' },
          { min: 100, fixo: 120, variavel: 0, rotulo: '4 clientes' },
          { min: 125, fixo: 180, variavel: 0, rotulo: '5+ clientes' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: null,
        orcamento: 25000,
      },
    }),
  },
  {
    chave: 'cobertura_carteira',
    nome: 'Cobertura de carteira',
    categoria: 'Cobertura e positivação',
    icone: 'PieChart',
    descricao: 'Distribuição numérica: % da carteira de cada vendedor que comprou o fornecedor no período.',
    mede: 'Clientes positivados ÷ clientes da carteira (%)',
    definicao: base({
      nome: 'Cobertura Neo Química',
      fornecedor: 'Neo Química',
      cor: '#008300',
      descricao: 'Positivar Neo Química em pelo menos 60% dos clientes da carteira de cada vendedor.',
      criterios: [
        crit('c1', {
          nome: 'Cobertura de carteira Neo Química',
          produtos: { fabricantes: ['Neo Química'] },
          metrica: 'cobertura_carteira',
          meta: { tipo: 'fixa', valor: 60 },
          teto: 130,
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 85, fixo: 70, variavel: 0, rotulo: '≥ 51%' },
          { min: 100, fixo: 150, variavel: 0, rotulo: '≥ 60%' },
          { min: 125, fixo: 220, variavel: 0, rotulo: '≥ 75%' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: null,
        orcamento: 25000,
      },
    }),
  },

  // ------------------------------------------------------------------ Mix
  {
    chave: 'mix_skus',
    nome: 'Mix de SKUs do portfólio',
    categoria: 'Mix',
    icone: 'LayoutGrid',
    descricao: 'Amplitude: quantos produtos diferentes do fornecedor o vendedor conseguiu vender no mês.',
    mede: 'SKUs distintos vendidos',
    definicao: base({
      nome: 'Mix Hypera: 20 SKUs',
      fornecedor: 'Hypera Pharma',
      cor: '#eda100',
      descricao: 'Vender pelo menos 20 SKUs diferentes do portfólio Hypera no mês.',
      criterios: [
        crit('c1', {
          nome: 'SKUs Hypera vendidos',
          produtos: { fabricantes: ['Hypera Pharma'] },
          metrica: 'mix',
          meta: { tipo: 'fixa', valor: 20 },
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 90, fixo: 60, variavel: 0, rotulo: '18 SKUs' },
          { min: 100, fixo: 120, variavel: 0, rotulo: '20 SKUs' },
          { min: 125, fixo: 200, variavel: 0, rotulo: '25 SKUs' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: null,
        orcamento: 20000,
      },
    }),
  },
  {
    chave: 'cesta_produtos',
    nome: 'Cesta com metas por produto',
    categoria: 'Mix',
    icone: 'ShoppingBasket',
    descricao: 'Várias marcas ao mesmo tempo, cada uma com sua meta em unidades. Só ganha quem cumprir todas.',
    mede: 'Unidades por marca (todas obrigatórias)',
    definicao: base({
      nome: 'Cesta Kenvue',
      fornecedor: 'Kenvue',
      cor: '#2a78d6',
      descricao: 'Tylenol 50 un + Listerine 35 un + Band-Aid 35 un no mês. O prêmio exige as três metas.',
      apuracao: { regra: 'todos' },
      criterios: [
        crit('c1', { nome: 'Tylenol', produtos: { marcas: ['Tylenol'] }, metrica: 'quantidade', meta: { tipo: 'fixa', valor: 50 }, gatilho: 100, teto: 150 }),
        crit('c2', { nome: 'Listerine', produtos: { marcas: ['Listerine'] }, metrica: 'quantidade', meta: { tipo: 'fixa', valor: 35 }, gatilho: 100, teto: 150 }),
        crit('c3', { nome: 'Band-Aid', produtos: { marcas: ['Band-Aid'] }, metrica: 'quantidade', meta: { tipo: 'fixa', valor: 35 }, gatilho: 100, teto: 150 }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 100, fixo: 200, variavel: 0, rotulo: 'Cesta completa' },
          { min: 125, fixo: 320, variavel: 0, rotulo: 'Cesta turbinada' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: null,
        orcamento: 15000,
      },
    }),
  },

  // ------------------------------------------------------------------ Venda casada
  {
    chave: 'kit_imunidade',
    nome: 'Kit: gripe + vitamina no mesmo pedido',
    categoria: 'Venda casada',
    icone: 'Link2',
    descricao: 'Venda casada clássica: pedidos que levaram 2+ unidades de gripe e resfriado e 1+ de vitaminas juntas.',
    mede: 'Pedidos com o kit completo',
    definicao: base({
      nome: 'Kit Imunidade',
      fornecedor: '',
      cor: '#1baf7a',
      descricao: 'Cada pedido com ≥ 2 un de Gripe e Resfriado + ≥ 1 un de Vitaminas e Suplementos conta 1 kit. Meta: 6 pedidos.',
      criterios: [
        crit('c1', {
          nome: 'Pedidos com Kit Imunidade',
          metrica: 'combo',
          combo: {
            itens: [
              { nome: 'Gripe e Resfriado', produtos: { subcategorias: ['Gripe e Resfriado'] }, minimo: 2 },
              { nome: 'Vitaminas', produtos: { subcategorias: ['Vitaminas e Suplementos'] }, minimo: 1 },
            ],
            escopo: 'pedido',
            contar: 'ocorrencias',
          },
          meta: { tipo: 'fixa', valor: 6 },
          teto: 200,
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 100, fixo: 60, variavel: 8, rotulo: 'Meta' },
          { min: 150, fixo: 100, variavel: 10, rotulo: 'Destaque' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: 300,
        orcamento: 18000,
      },
    }),
  },
  {
    chave: 'kit_fornecedor_ranking',
    nome: 'Kit do fornecedor (Engov + Epocler)',
    categoria: 'Venda casada',
    icone: 'Gift',
    descricao: 'Kit de duas marcas do mesmo fornecedor no mesmo cliente. Sem meta individual: premia os 5 que mais venderem kits.',
    mede: 'Clientes que levaram o kit completo',
    definicao: base({
      nome: 'Kit Ressaca Hypera',
      fornecedor: 'Hypera Pharma',
      cor: '#e34948',
      descricao: 'Cliente que levar ≥ 2 un de Engov e ≥ 1 un de Epocler no mês conta 1 kit. Ranking: top 5 premiados.',
      criterios: [
        crit('c1', {
          nome: 'Kits Engov + Epocler',
          metrica: 'combo',
          combo: {
            itens: [
              { nome: 'Engov', produtos: { marcas: ['Engov'] }, minimo: 2 },
              { nome: 'Epocler', produtos: { marcas: ['Epocler'] }, minimo: 1 },
            ],
            escopo: 'cliente',
            contar: 'ocorrencias',
          },
          meta: { tipo: 'sem_meta' },
        }),
      ],
      premiacao: {
        tipo: 'ranking',
        criterio_base: 'c1',
        ranking: {
          por: 'realizado',
          minimo: 0,
          posicoes: [
            { de: 1, ate: 1, valor: 400 },
            { de: 2, ate: 2, valor: 250 },
            { de: 3, ate: 5, valor: 120 },
          ],
        },
        teto_participante: null,
        orcamento: 1010,
      },
    }),
  },

  // ------------------------------------------------------------------ Crescimento
  {
    chave: 'crescimento_anterior',
    nome: 'Crescimento sobre o mês anterior',
    categoria: 'Crescimento',
    icone: 'TrendingUp',
    descricao: 'Cada vendedor tem a própria meta: o que vendeu no período anterior + 10%. Justo para carteiras diferentes.',
    mede: 'Faturamento vs período anterior + 10%',
    definicao: base({
      nome: 'Sanofi: crescer 10%',
      fornecedor: 'Sanofi',
      cor: '#6250d6',
      descricao: 'Meta individual = faturamento Sanofi do mês anterior + 10% (mínimo R$ 5.000).',
      criterios: [
        crit('c1', {
          nome: 'Faturamento Sanofi',
          produtos: { fabricantes: ['Sanofi'] },
          metrica: 'valor',
          meta: { tipo: 'historico', crescimento: 10, piso: 5000 },
          teto: 140,
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 100, fixo: 150, variavel: 0.02, rotulo: 'Cresceu 10%' },
          { min: 110, fixo: 250, variavel: 0.03, rotulo: 'Cresceu 20%+' },
        ],
        variavel_sobre: 'excedente',
        criterio_base: 'c1',
        teto_participante: 700,
        orcamento: 35000,
      },
    }),
  },
  {
    chave: 'share_categoria',
    nome: 'Share da marca na categoria',
    categoria: 'Crescimento',
    icone: 'PieChart',
    descricao: 'Participação da marca dentro da própria categoria (padrão: mesma subcategoria). Ganha espaço do concorrente.',
    mede: 'Faturamento da marca ÷ faturamento da categoria (%)',
    definicao: base({
      nome: 'Sensodyne: share em Higiene Bucal',
      fornecedor: 'Haleon',
      cor: '#1baf7a',
      descricao: 'Sensodyne deve representar pelo menos 16% do faturamento de Higiene Bucal de cada vendedor.',
      criterios: [
        crit('c1', {
          nome: 'Share Sensodyne (R$)',
          produtos: { marcas: ['Sensodyne'] },
          produtos_ref: {},
          metrica: 'share_valor',
          meta: { tipo: 'fixa', valor: 16 },
          teto: 150,
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 90, fixo: 60, variavel: 0, rotulo: '≥ 14,4%' },
          { min: 100, fixo: 140, variavel: 0, rotulo: '≥ 16%' },
          { min: 125, fixo: 220, variavel: 0, rotulo: '≥ 20%' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: null,
        orcamento: 22000,
      },
    }),
  },

  // ------------------------------------------------------------------ Competição
  {
    chave: 'campeonato_ranking',
    nome: 'Campeonato de vendas (ranking)',
    categoria: 'Competição',
    icone: 'Trophy',
    descricao: 'Sem meta: quem vender mais leva. Prêmios por posição. Ideal para campanhas curtas e de engajamento.',
    mede: 'Faturamento do fornecedor (ranking)',
    definicao: base({
      nome: 'Campeonato Bayer',
      fornecedor: 'Bayer',
      cor: '#eb6834',
      descricao: 'Ranking de faturamento Bayer: 1º R$ 1.000, 2º R$ 600, 3º R$ 400 e do 4º ao 10º R$ 150.',
      criterios: [
        crit('c1', {
          nome: 'Faturamento Bayer',
          produtos: { fabricantes: ['Bayer'] },
          metrica: 'valor',
          meta: { tipo: 'sem_meta' },
        }),
      ],
      premiacao: {
        tipo: 'ranking',
        criterio_base: 'c1',
        ranking: {
          por: 'realizado',
          minimo: 0,
          posicoes: [
            { de: 1, ate: 1, valor: 1000 },
            { de: 2, ate: 2, valor: 600 },
            { de: 3, ate: 3, valor: 400 },
            { de: 4, ate: 10, valor: 150 },
          ],
        },
        teto_participante: null,
        orcamento: 3050,
      },
    }),
  },
  {
    chave: 'rateio_verba',
    nome: 'Verba do fornecedor rateada',
    categoria: 'Competição',
    icone: 'Coins',
    descricao: 'O "bolo": um valor fixo dividido entre quem bater a meta, proporcional ao que cada um vendeu.',
    mede: 'Faturamento vs histórico + 5%; verba fixa',
    definicao: base({
      nome: 'Bolo Hypera: R$ 5.000',
      fornecedor: 'Hypera Pharma',
      cor: '#eda100',
      descricao: 'R$ 5.000 divididos entre os vendedores que crescerem 5% em Hypera, proporcional ao faturamento de cada um.',
      criterios: [
        crit('c1', {
          nome: 'Faturamento Hypera',
          produtos: { fabricantes: ['Hypera Pharma'] },
          metrica: 'valor',
          meta: { tipo: 'historico', crescimento: 5, piso: 5000 },
        }),
      ],
      premiacao: {
        tipo: 'rateio',
        criterio_base: 'c1',
        rateio: { valor_total: 5000, minimo: 100, proporcional: 'realizado' },
        teto_participante: 800,
        orcamento: 5000,
      },
    }),
  },
  {
    chave: 'desafio_equipes',
    nome: 'Desafio de equipes',
    categoria: 'Competição',
    icone: 'Users',
    descricao: 'As equipes (gerentes) competem entre si em faturamento e positivação; prêmio por posição para o time.',
    mede: 'Faturamento + clientes por equipe',
    definicao: base({
      nome: 'Desafio de Equipes Haleon',
      fornecedor: 'Haleon',
      cor: '#6250d6',
      participantes: { nivel: 'equipe', ids: [], equipes: [] },
      descricao: 'Pontuação = média ponderada de faturamento (peso 2) e positivação (peso 1) contra o mês anterior.',
      criterios: [
        crit('c1', { nome: 'Faturamento Haleon', produtos: { fabricantes: ['Haleon'] }, metrica: 'valor', meta: { tipo: 'historico', crescimento: 8 }, peso: 2, teto: 130 }),
        crit('c2', { nome: 'Clientes Haleon', produtos: { fabricantes: ['Haleon'] }, metrica: 'positivacao', meta: { tipo: 'historico', crescimento: 5, piso: 1 }, peso: 1, teto: 130 }),
      ],
      premiacao: {
        tipo: 'ranking',
        criterio_base: 'c1',
        ranking: {
          por: 'score',
          minimo: 100,
          posicoes: [
            { de: 1, ate: 1, valor: 1500 },
            { de: 2, ate: 2, valor: 1000 },
            { de: 3, ate: 3, valor: 600 },
          ],
        },
        teto_participante: null,
        orcamento: 3100,
      },
    }),
  },

  // ------------------------------------------------------------------ Rentabilidade
  {
    chave: 'rentabilidade_redutor',
    nome: 'Margem com redutor de devolução',
    categoria: 'Rentabilidade',
    icone: 'BadgePercent',
    descricao: 'Vender com margem e pouco desconto. Se a devolução passar do limite, o prêmio cai pela metade.',
    mede: 'Margem (R$), desconto médio e devolução',
    definicao: base({
      nome: 'Bayer: venda rentável',
      fornecedor: 'Bayer',
      cor: '#008300',
      descricao: 'Margem bruta Bayer +5% (peso 2) e desconto médio ≤ 4,5% (peso 1). Devolução acima de 10% corta o prêmio pela metade.',
      criterios: [
        crit('c1', { nome: 'Margem bruta Bayer', produtos: { fabricantes: ['Bayer'] }, metrica: 'margem', meta: { tipo: 'historico', crescimento: 5, piso: 1000 }, peso: 2, teto: 130 }),
        crit('c2', { nome: 'Desconto médio Bayer', produtos: { fabricantes: ['Bayer'] }, metrica: 'desconto_medio', sentido: 'menor', meta: { tipo: 'fixa', valor: 4.5 }, peso: 1, teto: 120 }),
        crit('c3', { nome: 'Taxa de devolução Bayer', produtos: { fabricantes: ['Bayer'] }, metrica: 'taxa_devolucao', sentido: 'menor', meta: { tipo: 'fixa', valor: 10 }, peso: 0 }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 95, fixo: 100, variavel: 0, rotulo: '95%' },
          { min: 100, fixo: 200, variavel: 0, rotulo: '100%' },
          { min: 110, fixo: 300, variavel: 0, rotulo: '110%' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        multiplicadores: [{ criterio: 'c3', min: 100, fator: 1, senao: 0.5 }],
        teto_participante: null,
        orcamento: 30000,
      },
    }),
  },

  // ------------------------------------------------------------------ Recuperação
  {
    chave: 'reativacao_clientes',
    nome: 'Recuperação de clientes',
    categoria: 'Recuperação',
    icone: 'RotateCcw',
    descricao: 'Clientes que não compravam o fornecedor há 30+ dias e voltaram a comprar no mês. Paga por cliente reativado.',
    mede: 'Clientes novos/reativados no fornecedor',
    definicao: base({
      nome: 'EMS: reativação de clientes',
      fornecedor: 'EMS',
      cor: '#eb6834',
      descricao: 'Cada cliente sem compra EMS nos 30 dias anteriores ao início que voltar a comprar vale R$ 20. Meta: 2 clientes.',
      criterios: [
        crit('c1', {
          nome: 'Clientes EMS reativados',
          produtos: { fabricantes: ['EMS'] },
          metrica: 'clientes_novos',
          novos: { dias: 30 },
          meta: { tipo: 'fixa', valor: 2 },
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [{ min: 50, fixo: 0, variavel: 20, rotulo: 'Por cliente' }],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: 200,
        orcamento: 8000,
      },
    }),
  },
  {
    chave: 'lancamento_sku',
    nome: 'Lançamento de produto',
    categoria: 'Recuperação',
    icone: 'Rocket',
    descricao: 'Colocar o produto novo no maior número de clientes possível (positivação de SKU) logo no primeiro mês.',
    mede: 'Clientes que compraram o lançamento',
    definicao: base({
      nome: 'Lançamento Centrum Mulher',
      fornecedor: 'Haleon',
      cor: '#e87ba4',
      descricao: 'Positivar Centrum Mulher (todas as apresentações) em 2 clientes; R$ 15 por cliente positivado a partir da meta.',
      criterios: [
        crit('c1', {
          nome: 'Clientes com Centrum Mulher',
          produtos: { ids: CENTRUM_MULHER },
          metrica: 'positivacao',
          meta: { tipo: 'fixa', valor: 2 },
        }),
      ],
      premiacao: {
        tipo: 'faixas',
        faixas: [
          { min: 50, fixo: 0, variavel: 10, rotulo: '1 cliente' },
          { min: 100, fixo: 40, variavel: 15, rotulo: 'Meta' },
        ],
        variavel_sobre: 'total',
        criterio_base: 'c1',
        teto_participante: 150,
        orcamento: 10000,
      },
    }),
  },
];

// todo modelo nasce vinculado a um fabricante da base, ou marcado explicitamente como de vários fornecedores
for (const m of MODELOS_CAMPANHA) {
  const d = m.definicao;
  if (d.fornecedor) d.fabricante = d.fornecedor;
  else {
    d.varios_fornecedores = true;
    d.fornecedor = 'Vários fornecedores';
  }
}

/** Faixas padrão sugeridas para campanhas criadas do zero. */
export { FAIXAS_PADRAO };
