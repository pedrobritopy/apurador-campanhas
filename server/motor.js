import { db, lerConfig, versaoDados, aoInvalidar } from './db.js';
import { resolverProdutos, produtoPorId, catalogoProdutos, descreverSeletor } from './seletor.js';
import { listarParticipantes, vendedoresDoParticipante, NIVEIS } from './participantes.js';
import { compilar } from './expressao.js';
import { criarCalendario, listaFeriados, intervalo, hojeISO, periodoAnterior, ultimoDiaMes, addDias } from './calendario.js';

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
  clientes: { nome: 'Clientes positivados (respeita cliente mínimo)', grupo: 'Cobertura' },
  clientes_novos: { nome: 'Clientes novos/reativados', grupo: 'Cobertura' },
  skus: { nome: 'SKUs distintos vendidos', grupo: 'Cobertura' },
  cli_skus: { nome: 'Pares cliente × SKU', grupo: 'Cobertura' },
  dias_venda: { nome: 'Dias com venda', grupo: 'Cobertura' },
  n_produtos: { nome: 'Produtos no escopo do critério', grupo: 'Cobertura' },
  qtd_dev: { nome: 'Unidades devolvidas', grupo: 'Devoluções' },
  valor_dev: { nome: 'Valor devolvido (R$)', grupo: 'Devoluções' },
  qtd_canc: { nome: 'Unidades canceladas', grupo: 'Devoluções' },
  valor_canc: { nome: 'Valor cancelado (R$)', grupo: 'Devoluções' },
  qtd_ref: { nome: 'Unidades no escopo de referência', grupo: 'Comparação' },
  valor_ref: { nome: 'Faturamento no escopo de referência', grupo: 'Comparação' },
  qtd_ant: { nome: 'Unidades no período anterior', grupo: 'Comparação' },
  valor_ant: { nome: 'Faturamento no período anterior', grupo: 'Comparação' },
  clientes_ant: { nome: 'Clientes no período anterior', grupo: 'Comparação' },
  combos: { nome: 'Vendas casadas completas', grupo: 'Venda casada' },
  kits: { nome: 'Kits completos', grupo: 'Venda casada' },
};
const NOMES_VARS = Object.keys(VARIAVEIS);
const SEMPRE = ['qtd', 'valor'];
const ADITIVAS = ['qtd', 'valor', 'valor_lista', 'custo', 'margem', 'impostos', 'icms', 'pis', 'cofins', 'comissao', 'linhas'];
const CONSTANTES = new Set(['n_produtos', 'qtd_ant', 'valor_ant', 'clientes_ant']);
const ANTERIOR = { qtd_ant: 'qtd', valor_ant: 'valor', clientes_ant: 'clientes' };
// Peso do ritmo recente na projeção. Contagens distintas saturam (o mesmo cliente não positiva duas vezes),
// então o ritmo recente pesa mais para elas.
const PESO_RECENTE = { clientes: 0.7, clientes_novos: 0.7, skus: 0.7, cli_skus: 0.7 };

// ======================================================================
// Catálogo de métricas prontas
// ======================================================================

const M = (grupo, nome, expr, formato, totalizar, extra = {}) => ({ grupo, nome, expr, formato, totalizar, ...extra });

export const METRICAS = {
  quantidade: M('Volume', 'Unidades', 'qtd', 'numero', 'soma', { unidade: 'un', descricao: 'Soma de unidades vendidas.' }),
  quantidade_liquida: M('Volume', 'Unidades líquidas de devolução', 'qtd - qtd_dev', 'numero', 'soma', { unidade: 'un', descricao: 'Unidades vendidas menos unidades devolvidas no período.' }),
  valor: M('Volume', 'Faturamento', 'valor', 'moeda', 'soma', { descricao: 'Soma do valor vendido (R$).' }),
  valor_liquido_dev: M('Volume', 'Faturamento líquido de devoluções', 'valor - valor_dev', 'moeda', 'soma', { descricao: 'Faturamento menos o valor devolvido.' }),
  valor_liquido: M('Volume', 'Faturamento sem impostos', 'valor - impostos', 'moeda', 'soma', { descricao: 'Faturamento menos ICMS, PIS e COFINS.' }),
  valor_lista: M('Volume', 'Faturamento a preço de lista', 'valor_lista', 'moeda', 'soma', { descricao: 'Volume valorizado pelo preço de tabela (ignora descontos).' }),

  margem: M('Rentabilidade', 'Margem bruta (R$)', 'margem', 'moeda', 'soma', { descricao: 'Soma da margem bruta.' }),
  margem_perc: M('Rentabilidade', 'Margem bruta (%)', 'margem / valor * 100', 'perc', 'media', { descricao: 'Margem bruta ÷ faturamento.' }),
  markup: M('Rentabilidade', 'Markup', 'valor / custo', 'decimal', 'media', { descricao: 'Faturamento ÷ custo (ex.: 1,35 = 35% sobre o custo).' }),
  desconto_medio: M('Rentabilidade', 'Desconto médio (%)', '(1 - valor / valor_lista) * 100', 'perc', 'media', { sentido: 'menor', descricao: 'Quanto abaixo do preço de lista se vendeu. Quanto menor, melhor.' }),
  preco_medio: M('Rentabilidade', 'Preço médio unitário', 'valor / qtd', 'moeda', 'media', { descricao: 'Faturamento ÷ unidades.' }),

  positivacao: M('Clientes e cobertura', 'Positivação de clientes', 'clientes', 'numero', 'soma', { unidade: 'clientes', descricao: 'Clientes distintos que compraram (aceita mínimo por cliente).' }),
  clientes_novos: M('Clientes e cobertura', 'Clientes novos / reativados', 'clientes_novos', 'numero', 'soma', { unidade: 'clientes', descricao: 'Clientes que compraram e não tinham comprado esses produtos nos N dias anteriores.' }),
  mix: M('Clientes e cobertura', 'Mix de SKUs', 'skus', 'numero', 'soma', { unidade: 'SKUs', descricao: 'Produtos distintos vendidos.' }),
  cobertura_mix: M('Clientes e cobertura', 'Cobertura do mix (%)', 'skus / n_produtos * 100', 'perc', 'media', { descricao: '% dos produtos do critério que foram vendidos.' }),
  mix_cliente: M('Clientes e cobertura', 'Mix médio por cliente', 'cli_skus / clientes', 'decimal', 'media', { descricao: 'Média de SKUs distintos por cliente positivado.' }),
  positivacao_sku: M('Clientes e cobertura', 'Positivação de SKU', 'cli_skus', 'numero', 'soma', { unidade: 'positivações', descricao: 'Soma de pares cliente × produto (cada SKU novo em cada cliente conta 1).' }),
  ticket_cliente: M('Clientes e cobertura', 'Faturamento por cliente', 'valor / clientes', 'moeda', 'media', { descricao: 'Faturamento ÷ clientes positivados.' }),

  pedidos: M('Pedidos e frequência', 'Pedidos', 'pedidos', 'numero', 'soma', { unidade: 'pedidos', descricao: 'Pedidos distintos (aceita pedido mínimo).' }),
  ticket_medio: M('Pedidos e frequência', 'Ticket médio', 'valor / pedidos', 'moeda', 'media', { descricao: 'Faturamento ÷ pedidos.' }),
  itens_pedido: M('Pedidos e frequência', 'Itens por pedido', 'linhas / pedidos', 'decimal', 'media', { descricao: 'Média de linhas (SKUs) por pedido.' }),
  unidades_pedido: M('Pedidos e frequência', 'Unidades por pedido', 'qtd / pedidos', 'decimal', 'media', { descricao: 'Média de unidades por pedido.' }),
  dias_venda: M('Pedidos e frequência', 'Dias com venda', 'dias_venda', 'numero', 'soma', { unidade: 'dias', descricao: 'Em quantos dias houve venda (constância).' }),

  crescimento_qtd: M('Crescimento e participação', 'Crescimento de unidades (%)', '(qtd / qtd_ant - 1) * 100', 'perc', 'media', { descricao: 'Variação de unidades contra o período anterior.' }),
  crescimento_valor: M('Crescimento e participação', 'Crescimento de faturamento (%)', '(valor / valor_ant - 1) * 100', 'perc', 'media', { descricao: 'Variação do faturamento contra o período anterior.' }),
  share_qtd: M('Crescimento e participação', 'Share em unidades (%)', 'qtd / qtd_ref * 100', 'perc', 'media', { ref: true, descricao: 'Participação dos produtos do critério dentro do escopo de referência (padrão: mesma subcategoria).' }),
  share_valor: M('Crescimento e participação', 'Share em faturamento (%)', 'valor / valor_ref * 100', 'perc', 'media', { ref: true, descricao: 'Participação em R$ dentro do escopo de referência (padrão: mesma subcategoria).' }),

  taxa_devolucao: M('Qualidade', 'Taxa de devolução (%)', 'valor_dev / (valor + valor_dev) * 100', 'perc', 'media', { sentido: 'menor', descricao: 'Valor devolvido sobre o total. Quanto menor, melhor.' }),
  taxa_cancelamento: M('Qualidade', 'Taxa de cancelamento (%)', 'valor_canc / (valor + valor_canc) * 100', 'perc', 'media', { sentido: 'menor', descricao: 'Valor cancelado sobre o total. Quanto menor, melhor.' }),

  combo: M('Especiais', 'Venda casada / kit', null, 'numero', 'soma', { unidade: 'combos', descricao: 'Pedidos (ou clientes) que levaram todos os itens com as quantidades mínimas.' }),
  personalizada: M('Especiais', 'Fórmula personalizada', null, 'decimal', null, { descricao: 'Monte sua própria métrica com qualquer variável.' }),
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
    ids: lista(s?.ids).map(Number).filter(Number.isFinite),
    excluir: lista(s?.excluir).map(Number).filter(Number.isFinite),
  };
}
const seletorVazio = (s) => !s.fabricantes.length && !s.marcas.length && !s.subcategorias.length && !s.ids.length;

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
    regra_cliente: { min_qtd: Math.max(0, num(cr.regra_cliente?.min_qtd, 0)), min_valor: Math.max(0, num(cr.regra_cliente?.min_valor, 0)) },
    regra_pedido: { min_qtd: Math.max(0, num(cr.regra_pedido?.min_qtd, 0)), min_valor: Math.max(0, num(cr.regra_pedido?.min_valor, 0)) },
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
    fornecedor: String(def.fornecedor || ''),
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
      clientes: lista(f.clientes).map(Number).filter(Number.isFinite),
      cfops: lista(f.cfops).map(String),
      cfops_excluir: lista(f.cfops_excluir).map(String),
    },
    criterios,
    apuracao: { regra: ['ponderada', 'todos', 'qualquer'].includes(def.apuracao?.regra) ? def.apuracao.regra : 'ponderada' },
    premiacao: {
      tipo: ['faixas', 'ranking', 'rateio', 'nenhuma'].includes(p.tipo) ? p.tipo : 'faixas',
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
        compilar(cr.expressao, NOMES_VARS);
      } catch (e) {
        erros.push(`Critério "${cr.nome}": ${e.message}`);
      }
    }
    if (cr.metrica === 'combo' && cr.combo.itens.length < 1) erros.push(`Critério "${cr.nome}": inclua pelo menos um item na venda casada.`);
  }
  if (c.premiacao.tipo === 'faixas' && !c.premiacao.faixas.length) erros.push('Inclua ao menos uma faixa de premiação (ou escolha "sem premiação").');
  if (c.premiacao.tipo === 'ranking' && !c.premiacao.ranking.posicoes.length) erros.push('Inclua ao menos uma posição premiada no ranking.');
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

/** Cria a tabela temporária _base com as linhas de venda do escopo do critério (todas as situações, marcadas). */
function montarBase(c, cr, colData, inicio, fim, prod, vars) {
  db.exec('DROP TABLE IF EXISTS temp._base');
  const precisaRef = vars.has('qtd_ref') || vars.has('valor_ref');
  const precisaNovos = vars.has('clientes_novos');
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

  const where = [`v.${colData} BETWEEN ? AND ?`, `v.id_produto IN (${ints(universo)})`];
  const pWhere = [inicio, fim];
  const f = c.filtros;
  if (f.canais.length) where.push(`v.id_canal IN (${ints(f.canais)})`);
  if (f.clientes.length) where.push(`v.id_cliente IN (${ints(f.clientes)})`);
  for (const [col, arr, neg] of [
    ['c.segmento', f.segmentos],
    ['c.porte', f.portes],
    ['c.estado', f.estados],
    ['v.cfop', f.cfops],
    ['v.cfop', f.cfops_excluir, true],
  ]) {
    if (arr.length) {
      where.push(`${col} ${neg ? 'NOT IN' : 'IN'} (${ph(arr)})`);
      pWhere.push(...arr);
    }
  }
  const chave = NIVEIS[c.participantes.nivel].chaveSql;
  db.prepare(
    `CREATE TEMP TABLE _base AS
     SELECT CAST(${chave} AS TEXT) AS pk, v.${colData} AS dia, v.id_cliente, v.id_produto, v.id_pedido, v.id_vendedor,
            CASE WHEN v.status IN (${ph(c.status_venda)}) THEN 1 ELSE 0 END AS conta,
            CASE WHEN lower(v.status) LIKE 'devol%' THEN 1 ELSE 0 END AS dev,
            CASE WHEN lower(v.status) LIKE 'cancel%' THEN 1 ELSE 0 END AS canc,
            CASE WHEN v.id_produto IN (${ints(prod.todos)}) THEN 1 ELSE 0 END AS alvo,
            ${precisaRef ? `CASE WHEN v.id_produto IN (${ints(prod.ref)}) THEN 1 ELSE 0 END` : '0'} AS ref,
            ${novo},
            v.quantidade AS qtd, v.valor_total AS valor, v.preco_lista * v.quantidade AS valor_lista,
            v.custo_total AS custo, v.margem_bruta AS margem, v.valor_impostos_total AS impostos,
            v.valor_icms AS icms, v.valor_pis AS pis, v.valor_cofins AS cofins,
            v.valor_total * COALESCE(cn.comissao_perc, 0) / 100.0 AS comissao
       FROM fato_vendas v
       LEFT JOIN dm_cliente c ON c.id_cliente = v.id_cliente
       LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor
       LEFT JOIN dm_canal cn ON cn.id_canal = v.id_canal
      WHERE ${where.join(' AND ')}`,
  ).run(...pSel, ...pWhere);
}

const novaSerie = (vars, n) => {
  const s = {};
  for (const v of vars) s[v] = new Float64Array(n);
  return s;
};

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
  primeiraVez('skus', 'id_produto');
  primeiraVez('cli_skus', 'id_cliente, id_produto');
  primeiraVez('dias_venda', 'dia');

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

  // Cliente conta como positivado no dia em que o acumulado dele atinge o mínimo exigido.
  const positivados = (v, extra) => {
    if (!vars.has(v)) return;
    somar(
      db.prepare(
        `WITH d AS (SELECT pk, id_cliente, dia, SUM(qtd) AS q, SUM(valor) AS v FROM _base WHERE ${OK} ${extra} GROUP BY pk, id_cliente, dia),
              a AS (SELECT pk, id_cliente, dia, SUM(q) OVER w AS cq, SUM(v) OVER w AS cv
                      FROM d WINDOW w AS (PARTITION BY pk, id_cliente ORDER BY dia ROWS UNBOUNDED PRECEDING)),
              f AS (SELECT pk, id_cliente, MIN(dia) AS dia FROM a WHERE cq >= ? AND cv >= ? GROUP BY pk, id_cliente)
         SELECT pk, dia, COUNT(*) AS n FROM f GROUP BY pk, dia`,
      ).all(cr.regra_cliente.min_qtd, cr.regra_cliente.min_valor),
      [[v, 'n']],
    );
  };
  positivados('clientes', '');
  positivados('clientes_novos', 'AND novo = 1');

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
  for (const v of vars) o[v] = s && i >= 0 ? s[v][i] : 0;
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

const projecoes = (s, vars, t) => {
  const o = {};
  for (const v of vars) {
    if (!s) o[v] = 0;
    else if (CONSTANTES.has(v)) o[v] = s[v][s[v].length - 1];
    else o[v] = projetarVar(s[v], t, PESO_RECENTE[v] ?? 0.5);
  }
  return o;
};

/** Variáveis que dependem de dados (sem as constantes, que o motor injeta). */
function varsDeDados(vars) {
  const out = new Set([...vars].filter((v) => !CONSTANTES.has(v)));
  for (const [ant, origem] of Object.entries(ANTERIOR)) if (vars.has(ant)) out.add(origem);
  return out;
}

function coletar(c, cr, colData, inicio, fim, dias, prod, vars) {
  const dados = varsDeDados(vars);
  montarBase(c, cr, colData, inicio, fim, prod, dados);
  return lerSeries(cr, prod, dias, dados);
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
  const st = db.prepare(`SELECT id_vendedor, SUM(${campo}) AS m FROM fato_metas WHERE ano = ? AND mes = ? GROUP BY id_vendedor`);
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

/** Calcula prêmio atual e projetado para todos os participantes (muta as linhas). */
function premiar(c, linhas, idxBase) {
  const pr = c.premiacao;
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

  for (const l of linhas) {
    l.premio = 0;
    l.premio_proj = 0;
    l.faixa = null;
    l.faixa_proj = null;
    l.proxima_faixa = null;
    l.multiplicador = pr.multiplicadores.length ? fator(l, false) : 1;
  }

  if (pr.tipo === 'faixas') {
    for (const l of linhas) {
      for (const proj of [false, true]) {
        const f = (proj ? l.elegivel_proj : l.elegivel) ? faixaDe(proj ? l.score_proj : l.score, pr.faixas) : null;
        const valor = f ? finalizar(l, f.fixo + f.variavel * baseVariavel(l, proj), proj) : 0;
        if (proj) [l.premio_proj, l.faixa_proj] = [valor, f ? pr.faixas.indexOf(f) : null];
        else [l.premio, l.faixa] = [valor, f ? pr.faixas.indexOf(f) : null];
      }
      const prox = pr.faixas.find((x) => x.min > (l.score ?? 0) + EPS);
      if (prox) {
        const cl = c.criterios.length === 1 ? l.criterios[0] : null;
        const cd = c.criterios[0];
        let falta_unidades = null;
        if (cl && cl.meta > 0 && cd.sentido === 'maior' && cd.totalizar === 'soma' && cl.realizado != null) {
          falta_unidades = Math.max(0, (prox.min / 100) * cl.meta - cl.realizado);
          if (cd.formato === 'numero') falta_unidades = Math.ceil(falta_unidades - EPS);
        }
        l.proxima_faixa = {
          indice: pr.faixas.indexOf(prox),
          min: prox.min,
          falta_pontos: prox.min - (l.score ?? 0),
          falta_unidades,
          premio: finalizar(l, prox.fixo + prox.variavel * baseVariavel(l, false), false),
        };
      }
    }
  } else if (pr.tipo === 'ranking') {
    for (const proj of [false, true]) {
      const valor = (l) => (pr.ranking.por === 'realizado' ? real(l, proj) : proj ? l.score_proj : l.score);
      const aptos = linhas
        .filter((l) => {
          const v = valor(l);
          if (v == null || v <= 0) return false;
          const sc = proj ? l.score_proj : l.score;
          return !(pr.ranking.minimo > 0) || (sc != null && sc + EPS >= pr.ranking.minimo);
        })
        .sort((a, b) => valor(b) - valor(a) || real(b, proj) - real(a, proj));
      aptos.forEach((l, i) => {
        const pos = i + 1;
        const faixa = pr.ranking.posicoes.find((x) => pos >= x.de && pos <= x.ate);
        const v = faixa ? finalizar(l, faixa.valor, proj) : 0;
        if (proj) l.premio_proj = v;
        else l.premio = v;
      });
    }
  } else if (pr.tipo === 'rateio') {
    for (const proj of [false, true]) {
      const aptos = linhas.filter((l) => {
        const sc = proj ? l.score_proj : l.score;
        return (proj ? l.elegivel_proj : l.elegivel) && sc != null && sc + EPS >= pr.rateio.minimo;
      });
      const peso = (l) => (pr.rateio.proporcional === 'igual' ? 1 : pr.rateio.proporcional === 'score' ? (proj ? l.score_proj : l.score) : Math.max(0, real(l, proj)));
      const somaPesos = aptos.reduce((a, l) => a + peso(l), 0);
      for (const l of aptos) {
        const v = finalizar(l, somaPesos > 0 ? (pr.rateio.valor_total * peso(l)) / somaPesos : 0, proj);
        if (proj) l.premio_proj = v;
        else l.premio = v;
      }
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
  for (const s of series) for (const v of vars) for (let i = 0; i < n; i++) tot[v][i] += s[v][i];
  return tot;
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

  const internos = [];
  const criterios = c.criterios.map((cr) => {
    let fn;
    try {
      fn = funcaoMetrica(cr);
    } catch (e) {
      ctx.avisos.push(`Critério "${cr.nome}": ${e.message}`);
      fn = { avaliar: () => null, variaveis: [] };
    }
    const vars = new Set([...SEMPRE, ...fn.variaveis]);
    const prod = produtosDoCriterio(cr);
    if (!prod.todos.length) ctx.avisos.push(`Critério "${cr.nome}": nenhum produto corresponde ao filtro.`);

    // período anterior (comparativo, metas por histórico e variáveis *_ant)
    const per = cr.meta.base_inicio && cr.meta.base_fim ? { inicio: cr.meta.base_inicio, fim: cr.meta.base_fim } : periodoAnterior(c.inicio, c.fim);
    const diasBase = intervalo(per.inicio, per.fim);
    const varsHist = new Set([...vars].filter((v) => !ANTERIOR[v]));
    for (const [ant, origem] of Object.entries(ANTERIOR)) if (vars.has(ant)) varsHist.add(origem);
    const hist = coletar(c, cr, ctx.colData, per.inicio, per.fim, diasBase, prod, varsHist);
    if (varsHist.has('n_produtos')) for (const s of hist.values()) s.n_produtos = new Float64Array(diasBase.length).fill(prod.todos.length);
    const ultimoBase = diasBase.length - 1;
    const histMetrica = new Map([...hist].map(([pk, s]) => [pk, fn.avaliar(valoresEm(s, varsHist, ultimoBase))]));

    // período da campanha
    const series = fimEfetivo ? coletar(c, cr, ctx.colData, c.inicio, fimEfetivo, t.dias, prod, vars) : new Map();
    db.exec('DROP TABLE IF EXISTS temp._base');
    for (const p of participantes) if (!series.has(p.chave)) series.set(p.chave, novaSerie(varsDeDados(vars), n));
    for (const [pk, s] of series) {
      if (vars.has('n_produtos')) s.n_produtos = new Float64Array(n).fill(prod.todos.length);
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

    const metas = calcularMetas(c, cr, participantes, histMetrica, ctx);
    const doGrupo = participantes.map((p) => series.get(p.chave));
    const cum = somarSeries(doGrupo, vars, n);
    const histTotal = somarSeries([...hist].filter(([pk]) => chaves.has(pk)).map(([, s]) => s), varsHist, diasBase.length);

    const valoresMeta = participantes.map((p) => metas.get(p.chave)).filter((x) => x != null);
    const metaTotal = !valoresMeta.length
      ? null
      : cr.totalizar === 'soma'
        ? valoresMeta.reduce((a, b) => a + b, 0)
        : valoresMeta.reduce((a, b) => a + b, 0) / valoresMeta.length;
    const realizadoTotal = fn.avaliar(valoresEm(cum, vars, t.idxRef));
    const projTotal = t.status === 'futura' ? null : fn.avaliar(projecoes(cum, vars, t));
    const baseTotal = fn.avaliar(valoresEm(histTotal, varsHist, ultimoBase));

    internos.push({ cr, fn, vars, series, metas, prod });
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
      serie: linhaDoTempo(t, cum, fn, vars, metaTotal, cr.totalizar, projTotal),
    };
  });

  // ---- participantes ----
  const linhas = participantes.map((p) => {
    const cs = internos.map(({ cr, fn, vars, series, metas }) => {
      const s = series.get(p.chave);
      const realizado = fn.avaliar(valoresEm(s, vars, t.idxRef));
      const projecao = t.status === 'futura' ? null : fn.avaliar(projecoes(s, vars, t));
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
  const premio_total = linhas.reduce((a, l) => a + l.premio, 0);
  const premio_proj_total = linhas.reduce((a, l) => a + l.premio_proj, 0);
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
// Cache
// ======================================================================

const cache = new Map();
aoInvalidar(() => cache.clear());

export function apurarComCache(definicao, opcoes = {}) {
  const chave = `${versaoDados()}|${hojeISO()}|${opcoes.referencia || ''}|${JSON.stringify(definicao)}`;
  const achado = cache.get(chave);
  if (achado) {
    cache.delete(chave);
    cache.set(chave, achado);
    return achado;
  }
  const r = apurar(definicao, opcoes);
  cache.set(chave, r);
  while (cache.size > 40) cache.delete(cache.keys().next().value);
  return r;
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
       hist AS (
          SELECT id_cliente, SUM(valor_total) AS valor_hist, SUM(quantidade) AS qtd_hist, MAX(${ctx.colData}) AS ultima,
                 COUNT(DISTINCT id_pedido) AS pedidos_hist
            FROM fato_vendas
           WHERE id_produto IN (${ints(prod.todos)}) AND status IN (${ph(c.status_venda)}) AND ${ctx.colData} BETWEEN ? AND ?
           GROUP BY id_cliente
       ),
       geral AS (
          SELECT id_cliente, SUM(valor_total) AS valor_geral, MAX(${ctx.colData}) AS ultima_compra FROM fato_vendas
           WHERE id_vendedor IN (${ints(vend)}) AND status IN (${ph(c.status_venda)}) AND ${ctx.colData} BETWEEN ? AND ? GROUP BY id_cliente
       )
       SELECT a.id_cliente AS id, COALESCE(cl.nome_fantasia, cl.nome_cliente) AS nome, cl.cidade, cl.estado, cl.segmento, cl.porte,
              h.valor_hist, h.qtd_hist, h.ultima, h.pedidos_hist, g.valor_geral, g.ultima_compra
         FROM alvo a
         JOIN dm_cliente cl ON cl.id_cliente = a.id_cliente
         LEFT JOIN hist h ON h.id_cliente = a.id_cliente
         LEFT JOIN geral g ON g.id_cliente = a.id_cliente
        WHERE a.id_cliente NOT IN (SELECT id_cliente FROM _base WHERE pk = ? AND conta = 1 AND alvo = 1)
        ORDER BY COALESCE(h.valor_hist, 0) DESC, COALESCE(g.valor_geral, 0) DESC
        LIMIT ${Math.trunc(limite)}`,
    )
    .all(
      addDias(c.inicio, -90), ref,
      ...c.status_venda, addDias(c.inicio, -120), addDias(c.inicio, -1),
      ...c.status_venda, addDias(c.inicio, -90), ref,
      String(chave),
    );
}

/** Oportunidades de todos os participantes de um critério (usado pela central de insights e pela IA). */
export function oportunidadesDaCampanha(resultado, idCriterio, porParticipante = 5) {
  const { c, ctx, internos } = resultado._interno;
  if (ctx.tempo.status === 'futura' || !['vendedor', 'equipe'].includes(c.participantes.nivel)) return [];
  const it = internos.find((x) => x.cr.id === idCriterio) || internos[0];
  montarBase(c, it.cr, ctx.colData, c.inicio, ctx.tempo.dias[ctx.tempo.idxRef], it.prod, new Set());
  const out = [];
  for (const l of resultado.participantes) {
    if (l.status === 'atingiu') continue;
    const ops = oportunidadesDe(c, ctx, it.prod, c.participantes.nivel, l.chave, porParticipante).filter((o) => o.valor_hist > 0);
    if (ops.length) out.push({ chave: l.chave, nome: l.nome, status: l.status, oportunidades: ops });
  }
  db.exec('DROP TABLE IF EXISTS temp._base');
  return out;
}

// ======================================================================
// Estoque dos produtos da campanha
// ======================================================================

export function estoqueDaCampanha(resultado) {
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
