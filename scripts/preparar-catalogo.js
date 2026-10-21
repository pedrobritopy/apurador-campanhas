// =====================================================================
// Catálogo real para o gerador: dados/base/dm_produto.csv + dados/base/produto_demanda.csv
//
// - Base: dados/referencia/produtos_reais.csv (CMED/ANVISA com EAN, PF e PMC reais + não-medicamentos de marcas reais).
// - Ids 1..999 do catálogo atual ficam estáveis: o original de cada produto vira o equivalente real (mesma marca e
//   apresentação mais parecida); as cópias com sufixo " 2" a " 8" viram outras apresentações reais da mesma marca
//   (ou do mesmo fabricante e subcategoria). Os demais itens reais entram com ids a partir de 1000.
// - Preço: preço de lista para a farmácia = preço fábrica (PF) real; custo da distribuidora = PF com 12% a 22% de desconto.
// - Demanda (popularidade no gerador): venda real do SNGPC pesa como é; o valor estimado é comprimido para a escala real
//   (sem vitaminas e suplementos estimados fora de ordem no topo). Sazonalidade: índice mensal real por EAN.
//
// Uso: node scripts/preparar-catalogo.js
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join(RAIZ, 'dados', 'referencia');
const ORIG = path.join(RAIZ, 'dados', 'originais');
const BASE = path.join(RAIZ, 'dados', 'base');

const ler = (arq, sep = ';') => parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, ''), { delimiter: sep, columns: true, skip_empty_lines: true, relax_column_count: true });
const num = (s) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t.length > 1));
const parecido = (a, b) => {
  const A = tokens(a);
  const B = tokens(b);
  let i = 0;
  for (const t of A) if (B.has(t)) i++;
  const numA = [...A].filter((t) => /\d/.test(t));
  const bonus = numA.filter((t) => B.has(t)).length * 0.5;
  return i / Math.max(1, Math.min(A.size, B.size)) + bonus;
};
const hash01 = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h / 4294967295;
};
const r2 = (x) => Math.round(x * 100) / 100;
const PF_MAXIMO = 1500;

function principal() {
  // fora: medicamentos de alto custo (oncologia, imunobiológicos...), que a farmácia não compra de distribuidor de varejo
  const reais = ler(path.join(REF, 'produtos_reais.csv'))
    .filter((p) => num(p.preco_fabrica) > 0 && num(p.preco_fabrica) <= PF_MAXIMO)
    .map((p, i) => ({ ...p, idx: i, chaveMarca: norm(p.marca), chaveFab: norm(p.fabricante) }));
  const demanda = new Map(ler(path.join(REF, 'demanda_real.csv')).map((d) => [d.ean, d]));
  const arqOrig = fs.readdirSync(ORIG).find((f) => f.toLowerCase().startsWith('dm_produto'));
  const textoOrig = fs.readFileSync(path.join(ORIG, arqOrig), 'utf8').replace(/^﻿/, '');
  const cabecalho = textoOrig.split(/\r?\n/)[0];
  const atuais = parse(textoOrig, { delimiter: ';', columns: true, skip_empty_lines: true });

  // ---------------- mapeamento dos ids atuais
  const usados = new Set();
  const porMarca = new Map();
  for (const r of reais) {
    if (!porMarca.has(r.chaveMarca)) porMarca.set(r.chaveMarca, []);
    porMarca.get(r.chaveMarca).push(r);
  }
  const marcaReal = (marca) => {
    const k = norm(marca);
    if (porMarca.has(k)) return porMarca.get(k);
    // "Tylenol" casa com "Tylenol Sinus", "Redoxon" com "Redoxon Tripla Ação"...
    return reais.filter((r) => r.chaveMarca === k || r.chaveMarca.startsWith(`${k} `));
  };
  const escolher = (cands, nome) => cands.filter((r) => !usados.has(r.idx)).map((r) => ({ r, s: parecido(nome, r.nome_produto) })).sort((a, b) => b.s - a.s || a.r.idx - b.r.idx)[0]?.r || null;
  const ordem = [...atuais].sort((a, b) => Number(/ [2-8]$/.test(a.nome_produto)) - Number(/ [2-8]$/.test(b.nome_produto)) || Number(a.id_produto) - Number(b.id_produto));
  const mapa = new Map();
  const relatorio = { mesma_marca: 0, mesmo_fabricante: 0, mesma_subcategoria: 0, mantido: 0 };
  for (const p of ordem) {
    const nome = p.nome_produto.replace(/ [2-8]$/, '');
    let r = escolher(marcaReal(p.marca), nome);
    if (r) relatorio.mesma_marca++;
    if (!r) {
      r = escolher(reais.filter((x) => x.chaveFab === norm(p.fabricante) && x.subcategoria === p.subcategoria), nome);
      if (r) relatorio.mesmo_fabricante++;
    }
    if (!r) {
      r = escolher(reais.filter((x) => x.subcategoria === p.subcategoria && x.tipo === 'nao_medicamento'), nome) || escolher(reais.filter((x) => x.subcategoria === p.subcategoria), nome);
      if (r) relatorio.mesma_subcategoria++;
    }
    if (r) {
      usados.add(r.idx);
      mapa.set(Number(p.id_produto), r);
    } else relatorio.mantido++;
  }

  // ---------------- pesos de demanda
  const ESC_REAL_P90 = 49035;
  const pesoDe = (r) => {
    const d = Number(r.demanda_mes_brasil) || 0;
    if (r.fonte_demanda === 'SNGPC/ANVISA') return d;
    let w = ESC_REAL_P90 * Math.pow(Math.max(d, 1000) / 300000, 0.4);
    if (r.subcategoria === 'Vitaminas e Suplementos') w *= 0.55;
    // remédio caro gira menos (estimativa sem dado real)
    const pf = num(r.preco_fabrica);
    if (pf > 150) w *= Math.pow(150 / pf, 0.6);
    return Math.min(w, 200000);
  };
  const SAZ_SUGERIDA = {
    inverno: [0.7, 0.75, 0.9, 1.05, 1.3, 1.45, 1.45, 1.25, 1.0, 0.85, 0.75, 0.7],
    verao: [1.4, 1.3, 1.1, 0.9, 0.8, 0.75, 0.75, 0.8, 0.95, 1.1, 1.25, 1.45],
    primavera: [0.85, 0.85, 0.9, 0.95, 1.0, 0.95, 0.95, 1.1, 1.3, 1.3, 1.1, 0.95],
  };
  const sazDe = (r) => {
    const d = r.ean ? demanda.get(r.ean) : null;
    if (d) return Array.from({ length: 12 }, (_, i) => Number(d[`indice_mes_${i + 1}`]) || 1);
    return SAZ_SUGERIDA[norm(r.sazonalidade_sugerida)] || null;
  };

  // ---------------- saída
  const linhas = [];
  const dem = [];
  const add = (id, r, orig) => {
    const pf = r ? num(r.preco_fabrica) : Number(orig.preco_lista);
    const custo = r ? r2(pf * (0.78 + 0.1 * hash01(`c${id}`))) : Number(orig.custo_compra);
    const ean = r ? (r.ean || `2${String(id).padStart(11, '0')}`) : orig.ean;
    linhas.push([
      id, 1, r ? r.nome_produto : orig.nome_produto, r ? r.fabricante : orig.fabricante, r ? r.marca : orig.marca, r ? r.categoria : orig.categoria, r ? r.subcategoria : orig.subcategoria,
      ean, r2(pf).toFixed(2), custo.toFixed(2), r ? (r.tipo === 'generico' ? 10 : 15) : orig.margem_minima, 'True', `produto_${id}.jpg`,
    ]);
    const saz = r ? sazDe(r) : null;
    dem.push([id, Math.round(r ? pesoDe(r) : 20000), r ? r.fonte_demanda : 'estimado', r ? (r.tipo === 'nao_medicamento' ? 0 : 1) : 0, r?.curva_sugerida || '', r?.tipo || 'nao_medicamento', ...(saz || Array(12).fill('')).map((x) => (x === '' ? '' : Number(x).toFixed(3)))]);
  };
  for (const p of atuais.sort((a, b) => Number(a.id_produto) - Number(b.id_produto))) add(Number(p.id_produto), mapa.get(Number(p.id_produto)) || null, p);
  let prox = Math.max(1000, ...atuais.map((p) => Number(p.id_produto) + 1));
  for (const r of reais) if (!usados.has(r.idx)) add(prox++, r, null);

  fs.mkdirSync(BASE, { recursive: true });
  const csv = (arq, cab, ls) => fs.writeFileSync(path.join(BASE, arq), `${cab}\n${ls.map((l) => l.map((v) => String(v ?? '').replace(/;/g, ',')).join(';')).join('\n')}\n`);
  csv('dm_produto.csv', cabecalho, linhas);
  csv('produto_demanda.csv', `id_produto;peso;fonte;medicamento;curva;tipo;${Array.from({ length: 12 }, (_, i) => `saz_${i + 1}`).join(';')}`, dem);
  const top = dem.map((d, i) => ({ d, l: linhas[i] })).sort((a, b) => b.d[1] - a.d[1]).slice(0, 15);
  console.log(`catálogo: ${linhas.length} produtos (ids 1..${prox - 1}) · mapeamento dos atuais:`, relatorio);
  console.log('maiores pesos:\n' + top.map((t) => `  ${String(t.d[1]).padStart(7)} ${t.d[2].slice(0, 5)} ${t.l[4]} (${t.l[6]})`).join('\n'));
}

principal();
