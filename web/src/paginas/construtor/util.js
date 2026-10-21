import { fmtData, fmtMoeda, fmtNumero, fmtPeriodo, fmtValor } from '../../lib/formato.js';

// ======================================================================
// Datas e modelos
// ======================================================================

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (a, m, d) => new Date(Date.UTC(a, m, d));

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mesmo contrato de server/modelos.js: '@mes_atual_inicio', '@hoje+7'... */
export function resolverMarcadorData(valor, hoje = hojeISO()) {
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

export function resolverModelo(definicao, hoje = hojeISO()) {
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

export function atalhosPeriodo(hoje = hojeISO()) {
  const r = (a, b) => ({ inicio: resolverMarcadorData(a, hoje), fim: resolverMarcadorData(b, hoje) });
  return [
    { rotulo: 'Este mês', ...r('@mes_atual_inicio', '@mes_atual_fim') },
    { rotulo: 'Próximo mês', ...r('@proximo_mes_inicio', '@proximo_mes_fim') },
    { rotulo: 'Mês passado', ...r('@mes_anterior_inicio', '@mes_anterior_fim') },
    { rotulo: 'Trimestre', ...r('@trimestre_inicio', '@trimestre_fim') },
    { rotulo: 'Próximos 15 dias', inicio: hoje, fim: resolverMarcadorData('@hoje+14', hoje) },
  ];
}

// ======================================================================
// Estrutura da definição
// ======================================================================

export const CORES_CAMPANHA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export const SELETOR_VAZIO = () => ({ fabricantes: [], marcas: [], subcategorias: [], grupos: [], ids: [], excluir: [] });
const FILTROS_VAZIOS = () => ({ canais: [], segmentos: [], portes: [], estados: [], cidades: [], curvas: [], clientes: [], cfops: [], cfops_excluir: [] });

export const FAIXAS_PADRAO = () => [
  { min: 90, fixo: 80, variavel: 0, rotulo: 'Bronze' },
  { min: 100, fixo: 150, variavel: 0, rotulo: 'Prata' },
  { min: 120, fixo: 250, variavel: 0, rotulo: 'Ouro' },
];

const PREMIACAO_PADRAO = () => ({
  tipo: 'faixas',
  faixas: FAIXAS_PADRAO(),
  variavel_sobre: 'total',
  criterio_base: 'c1',
  ranking: { por: 'score', minimo: 0, posicoes: [{ de: 1, ate: 1, valor: 500 }, { de: 2, ate: 2, valor: 300 }, { de: 3, ate: 3, valor: 200 }] },
  rateio: { valor_total: 5000, minimo: 100, proporcional: 'realizado' },
  bloco: { tamanho: 15, valor: 10, sobre: 'total', exigencia: 'nenhuma', minimo: 0, max_blocos: null },
  bonus: { ativo: false, min: 100, valor: 50 },
  multiplicadores: [],
  teto_participante: null,
  orcamento: null,
});

const completarSeletor = (s) => {
  const v = SELETOR_VAZIO();
  for (const k of Object.keys(v)) v[k] = Array.isArray(s?.[k]) ? [...s[k]] : [];
  return v;
};

export function completarCriterio(c = {}, i = 0) {
  return {
    id: String(c.id || `c${i + 1}`),
    nome: c.nome ?? '',
    metrica: c.metrica || 'quantidade',
    expressao: c.expressao || '',
    formato: c.formato,
    totalizar: c.totalizar,
    sentido: c.sentido,
    produtos: completarSeletor(c.produtos),
    produtos_ref: completarSeletor(c.produtos_ref),
    combo: {
      escopo: c.combo?.escopo === 'cliente' ? 'cliente' : 'pedido',
      contar: c.combo?.contar === 'kits' ? 'kits' : 'ocorrencias',
      itens: (c.combo?.itens || []).map((it, k) => ({ nome: it.nome ?? `Item ${k + 1}`, minimo: it.minimo ?? 1, produtos: completarSeletor(it.produtos) })),
    },
    regra_cliente: { min_qtd: 0, min_valor: 0, min_skus: 0, min_marcas: 0, min_pedidos: 0, ...(c.regra_cliente || {}) },
    regra_pedido: { min_qtd: 0, min_valor: 0, ...(c.regra_pedido || {}) },
    regra_sku: { min_clientes: 0, ...(c.regra_sku || {}) },
    novos: { dias: 90, ...(c.novos || {}) },
    meta: {
      tipo: 'fixa',
      valor: 0,
      distribuir_por: 'historico',
      crescimento: 10,
      piso: 0,
      base_inicio: null,
      base_fim: null,
      campo: 'meta_valor',
      fator: 100,
      arredondar: null,
      ...(c.meta || {}),
      valores: { ...(c.meta?.valores || {}) },
    },
    peso: c.peso ?? 1,
    gatilho: c.gatilho ?? 0,
    teto: c.teto ?? null,
  };
}

/** Garante que todas as estruturas existem (definição vinda de modelo, banco ou rascunho). */
export function completar(def = {}, hoje = hojeISO()) {
  const atalho = atalhosPeriodo(hoje)[0];
  const criterios = (def.criterios?.length ? def.criterios : [{ nome: 'Unidades', metrica: 'quantidade', meta: { tipo: 'historico', crescimento: 10 } }]).map(completarCriterio);
  const pr = def.premiacao || {};
  const padrao = PREMIACAO_PADRAO();
  return {
    nome: def.nome ?? '',
    fornecedor: def.fornecedor ?? '',
    fabricante: def.fabricante || null,
    varios_fornecedores: !def.fabricante && Boolean(def.varios_fornecedores),
    descricao: def.descricao ?? '',
    cor: def.cor || CORES_CAMPANHA[0],
    inicio: def.inicio || atalho.inicio,
    fim: def.fim || atalho.fim,
    data_base: def.data_base === 'faturamento' ? 'faturamento' : 'pedido',
    status_venda: def.status_venda?.length ? [...def.status_venda] : ['Faturado'],
    calendario: def.calendario || null,
    participantes: { nivel: 'vendedor', ids: [], equipes: [], ...(def.participantes || {}) },
    filtros: { ...FILTROS_VAZIOS(), ...(def.filtros || {}) },
    criterios,
    apuracao: { regra: 'ponderada', ...(def.apuracao || {}) },
    premiacao: {
      ...padrao,
      ...pr,
      faixas: pr.faixas ? pr.faixas.map((f) => ({ ...f })) : padrao.faixas,
      ranking: { ...padrao.ranking, ...(pr.ranking || {}), posicoes: pr.ranking?.posicoes ? pr.ranking.posicoes.map((p) => ({ ...p })) : padrao.ranking.posicoes },
      rateio: { ...padrao.rateio, ...(pr.rateio || {}) },
      bloco: { ...padrao.bloco, ...(pr.bloco || {}) },
      bonus: { ...padrao.bonus, ...(pr.bonus || {}) },
      multiplicadores: (pr.multiplicadores || []).map((m) => ({ ...m })),
      criterio_base: criterios.some((c) => c.id === pr.criterio_base) ? pr.criterio_base : criterios[0].id,
    },
  };
}

export function novoIdCriterio(criterios) {
  const usados = new Set(criterios.map((c) => c.id));
  let i = criterios.length + 1;
  while (usados.has(`c${i}`)) i++;
  return `c${i}`;
}

/** Atualização imutável por caminho: definir(obj, ['criterios', 0, 'meta', 'valor'], 10) */
export function definir(obj, caminho, valor) {
  if (!caminho.length) return typeof valor === 'function' ? valor(obj) : valor;
  const [k, ...resto] = caminho;
  const copia = Array.isArray(obj) ? [...obj] : { ...obj };
  copia[k] = definir(obj?.[k], resto, valor);
  return copia;
}

/** Identificadores usados por uma expressão (ignora o miolo das variáveis parametrizadas). */
export function idsDaExpressao(expr = '') {
  const limpa = String(expr).replace(/\{[^}]*\}/g, '').replace(/"[^"]*"/g, '');
  return [...new Set((limpa.match(/[a-z_][a-z0-9_]*/gi) || []).map((s) => s.toLowerCase()))];
}

/** Variáveis que a métrica do critério usa (para mostrar só os campos relevantes). */
export function variaveisDoCriterio(cr, catalogo) {
  if (cr.metrica === 'personalizada') {
    const base = idsDaExpressao(cr.expressao);
    const param = [...String(cr.expressao).matchAll(/([a-z_][a-z0-9_]*)\s*\{/gi)].map((m) => m[1].toLowerCase());
    return new Set([...base, ...param]);
  }
  if (cr.metrica === 'combo') return new Set(['combos', 'kits']);
  return new Set(idsDaExpressao(catalogo?.metricas?.[cr.metrica]?.expr || ''));
}

// ======================================================================
// Produtos (resolução local, mesma regra do servidor)
// ======================================================================

export function resolverSeletorLocal(sel, produtos = [], grupos = [], profundidade = 0) {
  if (!produtos.length) return [];
  const fab = new Set(sel?.fabricantes || []);
  const mar = new Set(sel?.marcas || []);
  const sub = new Set(sel?.subcategorias || []);
  const temFiltro = fab.size || mar.size || sub.size;
  const ids = (sel?.ids || []).map(Number);
  const gs = (sel?.grupos || []).map(Number);
  const out = new Set();
  if (temFiltro) {
    for (const p of produtos) {
      if ((!fab.size || fab.has(p.fabricante)) && (!mar.size || mar.has(p.marca)) && (!sub.size || sub.has(p.subcategoria))) out.add(p.id);
    }
  }
  if (gs.length && profundidade < 3) {
    for (const g of gs) {
      const grupo = grupos.find((x) => Number(x.id) === g);
      if (grupo) for (const id of resolverSeletorLocal(grupo.seletor || {}, produtos, grupos, profundidade + 1)) out.add(id);
    }
  }
  const existentes = new Set(produtos.map((p) => p.id));
  for (const id of ids) if (existentes.has(id)) out.add(id);
  if (!temFiltro && !ids.length && !gs.length) for (const p of produtos) out.add(p.id);
  for (const id of sel?.excluir || []) out.delete(Number(id));
  return [...out];
}

export function seletorVazio(sel) {
  return !sel || !['fabricantes', 'marcas', 'subcategorias', 'grupos', 'ids'].some((k) => sel[k]?.length);
}

const lista = (arr, max = 3) => (arr.length <= max ? arr.join(', ') : `${arr.slice(0, max).join(', ')} e mais ${arr.length - max}`);

export function descreverSeletor(sel, grupos = []) {
  if (seletorVazio(sel)) return 'todos os produtos';
  const partes = [];
  if (sel.fabricantes?.length) partes.push(`${sel.fabricantes.length > 1 ? 'fabricantes' : 'fabricante'} ${lista(sel.fabricantes)}`);
  if (sel.marcas?.length) partes.push(`${sel.marcas.length > 1 ? 'marcas' : 'marca'} ${lista(sel.marcas)}`);
  if (sel.subcategorias?.length) partes.push(`${sel.subcategorias.length > 1 ? 'subcategorias' : 'subcategoria'} ${lista(sel.subcategorias)}`);
  let texto = partes.join(' + ');
  if (sel.grupos?.length) {
    const nomes = sel.grupos.map((g) => grupos.find((x) => Number(x.id) === Number(g))?.nome || `linha #${g}`);
    texto = [texto, `linha ${lista(nomes)}`].filter(Boolean).join(' + ');
  }
  if (sel.ids?.length) texto = [texto, `${sel.ids.length} produto${sel.ids.length > 1 ? 's' : ''} avulso${sel.ids.length > 1 ? 's' : ''}`].filter(Boolean).join(' + ');
  if (sel.excluir?.length) texto += ` (exceto ${sel.excluir.length})`;
  return texto;
}

// ======================================================================
// Números e texto
// ======================================================================

/** Interpreta números em formato brasileiro ou americano: "1.234,5", "1234.5", "R$ 1.200", "15%". */
export function numeroBR(txt) {
  if (txt == null) return null;
  let s = String(txt).replace(/R\$|%|\s/g, '').trim();
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const normalizarTexto = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Info da métrica do critério (formato/unidade/sentido efetivos). */
export function infoMetrica(cr, catalogo) {
  const m = catalogo?.metricas?.[cr.metrica] || {};
  const formato = cr.metrica === 'personalizada' ? cr.formato || 'decimal' : cr.formato || m.formato || 'numero';
  let unidade = m.unidade || null;
  if (cr.metrica === 'combo') unidade = cr.combo.contar === 'kits' ? 'kits' : cr.combo.escopo === 'cliente' ? 'clientes' : 'pedidos';
  const sentido = cr.sentido || m.sentido || 'maior';
  return { nome: m.nome || cr.metrica, grupo: m.grupo, descricao: m.descricao, expr: m.expr, formato, unidade, sentido, totalizar: cr.totalizar || m.totalizar || 'soma' };
}

export function fmtMetrica(v, info) {
  const s = fmtValor(v, info.formato);
  if (v == null || !Number.isFinite(Number(v))) return s;
  return info.unidade && info.formato === 'numero' ? `${s} ${info.unidade}` : s;
}

const NIVEL_SINGULAR = { vendedor: 'vendedor', equipe: 'equipe', cliente: 'cliente', canal: 'canal', estado: 'UF', segmento: 'segmento', empresa: 'empresa' };
const NIVEL_PLURAL = { vendedor: 'vendedores', equipe: 'equipes', cliente: 'clientes', canal: 'canais', estado: 'UFs', segmento: 'segmentos', empresa: 'a empresa' };
export const nivelSingular = (n) => NIVEL_SINGULAR[n] || 'participante';
export const nivelPlural = (n) => NIVEL_PLURAL[n] || 'participantes';

export function descreverMeta(cr, catalogo, nivel) {
  const info = infoMetrica(cr, catalogo);
  const m = cr.meta;
  const quem = nivelSingular(nivel);
  const ajustes = Object.keys(m.valores || {}).length;
  let t;
  switch (m.tipo) {
    case 'fixa':
      t = `meta de ${fmtMetrica(m.valor, info)} por ${quem}`;
      break;
    case 'distribuida':
      t = `meta total de ${fmtMetrica(m.valor, info)}, distribuída ${
        m.distribuir_por === 'igual' ? 'igualmente' : m.distribuir_por === 'meta_geral' ? 'proporcionalmente à meta geral de cada um' : 'pelo histórico de cada um'
      }`;
      break;
    case 'historico':
      t = `meta individual = período ${m.base_inicio && m.base_fim ? `de ${fmtData(m.base_inicio)} a ${fmtData(m.base_fim)}` : 'anterior'} ${m.crescimento >= 0 ? '+' : ''}${fmtNumero(m.crescimento, m.crescimento % 1 ? 1 : 0)}%${m.piso ? ` (mínimo ${fmtMetrica(m.piso, info)})` : ''}`;
      break;
    case 'meta_geral':
      t = `${fmtNumero(m.fator)}% da meta geral de ${m.campo === 'meta_quantidade' ? 'quantidade' : 'faturamento'} do mês (cadastro do ERP)`;
      break;
    default:
      t = 'sem meta (vale o ranking)';
  }
  if (ajustes) t += ` · ${ajustes} meta${ajustes > 1 ? 's ajustadas' : ' ajustada'} à mão`;
  return t;
}

// ======================================================================
// Frases em linguagem comum (resumo vivo de cada critério)
// ======================================================================

const listaE = (arr, max = 3) => {
  if (arr.length <= 1) return arr.join('');
  if (arr.length <= max) return `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`;
  return `${arr.slice(0, max).join(', ')} e mais ${arr.length - max}`;
};

/** "produtos Haleon", "Sensodyne e Corega", "analgésicos e antitérmicos", "qualquer produto". */
export function produtosEmPalavras(sel, grupos = []) {
  if (seletorVazio(sel)) return 'qualquer produto';
  const partes = [];
  const subs = (sel.subcategorias || []).map((s) => s.toLowerCase());
  if (sel.marcas?.length) partes.push(listaE(sel.marcas));
  else if (sel.fabricantes?.length) partes.push(`produtos ${listaE(sel.fabricantes)}`);
  if (subs.length) partes.push(partes.length ? `(${listaE(subs)})` : listaE(subs));
  let texto = partes.join(' ');
  if (sel.grupos?.length) {
    const nomes = sel.grupos.map((g) => grupos.find((x) => Number(x.id) === Number(g))?.nome || `#${g}`);
    texto = [texto, `linha ${listaE(nomes)}`].filter(Boolean).join(' + ');
  }
  if (sel.ids?.length) texto = [texto, `${sel.ids.length} produto${sel.ids.length > 1 ? 's escolhidos' : ' escolhido'}`].filter(Boolean).join(' + ');
  if (sel.excluir?.length) texto += `, com ${sel.excluir.length} exceç${sel.excluir.length > 1 ? 'ões' : 'ão'}`;
  return texto;
}

// como falar de cada medida: verbo (infinitivo, passado, futuro do subjuntivo), o que se conta e a preposição dos produtos
const VERBOS = {
  quantidade: { inf: 'vender', pass: 'vendeu', subj: 'vender', coisa: 'unidades', prep: 'de' },
  quantidade_liquida: { inf: 'vender', pass: 'vendeu', subj: 'vender', coisa: 'unidades (descontadas as devoluções)', prep: 'de' },
  valor: { inf: 'faturar', pass: 'faturou', subj: 'faturar', coisa: '', prep: 'com' },
  valor_liquido_dev: { inf: 'faturar', pass: 'faturou', subj: 'faturar', coisa: '', prep: 'com', obs: ' (descontadas as devoluções)' },
  positivacao: { inf: 'positivar', pass: 'positivou', subj: 'positivar', coisa: 'clientes', prep: 'em' },
  mix: { inf: 'vender', pass: 'vendeu', subj: 'vender', coisa: 'produtos diferentes', prep: 'entre' },
  mix_marcas: { inf: 'vender', pass: 'vendeu', subj: 'vender', coisa: 'marcas diferentes', prep: 'entre' },
  pedidos: { inf: 'fazer', pass: 'fez', subj: 'fizer', coisa: 'pedidos', prep: 'com' },
  clientes_novos: { inf: 'conquistar', pass: 'conquistou', subj: 'conquistar', coisa: 'clientes novos', prep: 'em' },
  clientes_reativados: { inf: 'reativar', pass: 'reativou', subj: 'reativar', coisa: 'clientes parados', prep: 'com' },
};

/** Uma frase que qualquer pessoa entende: o que o participante precisa fazer neste critério. */
export function fraseCriterio(cr, catalogo, nivel, grupos = [], premiacao = null) {
  const info = infoMetrica(cr, catalogo);
  const m = cr.meta;
  const quem = nivelSingular(nivel);
  const sujeito = nivel === 'empresa' ? 'A empresa' : `Cada ${quem}`;
  const fmt = (v) => (info.formato === 'numero' && info.unidade === 'un' && v != null ? `${fmtNumero(v)} unidade${v === 1 ? '' : 's'}` : fmtMetrica(v, info));
  const menor = info.sentido === 'menor';
  let v = VERBOS[cr.metrica];
  let prod = produtosEmPalavras(cr.produtos, grupos);
  if (cr.metrica === 'combo') {
    const itens = listaE(cr.combo.itens.map((it) => `${it.nome || produtosEmPalavras(it.produtos, grupos)} (${fmtNumero(it.minimo)}+)`), 4);
    if (cr.combo.escopo === 'cliente') {
      v = { inf: 'ter', pass: 'teve', subj: 'tiver', coisa: 'clientes', prep: '' };
      prod = `que levaram ${itens} no período`;
    } else if (cr.combo.contar === 'kits') {
      v = { inf: 'montar', pass: 'montou', subj: 'montar', coisa: 'kits', prep: '' };
      prod = `com ${itens}`;
    } else {
      v = { inf: 'fazer', pass: 'fez', subj: 'fizer', coisa: 'pedidos', prep: '' };
      prod = `com ${itens} juntos`;
    }
  }
  const nomeMed = info.nome.toLowerCase();
  const compl = (prep) => `${prep ? `${prep} ` : ''}${prod}`;
  const temUnidade = info.formato === 'numero' && info.unidade;
  let t;
  switch (m.tipo) {
    case 'fixa':
      t = v && !menor
        ? `${sujeito} precisa ${v.inf} ${fmt(m.valor)}${v.coisa && !temUnidade ? ` ${v.coisa}` : ''}${v.obs || ''} ${compl(v.prep)}.`
        : `${sujeito} precisa ${menor ? 'ficar com no máximo' : 'chegar a'} ${fmt(m.valor)} em ${nomeMed} (${prod}).`;
      break;
    case 'distribuida': {
      const modo = m.distribuir_por === 'igual' ? 'em partes iguais' : m.distribuir_por === 'meta_geral' ? 'na proporção da meta de cada um no ERP' : 'na proporção do que cada um vendeu antes';
      t = `A meta total de ${fmt(m.valor)}${v ? '' : ` em ${nomeMed}`} ${compl(v?.prep ?? 'de')} é dividida entre ${nivel === 'empresa' ? 'a empresa' : `os ${nivelPlural(nivel)}`} ${modo}.`;
      break;
    }
    case 'historico': {
      const pct = fmtNumero(Math.abs(m.crescimento), m.crescimento % 1 ? 1 : 0);
      const periodo = m.base_inicio && m.base_fim ? `entre ${fmtData(m.base_inicio)} e ${fmtData(m.base_fim)}` : 'no período anterior';
      if (v && !menor) {
        const coisa = v.coisa || '';
        const quanto = m.crescimento === 0 ? `o mesmo${coisa ? ` em ${coisa}` : ''}` : `${pct}% ${coisa ? `${m.crescimento > 0 ? 'mais' : 'menos'} ${coisa}` : m.crescimento > 0 ? 'a mais' : 'a menos'}`;
        t = `${sujeito} precisa ${v.inf} ${quanto}${v.obs || ''} ${compl(v.prep)} do que ${v.pass} ${periodo}.`;
      } else {
        const quanto = m.crescimento === 0 ? 'igual ao' : `${pct}% ${m.crescimento > 0 ? 'acima do' : 'abaixo do'}`;
        t = `A meta de ${nivel === 'empresa' ? 'a empresa' : `cada ${quem}`} em ${nomeMed} (${prod}) é ficar ${quanto} próprio resultado ${periodo}.`;
      }
      if (m.piso > 0) t += ` Quem não tiver histórico recebe a meta mínima de ${fmt(m.piso)}.`;
      break;
    }
    case 'meta_geral':
      t = `${sujeito} precisa atingir ${fmtNumero(m.fator)}% da própria meta de ${m.campo === 'meta_quantidade' ? 'quantidade' : 'faturamento'} cadastrada no ERP, contando ${prod}.`;
      break;
    default:
      if (premiacao?.tipo === 'bloco' && premiacao.criterio_base === cr.id) {
        t = `Sem meta: cada ${quem} ganha por bloco, pelo total que ${v ? `${v.subj}${v.coisa ? ` (em ${v.coisa})` : ''} ${compl(v.prep)}` : `fizer em ${nomeMed} (${prod})`}.`;
      } else {
        t = v && !menor
          ? `Sem meta: vence quem ${v.subj} mais${v.coisa ? ` ${v.coisa}` : ''}${v.obs || ''} ${compl(v.prep)}.`
          : `Sem meta: vence quem tiver ${menor ? 'o menor' : 'o maior'} resultado em ${nomeMed} (${prod}).`;
      }
  }
  const rc = cr.regra_cliente || {};
  const minimos = [rc.min_qtd > 0 && `${fmtNumero(rc.min_qtd)} unidades`, rc.min_valor > 0 && fmtMoeda(rc.min_valor), rc.min_skus > 0 && `${fmtNumero(rc.min_skus)} produtos diferentes`].filter(Boolean);
  if (minimos.length && variaveisDoCriterio(cr, catalogo).has('clientes')) t += ` Um cliente só conta se comprar pelo menos ${listaE(minimos)}.`;
  const ajustes = Object.keys(m.valores || {}).length;
  if (ajustes && m.tipo !== 'sem_meta') t += ` ${ajustes} meta${ajustes > 1 ? 's foram ajustadas' : ' foi ajustada'} à mão.`;
  return t;
}

// ======================================================================
// Fornecedor (fabricante da base) vinculado à campanha
// ======================================================================

export const VARIOS_FORNECEDORES = '__varios__';

/** Restringe um seletor ao fabricante: mantém o que já é dele (marcas, subcategorias) e troca o que é de outro. */
export function seletorDoFabricante(sel, fab, { marcas = [], produtos = [], grupos = [] } = {}) {
  const fabDe = new Map(produtos.map((p) => [p.id, p.fabricante]));
  const atuais = seletorVazio(sel) ? [] : resolverSeletorLocal(sel, produtos, grupos);
  if (atuais.length && atuais.every((id) => fabDe.get(id) === fab)) return sel;
  const doFab = new Set(marcas.filter((m) => m.fabricante === fab).map((m) => m.nome));
  const novo = {
    ...SELETOR_VAZIO(),
    fabricantes: [fab],
    marcas: (sel.marcas || []).filter((m) => doFab.has(m)),
    subcategorias: [...(sel.subcategorias || [])],
    ids: (sel.ids || []).filter((id) => fabDe.get(Number(id)) === fab),
    excluir: (sel.excluir || []).filter((id) => fabDe.get(Number(id)) === fab),
  };
  if (novo.subcategorias.length && produtos.length && !resolverSeletorLocal({ ...novo, ids: [] }, produtos, grupos).length) novo.subcategorias = [];
  return novo;
}

/**
 * Vincula a definição a um fabricante (ou a vários fornecedores) e adapta os produtos dos critérios.
 * Devolve { def, mudou: [rótulos dos critérios alterados], kits: [critérios de kit que precisam de marca] }.
 */
export function adaptarAoFabricante(def, fab, ctx = {}, { nomeModelo } = {}) {
  if (fab === VARIOS_FORNECEDORES) return { def: { ...def, fabricante: null, varios_fornecedores: true, fornecedor: 'Vários fornecedores' }, mudou: [], kits: [] };
  const anterior = def.fabricante || def.fornecedor || '';
  const base = { ...def, fabricante: fab, varios_fornecedores: false, fornecedor: fab };
  if (!fab || anterior === fab) return { def: base, mudou: [], kits: [] };
  const mudou = [];
  const kits = [];
  const marcasAntigas = new Set();
  const criterios = def.criterios.map((cr, i) => {
    const rot = cr.nome || `Critério ${i + 1}`;
    if (cr.metrica === 'combo') {
      const itens = cr.combo.itens.map((it) => {
        (it.produtos.marcas || []).forEach((m) => marcasAntigas.add(m));
        return { ...it, produtos: seletorDoFabricante(it.produtos, fab, ctx) };
      });
      if (JSON.stringify(itens) === JSON.stringify(cr.combo.itens)) return cr;
      kits.push(rot);
      return { ...cr, combo: { ...cr.combo, itens: itens.map((it, k) => ({ ...it, nome: `Item ${k + 1}` })) } };
    }
    (cr.produtos.marcas || []).forEach((m) => marcasAntigas.add(m));
    const produtos = seletorDoFabricante(cr.produtos, fab, ctx);
    if (JSON.stringify(produtos) === JSON.stringify(cr.produtos)) return cr;
    mudou.push(rot);
    return { ...cr, produtos };
  });
  const doFab = new Set((ctx.marcas || []).filter((m) => m.fabricante === fab).map((m) => m.nome));
  const outras = [...marcasAntigas].filter((m) => !doFab.has(m));
  const citaOutra = (txt) => outras.some((m) => String(txt || '').includes(m));
  const trocar = (txt) => (anterior ? String(txt || '').split(anterior).join(fab) : String(txt || ''));
  return {
    def: {
      ...base,
      nome: !def.nome ? '' : anterior && def.nome.includes(anterior) && !citaOutra(def.nome) ? trocar(def.nome) : `${fab}: ${nomeModelo || def.nome}`,
      descricao: citaOutra(def.descricao) ? '' : trocar(def.descricao),
      criterios: criterios.map((cr) => (citaOutra(cr.nome) ? { ...cr, nome: '' } : { ...cr, nome: trocar(cr.nome) })),
    },
    mudou,
    kits,
  };
}

/** Definições antigas: descobre o fabricante pelo nome do fornecedor ou pelos produtos dos critérios. */
export function inferirFabricante(def, dim) {
  if (def.fabricante || def.varios_fornecedores || !dim?.fabricantes) return def;
  const alvo = normalizarTexto(def.fornecedor);
  let fab = alvo ? dim.fabricantes.find((f) => normalizarTexto(f.nome) === alvo)?.nome : null;
  if (!fab) {
    const fabDaMarca = new Map((dim.marcas || []).map((m) => [m.nome, m.fabricante]));
    const achados = new Set();
    let geral = false;
    const olhar = (sel) => {
      if (!sel.fabricantes?.length && !sel.marcas?.length) geral = true;
      (sel.fabricantes || []).forEach((f) => achados.add(f));
      (sel.marcas || []).forEach((m) => fabDaMarca.has(m) && achados.add(fabDaMarca.get(m)));
    };
    for (const cr of def.criterios) {
      if (cr.metrica === 'combo') cr.combo.itens.forEach((it) => olhar(it.produtos));
      else olhar(cr.produtos);
    }
    if (!geral && achados.size === 1) [fab] = achados;
  }
  return fab ? { ...def, fabricante: fab, fornecedor: fab } : def;
}

const ROTULO_POS = (de, ate) => (de === ate ? `${de}º lugar` : `do ${de}º ao ${ate}º`);

/** Regulamento em linguagem natural: [{ titulo, itens: [texto] }] */
export function regulamento(def, { catalogo, dimensoes } = {}) {
  const secoes = [];
  const grupos = dimensoes?.grupos || [];
  const nivel = def.participantes.nivel;
  const qtdIds = def.participantes.ids.length;

  const geral = [];
  geral.push(
    `${def.nome || 'Campanha sem nome'}${def.fornecedor ? ` (${def.fornecedor})` : ''}, válida ${fmtPeriodo(def.inicio, def.fim)}, apurada pela data de ${def.data_base === 'faturamento' ? 'faturamento' : 'pedido'}.`,
  );
  geral.push(`Contam vendas com situação ${lista(def.status_venda, 5)}.`);
  if (def.descricao) geral.push(def.descricao);
  secoes.push({ titulo: 'Campanha', itens: geral });

  const part = [];
  if (nivel === 'empresa') part.push('Apuração consolidada da empresa inteira.');
  else if (qtdIds) part.push(`Participam ${qtdIds} ${nivelPlural(nivel)} selecionados.`);
  else part.push(`Participam todos os ${nivelPlural(nivel)}.`);
  if (nivel === 'vendedor' && def.participantes.equipes.length) {
    const nomes = def.participantes.equipes.map((id) => dimensoes?.equipes?.find((e) => String(e.id) === String(id))?.nome || `#${id}`);
    part.push(`Somente das equipes: ${lista(nomes, 4)}.`);
  }
  secoes.push({ titulo: 'Quem participa', itens: part });

  const f = def.filtros;
  const filtros = [];
  const nomesCanais = (ids) => ids.map((id) => dimensoes?.canais?.find((c) => Number(c.id) === Number(id))?.nome || `#${id}`);
  if (f.canais.length) filtros.push(`Apenas canais ${lista(nomesCanais(f.canais), 4)}.`);
  if (f.segmentos.length) filtros.push(`Apenas clientes dos segmentos ${lista(f.segmentos, 4)}.`);
  if (f.portes.length) filtros.push(`Apenas clientes de porte ${lista(f.portes, 4)}.`);
  if (f.estados.length) filtros.push(`Apenas clientes das UFs ${lista(f.estados, 6)}.`);
  if (f.cidades?.length) filtros.push(`Apenas clientes das cidades ${lista(f.cidades, 4)}.`);
  if (f.curvas?.length) filtros.push(`Apenas clientes curva ${f.curvas.join('/')}.`);
  if (f.clientes.length) filtros.push(`Apenas ${f.clientes.length} cliente${f.clientes.length > 1 ? 's' : ''} específico${f.clientes.length > 1 ? 's' : ''}.`);
  if (f.cfops.length) filtros.push(`Apenas CFOP ${lista(f.cfops, 6)}.`);
  if (f.cfops_excluir.length) filtros.push(`Desconsidera CFOP ${lista(f.cfops_excluir, 6)}${f.cfops_excluir.some((c) => c.endsWith('.910')) ? ' (bonificações)' : ''}.`);
  if (!filtros.length) filtros.push('Todas as vendas dos produtos de cada critério contam, sem restrição de canal, cliente ou CFOP.');
  secoes.push({ titulo: 'Vendas que contam', itens: filtros });

  const crits = def.criterios.map((cr, i) => {
    const info = infoMetrica(cr, catalogo);
    const nome = cr.nome || info.nome;
    let oQue;
    if (cr.metrica === 'combo') {
      const itens = cr.combo.itens.map((it) => `${fmtNumero(it.minimo)}+ un de ${it.nome || descreverSeletor(it.produtos, grupos)}`);
      oQue = `${cr.combo.contar === 'kits' ? 'kits completos' : cr.combo.escopo === 'cliente' ? 'clientes que levaram' : 'pedidos com'} ${itens.join(' + ')}${cr.combo.escopo === 'cliente' ? ' no período' : ' no mesmo pedido'}`;
    } else if (cr.metrica === 'personalizada') {
      oQue = `fórmula ${cr.expressao || '(vazia)'} sobre ${descreverSeletor(cr.produtos, grupos)}`;
    } else {
      oQue = `${info.nome.toLowerCase()} de ${descreverSeletor(cr.produtos, grupos)}`;
    }
    const extras = [];
    const rc = cr.regra_cliente || {};
    const regrasCli = [];
    if (rc.min_qtd > 0) regrasCli.push(`${fmtNumero(rc.min_qtd)}+ unidades`);
    if (rc.min_valor > 0) regrasCli.push(`${fmtMoeda(rc.min_valor)}+`);
    if (rc.min_skus > 0) regrasCli.push(`${fmtNumero(rc.min_skus)}+ SKUs diferentes`);
    if (rc.min_marcas > 0) regrasCli.push(`${fmtNumero(rc.min_marcas)}+ marcas`);
    if (rc.min_pedidos > 0) regrasCli.push(`${fmtNumero(rc.min_pedidos)}+ pedidos`);
    const vars = variaveisDoCriterio(cr, catalogo);
    if (regrasCli.length && vars.has('clientes')) extras.push(`cliente só conta com ${regrasCli.join(', ')}`);
    if ((cr.regra_pedido?.min_qtd > 0 || cr.regra_pedido?.min_valor > 0) && vars.has('pedidos')) {
      extras.push(`pedido só conta com ${[cr.regra_pedido.min_qtd > 0 && `${fmtNumero(cr.regra_pedido.min_qtd)}+ un`, cr.regra_pedido.min_valor > 0 && fmtMoeda(cr.regra_pedido.min_valor)].filter(Boolean).join(' e ')}`);
    }
    if (cr.regra_sku?.min_clientes > 0 && vars.has('skus')) extras.push(`SKU só conta se vendido para ${fmtNumero(cr.regra_sku.min_clientes)}+ clientes`);
    if (vars.has('clientes_novos') || vars.has('clientes_reativados')) extras.push(`novo/reativado = sem compra nos ${fmtNumero(cr.novos.dias)} dias anteriores`);
    if (info.sentido === 'menor') extras.push('quanto menor, melhor');
    const pont = [];
    if (def.criterios.length > 1) pont.push(`peso ${fmtNumero(cr.peso, cr.peso % 1 ? 1 : 0)}`);
    if (cr.gatilho > 0) pont.push(`mínimo de ${fmtNumero(cr.gatilho)}% para pontuar`);
    if (cr.teto != null) pont.push(`atingimento limitado a ${fmtNumero(cr.teto)}%`);
    return `${i + 1}. ${nome}: ${oQue}${extras.length ? ` (${extras.join('; ')})` : ''}. ${descreverMeta(cr, catalogo, nivel).replace(/^./, (c) => c.toUpperCase())}${pont.length ? `; ${pont.join(', ')}` : ''}.`;
  });
  const regra = def.apuracao.regra;
  if (def.criterios.length > 1) {
    crits.push(
      regra === 'todos'
        ? 'Pontuação: média ponderada dos atingimentos, mas só é elegível quem cumprir o mínimo de todos os critérios.'
        : regra === 'qualquer'
          ? 'Pontuação: vale o melhor atingimento entre os critérios.'
          : 'Pontuação: média ponderada dos atingimentos (critério abaixo do mínimo conta zero).',
    );
  }
  secoes.push({ titulo: 'Critérios e metas', itens: crits });

  secoes.push({ titulo: 'Premiação', itens: frasesPremiacao(def, catalogo) });
  return secoes;
}

const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Medidas do critério-base do prêmio, para escrever "a cada 15 un" ou "a cada R$ 1.000". */
export function medidaBase(def, catalogo) {
  const base = def.criterios.find((c) => c.id === def.premiacao.criterio_base) || def.criterios[0];
  const info = base ? infoMetrica(base, catalogo) : { formato: 'numero', unidade: 'un', nome: 'vendas' };
  const qtd = (v) => (info.formato === 'moeda' ? fmtMoeda(v) : `${fmtNumero(v, v % 1 ? 1 : 0)}${info.unidade ? ` ${info.unidade}` : ''}`);
  const porUnidade = info.formato === 'moeda' ? 'real vendido' : info.unidade ? info.unidade.replace(/s$/, '') : 'unidade';
  return { base, info, nome: base?.nome || info.nome, qtd, porUnidade, semMeta: base?.meta?.tipo === 'sem_meta' };
}

/** Regras de prêmio em frases simples: regulamento e quadro "como vai funcionar" do editor. */
export function frasesPremiacao(def, catalogo) {
  const pr = def.premiacao;
  const quem = nivelSingular(def.participantes?.nivel);
  const { nome, qtd, porUnidade } = medidaBase(def, catalogo);
  const quemMeta = (min) => (min === 100 ? 'quem bater a meta' : `quem fizer ${fmtNumero(min)}% da meta ou mais`);
  const frases = [];
  if (pr.tipo === 'faixas') {
    const fx = [...pr.faixas].sort((a, b) => a.min - b.min);
    for (const f of fx) {
      const partes = [];
      if (f.fixo > 0) partes.push(fmtMoeda(f.fixo));
      if (f.variavel > 0) partes.push(`${fmtMoeda(f.variavel, { casas: 2 })} por ${porUnidade}${pr.variavel_sobre === 'excedente' ? ' acima da meta' : ''}`);
      frases.push(`${f.rotulo ? `${f.rotulo}: ` : ''}${f.rotulo ? quemMeta(f.min) : maiuscula(quemMeta(f.min))} ganha ${partes.join(' + ') || 'R$ 0,00'}.`);
    }
    if (fx.length > 1) frases.push('Vale só a maior faixa alcançada (as faixas não se somam).');
    if (fx.some((f) => f.variavel > 0)) frases.push(`O valor por ${porUnidade} é calculado sobre "${nome}".`);
  } else if (pr.tipo === 'ranking') {
    frases.push(pr.ranking.por === 'realizado' ? `O ranking ordena por quem mais vendeu em "${nome}".` : 'O ranking ordena pela pontuação (quanto da meta cada um fez).');
    frases.push(pr.ranking.minimo > 0 ? `Só concorre ao ranking ${quemMeta(pr.ranking.minimo)}.` : 'Concorrem todos que tiverem venda na campanha.');
    for (const p of pr.ranking.posicoes) frases.push(`${ROTULO_POS(p.de, p.ate)}: ${fmtMoeda(p.valor)}${p.ate > p.de ? ' para cada um' : ''}.`);
  } else if (pr.tipo === 'rateio') {
    const modo = pr.rateio.proporcional === 'igual' ? 'em partes iguais' : pr.rateio.proporcional === 'score' ? 'proporcional à pontuação de cada um' : `proporcional ao que cada um vendeu em "${nome}"`;
    frases.push(`${fmtMoeda(pr.rateio.valor_total)} divididos entre ${quemMeta(pr.rateio.minimo)}, ${modo}.`);
  } else if (pr.tipo === 'bloco') {
    const b = pr.bloco;
    frases.push(`A cada ${qtd(b.tamanho)}${b.sobre === 'excedente' ? ' acima da meta' : ''} em "${nome}", o ${quem} ganha ${fmtMoeda(b.valor)}.`);
    if (b.exigencia === 'quantidade' && b.minimo > 0) frases.push(`Para começar a ganhar é preciso chegar a ${qtd(b.minimo)} (a partir daí contam todos os blocos).`);
    if (b.exigencia === 'meta') frases.push(`Para começar a ganhar é preciso ${b.minimo === 100 ? 'bater a meta' : `fazer ${fmtNumero(b.minimo)}% da meta`}.`);
    if (b.max_blocos != null) frases.push(`Limite de ${fmtNumero(b.max_blocos)} blocos (${fmtMoeda(b.max_blocos * b.valor)}) por ${quem}.`);
    if (b.sobre === 'total' && b.tamanho > 0) {
      let ex = b.tamanho * 3 + Math.max(1, Math.round(b.tamanho * 0.4));
      if (b.exigencia === 'quantidade' && b.minimo > ex) ex = b.minimo + Math.max(1, Math.round(b.tamanho * 0.4));
      let n = Math.floor(ex / b.tamanho);
      if (b.max_blocos != null) n = Math.min(n, b.max_blocos);
      frases.push(`Exemplo: quem chegar a ${qtd(ex)} fecha ${fmtNumero(n)} ${n === 1 ? 'bloco' : 'blocos'} e ganha ${fmtMoeda(n * b.valor)}.`);
    }
  } else {
    frases.push('Campanha sem premiação em dinheiro (só acompanhamento e ranking).');
  }
  if (pr.bonus?.ativo && pr.bonus.valor > 0 && ['ranking', 'rateio', 'bloco'].includes(pr.tipo)) {
    frases.push(`Além disso, ${quemMeta(pr.bonus.min)} ganha ${fmtMoeda(pr.bonus.valor)}${pr.tipo === 'ranking' ? ', esteja ou não entre os premiados do ranking' : ''}.`);
  }
  for (const m of pr.multiplicadores) {
    const c = def.criterios.find((x) => x.id === m.criterio);
    const nomeC = c?.nome || (c ? infoMetrica(c, catalogo).nome : m.criterio);
    if (m.fator !== 1 && m.senao !== 1) frases.push(`Se "${nomeC}" atingir ${fmtNumero(m.min)}%, o prêmio é multiplicado por ${fmtValor(m.fator, 'decimal')}; senão, por ${fmtValor(m.senao, 'decimal')}.`);
    else if (m.fator !== 1) frases.push(`Acelerador: se "${nomeC}" atingir ${fmtNumero(m.min)}%, o prêmio é multiplicado por ${fmtValor(m.fator, 'decimal')}.`);
    else if (m.senao !== 1) frases.push(`Redutor: se "${nomeC}" não atingir ${fmtNumero(m.min)}%, o prêmio é multiplicado por ${fmtValor(m.senao, 'decimal')}.`);
  }
  if (pr.teto_participante != null) frases.push(`Ninguém recebe mais que ${fmtMoeda(pr.teto_participante)} (teto por ${quem}).`);
  if (pr.orcamento != null) frases.push(`Orçamento total da campanha: ${fmtMoeda(pr.orcamento)}.`);
  return frases;
}

export function regulamentoTexto(def, ctx) {
  return regulamento(def, ctx)
    .map((s) => `${s.titulo.toUpperCase()}\n${s.itens.map((i) => (/^\d+\./.test(i) ? i : `• ${i}`)).join('\n')}`)
    .join('\n\n');
}

/** Pendências que impedem ou desaconselham salvar. */
export function pendencias(def, catalogo) {
  const erros = [];
  const alertas = [];
  if (!def.nome.trim()) erros.push({ secao: 'identificacao', texto: 'Dê um nome para a campanha.' });
  if (!def.fabricante && !def.varios_fornecedores)
    erros.push({ secao: 'identificacao', texto: 'Escolha o fornecedor da campanha (ou marque que ela vale para vários fornecedores).' });
  if (!def.inicio || !def.fim || def.fim < def.inicio) erros.push({ secao: 'identificacao', texto: 'Período inválido: o fim precisa ser depois do início.' });
  def.criterios.forEach((cr, i) => {
    const rot = cr.nome || `Critério ${i + 1}`;
    if (cr.metrica === 'personalizada' && !cr.expressao.trim()) erros.push({ secao: 'criterios', texto: `${rot}: escreva a fórmula.` });
    if (cr.metrica === 'combo' && cr.combo.itens.length < 2) alertas.push({ secao: 'criterios', texto: `${rot}: venda casada normalmente tem 2 ou mais itens.` });
    if (cr.metrica !== 'combo' && cr.metrica !== 'personalizada' && seletorVazio(cr.produtos) && def.criterios.length > 1)
      alertas.push({ secao: 'criterios', texto: `${rot}: conta todos os produtos. Confira se é isso mesmo.` });
    if (cr.metrica === 'combo' && cr.combo.itens.length > 1) {
      const chaves = cr.combo.itens.map((it) => JSON.stringify(it.produtos));
      if (new Set(chaves).size < chaves.length) alertas.push({ secao: 'criterios', texto: `${rot}: dois itens do kit têm os mesmos produtos. Escolha a marca de cada item.` });
    }
    if (['fixa', 'distribuida'].includes(cr.meta.tipo) && !(cr.meta.valor > 0) && !Object.keys(cr.meta.valores).length)
      erros.push({ secao: 'criterios', texto: `${rot}: informe o valor da meta.` });
    if (cr.meta.tipo === 'sem_meta' && def.premiacao.tipo === 'faixas') alertas.push({ secao: 'premios', texto: `${rot}: sem meta não gera pontuação para faixas.` });
  });
  const pr = def.premiacao;
  if (pr.tipo === 'faixas' && !pr.faixas.length) erros.push({ secao: 'premios', texto: 'Inclua ao menos uma faixa de premiação.' });
  if (pr.tipo === 'ranking' && !pr.ranking.posicoes.length && !(pr.bonus?.ativo && pr.bonus.valor > 0))
    erros.push({ secao: 'premios', texto: 'Inclua ao menos uma posição premiada (ou um prêmio para quem bater a meta).' });
  if (pr.tipo === 'bloco' && !(pr.bloco.valor > 0)) erros.push({ secao: 'premios', texto: 'Informe quanto vale cada bloco de vendas.' });
  if (pr.tipo === 'bloco' && !(pr.bloco.tamanho > 0)) erros.push({ secao: 'premios', texto: 'Informe o tamanho do bloco (ex.: a cada 15 unidades).' });
  {
    const base = def.criterios.find((c) => c.id === pr.criterio_base) || def.criterios[0];
    const precisaMeta = (pr.tipo === 'bloco' && (pr.bloco.exigencia === 'meta' || pr.bloco.sobre === 'excedente'))
      || (pr.bonus?.ativo && ['ranking', 'rateio', 'bloco'].includes(pr.tipo))
      || (pr.tipo === 'ranking' && pr.ranking.minimo > 0) || pr.tipo === 'rateio';
    if (precisaMeta && base?.meta?.tipo === 'sem_meta' && def.criterios.every((c) => c.meta.tipo === 'sem_meta'))
      alertas.push({ secao: 'premios', texto: 'A premiação depende da meta, mas os critérios estão "sem meta". Defina uma meta ou ajuste o prêmio.' });
  }
  if (pr.tipo === 'rateio' && !(pr.rateio.valor_total > 0)) erros.push({ secao: 'premios', texto: 'Informe o valor da verba a ratear.' });
  if (pr.tipo === 'ranking' && pr.ranking.por === 'score' && def.criterios.every((c) => c.meta.tipo === 'sem_meta'))
    alertas.push({ secao: 'premios', texto: 'Ranking por pontuação precisa de meta; sem meta, use ranking por realizado.' });
  void catalogo;
  return { erros, alertas };
}
