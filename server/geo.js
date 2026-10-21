import fs from 'node:fs';
import path from 'node:path';
import { db, RAIZ, versaoDados } from './db.js';
import { normalizarCampanha, dataReferencia } from './motor.js';
import { resolverProdutos } from './seletor.js';
import { hojeISO, addDias } from './calendario.js';
import { UFS, NOME_UF, DESCRICAO_CNAE, versaoGeo, garantirMunicipios, pontuarProspect, presencaClientes } from './receita.js';

// =====================================================================
// Mapa comercial: onde vendemos, onde há mercado (farmácias ativas da Receita) e
// onde há potencial que ainda não atendemos — por UF, cidade e ponto.
// =====================================================================

const digitos = (s) => String(s ?? '').replace(/\D+/g, '');
const ph = (arr) => arr.map(() => '?').join(', ');
const ints = (arr) => (arr.length ? arr.map((x) => Math.trunc(Number(x))).join(', ') : '-1');
const r1 = (x) => Math.round(x * 10) / 10;

/** Última data com venda faturada (referência das janelas de 90 dias). */
export function referenciaVendas() {
  return db.prepare("SELECT MAX(data_pedido) AS d FROM fato_vendas WHERE status = 'Faturado'").get()?.d || hojeISO();
}

// ------------------------------------------------------------------ base cartográfica (UFs)
let cacheBase = null;

// d3-geo espera anel externo no sentido horário (o GeoJSON do IBGE segue a regra da mão direita, anti-horário).
function areaAssinada(anel) {
  let s = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) s += (anel[j][0] - anel[i][0]) * (anel[j][1] + anel[i][1]);
  return s / 2; // > 0 = anti-horário (com y para cima, x = longitude)
}
function rebobinarPoligono(aneis) {
  return aneis.map((anel, i) => {
    const horario = areaAssinada(anel) < 0;
    const querHorario = i === 0;
    return horario === querHorario ? anel : [...anel].reverse();
  });
}
const arredondar = (c) => (Array.isArray(c[0]) ? c.map(arredondar) : [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000]);

export function baseUfs() {
  if (cacheBase) return cacheBase;
  const g = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados', 'geo', 'uf.geojson'), 'utf8'));
  cacheBase = {
    type: 'FeatureCollection',
    features: g.features.map((f) => {
      const [uf, nome] = UFS[Number(f.properties.codarea)] || [String(f.properties.codarea), ''];
      const coords = arredondar(f.geometry.coordinates);
      const geometry =
        f.geometry.type === 'Polygon'
          ? { type: 'Polygon', coordinates: rebobinarPoligono(coords) }
          : { type: 'MultiPolygon', coordinates: coords.map(rebobinarPoligono) };
      return { type: 'Feature', properties: { uf, nome, codigo: String(f.properties.codarea) }, geometry };
    }),
  };
  return cacheBase;
}

// ------------------------------------------------------------------ resumo por UF e cidade
// O resumo geral fica gravado em mapa_resumo (etapa "mapa-resumo" do pipeline); a rota só lê o pronto.
// Assinatura estável entre reinícios: muda com nova importação, base da Receita, posições ou o dia.
db.exec(`CREATE TABLE IF NOT EXISTS mapa_resumo (
  chave TEXT PRIMARY KEY,
  assinatura TEXT NOT NULL,
  json TEXT NOT NULL,
  gerado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  ms INTEGER
)`);
const memoResumo = new Map(); // campanha -> { k, assinatura, em, dados }

export function assinaturaMapa() {
  const imp = db.prepare('SELECT MAX(id) AS m FROM importacao').get()?.m ?? 0;
  const f = db.prepare('SELECT COUNT(*) AS n, MAX(rowid) AS m FROM rf_farmacia').get();
  const c = db.prepare('SELECT COUNT(*) AS n, ROUND(SUM(lat) * 1e4) AS a, ROUND(SUM(lng) * 1e4) AS b FROM cliente_geo').get();
  let corr = '';
  try {
    corr = db.prepare("SELECT valor FROM geo_manutencao WHERE chave = 'farmacias'").get()?.valor || '';
  } catch {
    /* tabela criada pelo módulo de malhas */
  }
  return [imp, f.n, f.m, c.n, c.a, c.b, corr, referenciaVendas(), hojeISO()].join('|');
}

function mediana(v) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function distanciaKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const fmtN = (n) => Math.round(n).toLocaleString('pt-BR');
const fmtP = (x) => `${(x ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const fmtR = (n) => (n >= 1e6 ? `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1e3 ? `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : `R$ ${fmtN(n)}`);

/** Produtos (ids) e período de uma campanha, para positivação por cidade. */
function escopoCampanha(id) {
  const row = db.prepare('SELECT id, nome, definicao FROM campanha WHERE id = ?').get(Number(id));
  if (!row) return null;
  const c = normalizarCampanha(JSON.parse(row.definicao));
  const ids = new Set();
  for (const cr of c.criterios) {
    if (cr.metrica === 'combo') for (const it of cr.combo.itens) for (const p of resolverProdutos(it.produtos)) ids.add(p);
    else for (const p of resolverProdutos(cr.produtos)) ids.add(p);
  }
  const col = c.data_base === 'faturamento' ? 'data_faturamento' : 'data_pedido';
  const ref = dataReferencia(col);
  return { id: row.id, nome: row.nome, inicio: c.inicio, fim: c.fim, ate: ref < c.fim ? ref : c.fim, col, status: c.status_venda, produtos: [...ids], iniciada: ref >= c.inicio };
}

/**
 * Resumo do mapa. Potencial = farmácias independentes ainda não atendidas × ticket esperado
 * (mediana do faturamento de 90 dias dos nossos clientes ativos na UF; geral se a UF tiver menos de 8).
 */
export function resumoMapa({ campanha } = {}) {
  const id = String(campanha || '');
  const k = `${versaoDados()}|${versaoGeo()}`;
  const m = memoResumo.get(id);
  if (m && m.k === k && Date.now() - m.em < 15000) return m.dados;
  const assinatura = assinaturaMapa();
  if (m && m.assinatura === assinatura) return Object.assign(m, { k, em: Date.now() }).dados;
  let dados = null;
  if (!id) {
    const row = db.prepare("SELECT assinatura, json FROM mapa_resumo WHERE chave = 'geral'").get();
    if (row?.assinatura === assinatura) dados = JSON.parse(row.json);
  }
  if (!dados) {
    dados = calcularResumoMapa({ campanha: id || null });
    if (!id) gravarLinhaResumo(assinatura, dados, null);
  }
  if (memoResumo.size > 8) memoResumo.clear();
  memoResumo.set(id, { k, assinatura, em: Date.now(), dados });
  return dados;
}

function gravarLinhaResumo(assinatura, dados, ms) {
  db.prepare("INSERT OR REPLACE INTO mapa_resumo (chave, assinatura, json, ms, gerado_em) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))").run('geral', assinatura, JSON.stringify(dados), ms);
}

/** Etapa do pipeline: recalcula e grava o resumo geral do mapa. */
export function gravarResumoMapa() {
  const t0 = Date.now();
  const assinatura = assinaturaMapa();
  const dados = calcularResumoMapa();
  gravarLinhaResumo(assinatura, dados, Date.now() - t0);
  memoResumo.delete('');
  return { linhas: dados.cidades.length, ms: Date.now() - t0 };
}

/** Cálculo completo (sem cache): agregados por cidade e UF, potencial, prioridade e plano de ação. */
export function calcularResumoMapa({ campanha } = {}) {
  garantirMunicipios();
  const ref = referenciaVendas();
  const ha12 = addDias(hojeISO(), -365);

  const municipios = new Map(db.prepare('SELECT codigo_ibge, nome, uf, lat, lng, capital FROM geo_municipio').all().map((m) => [String(m.codigo_ibge), m]));
  const farm = db
    .prepare(
      `SELECT municipio_ibge AS ibge, COUNT(*) AS farmacias, SUM(rede <= 1 OR rede IS NULL) AS independentes,
              SUM(data_inicio >= ?) AS abertas_12m, SUM(cnae = '4771702') AS manipulacao, SUM(id_cliente IS NOT NULL) AS vinculadas
         FROM rf_farmacia WHERE municipio_ibge IS NOT NULL GROUP BY municipio_ibge`,
    )
    .all(ha12);
  const clientes = db
    .prepare(
      `WITH v AS (SELECT id_cliente, SUM(valor_total) AS valor FROM fato_vendas
                   WHERE status = 'Faturado' AND data_pedido > date(?, '-90 day') AND data_pedido <= ? GROUP BY id_cliente)
       SELECT cg.municipio_ibge AS ibge, c.estado AS uf, v.valor
         FROM dm_cliente c JOIN cliente_geo cg ON cg.id_cliente = c.id_cliente LEFT JOIN v ON v.id_cliente = c.id_cliente`,
    )
    .all(ref, ref);

  // campanha (opcional): clientes positivados por cidade
  let camp = null;
  const porCidadeCamp = new Map();
  if (campanha) {
    camp = escopoCampanha(campanha);
    if (camp?.iniciada && camp.produtos.length) {
      const linhas = db
        .prepare(
          `SELECT cg.municipio_ibge AS ibge, COUNT(DISTINCT v.id_cliente) AS positivados, SUM(v.valor_total) AS valor
             FROM fato_vendas v JOIN cliente_geo cg ON cg.id_cliente = v.id_cliente
            WHERE v.${camp.col} BETWEEN ? AND ? AND v.status IN (${ph(camp.status)}) AND v.id_produto IN (${ints(camp.produtos)})
            GROUP BY cg.municipio_ibge`,
        )
        .all(camp.inicio, camp.ate, ...camp.status);
      for (const l of linhas) porCidadeCamp.set(String(l.ibge), l);
    }
  }

  // agrega
  const cid = new Map();
  const obter = (ibge) => {
    let c = cid.get(ibge);
    if (!c) {
      const m = municipios.get(ibge);
      if (!m) return null;
      c = { ibge, nome: m.nome, uf: m.uf, lat: Math.round(m.lat * 1e4) / 1e4, lng: Math.round(m.lng * 1e4) / 1e4, capital: Boolean(m.capital), farmacias: 0, independentes: 0, abertas_12m: 0, manipulacao: 0, clientes: 0, clientes_ativos: 0, valor_90d: 0 };
      cid.set(ibge, c);
    }
    return c;
  };
  for (const f of farm) {
    const c = obter(String(f.ibge));
    if (!c) continue;
    Object.assign(c, { farmacias: f.farmacias, independentes: f.independentes, abertas_12m: f.abertas_12m, manipulacao: f.manipulacao });
  }
  const ticketsUf = new Map();
  const tickets = [];
  for (const cl of clientes) {
    const c = obter(String(cl.ibge));
    if (!c) continue;
    c.clientes++;
    if (cl.valor > 0) {
      c.clientes_ativos++;
      c.valor_90d += cl.valor;
      tickets.push(cl.valor);
      if (!ticketsUf.has(cl.uf)) ticketsUf.set(cl.uf, []);
      ticketsUf.get(cl.uf).push(cl.valor);
    }
  }
  const ticketGeral = mediana(tickets);
  const ticketDaUf = (uf) => (ticketsUf.get(uf)?.length >= 8 ? mediana(ticketsUf.get(uf)) : ticketGeral);
  const ondeVendemos = [...cid.values()].filter((c) => c.clientes_ativos > 0);

  // métricas por cidade
  let maxPot = 0;
  for (const c of cid.values()) {
    c.valor_90d = Math.round(c.valor_90d);
    c.clientes_inativos = c.clientes - c.clientes_ativos;
    c.penetracao = c.farmacias > 0 ? r1((c.clientes_ativos / c.farmacias) * 100) : null;
    c.nao_atendidas = Math.max(0, c.independentes - c.clientes_ativos);
    c.ticket_esperado = Math.round(ticketDaUf(c.uf));
    c.potencial = Math.round(c.nao_atendidas * c.ticket_esperado);
    maxPot = Math.max(maxPot, c.potencial);
    let d = 0;
    if (!c.clientes_ativos) {
      d = Infinity;
      for (const o of ondeVendemos) d = Math.min(d, distanciaKm(c, o));
    }
    c.distancia_km = Number.isFinite(d) ? Math.round(d) : null;
    const cp = porCidadeCamp.get(c.ibge);
    if (camp) c.campanha = { positivados: cp?.positivados || 0, valor: cp?.valor || 0, positivacao: c.clientes ? r1(((cp?.positivados || 0) / c.clientes) * 100) : null };
  }
  for (const c of cid.values()) {
    // prioridade 0–100: potencial (45%), viabilidade logística (25%), mercado em renovação (15%), espaço de penetração (15%)
    const pot = maxPot > 0 ? Math.log1p(c.potencial) / Math.log1p(maxPot) : 0;
    const viab = c.clientes_ativos > 0 ? 1 : c.distancia_km == null ? 0 : Math.exp(-c.distancia_km / 150);
    const novas = c.farmacias ? Math.min(1, c.abertas_12m / c.farmacias / 0.12) : 0;
    const espaco = c.penetracao == null ? 0 : 1 - Math.min(1, c.penetracao / 30);
    c.prioridade = c.farmacias || c.clientes ? Math.round(100 * (0.45 * pot + 0.25 * viab + 0.15 * novas + 0.15 * espaco)) : 0;
    // plano de ação em linguagem de negócio
    if (c.clientes_ativos === 0 && c.clientes > 0) {
      c.acao_tipo = 'reativar';
      c.acao = `Reativar: ${fmtN(c.clientes)} cliente(s) sem compra há 90 dias e ${fmtN(c.nao_atendidas)} independentes livres`;
    } else if (c.clientes === 0) {
      c.acao_tipo = 'expandir';
      c.acao = `Expandir: ${fmtN(c.farmacias)} farmácias (${fmtN(c.independentes)} independentes), nenhum cliente. Potencial de ${fmtR(c.potencial)}/90d${c.distancia_km != null ? `, a ${fmtN(c.distancia_km)} km da nossa área` : ''}`;
    } else if ((c.penetracao ?? 0) >= 30) {
      c.acao_tipo = 'defender';
      c.acao = `Defender: penetração de ${fmtP(c.penetracao)} e ${fmtR(c.valor_90d)} em 90 dias`;
    } else if (c.clientes_inativos >= Math.max(3, c.clientes_ativos * 0.3)) {
      c.acao_tipo = 'reativar';
      c.acao = `Reativar: ${fmtN(c.clientes_inativos)} cliente(s) parados; penetração de ${fmtP(c.penetracao)}`;
    } else {
      c.acao_tipo = 'aprofundar';
      c.acao = `Aprofundar: penetração de ${fmtP(c.penetracao)}, com ${fmtN(c.nao_atendidas)} independentes não atendidas (${fmtR(c.potencial)}/90d)`;
    }
  }

  // UFs
  const ufs = new Map();
  for (const c of cid.values()) {
    if (!ufs.has(c.uf)) ufs.set(c.uf, { uf: c.uf, nome: NOME_UF[c.uf] || c.uf, farmacias: 0, independentes: 0, abertas_12m: 0, clientes: 0, clientes_ativos: 0, valor_90d: 0, potencial: 0, cidades: 0, cidades_com_venda: 0, ...(camp ? { positivados: 0 } : {}) });
    const u = ufs.get(c.uf);
    u.farmacias += c.farmacias;
    u.independentes += c.independentes;
    u.abertas_12m += c.abertas_12m;
    u.clientes += c.clientes;
    u.clientes_ativos += c.clientes_ativos;
    u.valor_90d += c.valor_90d;
    u.potencial += c.potencial;
    u.cidades += c.farmacias > 0 ? 1 : 0;
    u.cidades_com_venda += c.clientes_ativos > 0 ? 1 : 0;
    if (camp) u.positivados += c.campanha.positivados;
  }
  for (const u of ufs.values()) u.penetracao = u.farmacias ? r1((u.clientes_ativos / u.farmacias) * 100) : null;

  const cidades = [...cid.values()].filter((c) => c.farmacias > 0 || c.clientes > 0).sort((a, b) => b.prioridade - a.prioridade);
  const soma = (k) => cidades.reduce((a, c) => a + (c[k] || 0), 0);
  const resultado = {
    referencia: ref,
    ticket_esperado: Math.round(ticketGeral),
    ufs: [...ufs.values()].sort((a, b) => b.farmacias - a.farmacias),
    cidades,
    totais: {
      farmacias: soma('farmacias'),
      independentes: soma('independentes'),
      abertas_12m: soma('abertas_12m'),
      clientes: soma('clientes'),
      clientes_ativos: soma('clientes_ativos'),
      valor_90d: soma('valor_90d'),
      potencial: soma('potencial'),
      cidades_com_venda: cidades.filter((c) => c.clientes_ativos > 0).length,
      cidades_sem_venda: cidades.filter((c) => c.farmacias > 0 && !c.clientes_ativos).length,
    },
    campanha: camp ? { id: camp.id, nome: camp.nome, inicio: camp.inicio, fim: camp.fim, ate: camp.iniciada ? camp.ate : null, iniciada: camp.iniciada, positivados: cidades.reduce((a, c) => a + (c.campanha?.positivados || 0), 0) } : null,
  };
  return resultado;
}

// ------------------------------------------------------------------ pontos (farmácias e clientes) numa área
export function pontosMapa({ bbox, limite = 20000, independentes = false, abertasMeses = 0, prospects = true, clientes = true }) {
  const [oeste, sul, leste, norte] = bbox;
  const ref = referenciaVendas();
  const campos = ['id', 'lat', 'lng', 'tipo', 'rede', 'score', 'nome'];
  const linhas = [];
  const arred = (x) => Math.round(x * 1e5) / 1e5;
  if (clientes) {
    const cl = db
      .prepare(
        `WITH v AS (SELECT id_cliente, SUM(valor_total) AS valor FROM fato_vendas
                     WHERE status = 'Faturado' AND data_pedido > date(?, '-90 day') AND data_pedido <= ? GROUP BY id_cliente)
         SELECT cg.id_cliente, cg.lat, cg.lng, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, v.valor
           FROM cliente_geo cg JOIN dm_cliente c ON c.id_cliente = cg.id_cliente LEFT JOIN v ON v.id_cliente = cg.id_cliente
          WHERE cg.lat BETWEEN ? AND ? AND cg.lng BETWEEN ? AND ?`,
      )
      .all(ref, ref, sul, norte, oeste, leste);
    for (const c of cl) linhas.push([`cli-${c.id_cliente}`, arred(c.lat), arred(c.lng), c.valor > 0 ? 'cliente_ativo' : 'cliente_inativo', null, null, c.nome]);
  }
  let total = 0;
  let truncado = false;
  if (prospects) {
    const where = ['lat BETWEEN ? AND ?', 'lng BETWEEN ? AND ?', 'id_cliente IS NULL'];
    const p = [sul, norte, oeste, leste];
    if (independentes) where.push('(rede <= 1 OR rede IS NULL)');
    if (abertasMeses > 0) {
      where.push('data_inicio >= ?');
      p.push(addDias(hojeISO(), -Math.round(30.44 * abertasMeses)));
    }
    total = db.prepare(`SELECT COUNT(*) AS n FROM rf_farmacia WHERE ${where.join(' AND ')}`).get(...p).n;
    const fa = db
      .prepare(`SELECT cnpj, lat, lng, rede, score, COALESCE(nome_fantasia, razao_social) AS nome FROM rf_farmacia WHERE ${where.join(' AND ')} ORDER BY score DESC LIMIT ?`)
      .all(...p, Math.max(1, Math.min(60000, limite)));
    for (const f of fa) linhas.push([f.cnpj, arred(f.lat), arred(f.lng), 'prospect', f.rede ?? 1, Math.round(f.score), f.nome]);
    truncado = total > fa.length;
  }
  return { campos, linhas, truncado, total_farmacias: total };
}

// ------------------------------------------------------------------ detalhes
function comprasCliente(idCliente) {
  const ref = referenciaVendas();
  const c = db
    .prepare(
      `SELECT c.id_cliente, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.razao_social, c.cnpj, c.segmento, c.porte, c.cidade, c.estado,
              c.bairro, c.rua, c.numero, c.cep, c.id_vendedor, vd.nome_vendedor AS vendedor, vd.telefone AS vendedor_telefone
         FROM dm_cliente c LEFT JOIN dm_vendedor vd ON vd.id_vendedor = c.id_vendedor WHERE c.id_cliente = ?`,
    )
    .get(Number(idCliente));
  if (!c) return null;
  const v = db
    .prepare(
      `SELECT SUM(valor_total) AS valor, COUNT(DISTINCT id_pedido) AS pedidos, COUNT(DISTINCT id_produto) AS skus, MAX(data_pedido) AS ultima
         FROM fato_vendas WHERE id_cliente = ? AND status = 'Faturado' AND data_pedido > date(?, '-90 day') AND data_pedido <= ?`,
    )
    .get(c.id_cliente, ref, ref);
  const ultimaGeral = db.prepare("SELECT MAX(data_pedido) AS d FROM fato_vendas WHERE id_cliente = ? AND status = 'Faturado'").get(c.id_cliente)?.d || null;
  const marcas = db
    .prepare(
      `SELECT p.marca, SUM(v.valor_total) AS valor, SUM(v.quantidade) AS qtd
         FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
        WHERE v.id_cliente = ? AND v.status = 'Faturado' AND v.data_pedido > date(?, '-90 day') AND v.data_pedido <= ?
        GROUP BY p.marca ORDER BY valor DESC LIMIT 6`,
    )
    .all(c.id_cliente, ref, ref);
  const diasSem = ultimaGeral ? Math.round((new Date(`${ref}T00:00:00Z`) - new Date(`${ultimaGeral}T00:00:00Z`)) / 86400000) : null;
  return {
    id: c.id_cliente,
    nome: c.nome,
    razao_social: c.razao_social,
    cnpj: c.cnpj,
    segmento: c.segmento,
    porte: c.porte,
    endereco: [c.rua, c.numero].filter(Boolean).join(', '),
    bairro: c.bairro,
    cidade: c.cidade,
    uf: c.estado,
    cep: c.cep,
    vendedor: c.vendedor,
    vendedor_telefone: c.vendedor_telefone,
    status: v?.valor > 0 ? 'ativo' : 'inativo',
    valor_90d: v?.valor || 0,
    pedidos_90d: v?.pedidos || 0,
    skus_90d: v?.skus || 0,
    ultima_compra: ultimaGeral,
    dias_sem_compra: diasSem,
    top_marcas: marcas.map((m) => ({ ...m })),
    referencia: ref,
  };
}

function resumoCidade(ibge) {
  if (!ibge) return null;
  const c = resumoMapa().cidades.find((x) => x.ibge === String(ibge));
  return c ? { ibge: c.ibge, nome: c.nome, uf: c.uf, farmacias: c.farmacias, independentes: c.independentes, clientes_ativos: c.clientes_ativos, penetracao: c.penetracao, acao: c.acao, prioridade: c.prioridade } : null;
}

export function endereco(f) {
  const rua = [f.tipo_logradouro, f.logradouro].filter(Boolean).join(' ');
  return [rua, f.numero, f.complemento].filter(Boolean).join(', ');
}

/** Detalhe de um ponto do mapa: farmácia (CNPJ) ou nosso cliente ("cli-123"). */
export function detalhePonto(id) {
  const ref = String(id);
  if (ref.startsWith('cli-')) {
    const cli = comprasCliente(ref.slice(4));
    if (!cli) return null;
    const g = db.prepare('SELECT lat, lng, origem, aproximado, municipio_ibge FROM cliente_geo WHERE id_cliente = ?').get(cli.id);
    const rf = db.prepare('SELECT cnpj FROM rf_farmacia WHERE id_cliente = ?').get(cli.id);
    return {
      tipo: 'cliente',
      id: ref,
      nome: cli.nome,
      razao_social: cli.razao_social,
      cnpj: cli.cnpj,
      endereco: cli.endereco,
      bairro: cli.bairro,
      cidade: cli.cidade,
      uf: cli.uf,
      cep: cli.cep,
      lat: g?.lat ?? null,
      lng: g?.lng ?? null,
      aproximado: Boolean(g?.aproximado),
      origem_localizacao: g?.origem || null,
      cnpj_receita: rf?.cnpj || null,
      cliente: cli,
      cidade_resumo: resumoCidade(g?.municipio_ibge),
    };
  }
  const f = db.prepare('SELECT * FROM rf_farmacia WHERE cnpj = ?').get(digitos(ref));
  if (!f) return null;
  const { cidades, ufs } = presencaClientes();
  const hoje = hojeISO();
  const sc = pontuarProspect(f, { cidades, ufs, ha12: addDias(hoje, -365), ha36: addDias(hoje, -365 * 3) });
  const outras = f.cnpj_basico ? db.prepare('SELECT COUNT(*) AS n FROM rf_farmacia WHERE cnpj_basico = ? AND cnpj <> ?').get(f.cnpj_basico, f.cnpj).n : 0;
  return {
    tipo: 'farmacia',
    id: f.cnpj,
    nome: f.nome_fantasia || f.razao_social,
    razao_social: f.razao_social,
    cnpj: f.cnpj,
    matriz: Boolean(f.matriz),
    cnae: f.cnae,
    cnae_descricao: DESCRICAO_CNAE[f.cnae] || f.cnae,
    endereco: endereco(f),
    bairro: f.bairro,
    cidade: f.municipio,
    uf: f.uf,
    cep: f.cep,
    lat: f.lat,
    lng: f.lng,
    aproximado: Boolean(f.aproximado),
    telefone: f.telefone,
    telefone2: f.telefone2,
    email: f.email,
    porte: f.porte,
    capital_social: f.capital_social,
    regime: f.regime,
    abertura: f.data_inicio,
    rede: f.rede ?? 1,
    outras_lojas_na_base: outras,
    filiais: f.filiais,
    socios: f.socios,
    socio_principal: f.socio_principal,
    nota: f.nota,
    score_contato: f.score_contato,
    score: Math.round(f.score),
    score_fatores: sc.fatores,
    cliente: f.id_cliente ? comprasCliente(f.id_cliente) : null,
    cidade_resumo: resumoCidade(f.municipio_ibge),
  };
}

/** Painel de uma cidade: números, bairros, nossos clientes e melhores prospects. */
export function detalheCidade(ibge) {
  const resumo = resumoMapa();
  const c = resumo.cidades.find((x) => x.ibge === String(ibge));
  if (!c) return null;
  const ref = resumo.referencia;
  const bairros = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(bairro), ''), 'Sem bairro') AS bairro, COUNT(*) AS farmacias, SUM(rede <= 1 OR rede IS NULL) AS independentes,
              SUM(id_cliente IS NULL) AS nao_clientes, ROUND(AVG(score)) AS score_medio
         FROM rf_farmacia WHERE municipio_ibge = ? GROUP BY 1 ORDER BY farmacias DESC LIMIT 15`,
    )
    .all(String(ibge))
    .map((b) => ({ ...b }));
  const clientes = db
    .prepare(
      `WITH v AS (SELECT id_cliente, SUM(valor_total) AS valor, MAX(data_pedido) AS ultima FROM fato_vendas
                   WHERE status = 'Faturado' AND data_pedido > date(?, '-90 day') AND data_pedido <= ? GROUP BY id_cliente)
       SELECT c.id_cliente AS id, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.segmento, c.porte, vd.nome_vendedor AS vendedor,
              COALESCE(v.valor, 0) AS valor_90d, v.ultima
         FROM dm_cliente c JOIN cliente_geo cg ON cg.id_cliente = c.id_cliente
         LEFT JOIN v ON v.id_cliente = c.id_cliente LEFT JOIN dm_vendedor vd ON vd.id_vendedor = c.id_vendedor
        WHERE cg.municipio_ibge = ? ORDER BY valor_90d DESC LIMIT 60`,
    )
    .all(ref, ref, String(ibge))
    .map((x) => ({ ...x, status: x.valor_90d > 0 ? 'ativo' : 'inativo' }));
  const vendedores = db
    .prepare(
      `SELECT vd.id_vendedor AS id, vd.nome_vendedor AS nome, COUNT(DISTINCT v.id_cliente) AS clientes, SUM(v.valor_total) AS valor
         FROM fato_vendas v JOIN cliente_geo cg ON cg.id_cliente = v.id_cliente JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor
        WHERE cg.municipio_ibge = ? AND v.status = 'Faturado' AND v.data_pedido > date(?, '-90 day') AND v.data_pedido <= ?
        GROUP BY vd.id_vendedor ORDER BY valor DESC LIMIT 5`,
    )
    .all(String(ibge), ref, ref)
    .map((x) => ({ ...x }));
  const prospects = buscarProspects({ cidade: String(ibge), por_pagina: 10 }).itens;
  return { cidade: c, bairros, clientes, vendedores, prospects, referencia: ref };
}

// ------------------------------------------------------------------ prospecção
function filtrosProspect(f = {}) {
  const where = [];
  const p = [];
  if (!f.incluir_clientes) where.push('id_cliente IS NULL');
  if (f.uf) {
    where.push('uf = ?');
    p.push(String(f.uf).toUpperCase());
  }
  if (f.cidade) {
    if (/^\d{7}$/.test(String(f.cidade))) {
      where.push('municipio_ibge = ?');
      p.push(String(f.cidade));
    } else {
      where.push('municipio = ? COLLATE NOCASE');
      p.push(String(f.cidade));
    }
  }
  if (f.bairro) {
    where.push('bairro LIKE ?');
    p.push(`%${String(f.bairro).trim()}%`);
  }
  if (f.independentes) where.push('(rede <= 1 OR rede IS NULL)');
  if (Number(f.abertas_meses) > 0) {
    where.push('data_inicio >= ?');
    p.push(addDias(hojeISO(), -Math.round(30.44 * Number(f.abertas_meses))));
  }
  if (f.porte) {
    where.push('porte = ?');
    p.push(String(f.porte));
  }
  if (f.cnae) {
    where.push('cnae = ?');
    p.push(String(f.cnae));
  }
  if (Number(f.score_min) > 0) {
    where.push('score >= ?');
    p.push(Number(f.score_min));
  }
  if (f.busca) {
    const d = digitos(f.busca);
    if (d.length >= 5 && d.length === String(f.busca).replace(/[\s./-]/g, '').length) {
      where.push('cnpj LIKE ?');
      p.push(`${d}%`);
    } else {
      where.push('(nome_fantasia LIKE ? OR razao_social LIKE ? OR socio_principal LIKE ?)');
      const t = `%${String(f.busca).trim()}%`;
      p.push(t, t, t);
    }
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
}

const ORDENS = {
  score: 'score DESC, data_inicio DESC',
  abertura: 'data_inicio IS NULL, data_inicio DESC',
  nome: 'COALESCE(nome_fantasia, razao_social) COLLATE NOCASE ASC',
  nota: 'nota DESC, score DESC',
};

function itemProspect(f) {
  return {
    cnpj: f.cnpj,
    nome: f.nome_fantasia || f.razao_social,
    razao_social: f.razao_social,
    cnae: f.cnae,
    cnae_descricao: DESCRICAO_CNAE[f.cnae] || f.cnae,
    endereco: endereco(f),
    bairro: f.bairro,
    cidade: f.municipio,
    municipio_ibge: f.municipio_ibge,
    uf: f.uf,
    cep: f.cep,
    telefone: f.telefone,
    email: f.email,
    porte: f.porte,
    rede: f.rede ?? 1,
    abertura: f.data_inicio,
    nota: f.nota,
    score_contato: f.score_contato,
    socio_principal: f.socio_principal,
    score: Math.round(f.score),
    lat: f.lat,
    lng: f.lng,
    aproximado: Boolean(f.aproximado),
    cliente: f.id_cliente != null,
    id_cliente: f.id_cliente,
  };
}

export function buscarProspects(f = {}) {
  const { where, p } = filtrosProspect(f);
  const porPagina = Math.max(1, Math.min(500, Number(f.por_pagina) || 50));
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const ordem = ORDENS[f.ordenar] || ORDENS.score;
  const ha12 = addDias(hojeISO(), -365);
  const resumo = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(rede <= 1 OR rede IS NULL), 0) AS independentes, COALESCE(SUM(data_inicio >= ?), 0) AS abertas_12m,
              COUNT(DISTINCT municipio_ibge) AS cidades, ROUND(AVG(score), 1) AS score_medio
         FROM rf_farmacia ${where}`,
    )
    .get(ha12, ...p);
  const itens = db
    .prepare(`SELECT * FROM rf_farmacia ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(...p, porPagina, (pagina - 1) * porPagina)
    .map(itemProspect);
  return { total: resumo.total, pagina, por_pagina: porPagina, resumo: { ...resumo }, itens };
}

export function todosProspects(f = {}, limite = 50000) {
  const { where, p } = filtrosProspect(f);
  const ordem = ORDENS[f.ordenar] || ORDENS.score;
  return db.prepare(`SELECT * FROM rf_farmacia ${where} ORDER BY ${ordem} LIMIT ?`).all(...p, limite).map(itemProspect);
}

/** Lista de cidades com farmácias (para filtros), opcionalmente de uma UF. */
export function listarCidades(uf) {
  const where = uf ? 'WHERE uf = ?' : '';
  return db
    .prepare(`SELECT municipio_ibge AS ibge, municipio AS nome, uf, COUNT(*) AS farmacias FROM rf_farmacia ${where} GROUP BY municipio_ibge ORDER BY farmacias DESC`)
    .all(...(uf ? [String(uf).toUpperCase()] : []))
    .map((x) => ({ ...x }));
}
