import { db, agoraISO, transacao } from './db.js';
import { addDias, diasEntre } from './calendario.js';

// Perfil calculado de cada cliente (RFV, curva ABC, potencial) e relações entre marcas.
// Tudo determinístico, recalculado quando os dados de venda mudam. Referência = última data de venda.

db.exec(`
CREATE TABLE IF NOT EXISTS cliente_perfil (
  id_cliente INTEGER PRIMARY KEY,
  id_vendedor INTEGER,
  valor_90d REAL, pedidos_90d INTEGER, skus_90d INTEGER, marcas_90d INTEGER,
  valor_30d REAL, valor_30d_ant REAL,
  primeira_compra TEXT, ultima_compra TEXT, dias_sem_compra INTEGER,
  intervalo_medio REAL,
  curva TEXT, r INTEGER, f INTEGER, v INTEGER, segmento_rfv TEXT,
  potencial_90d REAL, gap_90d REAL,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_perfil_vendedor ON cliente_perfil(id_vendedor);

-- Histórico de compra por cliente × marca (base da recompra atrasada e do cross-sell)
CREATE TABLE IF NOT EXISTS cliente_marca (
  id_cliente INTEGER NOT NULL, marca TEXT NOT NULL,
  compras INTEGER, primeira TEXT, ultima TEXT, valor REAL, qtd REAL,
  valor_90d REAL, valor_30d REAL, valor_30d_ant REAL, intervalo_medio REAL,
  PRIMARY KEY (id_cliente, marca)
);
CREATE INDEX IF NOT EXISTS ix_cliente_marca_marca ON cliente_marca(marca);

-- Regras de associação entre marcas (quem compra A também compra B)
CREATE TABLE IF NOT EXISTS associacao_marca (
  marca_a TEXT NOT NULL, marca_b TEXT NOT NULL,
  clientes_a INTEGER, clientes_b INTEGER, clientes_ab INTEGER, suporte REAL, confianca REAL, lift REAL,
  PRIMARY KEY (marca_a, marca_b)
);

CREATE TABLE IF NOT EXISTS inteligencia_estado (chave TEXT PRIMARY KEY, valor TEXT);
`);

export const VENDA_VALIDA = "lower(v.status) NOT LIKE 'cancel%' AND lower(v.status) NOT LIKE 'devol%'";

// ---------- formatação pt-BR usada nos textos dos fatos (a IA copia os números exatamente como aqui)
const cacheNf = new Map();
const nf = (c) => {
  if (!cacheNf.has(c)) cacheNf.set(c, new Intl.NumberFormat('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));
  return cacheNf.get(c);
};
const ok = (v) => v != null && Number.isFinite(Number(v));
export const fx = {
  num: (v, c = 0) => (ok(v) ? nf(c).format(v) : 'n/d'),
  moeda: (v) => (ok(v) ? `R$ ${nf(Math.abs(v) >= 1000 ? 0 : 2).format(v)}` : 'n/d'),
  perc: (v, c = 0) => (ok(v) ? `${nf(c).format(v)}%` : 'n/d'),
  data: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'n/d'),
  dataCurta: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : 'n/d'),
  sinal: (v, c = 0) => (ok(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(c).format(Math.abs(v))}` : 'n/d'),
  /** Valor no formato de uma métrica do motor (numero | moeda | perc | decimal). */
  valor: (v, formato) => {
    if (!ok(v)) return 'n/d';
    if (formato === 'moeda') return fx.moeda(v);
    if (formato === 'perc') return fx.perc(v, Math.abs(v) < 10 ? 1 : 0);
    if (formato === 'decimal') return nf(2).format(v);
    return nf(Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0).format(v);
  },
};

/** Texto normalizado para busca (minúsculo, sem acento). */
export const normalizarTexto = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function lerEstado(chave, padrao = null) {
  const r = db.prepare('SELECT valor FROM inteligencia_estado WHERE chave = ?').get(chave);
  if (!r) return padrao;
  try {
    return JSON.parse(r.valor);
  } catch {
    return padrao;
  }
}

export function gravarEstado(chave, valor) {
  db.prepare('INSERT INTO inteligencia_estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, JSON.stringify(valor));
}

/** Última data com venda válida (referência de todos os cálculos de inteligência). */
export function dataReferenciaVendas() {
  return db.prepare(`SELECT MAX(v.data_pedido) AS d FROM fato_vendas v WHERE ${VENDA_VALIDA}`).get()?.d || null;
}

/** Assinatura dos dados importados: muda quando chega importação nova. */
export function assinaturaDados() {
  const r = db.prepare('SELECT MAX(id) AS id, COUNT(*) AS n FROM importacao').get();
  // MAX(rowid) é instantâneo (COUNT(*) varre a tabela); a troca atômica da importação muda o id da importação
  const v = db.prepare('SELECT MAX(rowid) AS m FROM fato_vendas').get();
  return `${r?.id || 0}:${r?.n || 0}:${v?.m || 0}`;
}

const quantil = (ordenados, q) => {
  if (!ordenados.length) return 0;
  const pos = (ordenados.length - 1) * q;
  const b = Math.floor(pos);
  const r = pos - b;
  return ordenados[b + 1] !== undefined ? ordenados[b] + r * (ordenados[b + 1] - ordenados[b]) : ordenados[b];
};

/** Nota 1..5 por quintil (maior = melhor). `inverter` para recência (menos dias = melhor). */
function notasQuintil(valores, inverter = false) {
  const ord = valores.filter((x) => x != null).sort((a, b) => a - b);
  const cortes = [0.2, 0.4, 0.6, 0.8].map((q) => quantil(ord, q));
  return (x) => {
    if (x == null) return 1;
    let n = 1;
    for (const c of cortes) if (x > c) n++;
    return inverter ? 6 - n : n;
  };
}

/** Segmento RFV com nome de negócio. r = recência (5 = comprou há pouco), fm = média de frequência e valor. */
export function segmentoRfv(r, f, v) {
  const fm = Math.round((f + v) / 2);
  if (r >= 4 && fm >= 4) return 'Campeões';
  if (r >= 3 && fm >= 4) return 'Leais';
  if (r >= 4 && fm >= 2) return 'Potenciais leais';
  if (r === 5 && fm <= 1) return 'Novos';
  if (r === 4 && fm <= 1) return 'Promissores';
  if (r === 3 && fm >= 2) return 'Precisam de atenção';
  if (r === 3) return 'Quase dormindo';
  if (r <= 2 && fm >= 5) return 'Não pode perder';
  if (r <= 2 && fm >= 3) return 'Em risco';
  if (r === 2) return 'Hibernando';
  return 'Perdidos';
}

export const SEGMENTOS_RFV = [
  'Campeões', 'Leais', 'Potenciais leais', 'Novos', 'Promissores', 'Precisam de atenção',
  'Quase dormindo', 'Não pode perder', 'Em risco', 'Hibernando', 'Perdidos', 'Sem compras',
];

/**
 * Recalcula cliente_perfil, cliente_marca e associacao_marca.
 * @returns {{ clientes: number, pares: number, referencia: string, duracao_ms: number }}
 */
export function atualizarPerfis() {
  const inicio = Date.now();
  const ref = dataReferenciaVendas();
  if (!ref) return { clientes: 0, pares: 0, referencia: null, duracao_ms: 0 };
  const d90 = addDias(ref, -89);
  const d30 = addDias(ref, -29);
  const d60 = addDias(ref, -59);

  // ---------- agregados por cliente
  const porCliente = db
    .prepare(
      `SELECT c.id_cliente, c.id_vendedor, c.segmento, c.porte,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor_90d,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_pedido END) AS pedidos_90d,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_produto END) AS skus_90d,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN p.marca END) AS marcas_90d,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor_30d,
              SUM(CASE WHEN v.data_pedido >= ? AND v.data_pedido < ? THEN v.valor_total ELSE 0 END) AS valor_30d_ant,
              MIN(v.data_pedido) AS primeira, MAX(v.data_pedido) AS ultima,
              COUNT(DISTINCT v.data_pedido) AS dias_compra
         FROM dm_cliente c
         LEFT JOIN fato_vendas v ON v.id_cliente = c.id_cliente AND ${VENDA_VALIDA} AND v.data_pedido <= ?
         LEFT JOIN dm_produto p ON p.id_produto = v.id_produto
        GROUP BY c.id_cliente`,
    )
    .all(d90, d90, d90, d90, d30, d60, d30, ref);

  const comCompra = porCliente.filter((c) => c.ultima);
  const nR = notasQuintil(comCompra.map((c) => diasEntre(c.ultima, ref)), true);
  const nF = notasQuintil(comCompra.map((c) => c.pedidos_90d));
  const nV = notasQuintil(comCompra.map((c) => c.valor_90d));

  // curva ABC pelo valor 90d (80/15/5)
  const total90 = porCliente.reduce((a, c) => a + (c.valor_90d || 0), 0) || 1;
  const curva = new Map();
  let acum = 0;
  for (const c of [...porCliente].sort((a, b) => (b.valor_90d || 0) - (a.valor_90d || 0))) {
    const antes = acum / total90;
    acum += c.valor_90d || 0;
    curva.set(c.id_cliente, !(c.valor_90d > 0) ? 'C' : antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C');
  }

  // potencial: P75 do valor 90d dos clientes ativos do mesmo segmento × porte (com recuo para segmento e geral)
  const grupos = new Map();
  const add = (k, val) => {
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(val);
  };
  for (const c of porCliente) {
    if (!(c.valor_90d > 0)) continue;
    add(`sp|${c.segmento}|${c.porte}`, c.valor_90d);
    add(`s|${c.segmento}`, c.valor_90d);
    add('geral', c.valor_90d);
  }
  for (const l of grupos.values()) l.sort((a, b) => a - b);
  const p75 = (c) => {
    for (const k of [`sp|${c.segmento}|${c.porte}`, `s|${c.segmento}`, 'geral']) {
      const l = grupos.get(k);
      if (l && l.length >= 5) return quantil(l, 0.75);
    }
    return 0;
  };

  const agora = agoraISO();
  const linhasPerfil = porCliente.map((c) => {
    const dias = c.ultima ? diasEntre(c.ultima, ref) : null;
    const r = c.ultima ? nR(dias) : 1;
    const f = c.ultima ? nF(c.pedidos_90d) : 1;
    const v = c.ultima ? nV(c.valor_90d) : 1;
    const intervalo = c.dias_compra >= 2 ? diasEntre(c.primeira, c.ultima) / (c.dias_compra - 1) : null;
    const potencial = Math.round(p75(c) * 100) / 100;
    return [
      c.id_cliente, c.id_vendedor, c.valor_90d || 0, c.pedidos_90d || 0, c.skus_90d || 0, c.marcas_90d || 0,
      c.valor_30d || 0, c.valor_30d_ant || 0, c.primeira, c.ultima, dias, intervalo,
      curva.get(c.id_cliente) || 'C', r, f, v, c.ultima ? segmentoRfv(r, f, v) : 'Sem compras',
      potencial, Math.max(0, Math.round((potencial - (c.valor_90d || 0)) * 100) / 100), agora,
    ];
  });

  // ---------- cliente × marca (histórico completo até a referência)
  const marcas = db
    .prepare(
      `SELECT v.id_cliente, p.marca, COUNT(DISTINCT v.data_pedido) AS compras, MIN(v.data_pedido) AS primeira, MAX(v.data_pedido) AS ultima,
              SUM(v.valor_total) AS valor, SUM(v.quantidade) AS qtd,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor_90d,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor_30d,
              SUM(CASE WHEN v.data_pedido >= ? AND v.data_pedido < ? THEN v.valor_total ELSE 0 END) AS valor_30d_ant
         FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
        WHERE ${VENDA_VALIDA} AND v.data_pedido <= ? AND p.marca IS NOT NULL
        GROUP BY v.id_cliente, p.marca`,
    )
    .all(d90, d30, d60, d30, ref);

  // ---------- associações entre marcas (clientes que compraram nos últimos 90 dias)
  db.exec('DROP TABLE IF EXISTS temp._perfil_cm');
  db.prepare(
    `CREATE TEMP TABLE _perfil_cm AS
     SELECT DISTINCT v.id_cliente, p.marca FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
      WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? AND p.marca IS NOT NULL`,
  ).run(d90, ref);
  const nClientes = db.prepare('SELECT COUNT(DISTINCT id_cliente) AS n FROM _perfil_cm').get().n || 1;
  const porMarca = new Map(db.prepare('SELECT marca, COUNT(*) AS n FROM _perfil_cm GROUP BY marca').all().map((r) => [r.marca, r.n]));
  const minAb = Math.max(5, Math.round(nClientes * 0.01));
  const pares = db
    .prepare(
      `SELECT a.marca AS ma, b.marca AS mb, COUNT(*) AS ab FROM _perfil_cm a
         JOIN _perfil_cm b ON a.id_cliente = b.id_cliente AND a.marca <> b.marca
        GROUP BY a.marca, b.marca HAVING COUNT(*) >= ?`,
    )
    .all(minAb);
  db.exec('DROP TABLE IF EXISTS temp._perfil_cm');
  const assoc = [];
  for (const p of pares) {
    const na = porMarca.get(p.ma) || 0;
    const nb = porMarca.get(p.mb) || 0;
    if (!na || !nb) continue;
    const confianca = p.ab / na;
    const lift = confianca / (nb / nClientes);
    assoc.push([p.ma, p.mb, na, nb, p.ab, p.ab / nClientes, confianca, lift]);
  }

  transacao(() => {
    db.exec('DELETE FROM cliente_perfil; DELETE FROM cliente_marca; DELETE FROM associacao_marca;');
    const ip = db.prepare(`INSERT INTO cliente_perfil (id_cliente, id_vendedor, valor_90d, pedidos_90d, skus_90d, marcas_90d, valor_30d, valor_30d_ant,
      primeira_compra, ultima_compra, dias_sem_compra, intervalo_medio, curva, r, f, v, segmento_rfv, potencial_90d, gap_90d, atualizado_em)
      VALUES (${Array(20).fill('?').join(',')})`);
    for (const l of linhasPerfil) ip.run(...l);
    const im = db.prepare(`INSERT INTO cliente_marca (id_cliente, marca, compras, primeira, ultima, valor, qtd, valor_90d, valor_30d, valor_30d_ant, intervalo_medio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const m of marcas) {
      const intervalo = m.compras >= 2 ? diasEntre(m.primeira, m.ultima) / (m.compras - 1) : null;
      im.run(m.id_cliente, m.marca, m.compras, m.primeira, m.ultima, m.valor, m.qtd, m.valor_90d, m.valor_30d, m.valor_30d_ant, intervalo);
    }
    const ia = db.prepare('INSERT INTO associacao_marca (marca_a, marca_b, clientes_a, clientes_b, clientes_ab, suporte, confianca, lift) VALUES (?,?,?,?,?,?,?,?)');
    for (const a of assoc) ia.run(...a);
  });

  const r = { clientes: linhasPerfil.length, pares: assoc.length, marcas_cliente: marcas.length, referencia: ref, duracao_ms: Date.now() - inicio };
  gravarEstado('perfil', { ...r, assinatura: assinaturaDados(), atualizado_em: agora });
  return r;
}

export function perfilDesatualizado() {
  const e = lerEstado('perfil');
  return !e || e.assinatura !== assinaturaDados() || !db.prepare('SELECT 1 FROM cliente_perfil LIMIT 1').get();
}
