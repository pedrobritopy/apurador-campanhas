import fs from 'node:fs';
import path from 'node:path';
import { db, RAIZ, agoraISO, transacao } from './db.js';
import { addDias } from './calendario.js';
import { referenciaVendas } from './geo.js';
import { bairrosEmCache, caixaAneis, decodificarAnel, dentroAneis } from './malhas.js';
import { fotoVendedor } from './participantes.js';
import { normalizarTexto } from './receita.js';
import { assinaturaBase, gravarPronto, hash, lerPronto } from './pipeline.js';

// =====================================================================
// Carteiras de vendas. Cada vendedor tem uma carteira feita de regras geográficas:
//   UF → cidade → bairro (malha IBGE/OSM, ou nome do bairro quando a cidade não tem malha) → território desenhado.
// Cada cliente e cada farmácia da Receita cai em exatamente uma carteira: vale a regra mais específica;
// sem regra, fica "sem dono". A classificação e os indicadores são pré-calculados pela pipeline
// (etapa "carteiras"); as rotas só leem o pronto.
// Agregação em todos os níveis: vendedor → gerente (equipe) → coordenador (região) → empresa.
// =====================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS carteira (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_vendedor INTEGER UNIQUE,
  nome TEXT NOT NULL,
  cor TEXT,
  nota TEXT,
  origem TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS carteira_regra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_carteira INTEGER NOT NULL,
  nivel TEXT NOT NULL,
  chave TEXT NOT NULL UNIQUE,
  uf TEXT,
  ibge TEXT,
  bairro_id TEXT,
  nome TEXT,
  id_territorio INTEGER,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_carteira_regra_cart ON carteira_regra(id_carteira);
CREATE TABLE IF NOT EXISTS carteira_cliente (
  id_cliente INTEGER PRIMARY KEY,
  id_carteira INTEGER,
  id_vendedor INTEGER,
  nivel TEXT,
  chave TEXT,
  ibge TEXT,
  bairro_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_carteira_cliente_cart ON carteira_cliente(id_carteira);
CREATE TABLE IF NOT EXISTS carteira_farmacia (
  cnpj TEXT PRIMARY KEY,
  id_carteira INTEGER,
  id_vendedor INTEGER,
  nivel TEXT,
  chave TEXT,
  ibge TEXT,
  bairro_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_carteira_farmacia_cart ON carteira_farmacia(id_carteira);
CREATE INDEX IF NOT EXISTS ix_carteira_farmacia_ibge ON carteira_farmacia(ibge);
CREATE TABLE IF NOT EXISTS equipe_info (
  id_gerente INTEGER PRIMARY KEY,
  nome TEXT,
  uf TEXT,
  regiao TEXT,
  cidade_base TEXT
);
CREATE TABLE IF NOT EXISTS regiao_info (
  id TEXT PRIMARY KEY,
  nome TEXT,
  id_coordenador INTEGER,
  ufs TEXT
);
`);

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const NIVEIS_REGRA = ['uf', 'cidade', 'bairro', 'territorio'];
const PESO_NIVEL = { territorio: 4, bairro: 3, bairro_nome: 3, cidade: 2, uf: 1 };
const CORES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const PLANO = path.join(RAIZ, 'dados', 'pracas.json');
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ regras
export function chaveRegra(r) {
  if (r.nivel === 'uf') return `uf:${String(r.uf).toUpperCase()}`;
  if (r.nivel === 'cidade') return `cidade:${r.ibge}`;
  if (r.nivel === 'bairro') return r.bairro_id ? `bairro:${r.ibge}:${r.bairro_id}` : `bairro_nome:${r.ibge}:${normalizarTexto(r.nome)}`;
  if (r.nivel === 'territorio') return `territorio:${r.id_territorio}`;
  throw erro('Nível de regra inválido.');
}
const nivelDaChave = (chave) => chave.split(':')[0];

/** Assinatura das regras e carteiras (muda a cada edição). */
export function assinaturaCarteiras() {
  const a = db.prepare('SELECT COUNT(*) AS n, MAX(atualizado_em) AS m, (SELECT COUNT(*) FROM carteira_regra) AS r, (SELECT MAX(id) FROM carteira_regra) AS mr FROM carteira').get();
  const t = db.prepare("SELECT COUNT(*) AS n, MAX(atualizado_em) AS m FROM territorio WHERE id IN (SELECT id_territorio FROM carteira_regra WHERE nivel = 'territorio')").get();
  return hash(a, t);
}

// ------------------------------------------------------------------ semente: praças do plano comercial
/**
 * Demonstração no ES (base atual, sem praças no cadastro): Grande Vitória dividida por bairros
 * (Vitória 3, Vila Velha 3, Serra 2, Cariacica 2 carteiras) e o interior em 3 regiões de cidades,
 * uma carteira para cada vendedor que mora no ES. Agrupamento por k-médias dos centros dos bairros/cidades,
 * pesado pelo número de farmácias da Receita.
 */
function semearDemonstracaoES() {
  const vend = db.prepare("SELECT id_vendedor FROM dm_vendedor WHERE estado = 'ES' AND lower(COALESCE(nivel,'')) = 'vendedor' ORDER BY id_vendedor").all().map((v) => v.id_vendedor);
  const munEs = db.prepare("SELECT codigo_ibge AS ibge, nome, lat, lng FROM geo_municipio WHERE uf = 'ES'").all();
  if (vend.length < 6 || !munEs.length) return 0;
  const farmPor = new Map(db.prepare("SELECT municipio_ibge AS ibge, lat, lng FROM rf_farmacia WHERE uf = 'ES' AND lat IS NOT NULL").all().reduce((m, f) => m.set(f.ibge, [...(m.get(f.ibge) || []), f]), new Map()));
  const kmedias = (pts, k) => {
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const cs = [{ ...pts.reduce((a, b) => (b.w > a.w ? b : a)) }];
    while (cs.length < k) cs.push({ ...pts.reduce((a, b) => (Math.min(...cs.map((c) => d2(b, c))) * b.w > Math.min(...cs.map((c) => d2(a, c))) * a.w ? b : a)) });
    let lab = [];
    for (let t = 0; t < 30; t++) {
      lab = pts.map((p) => cs.reduce((m, c, i) => (d2(p, c) < d2(p, cs[m]) ? i : m), 0));
      cs.forEach((c, i) => {
        const g = pts.filter((_, j) => lab[j] === i);
        const w = g.reduce((a, p) => a + p.w, 0);
        if (w) Object.assign(c, { x: g.reduce((a, p) => a + p.x * p.w, 0) / w, y: g.reduce((a, p) => a + p.y * p.w, 0) / w });
      });
    }
    return [...Array(k).keys()].map((i) => pts.filter((_, j) => lab[j] === i)).filter((g) => g.length);
  };
  const rumo = (g, todos) => {
    const c = (l) => ({ x: l.reduce((a, p) => a + p.x * p.w, 0) / l.reduce((a, p) => a + p.w, 0), y: l.reduce((a, p) => a + p.y * p.w, 0) / l.reduce((a, p) => a + p.w, 0) });
    const a = c(g);
    const b = c(todos);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.hypot(dx, dy) < 0.004) return 'Centro';
    return Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'Norte' : 'Sul') : dx > 0 ? 'Leste' : 'Oeste';
  };
  const zonas = [];
  const metro = [['3205309', 3], ['3205200', 3], ['3205002', 2], ['3201308', 2]];
  for (const [ibge, k] of metro) {
    const bs = bairrosEmCache(ibge)?.bairros;
    const m = munEs.find((x) => x.ibge === ibge);
    if (!bs?.length || !m) continue;
    const farm = farmPor.get(ibge) || [];
    const pts = bs.map((b) => {
      const an = b.a.map(decodificarAnel);
      const cx = caixaAneis(an);
      const n = farm.filter((f) => f.lng >= cx[0] && f.lng <= cx[2] && f.lat >= cx[1] && f.lat <= cx[3] && dentroAneis(f.lng, f.lat, an)).length;
      return { b, x: an[0].reduce((a, p) => a + p[0], 0) / an[0].length, y: an[0].reduce((a, p) => a + p[1], 0) / an[0].length, w: n + 0.5 };
    });
    for (const g of kmedias(pts, k)) zonas.push({ nome: `${m.nome} ${rumo(g, pts)}`, regras: g.map((p) => ({ nivel: 'bairro', ibge, bairro_id: p.b.id, nome: p.b.nome })) });
  }
  const restantes = vend.length - zonas.length;
  const interior = munEs.filter((m) => !metro.some(([i]) => i === m.ibge)).map((m) => ({ m, x: m.lng, y: m.lat, w: (farmPor.get(m.ibge)?.length || 0) + 0.3 }));
  for (const g of kmedias(interior, Math.max(1, restantes))) {
    const base = [...g].sort((a, b) => b.w - a.w)[0].m;
    zonas.push({ nome: `Região de ${base.nome}`, regras: g.map((p) => ({ nivel: 'cidade', ibge: p.m.ibge, nome: p.m.nome })) });
  }
  const agora = agoraISO();
  const sc = db.prepare('INSERT INTO carteira (id_vendedor, nome, cor, nota, origem, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const sr = db.prepare('INSERT OR IGNORE INTO carteira_regra (id_carteira, nivel, chave, uf, ibge, bairro_id, nome, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let n = 0;
  transacao(() => {
    zonas.slice(0, vend.length).forEach((z, i) => {
      const id = Number(sc.run(vend[i], z.nome, CORES[i % CORES.length], 'Carteira de demonstração do ES (divisão por bairros e cidades).', 'demonstracao-es', agora, agora).lastInsertRowid);
      for (const r of z.regras) sr.run(id, r.nivel, chaveRegra(r), 'ES', r.ibge, r.bairro_id || null, r.nome, agora);
      n++;
    });
  });
  return n;
}

/** Cria as carteiras, equipes e regiões do dados/pracas.json (só se ainda não há carteiras). Sem plano: demonstração no ES. */
export function semearCarteiras({ forcar = false } = {}) {
  if (!fs.existsSync(PLANO)) {
    if (db.prepare('SELECT COUNT(*) AS n FROM carteira').get().n) return { semeadas: 0 };
    return { semeadas: semearDemonstracaoES() };
  }
  const plano = JSON.parse(fs.readFileSync(PLANO, 'utf8'));
  const ja = db.prepare('SELECT COUNT(*) AS n FROM carteira').get().n;
  const agora = agoraISO();
  transacao(() => {
    db.exec('DELETE FROM equipe_info; DELETE FROM regiao_info;');
    const se = db.prepare('INSERT INTO equipe_info (id_gerente, nome, uf, regiao, cidade_base) VALUES (?, ?, ?, ?, ?)');
    for (const e of plano.equipes || []) se.run(e.id_gerente, e.nome, e.uf, e.regiao, e.cidade_base);
    const sr = db.prepare('INSERT INTO regiao_info (id, nome, id_coordenador, ufs) VALUES (?, ?, ?, ?)');
    for (const r of plano.regioes || []) sr.run(r.id, r.nome, r.id_coordenador, JSON.stringify(r.ufs));
  });
  if (ja && !forcar) return { semeadas: 0 };
  const vendedores = new Set(db.prepare('SELECT id_vendedor FROM dm_vendedor').all().map((v) => v.id_vendedor));
  let n = 0;
  transacao(() => {
    if (forcar) db.exec('DELETE FROM carteira_regra; DELETE FROM carteira;');
    const sc = db.prepare('INSERT INTO carteira (id_vendedor, nome, cor, nota, origem, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const sr = db.prepare('INSERT OR IGNORE INTO carteira_regra (id_carteira, nivel, chave, uf, ibge, bairro_id, nome, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    (plano.carteiras || []).forEach((c, i) => {
      if (!vendedores.has(c.id_vendedor)) return;
      const id = Number(sc.run(c.id_vendedor, c.nome, CORES[i % CORES.length], null, 'plano', agora, agora).lastInsertRowid);
      for (const r of c.regras) sr.run(id, r.nivel, chaveRegra(r), c.uf, r.ibge, r.bairro_id || null, r.nome, agora);
      n++;
    });
  });
  return { semeadas: n };
}

// ------------------------------------------------------------------ CRUD
const vendedorInfo = (id) => (id == null ? null : db.prepare('SELECT id_vendedor, nome_vendedor, nivel, id_superior, estado, cidade FROM dm_vendedor WHERE id_vendedor = ?').get(Number(id)));

export function criarCarteira({ id_vendedor, nome, cor, nota } = {}) {
  const v = vendedorInfo(id_vendedor);
  if (!v) throw erro('Escolha um vendedor.');
  if (db.prepare('SELECT 1 FROM carteira WHERE id_vendedor = ?').get(v.id_vendedor)) throw erro(`${v.nome_vendedor} já tem carteira.`, 409);
  const n = db.prepare('SELECT COUNT(*) AS n FROM carteira').get().n;
  const agora = agoraISO();
  const id = Number(
    db
      .prepare('INSERT INTO carteira (id_vendedor, nome, cor, nota, origem, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.id_vendedor, String(nome || `Carteira de ${v.nome_vendedor}`).slice(0, 120), CORES.includes(cor) ? cor : CORES[n % CORES.length], nota || null, 'manual', agora, agora).lastInsertRowid,
  );
  return obterCarteira(id);
}

export function atualizarCarteira(id, d = {}) {
  const c = db.prepare('SELECT * FROM carteira WHERE id = ?').get(Number(id));
  if (!c) throw erro('Carteira não encontrada.', 404);
  let idV = c.id_vendedor;
  if (d.id_vendedor != null && Number(d.id_vendedor) !== c.id_vendedor) {
    const v = vendedorInfo(d.id_vendedor);
    if (!v) throw erro('Vendedor não encontrado.');
    if (db.prepare('SELECT 1 FROM carteira WHERE id_vendedor = ? AND id <> ?').get(v.id_vendedor, c.id)) throw erro(`${v.nome_vendedor} já tem carteira.`, 409);
    idV = v.id_vendedor;
  }
  db.prepare('UPDATE carteira SET id_vendedor = ?, nome = ?, cor = ?, nota = ?, atualizado_em = ? WHERE id = ?').run(
    idV, d.nome != null ? String(d.nome).slice(0, 120) : c.nome, CORES.includes(d.cor) ? d.cor : c.cor, d.nota !== undefined ? d.nota || null : c.nota, agoraISO(), c.id,
  );
  return obterCarteira(c.id);
}

export function excluirCarteira(id) {
  transacao(() => {
    db.prepare('DELETE FROM carteira_regra WHERE id_carteira = ?').run(Number(id));
    db.prepare('DELETE FROM carteira WHERE id = ?').run(Number(id));
  });
  return { ok: true };
}

/** Inclui uma unidade (UF, cidade, bairro ou território) na carteira. Se já for de outra, `mover` decide. */
export function incluirRegra(idCarteira, r = {}, { mover = false } = {}) {
  const c = db.prepare('SELECT * FROM carteira WHERE id = ?').get(Number(idCarteira));
  if (!c) throw erro('Carteira não encontrada.', 404);
  if (!NIVEIS_REGRA.includes(r.nivel)) throw erro('Escolha UF, cidade, bairro ou território.');
  const regra = {
    nivel: r.nivel, uf: r.uf ? String(r.uf).toUpperCase() : null, ibge: r.ibge ? String(r.ibge).replace(/\D/g, '') : null,
    bairro_id: r.bairro_id ? String(r.bairro_id) : null, nome: r.nome ? String(r.nome).slice(0, 120) : null, id_territorio: r.id_territorio ? Number(r.id_territorio) : null,
  };
  if (regra.nivel === 'uf' && !/^[A-Z]{2}$/.test(regra.uf || '')) throw erro('UF inválida.');
  if ((regra.nivel === 'cidade' || regra.nivel === 'bairro') && !/^\d{7}$/.test(regra.ibge || '')) throw erro('Cidade inválida.');
  if (regra.nivel === 'bairro' && !regra.bairro_id && !regra.nome) throw erro('Bairro inválido.');
  if (regra.nivel === 'territorio' && !db.prepare('SELECT 1 FROM territorio WHERE id = ?').get(regra.id_territorio)) throw erro('Território não encontrado.');
  if (!regra.uf && regra.ibge) regra.uf = db.prepare('SELECT uf FROM geo_municipio WHERE codigo_ibge = ?').get(regra.ibge)?.uf || null;
  if (!regra.nome) {
    if (regra.nivel === 'cidade') regra.nome = db.prepare('SELECT nome FROM geo_municipio WHERE codigo_ibge = ?').get(regra.ibge)?.nome || regra.ibge;
    if (regra.nivel === 'uf') regra.nome = regra.uf;
    if (regra.nivel === 'territorio') regra.nome = db.prepare('SELECT nome FROM territorio WHERE id = ?').get(regra.id_territorio)?.nome;
    if (regra.nivel === 'bairro') regra.nome = bairrosEmCache(regra.ibge)?.bairros?.find((b) => b.id === regra.bairro_id)?.nome || regra.bairro_id;
  }
  const chave = chaveRegra(regra);
  const atual = db.prepare('SELECT r.*, c.nome AS carteira, v.nome_vendedor FROM carteira_regra r JOIN carteira c ON c.id = r.id_carteira LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor WHERE r.chave = ?').get(chave);
  if (atual && atual.id_carteira === c.id) return { regra: atual, ja_tinha: true };
  if (atual && !mover) {
    throw Object.assign(erro(`${regra.nome} já é da carteira de ${atual.nome_vendedor || atual.carteira}. Confirme para mover.`, 409), { detalhes: { codigo: 'regra_de_outra', id_carteira: atual.id_carteira, carteira: atual.carteira, vendedor: atual.nome_vendedor } });
  }
  transacao(() => {
    if (atual) db.prepare('DELETE FROM carteira_regra WHERE id = ?').run(atual.id);
    db.prepare('INSERT INTO carteira_regra (id_carteira, nivel, chave, uf, ibge, bairro_id, nome, id_territorio, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      c.id, regra.nivel, chave, regra.uf, regra.ibge, regra.bairro_id, regra.nome, regra.id_territorio, agoraISO(),
    );
    db.prepare('UPDATE carteira SET atualizado_em = ? WHERE id IN (?, ?)').run(agoraISO(), c.id, atual?.id_carteira ?? c.id);
  });
  return { regra: db.prepare('SELECT * FROM carteira_regra WHERE chave = ?').get(chave), movida_de: atual ? { id_carteira: atual.id_carteira, vendedor: atual.nome_vendedor } : null };
}

export function removerRegra(idRegra) {
  const r = db.prepare('SELECT * FROM carteira_regra WHERE id = ?').get(Number(idRegra));
  if (!r) throw erro('Regra não encontrada.', 404);
  transacao(() => {
    db.prepare('DELETE FROM carteira_regra WHERE id = ?').run(r.id);
    db.prepare('UPDATE carteira SET atualizado_em = ? WHERE id = ?').run(agoraISO(), r.id_carteira);
  });
  return { ok: true };
}

/** Quem é dono de uma unidade (para o modo "montar carteira" do mapa). */
export function donoDaUnidade(r) {
  const chave = chaveRegra(r);
  return db.prepare('SELECT r.id AS id_regra, r.id_carteira, c.nome AS carteira, c.cor, c.id_vendedor, v.nome_vendedor AS vendedor FROM carteira_regra r JOIN carteira c ON c.id = r.id_carteira LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor WHERE r.chave = ?').get(chave) || null;
}

// ------------------------------------------------------------------ classificação (pipeline)
function carregarRegras() {
  const regras = db.prepare('SELECT r.*, c.id_vendedor FROM carteira_regra r JOIN carteira c ON c.id = r.id_carteira').all();
  const porUf = new Map();
  const porCidade = new Map();
  const porBairro = new Map(); // ibge -> Map(bairro_id -> regra)
  const porBairroNome = new Map(); // ibge -> Map(nome normalizado -> regra)
  const territorios = [];
  for (const r of regras) {
    const n = nivelDaChave(r.chave);
    if (n === 'uf') porUf.set(r.uf, r);
    else if (n === 'cidade') porCidade.set(r.ibge, r);
    else if (n === 'bairro') {
      if (!porBairro.has(r.ibge)) porBairro.set(r.ibge, new Map());
      porBairro.get(r.ibge).set(r.bairro_id, r);
    } else if (n === 'bairro_nome') {
      if (!porBairroNome.has(r.ibge)) porBairroNome.set(r.ibge, new Map());
      porBairroNome.get(r.ibge).set(normalizarTexto(r.nome), r);
    } else if (n === 'territorio') {
      const t = db.prepare('SELECT geometria FROM territorio WHERE id = ?').get(r.id_territorio);
      if (!t) continue;
      const g = JSON.parse(t.geometria);
      const aneis = typeof g[0]?.[0] === 'number' ? [g] : g;
      territorios.push({ regra: r, aneis, caixa: caixaAneis(aneis) });
    }
  }
  // malha dos bairros das cidades com regra de bairro
  const malhas = new Map();
  for (const ibge of porBairro.keys()) {
    const d = bairrosEmCache(ibge);
    if (d?.bairros?.length) {
      malhas.set(ibge, d.bairros.map((b) => {
        const aneis = b.a.map(decodificarAnel);
        const cx = caixaAneis(aneis);
        return { id: b.id, aneis, caixa: cx, x: (cx[0] + cx[2]) / 2, y: (cx[1] + cx[3]) / 2 };
      }));
    }
  }
  return { porUf, porCidade, porBairro, porBairroNome, territorios, malhas };
}

function classificador(R) {
  const dentro = (lng, lat, x) => lng >= x.caixa[0] && lng <= x.caixa[2] && lat >= x.caixa[1] && lat <= x.caixa[3] && dentroAneis(lng, lat, x.aneis);
  return ({ lng, lat, ibge, uf, bairro }) => {
    let bairroId = null;
    if (lng != null && R.malhas.has(ibge)) {
      const bs = R.malhas.get(ibge);
      // a malha do OpenStreetMap nem sempre cobre a cidade toda: fora dela vale o bairro mais próximo
      bairroId = (bs.find((b) => dentro(lng, lat, b)) || bs.reduce((a, b) => ((b.x - lng) ** 2 + (b.y - lat) ** 2 < (a.x - lng) ** 2 + (a.y - lat) ** 2 ? b : a))).id;
    }
    if (lng != null) for (const t of R.territorios) if (dentro(lng, lat, t)) return { regra: t.regra, bairroId };
    if (bairroId && R.porBairro.get(ibge)?.has(bairroId)) return { regra: R.porBairro.get(ibge).get(bairroId), bairroId };
    const nb = R.porBairroNome.get(ibge)?.get(normalizarTexto(bairro));
    if (nb) return { regra: nb, bairroId };
    if (R.porCidade.has(ibge)) return { regra: R.porCidade.get(ibge), bairroId };
    if (R.porUf.has(uf)) return { regra: R.porUf.get(uf), bairroId };
    return { regra: null, bairroId };
  };
}

/** Coloca cada cliente e cada farmácia em exatamente uma carteira. */
export function classificarCarteiras() {
  const R = carregarRegras();
  const qual = classificador(R);
  const clientes = db
    .prepare('SELECT c.id_cliente, c.estado AS uf, c.bairro, g.municipio_ibge AS ibge, g.lng, g.lat FROM dm_cliente c LEFT JOIN cliente_geo g ON g.id_cliente = c.id_cliente')
    .all();
  const farm = db.prepare('SELECT cnpj, uf, bairro, municipio_ibge AS ibge, lng, lat FROM rf_farmacia').all();
  let comDono = 0;
  transacao(() => {
    db.exec('DELETE FROM carteira_cliente; DELETE FROM carteira_farmacia;');
    const sc = db.prepare('INSERT INTO carteira_cliente (id_cliente, id_carteira, id_vendedor, nivel, chave, ibge, bairro_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const c of clientes) {
      const { regra, bairroId } = qual(c);
      if (regra) comDono++;
      sc.run(c.id_cliente, regra?.id_carteira ?? null, regra?.id_vendedor ?? null, regra ? nivelDaChave(regra.chave) : null, regra?.chave ?? null, c.ibge ?? null, bairroId);
    }
    const sf = db.prepare('INSERT INTO carteira_farmacia (cnpj, id_carteira, id_vendedor, nivel, chave, ibge, bairro_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const f of farm) {
      const { regra, bairroId } = qual(f);
      sf.run(f.cnpj, regra?.id_carteira ?? null, regra?.id_vendedor ?? null, regra ? nivelDaChave(regra.chave) : null, regra?.chave ?? null, f.ibge ?? null, bairroId);
    }
  });
  return { clientes: clientes.length, clientes_com_dono: comDono, farmacias: farm.length };
}

// ------------------------------------------------------------------ indicadores (pipeline)
const SEM = { id: null, nome: 'Sem dono' };

/** Hierarquia comercial: vendedor → gerente → coordenador, com nomes de equipe e região. */
export function hierarquia() {
  const pessoas = db.prepare('SELECT id_vendedor AS id, nome_vendedor AS nome, lower(COALESCE(nivel, \'vendedor\')) AS nivel, id_superior, estado, cidade FROM dm_vendedor').all().map((p) => ({ ...p }));
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const equipes = new Map(db.prepare('SELECT * FROM equipe_info').all().map((e) => [e.id_gerente, e]));
  const regioes = db.prepare('SELECT * FROM regiao_info').all().map((r) => ({ ...r, ufs: JSON.parse(r.ufs || '[]') }));
  const regiaoDoCoord = new Map(regioes.map((r) => [r.id_coordenador, r]));
  const subir = (id, nivel) => {
    let p = porId.get(id);
    for (let i = 0; p && i < 5; i++) {
      if (p.nivel === nivel) return p;
      p = porId.get(p.id_superior);
    }
    return null;
  };
  return { pessoas, porId, equipes, regioes, regiaoDoCoord, subir };
}

/** Calcula e grava os indicadores de todas as carteiras e dos níveis acima. */
export function calcularIndicadores() {
  const t0 = Date.now();
  const ref = referenciaVendas();
  const ini = addDias(ref, -89);
  const H = hierarquia();
  const carteiras = db.prepare('SELECT * FROM carteira ORDER BY id').all().map((c) => ({ ...c }));
  const regrasPor = new Map();
  for (const r of db.prepare('SELECT id, id_carteira, nivel, chave, uf, ibge, bairro_id, nome, id_territorio FROM carteira_regra ORDER BY nivel, nome').all()) {
    if (!regrasPor.has(r.id_carteira)) regrasPor.set(r.id_carteira, []);
    regrasPor.get(r.id_carteira).push({ ...r, nivel: nivelDaChave(r.chave) });
  }
  // vendas 90 dias por cliente e vendedor que tirou o pedido
  const vendas = db
    .prepare(
      `SELECT v.id_cliente, v.id_vendedor, SUM(v.valor_total) AS valor, COUNT(DISTINCT v.id_pedido) AS pedidos
         FROM fato_vendas v WHERE v.status = 'Faturado' AND v.data_pedido BETWEEN ? AND ? GROUP BY v.id_cliente, v.id_vendedor`,
    )
    .all(ini, ref);
  const cartCli = new Map(db.prepare('SELECT id_cliente, id_carteira, id_vendedor FROM carteira_cliente').all().map((r) => [r.id_cliente, r]));
  const cli = new Map(db.prepare('SELECT c.id_cliente, c.nome_fantasia AS nome, c.estado AS uf, c.cidade, c.bairro, c.segmento, c.porte, c.id_vendedor FROM dm_cliente c').all().map((r) => [r.id_cliente, r]));
  const ticketUf = new Map();
  const valorCli = new Map();
  for (const v of vendas) valorCli.set(v.id_cliente, (valorCli.get(v.id_cliente) || 0) + v.valor);
  for (const [id, valor] of valorCli) {
    const uf = cli.get(id)?.uf;
    if (!ticketUf.has(uf)) ticketUf.set(uf, []);
    ticketUf.get(uf).push(valor);
  }
  const mediana = (l) => {
    if (!l?.length) return 0;
    const s = [...l].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const ticket = new Map([...ticketUf].map(([uf, l]) => [uf, mediana(l)]));
  const ticketGeral = mediana([...valorCli.values()]);

  // farmácias por carteira (livres = não são clientes; independentes contam no potencial)
  const farm = db
    .prepare(
      `SELECT cf.id_carteira, f.uf, COUNT(*) AS farmacias, SUM(f.id_cliente IS NULL) AS livres,
              SUM(f.id_cliente IS NULL AND (f.rede IS NULL OR f.rede <= 1)) AS livres_indep
         FROM carteira_farmacia cf JOIN rf_farmacia f ON f.cnpj = cf.cnpj GROUP BY cf.id_carteira, f.uf`,
    )
    .all();
  const novo = () => ({ clientes: 0, ativos: 0, venda: 0, venda_dono: 0, venda_outros: 0, fora: 0, farmacias: 0, livres: 0, potencial: 0, invasores: new Map(), clientes_invadidos: [] });
  const ind = new Map(carteiras.map((c) => [c.id, novo()]));
  const semDono = novo();
  const alvo = (id) => (id == null ? semDono : ind.get(id) || semDono);
  for (const f of farm) {
    const a = alvo(f.id_carteira);
    a.farmacias += f.farmacias;
    a.livres += f.livres;
    a.potencial += f.livres_indep * (ticket.get(f.uf) || ticketGeral);
  }
  const donoCart = new Map(carteiras.map((c) => [c.id, c.id_vendedor]));
  const cartDoVend = new Map(carteiras.map((c) => [c.id_vendedor, c.id]));
  for (const [id, c] of cartCli) {
    const a = alvo(c.id_carteira);
    a.clientes++;
    if (valorCli.get(id) > 0) a.ativos++;
  }
  const porCliente = new Map();
  for (const v of vendas) {
    if (!porCliente.has(v.id_cliente)) porCliente.set(v.id_cliente, []);
    porCliente.get(v.id_cliente).push(v);
  }
  for (const [idCli, vs] of porCliente) {
    const cc = cartCli.get(idCli);
    const a = alvo(cc?.id_carteira);
    const dono = cc?.id_carteira != null ? donoCart.get(cc.id_carteira) : null;
    let deOutros = 0;
    const total = vs.reduce((s, v) => s + v.valor, 0);
    for (const v of vs) {
      a.venda += v.valor;
      if (dono != null && v.id_vendedor === dono) a.venda_dono += v.valor;
      else {
        a.venda_outros += v.valor;
        deOutros += v.valor;
        if (dono != null) {
          const inv = a.invasores.get(v.id_vendedor) || { id_vendedor: v.id_vendedor, valor: 0, clientes: new Set() };
          inv.valor += v.valor;
          inv.clientes.add(idCli);
          a.invasores.set(v.id_vendedor, inv);
        }
        // venda do vendedor fora da própria carteira
        const sua = cartDoVend.get(v.id_vendedor);
        if (sua != null && sua !== cc?.id_carteira) ind.get(sua).fora += v.valor;
      }
    }
    if (dono != null && deOutros > 0) {
      const maior = vs.filter((v) => v.id_vendedor !== dono).sort((x, y) => y.valor - x.valor)[0];
      a.clientes_invadidos.push({ id_cliente: idCli, nome: cli.get(idCli)?.nome, valor: r2(total), de_outros: r2(deOutros), pct_outros: r1((deOutros / total) * 100), vendedor_principal: maior.id_vendedor });
    }
  }
  const nome = (id) => H.porId.get(id)?.nome || null;
  const fechar = (a) => ({
    clientes: a.clientes, ativos: a.ativos, venda_90d: r2(a.venda), venda_dono: r2(a.venda_dono), venda_outros: r2(a.venda_outros), venda_fora: r2(a.fora),
    aderencia: a.venda > 0 ? r1((a.venda_dono / a.venda) * 100) : null,
    farmacias: a.farmacias, farmacias_livres: a.livres, potencial_90d: Math.round(a.potencial),
    penetracao: a.farmacias > 0 ? r1((a.ativos / a.farmacias) * 100) : null,
  });
  const linhas = carteiras.map((c) => {
    const a = ind.get(c.id);
    const v = H.porId.get(c.id_vendedor);
    const ger = v ? H.subir(v.id_superior, 'gerente') : null;
    const coord = ger ? H.subir(ger.id_superior, 'coordenador') : null;
    const regras = regrasPor.get(c.id) || [];
    return {
      id: c.id, nome: c.nome, cor: c.cor, nota: c.nota, origem: c.origem,
      vendedor: v ? { id: v.id, nome: v.nome, foto: fotoVendedor(v.id), uf: v.estado, cidade: v.cidade } : null,
      gerente: ger ? { id: ger.id, nome: ger.nome, equipe: H.equipes.get(ger.id)?.nome || `Equipe ${ger.nome}`, foto: fotoVendedor(ger.id) } : null,
      coordenador: coord ? { id: coord.id, nome: coord.nome, regiao: H.regiaoDoCoord.get(coord.id)?.nome || null, foto: fotoVendedor(coord.id) } : null,
      uf: regras.find((r) => r.uf)?.uf || v?.estado || null,
      regras: { total: regras.length, cidades: regras.filter((r) => r.nivel === 'cidade').length, bairros: regras.filter((r) => r.nivel.startsWith('bairro')).length, territorios: regras.filter((r) => r.nivel === 'territorio').length, ufs: regras.filter((r) => r.nivel === 'uf').length },
      ...fechar(a),
      invasores: [...a.invasores.values()].sort((x, y) => y.valor - x.valor).slice(0, 5).map((x) => ({ id_vendedor: x.id_vendedor, nome: nome(x.id_vendedor), foto: fotoVendedor(x.id_vendedor), valor: r2(x.valor), clientes: x.clientes.size })),
      clientes_invadidos: a.clientes_invadidos.sort((x, y) => y.de_outros - x.de_outros).slice(0, 8).map((x) => ({ ...x, vendedor_principal_nome: nome(x.vendedor_principal) })),
    };
  });
  // equilíbrio dentro de cada equipe
  const somar = (lista) => {
    const s = { clientes: 0, ativos: 0, venda_90d: 0, venda_dono: 0, venda_outros: 0, venda_fora: 0, farmacias: 0, farmacias_livres: 0, potencial_90d: 0 };
    for (const l of lista) for (const k of Object.keys(s)) s[k] += l[k] || 0;
    s.venda_90d = r2(s.venda_90d);
    s.venda_dono = r2(s.venda_dono);
    s.venda_outros = r2(s.venda_outros);
    s.venda_fora = r2(s.venda_fora);
    s.aderencia = s.venda_90d > 0 ? r1((s.venda_dono / s.venda_90d) * 100) : null;
    s.penetracao = s.farmacias > 0 ? r1((s.ativos / s.farmacias) * 100) : null;
    s.carteiras = lista.length;
    return s;
  };
  const porEquipe = new Map();
  for (const l of linhas) {
    const k = l.gerente?.id ?? 0;
    if (!porEquipe.has(k)) porEquipe.set(k, []);
    porEquipe.get(k).push(l);
  }
  for (const [, ls] of porEquipe) {
    const mc = ls.reduce((s, l) => s + l.clientes, 0) / ls.length || 1;
    const mp = ls.reduce((s, l) => s + l.potencial_90d, 0) / ls.length || 1;
    for (const l of ls) {
      l.indice_clientes = r2(l.clientes / mc);
      l.indice_potencial = r2(l.potencial_90d / mp);
    }
  }
  const cv = (vals) => {
    const m = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    if (!m) return null;
    return r1((Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) / m) * 100);
  };
  const equipes = [...porEquipe.entries()].map(([idG, ls]) => {
    const g = H.porId.get(idG);
    const coord = g ? H.subir(g.id_superior, 'coordenador') : null;
    return {
      id_gerente: idG || null, nome: H.equipes.get(idG)?.nome || (g ? `Equipe ${g.nome}` : 'Sem equipe'), gerente: g ? { id: g.id, nome: g.nome, foto: fotoVendedor(g.id), cidade: g.cidade, uf: g.estado } : null,
      id_coordenador: coord?.id ?? null, uf: H.equipes.get(idG)?.uf || null, ...somar(ls),
      equilibrio_clientes: cv(ls.map((l) => l.clientes)), equilibrio_potencial: cv(ls.map((l) => l.potencial_90d)),
      carteiras_ids: ls.map((l) => l.id),
    };
  });
  const porCoord = new Map();
  for (const e of equipes) {
    if (!porCoord.has(e.id_coordenador)) porCoord.set(e.id_coordenador, []);
    porCoord.get(e.id_coordenador).push(e);
  }
  const regioes = [...porCoord.entries()].map(([idC, es]) => {
    const c = H.porId.get(idC);
    const reg = H.regiaoDoCoord.get(idC);
    const ls = linhas.filter((l) => es.some((e) => e.carteiras_ids.includes(l.id)));
    return { id: reg?.id || null, nome: reg?.nome || 'Sem região', ufs: reg?.ufs || [], coordenador: c ? { id: c.id, nome: c.nome, foto: fotoVendedor(c.id), cidade: c.cidade, uf: c.estado } : null, ...somar(ls), equipes_ids: es.map((e) => e.id_gerente) };
  });
  const empresa = somar(linhas);
  const sem = fechar(semDono);
  // conferência das somas entre níveis
  const conf = (k) => ({
    campo: k,
    carteiras: r2(linhas.reduce((s, l) => s + (l[k] || 0), 0)),
    equipes: r2(equipes.reduce((s, e) => s + (e[k] || 0), 0)),
    regioes: r2(regioes.reduce((s, r) => s + (r[k] || 0), 0)),
    empresa: r2(empresa[k] || 0),
  });
  const conferencia = ['clientes', 'ativos', 'venda_90d', 'venda_dono', 'farmacias', 'potencial_90d'].map(conf).map((c) => ({ ...c, ok: Math.abs(c.carteiras - c.equipes) < 0.05 && Math.abs(c.equipes - c.regioes) < 0.05 && Math.abs(c.regioes - c.empresa) < 0.05 }));
  // total geral (com e sem dono) bate com a base
  const totalBase = db.prepare("SELECT SUM(valor_total) AS v FROM fato_vendas WHERE status = 'Faturado' AND data_pedido BETWEEN ? AND ?").get(ini, ref).v || 0;
  conferencia.push({ campo: 'venda_90d com e sem dono = base', carteiras: r2(empresa.venda_90d + sem.venda_90d), empresa: r2(totalBase), ok: Math.abs(empresa.venda_90d + sem.venda_90d - totalBase) < 1 });

  const sugestoes = sugerirRebalanceamento({ linhas, equipes, regrasPor, ref, ini });
  // áreas sem dono com mais farmácias (cidades)
  const areasSemDono = db
    .prepare(
      `SELECT cf.ibge, m.nome AS cidade, m.uf, COUNT(*) AS farmacias, SUM(f.id_cliente IS NOT NULL) AS clientes, SUM(f.id_cliente IS NULL AND (f.rede IS NULL OR f.rede <= 1)) AS livres_indep
         FROM carteira_farmacia cf JOIN rf_farmacia f ON f.cnpj = cf.cnpj LEFT JOIN geo_municipio m ON m.codigo_ibge = cf.ibge
        WHERE cf.id_carteira IS NULL AND f.uf IN (SELECT DISTINCT estado FROM dm_cliente)
        GROUP BY cf.ibge ORDER BY clientes DESC, farmacias DESC LIMIT 15`,
    )
    .all()
    .map((r) => ({ ...r, potencial_90d: Math.round(r.livres_indep * (ticket.get(r.uf) || ticketGeral)) }));

  const resultado = {
    referencia: ref, inicio: ini, gerado_em: agoraISO(),
    empresa, sem_dono: { ...sem, areas: areasSemDono }, regioes, equipes, carteiras: linhas, sugestoes, conferencia,
    ticket_referencia: Object.fromEntries([...ticket].map(([uf, t]) => [uf, Math.round(t)])),
    duracao_ms: Date.now() - t0,
  };
  return resultado;
}

/** Sugestões objetivas: unidade a passar entre carteiras desequilibradas e clientes atendidos por outro vendedor. */
function sugerirRebalanceamento({ linhas, equipes, regrasPor }) {
  const out = [];
  const centro = new Map();
  for (const l of linhas) {
    const p = db.prepare('SELECT AVG(g.lat) AS lat, AVG(g.lng) AS lng FROM carteira_cliente cc JOIN cliente_geo g ON g.id_cliente = cc.id_cliente WHERE cc.id_carteira = ?').get(l.id);
    centro.set(l.id, p);
  }
  for (const e of equipes) {
    const ls = linhas.filter((l) => e.carteiras_ids.includes(l.id) && l.clientes > 0);
    if (ls.length < 2) continue;
    const media = ls.reduce((s, l) => s + l.clientes, 0) / ls.length;
    const grandes = ls.filter((l) => l.clientes > media * 1.35).sort((a, b) => b.clientes - a.clientes);
    for (const g of grandes.slice(0, 2)) {
      // unidade da carteira grande mais perto da carteira menor da equipe
      const menor = ls.filter((l) => l.id !== g.id).sort((a, b) => a.clientes - b.clientes)[0];
      const cm = centro.get(menor.id);
      const unidades = (regrasPor.get(g.id) || []).filter((r) => r.nivel !== 'uf').map((r) => {
        const pos = db
          .prepare('SELECT COUNT(*) AS n, AVG(g.lat) AS lat, AVG(g.lng) AS lng FROM carteira_cliente cc JOIN cliente_geo g ON g.id_cliente = cc.id_cliente WHERE cc.chave = ?')
          .get(r.chave);
        return { r, n: pos.n, d: pos.lat != null && cm?.lat != null ? Math.hypot(pos.lat - cm.lat, pos.lng - cm.lng) : Infinity };
      }).filter((u) => u.n > 0 && u.n <= (g.clientes - menor.clientes) / 1.5).sort((a, b) => a.d - b.d);
      const u = unidades[0];
      if (!u) continue;
      out.push({
        tipo: 'mover_area', prioridade: 'media', id_carteira_de: g.id, id_carteira_para: menor.id, id_regra: u.r.id,
        titulo: `Passar ${u.r.nivel === 'cidade' ? 'a cidade' : 'o bairro'} ${u.r.nome} de ${g.vendedor?.nome} para ${menor.vendedor?.nome}`,
        texto: `${g.vendedor?.nome} tem ${g.clientes} clientes, ${Math.round((g.clientes / media - 1) * 100)}% acima da média da equipe ${e.nome}. ${u.r.nome} tem ${u.n} clientes e fica perto da carteira de ${menor.vendedor?.nome}, que tem ${menor.clientes}.`,
      });
    }
  }
  for (const l of linhas) {
    for (const c of l.clientes_invadidos.filter((x) => x.pct_outros >= 70).slice(0, 2)) {
      out.push({
        tipo: 'cliente_de_outro', prioridade: 'alta', id_carteira_de: l.id, id_cliente: c.id_cliente,
        titulo: `${c.nome}: ${c.pct_outros}% das compras com ${c.vendedor_principal_nome}`,
        texto: `O cliente está na carteira de ${l.vendedor?.nome}, mas quem vende para ele é ${c.vendedor_principal_nome}. Alinhe quem atende ou transfira a área.`,
      });
    }
  }
  return out.sort((a, b) => (a.prioridade === 'alta' ? 0 : 1) - (b.prioridade === 'alta' ? 0 : 1)).slice(0, 30);
}

// ------------------------------------------------------------------ leitura (rotas)
export const assinaturaIndicadores = () => `${assinaturaBase()}|${assinaturaCarteiras()}|${db.prepare('SELECT COUNT(*) AS n FROM carteira_cliente').get().n}`;

export function resumoCarteiras() {
  const p = lerPronto('carteiras:resumo');
  return p ? { ...p.conteudo, atualizando: p.assinatura !== assinaturaIndicadores() } : null;
}

export function obterCarteira(id) {
  const c = db.prepare('SELECT * FROM carteira WHERE id = ?').get(Number(id));
  if (!c) return null;
  const v = vendedorInfo(c.id_vendedor);
  const regras = db.prepare('SELECT * FROM carteira_regra WHERE id_carteira = ? ORDER BY nivel, nome').all(c.id).map((r) => ({ ...r, nivel_chave: nivelDaChave(r.chave) }));
  const resumo = resumoCarteiras();
  const ind = resumo?.carteiras?.find((x) => x.id === c.id) || null;
  const prospects = db
    .prepare(
      `SELECT f.cnpj, COALESCE(f.nome_fantasia, f.razao_social) AS nome, f.municipio AS cidade, f.bairro, f.score, f.rede, f.telefone
         FROM carteira_farmacia cf JOIN rf_farmacia f ON f.cnpj = cf.cnpj WHERE cf.id_carteira = ? AND f.id_cliente IS NULL ORDER BY f.score DESC LIMIT 12`,
    )
    .all(c.id);
  return { ...c, vendedor: v ? { id: v.id_vendedor, nome: v.nome_vendedor, foto: fotoVendedor(v.id_vendedor), uf: v.estado, cidade: v.cidade } : null, regras, indicadores: ind, prospects };
}

/** Camada do mapa: dono de cada UF, cidade, bairro e território, com a cor da carteira. */
export function camadaCarteiras() {
  const regras = db.prepare('SELECT r.chave, r.id_carteira, r.uf, r.ibge, r.bairro_id, r.nome, r.id_territorio FROM carteira_regra r').all();
  const cart = db.prepare('SELECT c.id, c.nome, c.cor, c.id_vendedor, v.nome_vendedor FROM carteira c LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor').all();
  const out = { carteiras: cart.map((c) => ({ id: c.id, nome: c.nome, cor: c.cor, id_vendedor: c.id_vendedor, vendedor: c.nome_vendedor, foto: fotoVendedor(c.id_vendedor) })), ufs: {}, cidades: {}, bairros: {}, bairros_nome: {}, territorios: {} };
  for (const r of regras) {
    const n = nivelDaChave(r.chave);
    if (n === 'uf') out.ufs[r.uf] = r.id_carteira;
    else if (n === 'cidade') out.cidades[r.ibge] = { c: r.id_carteira, uf: r.uf };
    else if (n === 'bairro') out.bairros[`${r.ibge}:${r.bairro_id}`] = r.id_carteira;
    else if (n === 'bairro_nome') out.bairros_nome[`${r.ibge}:${normalizarTexto(r.nome)}`] = r.id_carteira;
    else if (n === 'territorio') out.territorios[r.id_territorio] = r.id_carteira;
  }
  return out;
}

/** Carteira de cada farmácia/cliente de uma caixa do mapa (para colorir os pontos). */
export function donosDosPontos(cnpjs = [], clientes = []) {
  const out = {};
  if (cnpjs.length) for (const r of db.prepare(`SELECT cnpj, id_carteira FROM carteira_farmacia WHERE cnpj IN (${cnpjs.map(() => '?').join(',')})`).all(...cnpjs)) out[r.cnpj] = r.id_carteira;
  if (clientes.length) for (const r of db.prepare(`SELECT id_cliente, id_carteira FROM carteira_cliente WHERE id_cliente IN (${clientes.map(() => '?').join(',')})`).all(...clientes)) out[`cli-${r.id_cliente}`] = r.id_carteira;
  return out;
}

/** Etapa da pipeline: classifica e grava os indicadores. */
export function etapaCarteiras() {
  semearCarteiras();
  const cls = classificarCarteiras();
  const r = calcularIndicadores();
  gravarPronto('carteiras:resumo', assinaturaIndicadores(), r, r.duracao_ms);
  return { linhas: cls.clientes + cls.farmacias, detalhes: { ...cls, carteiras: r.carteiras.length, conferencia_ok: r.conferencia.every((c) => c.ok) } };
}
