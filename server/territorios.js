import { db } from './db.js';
import { hojeISO, addDias } from './calendario.js';
import { referenciaVendas, resumoMapa, endereco, assinaturaMapa } from './geo.js';
import { fotoVendedor, listarVendedores } from './participantes.js';
import { caixaAneis, dentroAneis } from './malhas.js';

// =====================================================================
// Territórios e desenhos do mapa. Um território é uma área desenhada (ou feita de bairros/cidades)
// atribuída a um vendedor; uma anotação é um desenho livre com nome, nota e cor.
// Os números de cada área saem dos pontos que caem dentro do polígono (regra par-ímpar).
// =====================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS territorio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'territorio',
  nome TEXT NOT NULL,
  id_vendedor INTEGER,
  cor TEXT,
  nota TEXT,
  forma TEXT,
  origem TEXT,
  geometria TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_territorio_vendedor ON territorio(id_vendedor);
CREATE TABLE IF NOT EXISTS territorio_numeros (
  id INTEGER PRIMARY KEY,
  assinatura TEXT NOT NULL,
  json TEXT NOT NULL,
  ms INTEGER,
  gerado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const TIPOS = ['territorio', 'anotacao'];
const FORMAS = ['poligono', 'laco', 'retangulo', 'bairro', 'cidade', 'misto'];
const CORES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
export const corPadraoVendedor = (id) => (id == null ? 's3' : CORES[Math.abs(Number(id)) % CORES.length]);
const r1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ geometria
/** Aceita um anel [[lng, lat], ...] ou uma lista de anéis; devolve anéis fechados e validados. */
export function normalizarGeometria(g) {
  if (!Array.isArray(g) || !g.length) throw erro('Desenhe uma área com pelo menos 3 pontos.');
  const aneis = typeof g[0]?.[0] === 'number' ? [g] : g;
  if (aneis.length > 400) throw erro('Área com partes demais (máximo 400).');
  let total = 0;
  const out = aneis.map((anel) => {
    if (!Array.isArray(anel)) throw erro('Geometria inválida.');
    const pts = [];
    for (const p of anel) {
      const lng = Number(p?.[0]);
      const lat = Number(p?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -80 || lng > -25 || lat < -40 || lat > 10) throw erro('Há pontos fora do Brasil na área desenhada.');
      const q = [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
      const u = pts[pts.length - 1];
      if (!u || u[0] !== q[0] || u[1] !== q[1]) pts.push(q);
    }
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3) throw erro('Cada área precisa de pelo menos 3 pontos diferentes.');
    total += pts.length;
    pts.push([...pts[0]]);
    return pts;
  });
  if (total > 60000) throw erro('Área detalhada demais (máximo de 60 mil pontos).');
  return out;
}

/** Área aproximada em km² (equirretangular local; bom para áreas de cidade e região). */
function areaKm2(aneis) {
  let total = 0;
  for (const anel of aneis) {
    const lat0 = (anel.reduce((a, p) => a + p[1], 0) / anel.length) * (Math.PI / 180);
    const kx = 111.32 * Math.cos(lat0);
    let s = 0;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) s += anel[j][0] * kx * (anel[i][1] * 110.57) - anel[i][0] * kx * (anel[j][1] * 110.57);
    total += Math.abs(s / 2);
  }
  // anéis internos (buracos) entram com sinal trocado pela regra par-ímpar: aproximação suficiente para exibir
  return total;
}

function linhaParaObjeto(r) {
  const vend = r.id_vendedor != null ? db.prepare('SELECT id_vendedor, nome_vendedor FROM dm_vendedor WHERE id_vendedor = ?').get(r.id_vendedor) : null;
  return {
    id: r.id,
    tipo: r.tipo,
    nome: r.nome,
    id_vendedor: r.id_vendedor != null ? String(r.id_vendedor) : null,
    vendedor: vend ? { id: String(vend.id_vendedor), nome: vend.nome_vendedor, foto: fotoVendedor(vend.id_vendedor) } : null,
    cor: r.cor || (r.tipo === 'territorio' ? corPadraoVendedor(r.id_vendedor) : 's3'),
    nota: r.nota || '',
    forma: r.forma,
    origem: r.origem ? JSON.parse(r.origem) : null,
    geometria: JSON.parse(r.geometria),
    criado_em: r.criado_em,
    atualizado_em: r.atualizado_em,
  };
}

// ------------------------------------------------------------------ números de uma área
const cacheMedidas = new Map();

/**
 * Tudo o que existe dentro de uma área: farmácias da Receita, nossos clientes, quem atende,
 * vendas de 90 dias, potencial, penetração, conflitos com o vendedor dono e sobreposição com outros territórios.
 */
export function medirArea(aneis, { id = null, idVendedor = null, detalhar = true } = {}) {
  const [o, s, l, n] = caixaAneis(aneis);
  const dentro = (lng, lat) => lng >= o && lng <= l && lat >= s && lat <= n && dentroAneis(lng, lat, aneis);
  const ref = referenciaVendas();
  const resumo = resumoMapa();
  const ticketCidade = new Map(resumo.cidades.map((c) => [c.ibge, c.ticket_esperado]));
  const ha12 = addDias(hojeISO(), -365);

  // farmácias (Receita)
  const farm = db
    .prepare(
      `SELECT cnpj, lat, lng, rede, id_cliente, data_inicio, score, municipio_ibge, municipio, uf, bairro, cnae, telefone,
              tipo_logradouro, logradouro, numero, complemento, COALESCE(nome_fantasia, razao_social) AS nome
         FROM rf_farmacia WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .all(s, n, o, l)
    .filter((f) => dentroAneis(f.lng, f.lat, aneis));
  const cidades = new Map();
  let independentes = 0;
  let livres = 0;
  let naoClientes = 0;
  let novas = 0;
  let potencial = 0;
  for (const f of farm) {
    const indep = !f.rede || f.rede <= 1;
    if (indep) independentes++;
    if (f.id_cliente == null) naoClientes++;
    if (indep && f.id_cliente == null) {
      livres++;
      potencial += ticketCidade.get(String(f.municipio_ibge)) ?? resumo.ticket_esperado ?? 0;
    }
    if (f.data_inicio && f.data_inicio >= ha12) novas++;
    const k = String(f.municipio_ibge);
    if (!cidades.has(k)) cidades.set(k, { ibge: k, nome: f.municipio, uf: f.uf, farmacias: 0, clientes: 0 });
    cidades.get(k).farmacias++;
  }

  // nossos clientes
  const clientes = db
    .prepare(
      `SELECT cg.id_cliente, cg.lat, cg.lng, cg.aproximado, cg.origem, cg.municipio_ibge, c.id_vendedor AS vendedor_cadastro,
              COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.cidade, c.estado, c.bairro
         FROM cliente_geo cg JOIN dm_cliente c ON c.id_cliente = cg.id_cliente
        WHERE cg.lat BETWEEN ? AND ? AND cg.lng BETWEEN ? AND ?`,
    )
    .all(s, n, o, l)
    .filter((c) => dentroAneis(c.lng, c.lat, aneis));
  const idsDentro = new Set(clientes.map((c) => c.id_cliente));
  const vendas = new Map(); // id_cliente -> Map(id_vendedor -> valor)
  if (clientes.length) {
    const lista = [...idsDentro].join(',');
    for (const v of db
      .prepare(
        `SELECT id_cliente, id_vendedor, SUM(valor_total) AS valor FROM fato_vendas
          WHERE status = 'Faturado' AND data_pedido > date(?, '-90 day') AND data_pedido <= ? AND id_cliente IN (${lista})
          GROUP BY id_cliente, id_vendedor`,
      )
      .iterate(ref, ref)) {
      if (!vendas.has(v.id_cliente)) vendas.set(v.id_cliente, new Map());
      vendas.get(v.id_cliente).set(v.id_vendedor, v.valor);
    }
  }
  const nomesVend = new Map(db.prepare('SELECT id_vendedor, nome_vendedor FROM dm_vendedor').all().map((v) => [v.id_vendedor, v.nome_vendedor]));
  const atendem = new Map();
  let valor = 0;
  let ativos = 0;
  let aproximados = 0;
  const conflitos = [];
  const dono = idVendedor != null && idVendedor !== '' ? Number(idVendedor) : null;
  for (const c of clientes) {
    const mv = vendas.get(c.id_cliente);
    let total = 0;
    let principal = null;
    let maior = -1;
    if (mv) {
      for (const [vid, v] of mv) {
        total += v;
        if (v > maior) {
          maior = v;
          principal = vid;
        }
        if (!atendem.has(vid)) atendem.set(vid, { id: String(vid), nome: nomesVend.get(vid) || `Vendedor ${vid}`, foto: fotoVendedor(vid), clientes: 0, valor: 0 });
        atendem.get(vid).valor += v;
      }
      atendem.get(principal).clientes++;
    }
    if (total > 0) ativos++;
    valor += total;
    if (c.aproximado) aproximados++;
    const cid = cidades.get(String(c.municipio_ibge));
    if (cid) cid.clientes++;
    const quem = principal ?? c.vendedor_cadastro;
    if (dono != null && quem != null && Number(quem) !== dono) {
      conflitos.push({ id: c.id_cliente, nome: c.nome, bairro: c.bairro, cidade: c.cidade, uf: c.estado, valor_90d: Math.round(total), vendedor: { id: String(quem), nome: nomesVend.get(Number(quem)) || `Vendedor ${quem}` }, por: principal != null ? 'venda' : 'cadastro' });
    }
  }

  const medida = {
    area_km2: r1(areaKm2(aneis)),
    caixa: [o, s, l, n],
    farmacias: farm.length,
    independentes,
    independentes_livres: livres,
    nao_clientes: naoClientes,
    novas_12m: novas,
    clientes: clientes.length,
    clientes_ativos: ativos,
    clientes_aproximados: aproximados,
    valor_90d: Math.round(valor),
    potencial_90d: Math.round(potencial),
    penetracao: farm.length ? r1((ativos / farm.length) * 100) : null,
    conflitos: conflitos.length,
    conflitos_valor: Math.round(conflitos.reduce((a, c) => a + c.valor_90d, 0)),
    referencia: ref,
  };
  if (!detalhar) return medida;

  // clientes do dono atendidos fora da área
  let fora = null;
  if (dono != null) {
    const doVendedor = db
      .prepare(
        `SELECT v.id_cliente, SUM(v.valor_total) AS valor, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.cidade, c.estado
           FROM fato_vendas v JOIN dm_cliente c ON c.id_cliente = v.id_cliente
          WHERE v.status = 'Faturado' AND v.id_vendedor = ? AND v.data_pedido > date(?, '-90 day') AND v.data_pedido <= ?
          GROUP BY v.id_cliente ORDER BY valor DESC`,
      )
      .all(dono, ref, ref);
    const foraLista = doVendedor.filter((c) => !idsDentro.has(c.id_cliente));
    fora = {
      clientes_do_vendedor: doVendedor.length,
      dentro: doVendedor.length - foraLista.length,
      fora: foraLista.length,
      valor_fora: Math.round(foraLista.reduce((a, c) => a + c.valor, 0)),
      lista: foraLista.slice(0, 8).map((c) => ({ id: c.id_cliente, nome: c.nome, cidade: c.cidade, uf: c.estado, valor_90d: Math.round(c.valor) })),
    };
  }

  // sobreposição com outros territórios de vendedor
  const sobreposicoes = [];
  for (const t of db.prepare("SELECT id, nome, id_vendedor, cor, geometria FROM territorio WHERE tipo = 'territorio' AND (? IS NULL OR id <> ?)").all(id, id)) {
    const g = JSON.parse(t.geometria);
    const [to, ts, tl, tn] = caixaAneis(g);
    if (tl < o || to > l || tn < s || ts > n) continue;
    let comuns = 0;
    for (const f of farm) if (f.lng >= to && f.lng <= tl && f.lat >= ts && f.lat <= tn && dentroAneis(f.lng, f.lat, g)) comuns++;
    let clientesComuns = 0;
    for (const c of clientes) if (dentroAneis(c.lng, c.lat, g)) clientesComuns++;
    if (comuns || clientesComuns) sobreposicoes.push({ id: t.id, nome: t.nome, cor: t.cor || corPadraoVendedor(t.id_vendedor), vendedor: t.id_vendedor != null ? nomesVend.get(t.id_vendedor) || null : null, farmacias: comuns, clientes: clientesComuns });
  }

  const prospects = farm
    .filter((f) => f.id_cliente == null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10)
    .map((f) => ({ cnpj: f.cnpj, nome: f.nome, bairro: f.bairro, cidade: f.municipio, uf: f.uf, rede: f.rede ?? 1, score: Math.round(f.score ?? 0), lat: f.lat, lng: f.lng, endereco: endereco(f), telefone: f.telefone, abertura: f.data_inicio }));

  return {
    ...medida,
    quem_atende: [...atendem.values()].map((v) => ({ ...v, valor: Math.round(v.valor), dono: dono != null && Number(v.id) === dono })).sort((a, b) => b.valor - a.valor),
    lista_conflitos: conflitos.sort((a, b) => b.valor_90d - a.valor_90d).slice(0, 12),
    fora,
    sobreposicoes: sobreposicoes.sort((a, b) => b.farmacias - a.farmacias),
    cidades: [...cidades.values()].sort((a, b) => b.farmacias - a.farmacias).slice(0, 8),
    prospects,
  };
}

// Números de cada área ficam gravados em territorio_numeros (etapa "mapa-territorios" do pipeline).
// A assinatura muda com a própria área, com qualquer outra área (sobreposição) e com os dados do mapa.
function assinaturaBase() {
  const t = db.prepare('SELECT COUNT(*) AS n, MAX(atualizado_em) AS u, SUM(id) AS s FROM territorio').get();
  return `${t.n}|${t.u}|${t.s}|${assinaturaMapa()}`;
}
const assinaturaArea = (t, base) => `${t.atualizado_em}|${t.id_vendedor}|${t.tipo}|${base}`;

function medidaEmCache(t, base = assinaturaBase()) {
  const chave = assinaturaArea(t, base);
  const c = cacheMedidas.get(t.id);
  if (c && c.chave === chave) return c.medida;
  const row = db.prepare('SELECT assinatura, json FROM territorio_numeros WHERE id = ?').get(t.id);
  let medida = row?.assinatura === chave ? JSON.parse(row.json) : null;
  if (!medida) {
    const t0 = Date.now();
    medida = medirArea(t.geometria, { id: t.id, idVendedor: t.tipo === 'territorio' ? t.id_vendedor : null });
    db.prepare('INSERT OR REPLACE INTO territorio_numeros (id, assinatura, json, ms) VALUES (?, ?, ?, ?)').run(t.id, chave, JSON.stringify(medida), Date.now() - t0);
  }
  cacheMedidas.set(t.id, { chave, medida });
  return medida;
}

/** Etapa do pipeline: deixa gravados os números de todas as áreas (só recalcula as que mudaram). */
export function recalcularTerritorios() {
  const base = assinaturaBase();
  const linhas = db.prepare('SELECT * FROM territorio').all();
  for (const r of linhas) medidaEmCache(linhaParaObjeto(r), base);
  db.prepare('DELETE FROM territorio_numeros WHERE id NOT IN (SELECT id FROM territorio)').run();
  return { linhas: linhas.length };
}
export const assinaturaTerritorios = assinaturaBase;

const resumoMedida = (m) => {
  const { quem_atende, lista_conflitos, fora, sobreposicoes, cidades, prospects, caixa, ...resto } = m;
  return { ...resto, sobreposicoes: sobreposicoes.length, fora: fora?.fora ?? null };
};

// ------------------------------------------------------------------ CRUD
export function listarTerritorios({ tipo, vendedor } = {}) {
  const where = [];
  const p = [];
  if (tipo && TIPOS.includes(tipo)) {
    where.push('tipo = ?');
    p.push(tipo);
  }
  if (vendedor) {
    where.push('id_vendedor = ?');
    p.push(Number(vendedor));
  }
  const linhas = db.prepare(`SELECT * FROM territorio ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY tipo DESC, nome COLLATE NOCASE`).all(...p);
  const base = assinaturaBase();
  return linhas.map((r) => {
    const t = linhaParaObjeto(r);
    return { ...t, numeros: resumoMedida(medidaEmCache(t, base)) };
  });
}

export function obterTerritorio(id) {
  const r = db.prepare('SELECT * FROM territorio WHERE id = ?').get(Number(id));
  if (!r) return null;
  const t = linhaParaObjeto(r);
  return { ...t, numeros: medidaEmCache(t) };
}

function validar(d, parcial = false) {
  const out = {};
  if (!parcial || d.tipo !== undefined) {
    if (!TIPOS.includes(d.tipo || 'territorio')) throw erro('Tipo inválido (território ou anotação).');
    out.tipo = d.tipo || 'territorio';
  }
  if (!parcial || d.nome !== undefined) {
    const nome = String(d.nome ?? '').trim().slice(0, 80);
    if (!nome) throw erro('Dê um nome para a área.');
    out.nome = nome;
  }
  if (d.id_vendedor !== undefined) {
    if (d.id_vendedor === null || d.id_vendedor === '') out.id_vendedor = null;
    else {
      const v = db.prepare('SELECT id_vendedor FROM dm_vendedor WHERE id_vendedor = ?').get(Number(d.id_vendedor));
      if (!v) throw erro('Vendedor não encontrado.');
      out.id_vendedor = v.id_vendedor;
    }
  }
  if (d.cor !== undefined) {
    const cor = d.cor == null || d.cor === '' ? null : String(d.cor);
    if (cor && !CORES.includes(cor) && !/^#[0-9a-f]{6}$/i.test(cor)) throw erro('Cor inválida.');
    out.cor = cor;
  }
  if (d.nota !== undefined) out.nota = String(d.nota ?? '').slice(0, 2000);
  if (d.forma !== undefined) out.forma = FORMAS.includes(d.forma) ? d.forma : 'poligono';
  if (d.origem !== undefined) out.origem = d.origem ? JSON.stringify(d.origem).slice(0, 4000) : null;
  if (!parcial || d.geometria !== undefined) out.geometria = JSON.stringify(normalizarGeometria(d.geometria));
  return out;
}

export function criarTerritorio(d) {
  const v = validar(d);
  if (v.tipo === 'territorio' && v.id_vendedor == null) throw erro('Escolha o vendedor dono do território (ou salve como anotação).');
  const r = db
    .prepare('INSERT INTO territorio (tipo, nome, id_vendedor, cor, nota, forma, origem, geometria) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.tipo, v.nome, v.id_vendedor ?? null, v.cor ?? null, v.nota ?? '', v.forma ?? 'poligono', v.origem ?? null, v.geometria);
  return obterTerritorio(r.lastInsertRowid);
}

export function atualizarTerritorio(id, d) {
  const atual = db.prepare('SELECT * FROM territorio WHERE id = ?').get(Number(id));
  if (!atual) throw erro('Área não encontrada.', 404);
  const v = validar(d, true);
  const tipo = v.tipo ?? atual.tipo;
  const vend = v.id_vendedor !== undefined ? v.id_vendedor : atual.id_vendedor;
  if (tipo === 'territorio' && vend == null) throw erro('Território precisa de um vendedor.');
  const campos = Object.keys(v);
  if (!campos.length) return obterTerritorio(id);
  db.prepare(`UPDATE territorio SET ${campos.map((c) => `${c} = ?`).join(', ')}, atualizado_em = datetime('now', 'localtime') WHERE id = ?`).run(...campos.map((c) => v[c]), Number(id));
  cacheMedidas.delete(Number(id));
  return obterTerritorio(id);
}

export function excluirTerritorio(id) {
  const r = db.prepare('DELETE FROM territorio WHERE id = ?').run(Number(id));
  db.prepare('DELETE FROM territorio_numeros WHERE id = ?').run(Number(id));
  cacheMedidas.delete(Number(id));
  if (!r.changes) throw erro('Área não encontrada.', 404);
  return { ok: true };
}

/** Vendedores para o seletor (com foto, cor sugerida e quantos territórios já têm). */
export function vendedoresParaTerritorio() {
  const qtd = new Map(db.prepare("SELECT id_vendedor, COUNT(*) AS n FROM territorio WHERE tipo = 'territorio' GROUP BY id_vendedor").all().map((r) => [String(r.id_vendedor), r.n]));
  return listarVendedores().map((v) => ({ ...v, cor: corPadraoVendedor(v.id), territorios: qtd.get(v.id) || 0 }));
}

/** Farmácias não clientes dentro da área, para planilha de prospecção. */
export function farmaciasDaArea(aneis) {
  const [o, s, l, n] = caixaAneis(aneis);
  return db
    .prepare('SELECT * FROM rf_farmacia WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND id_cliente IS NULL ORDER BY score DESC')
    .all(s, n, o, l)
    .filter((f) => dentroAneis(f.lng, f.lat, aneis));
}
