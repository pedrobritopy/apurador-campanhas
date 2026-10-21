import { db, lerConfig, versaoDados, aoInvalidar } from './db.js';
import { resolverProdutos, produtoPorId, catalogoProdutos, descreverSeletor, gruposDeProdutos } from './seletor.js';
import { listarParticipantes, vendedoresDoParticipante, NIVEIS } from './participantes.js';
import { compilar } from './expressao.js';
import { criarCalendario, listaFeriados, intervalo, hojeISO, periodoAnterior, ultimoDiaMes, addDias } from './calendario.js';
import { assinaturaBase, hash } from './pipeline.js';

// ======================================================================
// Catálogo de variáveis (o que o motor sabe medir por participante)
// ======================================================================

export const VARIAVEIS = {
  qtd: { nome: 'Unidades vendidas', grupo: 'Volume' },
  valor: { nome: 'Faturamento (R$)', grupo: 'Volume' },
  valor_lista: { nome: 'Faturamento a preço de lista (R$)', grupo: 'Volume' },
  linhas: { nome: 'Itens de nota', grupo: 'Volume' },
  custo: { nome: 'Custo total (R$)', grupo: 'Rentabilidade' },
  margem: { nome: 'Margem bruta (R$)', grupo: 'Rentabilidade' },
  impostos: { nome: 'Impostos ICMS+PIS+COFINS (R$)', grupo: 'Rentabilidade' },
  icms: { nome: 'ICMS (R$)', grupo: 'Rentabilidade' },
  pis: { nome: 'PIS (R$)', grupo: 'Rentabilidade' },
  cofins: { nome: 'COFINS (R$)', grupo: 'Rentabilidade' },
  comissao: { nome: 'Comissão do canal (R$)', grupo: 'Rentabilidade' },
  pedidos: { nome: 'Pedidos distintos (respeita pedido mínimo)', grupo: 'Cobertura' },
  clientes: { nome: 'Clientes positivados (respeita a positivação qualificada)', grupo: 'Cobertura' },
  clientes_novos: { nome: 'Clientes novos na linha (não compravam esses produtos há N dias)', grupo: 'Cobertura' },
  clientes_reativados: { nome: 'Clientes sem nenhuma compra há N dias que voltaram a comprar', grupo: 'Cobertura' },
  clientes_rec: { nome: 'Clientes recorrentes (2+ pedidos no período)', grupo: 'Cobertura' },
  skus: { nome: 'SKUs distintos vendidos (respeita SKU positivado em N clientes)', grupo: 'Cobertura' },
  cli_skus: { nome: 'Pares cliente × SKU (positivação de SKU)', grupo: 'Cobertura' },
  marcas: { nome: 'Marcas distintas vendidas', grupo: 'Cobertura' },
  cidades: { nome: 'Cidades com cliente positivado', grupo: 'Cobertura' },
  dias_venda: { nome: 'Dias com venda', grupo: 'Cobertura' },
  n_produtos: { nome: 'Produtos no escopo do critério', grupo: 'Cobertura' },
  base_clientes: { nome: 'Clientes da carteira/base do participante', grupo: 'Carteira' },
  clientes_ativos: { nome: 'Clientes ativos antes da campanha (compraram algo nos 90 dias anteriores)', grupo: 'Carteira' },
  peso_positivados: { nome: 'Poder de compra (R$ 90d) dos clientes positivados', grupo: 'Carteira' },
  peso_base: { nome: 'Poder de compra (R$ 90d) da base ativa', grupo: 'Carteira' },
  qtd_dev: { nome: 'Unidades devolvidas', grupo: 'Devoluções' },
  valor_dev: { nome: 'Valor devolvido (R$)', grupo: 'Devoluções' },
  qtd_canc: { nome: 'Unidades canceladas', grupo: 'Devoluções' },
  valor_canc: { nome: 'Valor cancelado (R$)', grupo: 'Devoluções' },
  qtd_ref: { nome: 'Unidades no escopo de referência', grupo: 'Comparação' },
  valor_ref: { nome: 'Faturamento no escopo de referência', grupo: 'Comparação' },
  qtd_ant: { nome: 'Unidades no período anterior (mesmo ponto)', grupo: 'Comparação' },
  valor_ant: { nome: 'Faturamento no período anterior (mesmo ponto)', grupo: 'Comparação' },
  clientes_ant: { nome: 'Clientes no período anterior (mesmo ponto)', grupo: 'Comparação' },
  dias_uteis: { nome: 'Dias contáveis decorridos na campanha', grupo: 'Calendário' },
  combos: { nome: 'Vendas casadas completas', grupo: 'Venda casada' },
  kits: { nome: 'Kits completos', grupo: 'Venda casada' },
};
const NOMES_VARS = Object.keys(VARIAVEIS);
const SEMPRE = ['qtd', 'valor'];
const ADITIVAS = ['qtd', 'valor', 'valor_lista', 'custo', 'margem', 'impostos', 'icms', 'pis', 'cofins', 'comissao', 'linhas'];
// Constantes por participante (não crescem com o tempo; a projeção usa o próprio valor)
const CONSTANTES = new Set(['n_produtos', 'qtd_ant', 'valor_ant', 'clientes_ant', 'base_clientes', 'clientes_ativos', 'peso_base']);
const ANTERIOR = { qtd_ant: 'qtd', valor_ant: 'valor', clientes_ant: 'clientes' };
const TEMPO = new Set(['dias_uteis']);
// Medidas aceitas em variáveis parametrizadas (precisam vir das vendas)
export const MEDIDAS_PARAMETRIZAVEIS = [
  ...ADITIVAS, 'pedidos', 'clientes', 'clientes_novos', 'clientes_reativados', 'clientes_rec', 'skus', 'cli_skus', 'marcas', 'cidades',
  'dias_venda', 'qtd_dev', 'valor_dev', 'qtd_canc', 'valor_canc', 'peso_positivados',
];
// Peso do ritmo recente na projeção. Contagens distintas saturam (o mesmo cliente não positiva duas vezes),
// então o ritmo recente pesa mais para elas.
const PESO_RECENTE = { clientes: 0.7, clientes_novos: 0.7, clientes_reativados: 0.7, clientes_rec: 0.7, skus: 0.7, cli_skus: 0.7, marcas: 0.7, cidades: 0.7, peso_positivados: 0.7 };
// Contagens que saturam ao longo do período: projetadas pela "curva de maturação" do período anterior
// (no período anterior, até este mesmo ponto, X% do total já tinha acontecido).
const SATURAVEIS = new Set(['clientes', 'clientes_novos', 'clientes_reativados', 'clientes_rec', 'skus', 'cli_skus', 'marcas', 'cidades', 'peso_positivados']);

// ======================================================================
// Catálogo de métricas prontas
// ======================================================================

const M = (grupo, nome, expr, formato, totalizar, extra = {}) => ({ grupo, nome, expr, formato, totalizar, ...extra });

export const METRICAS = {
  quantidade: M('Volume', 'Unidades', 'qtd', 'numero', 'soma', { unidade: 'un', descricao: 'Soma de unidades vendidas dos produtos do critério.' }),
  quantidade_liquida: M('Volume', 'Unidades líquidas de devolução', 'qtd - qtd_dev', 'numero', 'soma', { unidade: 'un', descricao: 'Unidades vendidas menos unidades devolvidas no período.' }),
  valor: M('Volume', 'Faturamento', 'valor', 'moeda', 'soma', { descricao: 'Soma do valor vendido (R$).' }),
  valor_liquido_dev: M('Volume', 'Faturamento líquido de devoluções', 'valor - valor_dev', 'moeda', 'soma', { descricao: 'Faturamento menos o valor devolvido.' }),
  valor_liquido: M('Volume', 'Faturamento sem impostos', 'valor - impostos', 'moeda', 'soma', { descricao: 'Faturamento menos ICMS, PIS e COFINS.' }),
  valor_lista: M('Volume', 'Faturamento a preço de lista', 'valor_lista', 'moeda', 'soma', { descricao: 'Volume valorizado pelo preço de tabela (ignora descontos).' }),

  margem: M('Rentabilidade', 'Margem bruta (R$)', 'margem', 'moeda', 'soma', { descricao: 'Soma da margem bruta.' }),
  margem_perc: M('Rentabilidade', 'Margem bruta (%)', 'margem / valor * 100', 'perc', 'media', { descricao: 'Margem bruta ÷ faturamento.' }),
  markup: M('Rentabilidade', 'Markup', 'valor / custo', 'decimal', 'media', { descricao: 'Faturamento ÷ custo (1,35 = 35% sobre o custo).' }),
  desconto_medio: M('Rentabilidade', 'Desconto médio (%)', '(1 - valor / valor_lista) * 100', 'perc', 'media', { sentido: 'menor', descricao: 'Quanto abaixo do preço de lista se vendeu. Quanto menor, melhor.' }),
  realizacao_preco: M('Rentabilidade', 'Realização de preço (%)', 'valor / valor_lista * 100', 'perc', 'media', { descricao: 'Preço praticado ÷ preço de lista (100% = vendeu a preço cheio).' }),
  preco_medio: M('Rentabilidade', 'Preço médio unitário', 'valor / qtd', 'moeda', 'media', { descricao: 'Faturamento ÷ unidades.' }),

  positivacao: M('Clientes e cobertura', 'Positivação de clientes', 'clientes', 'numero', 'soma', { unidade: 'clientes', descricao: 'Clientes distintos que compraram. Aceita positivação qualificada (mínimo de unidades, R$, SKUs, marcas ou pedidos por cliente).' }),
  cobertura_carteira: M('Clientes e cobertura', 'Positivação da carteira (%)', 'clientes / base_clientes * 100', 'perc', 'media', { descricao: '% dos clientes da carteira (base) do participante que compraram os produtos.' }),
  distribuicao_numerica: M('Clientes e cobertura', 'Distribuição numérica (%)', 'clientes / clientes_ativos * 100', 'perc', 'media', { descricao: 'Clientes positivados ÷ clientes ativos do participante antes da campanha (compraram qualquer produto nos 90 dias anteriores).' }),
  distribuicao_ponderada: M('Clientes e cobertura', 'Distribuição ponderada (%)', 'peso_positivados / peso_base * 100', 'perc', 'media', { descricao: 'Como a numérica, mas cada cliente pesa pelo seu volume de compras (R$ dos 90 dias anteriores).' }),
  clientes_novos: M('Clientes e cobertura', 'Clientes novos na linha', 'clientes_novos', 'numero', 'soma', { unidade: 'clientes', descricao: 'Clientes que compraram e não tinham comprado esses produtos nos N dias anteriores.' }),
  clientes_reativados: M('Clientes e cobertura', 'Clientes reativados', 'clientes_reativados', 'numero', 'soma', { unidade: 'clientes', descricao: 'Clientes sem nenhuma compra (de nada) nos N dias anteriores que compraram os produtos.' }),
  oxigenacao: M('Clientes e cobertura', 'Oxigenação da carteira (%)', 'clientes_reativados / clientes_ativos * 100', 'perc', 'media', { descricao: 'Clientes reativados ÷ base ativa: quanto a carteira está se renovando.' }),
  clientes_recorrentes: M('Clientes e cobertura', 'Clientes recorrentes', 'clientes_rec', 'numero', 'soma', { unidade: 'clientes', descricao: 'Clientes com 2 ou mais pedidos dos produtos no período.' }),
  mix: M('Clientes e cobertura', 'Mix de SKUs', 'skus', 'numero', 'soma', { unidade: 'SKUs', descricao: 'Produtos distintos vendidos (aceita "SKU positivado em pelo menos N clientes").' }),
  mix_marcas: M('Clientes e cobertura', 'Mix de marcas', 'marcas', 'numero', 'soma', { unidade: 'marcas', descricao: 'Marcas distintas vendidas.' }),
  cobertura_mix: M('Clientes e cobertura', 'Cobertura do mix (%)', 'skus / n_produtos * 100', 'perc', 'media', { descricao: '% dos produtos do critério que foram vendidos.' }),
  mix_cliente: M('Clientes e cobertura', 'Mix médio por cliente', 'cli_skus / clientes', 'decimal', 'media', { descricao: 'Média de SKUs distintos por cliente positivado.' }),
  positivacao_sku: M('Clientes e cobertura', 'Positivação de SKU', 'cli_skus', 'numero', 'soma', { unidade: 'positivações', descricao: 'Pares cliente × produto: cada SKU novo em cada cliente conta 1.' }),
  ticket_cliente: M('Clientes e cobertura', 'Faturamento por cliente', 'valor / clientes', 'moeda', 'media', { descricao: 'Faturamento ÷ clientes positivados.' }),
  cidades_positivadas: M('Clientes e cobertura', 'Cidades positivadas', 'cidades', 'numero', 'soma', { unidade: 'cidades', descricao: 'Cidades com pelo menos um cliente que comprou (cobertura geográfica).' }),

  pedidos: M('Pedidos e frequência', 'Pedidos', 'pedidos', 'numero', 'soma', { unidade: 'pedidos', descricao: 'Pedidos distintos (aceita pedido mínimo em unidades ou R$).' }),
  ticket_medio: M('Pedidos e frequência', 'Ticket médio', 'valor / pedidos', 'moeda', 'media', { descricao: 'Faturamento ÷ pedidos.' }),
  itens_pedido: M('Pedidos e frequência', 'Itens por pedido', 'linhas / pedidos', 'decimal', 'media', { descricao: 'Média de linhas (SKUs) por pedido.' }),
  unidades_pedido: M('Pedidos e frequência', 'Unidades por pedido', 'qtd / pedidos', 'decimal', 'media', { descricao: 'Média de unidades por pedido (drop size).' }),
  frequencia_compra: M('Pedidos e frequência', 'Frequência de compra', 'pedidos / clientes', 'decimal', 'media', { descricao: 'Pedidos por cliente positivado.' }),
  produtividade_dia: M('Pedidos e frequência', 'Pedidos por dia', 'pedidos / dias_uteis', 'decimal', 'media', { descricao: 'Produtividade: pedidos ÷ dias decorridos da campanha.' }),
  positivacao_dia: M('Pedidos e frequência', 'Positivação diária', 'clientes / dias_uteis', 'decimal', 'media', { descricao: 'Clientes positivados ÷ dias decorridos.' }),
  dias_venda: M('Pedidos e frequência', 'Dias com venda', 'dias_venda', 'numero', 'soma', { unidade: 'dias', descricao: 'Em quantos dias houve venda (constância).' }),

  crescimento_qtd: M('Crescimento e participação', 'Crescimento de unidades (%)', '(qtd / qtd_ant - 1) * 100', 'perc', 'media', { descricao: 'Variação de unidades contra o período anterior, comparando o mesmo ponto do período.' }),
  crescimento_valor: M('Crescimento e participação', 'Crescimento de faturamento (%)', '(valor / valor_ant - 1) * 100', 'perc', 'media', { descricao: 'Variação do faturamento contra o período anterior, no mesmo ponto do período.' }),
  share_qtd: M('Crescimento e participação', 'Share em unidades (%)', 'qtd / qtd_ref * 100', 'perc', 'media', { ref: true, descricao: 'Participação dos produtos do critério dentro do escopo de referência (padrão: mesma subcategoria).' }),
  share_valor: M('Crescimento e participação', 'Share em faturamento (%)', 'valor / valor_ref * 100', 'perc', 'media', { ref: true, descricao: 'Participação em R$ dentro do escopo de referência (padrão: mesma subcategoria).' }),

  taxa_devolucao: M('Qualidade', 'Taxa de devolução (%)', 'valor_dev / (valor + valor_dev) * 100', 'perc', 'media', { sentido: 'menor', descricao: 'Valor devolvido sobre o total. Quanto menor, melhor.' }),
  taxa_cancelamento: M('Qualidade', 'Taxa de cancelamento (%)', 'valor_canc / (valor + valor_canc) * 100', 'perc', 'media', { sentido: 'menor', descricao: 'Valor cancelado sobre o total. Quanto menor, melhor.' }),

  combo: M('Especiais', 'Venda casada / kit', null, 'numero', 'soma', { unidade: 'combos', descricao: 'Pedidos (ou clientes) que levaram todos os itens com as quantidades mínimas.' }),
  personalizada: M('Especiais', 'Fórmula personalizada', null, 'decimal', null, { descricao: 'Monte sua própria métrica com qualquer variável, inclusive recortes como valor{marca: "Dorflex", canal: "App Mobile"}.' }),
};

export const TIPOS_META = {
  fixa: 'Mesma meta para todos',
  distribuida: 'Meta total distribuída entre participantes',
  historico: 'Crescimento sobre o período anterior',
  meta_geral: '% da meta geral do mês (fato_metas)',
  sem_meta: 'Sem meta (só ranking)',
};

export const FORMATOS = ['numero', 'moeda', 'perc', 'decimal'];

// ======================================================================
// Normalização da definição de campanha
// ======================================================================

const lista = (x) => (Array.isArray(x) ? x.filter((v) => v !== '' && v != null) : []);
const num = (x, padrao = null) => {
  if (x === '' || x == null) return padrao;
  const n = Number(x);
  return Number.isFinite(n) ? n : padrao;
};
const dataValida = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function normalizarSeletor(s = {}) {
  return {
    fabricantes: lista(s?.fabricantes).map(String),
    marcas: lista(s?.marcas).map(String),
    subcategorias: lista(s?.subcategorias).map(String),
    grupos: lista(s?.grupos).map(Number).filter(Number.isFinite),
    ids: lista(s?.ids).map(Number).filter(Number.isFinite),
    excluir: lista(s?.excluir).map(Number).filter(Number.isFinite),
  };
}
const seletorVazio = (s) => !s.fabricantes.length && !s.marcas.length && !s.subcategorias.length && !s.ids.length && !s.grupos.length;

export function normalizarCriterio(cr = {}, i = 0) {
  const metrica = METRICAS[cr.metrica] ? cr.metrica : 'quantidade';
  const def = METRICAS[metrica];
  const meta = cr.meta || {};
  const valores = {};
  for (const [k, v] of Object.entries(meta.valores || {})) {
    const n = num(v);
    if (n != null) valores[String(k)] = n;
  }
  const expressao = String(cr.expressao || '');
  const rc = cr.regra_cliente || {};
  return {
    id: String(cr.id || `c${i + 1}`),
    nome: String(cr.nome || def.nome),
    produtos: normalizarSeletor(cr.produtos),
    produtos_ref: normalizarSeletor(cr.produtos_ref),
    metrica,
    expressao,
    formato: FORMATOS.includes(cr.formato) ? cr.formato : def.formato,
    totalizar: ['soma', 'media'].includes(cr.totalizar) ? cr.totalizar : def.totalizar || (expressao.includes('/') ? 'media' : 'soma'),
    combo: {
      itens: lista(cr.combo?.itens).map((it, k) => ({
        nome: String(it.nome || `Item ${k + 1}`),
        produtos: normalizarSeletor(it.produtos),
        minimo: Math.max(1, Math.round(num(it.minimo, 1))),
      })),
      escopo: cr.combo?.escopo === 'cliente' ? 'cliente' : 'pedido',
      contar: cr.combo?.contar === 'kits' ? 'kits' : 'ocorrencias',
    },
    regra_cliente: {
      min_qtd: Math.max(0, num(rc.min_qtd, 0)),
      min_valor: Math.max(0, num(rc.min_valor, 0)),
      min_skus: Math.max(0, Math.round(num(rc.min_skus, 0))),
      min_marcas: Math.max(0, Math.round(num(rc.min_marcas, 0))),
      min_pedidos: Math.max(0, Math.round(num(rc.min_pedidos, 0))),
    },
    regra_pedido: { min_qtd: Math.max(0, num(cr.regra_pedido?.min_qtd, 0)), min_valor: Math.max(0, num(cr.regra_pedido?.min_valor, 0)) },
    regra_sku: { min_clientes: Math.max(0, Math.round(num(cr.regra_sku?.min_clientes, 0))) },
    novos: { dias: Math.max(1, Math.round(num(cr.novos?.dias, 90))) },
    sentido: cr.sentido === 'menor' || (cr.sentido == null && def.sentido === 'menor') ? 'menor' : 'maior',
    meta: {
      tipo: TIPOS_META[meta.tipo] ? meta.tipo : 'fixa',
      valor: num(meta.valor, 0),
      distribuir_por: ['igual', 'historico', 'meta_geral'].includes(meta.distribuir_por) ? meta.distribuir_por : 'historico',
      crescimento: num(meta.crescimento, 10),
      piso: Math.max(0, num(meta.piso, 0)),
      base_inicio: dataValida(meta.base_inicio) ? meta.base_inicio : null,
      base_fim: dataValida(meta.base_fim) ? meta.base_fim : null,
      campo: meta.campo === 'meta_quantidade' ? 'meta_quantidade' : 'meta_valor',
      fator: num(meta.fator, 100),
      arredondar: typeof meta.arredondar === 'boolean' ? meta.arredondar : null,
      valores,
    },
    peso: Math.max(0, num(cr.peso, 1)),
    gatilho: Math.max(0, num(cr.gatilho, 0)),
    teto: num(cr.teto, null),
  };
}

export function normalizarCampanha(def = {}) {
  const hoje = hojeISO();
  const inicio = dataValida(def.inicio) ? def.inicio : `${hoje.slice(0, 8)}01`;
  let fim = dataValida(def.fim) ? def.fim : ultimoDiaMes(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)));
  if (fim < inicio) fim = inicio;
  const criterios = (lista(def.criterios).length ? def.criterios : [{}]).map(normalizarCriterio);
  const vistos = new Set();
  criterios.forEach((c, i) => {
    while (vistos.has(c.id)) c.id = `${c.id}_${i + 1}`;
    vistos.add(c.id);
  });
  const idsCrit = new Set(criterios.map((c) => c.id));
  const f = def.filtros || {};
  const p = def.premiacao || {};
  return {
    nome: String(def.nome || '').trim() || 'Nova campanha',
    fornecedor: String(def.fornecedor || (def.fabricante ? def.fabricante : def.varios_fornecedores ? 'Vários fornecedores' : '')),
    // fabricante da base a que a campanha está vinculada (null + varios_fornecedores = campanha geral)
    fabricante: def.fabricante ? String(def.fabricante) : null,
    varios_fornecedores: !def.fabricante && Boolean(def.varios_fornecedores),
    descricao: String(def.descricao || ''),
    cor: /^#[0-9a-f]{6}$/i.test(def.cor || '') ? def.cor : null,
    inicio,
    fim,
    data_base: def.data_base === 'faturamento' ? 'faturamento' : 'pedido',
    status_venda: lista(def.status_venda).length ? lista(def.status_venda).map(String) : ['Faturado'],
    calendario: ['uteis', 'corridos'].includes(def.calendario) ? def.calendario : null,
    participantes: {
      nivel: NIVEIS[def.participantes?.nivel] ? def.participantes.nivel : 'vendedor',
      ids: lista(def.participantes?.ids).map(String),
      equipes: lista(def.participantes?.equipes).map(String),
    },
    filtros: {
      canais: lista(f.canais).map(Number).filter(Number.isFinite),
      segmentos: lista(f.segmentos).map(String),
      portes: lista(f.portes).map(String),
      estados: lista(f.estados).map(String),
      cidades: lista(f.cidades).map(String),
      curvas: lista(f.curvas).map((x) => String(x).toUpperCase()).filter((x) => ['A', 'B', 'C'].includes(x)),
      clientes: lista(f.clientes).map(Number).filter(Number.isFinite),
      cfops: lista(f.cfops).map(String),
      cfops_excluir: lista(f.cfops_excluir).map(String),
    },
    criterios,
    apuracao: { regra: ['ponderada', 'todos', 'qualquer'].includes(def.apuracao?.regra) ? def.apuracao.regra : 'ponderada' },
    premiacao: {
      tipo: ['faixas', 'ranking', 'rateio', 'bloco', 'nenhuma'].includes(p.tipo) ? p.tipo : 'faixas',
      faixas: lista(p.faixas)
        .map((x) => ({ min: num(x.min, 100), fixo: num(x.fixo, 0), variavel: num(x.variavel, 0), rotulo: String(x.rotulo || '') }))
        .sort((a, b) => a.min - b.min),
      variavel_sobre: p.variavel_sobre === 'excedente' ? 'excedente' : 'total',
      criterio_base: idsCrit.has(p.criterio_base) ? p.criterio_base : criterios[0].id,
      ranking: {
        por: p.ranking?.por === 'realizado' ? 'realizado' : 'score',
        minimo: num(p.ranking?.minimo, 0),
        posicoes: lista(p.ranking?.posicoes).map((x) => {
          const de = Math.max(1, Math.round(num(x.de, 1)));
          return { de, ate: Math.max(de, Math.round(num(x.ate, de))), valor: num(x.valor, 0) };
        }),
      },
      rateio: {
        valor_total: num(p.rateio?.valor_total, 0),
        minimo: num(p.rateio?.minimo, 100),
        proporcional: ['igual', 'realizado', 'score'].includes(p.rateio?.proporcional) ? p.rateio.proporcional : 'realizado',
      },
      // "a cada 15 unidades, R$ 10": floor(realizado / tamanho) × valor
      bloco: {
        tamanho: Math.max(0.01, num(p.bloco?.tamanho, 15)),
        valor: num(p.bloco?.valor, 10),
        sobre: p.bloco?.sobre === 'excedente' ? 'excedente' : 'total',
        exigencia: ['nenhuma', 'quantidade', 'meta'].includes(p.bloco?.exigencia) ? p.bloco.exigencia : 'nenhuma',
        minimo: num(p.bloco?.minimo, 0),
        max_blocos: num(p.bloco?.max_blocos, null),
      },
      // prêmio fixo extra para quem atingir a meta (soma com ranking, rateio ou blocos)
      bonus: {
        ativo: !!p.bonus?.ativo,
        min: num(p.bonus?.min, 100),
        valor: num(p.bonus?.valor, 0),
      },
      multiplicadores: lista(p.multiplicadores)
        .filter((m) => idsCrit.has(m.criterio))
        .map((m) => ({ criterio: m.criterio, min: num(m.min, 100), fator: num(m.fator, 1), senao: num(m.senao, 1) })),
      teto_participante: num(p.teto_participante, null),
      orcamento: num(p.orcamento, null),
    },
  };
}

/** Erros que impedem salvar (avisos leves ficam no resultado da apuração). */
export function validarCampanha(c) {
  const erros = [];
  if (!c.nome || c.nome === 'Nova campanha') erros.push('Dê um nome para a campanha.');
  for (const cr of c.criterios) {
    if (cr.metrica === 'personalizada') {
      try {
        const f = compilar(cr.expressao, NOMES_VARS);
        const ruim = f.parametrizadas.find((p) => !MEDIDAS_PARAMETRIZAVEIS.includes(p.medida));
        if (ruim) erros.push(`Critério "${cr.nome}": a medida "${ruim.medida}" não pode ser recortada por filtros.`);
      } catch (e) {
        erros.push(`Critério "${cr.nome}": ${e.message}`);
      }
    }
    if (cr.metrica === 'combo' && cr.combo.itens.length < 1) erros.push(`Critério "${cr.nome}": inclua pelo menos um item na venda casada.`);
  }
  if (c.premiacao.tipo === 'faixas' && !c.premiacao.faixas.length) erros.push('Inclua ao menos uma faixa de premiação (ou escolha "sem premiação").');
  if (c.premiacao.tipo === 'ranking' && !c.premiacao.ranking.posicoes.length && !(c.premiacao.bonus.ativo && c.premiacao.bonus.valor > 0)) {
    erros.push('Inclua ao menos uma posição premiada no ranking (ou um prêmio para quem bater a meta).');
  }
  if (c.premiacao.tipo === 'bloco' && !(c.premiacao.bloco.valor > 0)) erros.push('Informe quanto vale cada bloco de vendas.');
  return erros;
}

// ======================================================================
// Tempo
// ======================================================================

export function dataReferencia(colData, cfg = lerConfig()) {
  if (dataValida(cfg.data_referencia)) return cfg.data_referencia;
  const hoje = hojeISO();
  const r = db.prepare(`SELECT MAX(${colData}) AS d FROM fato_vendas WHERE ${colData} <= ?`).get(hoje);
  return r?.d || hoje;
}

export function calcularTempo(inicio, fim, ref, cal, janela = 7) {
  const dias = intervalo(inicio, fim);
  const contaveis = dias.map(cal.conta);
  const total = contaveis.filter(Boolean).length;
  const base = { inicio, fim, referencia: ref, dias, contaveis, total, calendario: cal.rotulo };
  if (ref < inicio) {
    return { ...base, status: 'futura', idxRef: -1, decorridos: 0, restantes: total, progresso: 0, iniRecente: 0, nRecente: 0, dias_para_inicio: intervalo(ref, inicio).length - 1 };
  }
  const idxRef = ref >= fim ? dias.length - 1 : dias.indexOf(ref);
  let decorridos = 0;
  for (let i = 0; i <= idxRef; i++) if (contaveis[i]) decorridos++;
  let iniRecente = idxRef;
  let nRecente = 0;
  for (let k = idxRef; k >= 0 && nRecente < janela; k--) {
    if (contaveis[k]) {
      nRecente++;
      iniRecente = k;
    }
  }
  return {
    ...base,
    status: ref >= fim ? 'encerrada' : 'andamento',
    idxRef,
    decorridos,
    restantes: total - decorridos,
    progresso: total ? decorridos / total : 1,
    iniRecente,
    nRecente,
  };
}

function contexto(c, opcoes = {}) {
  const cfg = lerConfig();
  const colData = c.data_base === 'faturamento' ? 'data_faturamento' : 'data_pedido';
  const cal = criarCalendario(c.calendario || cfg.calendario, listaFeriados(cfg.feriados));
  const ref = dataValida(opcoes.referencia) ? opcoes.referencia : dataReferencia(colData, cfg);
  const tempo = calcularTempo(c.inicio, c.fim, ref, cal, Math.max(3, num(cfg.janela_recente, 7)));
  return { cfg, colData, cal, ref, tempo, avisos: [] };
}

// ======================================================================
// Coleta de dados (SQL)
// ======================================================================

const ph = (arr) => arr.map(() => '?').join(', ');
const ints = (arr) => (arr.length ? arr.map((x) => Math.trunc(Number(x))).join(', ') : '-1');
const OK = 'conta = 1 AND alvo = 1';
const temPerfil = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cliente_perfil'").get());

function produtosDoCriterio(cr) {
  let todos;
  let itens = [];
  if (cr.metrica === 'combo') {
    itens = cr.combo.itens.map((it) => resolverProdutos(it.produtos));
    todos = [...new Set(itens.flat())];
  } else {
    todos = resolverProdutos(cr.produtos);
  }
  // escopo de referência (denominador de share). Padrão: as subcategorias dos produtos do critério.
  let ref;
  if (!seletorVazio(cr.produtos_ref)) ref = resolverProdutos(cr.produtos_ref);
  else {
    const subs = new Set(todos.map((id) => produtoPorId(id)?.subcategoria));
    ref = catalogoProdutos().filter((p) => subs.has(p.subcategoria)).map((p) => p.id);
  }
  return { todos, itens, ref };
}

/** Filtros de cliente/venda da campanha em SQL (aliases v = fato_vendas, c = dm_cliente). */
function filtrosVenda(f, { semCfop = false } = {}) {
  const where = [];
  const params = [];
  if (f.canais.length) where.push(`v.id_canal IN (${ints(f.canais)})`);
  if (f.clientes.length) where.push(`v.id_cliente IN (${ints(f.clientes)})`);
  for (const [col, arr, neg] of [
    ['c.segmento', f.segmentos],
    ['c.porte', f.portes],
    ['c.estado', f.estados],
    ...(semCfop ? [] : [['v.cfop', f.cfops], ['v.cfop', f.cfops_excluir, true]]),
  ]) {
    if (arr.length) {
      where.push(`${col} ${neg ? 'NOT IN' : 'IN'} (${ph(arr)})`);
      params.push(...arr);
    }
  }
  if (f.cidades.length) {
    where.push(`((c.cidade || '/' || c.estado) IN (${ph(f.cidades)}) OR c.cidade IN (${ph(f.cidades)}))`);
    params.push(...f.cidades, ...f.cidades);
  }
  if (f.curvas.length && temPerfil()) {
    where.push(`v.id_cliente IN (SELECT id_cliente FROM cliente_perfil WHERE curva IN (${ph(f.curvas)}))`);
    params.push(...f.curvas);
  }
  return { where, params };
}

/** Cria a tabela temporária _base com as linhas de venda do escopo do critério (todas as situações, marcadas). */
function montarBase(c, cr, colData, inicio, fim, prod, vars) {
  db.exec('DROP TABLE IF EXISTS temp._base');
  const precisaRef = vars.has('qtd_ref') || vars.has('valor_ref');
  const precisaNovos = vars.has('clientes_novos');
  const precisaReat = vars.has('clientes_reativados');
  const universo = precisaRef ? [...new Set([...prod.todos, ...prod.ref])] : prod.todos;

  const pSel = [...c.status_venda];
  let novo = '0 AS novo';
  if (precisaNovos) {
    novo = `CASE WHEN v.id_cliente IN (
                SELECT id_cliente FROM fato_vendas
                 WHERE id_produto IN (${ints(prod.todos)}) AND status IN (${ph(c.status_venda)}) AND ${colData} BETWEEN ? AND ?
              ) THEN 0 ELSE 1 END AS novo`;
    pSel.push(...c.status_venda, addDias(inicio, -cr.novos.dias), addDias(inicio, -1));
  }
  let reat = '0 AS reativado';
  if (precisaReat) {
    reat = `CASE WHEN v.id_cliente IN (
                SELECT id_cliente FROM fato_vendas WHERE status IN (${ph(c.status_venda)}) AND ${colData} BETWEEN ? AND ?
              ) THEN 0 ELSE 1 END AS reativado`;
    pSel.push(...c.status_venda, addDias(inicio, -cr.novos.dias), addDias(inicio, -1));
  }

  const fv = filtrosVenda(c.filtros);
  // Catálogo inteiro: sem filtro de produto. Senão, "+v.id_produto" impede o SQLite de trocar o índice de data
  // (seletivo) pelo de produto (que varreria todo o histórico).
  const nCatalogo = catalogoProdutos().length;
  const todosNoUniverso = universo.length >= nCatalogo;
  const todosNoAlvo = prod.todos.length >= nCatalogo;
  const where = [`v.${colData} BETWEEN ? AND ?`, ...(todosNoUniverso ? [] : [`+v.id_produto IN (${ints(universo)})`]), ...fv.where];
  const pWhere = [inicio, fim, ...fv.params];
  const chave = NIVEIS[c.participantes.nivel].chaveSql;
  db.prepare(
    `CREATE TEMP TABLE _base AS
     SELECT CAST(${chave} AS TEXT) AS pk, v.${colData} AS dia, v.id_cliente, v.id_produto, v.id_pedido, v.id_vendedor,
            pr.marca AS marca, (c.cidade || '/' || c.estado) AS cidade,
            CASE WHEN v.status IN (${ph(c.status_venda)}) THEN 1 ELSE 0 END AS conta,
            CASE WHEN lower(v.status) LIKE 'devol%' THEN 1 ELSE 0 END AS dev,
            CASE WHEN lower(v.status) LIKE 'cancel%' THEN 1 ELSE 0 END AS canc,
            ${todosNoAlvo ? '1' : `CASE WHEN v.id_produto IN (${ints(prod.todos)}) THEN 1 ELSE 0 END`} AS alvo,
            ${precisaRef ? `CASE WHEN v.id_produto IN (${ints(prod.ref)}) THEN 1 ELSE 0 END` : '0'} AS ref,
            ${novo}, ${reat},
            v.quantidade AS qtd, v.valor_total AS valor, v.preco_lista * v.quantidade AS valor_lista,
            v.custo_total AS custo, v.margem_bruta AS margem, v.valor_impostos_total AS impostos,
            v.valor_icms AS icms, v.valor_pis AS pis, v.valor_cofins AS cofins,
            v.valor_total * COALESCE(cn.comissao_perc, 0) / 100.0 AS comissao
       FROM fato_vendas v
       LEFT JOIN dm_cliente c ON c.id_cliente = v.id_cliente
       LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor
       LEFT JOIN dm_canal cn ON cn.id_canal = v.id_canal
       LEFT JOIN dm_produto pr ON pr.id_produto = v.id_produto
      WHERE ${where.join(' AND ')}`,
  ).run(...c.status_venda, ...pSel.slice(c.status_venda.length), ...pWhere);
}

/** Poder de compra de cada cliente (R$ nos 90 dias antes do início): pesa a distribuição ponderada.
 *  Fica na conexão e só é refeito quando muda a base, o início ou a situação das vendas (a prévia do construtor reaproveita). */
let pesosChave = null;
function montarPesos(c, colData) {
  const chave = `${versaoDados()}|${colData}|${c.inicio}|${c.status_venda.join(',')}`;
  if (chave === pesosChave) return;
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _peso (id_cliente INTEGER PRIMARY KEY, peso REAL)');
  db.exec('DELETE FROM temp._peso');
  db.prepare(
    `INSERT INTO temp._peso (id_cliente, peso)
     SELECT id_cliente, SUM(valor_total) FROM fato_vendas
      WHERE status IN (${ph(c.status_venda)}) AND ${colData} BETWEEN ? AND ? GROUP BY id_cliente`,
  ).run(...c.status_venda, addDias(c.inicio, -90), addDias(c.inicio, -1));
  pesosChave = chave;
}

const novaSerie = (vars, n) => {
  const s = {};
  for (const v of vars) s[v] = new Float64Array(n);
  return s;
};

/** SQL do "dia em que o cliente ficou positivado" respeitando a positivação qualificada. */
function sqlPositivados(extra, th) {
  const base = `FROM _base WHERE ${OK} ${extra}`;
  const ctes = [`d AS (SELECT pk, id_cliente, dia, SUM(qtd) AS q, SUM(valor) AS v, 0 AS s, 0 AS m, 0 AS p ${base} GROUP BY pk, id_cliente, dia)`];
  const unioes = ['SELECT pk, id_cliente, dia, q, v, s, m, p FROM d'];
  const distinto = (nome, col, campo) => {
    ctes.push(
      `${nome} AS (SELECT pk, id_cliente, dia, 0 AS q, 0 AS v, ${campo === 's' ? 'COUNT(*)' : '0'} AS s, ${campo === 'm' ? 'COUNT(*)' : '0'} AS m, ${campo === 'p' ? 'COUNT(*)' : '0'} AS p
         FROM (SELECT pk, id_cliente, ${col}, MIN(dia) AS dia ${base} GROUP BY pk, id_cliente, ${col}) GROUP BY pk, id_cliente, dia)`,
    );
    unioes.push(`SELECT pk, id_cliente, dia, q, v, s, m, p FROM ${nome}`);
  };
  if (th.s > 0) distinto('ds', 'id_produto', 's');
  if (th.m > 0) distinto('dm', 'marca', 'm');
  if (th.p > 0) distinto('dp', 'id_pedido', 'p');
  return `WITH ${ctes.join(',\n')},
    u AS (SELECT pk, id_cliente, dia, SUM(q) AS q, SUM(v) AS v, SUM(s) AS s, SUM(m) AS m, SUM(p) AS p FROM (${unioes.join(' UNION ALL ')}) GROUP BY pk, id_cliente, dia),
    a AS (SELECT pk, id_cliente, dia, SUM(q) OVER w AS cq, SUM(v) OVER w AS cv, SUM(s) OVER w AS cs, SUM(m) OVER w AS cm, SUM(p) OVER w AS cp
            FROM u WINDOW w AS (PARTITION BY pk, id_cliente ORDER BY dia ROWS UNBOUNDED PRECEDING)),
    f AS (SELECT pk, id_cliente, MIN(dia) AS dia FROM a WHERE cq >= ? AND cv >= ? AND cs >= ? AND cm >= ? AND cp >= ? GROUP BY pk, id_cliente)
    SELECT f.pk, f.dia, COUNT(*) AS n, SUM(COALESCE(w.peso, 0)) AS peso, COUNT(DISTINCT cl.cidade || '/' || cl.estado) AS cid
      FROM f LEFT JOIN temp._peso w ON w.id_cliente = f.id_cliente LEFT JOIN dm_cliente cl ON cl.id_cliente = f.id_cliente
     GROUP BY f.pk, f.dia`;
}

/**
 * Lê a _base e devolve, por participante, as séries ACUMULADAS por dia de cada variável necessária.
 * @returns {Map<string, Record<string, Float64Array>>}
 */
function lerSeries(cr, prod, dias, vars) {
  const n = dias.length;
  const idx = new Map(dias.map((d, i) => [d, i]));
  const porPk = new Map();
  const obter = (pk) => {
    let s = porPk.get(pk);
    if (!s) porPk.set(pk, (s = novaSerie(vars, n)));
    return s;
  };
  const somar = (linhas, mapa) => {
    for (const r of linhas) {
      const i = idx.get(r.dia);
      if (i === undefined) continue;
      const s = obter(r.pk);
      for (const [v, col] of mapa) if (s[v]) s[v][i] += r[col] || 0;
    }
  };
  const tem = (...vs) => vs.some((v) => vars.has(v));

  somar(
    db.prepare(
      `SELECT pk, dia, SUM(qtd) AS qtd, SUM(valor) AS valor, SUM(valor_lista) AS valor_lista, SUM(custo) AS custo,
              SUM(margem) AS margem, SUM(impostos) AS impostos, SUM(icms) AS icms, SUM(pis) AS pis, SUM(cofins) AS cofins,
              SUM(comissao) AS comissao, COUNT(*) AS linhas
         FROM _base WHERE ${OK} GROUP BY pk, dia`,
    ).all(),
    ADITIVAS.filter((v) => vars.has(v)).map((v) => [v, v]),
  );
  if (tem('qtd_dev', 'valor_dev')) {
    somar(db.prepare(`SELECT pk, dia, SUM(qtd) AS q, SUM(valor) AS v FROM _base WHERE dev = 1 AND alvo = 1 GROUP BY pk, dia`).all(), [['qtd_dev', 'q'], ['valor_dev', 'v']]);
  }
  if (tem('qtd_canc', 'valor_canc')) {
    somar(db.prepare(`SELECT pk, dia, SUM(qtd) AS q, SUM(valor) AS v FROM _base WHERE canc = 1 AND alvo = 1 GROUP BY pk, dia`).all(), [['qtd_canc', 'q'], ['valor_canc', 'v']]);
  }
  if (tem('qtd_ref', 'valor_ref')) {
    somar(db.prepare(`SELECT pk, dia, SUM(qtd) AS q, SUM(valor) AS v FROM _base WHERE conta = 1 AND ref = 1 GROUP BY pk, dia`).all(), [['qtd_ref', 'q'], ['valor_ref', 'v']]);
  }

  // "primeira vez": cada entidade distinta conta no dia em que aparece pela primeira vez
  const primeiraVez = (v, cols) => {
    if (!vars.has(v)) return;
    somar(db.prepare(`SELECT pk, dia, COUNT(*) AS n FROM (SELECT pk, MIN(dia) AS dia FROM _base WHERE ${OK} GROUP BY pk, ${cols}) GROUP BY pk, dia`).all(), [[v, 'n']]);
  };
  primeiraVez('cli_skus', 'id_cliente, id_produto');
  primeiraVez('marcas', 'marca');
  primeiraVez('dias_venda', 'dia');

  if (vars.has('skus')) {
    if (cr.regra_sku.min_clientes > 1) {
      // SKU conta no dia em que atinge N clientes distintos
      somar(
        db.prepare(
          `WITH pc AS (SELECT pk, id_produto, id_cliente, MIN(dia) AS dia FROM _base WHERE ${OK} GROUP BY pk, id_produto, id_cliente),
                d AS (SELECT pk, id_produto, dia, COUNT(*) AS n FROM pc GROUP BY pk, id_produto, dia),
                a AS (SELECT pk, id_produto, dia, SUM(n) OVER (PARTITION BY pk, id_produto ORDER BY dia ROWS UNBOUNDED PRECEDING) AS cn FROM d),
                f AS (SELECT pk, id_produto, MIN(dia) AS dia FROM a WHERE cn >= ? GROUP BY pk, id_produto)
           SELECT pk, dia, COUNT(*) AS n FROM f GROUP BY pk, dia`,
        ).all(cr.regra_sku.min_clientes),
        [['skus', 'n']],
      );
    } else primeiraVez('skus', 'id_produto');
  }

  if (vars.has('pedidos')) {
    somar(
      db.prepare(
        `SELECT pk, dia, COUNT(*) AS n FROM (
           SELECT pk, MIN(dia) AS dia FROM _base WHERE ${OK} GROUP BY pk, id_pedido HAVING SUM(qtd) >= ? AND SUM(valor) >= ?
         ) GROUP BY pk, dia`,
      ).all(cr.regra_pedido.min_qtd, cr.regra_pedido.min_valor),
      [['pedidos', 'n']],
    );
  }

  const rc = cr.regra_cliente;
  const thCliente = { q: rc.min_qtd, v: rc.min_valor, s: rc.min_skus, m: rc.min_marcas, p: rc.min_pedidos };
  const positivados = (extra, th, mapa) => {
    somar(db.prepare(sqlPositivados(extra, th)).all(th.q || 0, th.v || 0, th.s || 0, th.m || 0, th.p || 0), mapa);
  };
  if (tem('clientes', 'peso_positivados')) positivados('', thCliente, [['clientes', 'n'], ['peso_positivados', 'peso']]);
  if (vars.has('clientes_novos')) positivados('AND novo = 1', thCliente, [['clientes_novos', 'n']]);
  if (vars.has('clientes_reativados')) positivados('AND reativado = 1', thCliente, [['clientes_reativados', 'n']]);
  if (vars.has('clientes_rec')) positivados('', { q: 0, v: 0, s: 0, m: 0, p: 2 }, [['clientes_rec', 'n']]);
  if (vars.has('cidades')) {
    // cidade conta no dia do primeiro cliente positivado dela
    somar(
      db.prepare(
        `SELECT pk, dia, COUNT(*) AS n FROM (
           SELECT pk, cidade, MIN(dia) AS dia FROM _base WHERE ${OK} AND cidade IS NOT NULL GROUP BY pk, cidade
         ) GROUP BY pk, dia`,
      ).all(),
      [['cidades', 'n']],
    );
  }

  if (cr.metrica === 'combo' && prod.itens.length && tem('combos', 'kits')) {
    const unidade = cr.combo.escopo === 'cliente' ? 'id_cliente' : 'id_pedido';
    const somas = prod.itens.map((ids, k) => `SUM(CASE WHEN id_produto IN (${ints(ids)}) THEN qtd ELSE 0 END) AS q${k}`).join(', ');
    const mins = cr.combo.itens.map((it) => it.minimo);
    const completo = mins.map((m, k) => `q${k} >= ${m}`).join(' AND ');
    const partes = mins.map((m, k) => `CAST(q${k} / ${m} AS INTEGER)`);
    const kits = partes.length > 1 ? `MIN(${partes.join(', ')})` : partes[0];
    somar(
      db.prepare(
        `SELECT pk, dia, SUM(CASE WHEN ${completo} THEN 1 ELSE 0 END) AS combos, SUM(${kits}) AS kits
           FROM (SELECT pk, ${unidade}, ${cr.combo.escopo === 'cliente' ? 'MAX' : 'MIN'}(dia) AS dia, ${somas}
                   FROM _base WHERE conta = 1 GROUP BY pk, ${unidade})
          GROUP BY pk, dia`,
      ).all(),
      [['combos', 'combos'], ['kits', 'kits']],
    );
  }

  for (const s of porPk.values()) {
    for (const v of vars) {
      const a = s[v];
      for (let i = 1; i < n; i++) a[i] += a[i - 1];
    }
  }
  return porPk;
}

function funcaoMetrica(cr) {
  const expr =
    cr.metrica === 'personalizada' ? cr.expressao : cr.metrica === 'combo' ? (cr.combo.contar === 'kits' ? 'kits' : 'combos') : METRICAS[cr.metrica].expr;
  return compilar(expr, NOMES_VARS);
}

const valoresEm = (s, vars, i) => {
  const o = {};
  for (const v of vars) o[v] = s && i >= 0 && s[v] ? s[v][i] : 0;
  return o;
};

function projetarVar(cum, t, peso) {
  if (t.idxRef < 0) return 0;
  const atual = cum[t.idxRef];
  if (t.status !== 'andamento' || t.decorridos === 0 || t.restantes <= 0) return atual;
  const mediaDia = atual / t.decorridos;
  if (t.decorridos < 3 || t.nRecente === 0) return atual + mediaDia * t.restantes;
  const somaRecente = atual - (t.iniRecente > 0 ? cum[t.iniRecente - 1] : 0);
  const recenteDia = somaRecente / t.nRecente;
  return atual + (peso * recenteDia + (1 - peso) * mediaDia) * t.restantes;
}

/** Projeção de cada variável para o fim do período. `especiais` diz como tratar constantes e recortes. */
const projecoes = (s, vars, t, especiais = {}) => {
  const o = {};
  for (const v of vars) {
    if (!s || !s[v]) o[v] = 0;
    else if (CONSTANTES.has(v) || especiais.constantes?.has(v)) o[v] = s[v][s[v].length - 1];
    else if (TEMPO.has(v)) o[v] = t.total;
    else if (especiais.maturacao?.has(v) && t.status === 'andamento' && t.idxRef >= 0) {
      const atual = s[v][t.idxRef];
      o[v] = Math.max(atual, atual * especiais.maturacao.get(v));
    } else if (especiais.curva?.has(v) && t.status === 'andamento' && t.idxRef >= 0) {
      // volume: metade pela curva do período anterior (capta fim de mês, dias da semana), metade pelo ritmo
      const atual = s[v][t.idxRef];
      const pelaCurva = atual * especiais.curva.get(v);
      const peloRitmo = projetarVar(s[v], t, especiais.pesos?.get(v) ?? PESO_RECENTE[v] ?? 0.5);
      o[v] = Math.max(atual, 0.5 * pelaCurva + 0.5 * peloRitmo);
    } else o[v] = projetarVar(s[v], t, especiais.pesos?.get(v) ?? PESO_RECENTE[v] ?? 0.5);
  }
  return o;
};

/** Variáveis que dependem de dados (sem as constantes/recortes, que o motor injeta). */
function varsDeDados(vars) {
  const out = new Set([...vars].filter((v) => NOMES_VARS.includes(v) && !CONSTANTES.has(v) && !TEMPO.has(v)));
  for (const [ant, origem] of Object.entries(ANTERIOR)) if (vars.has(ant)) out.add(origem);
  return out;
}

function coletar(c, cr, colData, inicio, fim, dias, prod, vars) {
  const dados = varsDeDados(vars);
  montarBase(c, cr, colData, inicio, fim, prod, dados);
  return lerSeries(cr, prod, dias, dados);
}

// ---------------------------------------------------------------- constantes por participante

/** Carteira (base_clientes), base ativa (clientes_ativos) e poder de compra da base (peso_base). */
function constantesParticipantes(c, ctx, participantes, vars) {
  const out = new Map(participantes.map((p) => [p.chave, { base_clientes: 0, clientes_ativos: 0, peso_base: 0 }]));
  const nivel = c.participantes.nivel;
  const f = c.filtros;
  const fv = filtrosVenda({ ...f, canais: [], cfops: [], cfops_excluir: [] }, { semCfop: true });
  const whereCli = fv.where.filter((w) => !w.startsWith('v.id_canal')).map((w) => w.replace(/v\.id_cliente/g, 'c.id_cliente'));
  if (vars.has('base_clientes')) {
    const chaveCarteira = {
      vendedor: 'c.id_vendedor',
      equipe: 'COALESCE(vd.id_superior, c.id_vendedor)',
      cliente: 'c.id_cliente',
      estado: 'c.estado',
      segmento: 'c.segmento',
      empresa: "'empresa'",
    }[nivel];
    if (chaveCarteira) {
      for (const r of db
        .prepare(
          `SELECT CAST(${chaveCarteira} AS TEXT) AS pk, COUNT(*) AS n FROM dm_cliente c
             LEFT JOIN dm_vendedor vd ON vd.id_vendedor = c.id_vendedor
            ${whereCli.length ? `WHERE ${whereCli.join(' AND ')}` : ''} GROUP BY 1`,
        )
        .all(...fv.params)) {
        if (out.has(r.pk)) out.get(r.pk).base_clientes = r.n;
      }
    }
  }
  if (vars.has('clientes_ativos') || vars.has('peso_base') || (vars.has('base_clientes') && nivel === 'canal')) {
    const chave = NIVEIS[nivel].chaveSql;
    const fvv = filtrosVenda(f);
    for (const r of db
      .prepare(
        `SELECT x.pk, COUNT(*) AS n, SUM(COALESCE(w.peso, 0)) AS peso FROM (
           SELECT DISTINCT CAST(${chave} AS TEXT) AS pk, v.id_cliente FROM fato_vendas v
             LEFT JOIN dm_cliente c ON c.id_cliente = v.id_cliente
             LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor
            WHERE v.${ctx.colData} BETWEEN ? AND ? AND v.status IN (${ph(c.status_venda)}) ${fvv.where.length ? `AND ${fvv.where.join(' AND ')}` : ''}
         ) x LEFT JOIN temp._peso w ON w.id_cliente = x.id_cliente GROUP BY x.pk`,
      )
      .all(addDias(c.inicio, -90), addDias(c.inicio, -1), ...c.status_venda, ...fvv.params)) {
      const o = out.get(r.pk);
      if (!o) continue;
      o.clientes_ativos = r.n;
      o.peso_base = r.peso;
      if (nivel === 'canal') o.base_clientes = r.n;
    }
  }
  return out;
}

// ---------------------------------------------------------------- variáveis parametrizadas

function aplicarRecorte(c, cr, filtros) {
  const c2 = structuredClone(c);
  const cr2 = structuredClone(cr);
  const prodDims = ['fabricante', 'marca', 'subcategoria', 'grupo', 'produto'];
  if (prodDims.some((d) => filtros[d])) {
    const grupos = gruposDeProdutos();
    const porNome = new Map([...grupos].map(([id, g]) => [g.nome.toLowerCase(), id]));
    cr2.produtos = {
      fabricantes: filtros.fabricante || [],
      marcas: filtros.marca || [],
      subcategorias: filtros.subcategoria || [],
      grupos: (filtros.grupo || []).map((g) => (Number.isFinite(Number(g)) ? Number(g) : porNome.get(String(g).toLowerCase()))).filter((x) => x != null),
      ids: (filtros.produto || []).map(Number).filter(Number.isFinite),
      excluir: [],
    };
    if (cr2.metrica === 'combo') cr2.metrica = 'quantidade';
  }
  const cruzar = (atual, novos) => (atual.length ? atual.filter((x) => novos.map(String).includes(String(x))) : novos);
  if (filtros.canal) {
    const canais = db.prepare('SELECT id_canal, nome_canal FROM dm_canal').all();
    const ids = filtros.canal
      .map((x) => (Number.isFinite(Number(x)) ? Number(x) : canais.find((k) => k.nome_canal.toLowerCase() === String(x).toLowerCase())?.id_canal))
      .filter((x) => x != null);
    c2.filtros.canais = cruzar(c2.filtros.canais, ids).map(Number);
    if (!c2.filtros.canais.length) c2.filtros.canais = [-1];
  }
  for (const [dim, campo] of [['segmento', 'segmentos'], ['porte', 'portes'], ['estado', 'estados'], ['cidade', 'cidades'], ['curva', 'curvas'], ['cfop', 'cfops']]) {
    if (filtros[dim]) {
      c2.filtros[campo] = cruzar(c2.filtros[campo], filtros[dim].map((x) => (dim === 'curva' ? String(x).toUpperCase() : String(x))));
      if (!c2.filtros[campo].length) c2.filtros[campo] = ['__nenhum__'];
    }
  }
  if (filtros.status) c2.status_venda = filtros.status;
  return { c2, cr2, anterior: (filtros.periodo || []).some((p) => /anterior/i.test(p)) };
}

/** Calcula cada variável parametrizada e injeta nas séries por participante. */
function injetarRecortes(c, cr, fn, ctx, series, dias, inicio, fim, per, especiais) {
  for (const p of fn.parametrizadas || []) {
    if (!MEDIDAS_PARAMETRIZAVEIS.includes(p.medida)) {
      ctx.avisos.push(`Critério "${cr.nome}": a medida "${p.medida}" não pode ser recortada (${p.chave}).`);
      continue;
    }
    const { c2, cr2, anterior } = aplicarRecorte(c, cr, p.filtros);
    const prod = produtosDoCriterio(cr2);
    const vars = new Set([p.medida]);
    const n = dias.length;
    let fonte;
    if (anterior) {
      const diasPer = intervalo(per.inicio, per.fim);
      fonte = coletar(c2, cr2, ctx.colData, per.inicio, per.fim, diasPer, prod, vars);
      especiais.constantes.add(p.chave);
      for (const [pk, s] of series) {
        const b = fonte.get(pk)?.[p.medida];
        const arr = new Float64Array(n);
        if (b) for (let i = 0; i < n; i++) arr[i] = b[Math.min(b.length - 1, Math.max(0, Math.round(((i + 1) / n) * b.length) - 1))];
        s[p.chave] = arr;
      }
    } else {
      fonte = fim ? coletar(c2, cr2, ctx.colData, inicio, fim, dias, prod, vars) : new Map();
      especiais.pesos.set(p.chave, PESO_RECENTE[p.medida] ?? 0.5);
      for (const [pk, s] of series) s[p.chave] = fonte.get(pk)?.[p.medida] || new Float64Array(n);
    }
  }
}

// ======================================================================
// Metas
// ======================================================================

function distribuir(total, pesos, inteiro) {
  let soma = pesos.reduce((a, b) => a + b, 0);
  if (!(soma > 0)) {
    pesos = pesos.map(() => 1);
    soma = pesos.length;
  }
  const brutos = pesos.map((p) => (total * p) / soma);
  if (!inteiro) return brutos.map((x) => Math.round(x * 100) / 100);
  const base = brutos.map(Math.floor);
  let resto = Math.round(total - base.reduce((a, b) => a + b, 0));
  const ordem = brutos.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; resto > 0 && k < ordem.length; k++, resto--) base[ordem[k][1]]++;
  return base;
}

function metaGeral(c, participantes, campo, ctx) {
  const nivel = c.participantes.nivel;
  if (!['vendedor', 'equipe', 'empresa'].includes(nivel)) {
    ctx.avisos.push('Meta geral (fato_metas) só existe para vendedores, equipes ou empresa.');
    return new Map();
  }
  // meses cobertos pela campanha, proporcionais aos dias contáveis dentro dela
  const partes = [];
  let cursor = `${c.inicio.slice(0, 7)}-01`;
  while (cursor <= c.fim) {
    const ano = Number(cursor.slice(0, 4));
    const mes = Number(cursor.slice(5, 7));
    const fimMes = ultimoDiaMes(ano, mes);
    const diasMes = intervalo(cursor, fimMes);
    const noMes = diasMes.filter(ctx.cal.conta).length || diasMes.length;
    const dentro = diasMes.filter((d) => d >= c.inicio && d <= c.fim);
    partes.push({ ano, mes, fracao: dentro.filter(ctx.cal.conta).length / noMes });
    cursor = addDias(fimMes, 1);
  }
  const porVendedor = new Map();
  // só metas de vendedores: a linha do gerente costuma ser a soma da equipe (contaria em dobro em equipe/empresa)
  const st = db.prepare(
    `SELECT f.id_vendedor, SUM(f.${campo}) AS m FROM fato_metas f JOIN dm_vendedor v ON v.id_vendedor = f.id_vendedor
      WHERE f.ano = ? AND f.mes = ? AND (lower(COALESCE(v.nivel, '')) NOT IN ('gerente', 'coordenador') OR f.id_vendedor IN (SELECT DISTINCT id_vendedor FROM fato_vendas))
      GROUP BY f.id_vendedor`,
  );
  for (const { ano, mes, fracao } of partes) {
    for (const r of st.all(ano, mes)) porVendedor.set(String(r.id_vendedor), (porVendedor.get(String(r.id_vendedor)) || 0) + r.m * fracao);
  }
  if (!porVendedor.size) ctx.avisos.push('Não há metas gerais (fato_metas) para o período da campanha.');
  if (nivel === 'vendedor') return porVendedor;
  if (nivel === 'empresa') return new Map([['empresa', [...porVendedor.values()].reduce((a, b) => a + b, 0)]]);
  const out = new Map();
  for (const p of participantes) {
    const membros = vendedoresDoParticipante('equipe', p.chave).map(String);
    out.set(p.chave, membros.reduce((a, v) => a + (porVendedor.get(v) || 0), 0));
  }
  return out;
}

function calcularMetas(c, cr, participantes, historico, ctx) {
  const m = cr.meta;
  const inteiro = m.arredondar ?? cr.formato === 'numero';
  const arred = (x) => (inteiro ? Math.ceil(x - 1e-9) : Math.round(x * 100) / 100);
  const metas = new Map();
  const usaHistorico = m.tipo === 'historico' || (m.tipo === 'distribuida' && m.distribuir_por === 'historico');
  if (usaHistorico && ![...historico.values()].some((x) => x > 0)) {
    ctx.avisos.push(`Critério "${cr.nome}": não há vendas no período-base para calcular metas por histórico.`);
  }
  switch (m.tipo) {
    case 'fixa':
      for (const p of participantes) metas.set(p.chave, m.valor);
      break;
    case 'distribuida': {
      let pesos;
      if (m.distribuir_por === 'historico') {
        pesos = participantes.map((p) => Math.max(0, historico.get(p.chave) || 0));
        // suavização: quem não tem histórico recebe uma fatia pequena em vez de zero
        const media = pesos.reduce((a, b) => a + b, 0) / (pesos.length || 1);
        pesos = pesos.map((x) => x + media * 0.1);
      } else if (m.distribuir_por === 'meta_geral') {
        const mg = metaGeral(c, participantes, m.campo, ctx);
        pesos = participantes.map((p) => mg.get(p.chave) || 0);
      } else {
        pesos = participantes.map(() => 1);
      }
      distribuir(m.valor, pesos, inteiro).forEach((v, i) => metas.set(participantes[i].chave, v));
      break;
    }
    case 'historico':
      for (const p of participantes) {
        const base = historico.get(p.chave) || 0;
        metas.set(p.chave, Math.max(m.piso, arred(base * (1 + m.crescimento / 100))));
      }
      break;
    case 'meta_geral': {
      const mg = metaGeral(c, participantes, m.campo, ctx);
      for (const p of participantes) metas.set(p.chave, arred(((mg.get(p.chave) || 0) * m.fator) / 100));
      break;
    }
    case 'sem_meta':
      break;
  }
  const chaves = new Set(participantes.map((p) => p.chave));
  for (const [k, v] of Object.entries(m.valores)) if (chaves.has(k)) metas.set(k, v);
  return metas;
}

// ======================================================================
// Pontuação e premiação
// ======================================================================

function atingimento(real, meta, sentido) {
  if (meta == null || real == null || !(meta > 0)) return null;
  if (sentido === 'menor') return real <= 0 ? 100 : (meta / real) * 100;
  return (real / meta) * 100;
}

const EPS = 1e-9;

function pontuar(atings, criterios, regra) {
  let somaPeso = 0;
  let soma = 0;
  let maior = null;
  let elegivel = true;
  let algum = false;
  atings.forEach((a, i) => {
    const cr = criterios[i];
    if (a == null) return;
    algum = true;
    const abaixo = cr.gatilho > 0 && a + EPS < cr.gatilho;
    if (abaixo && regra === 'todos') elegivel = false;
    let v = Math.max(0, cr.teto != null ? Math.min(a, cr.teto) : a);
    if (abaixo && regra === 'ponderada') v = 0;
    soma += v * cr.peso;
    somaPeso += cr.peso;
    maior = maior == null ? v : Math.max(maior, v);
  });
  if (!algum) return { score: null, elegivel: false };
  const score = regra === 'qualquer' ? maior : somaPeso > 0 ? soma / somaPeso : null;
  return { score, elegivel };
}

function faixaDe(score, faixas) {
  let f = null;
  if (score == null) return null;
  for (const x of faixas) if (score + EPS >= x.min) f = x;
  return f;
}

/**
 * Calcula prêmio atual e projetado para todos os participantes (muta as linhas).
 * Cada componente (faixa, posição, parte do rateio, blocos, bônus por meta) entra em `premio_partes`;
 * multiplicadores e teto valem sobre a soma. `proxima_faixa` diz o próximo degrau do prêmio
 * (tipo: faixa | bloco | gatilho | bonus) e `proximo_bonus` o bônus por meta ainda não alcançado.
 */
function premiar(c, linhas, idxBase) {
  const pr = c.premiacao;
  const crBase = c.criterios[idxBase] || c.criterios[0];
  const real = (l, proj) => l.criterios[idxBase]?.[proj ? 'projecao' : 'realizado'] ?? 0;
  const baseVariavel = (l, proj) => {
    const r = Math.max(0, real(l, proj));
    return pr.variavel_sobre === 'excedente' ? Math.max(0, r - (l.criterios[idxBase]?.meta ?? 0)) : r;
  };
  const idxCrit = new Map(c.criterios.map((cr, i) => [cr.id, i]));
  const fator = (l, proj) =>
    pr.multiplicadores.reduce((f, m) => {
      const a = l.criterios[idxCrit.get(m.criterio)]?.[proj ? 'atingimento_proj' : 'atingimento'];
      return f * (a != null && a + EPS >= m.min ? m.fator : m.senao);
    }, 1);
  const finalizar = (l, bruto, proj) => {
    let v = bruto > 0 ? bruto * fator(l, proj) : 0;
    if (pr.teto_participante != null && pr.teto_participante >= 0) v = Math.min(v, pr.teto_participante);
    return Math.round(v * 100) / 100;
  };
  const sc = (l, proj) => (proj ? l.score_proj : l.score);
  const eleg = (l, proj) => (proj ? l.elegivel_proj : l.elegivel);
  const bateu = (l, proj, min) => eleg(l, proj) && sc(l, proj) != null && sc(l, proj) + EPS >= min;
  const inteiro = (x) => (crBase.formato === 'numero' ? Math.ceil(x - EPS) : x);
  // unidades do critério que faltam para chegar a `min`% da meta (só dá para traduzir com um critério somável)
  const faltaUnidades = (l, min) => {
    const cl = c.criterios.length === 1 ? l.criterios[0] : null;
    const cd = c.criterios[0];
    if (!cl || !(cl.meta > 0) || cd.sentido !== 'maior' || cd.totalizar !== 'soma' || cl.realizado == null) return null;
    const f = Math.max(0, (min / 100) * cl.meta - cl.realizado);
    return cd.formato === 'numero' ? Math.ceil(f - EPS) : f;
  };
  const somar = (l, proj, parte) => {
    if (parte.valor > 0) (proj ? l.premio_partes_proj : l.premio_partes).push({ ...parte, valor: Math.round(parte.valor * 100) / 100 });
  };
  const soma = (partes) => partes.reduce((a, p) => a + p.valor, 0);

  // ---- blocos: "a cada N unidades, R$ X" ----
  const b = pr.bloco;
  const metaBase = (l) => l.criterios[idxBase]?.meta;
  const baseBloco = (l, realizado) => {
    const r = Math.max(0, realizado);
    const m = metaBase(l);
    return b.sobre === 'excedente' && m != null ? Math.max(0, r - m) : r;
  };
  const liberado = (l, proj) => {
    if (sc(l, proj) != null && !eleg(l, proj)) return false; // gatilhos de critério continuam valendo
    if (b.exigencia === 'meta') return bateu(l, proj, b.minimo);
    if (b.exigencia === 'quantidade') return Math.max(0, real(l, proj)) + EPS >= b.minimo;
    return true;
  };
  const blocosEm = (l, realizado) => {
    let n = Math.floor(baseBloco(l, realizado) / b.tamanho + EPS);
    if (b.max_blocos != null && b.max_blocos >= 0) n = Math.min(n, b.max_blocos);
    return Math.max(0, n);
  };
  const blocosDe = (l, proj) => (liberado(l, proj) ? blocosEm(l, real(l, proj)) : 0);

  for (const l of linhas) {
    l.premio = 0;
    l.premio_proj = 0;
    l.premio_partes = [];
    l.premio_partes_proj = [];
    l.faixa = null;
    l.faixa_proj = null;
    l.proxima_faixa = null;
    l.proximo_bonus = null;
    l.multiplicador = pr.multiplicadores.length ? fator(l, false) : 1;
  }

  if (pr.tipo === 'faixas') {
    for (const l of linhas) {
      for (const proj of [false, true]) {
        const f = eleg(l, proj) ? faixaDe(sc(l, proj), pr.faixas) : null;
        const idx = f ? pr.faixas.indexOf(f) : null;
        if (proj) l.faixa_proj = idx;
        else l.faixa = idx;
        if (f) somar(l, proj, { tipo: 'faixa', rotulo: f.rotulo || `Faixa de ${f.min}%`, valor: f.fixo + f.variavel * baseVariavel(l, proj) });
      }
    }
  } else if (pr.tipo === 'ranking') {
    for (const proj of [false, true]) {
      const valor = (l) => (pr.ranking.por === 'realizado' ? real(l, proj) : sc(l, proj));
      const aptos = linhas
        .filter((l) => {
          const v = valor(l);
          if (v == null || v <= 0) return false;
          return !(pr.ranking.minimo > 0) || (sc(l, proj) != null && sc(l, proj) + EPS >= pr.ranking.minimo);
        })
        .sort((x, y) => valor(y) - valor(x) || real(y, proj) - real(x, proj));
      aptos.forEach((l, i) => {
        const pos = i + 1;
        const faixa = pr.ranking.posicoes.find((x) => pos >= x.de && pos <= x.ate);
        if (faixa) somar(l, proj, { tipo: 'posicao', rotulo: `${pos}º lugar no ranking`, posicao: pos, valor: faixa.valor });
      });
    }
  } else if (pr.tipo === 'rateio') {
    for (const proj of [false, true]) {
      const aptos = linhas.filter((l) => eleg(l, proj) && sc(l, proj) != null && sc(l, proj) + EPS >= pr.rateio.minimo);
      const peso = (l) => (pr.rateio.proporcional === 'igual' ? 1 : pr.rateio.proporcional === 'score' ? sc(l, proj) : Math.max(0, real(l, proj)));
      const somaPesos = aptos.reduce((a, l) => a + peso(l), 0);
      for (const l of aptos) {
        somar(l, proj, { tipo: 'rateio', rotulo: 'Parte da verba dividida', valor: somaPesos > 0 ? (pr.rateio.valor_total * peso(l)) / somaPesos : 0 });
      }
    }
  } else if (pr.tipo === 'bloco') {
    for (const l of linhas) {
      for (const proj of [false, true]) {
        const n = blocosDe(l, proj);
        if (n > 0) somar(l, proj, { tipo: 'bloco', rotulo: `${n} ${n === 1 ? 'bloco' : 'blocos'} de ${b.tamanho}`, blocos: n, valor: n * b.valor });
      }
    }
  }

  const comBonus = pr.bonus.ativo && pr.bonus.valor > 0 && ['ranking', 'rateio', 'bloco'].includes(pr.tipo);
  const rotuloBonus = pr.bonus.min === 100 ? 'Prêmio por bater a meta' : `Prêmio por atingir ${pr.bonus.min}% da meta`;
  if (comBonus) {
    for (const l of linhas) {
      for (const proj of [false, true]) {
        if (bateu(l, proj, pr.bonus.min)) somar(l, proj, { tipo: 'bonus', rotulo: rotuloBonus, valor: pr.bonus.valor });
      }
    }
  }

  for (const l of linhas) {
    l.premio = finalizar(l, soma(l.premio_partes), false);
    l.premio_proj = finalizar(l, soma(l.premio_partes_proj), true);
  }

  // ---- próximo degrau (situação atual) ----
  for (const l of linhas) {
    const brutoAtual = soma(l.premio_partes);
    if (pr.tipo === 'faixas') {
      const prox = pr.faixas.find((x) => x.min > (l.score ?? 0) + EPS);
      if (prox) {
        l.proxima_faixa = {
          tipo: 'faixa',
          indice: pr.faixas.indexOf(prox),
          min: prox.min,
          rotulo: prox.rotulo,
          falta_pontos: prox.min - (l.score ?? 0),
          falta_unidades: faltaUnidades(l, prox.min),
          premio: finalizar(l, prox.fixo + prox.variavel * baseVariavel(l, false), false),
        };
      }
    } else if (pr.tipo === 'bloco') {
      const r = Math.max(0, real(l, false));
      if (!liberado(l, false)) {
        if (b.exigencia === 'quantidade') {
          l.proxima_faixa = {
            tipo: 'gatilho',
            exigencia: 'quantidade',
            min: b.minimo,
            falta_unidades: inteiro(Math.max(0, b.minimo - r)),
            premio: finalizar(l, brutoAtual + blocosEm(l, b.minimo) * b.valor, false),
          };
        } else if (b.exigencia === 'meta' && l.score != null) {
          const m = metaBase(l);
          const alvo = m > 0 ? (b.minimo / 100) * m : r;
          l.proxima_faixa = {
            tipo: 'gatilho',
            exigencia: 'meta',
            min: b.minimo,
            falta_pontos: Math.max(0, b.minimo - l.score),
            falta_unidades: faltaUnidades(l, b.minimo),
            premio: finalizar(l, brutoAtual + blocosEm(l, Math.max(r, alvo)) * b.valor, false),
          };
        }
      } else {
        const n = blocosEm(l, r);
        if (!(b.max_blocos != null && n >= b.max_blocos)) {
          l.proxima_faixa = {
            tipo: 'bloco',
            blocos: n,
            tamanho: b.tamanho,
            valor_bloco: b.valor,
            falta_unidades: inteiro(Math.max(0, (n + 1) * b.tamanho - baseBloco(l, r))),
            premio: finalizar(l, brutoAtual + b.valor, false),
          };
        }
      }
    }
    if (comBonus && l.score != null && !bateu(l, false, pr.bonus.min)) {
      l.proximo_bonus = {
        tipo: 'bonus',
        min: pr.bonus.min,
        rotulo: rotuloBonus,
        valor: pr.bonus.valor,
        falta_pontos: Math.max(0, pr.bonus.min - l.score),
        falta_unidades: faltaUnidades(l, pr.bonus.min),
        premio: finalizar(l, brutoAtual + pr.bonus.valor, false),
      };
      if (!l.proxima_faixa) l.proxima_faixa = l.proximo_bonus;
    }
  }
}

function statusDe(l, t) {
  if (t.status === 'futura') return 'aguardando';
  if (l.score == null) return 'sem_meta';
  if (l.elegivel && l.score + EPS >= 100) return 'atingiu';
  if (t.status === 'encerrada') return 'nao_atingiu';
  if (l.elegivel_proj && l.score_proj != null && l.score_proj + EPS >= 100) return 'no_ritmo';
  if (l.score_proj != null && l.score_proj >= 85) return 'atencao';
  return 'risco';
}

export const STATUS_PARTICIPANTE = {
  atingiu: 'Atingiu',
  no_ritmo: 'No ritmo',
  atencao: 'Atenção',
  risco: 'Em risco',
  nao_atingiu: 'Não atingiu',
  sem_meta: 'Sem meta',
  aguardando: 'Aguardando início',
};

// ======================================================================
// Apuração
// ======================================================================

function linhaDoTempo(t, cum, fn, vars, metaTotal, totalizar, projTotal) {
  const n = t.dias.length;
  const realizado = new Array(n).fill(null);
  const meta = new Array(n).fill(null);
  const projecao = new Array(n).fill(null);
  let cont = 0;
  for (let i = 0; i < n; i++) {
    if (t.contaveis[i]) cont++;
    if (metaTotal != null) meta[i] = totalizar === 'soma' ? (metaTotal * cont) / (t.total || 1) : metaTotal;
    if (i <= t.idxRef) realizado[i] = fn.avaliar(valoresEm(cum, vars, i));
  }
  if (t.status === 'andamento' && t.idxRef >= 0 && projTotal != null) {
    const atual = realizado[t.idxRef] ?? 0;
    let k = 0;
    projecao[t.idxRef] = atual;
    for (let i = t.idxRef + 1; i < n; i++) {
      if (t.contaveis[i]) k++;
      projecao[i] = totalizar === 'soma' ? atual + ((projTotal - atual) * k) / (t.restantes || 1) : projTotal;
    }
  }
  return { realizado, meta, projecao };
}

function somarSeries(series, vars, n) {
  const tot = novaSerie(vars, n);
  for (const s of series) for (const v of vars) if (s[v]) for (let i = 0; i < n; i++) tot[v][i] += s[v][i];
  return tot;
}

/** Dias contáveis acumulados (variável dias_uteis). */
function diasContaveisAcumulados(dias, cal) {
  const arr = new Float64Array(dias.length);
  let k = 0;
  dias.forEach((d, i) => {
    if (cal.conta(d)) k++;
    arr[i] = k;
  });
  return arr;
}

/**
 * Apura uma campanha (definição salva ou rascunho).
 * @param {object} definicao
 * @param {{referencia?: string}} opcoes
 */
export function apurar(definicao, opcoes = {}) {
  const inicioMs = Date.now();
  const c = normalizarCampanha(definicao);
  const ctx = contexto(c, opcoes);
  const { tempo: t } = ctx;
  const n = t.dias.length;
  const participantes = listarParticipantes(c.participantes, c.filtros);
  if (!participantes.length) ctx.avisos.push('Nenhum participante encontrado com os filtros escolhidos.');
  const chaves = new Set(participantes.map((p) => p.chave));
  const fimEfetivo = t.status === 'futura' ? null : t.dias[t.idxRef];
  // pesos só para métricas ponderadas (distribuição ponderada, peso da base)
  const textoMetricas = JSON.stringify(c.criterios.map((cr) => [cr.expressao, METRICAS[cr.metrica]?.expr]));
  if (/peso_/.test(textoMetricas)) montarPesos(c, ctx.colData);
  else {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _peso (id_cliente INTEGER PRIMARY KEY, peso REAL)');
  }

  const internos = [];
  const criterios = c.criterios.map((cr) => {
    let fn;
    try {
      fn = funcaoMetrica(cr);
    } catch (e) {
      ctx.avisos.push(`Critério "${cr.nome}": ${e.message}`);
      fn = { avaliar: () => null, variaveis: [], parametrizadas: [] };
    }
    const vars = new Set([...SEMPRE, ...fn.variaveis]);
    const prod = produtosDoCriterio(cr);
    if (!prod.todos.length) ctx.avisos.push(`Critério "${cr.nome}": nenhum produto corresponde ao filtro.`);
    const especiais = { constantes: new Set(), pesos: new Map() };
    const constPart = [...vars].some((v) => ['base_clientes', 'clientes_ativos', 'peso_base'].includes(v))
      ? constantesParticipantes(c, ctx, participantes, vars)
      : null;
    const injetarConstantes = (series, dias) => {
      const nn = dias.length;
      for (const [pk, s] of series) {
        if (vars.has('n_produtos')) s.n_produtos = new Float64Array(nn).fill(prod.todos.length);
        if (vars.has('dias_uteis')) s.dias_uteis = diasContaveisAcumulados(dias, ctx.cal);
        if (constPart) {
          const k = constPart.get(pk) || { base_clientes: 0, clientes_ativos: 0, peso_base: 0 };
          for (const v of ['base_clientes', 'clientes_ativos', 'peso_base']) if (vars.has(v)) s[v] = new Float64Array(nn).fill(k[v]);
        }
      }
    };

    // período anterior (comparativo, metas por histórico e variáveis *_ant)
    const per = cr.meta.base_inicio && cr.meta.base_fim ? { inicio: cr.meta.base_inicio, fim: cr.meta.base_fim } : periodoAnterior(c.inicio, c.fim);
    const diasBase = intervalo(per.inicio, per.fim);
    const varsHist = new Set([...vars].filter((v) => !ANTERIOR[v]));
    for (const [ant, origem] of Object.entries(ANTERIOR)) if (vars.has(ant)) varsHist.add(origem);
    const hist = coletar(c, cr, ctx.colData, per.inicio, per.fim, diasBase, prod, varsHist);
    for (const p of participantes) if (!hist.has(p.chave)) hist.set(p.chave, novaSerie(varsDeDados(varsHist), diasBase.length));
    injetarConstantes(hist, diasBase);
    const espHist = { constantes: new Set(), pesos: new Map() };
    const paramsNaoAnteriores = { ...fn, parametrizadas: (fn.parametrizadas || []).filter((p) => !(p.filtros.periodo || []).some((x) => /anterior/i.test(x))) };
    injetarRecortes(c, cr, paramsNaoAnteriores, ctx, hist, diasBase, per.inicio, per.fim, per, espHist);
    const ultimoBase = diasBase.length - 1;
    const varsHistAval = new Set([...varsHist, ...paramsNaoAnteriores.parametrizadas.map((p) => p.chave)]);
    const histMetrica = new Map([...hist].map(([pk, s]) => [pk, fn.avaliar(valoresEm(s, varsHistAval, ultimoBase))]));

    // período da campanha
    const series = fimEfetivo ? coletar(c, cr, ctx.colData, c.inicio, fimEfetivo, t.dias, prod, vars) : new Map();
    for (const p of participantes) if (!series.has(p.chave)) series.set(p.chave, novaSerie(varsDeDados(vars), n));
    injetarConstantes(series, t.dias);
    for (const [pk, s] of series) {
      // *_ant: acumulado do período anterior alinhado proporcionalmente ao dia da campanha
      // (comparação "mesmo ponto do período"); o último ponto é o total do período anterior.
      for (const [ant, origem] of Object.entries(ANTERIOR)) {
        if (!vars.has(ant)) continue;
        const b = hist.get(pk)?.[origem];
        const arr = new Float64Array(n);
        if (b) for (let i = 0; i < n; i++) arr[i] = b[Math.min(b.length - 1, Math.max(0, Math.round(((i + 1) / n) * b.length) - 1))];
        s[ant] = arr;
      }
    }
    injetarRecortes(c, cr, fn, ctx, series, t.dias, c.inicio, fimEfetivo, per, especiais);
    db.exec('DROP TABLE IF EXISTS temp._base');
    const varsTodas = new Set([...vars, ...(fn.parametrizadas || []).map((p) => p.chave)]);

    const metas = calcularMetas(c, cr, participantes, histMetrica, ctx);
    const doGrupo = participantes.map((p) => series.get(p.chave));
    const cum = somarSeries(doGrupo, varsTodas, n);
    if (vars.has('dias_uteis')) cum.dias_uteis = diasContaveisAcumulados(t.dias, ctx.cal);
    if (vars.has('n_produtos')) cum.n_produtos = new Float64Array(n).fill(prod.todos.length * Math.max(1, participantes.length));
    const histDoGrupo = participantes.map((p) => hist.get(p.chave));
    const histTotal = somarSeries(histDoGrupo, new Set([...varsHist, ...(fn.parametrizadas || []).map((p) => p.chave)]), diasBase.length);
    if (vars.has('dias_uteis')) histTotal.dias_uteis = diasContaveisAcumulados(diasBase, ctx.cal);

    // curva de maturação: fração do total do período anterior que já tinha acontecido no mesmo ponto
    if (t.status === 'andamento' && t.idxRef >= 0) {
      const saturaveis = new Set([...vars].filter((v) => SATURAVEIS.has(v)));
      if (cr.metrica === 'combo' && cr.combo.escopo === 'cliente') ['combos', 'kits'].forEach((v) => vars.has(v) && saturaveis.add(v));
      const nb = diasBase.length;
      const alinhado = Math.min(nb - 1, Math.max(0, Math.round(((t.idxRef + 1) / n) * nb) - 1));
      especiais.maturacao = new Map();
      especiais.curva = new Map();
      for (const v of saturaveis) {
        const arr = histTotal[v];
        if (!arr) continue;
        const noPonto = arr[alinhado];
        const final = arr[nb - 1];
        if (noPonto > 0 && final >= noPonto) especiais.maturacao.set(v, Math.min(final / noPonto, 6));
      }
      for (const v of vars) {
        if (saturaveis.has(v) || CONSTANTES.has(v) || TEMPO.has(v) || ANTERIOR[v]) continue;
        const arr = histTotal[v];
        if (!arr) continue;
        const noPonto = arr[alinhado];
        const final = arr[nb - 1];
        if (noPonto > 0 && final >= noPonto) especiais.curva.set(v, Math.min(final / noPonto, 6));
      }
      for (const p of fn.parametrizadas || []) {
        if (!SATURAVEIS.has(p.medida) || !especiais.pesos.has(p.chave)) continue;
        const arr = histTotal[p.chave];
        if (arr && arr[alinhado] > 0 && arr[nb - 1] >= arr[alinhado]) especiais.maturacao.set(p.chave, Math.min(arr[nb - 1] / arr[alinhado], 6));
      }
    }

    const valoresMeta = participantes.map((p) => metas.get(p.chave)).filter((x) => x != null);
    const metaTotal = !valoresMeta.length
      ? null
      : cr.totalizar === 'soma'
        ? valoresMeta.reduce((a, b) => a + b, 0)
        : valoresMeta.reduce((a, b) => a + b, 0) / valoresMeta.length;
    const realizadoTotal = fn.avaliar(valoresEm(cum, varsTodas, t.idxRef));
    const projTotal = t.status === 'futura' ? null : fn.avaliar(projecoes(cum, varsTodas, t, especiais));
    const baseTotal = fn.avaliar(valoresEm(histTotal, new Set([...varsHist, ...(fn.parametrizadas || []).map((p) => p.chave)]), ultimoBase));

    internos.push({ cr, fn, vars: varsTodas, series, metas, prod, especiais });
    return {
      id: cr.id,
      nome: cr.nome,
      metrica: cr.metrica,
      metrica_nome: METRICAS[cr.metrica].nome,
      formato: cr.formato,
      unidade:
        cr.metrica === 'combo'
          ? cr.combo.contar === 'kits'
            ? 'kits'
            : cr.combo.escopo === 'cliente'
              ? 'clientes'
              : 'pedidos'
          : METRICAS[cr.metrica].unidade || null,
      sentido: cr.sentido,
      totalizar: cr.totalizar,
      peso: cr.peso,
      gatilho: cr.gatilho,
      teto: cr.teto,
      meta_tipo: cr.meta.tipo,
      produtos_descricao: cr.metrica === 'combo' ? cr.combo.itens.map((it) => `${it.minimo}× ${it.nome}`).join(' + ') : descreverSeletor(cr.produtos),
      n_produtos: prod.todos.length,
      produtos_amostra: prod.todos.slice(0, 6).map((id) => produtoPorId(id)?.nome).filter(Boolean),
      periodo_base: per,
      total: {
        realizado: realizadoTotal,
        meta: metaTotal,
        atingimento: atingimento(realizadoTotal, metaTotal, cr.sentido),
        projecao: projTotal,
        atingimento_proj: atingimento(projTotal, metaTotal, cr.sentido),
        base: baseTotal,
        variacao_proj: baseTotal > 0 && projTotal != null ? (projTotal / baseTotal - 1) * 100 : null,
        qtd: t.idxRef >= 0 ? cum.qtd[t.idxRef] : 0,
        valor: t.idxRef >= 0 ? cum.valor[t.idxRef] : 0,
      },
      serie: linhaDoTempo(t, cum, fn, varsTodas, metaTotal, cr.totalizar, projTotal),
    };
  });

  // ---- participantes ----
  const linhas = participantes.map((p) => {
    const cs = internos.map(({ cr, fn, vars, series, metas, especiais }) => {
      const s = series.get(p.chave);
      const realizado = fn.avaliar(valoresEm(s, vars, t.idxRef));
      const projecao = t.status === 'futura' ? null : fn.avaliar(projecoes(s, vars, t, especiais));
      const meta = metas.get(p.chave) ?? null;
      const falta = meta != null && realizado != null ? Math.max(0, cr.sentido === 'maior' ? meta - realizado : realizado - meta) : null;
      return {
        realizado,
        meta,
        atingimento: atingimento(realizado, meta, cr.sentido),
        projecao,
        atingimento_proj: atingimento(projecao, meta, cr.sentido),
        falta,
        ritmo_necessario: falta > 0 && t.restantes > 0 && cr.totalizar === 'soma' && cr.sentido === 'maior' ? falta / t.restantes : null,
        qtd: t.idxRef >= 0 ? s.qtd[t.idxRef] : 0,
        valor: t.idxRef >= 0 ? s.valor[t.idxRef] : 0,
      };
    });
    const atual = pontuar(cs.map((x) => x.atingimento), c.criterios, c.apuracao.regra);
    const proj = pontuar(cs.map((x) => x.atingimento_proj), c.criterios, c.apuracao.regra);
    return {
      ...p,
      criterios: cs,
      score: atual.score,
      elegivel: atual.elegivel,
      score_proj: t.status === 'futura' ? null : proj.score,
      elegivel_proj: proj.elegivel,
      vendeu: cs.some((x) => x.qtd > 0),
    };
  });

  const idxBase = Math.max(0, c.criterios.findIndex((cr) => cr.id === c.premiacao.criterio_base));
  premiar(c, linhas, idxBase);
  for (const l of linhas) l.status = statusDe(l, t);

  // posição: pelo critério do ranking (se for ranking por realizado) ou pela pontuação
  const chaveOrdem = (l) =>
    c.premiacao.tipo === 'ranking' && c.premiacao.ranking.por === 'realizado' ? (l.criterios[idxBase].realizado ?? -Infinity) : (l.score ?? -Infinity);
  linhas.sort(
    (a, b) =>
      chaveOrdem(b) - chaveOrdem(a) || (b.criterios[idxBase].realizado ?? 0) - (a.criterios[idxBase].realizado ?? 0) || a.nome.localeCompare(b.nome),
  );
  linhas.forEach((l, i) => (l.posicao = i + 1));
  // posição projetada (para mostrar quem sobe/desce)
  const chaveOrdemProj = (l) =>
    c.premiacao.tipo === 'ranking' && c.premiacao.ranking.por === 'realizado' ? (l.criterios[idxBase].projecao ?? -Infinity) : (l.score_proj ?? -Infinity);
  [...linhas]
    .sort((a, b) => chaveOrdemProj(b) - chaveOrdemProj(a) || (b.criterios[idxBase].projecao ?? 0) - (a.criterios[idxBase].projecao ?? 0))
    .forEach((l, i) => (l.posicao_proj = i + 1));

  // ---- resumo ----
  const contar = (st) => linhas.filter((l) => l.status === st).length;
  const premio_total = Math.round(linhas.reduce((a, l) => a + l.premio, 0) * 100) / 100;
  const premio_proj_total = Math.round(linhas.reduce((a, l) => a + l.premio_proj, 0) * 100) / 100;
  const orc = c.premiacao.orcamento;
  const geral = pontuar(criterios.map((x) => x.total.atingimento), c.criterios, c.apuracao.regra);
  const geralProj = pontuar(criterios.map((x) => x.total.atingimento_proj), c.criterios, c.apuracao.regra);
  if (orc && premio_proj_total > orc) ctx.avisos.push(`A premiação projetada ultrapassa o orçamento definido.`);

  const resultado = {
    gerado_em: new Date().toISOString(),
    duracao_ms: 0,
    campanha: { ...c, nivel_rotulo: NIVEIS[c.participantes.nivel].rotulo, nivel_singular: NIVEIS[c.participantes.nivel].singular },
    tempo: {
      status: t.status,
      inicio: t.inicio,
      fim: t.fim,
      referencia: ctx.ref,
      total: t.total,
      decorridos: t.decorridos,
      restantes: t.restantes,
      progresso: t.progresso,
      calendario: t.calendario,
      dias: t.dias,
      contaveis: t.contaveis,
      idx_ref: t.idxRef,
      dias_para_inicio: t.dias_para_inicio ?? null,
    },
    criterios,
    participantes: linhas,
    resumo: {
      participantes: linhas.length,
      com_venda: linhas.filter((l) => l.vendeu).length,
      atingiram: contar('atingiu'),
      no_ritmo: contar('no_ritmo'),
      atencao: contar('atencao'),
      risco: contar('risco'),
      nao_atingiu: contar('nao_atingiu'),
      sem_meta: contar('sem_meta'),
      aguardando: contar('aguardando'),
      premio_total,
      premio_proj_total,
      orcamento: orc,
      uso_orcamento: orc ? premio_total / orc : null,
      uso_orcamento_proj: orc ? premio_proj_total / orc : null,
      atingimento_geral: geral.score,
      atingimento_geral_proj: geralProj.score,
    },
    avisos: ctx.avisos,
  };
  resultado.duracao_ms = Date.now() - inicioMs;
  Object.defineProperty(resultado, '_interno', { value: { c, ctx, internos }, enumerable: false });
  return resultado;
}

// ======================================================================
// Cache em duas camadas:
//  1. memória (rápida, some ao reiniciar);
//  2. apuracao_pronta no SQLite, gravada pela pipeline de dados (server/etapas/apuracao.js):
//     sobrevive a reinícios; a chave inclui a assinatura persistente da base, o dia e a definição.
// Um resultado lido do banco não traz `_interno` (séries e SQL internos): ele é recalculado sob demanda,
// só se alguma rota de detalhe precisar. O estoque da campanha vem pronto junto.
// ======================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS apuracao_pronta (
  chave TEXT PRIMARY KEY,
  id_campanha INTEGER,
  referencia TEXT,
  assinatura_base TEXT,
  dia TEXT,
  resultado TEXT NOT NULL,
  estoque TEXT,
  gerado_em TEXT,
  duracao_ms INTEGER
);
CREATE INDEX IF NOT EXISTS ix_apuracao_pronta_campanha ON apuracao_pronta (id_campanha);
`);

const cache = new Map();
aoInvalidar(() => cache.clear());

let baseMemo = { versao: -1, valor: '' };
const baseAtual = () => {
  if (baseMemo.versao !== versaoDados()) baseMemo = { versao: versaoDados(), valor: assinaturaBase() };
  return baseMemo.valor;
};
/** Chave persistente de uma apuração (mesma no servidor e no worker da pipeline). */
export const chaveApuracao = (definicao, referencia = '') => hash(baseAtual(), hojeISO(), referencia || '', JSON.stringify(definicao));

function guardar(chave, r) {
  cache.set(chave, r);
  while (cache.size > 60) cache.delete(cache.keys().next().value);
}

function deBanco(linha, texto, opcoes) {
  const r = JSON.parse(linha.resultado);
  let interno = null;
  Object.defineProperty(r, '_interno', {
    enumerable: false,
    configurable: true,
    get() {
      if (!interno) interno = apurar(JSON.parse(texto), opcoes)._interno;
      return interno;
    },
  });
  if (linha.estoque) Object.defineProperty(r, '_estoque', { value: JSON.parse(linha.estoque), enumerable: false });
  return r;
}

/**
 * Apuração com cache. `efemero: true` (prévia do construtor) não consulta o banco.
 * `persistir: { id_campanha }` (usado pela pipeline) grava o resultado pronto.
 */
export function apurarComCache(definicao, opcoes = {}) {
  const texto = JSON.stringify(definicao);
  const chave = `${versaoDados()}|${hojeISO()}|${opcoes.referencia || ''}|${texto}`;
  const achado = cache.get(chave);
  if (achado && !opcoes.persistir) {
    cache.delete(chave);
    cache.set(chave, achado);
    return achado;
  }
  const chaveDb = opcoes.efemero ? null : chaveApuracao(definicao, opcoes.referencia);
  if (chaveDb && !opcoes.persistir) {
    const linha = db.prepare('SELECT resultado, estoque FROM apuracao_pronta WHERE chave = ?').get(chaveDb);
    if (linha) {
      const r = deBanco(linha, texto, opcoes);
      guardar(chave, r);
      return r;
    }
  }
  const t = Date.now();
  const r = achado || apurar(definicao, opcoes);
  if (chaveDb && opcoes.persistir) {
    let estoque = null;
    try {
      estoque = r.tempo.status === 'futura' ? [] : estoqueDaCampanha(r);
    } catch {
      estoque = null;
    }
    if (estoque) Object.defineProperty(r, '_estoque', { value: estoque, enumerable: false, configurable: true });
    db.prepare(
      `INSERT INTO apuracao_pronta (chave, id_campanha, referencia, assinatura_base, dia, resultado, estoque, gerado_em, duracao_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chave) DO UPDATE SET resultado = excluded.resultado, estoque = excluded.estoque, gerado_em = excluded.gerado_em, duracao_ms = excluded.duracao_ms`,
    ).run(chaveDb, opcoes.persistir.id_campanha ?? null, opcoes.referencia || '', baseAtual(), hojeISO(), JSON.stringify(r), estoque ? JSON.stringify(estoque) : null, new Date().toISOString(), Date.now() - t);
  }
  guardar(chave, r);
  return r;
}

/** Apaga resultados prontos de outra base/dia (a pipeline chama depois de gravar os novos). */
export function limparApuracoesVelhas(manterChaves = []) {
  const manter = new Set(manterChaves);
  const velhas = db.prepare('SELECT chave FROM apuracao_pronta WHERE assinatura_base != ? OR dia != ?').all(baseAtual(), hojeISO()).map((l) => l.chave).filter((k) => !manter.has(k));
  const del = db.prepare('DELETE FROM apuracao_pronta WHERE chave = ?');
  for (const k of velhas) del.run(k);
  return velhas.length;
}

// ======================================================================
// Detalhamento de um participante
// ======================================================================

export function detalharParticipante(resultado, chave, idCriterio) {
  const { c, ctx, internos } = resultado._interno;
  const t = ctx.tempo;
  const linha = resultado.participantes.find((l) => l.chave === String(chave));
  if (!linha) return null;
  const idx = Math.max(0, internos.findIndex((x) => x.cr.id === idCriterio));
  const { cr, fn, vars, series, prod } = internos[idx];
  const cl = linha.criterios[idx];
  const serie = linhaDoTempo(t, series.get(linha.chave), fn, vars, cl.meta, cr.totalizar, cl.projecao);

  let produtos = [];
  let clientes = [];
  let vendedores = [];
  let oportunidades = [];
  if (t.status !== 'futura') {
    montarBase(c, cr, ctx.colData, c.inicio, t.dias[t.idxRef], prod, new Set());
    produtos = db
      .prepare(
        `SELECT b.id_produto AS id, p.nome_produto AS nome, p.marca, SUM(b.qtd) AS qtd, SUM(b.valor) AS valor,
                COUNT(DISTINCT b.id_cliente) AS clientes
           FROM _base b LEFT JOIN dm_produto p ON p.id_produto = b.id_produto
          WHERE b.pk = ? AND b.conta = 1 AND b.alvo = 1 GROUP BY b.id_produto ORDER BY qtd DESC`,
      )
      .all(linha.chave);
    if (c.participantes.nivel !== 'cliente') {
      clientes = db
        .prepare(
          `SELECT b.id_cliente AS id, COALESCE(cl.nome_fantasia, cl.nome_cliente) AS nome, cl.cidade, cl.estado,
                  SUM(b.qtd) AS qtd, SUM(b.valor) AS valor, COUNT(DISTINCT b.id_pedido) AS pedidos, MAX(b.dia) AS ultima
             FROM _base b LEFT JOIN dm_cliente cl ON cl.id_cliente = b.id_cliente
            WHERE b.pk = ? AND b.conta = 1 AND b.alvo = 1 GROUP BY b.id_cliente ORDER BY valor DESC LIMIT 300`,
        )
        .all(linha.chave);
    }
    if (c.participantes.nivel !== 'vendedor') {
      vendedores = db
        .prepare(
          `SELECT b.id_vendedor AS id, vd.nome_vendedor AS nome, SUM(b.qtd) AS qtd, SUM(b.valor) AS valor, COUNT(DISTINCT b.id_cliente) AS clientes
             FROM _base b LEFT JOIN dm_vendedor vd ON vd.id_vendedor = b.id_vendedor
            WHERE b.pk = ? AND b.conta = 1 AND b.alvo = 1 GROUP BY b.id_vendedor ORDER BY valor DESC LIMIT 300`,
        )
        .all(linha.chave);
    }
    montarHistOportunidades(c, ctx, prod);
    oportunidades = oportunidadesDe(c, ctx, prod, c.participantes.nivel, linha.chave, 40);
    db.exec('DROP TABLE IF EXISTS temp._base');
  }
  return { participante: linha, criterio: resultado.criterios[idx], indice: idx, serie, produtos, clientes, vendedores, oportunidades, dias: t.dias };
}

/**
 * Clientes que compram com o vendedor/equipe (ou estão na carteira) e ainda não levaram os produtos do critério,
 * ordenados pelo potencial: quem já comprou esses produtos antes e quem compra mais no geral.
 * Requer a _base do critério montada.
 */
/** Histórico de compra dos produtos do critério (120 dias antes do início), calculado uma vez por cálculo. */
let histChave = null;
function montarHistOportunidades(c, ctx, prod) {
  // a mesma campanha pede o histórico para cada participante: refaz só quando muda o recorte
  const chave = `${versaoDados()}|${ctx.colData}|${c.inicio}|${c.status_venda.join(',')}|${hash(prod.todos)}`;
  if (chave === histChave) return;
  histChave = null;
  db.exec('DROP TABLE IF EXISTS temp._hist_op');
  db.prepare(
    `CREATE TEMP TABLE _hist_op AS
     SELECT id_cliente, SUM(valor_total) AS valor_hist, SUM(quantidade) AS qtd_hist, MAX(${ctx.colData}) AS ultima, COUNT(DISTINCT id_pedido) AS pedidos_hist
       FROM fato_vendas
      WHERE ${ctx.colData} BETWEEN ? AND ? AND +id_produto IN (${ints(prod.todos)}) AND status IN (${ph(c.status_venda)})
      GROUP BY id_cliente`,
  ).run(addDias(c.inicio, -120), addDias(c.inicio, -1), ...c.status_venda);
  db.exec('CREATE INDEX temp.ix_hist_op ON _hist_op(id_cliente)');
  histChave = chave;
}

function oportunidadesDe(c, ctx, prod, nivel, chave, limite) {
  const vend = vendedoresDoParticipante(nivel, chave);
  if (!vend.length) return [];
  const t = ctx.tempo;
  const ref = t.dias[t.idxRef];
  return db
    .prepare(
      `WITH alvo AS (
          SELECT id_cliente FROM dm_cliente WHERE id_vendedor IN (${ints(vend)})
          UNION
          SELECT DISTINCT id_cliente FROM fato_vendas WHERE id_vendedor IN (${ints(vend)}) AND ${ctx.colData} BETWEEN ? AND ?
       ),
       geral AS (
          SELECT id_cliente, SUM(valor_total) AS valor_geral, MAX(${ctx.colData}) AS ultima_compra FROM fato_vendas
           WHERE id_vendedor IN (${ints(vend)}) AND status IN (${ph(c.status_venda)}) AND ${ctx.colData} BETWEEN ? AND ? GROUP BY id_cliente
       )
       SELECT a.id_cliente AS id, COALESCE(cl.nome_fantasia, cl.nome_cliente) AS nome, cl.cidade, cl.estado, cl.segmento, cl.porte,
              h.valor_hist, h.qtd_hist, h.ultima, h.pedidos_hist, g.valor_geral, g.ultima_compra
         FROM alvo a
         JOIN dm_cliente cl ON cl.id_cliente = a.id_cliente
         LEFT JOIN temp._hist_op h ON h.id_cliente = a.id_cliente
         LEFT JOIN geral g ON g.id_cliente = a.id_cliente
        WHERE a.id_cliente NOT IN (SELECT id_cliente FROM _base WHERE pk = ? AND conta = 1 AND alvo = 1)
        ORDER BY COALESCE(h.valor_hist, 0) DESC, COALESCE(g.valor_geral, 0) DESC
        LIMIT ${Math.trunc(limite)}`,
    )
    .all(
      addDias(c.inicio, -90), ref,
      ...c.status_venda, addDias(c.inicio, -90), ref,
      String(chave),
    );
}

/** Oportunidades de um participante só (boletim individual, bot). */
export function oportunidadesDoParticipante(resultado, chave, idCriterio, limite = 5) {
  const { c, ctx, internos } = resultado._interno;
  if (ctx.tempo.status === 'futura' || !['vendedor', 'equipe'].includes(c.participantes.nivel)) return [];
  const it = internos.find((x) => x.cr.id === idCriterio) || internos[0];
  montarBase(c, it.cr, ctx.colData, c.inicio, ctx.tempo.dias[ctx.tempo.idxRef], it.prod, new Set());
  montarHistOportunidades(c, ctx, it.prod);
  const ops = oportunidadesDe(c, ctx, it.prod, c.participantes.nivel, String(chave), limite).filter((o) => o.valor_hist > 0);
  db.exec('DROP TABLE IF EXISTS temp._base');
  return ops;
}

/** Oportunidades de todos os participantes de um critério (usado pela central de insights e pela IA). */
export function oportunidadesDaCampanha(resultado, idCriterio, porParticipante = 5) {
  const { c, ctx, internos } = resultado._interno;
  if (ctx.tempo.status === 'futura' || !['vendedor', 'equipe'].includes(c.participantes.nivel)) return [];
  const it = internos.find((x) => x.cr.id === idCriterio) || internos[0];
  montarBase(c, it.cr, ctx.colData, c.inicio, ctx.tempo.dias[ctx.tempo.idxRef], it.prod, new Set());
  montarHistOportunidades(c, ctx, it.prod);
  const out = [];
  for (const l of resultado.participantes) {
    if (l.status === 'atingiu') continue;
    const ops = oportunidadesDe(c, ctx, it.prod, c.participantes.nivel, l.chave, porParticipante).filter((o) => o.valor_hist > 0);
    if (ops.length) out.push({ chave: l.chave, nome: l.nome, status: l.status, oportunidades: ops });
  }
  db.exec('DROP TABLE IF EXISTS temp._base');
  return out;
}

/**
 * Linhas de venda exatas que entraram na apuração (auditoria / Excel), por critério.
 * @returns {{ criterio: string, linhas: object[], truncado: boolean }[]}
 */
export function linhasConsideradas(resultado, { limitePorCriterio = 150000 } = {}) {
  const { c, ctx, internos } = resultado._interno;
  if (ctx.tempo.status === 'futura') return [];
  const out = [];
  for (const it of internos) {
    montarBase(c, it.cr, ctx.colData, c.inicio, ctx.tempo.dias[ctx.tempo.idxRef], it.prod, new Set());
    const linhas = db
      .prepare(
        `SELECT b.pk, b.dia, b.id_pedido, b.id_produto, p.nome_produto AS produto, p.marca, b.id_cliente,
                COALESCE(cl.nome_fantasia, cl.nome_cliente) AS cliente, b.id_vendedor, vd.nome_vendedor AS vendedor,
                b.qtd, b.valor, b.margem
           FROM _base b
           LEFT JOIN dm_produto p ON p.id_produto = b.id_produto
           LEFT JOIN dm_cliente cl ON cl.id_cliente = b.id_cliente
           LEFT JOIN dm_vendedor vd ON vd.id_vendedor = b.id_vendedor
          WHERE b.conta = 1 AND b.alvo = 1
          ORDER BY b.dia, b.id_pedido LIMIT ${limitePorCriterio + 1}`,
      )
      .all();
    out.push({ criterio: it.cr.nome, linhas: linhas.slice(0, limitePorCriterio), truncado: linhas.length > limitePorCriterio });
  }
  db.exec('DROP TABLE IF EXISTS temp._base');
  return out;
}

// ======================================================================
// Estoque dos produtos da campanha
// ======================================================================

export function estoqueDaCampanha(resultado) {
  if (resultado._estoque) return resultado._estoque; // gravado pela pipeline junto da apuração
  const { internos, ctx } = resultado._interno;
  const ids = [...new Set(internos.flatMap((x) => x.prod.todos))];
  if (!ids.length) return [];
  const ultima = db.prepare('SELECT MAX(data) AS d FROM fato_estoque').get()?.d;
  if (!ultima) return [];
  const restantes = ctx.tempo.status === 'encerrada' ? 0 : Math.max(0, intervalo(ultima, ctx.tempo.fim).length - 1);
  return db
    .prepare(
      `SELECT e.id_produto AS id, p.nome_produto AS nome, p.marca, e.estoque_final AS estoque, e.estoque_minimo,
              (SELECT AVG(x.quantidade_vendida) FROM fato_estoque x
                WHERE x.id_produto = e.id_produto AND x.data > date(?, '-30 day') AND x.data <= ?) AS media_dia
         FROM fato_estoque e JOIN dm_produto p ON p.id_produto = e.id_produto
        WHERE e.data = ? AND e.id_produto IN (${ints(ids)})`,
    )
    .all(ultima, ultima, ultima)
    .map((r) => {
      const cobertura = r.media_dia > 0 ? r.estoque / r.media_dia : null;
      return {
        ...r,
        data: ultima,
        cobertura_dias: cobertura,
        dias_campanha_restantes: restantes,
        risco: r.estoque <= r.estoque_minimo ? 'abaixo_minimo' : cobertura != null && cobertura < restantes ? 'ruptura' : 'ok',
      };
    })
    .sort((a, b) => (a.cobertura_dias ?? 1e9) - (b.cobertura_dias ?? 1e9));
}
