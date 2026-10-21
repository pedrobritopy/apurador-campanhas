import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { db, agoraISO, transacao, RAIZ } from './db.js';
import { hojeISO, addDias } from './calendario.js';

// =====================================================================
// Farmácias ativas da Receita Federal (Postgres local, banco CNPJ) -> SQLite
// CNAE principal 4771-7/01 (drogarias), 4771-7/02 (manipulação), 4771-7/03 (homeopáticas),
// situação cadastral 2 (ATIVA). Também mantém municípios (lat/lng) e a geolocalização
// dos nossos clientes, usados pelo mapa comercial e pela prospecção.
// =====================================================================

export const CNAES_FARMACIA = ['4771701', '4771702', '4771703'];
export const DESCRICAO_CNAE = {
  4771701: 'Drogaria (sem manipulação)',
  4771702: 'Farmácia de manipulação',
  4771703: 'Farmácia homeopática',
};
const PORTES = { '01': 'ME', '03': 'EPP', '05': 'Demais' };

export const UFS = {
  11: ['RO', 'Rondônia'], 12: ['AC', 'Acre'], 13: ['AM', 'Amazonas'], 14: ['RR', 'Roraima'], 15: ['PA', 'Pará'],
  16: ['AP', 'Amapá'], 17: ['TO', 'Tocantins'], 21: ['MA', 'Maranhão'], 22: ['PI', 'Piauí'], 23: ['CE', 'Ceará'],
  24: ['RN', 'Rio Grande do Norte'], 25: ['PB', 'Paraíba'], 26: ['PE', 'Pernambuco'], 27: ['AL', 'Alagoas'],
  28: ['SE', 'Sergipe'], 29: ['BA', 'Bahia'], 31: ['MG', 'Minas Gerais'], 32: ['ES', 'Espírito Santo'],
  33: ['RJ', 'Rio de Janeiro'], 35: ['SP', 'São Paulo'], 41: ['PR', 'Paraná'], 42: ['SC', 'Santa Catarina'],
  43: ['RS', 'Rio Grande do Sul'], 50: ['MS', 'Mato Grosso do Sul'], 51: ['MT', 'Mato Grosso'], 52: ['GO', 'Goiás'],
  53: ['DF', 'Distrito Federal'],
};
export const NOME_UF = Object.fromEntries(Object.values(UFS));

const COLUNAS_FARMACIA = `
  cnpj TEXT PRIMARY KEY,
  cnpj_basico TEXT,
  razao_social TEXT,
  nome_fantasia TEXT,
  matriz INTEGER,
  cnae TEXT,
  data_inicio TEXT,
  porte TEXT,
  capital_social REAL,
  regime TEXT,
  simples TEXT,
  tipo_logradouro TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, cep TEXT,
  uf TEXT, municipio_rfb TEXT, municipio_ibge TEXT, municipio TEXT,
  telefone TEXT, telefone2 TEXT, email TEXT,
  score_contato INTEGER,
  rede INTEGER,
  filiais INTEGER,
  socios INTEGER,
  socio_principal TEXT,
  nota REAL,
  lat REAL, lng REAL, precisao INTEGER, aproximado INTEGER NOT NULL DEFAULT 0,
  id_cliente INTEGER,
  score REAL NOT NULL DEFAULT 0`;

// a definição antiga (sem coordenadas) saiu de esquema.js; se ela existir, recria
const antiga = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rf_farmacia'").get();
if (antiga && !/\blat REAL\b/.test(antiga.sql)) db.exec('DROP TABLE rf_farmacia');

db.exec(`
CREATE TABLE IF NOT EXISTS rf_farmacia (${COLUNAS_FARMACIA});
CREATE INDEX IF NOT EXISTS ix_rf_farmacia_mun ON rf_farmacia(municipio_ibge);
CREATE INDEX IF NOT EXISTS ix_rf_farmacia_uf ON rf_farmacia(uf, score);
CREATE INDEX IF NOT EXISTS ix_rf_farmacia_pos ON rf_farmacia(lat, lng);
CREATE INDEX IF NOT EXISTS ix_rf_farmacia_cliente ON rf_farmacia(id_cliente);
CREATE INDEX IF NOT EXISTS ix_rf_farmacia_score ON rf_farmacia(score);

CREATE TABLE IF NOT EXISTS geo_municipio (
  codigo_ibge TEXT PRIMARY KEY,
  codigo_rfb TEXT,
  nome TEXT NOT NULL,
  uf TEXT NOT NULL,
  lat REAL, lng REAL,
  capital INTEGER NOT NULL DEFAULT 0,
  chave TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_geo_municipio_chave ON geo_municipio(chave);
CREATE INDEX IF NOT EXISTS ix_geo_municipio_rfb ON geo_municipio(codigo_rfb);

CREATE TABLE IF NOT EXISTS cliente_geo (
  id_cliente INTEGER PRIMARY KEY,
  municipio_ibge TEXT,
  lat REAL, lng REAL,
  origem TEXT,
  aproximado INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_cliente_geo_mun ON cliente_geo(municipio_ibge);
CREATE INDEX IF NOT EXISTS ix_cliente_geo_pos ON cliente_geo(lat, lng);

CREATE TABLE IF NOT EXISTS rf_importacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iniciado_em TEXT NOT NULL,
  concluido_em TEXT,
  competencia TEXT,
  farmacias INTEGER,
  com_coordenadas INTEGER,
  duracao_ms INTEGER,
  status TEXT NOT NULL,
  erro TEXT
);
`);

// ------------------------------------------------------------------ utilidades
export const normalizarTexto = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const chaveCidade = (nome, uf) => `${normalizarTexto(nome)}|${String(uf || '').toUpperCase()}`;
const digitos = (s) => String(s ?? '').replace(/\D+/g, '');

// Versão dos dados geográficos (caches do mapa usam junto com versaoDados()).
let versao = 1;
export const versaoGeo = () => versao;
const ouvintes = new Set();
export const aoMudarGeo = (fn) => ouvintes.add(fn);
function mudou() {
  versao++;
  for (const fn of ouvintes) fn(versao);
}
/** Avisa os caches do mapa que posições ou malhas mudaram (ex.: clientes reposicionados pelo bairro). */
export const notificarMudancaGeo = () => mudou();

// Ajuste fino depois de geolocalizar (o mapa registra o reposicionamento pelos bairros já baixados).
let aposGeolocalizar = null;
export const definirAposGeolocalizar = (fn) => {
  aposGeolocalizar = fn;
};

export const postgresConfigurado = () => Boolean(process.env.POSTGRES_HOST && process.env.POSTGRES_DB && process.env.POSTGRES_USER);

async function conectar() {
  const pg = (await import('pg')).default;
  const c = new pg.Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    statement_timeout: 300000,
    application_name: 'apurador-campanhas',
  });
  await c.connect();
  return c;
}

const ceder = () => new Promise((r) => setImmediate(r));

// ------------------------------------------------------------------ municípios
/** Garante a tabela de municípios (usa o CSV local se o Postgres ainda não foi lido). */
export function garantirMunicipios() {
  if (db.prepare('SELECT COUNT(*) AS n FROM geo_municipio').get().n > 0) return;
  const arq = path.join(RAIZ, 'dados', 'geo', 'municipios.csv');
  if (!fs.existsSync(arq)) return;
  const linhas = parse(fs.readFileSync(arq, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  const st = db.prepare('INSERT OR REPLACE INTO geo_municipio (codigo_ibge, codigo_rfb, nome, uf, lat, lng, capital, chave) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  transacao(() => {
    for (const l of linhas) {
      const uf = UFS[Number(l.codigo_uf)]?.[0];
      if (!uf) continue;
      const rfb = l.siafi_id ? String(l.siafi_id).padStart(4, '0') : null;
      st.run(String(l.codigo_ibge), rfb, l.nome, uf, Number(l.latitude), Number(l.longitude), Number(l.capital) ? 1 : 0, chaveCidade(l.nome, uf));
    }
  });
}

// ------------------------------------------------------------------ geolocalização dos nossos clientes
function hash01(n, semente) {
  let h = (Number(n) * 2654435761 + semente * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

/**
 * Posiciona cada cliente: CEP (centróide real, se o CEP pertencer à cidade) > farmácia da Receita
 * vinculada por CNPJ > centróide da cidade com deslocamento determinístico (marcado como aproximado).
 * @param {Map<number, {lat:number,lng:number,municipio:number}>} [ceps] centróides de CEP vindos do Postgres
 */
export function geolocalizarClientes(ceps = null) {
  garantirMunicipios();
  const municipios = new Map(db.prepare('SELECT codigo_ibge, chave, lat, lng FROM geo_municipio').all().map((m) => [m.chave, m]));
  const viaReceita = new Map(
    db.prepare('SELECT id_cliente, lat, lng FROM rf_farmacia WHERE id_cliente IS NOT NULL AND lat IS NOT NULL AND aproximado = 0').all().map((r) => [r.id_cliente, r]),
  );
  const clientes = db.prepare('SELECT id_cliente, cidade, estado, cep FROM dm_cliente').all();
  const anteriores = new Map(db.prepare("SELECT id_cliente, lat, lng, municipio_ibge FROM cliente_geo WHERE origem = 'cep'").all().map((r) => [r.id_cliente, r]));
  const st = db.prepare('INSERT OR REPLACE INTO cliente_geo (id_cliente, municipio_ibge, lat, lng, origem, aproximado) VALUES (?, ?, ?, ?, ?, ?)');
  let semCidade = 0;
  transacao(() => {
    db.exec('DELETE FROM cliente_geo');
    for (const c of clientes) {
      const m = municipios.get(chaveCidade(c.cidade, c.estado));
      if (!m) {
        semCidade++;
        continue;
      }
      const cep = ceps?.get(Number(digitos(c.cep)));
      const rf = viaReceita.get(c.id_cliente);
      if (cep && String(cep.municipio) === String(m.codigo_ibge)) {
        st.run(c.id_cliente, m.codigo_ibge, cep.lat, cep.lng, 'cep', 0);
      } else if (rf) {
        st.run(c.id_cliente, m.codigo_ibge, rf.lat, rf.lng, 'receita', 0);
      } else if (!ceps && anteriores.get(c.id_cliente)?.municipio_ibge === m.codigo_ibge) {
        const a = anteriores.get(c.id_cliente);
        st.run(c.id_cliente, m.codigo_ibge, a.lat, a.lng, 'cep', 0);
      } else {
        // espalha em volta do centro da cidade (raio de ~1,5 a 6 km), sempre no mesmo lugar para o mesmo cliente
        const ang = hash01(c.id_cliente, 1) * Math.PI * 2;
        const raio = 0.014 + 0.04 * Math.sqrt(hash01(c.id_cliente, 2));
        const lat = m.lat + raio * Math.sin(ang);
        const lng = m.lng + (raio * Math.cos(ang)) / Math.cos((m.lat * Math.PI) / 180);
        st.run(c.id_cliente, m.codigo_ibge, lat, lng, 'cidade', 1);
      }
    }
  });
  try {
    aposGeolocalizar?.();
  } catch (e) {
    console.error('[receita] ajuste de posição pelos bairros:', e.message);
  }
  mudou();
  return { clientes: clientes.length, sem_cidade: semCidade };
}

// ------------------------------------------------------------------ score de prospecção
/**
 * Pontua cada farmácia (0–100) pela atratividade para a distribuidora:
 * independente (30), abertura recente (14), nota de saúde cadastral (20), qualidade do contato (10),
 * porte (8) e proximidade de onde já vendemos (18 se a cidade já tem cliente ativo, 8 se a UF tem).
 */
export function recalcularScores() {
  const linhas = db.prepare('SELECT cnpj, rede, data_inicio, nota, score_contato, porte, municipio_ibge, uf FROM rf_farmacia').all();
  if (!linhas.length) return 0;
  const { cidades, ufs } = presencaClientes();
  const hoje = hojeISO();
  const ha12 = addDias(hoje, -365);
  const ha36 = addDias(hoje, -365 * 3);
  const st = db.prepare('UPDATE rf_farmacia SET score = ? WHERE cnpj = ?');
  transacao(() => {
    for (const f of linhas) st.run(pontuarProspect(f, { cidades, ufs, ha12, ha36 }).total, f.cnpj);
  });
  mudou();
  return linhas.length;
}

export function pontuarProspect(f, ctx) {
  const fatores = [];
  const rede = f.rede ?? 1;
  const pRede = rede <= 1 ? 30 : rede <= 5 ? 18 : rede <= 50 ? 6 : 0;
  fatores.push({ fator: rede <= 1 ? 'Independente' : `Rede com ${rede} lojas`, pontos: pRede, maximo: 30 });
  const pAbre = f.data_inicio && f.data_inicio >= ctx.ha12 ? 14 : f.data_inicio && f.data_inicio >= ctx.ha36 ? 7 : 0;
  fatores.push({ fator: pAbre === 14 ? 'Aberta há menos de 12 meses' : pAbre ? 'Aberta há menos de 3 anos' : 'Loja estabelecida', pontos: pAbre, maximo: 14 });
  const pNota = Math.round(((f.nota ?? 0) / 99) * 20);
  fatores.push({ fator: `${f.nota != null ? `Nota cadastral ${f.nota}/99` : 'Sem nota cadastral'}`, pontos: pNota, maximo: 20 });
  const pContato = Math.round(((f.score_contato ?? 0) / 100) * 10);
  fatores.push({ fator: `Qualidade do contato ${f.score_contato ?? 0}/100`, pontos: pContato, maximo: 10 });
  const pPorte = f.porte === 'ME' ? 4 : f.porte ? 8 : 0;
  fatores.push({ fator: `Porte ${f.porte || 'não informado'}`, pontos: pPorte, maximo: 8 });
  const pProx = ctx.cidades.has(String(f.municipio_ibge)) ? 18 : ctx.ufs.has(f.uf) ? 8 : 0;
  fatores.push({ fator: pProx === 18 ? 'Cidade onde já vendemos' : pProx ? 'UF onde já vendemos' : 'Fora da nossa área atual', pontos: pProx, maximo: 18 });
  return { total: Math.min(100, pRede + pAbre + pNota + pContato + pPorte + pProx), fatores };
}

/** Cidades e UFs com clientes que compraram nos últimos 90 dias (até a última venda carregada). */
export function presencaClientes() {
  const ref = db.prepare("SELECT MAX(data_pedido) AS d FROM fato_vendas WHERE status = 'Faturado'").get()?.d;
  if (!ref) return { cidades: new Set(), ufs: new Set(), ref: null };
  const linhas = db
    .prepare(
      `SELECT DISTINCT cg.municipio_ibge, c.estado
         FROM fato_vendas v JOIN dm_cliente c ON c.id_cliente = v.id_cliente JOIN cliente_geo cg ON cg.id_cliente = v.id_cliente
        WHERE v.status = 'Faturado' AND v.data_pedido > date(?, '-90 day') AND v.data_pedido <= ?`,
    )
    .all(ref, ref);
  return { cidades: new Set(linhas.map((l) => String(l.municipio_ibge))), ufs: new Set(linhas.map((l) => l.estado)), ref };
}

// ------------------------------------------------------------------ importação da Receita
let execucao = null;
const progresso = { fase: null, feitos: 0, total: 0, uf: null, iniciado_em: null, erro: null };

export function statusReceita() {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(aproximado = 0), 0) AS exatas, COALESCE(SUM(rede <= 1 OR rede IS NULL), 0) AS indep FROM rf_farmacia').get();
  const ult = db.prepare("SELECT concluido_em, competencia, duracao_ms FROM rf_importacao WHERE status = 'ok' ORDER BY id DESC LIMIT 1").get();
  return {
    configurada: postgresConfigurado(),
    farmacias: r.n,
    com_coordenadas: r.exatas,
    independentes: r.indep,
    importado_em: ult?.concluido_em || null,
    competencia: ult?.competencia || null,
    duracao_ms: ult?.duracao_ms ?? null,
    importando: Boolean(execucao),
    progresso: execucao ? { ...progresso, percentual: progresso.total ? Math.round((progresso.feitos / progresso.total) * 100) : 0 } : null,
    erro: !execucao ? progresso.erro : null,
  };
}

/** Importa (ou reimporta) as farmácias ativas. Se já houver uma importação rodando, devolve a mesma promessa. */
export function importarReceita() {
  if (!postgresConfigurado()) {
    return Promise.reject(Object.assign(new Error('Postgres da Receita não configurado (POSTGRES_HOST/DB/USER no .env).'), { status: 400 }));
  }
  if (!execucao) {
    execucao = executarImportacao().finally(() => {
      execucao = null;
    });
  }
  return execucao;
}

async function executarImportacao() {
  const inicio = Date.now();
  Object.assign(progresso, { fase: 'conectando', feitos: 0, total: 0, uf: null, iniciado_em: agoraISO(), erro: null });
  const idImp = Number(db.prepare("INSERT INTO rf_importacao (iniciado_em, status) VALUES (?, 'rodando')").run(agoraISO()).lastInsertRowid);
  let cli;
  try {
    cli = await conectar();
    const competencia = (await cli.query('SELECT competencia FROM dw.versao ORDER BY gerada_em DESC LIMIT 1').catch(() => ({ rows: [] }))).rows[0]?.competencia || null;

    // municípios (oficial da base da Receita, com código RFB e IBGE)
    progresso.fase = 'municipios';
    const mun = (await cli.query('SELECT codigo_rfb, codigo_ibge, nome, uf, latitude, longitude, capital FROM ref.municipio_ibge')).rows;
    if (mun.length > 5000) {
      const st = db.prepare('INSERT OR REPLACE INTO geo_municipio (codigo_ibge, codigo_rfb, nome, uf, lat, lng, capital, chave) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      transacao(() => {
        db.exec('DELETE FROM geo_municipio');
        for (const m of mun) st.run(String(m.codigo_ibge).trim(), m.codigo_rfb, m.nome, m.uf, m.latitude, m.longitude, m.capital ? 1 : 0, chaveCidade(m.nome, m.uf));
      });
    }

    // farmácias, uma UF por vez (consulta indexada por cnae+uf)
    progresso.fase = 'farmacias';
    const porUf = (
      await cli.query(
        `SELECT uf, COUNT(*)::int AS n FROM dw.estabelecimentos
          WHERE cnae_principal = ANY($1) AND situacao_cadastral = 2 AND uf IS NOT NULL AND uf <> 'EX'
          GROUP BY uf ORDER BY n DESC`,
        [CNAES_FARMACIA],
      )
    ).rows;
    progresso.total = porUf.reduce((a, r) => a + r.n, 0);

    db.exec(`DROP TABLE IF EXISTS rf_farmacia_carga; CREATE TABLE rf_farmacia_carga (${COLUNAS_FARMACIA});`);
    const ins = db.prepare(`INSERT OR REPLACE INTO rf_farmacia_carga
      (cnpj, cnpj_basico, razao_social, nome_fantasia, matriz, cnae, data_inicio, porte, capital_social, regime, simples,
       tipo_logradouro, logradouro, numero, complemento, bairro, cep, uf, municipio_rfb, municipio_ibge, municipio,
       telefone, telefone2, email, score_contato, rede, filiais, socios, socio_principal, nota, lat, lng, precisao, aproximado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const limpo = (s) => {
      const t = String(s ?? '').trim();
      return t === '' ? null : t;
    };
    for (const { uf } of porUf) {
      progresso.uf = uf;
      const { rows } = await cli.query(
        `SELECT e.cnpj, e.cnpj_basico, e.matriz_filial, e.razao_social, e.nome_fantasia, e.cnae_principal,
                e.data_inicio_atividade::text AS data_inicio, e.porte, e.capital_social::float8 AS capital_social,
                e.regime, e.opcao_simples, e.tipo_logradouro, e.logradouro, e.numero, e.complemento, e.bairro, e.cep,
                e.uf, e.municipio, e.telefone1, e.telefone2, e.email, e.score_contato, e.n_estab_ativos, e.n_filiais_ativas,
                e.n_socios, e.socio_principal, n.nota, g.latitude, g.longitude, g.precisao,
                m.codigo_ibge, m.nome AS municipio_nome, m.latitude AS mlat, m.longitude AS mlng
           FROM dw.estabelecimentos e
           LEFT JOIN dw.estabelecimento_geo g ON g.cnpj = e.cnpj
           LEFT JOIN dw.nota_real n ON n.cnpj = e.cnpj
           LEFT JOIN ref.municipio_ibge m ON m.codigo_rfb = e.municipio
          WHERE e.cnae_principal = ANY($1) AND e.situacao_cadastral = 2 AND e.uf = $2`,
        [CNAES_FARMACIA, uf],
      );
      transacao(() => {
        for (const r of rows) {
          const temGeo = r.latitude != null && r.longitude != null;
          ins.run(
            String(r.cnpj).trim(), limpo(r.cnpj_basico), limpo(r.razao_social), limpo(r.nome_fantasia), r.matriz_filial === 1 ? 1 : 0,
            r.cnae_principal, r.data_inicio, PORTES[r.porte] || null, r.capital_social, limpo(r.regime), limpo(r.opcao_simples),
            limpo(r.tipo_logradouro), limpo(r.logradouro), limpo(r.numero), limpo(r.complemento), limpo(r.bairro), limpo(r.cep),
            r.uf, r.municipio, r.codigo_ibge ? String(r.codigo_ibge).trim() : null, r.municipio_nome,
            limpo(r.telefone1), limpo(r.telefone2), limpo(r.email)?.toLowerCase() ?? null, r.score_contato, r.n_estab_ativos, r.n_filiais_ativas,
            r.n_socios, limpo(r.socio_principal), r.nota,
            temGeo ? r.latitude : r.mlat, temGeo ? r.longitude : r.mlng, r.precisao, temGeo ? 0 : 1,
          );
        }
      });
      progresso.feitos += rows.length;
      await ceder();
    }

    // troca atômica: o mapa nunca fica vazio durante a reimportação
    progresso.fase = 'gravando';
    transacao(() => {
      db.exec('DELETE FROM rf_farmacia');
      db.exec('INSERT INTO rf_farmacia SELECT * FROM rf_farmacia_carga');
      db.exec('DROP TABLE rf_farmacia_carga');
    });
    await ceder();

    // vínculo com nossos clientes pelo CNPJ
    progresso.fase = 'vinculando';
    vincularClientes();

    // geolocalização dos clientes com centróide de CEP (quando o CEP existe e é da mesma cidade)
    progresso.fase = 'geolocalizando';
    const cepsClientes = [...new Set(db.prepare('SELECT cep FROM dm_cliente').all().map((c) => Number(digitos(c.cep))).filter((n) => n > 0))];
    const ceps = new Map();
    if (cepsClientes.length) {
      const { rows } = await cli.query('SELECT cep, municipio, latitude, longitude FROM geo.cep WHERE cep = ANY($1)', [cepsClientes]).catch(() => ({ rows: [] }));
      for (const r of rows) ceps.set(Number(r.cep), { lat: r.latitude, lng: r.longitude, municipio: r.municipio });
    }
    geolocalizarClientes(ceps);

    progresso.fase = 'pontuando';
    recalcularScores();

    const s = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(aproximado = 0), 0) AS exatas FROM rf_farmacia').get();
    const duracao = Date.now() - inicio;
    db.prepare("UPDATE rf_importacao SET concluido_em = ?, competencia = ?, farmacias = ?, com_coordenadas = ?, duracao_ms = ?, status = 'ok' WHERE id = ?").run(
      agoraISO(), competencia, s.n, s.exatas, duracao, idImp,
    );
    progresso.fase = 'concluido';
    mudou();
    // mapa (posições em terra, resumo, bairros, territórios) é recalculado pelo pipeline, em segundo plano
    import('./pipeline.js').then((p) => p.dispararPipeline('receita', { farmacias: s.n })).catch(() => {});
    console.log(`[receita] ${s.n} farmácias ativas importadas (${s.exatas} com coordenada exata) em ${(duracao / 1000).toFixed(1)}s`);
    return { farmacias: s.n, com_coordenadas: s.exatas, sem_coordenadas: s.n - s.exatas, ceps_clientes: ceps.size, competencia, duracao_ms: duracao };
  } catch (e) {
    progresso.erro = e.message;
    db.prepare("UPDATE rf_importacao SET concluido_em = ?, status = 'erro', erro = ?, duracao_ms = ? WHERE id = ?").run(agoraISO(), e.message, Date.now() - inicio, idImp);
    db.exec('DROP TABLE IF EXISTS rf_farmacia_carga');
    console.error('[receita] falha na importação:', e.message);
    throw Object.assign(new Error(`Falha ao importar da Receita: ${e.message}`), { status: 502 });
  } finally {
    await cli?.end().catch(() => {});
  }
}

/** Liga farmácias da Receita aos nossos clientes pelo CNPJ (só dígitos). */
export function vincularClientes() {
  const clientes = db.prepare('SELECT id_cliente, cnpj FROM dm_cliente WHERE cnpj IS NOT NULL').all();
  const up = db.prepare('UPDATE rf_farmacia SET id_cliente = ? WHERE cnpj = ?');
  let vinculadas = 0;
  transacao(() => {
    db.exec('UPDATE rf_farmacia SET id_cliente = NULL WHERE id_cliente IS NOT NULL');
    for (const c of clientes) {
      const d = digitos(c.cnpj);
      if (d.length === 14) vinculadas += Number(up.run(c.id_cliente, d).changes);
    }
  });
  return vinculadas;
}
