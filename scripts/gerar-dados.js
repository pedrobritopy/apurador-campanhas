// =====================================================================
// Gerador de dados realistas para o DW de vendas (mesmas tabelas e regras do gerador original).
//
// Mantém as identidades do DW original:
//   preco_lista = cadastro (na data) · valor_unitario = preco_lista × (1 − desconto) · valor_total = qtd × valor_unitario
//   custo_unitario = custo de compra (na data) · margem = valor − custo · ICMS 12% · PIS 1,65% · COFINS 7,6%
//   um cliente/vendedor(carteira)/canal/NF/situação/data/CFOP por pedido · faturamento em 0–7 dias
//   estoque encadeado dia a dia: final = inicial − vendido(faturado) + entrada · custo_estoque = final × custo
// Acrescenta padrões que não existiam: sazonalidade por categoria, ciclo de vida de clientes (novos, pausas,
// perda, recuperação), fidelidade de marca e sortimento por cliente, compras casadas, desempenho e férias de
// vendedores, efeito de fim de mês, reajustes anuais de preço, canal preferido e adoção digital, CFOP coerente
// com a UF, ruptura real de estoque (venda perdida) e metas mensais calibradas pelo histórico.
//
// Uso: npm run gerar-dados -- [--inicio=2025-01-01] [--fim=AAAA-MM-DD] [--semente=2026]
// Os CSVs originais ficam guardados em dados/originais/ (fonte das dimensões).
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { DatabaseSync } from 'node:sqlite';
import { feriadosNacionais, addDias, intervalo, diaSemana, ultimoDiaMes } from '../server/calendario.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = path.join(RAIZ, 'dados');
const ORIG = path.join(PASTA, 'originais');
const BASE = path.join(PASTA, 'base');
const PRACAS = path.join(PASTA, 'pracas.json');

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=')[1] : padrao;
};
const hoje = new Date();
const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
const pad = (n) => String(n).padStart(2, '0');
const INICIO = arg('inicio', '2025-01-01');
const FIM = arg('fim', `${ontem.getFullYear()}-${pad(ontem.getMonth() + 1)}-${pad(ontem.getDate())}`);
const SEMENTE = Number(arg('semente', '2026'));
const UF_EMPRESA = arg('uf', 'GO');

// ------------------------------------------------------------------ aleatoriedade reproduzível
let estado = SEMENTE >>> 0;
const rand = () => {
  estado = (estado + 0x6d2b79f5) >>> 0;
  let t = estado;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a, b) => a + (b - a) * rand();
const inteiro = (a, b) => Math.floor(entre(a, b + 1));
const normal = (m = 0, s = 1) => {
  const u = Math.max(1e-12, rand());
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
const poisson = (l) => {
  if (l <= 0) return 0;
  const L = Math.exp(-l);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L && k < 20);
  return k - 1;
};
const sortear = (itens, pesos) => {
  let soma = 0;
  for (const p of pesos) soma += p;
  let r = rand() * soma;
  for (let i = 0; i < itens.length; i++) {
    r -= pesos[i];
    if (r <= 0) return itens[i];
  }
  return itens[itens.length - 1];
};
/** amostra ponderada com estrutura acumulada (rápida para listas grandes) */
function amostrador(itens, pesos) {
  const acum = new Float64Array(itens.length);
  let s = 0;
  pesos.forEach((p, i) => {
    s += Math.max(0, p);
    acum[i] = s;
  });
  return () => {
    const r = rand() * s;
    let lo = 0;
    let hi = acum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (acum[m] < r) lo = m + 1;
      else hi = m;
    }
    return itens[lo];
  };
}
const r2 = (x) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ leitura das dimensões originais
function garantirOriginais() {
  if (!fs.existsSync(ORIG)) fs.mkdirSync(ORIG, { recursive: true });
  const jaTem = fs.readdirSync(ORIG).some((f) => f.endsWith('.csv'));
  if (!jaTem) {
    for (const f of fs.readdirSync(PASTA).filter((x) => x.endsWith('.csv'))) fs.renameSync(path.join(PASTA, f), path.join(ORIG, f));
    console.log(`Originais guardados em ${path.relative(RAIZ, ORIG)}/`);
  }
}
/** Dimensão: dados/base/ (preparada por scripts/preparar-base.js e pelo catálogo real) ou o original. */
function ler(prefixo) {
  for (const pasta of [BASE, ORIG]) {
    if (!fs.existsSync(pasta)) continue;
    const arq = fs.readdirSync(pasta).find((f) => f.toLowerCase().startsWith(prefixo) && f.endsWith('.csv'));
    if (!arq) continue;
    const texto = fs.readFileSync(path.join(pasta, arq), 'utf8').replace(/^﻿/, '');
    return { linhas: parse(texto, { delimiter: ';', columns: true, skip_empty_lines: true }), cabecalho: texto.split(/\r?\n/)[0], arquivo: arq, pasta };
  }
  throw new Error(`Arquivo ${prefixo}*.csv não encontrado em ${BASE} nem em ${ORIG}`);
}
// aleatoriedade separada para quem tira o pedido (não altera a sequência principal)
let estadoV = (SEMENTE * 7 + 17) >>> 0;
const randV = () => {
  estadoV = (estadoV + 0x6d2b79f5) >>> 0;
  let t = estadoV;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ parâmetros de negócio
const SAZ_SUB = {
  'Gripe e Resfriado': [0.55, 0.6, 0.8, 1.05, 1.45, 1.85, 1.95, 1.6, 1.1, 0.85, 0.7, 0.6],
  'Vitaminas e Suplementos': [0.8, 0.8, 0.9, 1.1, 1.3, 1.4, 1.4, 1.3, 1.1, 1.0, 0.9, 0.9],
  'Antialérgicos': [0.8, 0.8, 0.9, 1.0, 1.0, 0.9, 0.9, 1.1, 1.5, 1.55, 1.3, 0.9],
  'Dermocosméticos': [1.35, 1.2, 1.0, 0.9, 0.8, 0.8, 0.8, 0.9, 1.0, 1.1, 1.3, 1.6],
  'Digestivos e Antiácidos': [1.3, 1.4, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.5],
  'Higiene Pessoal': [1.1, 1.0, 1.0, 1.0, 0.9, 0.9, 0.9, 1.0, 1.0, 1.0, 1.1, 1.3],
  'Equipamentos de Saúde': [0.9, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 1.4],
  'Primeiros Socorros': [1.15, 1.1, 1.0, 1.0, 0.9, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1],
};
const SAZ_MARCA = {
  Sundown: [2.0, 1.6, 1.0, 0.7, 0.5, 0.4, 0.4, 0.5, 0.8, 1.2, 1.6, 2.0],
  Engov: [1.4, 1.9, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.7],
  Epocler: [1.4, 1.8, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.6],
  Cebion: [0.6, 0.6, 0.8, 1.1, 1.5, 1.8, 1.8, 1.5, 1.1, 0.9, 0.7, 0.6],
  Redoxon: [0.6, 0.6, 0.8, 1.1, 1.5, 1.8, 1.8, 1.5, 1.1, 0.9, 0.7, 0.6],
};
// tendência anual (crescimento) por marca; o resto ~ N(5%, 7%)
const TENDENCIA = { CeraVe: 0.32, 'La Roche-Posay': 0.24, Vichy: 0.14, Bioderma: 0.18, Neutrogena: 0.08, Sundown: 0.1, 'Accu-Chek': 0.12, 'G-Tech': 0.1, Centrum: 0.09, Lavitan: 0.11, Benegrip: -0.06, Cotonetes: -0.07, 'Biotônico Fontoura': -0.14, Mucilon: -0.05, Sonrisal: -0.04 };
// afinidade de cada tipo de farmácia por subcategoria (multiplica a popularidade do produto)
const AFINIDADE = {
  'Manipulação': { Dermocosméticos: 1.8, 'Vitaminas e Suplementos': 1.6, Dermatológicos: 1.3, 'Gripe e Resfriado': 0.6, Infantil: 0.6, 'Equipamentos de Saúde': 0.5 },
  'Rede regional': { 'Higiene Pessoal': 1.3, 'Higiene Bucal': 1.3, Dermocosméticos: 1.3, 'Vitaminas e Suplementos': 1.2, Infantil: 1.2 },
  'Pequena rede': { 'Higiene Bucal': 1.1, Dermocosméticos: 1.1 },
  'Drogaria independente': { 'Analgésicos e Antitérmicos': 1.2, 'Gripe e Resfriado': 1.15, Dermocosméticos: 0.75 },
};
// compras de uma farmácia na distribuidora (ela compra de várias): pedidos por semana, linhas, quantidades
const PORTE = {
  Grande: { semana: 1.5, linhas: [6, 18], qtd: [3, 36], sortimento: [160, 420] },
  'Médio': { semana: 0.9, linhas: [4, 11], qtd: [2, 24], sortimento: [80, 220] },
  Pequeno: { semana: 0.48, linhas: [2, 7], qtd: [1, 12], sortimento: [40, 120] },
  Micro: { semana: 0.26, linhas: [1, 5], qtd: [1, 8], sortimento: [20, 60] },
};
const QTD_SEG = { 'Rede regional': 1.35, 'Pequena rede': 1.1, 'Manipulação': 0.7 };
// escala geral de volume (ajusta o total de linhas sem mexer nas proporções)
const ESCALA_VOLUME = Number(process.argv.find((x) => x.startsWith('--volume='))?.split('=')[1] ?? 1);
const CANAIS_PESO = { 1: 0.28, 2: 0.14, 3: 0.16, 4: 0.14, 5: 0.08, 6: 0.06, 7: 0.14 };
const DESCONTO_CANAL = { 1: [3, 7], 2: [2, 6], 3: [3, 7], 4: [5, 9], 5: [2, 5], 6: [0, 4], 7: [3, 6] };
const MEDICAMENTOS = new Set(['Analgésicos e Antitérmicos', 'Gripe e Resfriado', 'Digestivos e Antiácidos', 'Antialérgicos', 'Dermatológicos', 'Infantil']);
// reajustes (CMED para medicamentos em abril; demais em fevereiro)
const REAJUSTES = [
  { data: '2025-02-01', pct: 0.045, med: false },
  { data: '2025-04-01', pct: 0.0506, med: true },
  { data: '2026-02-01', pct: 0.04, med: false },
  { data: '2026-04-01', pct: 0.0381, med: true },
];
// compras casadas: se o pedido tem A, chance de incluir B (na época)
const CASADAS = [
  { a: 'Engov', b: 'Epocler', p: 0.55 },
  { a: 'Epocler', b: 'Engov', p: 0.35 },
  { a: 'Vick', b: 'Benegrip', p: 0.4, meses: [5, 6, 7, 8] },
  { a: 'Benegrip', b: 'Vick', p: 0.3, meses: [5, 6, 7, 8] },
  { a: 'Sensodyne', b: 'Oral-B', p: 0.25 },
  { a: 'Dorflex', b: 'Novalgina', p: 0.2 },
  { a: 'CeraVe', b: 'La Roche-Posay', p: 0.3 },
  { a: 'Tylenol', b: 'Band-Aid', p: 0.12 },
];
// campanhas históricas do fornecedor (efeito de demanda + desconto extra)
const PROMOS = [
  { marca: 'Centrum', inicio: '2025-05-01', fim: '2025-05-31', fator: 1.35, desc: 1.5 },
  { marca: 'Neosaldina', inicio: '2025-08-01', fim: '2025-08-31', fator: 1.3, desc: 1.5 },
  { marca: 'Sensodyne', inicio: '2025-10-01', fim: '2025-10-31', fator: 1.3, desc: 1.0 },
  { marca: 'Dorflex', inicio: '2026-03-01', fim: '2026-03-31', fator: 1.25, desc: 1.0 },
  { marca: 'Vick', inicio: '2026-05-01', fim: '2026-06-30', fator: 1.3, desc: 1.0 },
  { marca: 'Centrum', inicio: '2026-09-01', fim: '2026-09-30', fator: 1.3, desc: 1.5 },
];

// ------------------------------------------------------------------ demanda real (catálogo real e SNGPC)
const normTxt = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/s+/g, ' ').trim();
/** Peso de demanda, sazonalidade mensal e tipo de cada produto (dados/base/produto_demanda.csv), ou null. */
function carregarDemanda() {
  const arq = path.join(BASE, 'produto_demanda.csv');
  if (!fs.existsSync(arq)) return null;
  const linhas = parse(fs.readFileSync(arq, 'utf8'), { delimiter: ';', columns: true, skip_empty_lines: true });
  return new Map(linhas.map((l) => {
    const saz = Array.from({ length: 12 }, (_, i) => l[`saz_${i + 1}`]);
    return [Number(l.id_produto), { peso: Number(l.peso) || 1, med: l.medicamento === '1', saz: saz.every((x) => x !== '') ? saz.map(Number) : null }];
  }));
}
/**
 * Intensidade regional da demanda: participação real no SNGPC (UF e município) dividida pela participação
 * no número de farmácias da Receita. Farmácia de região que vende mais por loja compra mais da distribuidora.
 */
function carregarRegional() {
  const arqUf = path.join(PASTA, 'referencia', 'demanda_uf.csv');
  const arqMun = path.join(PASTA, 'referencia', 'demanda_municipio.csv');
  const arqDb = path.join(RAIZ, 'var', 'apurador.db');
  if (!fs.existsSync(arqUf) || !fs.existsSync(arqDb)) return () => 1;
  const db = new DatabaseSync(arqDb, { readOnly: true });
  const farmUf = new Map(db.prepare('SELECT uf, COUNT(*) AS n FROM rf_farmacia GROUP BY uf').all().map((r) => [r.uf, r.n]));
  const farmMun = new Map(db.prepare('SELECT uf, municipio, COUNT(*) AS n FROM rf_farmacia GROUP BY uf, municipio').all().map((r) => [`${r.uf}|${normTxt(r.municipio)}`, r.n]));
  db.close();
  const totFarm = [...farmUf.values()].reduce((a, b) => a + b, 0);
  const ler2 = (arq) => parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, ''), { delimiter: ';', columns: true, skip_empty_lines: true });
  const partUf = new Map(ler2(arqUf).map((r) => [r.uf, Number(r.participacao)]));
  const partMun = fs.existsSync(arqMun) ? new Map(ler2(arqMun).map((r) => [`${r.uf}|${normTxt(r.municipio)}`, Number(r.participacao)])) : new Map();
  const lim = (x, a, b) => Math.max(a, Math.min(b, x));
  return (uf, cidade) => {
    const pu = partUf.get(uf);
    const fu = farmUf.get(uf);
    let f = pu && fu ? lim(Math.sqrt(pu / (fu / totFarm)), 0.75, 1.35) : 1;
    const k = `${uf}|${normTxt(cidade)}`;
    const pm = partMun.get(k);
    const fm = farmMun.get(k);
    if (pm && fm && pu && fu) f *= lim(Math.sqrt((pm / pu) / (fm / fu)), 0.75, 1.35);
    return f;
  };
}

// ------------------------------------------------------------------ principal
function principal() {
  const t0 = Date.now();
  garantirOriginais();
  const prod = ler('dm_produto');
  const cli = ler('dm_cliente');
  const vend = ler('dm_vendedor');
  const canal = ler('dm_canal');
  const dias = intervalo(INICIO, FIM);
  const nDias = dias.length;
  const feriados = new Set([...new Set(dias.map((d) => d.slice(0, 4)))].flatMap((a) => feriadosNacionais(Number(a)).map((f) => f.data)));
  const anosSerie = nDias / 365;
  console.log(`Gerando ${INICIO} → ${FIM} (${nDias} dias, semente ${SEMENTE}) para ${cli.linhas.length} clientes e ${prod.linhas.length} produtos...`);

  // ---- produtos (popularidade e sazonalidade reais quando há catálogo real)
  const demanda = carregarDemanda();
  const regional = carregarRegional();
  const medianaPeso = demanda ? [...demanda.values()].map((d) => d.peso).sort((a, b) => a - b)[Math.floor(demanda.size / 2)] : 1;
  const produtos = prod.linhas.map((p) => {
    const dem = demanda?.get(Number(p.id_produto));
    const marca = p.marca || '';
    const sub = p.subcategoria || '';
    return {
      id: Number(p.id_produto),
      marca,
      sub,
      preco: Number(p.preco_lista),
      custo: Number(p.custo_compra),
      med: dem ? dem.med : MEDICAMENTOS.has(sub),
      pop: dem ? (dem.peso / medianaPeso) * Math.exp(normal(0, 0.25)) : Math.exp(normal(0, 0.85)),
      tend: TENDENCIA[marca] ?? normal(0.05, 0.07),
      saz: dem?.saz || SAZ_MARCA[marca] || SAZ_SUB[sub] || null,
    };
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const porMarca = new Map();
  for (const p of produtos) {
    if (!porMarca.has(p.marca)) porMarca.set(p.marca, []);
    porMarca.get(p.marca).push(p);
  }
  const fatorPreco = (p, d) => {
    let f = 1;
    for (const r of REAJUSTES) if (r.data > d && r.med === p.med) f *= 1 + r.pct;
    return f;
  };
  const mesIdx = (d) => Number(d.slice(5, 7)) - 1;
  const anosDesdeInicio = (i) => i / 365;
  const promoDe = (p, d) => PROMOS.find((x) => x.marca === p.marca && d >= x.inicio && d <= x.fim);
  const pesoProduto = (p, d, i) => {
    const s = p.saz ? p.saz[mesIdx(d)] : 1;
    const promo = promoDe(p, d);
    return p.pop * s * Math.exp(p.tend * (anosDesdeInicio(i) - anosSerie / 2)) * (promo ? promo.fator : 1);
  };

  // ---- vendedores
  const vendedores = new Map(
    vend.linhas.map((v) => {
      const inicioFerias = [];
      for (let a = Number(INICIO.slice(0, 4)); a <= Number(FIM.slice(0, 4)); a++) inicioFerias.push(`${a}-${pad(inteiro(1, 11))}-${pad(inteiro(1, 25))}`);
      return [Number(v.id_vendedor), { id: Number(v.id_vendedor), habilidade: Math.min(1.4, Math.max(0.65, normal(1, 0.16))), ferias: inicioFerias.map((d) => [d, addDias(d, 14)]) }];
    }),
  );

  // ---- praças: colegas de equipe (mesmo gerente e UF) cobrem férias e tiram alguns pedidos
  const pracas = fs.existsSync(PRACAS) ? JSON.parse(fs.readFileSync(PRACAS, 'utf8')) : null;
  const INVASAO = pracas?.invasao || { prob_base: 0, prob_ferias: 0 };
  const colegas = new Map();
  {
    const vs = vend.linhas.filter((v) => String(v.nivel).toLowerCase() === 'vendedor');
    for (const v of vs) {
      colegas.set(
        Number(v.id_vendedor),
        vs.filter((o) => o.id_vendedor !== v.id_vendedor && o.id_superior === v.id_superior && o.estado === v.estado).map((o) => Number(o.id_vendedor)),
      );
    }
  }
  const quemTira = (dono, emFerias) => {
    if (randV() >= (emFerias ? INVASAO.prob_ferias : INVASAO.prob_base)) return dono;
    const cs = colegas.get(dono);
    return cs?.length ? cs[Math.floor(randV() * cs.length)] : dono;
  };

  // ---- clientes (perfil, ciclo de vida, sortimento)
  const clientes = cli.linhas.map((c) => {
    const porte = PORTE[c.porte] ? c.porte : 'Pequeno';
    const seg = c.segmento;
    const afin = AFINIDADE[seg] || {};
    const pesoSort = produtos.map((p) => p.pop * (afin[p.sub] ?? 1));
    const tirar = amostrador(produtos, pesoSort);
    const nSort = inteiro(...PORTE[porte].sortimento);
    const sortimento = new Set();
    for (let k = 0; sortimento.size < nSort && k < nSort * 6; k++) sortimento.add(tirar().id);
    const cadastro = c.data_cadastro || INICIO;
    const comeca = cadastro > INICIO ? addDias(cadastro, inteiro(0, 20)) : INICIO;
    const ativoOriginal = /^(true|1)$/i.test(c.ativo);
    // ciclo de vida
    let perda = null;
    const pausas = [];
    const r = rand();
    if (!ativoOriginal) perda = addDias(FIM, -inteiro(60, 330));
    else if (r < 0.06) perda = addDias(comeca, inteiro(120, Math.max(121, intervalo(comeca, FIM).length - 45)));
    if (rand() < 0.16) {
      const nP = rand() < 0.3 ? 2 : 1;
      for (let k = 0; k < nP; k++) {
        const ini = addDias(comeca, inteiro(30, Math.max(31, intervalo(comeca, FIM).length - 40)));
        pausas.push([ini, addDias(ini, inteiro(30, 100))]);
      }
    }
    const perfilTend = rand();
    const tendencia = perfilTend < 0.1 ? -0.35 : perfilTend > 0.9 ? 0.35 : normal(0, 0.08);
    const canalPrincipal = Number(sortear(Object.keys(CANAIS_PESO), Object.values(CANAIS_PESO)));
    return {
      id: Number(c.id_cliente),
      vendedor: Number(c.id_vendedor),
      regional: regional(c.estado, c.cidade),
      estado: c.estado,
      seg,
      porte,
      afin,
      sortimento,
      comeca,
      perda,
      pausas,
      tendencia,
      canalPrincipal,
      digital: ['Varejo', 'Supermercado', 'Atacado', 'Distribuidora'].includes(seg) && rand() < 0.5,
      original: c,
    };
  });

  // ---- passada 1: pedidos (sem restrição de estoque)
  const pedidos = [];
  const fatorDiaSemana = [0.06, 1.18, 1.05, 1.0, 1.0, 0.92, 0.32];
  const uteisDoMes = new Map();
  for (const d of dias) {
    const k = d.slice(0, 7);
    if (!uteisDoMes.has(k)) uteisDoMes.set(k, []);
    const ds = diaSemana(d);
    if (ds !== 0 && ds !== 6 && !feriados.has(d)) uteisDoMes.get(k).push(d);
  }
  const macroMes = [1.0, 0.93, 1.0, 0.98, 1.0, 1.0, 1.02, 1.0, 1.0, 1.01, 1.03, 1.08];
  const todosPeso = (d, i, afin) => produtos.map((p) => pesoProduto(p, d, i) * (afin[p.sub] ?? 1));
  let cacheExplora = { mes: null, por: new Map() };

  for (let i = 0; i < nDias; i++) {
    const d = dias[i];
    const ds = diaSemana(d);
    const mes = d.slice(0, 7);
    const uteis = uteisDoMes.get(mes);
    const posUtil = uteis.indexOf(d);
    let fDia = fatorDiaSemana[ds] * (feriados.has(d) ? 0.05 : 1) * macroMes[mesIdx(d)];
    if (posUtil >= 0 && posUtil >= uteis.length - 4) fDia *= 1.22; // empurrão de fim de mês
    if (posUtil >= 0 && posUtil < 2) fDia *= 0.88;
    const crescimento = Math.exp(0.07 * (anosDesdeInicio(i) - anosSerie));
    if (cacheExplora.mes !== mes) cacheExplora = { mes, por: new Map() };

    for (const c of clientes) {
      if (d < c.comeca || (c.perda && d >= c.perda)) continue;
      if (c.pausas.some(([a, b]) => d >= a && d <= b)) continue;
      const v = vendedores.get(c.vendedor);
      const ferias = v?.ferias.some(([a, b]) => d >= a && d <= b) ? 0.45 : 1;
      const anosCli = (Date.parse(d) - Date.parse(c.comeca) + 86400000) / 86400000 / 365;
      const lambda = ESCALA_VOLUME * c.regional * (PORTE[c.porte].semana / 5) * fDia * (v?.habilidade ?? 1) * ferias * Math.exp(c.tendencia * anosCli) * crescimento;
      const n = Math.min(2, poisson(lambda));
      for (let k = 0; k < n; k++) {
        // canal
        let canalPed = rand() < 0.7 ? c.canalPrincipal : Number(sortear(Object.keys(CANAIS_PESO), Object.values(CANAIS_PESO)));
        if (c.digital && d >= '2026-01-01' && rand() < 0.25) canalPed = 5; // adoção do app
        // itens
        const [lmin, lmax] = PORTE[c.porte].linhas;
        const nLinhas = inteiro(lmin, lmax);
        const sortArr = [...c.sortimento];
        const pesoSort = sortArr.map((id) => pesoProduto(porId.get(id), d, i));
        const daSort = amostrador(sortArr, pesoSort);
        let explorar = cacheExplora.por.get(c.seg);
        if (!explorar) {
          explorar = amostrador(produtos.map((p) => p.id), todosPeso(d, i, c.afin));
          cacheExplora.por.set(c.seg, explorar);
        }
        const escolhidos = new Set();
        for (let t = 0; escolhidos.size < nLinhas && t < nLinhas * 4; t++) {
          const id = rand() < 0.84 ? daSort() : explorar();
          escolhidos.add(id);
          if (rand() < 0.03 && !c.sortimento.has(id)) c.sortimento.add(id); // adotou um SKU novo
        }
        // compras casadas
        const marcasNoPedido = new Set([...escolhidos].map((id) => porId.get(id).marca));
        for (const cs of CASADAS) {
          if (escolhidos.size >= 12) break;
          if (cs.meses && !cs.meses.includes(mesIdx(d) + 1)) continue;
          if (marcasNoPedido.has(cs.a) && !marcasNoPedido.has(cs.b) && rand() < cs.p) {
            const opcoes = porMarca.get(cs.b);
            if (opcoes?.length) {
              escolhidos.add(opcoes[inteiro(0, opcoes.length - 1)].id);
              marcasNoPedido.add(cs.b);
            }
          }
        }
        // situação, CFOP, prazo
        const temEquip = [...escolhidos].some((id) => porId.get(id).sub === 'Equipamentos de Saúde');
        const pCanc = canalPed === 6 ? 0.07 : canalPed === 7 ? 0.04 : 0.03;
        const pDev = 0.022 + (temEquip ? 0.02 : 0);
        const rs = rand();
        const status = rs < pCanc ? 'Cancelado' : rs < pCanc + pDev ? 'Devolvido' : 'Faturado';
        const dentro = c.estado === UF_EMPRESA;
        let cfop;
        if (rand() < 0.03) cfop = dentro ? '5.910' : '6.910';
        else if (dentro) cfop = sortear(['5.102', '5.405', '5.101'], [0.72, 0.2, 0.08]);
              else cfop = sortear(['6.102', '6.101', '6.108'], [0.75, 0.1, 0.15]);
        let prazo = Number(sortear(['0', '1', '2', '3', '4', '5', '6', '7'], [0.12, 0.48, 0.22, 0.09, 0.04, 0.025, 0.015, 0.01]));
        let fat = addDias(d, prazo);
        if (diaSemana(fat) === 0) fat = addDias(fat, 1);
        const [qmin, qmax] = PORTE[c.porte].qtd;
        const itens = [...escolhidos].map((id) => {
          const p = porId.get(id);
          const s = p.saz ? p.saz[mesIdx(d)] : 1;
          // produto caro sai em quantidade menor (farmácia compra 1 ou 2 caixas de remédio de alto valor)
          let q = Math.round((qmin + (qmax - qmin) * rand() ** 1.6) * (QTD_SEG[c.seg] ?? 1) * Math.sqrt(s) * Math.min(1, Math.sqrt(40 / Math.max(1, p.preco))));
          q = Math.max(1, Math.min(50, q));
          const [dmin, dmax] = DESCONTO_CANAL[canalPed];
          const promo = promoDe(p, d);
          let desc = entre(dmin, dmax) + (c.porte === 'Grande' ? 1.5 : c.porte === 'Médio' ? 0.7 : 0) + (q >= 40 ? 0.8 : 0) + (promo ? promo.desc : 0);
          desc = r2(Math.max(0, Math.min(10, desc)));
          return { id, q, desc };
        });
        pedidos.push({ dia: d, ordem: rand(), cliente: c.id, vendedor: quemTira(c.vendedor, ferias < 1), canal: canalPed, status, cfop, fat, itens });
      }
    }
    if (i % 60 === 0) process.stdout.write(`\r  pedidos: ${d} · ${pedidos.length.toLocaleString('pt-BR')}   `);
  }
  pedidos.sort((a, b) => a.dia.localeCompare(b.dia) || a.ordem - b.ordem);
  console.log(`\r  pedidos gerados: ${pedidos.length.toLocaleString('pt-BR')}                    `);

  // ---- passada 2: estoque dia a dia (venda limitada pelo estoque = ruptura real)
  const demandaMedia = new Map();
  for (const p of pedidos) if (p.status === 'Faturado') for (const it of p.itens) demandaMedia.set(it.id, (demandaMedia.get(it.id) || 0) + it.q);
  const est = new Map();
  for (const p of produtos) {
    const media = (demandaMedia.get(p.id) || 0) / nDias;
    est.set(p.id, {
      media,
      minimo: Math.max(5, Math.round(media * entre(4, 7))),
      saldo: Math.round(media * entre(15, 30)) + 10,
      pendente: null, // { dia, qtd }
    });
  }
  const porDia = new Map();
  for (const p of pedidos) {
    if (!porDia.has(p.dia)) porDia.set(p.dia, []);
    porDia.get(p.dia).push(p);
  }
  const fmt2 = (x) => r2(x).toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1');
  const escritor = (arq, cab) => {
    const fd = fs.openSync(path.join(PASTA, arq), 'w');
    fs.writeSync(fd, `${cab}\n`);
    let buf = [];
    let n = 0;
    return {
      linha(l) {
        buf.push(l.join(';'));
        n++;
        if (buf.length >= 20000) {
          fs.writeSync(fd, `${buf.join('\n')}\n`);
          buf = [];
        }
      },
      fechar() {
        if (buf.length) fs.writeSync(fd, `${buf.join('\n')}\n`);
        fs.closeSync(fd);
        return n;
      },
    };
  };
  const wEst = escritor('fato_estoque.csv', 'id_estoque;id_empresa;id_produto;data;estoque_inicial;quantidade_vendida;quantidade_entrada;estoque_final;estoque_minimo;custo_estoque');
  let idEst = 0;
  let perdidas = 0;
  let unidadesPerdidas = 0;
  for (const d of dias) {
    const ent = new Map();
    for (const [id, e] of est) {
      if (e.pendente && e.pendente.dia === d) {
        ent.set(id, e.pendente.qtd);
        e.pendente = null;
      }
    }
    const inicioDia = new Map([...est].map(([id, e]) => [id, e.saldo]));
    for (const [id, q] of ent) est.get(id).saldo += q;
    const vendido = new Map();
    for (const ped of porDia.get(d) || []) {
      if (ped.status !== 'Faturado') continue;
      for (const it of ped.itens) {
        const e = est.get(it.id);
        if (e.saldo <= 0) {
          perdidas++;
          unidadesPerdidas += it.q;
          it.q = 0;
          continue;
        }
        if (it.q > e.saldo) {
          unidadesPerdidas += it.q - e.saldo;
          it.q = e.saldo;
        }
        e.saldo -= it.q;
        vendido.set(it.id, (vendido.get(it.id) || 0) + it.q);
      }
      ped.itens = ped.itens.filter((it) => it.q > 0);
    }
    for (const [id, e] of est) {
      const v = vendido.get(id) || 0;
      const entrada = ent.get(id) || 0;
      const p = porId.get(id);
      wEst.linha([++idEst, 1, id, d, inicioDia.get(id), v, entrada, e.saldo, e.minimo, fmt2(e.saldo * r2(p.custo / fatorPreco(p, d)))]);
      if (e.saldo <= e.minimo && !e.pendente) {
        // pedido de compra ao fornecedor: chega em 2–6 dias (às vezes atrasa)
        const atraso = rand() < 0.04 ? inteiro(7, 15) : 0;
        e.pendente = { dia: addDias(d, inteiro(2, 6) + atraso), qtd: Math.max(12, Math.round((e.media * entre(18, 32)) / 12) * 12) };
      }
    }
  }
  const validos = pedidos.filter((p) => p.itens.length);
  console.log(`  ruptura: ${perdidas.toLocaleString('pt-BR')} itens não atendidos (${unidadesPerdidas.toLocaleString('pt-BR')} un) · pedidos válidos: ${validos.length.toLocaleString('pt-BR')}`);

  // ---- escrita dos fatos
  const csv = (arq, cab, linhas) => {
    const fd = fs.openSync(path.join(PASTA, arq), 'w');
    fs.writeSync(fd, `${cab}\n`);
    let buf = [];
    for (const l of linhas) {
      buf.push(l.join(';'));
      if (buf.length >= 20000) {
        fs.writeSync(fd, `${buf.join('\n')}\n`);
        buf = [];
      }
    }
    if (buf.length) fs.writeSync(fd, `${buf.join('\n')}\n`);
    fs.closeSync(fd);
  };
  console.log(`  fato_estoque: ${wEst.fechar().toLocaleString('pt-BR')} linhas`);

  let idFato = 0;
  const wVenda = escritor('fato_vendas.csv', 'id_fato;id_empresa;id_pedido;data_pedido;data_faturamento;id_produto;id_cliente;id_vendedor;quantidade;preco_lista;desconto_perc;valor_unitario;valor_total;custo_unitario;custo_total;margem_bruta;valor_icms;valor_pis;valor_cofins;valor_impostos_total;id_canal;cfop;numero_nf;status');
  const porMes = new Map();
  const realizadoMes = new Map(); // vendedor|AAAA-MM -> {valor, qtd}
  validos.forEach((ped, k) => {
    const idPed = `PED-${String(1001 + k).padStart(6, '0')}`;
    const nf = `NF-${String(5001 + k).padStart(7, '0')}`;
    for (const it of ped.itens) {
      const p = porId.get(it.id);
      const f = fatorPreco(p, ped.dia);
      const preco = r2(p.preco / f);
      const custo = r2(p.custo / f);
      const unit = r2(preco * (1 - it.desc / 100));
      const total = r2(unit * it.q);
      const custoTot = r2(custo * it.q);
      const icms = r2(total * 0.12);
      const pis = r2(total * 0.0165);
      const cofins = r2(total * 0.076);
      idFato++;
      wVenda.linha([idFato, 1, idPed, ped.dia, ped.fat, it.id, ped.cliente, ped.vendedor, it.q, fmt2(preco), fmt2(it.desc), fmt2(unit), fmt2(total), fmt2(custo), fmt2(custoTot), fmt2(total - custoTot), fmt2(icms), fmt2(pis), fmt2(cofins), fmt2(icms + pis + cofins), ped.canal, ped.cfop, nf, ped.status]);
      const pm = porMes.get(ped.dia.slice(0, 7)) || { linhas: 0, valor: 0 };
      pm.linhas++;
      pm.valor += total;
      porMes.set(ped.dia.slice(0, 7), pm);
      if (ped.status === 'Faturado') {
        const kk = `${ped.vendedor}|${ped.dia.slice(0, 7)}`;
        const r = realizadoMes.get(kk) || { valor: 0, qtd: 0 };
        r.valor += total;
        r.qtd += it.q;
        realizadoMes.set(kk, r);
      }
    }
  });
  console.log(`  fato_vendas: ${wVenda.fechar().toLocaleString('pt-BR')} linhas`);



  // ---- metas mensais (calibradas pelo histórico: mesmo mês do ano anterior ou média de 3 meses, + crescimento)
  const meses = [];
  for (let c = `${INICIO.slice(0, 7)}-01`; c <= FIM; c = addDias(ultimoDiaMes(Number(c.slice(0, 4)), Number(c.slice(5, 7))), 1)) meses.push(c.slice(0, 7));
  const proximo = addDias(ultimoDiaMes(Number(FIM.slice(0, 4)), Number(FIM.slice(5, 7))), 1).slice(0, 7);
  meses.push(proximo);
  const filhos = new Map();
  for (const v of vend.linhas) if (v.id_superior) {
    const g = Number(v.id_superior);
    if (!filhos.has(g)) filhos.set(g, []);
    filhos.get(g).push(Number(v.id_vendedor));
  }
  // equipes: todos os vendedores abaixo do gestor, em qualquer nível
  const equipes = new Map();
  const folhas = (id) => (filhos.has(id) ? filhos.get(id).flatMap(folhas) : [id]);
  for (const g of filhos.keys()) equipes.set(g, folhas(g));
  const mesAnterior = (m, n) => {
    const [a, mm] = m.split('-').map(Number);
    const dt = new Date(Date.UTC(a, mm - 1 - n, 1));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
  };
  const metaDe = (idV, m) => {
    const real = (mm) => realizadoMes.get(`${idV}|${mm}`);
    const anoPassado = real(mesAnterior(m, 12));
    const ultimos = [1, 2, 3].map((n) => real(mesAnterior(m, n))).filter(Boolean);
    const cresc = 1 + entre(0.04, 0.12);
    if (anoPassado && anoPassado.valor > 0) return { valor: anoPassado.valor * cresc * 1.07, qtd: anoPassado.qtd * cresc * 1.05 };
    if (ultimos.length) {
      const mv = ultimos.reduce((a, r) => a + r.valor, 0) / ultimos.length;
      const mq = ultimos.reduce((a, r) => a + r.qtd, 0) / ultimos.length;
      return { valor: mv * cresc * (macroMes[Number(m.slice(5, 7)) - 1] || 1), qtd: mq * cresc };
    }
    return null;
  };
  let idMeta = 0;
  const linhasMeta = [];
  for (const v of vend.linhas) {
    const idV = Number(v.id_vendedor);
    for (const m of meses) {
      const [ano, mes] = m.split('-').map(Number);
      let meta;
      let real;
      if (equipes.has(idV)) {
        const ms = equipes.get(idV).map((x) => metaDe(x, m)).filter(Boolean);
        meta = ms.length ? { valor: ms.reduce((a, b) => a + b.valor, 0), qtd: ms.reduce((a, b) => a + b.qtd, 0) } : null;
        real = equipes.get(idV).reduce((a, x) => {
          const r = realizadoMes.get(`${x}|${m}`);
          return { valor: a.valor + (r?.valor || 0), qtd: a.qtd + (r?.qtd || 0) };
        }, { valor: 0, qtd: 0 });
      } else {
        meta = metaDe(idV, m);
        real = realizadoMes.get(`${idV}|${m}`) || { valor: 0, qtd: 0 };
      }
      if (!meta) continue; // primeiro mês da série: sem histórico para meta
      idMeta++;
      const mv = r2(meta.valor);
      const mq = Math.max(1, Math.round(meta.qtd));
      linhasMeta.push([idMeta, 1, idV, ano, mes, fmt2(mv), mq, fmt2(real.valor), Math.round(real.qtd), fmt2(mv > 0 ? (real.valor / mv) * 100 : 0)]);
    }
  }
  csv('fato_metas.csv', 'id_meta;id_empresa;id_vendedor;ano;mes;meta_valor;meta_quantidade;realizado_valor;realizado_quantidade;atingimento_perc', linhasMeta);
  console.log(`  fato_metas: ${linhasMeta.length.toLocaleString('pt-BR')} linhas`);

  // ---- dimensões
  const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const NOMES_DIA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const semanaIso = (d) => {
    const dt = new Date(`${d}T00:00:00Z`);
    const dia = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dia + 3);
    const primeiro = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((dt - primeiro) / 86400000 - 3 + ((primeiro.getUTCDay() + 6) % 7)) / 7);
  };
  const diasTempo = intervalo(INICIO, addDias(FIM, 10));
  const feriadosTempo = new Set([...new Set(diasTempo.map((d) => d.slice(0, 4)))].flatMap((a) => feriadosNacionais(Number(a)).map((f) => f.data)));
  csv(
    'dm_tempo.csv',
    'data;ano;mes;nome_mes;trimestre;semestre;dia_semana;nome_dia_semana;semana_ano;is_fim_semana;is_feriado',
    diasTempo.map((d) => {
      const m = Number(d.slice(5, 7));
      const ds = diaSemana(d);
      return [d, d.slice(0, 4), m, NOMES_MES[m - 1], Math.ceil(m / 3), m <= 6 ? 1 : 2, ds, NOMES_DIA[ds], semanaIso(d), ds === 0 || ds === 6 ? 'True' : 'False', feriadosTempo.has(d) ? 'True' : 'False'];
    }),
  );

  // clientes: só o "ativo" muda (coerente com o ciclo de vida); demais colunas idênticas ao original
  const ultimaCompra = new Map();
  for (const p of validos) if (p.status === 'Faturado') ultimaCompra.set(p.cliente, p.dia > (ultimaCompra.get(p.cliente) || '') ? p.dia : ultimaCompra.get(p.cliente));
  const colsCli = cli.cabecalho.split(';');
  const corte = addDias(FIM, -120);
  csv(
    'dm_cliente.csv',
    cli.cabecalho,
    clientes.map((c) => colsCli.map((col) => (col === 'ativo' ? ((ultimaCompra.get(c.id) || '') >= corte ? 'True' : 'False') : c.original[col] ?? ''))),
  );
  for (const [dim, nome] of [[prod, 'dm_produto.csv'], [vend, 'dm_vendedor.csv'], [canal, 'dm_canal.csv']]) {
    fs.copyFileSync(path.join(dim.pasta, dim.arquivo), path.join(PASTA, nome));
  }
  void canal;

  // ---- resumo
  console.log('\n  mês      linhas    faturamento');
  for (const [m, r] of porMes) console.log(`  ${m}  ${String(r.linhas).padStart(7)}  R$ ${Math.round(r.valor).toLocaleString('pt-BR').padStart(12)}`);
  const perdidos = clientes.filter((c) => c.perda && c.perda <= FIM).length;
  console.log(`\n  clientes: ${clientes.length} · perdidos ${perdidos} · com pausas ${clientes.filter((c) => c.pausas.length).length} · novos no período ${clientes.filter((c) => c.comeca > INICIO).length}`);
  console.log(`Concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s. Rode "npm run importar" (ou o botão Reimportar na tela Dados).`);
}

principal();
