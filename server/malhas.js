import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db, RAIZ, transacao } from './db.js';
import { UFS, normalizarTexto, notificarMudancaGeo } from './receita.js';
import { assinaturaMapa } from './geo.js';

// =====================================================================
// Malhas oficiais do mapa, baixadas sob demanda e guardadas em dados/geo/:
//  - limites dos municípios: IBGE, API de malhas v3 (qualidade intermediária), um arquivo por UF;
//  - bairros: IBGE, Censo 2022 (malha de bairros por UF). Onde o IBGE não publica bairros da cidade,
//    usa os limites de bairro do OpenStreetMap (Overpass). Sem nenhuma das duas, a cidade fica sem bairros.
// Coordenadas vão ao navegador como inteiros em 1e-5 grau, com deltas (bem menor que GeoJSON).
// =====================================================================

const PASTA_GEO = path.join(RAIZ, 'dados', 'geo');
const PASTA_MUN = path.join(PASTA_GEO, 'municipios');
const PASTA_BAIRROS = path.join(PASTA_GEO, 'bairros');
const PASTA_BAIRROS_UF = path.join(PASTA_BAIRROS, '_ufs');
const UA = 'apurador-campanhas/1.0 (mapa comercial interno)';

const SIGLA = Object.fromEntries(Object.entries(UFS).map(([codigo, [sigla]]) => [sigla, codigo]));
const ufDoIbge = (ibge) => UFS[Number(String(ibge).slice(0, 2))]?.[0] || null;
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const FONTES = {
  municipios: { rotulo: 'IBGE, malha municipal (API de malhas v3)', licenca: 'Dados públicos do IBGE (uso livre com citação da fonte)', url: 'https://servicodados.ibge.gov.br/api/docs/malhas?versao=3' },
  'ibge-2022': { rotulo: 'IBGE, Censo 2022 (malha de bairros)', licenca: 'Dados públicos do IBGE (uso livre com citação da fonte)', url: 'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/26565-malhas-de-setores-censitarios-divisoes-intramunicipais.html' },
  osm: { rotulo: 'OpenStreetMap (limites de bairro)', licenca: '© colaboradores do OpenStreetMap, licença ODbL', url: 'https://www.openstreetmap.org/copyright' },
};

// ------------------------------------------------------------------ utilidades
async function baixar(url, { timeout = 90000, corpo = null } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: corpo ? 'POST' : 'GET',
      body: corpo,
      headers: { 'User-Agent': UA, ...(corpo ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      signal: ctrl.signal,
    });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} em ${new URL(url).host}`), { status: r.status });
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error(`Tempo esgotado ao baixar de ${new URL(url).host}`), { status: 504 });
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function gravarJson(arq, obj) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, arq);
}

const lerJson = (arq) => JSON.parse(fs.readFileSync(arq, 'utf8'));

/** anel [[lng, lat], ...] -> [x0, y0, dx1, dy1, ...] em inteiros de 1e-5 grau (pontos repetidos saem). */
export function codificarAnel(anel) {
  const out = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of anel) {
    const qx = Math.round(x * 1e5);
    const qy = Math.round(y * 1e5);
    if (out.length && qx === px && qy === py) continue;
    out.push(qx - px, qy - py);
    px = qx;
    py = qy;
  }
  return out;
}

export function decodificarAnel(cod) {
  const anel = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < cod.length; i += 2) {
    x += cod[i];
    y += cod[i + 1];
    anel.push([x / 1e5, y / 1e5]);
  }
  return anel;
}

/** Douglas-Peucker (tolerância em graus) preservando o fechamento do anel. */
function simplificar(anel, tol) {
  if (anel.length <= 8) return anel;
  const t2 = tol * tol;
  const manter = new Uint8Array(anel.length);
  manter[0] = 1;
  manter[anel.length - 1] = 1;
  const pilha = [[0, anel.length - 1]];
  while (pilha.length) {
    const [a, b] = pilha.pop();
    const [ax, ay] = anel[a];
    const [bx, by] = anel[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = anel[i];
      let d;
      if (l2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        d = (px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2;
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > t2 && idx > 0) {
      manter[idx] = 1;
      pilha.push([a, idx], [idx, b]);
    }
  }
  const out = anel.filter((_, i) => manter[i]);
  return out.length >= 4 ? out : anel;
}

/** Ponto dentro de um conjunto de anéis (regra par-ímpar: buracos funcionam sem saber a orientação). */
export function dentroAneis(lng, lat, aneis) {
  let dentro = false;
  for (const anel of aneis) {
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i];
      const [xj, yj] = anel[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
  }
  return dentro;
}

export function caixaAneis(aneis) {
  let o = Infinity;
  let s = Infinity;
  let l = -Infinity;
  let n = -Infinity;
  for (const anel of aneis) {
    for (const [x, y] of anel) {
      if (x < o) o = x;
      if (x > l) l = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [o, s, l, n];
}

// ------------------------------------------------------------------ municípios e UFs (IBGE, malhas v3)
// Dois níveis de detalhe: intermediária (visão de estado e região) e máxima (visão de cidade e bairro).
// Arquivos: dados/geo/municipios/UF.geojson (intermediária, GeoJSON), dados/geo/municipios/maxima/UF.json
// (máxima, compacta e simplificada a ~2 m) e o contorno das UFs em dados/geo/uf-<qualidade>.json.
const QUALIDADES = ['intermediaria', 'maxima'];
const URL_MUNICIPIOS = (uf, q) =>
  `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?formato=application/vnd.geo+json&qualidade=${q}&intrarregiao=municipio`;
const URL_UFS = (q) => `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=${q}&intrarregiao=UF`;
const TOL_MAXIMA = 0.00002;
const baixando = new Map();
const cacheMun = new Map();
const cacheCodificados = new Map();

const aneisDaGeometria = (g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
const umaVez = (chave, fn) => {
  if (!baixando.has(chave)) baixando.set(chave, fn().finally(() => baixando.delete(chave)));
  return baixando.get(chave);
};
const arquivoMalha = (uf, q) => (q === 'maxima' ? path.join(PASTA_MUN, 'maxima', `${uf}.json`) : path.join(PASTA_MUN, `${uf}.geojson`));
const qualidadeValida = (q) => (QUALIDADES.includes(q) ? q : 'intermediaria');

function featuresValidas(g, prefixo, digitos) {
  if (g?.type !== 'FeatureCollection' || !Array.isArray(g.features)) throw erro('Resposta inesperada da API de malhas do IBGE', 502);
  return g.features.filter((f) => {
    const c = String(f.properties?.codarea ?? '');
    return c.length === digitos && /^\d+$/.test(c) && c.startsWith(prefixo) && /Polygon$/.test(f.geometry?.type);
  });
}

/** Garante a malha municipal da UF na qualidade pedida (baixa do IBGE na primeira vez). */
export function garantirMalhaUf(uf, qualidade = 'intermediaria') {
  uf = String(uf || '').toUpperCase();
  if (!SIGLA[uf]) return Promise.reject(erro(`UF inválida: ${uf}`));
  const q = qualidadeValida(qualidade);
  const arq = arquivoMalha(uf, q);
  if (fs.existsSync(arq)) return Promise.resolve(arq);
  return umaVez(`mun:${uf}:${q}`, async () => {
    const g = JSON.parse((await baixar(URL_MUNICIPIOS(uf, q), { timeout: 240000 })).toString('utf8'));
    const feats = featuresValidas(g, SIGLA[uf], 7);
    if (!feats.length) throw erro(`A malha de ${uf} veio vazia`, 502);
    const obtido = new Date().toISOString();
    if (q === 'maxima') {
      gravarJson(arq, {
        uf, fonte: FONTES.municipios.rotulo, qualidade: q, obtido_em: obtido,
        municipios: feats.map((f) => ({ ibge: String(f.properties.codarea), a: aneisDaGeometria(f.geometry).map((r) => codificarAnel(simplificar(r, TOL_MAXIMA))) })),
      });
    } else {
      const arred = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : c.map(arred));
      gravarJson(arq, {
        type: 'FeatureCollection', fonte: FONTES.municipios.rotulo, uf, qualidade: q, obtido_em: obtido,
        features: feats.map((f) => ({ type: 'Feature', properties: { codarea: String(f.properties.codarea) }, geometry: { type: f.geometry.type, coordinates: arred(f.geometry.coordinates) } })),
      });
    }
    return arq;
  });
}

/** Anéis codificados por município de um arquivo de malha (cache por arquivo e data). */
function codificadosUf(uf, q) {
  const arq = arquivoMalha(uf, q);
  if (!fs.existsSync(arq)) return null;
  const mtime = fs.statSync(arq).mtimeMs;
  const chave = `${uf}:${q}`;
  const c = cacheCodificados.get(chave);
  if (c && c.mtime === mtime) return c.mapa;
  const j = lerJson(arq);
  const mapa = new Map(
    q === 'maxima'
      ? j.municipios.map((m) => [m.ibge, m.a])
      : j.features.map((f) => [String(f.properties.codarea), aneisDaGeometria(f.geometry).map(codificarAnel)]),
  );
  cacheCodificados.set(chave, { mtime, mapa });
  return mapa;
}

/** Limites dos municípios de uma UF, prontos para o navegador. */
export async function municipiosUf(uf, { qualidade = 'intermediaria' } = {}) {
  uf = String(uf || '').toUpperCase();
  const q = qualidadeValida(qualidade);
  const arq = await garantirMalhaUf(uf, q);
  const mtime = fs.statSync(arq).mtimeMs;
  const chave = `${uf}:${q}`;
  const c = cacheMun.get(chave);
  if (c && c.mtime === mtime) return c.dados;
  const nomes = new Map(db.prepare('SELECT codigo_ibge, nome FROM geo_municipio WHERE uf = ?').all(uf).map((m) => [String(m.codigo_ibge), m.nome]));
  const dados = {
    uf,
    qualidade: q,
    fonte: FONTES.municipios.rotulo,
    municipios: [...codificadosUf(uf, q).entries()].map(([ibge, a]) => ({ ibge, nome: nomes.get(ibge) || ibge, a })),
  };
  cacheMun.set(chave, { mtime, dados });
  return dados;
}

/** Anéis [lng, lat] de um município no maior detalhe já baixado (síncrono; null se não houver malha local). */
export function aneisMunicipioSync(ibge) {
  const uf = ufDoIbge(ibge);
  if (!uf) return null;
  for (const q of ['maxima', 'intermediaria']) {
    const a = codificadosUf(uf, q)?.get(String(ibge));
    if (a) return a.map(decodificarAnel);
  }
  return null;
}

/** Anéis [lng, lat] de um município (baixa a malha intermediária da UF se faltar). */
export async function aneisMunicipio(ibge) {
  const uf = ufDoIbge(ibge);
  if (!uf) return null;
  await garantirMalhaUf(uf, 'intermediaria');
  return aneisMunicipioSync(ibge);
}

/** Contorno das UFs (litoral e divisas) na qualidade pedida, para o fundo do mapa em zoom maior. */
export function contornoUfs(qualidade = 'intermediaria') {
  const q = qualidadeValida(qualidade);
  const arq = path.join(PASTA_GEO, `uf-${q}.json`);
  if (fs.existsSync(arq)) return Promise.resolve(lerJson(arq));
  return umaVez(`uf:${q}`, async () => {
    const g = JSON.parse((await baixar(URL_UFS(q), { timeout: 120000 })).toString('utf8'));
    const feats = featuresValidas(g, '', 2).filter((f) => UFS[Number(f.properties.codarea)]);
    if (feats.length < 27) throw erro('Contorno das UFs incompleto na resposta do IBGE', 502);
    const d = {
      qualidade: q, fonte: FONTES.municipios.rotulo, obtido_em: new Date().toISOString(),
      ufs: feats.map((f) => ({ uf: UFS[Number(f.properties.codarea)][0], a: aneisDaGeometria(f.geometry).map((r) => codificarAnel(q === 'maxima' ? simplificar(r, TOL_MAXIMA) : r)) })),
    };
    gravarJson(arq, d);
    return d;
  });
}

// ------------------------------------------------------------------ zip + shapefile (sem dependências)
const LIMITE_DESCOMPACTADO = 400 * 1024 * 1024;

function lerZip(buf) {
  let fimDir = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fimDir = i;
      break;
    }
  }
  if (fimDir < 0) throw erro('Arquivo zip inválido', 502);
  const n = buf.readUInt16LE(fimDir + 10);
  let o = buf.readUInt32LE(fimDir + 16);
  const arquivos = new Map();
  let total = 0;
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw erro('Diretório do zip corrompido', 502);
    const metodo = buf.readUInt16LE(o + 10);
    const tamComp = buf.readUInt32LE(o + 20);
    const tam = buf.readUInt32LE(o + 24);
    const lNome = buf.readUInt16LE(o + 28);
    const lExtra = buf.readUInt16LE(o + 30);
    const lComent = buf.readUInt16LE(o + 32);
    const local = buf.readUInt32LE(o + 42);
    const nome = buf.toString('utf8', o + 46, o + 46 + lNome);
    o += 46 + lNome + lExtra + lComent;
    total += tam;
    if (total > LIMITE_DESCOMPACTADO) throw erro('Zip grande demais', 502);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw erro('Cabeçalho local do zip inválido', 502);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamComp);
    if (metodo === 0) arquivos.set(nome, dados);
    else if (metodo === 8) arquivos.set(nome, zlib.inflateRawSync(dados, { maxOutputLength: Math.max(1, tam) }));
  }
  return arquivos;
}

function lerDbf(buf, codificacao = 'utf8') {
  const n = buf.readUInt32LE(4);
  const tamCab = buf.readUInt16LE(8);
  const tamReg = buf.readUInt16LE(10);
  const campos = [];
  for (let o = 32; o < tamCab - 1 && buf[o] !== 0x0d; o += 32) {
    campos.push({ nome: buf.toString('latin1', o, o + 11).replace(/\0.*$/s, ''), tam: buf[o + 16] });
  }
  const regs = [];
  for (let i = 0; i < n; i++) {
    let o = tamCab + i * tamReg + 1;
    const r = {};
    for (const c of campos) {
      r[c.nome] = buf.toString(codificacao, o, o + c.tam).trim();
      o += c.tam;
    }
    regs.push(r);
  }
  return regs;
}

/** Polígonos de um .shp (tipos 5, 15, 25). Devolve um array de anéis por registro (null se vazio). */
function lerShp(buf) {
  const regs = [];
  let o = 100;
  while (o + 12 <= buf.length) {
    const tam = buf.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const tipo = buf.readInt32LE(c);
    if (tipo === 5 || tipo === 15 || tipo === 25) {
      const nPartes = buf.readInt32LE(c + 36);
      const nPontos = buf.readInt32LE(c + 40);
      const p0 = c + 44 + nPartes * 4;
      const aneis = [];
      for (let i = 0; i < nPartes; i++) {
        const ini = buf.readInt32LE(c + 44 + i * 4);
        const fim = i + 1 < nPartes ? buf.readInt32LE(c + 48 + i * 4) : nPontos;
        const anel = [];
        for (let j = ini; j < fim; j++) anel.push([buf.readDoubleLE(p0 + j * 16), buf.readDoubleLE(p0 + j * 16 + 8)]);
        if (anel.length >= 4) aneis.push(anel);
      }
      regs.push(aneis.length ? aneis : null);
    } else regs.push(null);
    o = c + tam;
  }
  return regs;
}

// ------------------------------------------------------------------ bairros: IBGE (Censo 2022)
const URL_BAIRROS_UF = (uf) =>
  `https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/UF/${uf}_bairros_CD2022.zip`;
const processandoUf = new Map();
const TOL_BAIRRO = 0.00003; // ~3 m: invisível no zoom máximo do mapa e corta bem o tamanho

/** Baixa a malha de bairros da UF (uma vez) e grava um arquivo por município em dados/geo/bairros/. */
function garantirBairrosIbgeUf(uf) {
  const indice = path.join(PASTA_BAIRROS_UF, `${uf}.json`);
  if (fs.existsSync(indice)) return Promise.resolve(lerJson(indice));
  if (!processandoUf.has(uf)) {
    const p = (async () => {
      let buf;
      try {
        buf = await baixar(URL_BAIRROS_UF(uf), { timeout: 180000 });
      } catch (e) {
        if (e.status === 404) {
          const vazio = { uf, fonte: 'ibge-2022', processado_em: new Date().toISOString(), municipios: [] };
          gravarJson(indice, vazio);
          return vazio;
        }
        throw e;
      }
      const arqs = lerZip(buf);
      const achar = (ext) => [...arqs.entries()].find(([n]) => n.toLowerCase().endsWith(ext))?.[1];
      const shp = achar('.shp');
      const dbf = achar('.dbf');
      if (!shp || !dbf) throw erro(`Malha de bairros de ${uf} sem .shp/.dbf`, 502);
      const cpg = achar('.cpg')?.toString('latin1').trim().toUpperCase();
      const atributos = lerDbf(dbf, cpg === 'UTF-8' || cpg === 'UTF8' ? 'utf8' : 'latin1');
      const formas = lerShp(shp);
      const porMun = new Map();
      for (let i = 0; i < atributos.length; i++) {
        const a = atributos[i];
        const aneis = formas[i];
        if (!aneis || !/^\d{7}$/.test(a.CD_MUN)) continue;
        if (!porMun.has(a.CD_MUN)) porMun.set(a.CD_MUN, []);
        porMun.get(a.CD_MUN).push({ id: a.CD_BAIRRO || `${a.CD_MUN}-${i}`, nome: a.NM_BAIRRO || 'Bairro sem nome', a: aneis.map((r) => codificarAnel(simplificar(r, TOL_BAIRRO))) });
      }
      const agora = new Date().toISOString();
      for (const [ibge, bairros] of porMun) {
        bairros.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
        gravarJson(path.join(PASTA_BAIRROS, `${ibge}.json`), { ibge, fonte: 'ibge-2022', obtido_em: agora, bairros });
      }
      const ind = { uf, fonte: 'ibge-2022', processado_em: agora, municipios: [...porMun.keys()].sort() };
      gravarJson(indice, ind);
      return ind;
    })().finally(() => processandoUf.delete(uf));
    processandoUf.set(uf, p);
  }
  return processandoUf.get(uf);
}

// ------------------------------------------------------------------ bairros: OpenStreetMap (Overpass)
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let filaOsm = Promise.resolve();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarOverpass(consulta) {
  let ultimo;
  for (let tentativa = 0; tentativa < OVERPASS.length * 2; tentativa++) {
    const url = OVERPASS[tentativa % OVERPASS.length];
    try {
      const buf = await baixar(url, { timeout: 120000, corpo: `data=${encodeURIComponent(consulta)}` });
      return JSON.parse(buf.toString('utf8'));
    } catch (e) {
      ultimo = e;
      await esperar(1500 * (tentativa + 1));
    }
  }
  throw Object.assign(new Error(`O OpenStreetMap não respondeu agora (${ultimo?.message || 'erro'}). Tente de novo em instantes.`), { status: 503, temporario: true });
}

const igualPt = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const fechado = (r) => r.length > 3 && igualPt(r[0], r[r.length - 1]);

/** Junta os caminhos (ways) de uma relação em anéis fechados. */
function montarAneis(caminhos) {
  const resto = caminhos.filter((w) => w.length > 1).map((w) => w.slice());
  const aneis = [];
  while (resto.length) {
    let anel = resto.shift();
    for (let guarda = 0; !fechado(anel) && guarda < 5000; guarda++) {
      const fim = anel[anel.length - 1];
      const i = resto.findIndex((w) => igualPt(w[0], fim) || igualPt(w[w.length - 1], fim));
      if (i < 0) break;
      let w = resto.splice(i, 1)[0];
      if (!igualPt(w[0], fim)) w = w.reverse();
      anel = anel.concat(w.slice(1));
    }
    if (fechado(anel) && anel.length >= 4) aneis.push(anel);
  }
  return aneis;
}

async function bairrosOsm(ibge, limiteMun) {
  // Brasília ocupa o DF inteiro: no OpenStreetMap a área é a da UF e as divisões são as regiões administrativas
  const df = ibge === '5300108';
  const consulta = `[out:json][timeout:100];
area["IBGE:GEOCODIGO"="${df ? '53' : ibge}"]->.m;
(relation["boundary"="administrative"]["admin_level"~"^(${df ? '8|9|10' : '9|10'})$"](area.m);
 relation["type"="multipolygon"]["place"~"^(suburb|neighbourhood|quarter)$"](area.m);
 relation["boundary"="place"]["place"~"^(suburb|neighbourhood|quarter)$"](area.m););
out geom;`;
  const j = await consultarOverpass(consulta);
  const candidatos = [];
  for (const e of j.elements || []) {
    if (e.type !== 'relation' || !e.tags?.name) continue;
    const caminhos = (e.members || []).filter((m) => m.type === 'way' && Array.isArray(m.geometry) && (m.role === 'outer' || m.role === 'inner' || m.role === '')).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
    const aneis = montarAneis(caminhos);
    if (!aneis.length) continue;
    // a área do município pega bairros vizinhos que encostam na divisa: fica só quem tem o centro dentro da cidade
    const [o, s, l, n] = caixaAneis(aneis);
    if (limiteMun && !dentroAneis((o + l) / 2, (s + n) / 2, limiteMun) && !dentroAneis(aneis[0][0][0], aneis[0][0][1], limiteMun)) continue;
    const nivel = e.tags.admin_level === '10' ? 'n10' : e.tags.admin_level === '9' ? 'n9' : e.tags.admin_level === '8' ? 'n8' : 'place';
    candidatos.push({ id: `osm-${e.id}`, nome: e.tags.name, nivel, a: aneis.map((r) => codificarAnel(simplificar(r, TOL_BAIRRO))) });
  }
  // usa o nível mais fino que realmente cobre a cidade (bairro > região administrativa > lugar)
  const por = (nv) => candidatos.filter((c) => c.nivel === nv);
  const escolhidos = por('n10').length >= 3 ? por('n10') : por('n9').length >= 2 ? por('n9') : por('n8').length >= 3 ? por('n8') : por('place').length >= 3 ? por('place') : [...por('n10'), ...por('n9')];
  return escolhidos.map(({ nivel, ...b }) => b).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
}

// ------------------------------------------------------------------ bairros: entrada única
const buscandoBairros = new Map();

/**
 * Bairros de um município: IBGE 2022 > OpenStreetMap > nenhum. Resultado fica em cache
 * (inclusive "não tem"); `atualizar` refaz a busca no OpenStreetMap.
 * @returns {Promise<{ibge:string, fonte:string|null, obtido_em:string, bairros:Array<{id:string,nome:string,a:number[][]}>}>}
 */
export function bairrosMunicipio(ibge, { atualizar = false } = {}) {
  ibge = String(ibge);
  if (!/^\d{7}$/.test(ibge)) return Promise.reject(erro('Código IBGE inválido'));
  const uf = ufDoIbge(ibge);
  if (!uf) return Promise.reject(erro('Município desconhecido', 404));
  const arq = path.join(PASTA_BAIRROS, `${ibge}.json`);
  if (!atualizar && fs.existsSync(arq)) return Promise.resolve(lerJson(arq));
  if (buscandoBairros.has(ibge)) return buscandoBairros.get(ibge);
  const p = (async () => {
    // IBGE fora do ar não impede o OpenStreetMap, mas aí o "não tem bairros" não fica guardado
    let ind = null;
    let ibgeFalhou = null;
    try {
      ind = await garantirBairrosIbgeUf(uf);
    } catch (e) {
      ibgeFalhou = e;
    }
    if (ind?.municipios.includes(ibge) && fs.existsSync(arq)) {
      const d = lerJson(arq);
      if (d.fonte === 'ibge-2022') return d;
    }
    // sem bairros no IBGE: OpenStreetMap, um pedido por vez (o serviço é público e compartilhado)
    const limite = await aneisMunicipio(ibge).catch(() => null);
    const tarefa = filaOsm.then(() => bairrosOsm(ibge, limite));
    filaOsm = tarefa.catch(() => {}).then(() => esperar(1200));
    const bairros = await tarefa;
    const d = { ibge, fonte: bairros.length ? 'osm' : null, obtido_em: new Date().toISOString(), bairros };
    if (bairros.length || !ibgeFalhou) gravarJson(arq, d);
    else d.aviso = 'O site de malhas do IBGE não respondeu agora; tente de novo mais tarde.';
    return d;
  })().finally(() => buscandoBairros.delete(ibge));
  buscandoBairros.set(ibge, p);
  return p;
}

/** Só lê o cache (não baixa nada). */
export function bairrosEmCache(ibge) {
  const arq = path.join(PASTA_BAIRROS, `${ibge}.json`);
  return fs.existsSync(arq) ? lerJson(arq) : null;
}

// ------------------------------------------------------------------ posições sempre em terra
function hash01(n, semente) {
  let h = (Number(n) * 2654435761 + semente * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const M_POR_GRAU = 111320;

/** Ponto determinístico dentro dos anéis (e dentro de `limite`, se houver): sorteio no miolo da caixa. */
function pontoDentro(aneis, id, limite = null) {
  const [o, s, l, n] = caixaAneis(aneis);
  const cx = (o + l) / 2;
  const cy = (s + n) / 2;
  for (let i = 0; i < 160; i++) {
    const f = i < 60 ? 0.5 : 1;
    const x = cx + (hash01(id, 11 + i) - 0.5) * (l - o) * f;
    const y = cy + (hash01(id, 397 + i) - 0.5) * (n - s) * f;
    if (dentroAneis(x, y, aneis) && (!limite || dentroAneis(x, y, limite))) return [x, y];
  }
  return null;
}

/** Ponto mais próximo na borda dos anéis (em graus) e a distância em metros. */
function maisProximoNaBorda(lng, lat, aneis) {
  const kx = Math.cos((lat * Math.PI) / 180);
  let melhor = null;
  let dMin = Infinity;
  for (const anel of aneis) {
    for (let i = 1; i < anel.length; i++) {
      const [ax, ay] = anel[i - 1];
      const [bx, by] = anel[i];
      const dx = (bx - ax) * kx;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, (((lng - ax) * kx) * dx + (lat - ay) * dy) / l2)) : 0;
      const px = ax + (bx - ax) * u;
      const py = ay + (by - ay) * u;
      const d = ((lng - px) * kx) ** 2 + (lat - py) ** 2;
      if (d < dMin) {
        dMin = d;
        melhor = [px, py];
      }
    }
  }
  return melhor ? { ponto: melhor, metros: Math.sqrt(dMin) * M_POR_GRAU } : null;
}

/** Empurra um ponto da borda para dentro (até ~60 m), testando direções em volta. */
function paraDentro([bx, by], [ox, oy], aneis) {
  const kx = Math.cos((by * Math.PI) / 180);
  let ang = Math.atan2((by - oy), (bx - ox) * kx);
  for (const passo of [12, 25, 45, 70]) {
    for (let k = 0; k < 12; k++) {
      const a = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      const x = bx + (Math.cos(a) * passo) / (M_POR_GRAU * kx);
      const y = by + (Math.sin(a) * passo) / M_POR_GRAU;
      if (dentroAneis(x, y, aneis)) return [x, y];
    }
    ang += 0;
  }
  return null;
}

db.exec(`
CREATE TABLE IF NOT EXISTS rf_correcao_geo (
  cnpj TEXT PRIMARY KEY,
  municipio_ibge TEXT,
  lat_original REAL, lng_original REAL,
  lat REAL, lng REAL,
  distancia_m REAL,
  motivo TEXT,
  corrigido_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

const ufsComMalha = () => Object.keys(SIGLA).filter((uf) => fs.existsSync(arquivoMalha(uf, 'maxima')) || fs.existsSync(arquivoMalha(uf, 'intermediaria')));

/**
 * Farmácias da Receita cuja coordenada caiu fora do próprio município (mar, rio ou cidade vizinha):
 * até 3 km da divisa, vão para o ponto de terra mais próximo dentro do município; mais longe que isso,
 * a coordenada é tratada como erro de geocodificação e vira um ponto aproximado dentro da cidade.
 * Usa a malha mais detalhada disponível. Tudo fica registrado em rf_correcao_geo.
 */
export function corrigirFarmaciasForaDoMunicipio({ ufs = ufsComMalha() } = {}) {
  const resultado = { verificadas: 0, ajustadas_borda: 0, reposicionadas: 0, sem_malha: 0 };
  const stF = db.prepare('UPDATE rf_farmacia SET lat = ?, lng = ?, aproximado = ? WHERE cnpj = ?');
  const stR = db.prepare('INSERT OR REPLACE INTO rf_correcao_geo (cnpj, municipio_ibge, lat_original, lng_original, lat, lng, distancia_m, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const uf of ufs) {
    const farm = db.prepare('SELECT cnpj, municipio_ibge, lat, lng, aproximado FROM rf_farmacia WHERE uf = ? AND lat IS NOT NULL ORDER BY municipio_ibge').all(uf);
    const porMun = new Map();
    for (const f of farm) {
      if (!porMun.has(f.municipio_ibge)) porMun.set(f.municipio_ibge, []);
      porMun.get(f.municipio_ibge).push(f);
    }
    transacao(() => {
      for (const [ibge, lista] of porMun) {
        const aneis = aneisMunicipioSync(ibge);
        if (!aneis) {
          resultado.sem_malha += lista.length;
          continue;
        }
        const [o, s, l, n] = caixaAneis(aneis);
        for (const f of lista) {
          resultado.verificadas++;
          if (f.lng >= o && f.lng <= l && f.lat >= s && f.lat <= n && dentroAneis(f.lng, f.lat, aneis)) continue;
          const b = maisProximoNaBorda(f.lng, f.lat, aneis);
          let novo = null;
          let motivo = 'fora do município';
          let aprox = f.aproximado;
          if (b && b.metros <= 3000) {
            novo = paraDentro(b.ponto, [f.lng, f.lat], aneis);
            motivo = 'perto da divisa ou do litoral';
          }
          if (!novo) {
            novo = pontoDentro(aneis, Number(String(f.cnpj).slice(-9)));
            aprox = 1;
            motivo = 'coordenada longe da cidade do endereço';
          }
          if (!novo) continue;
          stF.run(r6(novo[1]), r6(novo[0]), aprox, f.cnpj);
          stR.run(f.cnpj, ibge, f.lat, f.lng, r6(novo[1]), r6(novo[0]), b ? Math.round(b.metros) : null, motivo);
          if (aprox === f.aproximado) resultado.ajustadas_borda++;
          else resultado.reposicionadas++;
        }
      }
    });
  }
  if (resultado.ajustadas_borda || resultado.reposicionadas) notificarMudancaGeo();
  return resultado;
}

/**
 * Posição dos nossos clientes sem endereço geocodificado (aproximados). Sempre em terra, na cidade certa:
 * 1) bairro do cadastro casado com a malha de bairros: uma farmácia real (Receita) dentro desse bairro;
 * 2) bairro casado pelo nome do bairro das farmácias da Receita na mesma cidade;
 * 3) uma farmácia real da cidade ainda não usada como âncora;
 * 4) ponto sorteado dentro do bairro ou do município (teste ponto no polígono).
 * Continua marcado como aproximado (origem 'bairro' ou 'cidade').
 */
export function reposicionarClientes({ cidades = null } = {}) {
  const filtro = cidades?.length ? `AND cg.municipio_ibge IN (${cidades.map((c) => `'${String(c).replace(/\D/g, '')}'`).join(', ')})` : '';
  const lista = db
    .prepare(`SELECT cg.id_cliente, cg.municipio_ibge AS ibge, cg.lat, cg.lng, cg.origem, c.bairro FROM cliente_geo cg JOIN dm_cliente c ON c.id_cliente = cg.id_cliente WHERE cg.aproximado = 1 ${filtro} ORDER BY cg.id_cliente`)
    .all();
  const grupos = new Map();
  for (const c of lista) {
    if (!grupos.has(c.ibge)) grupos.set(c.ibge, []);
    grupos.get(c.ibge).push(c);
  }
  const r = { clientes: lista.length, farmacia_do_bairro: 0, bairro_pelo_nome: 0, farmacia_da_cidade: 0, dentro_do_poligono: 0, sem_malha: 0, movidos: 0 };
  const st = db.prepare('UPDATE cliente_geo SET lat = ?, lng = ?, origem = ?, aproximado = 1 WHERE id_cliente = ?');
  transacao(() => {
    for (const [ibge, cls] of grupos) {
      const mun = aneisMunicipioSync(ibge);
      // âncoras: farmácias reais da cidade, ainda não clientes, com coordenada dentro do município
      const farm = db
        .prepare('SELECT cnpj, lat, lng, bairro FROM rf_farmacia WHERE municipio_ibge = ? AND aproximado = 0 AND id_cliente IS NULL AND lat IS NOT NULL ORDER BY cnpj')
        .all(String(ibge))
        .filter((f) => !mun || dentroAneis(f.lng, f.lat, mun))
        .map((f) => ({ ...f, nb: normalizarTexto(f.bairro) }));
      const bairros = bairrosEmCache(ibge)?.bairros || [];
      const porNome = new Map(bairros.map((b) => [normalizarTexto(b.nome), b]));
      const usadas = new Set();
      const escolher = (cands, id) => {
        if (!cands.length) return null;
        const ini = Math.floor(hash01(id, 7) * cands.length);
        for (let k = 0; k < cands.length; k++) {
          const f = cands[(ini + k) % cands.length];
          if (!usadas.has(f.cnpj)) {
            usadas.add(f.cnpj);
            return f;
          }
        }
        return null;
      };
      for (const c of cls) {
        const nb = normalizarTexto(c.bairro);
        const b = nb ? porNome.get(nb) : null;
        let pos = null;
        let origem = 'cidade';
        if (b) {
          const an = b.a.map(decodificarAnel);
          const [o, s, l, n] = caixaAneis(an);
          const f = escolher(farm.filter((x) => x.lng >= o && x.lng <= l && x.lat >= s && x.lat <= n && dentroAneis(x.lng, x.lat, an)), c.id_cliente);
          if (f) {
            pos = [f.lng, f.lat];
            r.farmacia_do_bairro++;
          } else {
            pos = pontoDentro(an, c.id_cliente, mun);
            if (pos) r.dentro_do_poligono++;
          }
          if (pos) origem = 'bairro';
        }
        if (!pos && nb) {
          const f = escolher(farm.filter((x) => x.nb === nb), c.id_cliente);
          if (f) {
            pos = [f.lng, f.lat];
            origem = 'bairro';
            r.bairro_pelo_nome++;
          }
        }
        if (!pos) {
          const f = escolher(farm, c.id_cliente);
          if (f) {
            pos = [f.lng, f.lat];
            r.farmacia_da_cidade++;
          }
        }
        if (!pos && mun) {
          pos = pontoDentro(mun, c.id_cliente);
          if (pos) r.dentro_do_poligono++;
        }
        if (!pos) {
          r.sem_malha++;
          continue;
        }
        pos = [r6(pos[0]), r6(pos[1])];
        if (Math.abs(pos[0] - c.lng) > 1e-9 || Math.abs(pos[1] - c.lat) > 1e-9 || origem !== c.origem) {
          st.run(pos[1], pos[0], origem, c.id_cliente);
          r.movidos++;
        }
      }
    }
  });
  if (r.movidos) notificarMudancaGeo();
  return r;
}

/** Conferência: pontos (farmácias e clientes) fora do próprio município, por cidade. */
export function conferirPontosEmTerra(ibges) {
  return ibges.map((ibge) => {
    const aneis = aneisMunicipioSync(ibge);
    const nome = db.prepare('SELECT nome, uf FROM geo_municipio WHERE codigo_ibge = ?').get(String(ibge));
    if (!aneis) return { ibge, nome: nome?.nome, sem_malha: true };
    const farm = db.prepare('SELECT lat, lng FROM rf_farmacia WHERE municipio_ibge = ? AND lat IS NOT NULL').all(String(ibge));
    const cli = db.prepare('SELECT lat, lng FROM cliente_geo WHERE municipio_ibge = ?').all(String(ibge));
    const fora = (l) => l.filter((p) => !dentroAneis(p.lng, p.lat, aneis)).length;
    return { ibge, nome: `${nome?.nome}/${nome?.uf}`, farmacias: farm.length, farmacias_fora: fora(farm), clientes: cli.length, clientes_fora: fora(cli) };
  });
}

// Assinatura da base de farmácias + malhas: a correção só roda de novo quando uma das duas muda.
db.exec('CREATE TABLE IF NOT EXISTS geo_manutencao (chave TEXT PRIMARY KEY, valor TEXT)');
export function assinaturaCorrecao() {
  const f = db.prepare('SELECT COUNT(*) AS n, MAX(rowid) AS m FROM rf_farmacia').get();
  const imp = db.prepare('SELECT MAX(rowid) AS m FROM rf_importacao').get()?.m ?? 0;
  const malhas = ['maxima', 'intermediaria'].map((q) => Object.keys(SIGLA).filter((uf) => fs.existsSync(arquivoMalha(uf, q))).length).join('/');
  return `${f.n}|${f.m}|${imp}|${malhas}`;
}

/** Correção das farmácias (se a base ou as malhas mudaram) e reposicionamento dos clientes aproximados. */
export async function manutencaoGeo({ forcar = false, assincrono = true } = {}) {
  const chave = db.prepare("SELECT valor FROM geo_manutencao WHERE chave = 'farmacias'").get()?.valor;
  let farmacias = null;
  if (forcar || chave !== assinaturaCorrecao()) {
    farmacias = { verificadas: 0, ajustadas_borda: 0, reposicionadas: 0, sem_malha: 0 };
    for (const uf of ufsComMalha()) {
      const r = corrigirFarmaciasForaDoMunicipio({ ufs: [uf] });
      for (const k of Object.keys(farmacias)) farmacias[k] += r[k];
      if (assincrono) await new Promise((ok) => setImmediate(ok));
    }
    db.prepare("INSERT OR REPLACE INTO geo_manutencao (chave, valor) VALUES ('farmacias', ?)").run(assinaturaCorrecao());
  }
  // clientes: só reposiciona se a base, as posições ou os bairros baixados mudaram desde a última vez
  const antes = db.prepare("SELECT valor FROM geo_manutencao WHERE chave = 'clientes'").get()?.valor;
  let clientes = { movidos: 0, pulado: true };
  if (forcar || antes !== assinaturaPosicoes()) {
    clientes = reposicionarClientes();
    db.prepare("INSERT OR REPLACE INTO geo_manutencao (chave, valor) VALUES ('clientes', ?)").run(assinaturaPosicoes());
  }
  return { farmacias, clientes };
}

/** Muda quando a carteira, as posições gravadas, as farmácias ou os bairros em cache mudam. */
export function assinaturaPosicoes() {
  const imp = db.prepare('SELECT MAX(id) AS m FROM importacao').get()?.m ?? 0;
  const c = db.prepare('SELECT COUNT(*) AS n, ROUND(SUM(lat) * 1e5) AS a, ROUND(SUM(lng) * 1e5) AS b FROM cliente_geo').get();
  const bairros = fs.existsSync(PASTA_BAIRROS) ? fs.readdirSync(PASTA_BAIRROS).filter((f) => f.endsWith('.json')).length : 0;
  return `${assinaturaCorrecao()}|${imp}|${c.n}|${c.a}|${c.b}|${bairros}`;
}

/** Pré-carrega os bairros (IBGE) das UFs onde temos clientes e reposiciona os clientes dessas cidades. */
export async function preCarregarBairrosIbge() {
  const ufs = db.prepare('SELECT DISTINCT substr(municipio_ibge, 1, 2) AS c FROM cliente_geo').all().map((x) => UFS[Number(x.c)]?.[0]).filter(Boolean);
  for (const uf of ufs) {
    try {
      await garantirBairrosIbgeUf(uf);
    } catch (e) {
      console.error(`[malhas] bairros de ${uf}:`, e.message);
    }
  }
  return reposicionarClientes();
}

// ------------------------------------------------------------------ números por bairro
/** Bairros + farmácias, clientes e vendas de cada um (pontos dentro do polígono). */
// Números por bairro ficam gravados em bairro_numeros (etapa "mapa-bairros"); a rota só recalcula se a assinatura mudou.
db.exec(`CREATE TABLE IF NOT EXISTS bairro_numeros (
  ibge TEXT PRIMARY KEY,
  assinatura TEXT NOT NULL,
  json TEXT NOT NULL,
  ms INTEGER,
  gerado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)`);

export async function bairrosComNumeros(ibge, { atualizar = false } = {}) {
  const d = await bairrosMunicipio(ibge, { atualizar });
  const mun = db.prepare('SELECT nome, uf FROM geo_municipio WHERE codigo_ibge = ?').get(String(ibge));
  const base = { ibge: String(ibge), nome: mun?.nome || String(ibge), uf: mun?.uf || ufDoIbge(ibge), fonte: d.fonte, fonte_info: d.fonte ? FONTES[d.fonte] : null, obtido_em: d.obtido_em, aviso: d.aviso || null };
  if (!d.bairros.length) return { ...base, bairros: [] };
  return { ...base, ...numerosBairrosGravados(String(ibge), d) };
}

/** Assinatura dos números de bairro de uma cidade: data do arquivo de bairros + dados do mapa (sem abrir o arquivo). */
function assinaturaBairros(ibge, base = assinaturaMapa()) {
  const arq = path.join(PASTA_BAIRROS, `${ibge}.json`);
  return `${fs.existsSync(arq) ? Math.round(fs.statSync(arq).mtimeMs) : 0}|${base}`;
}

function numerosBairrosGravados(ibge, d) {
  let assinatura = assinaturaBairros(ibge);
  const row = db.prepare('SELECT assinatura, json FROM bairro_numeros WHERE ibge = ?').get(ibge);
  if (row?.assinatura === assinatura) return JSON.parse(row.json);
  // bairros recém-baixados: clientes da cidade vão para dentro do bairro do cadastro antes de contar
  if (reposicionarClientes({ cidades: [ibge] }).movidos) {
    notificarMudancaGeo();
    assinatura = assinaturaBairros(ibge);
  }
  const t0 = Date.now();
  const numeros = calcularNumerosBairros(ibge, d);
  db.prepare('INSERT OR REPLACE INTO bairro_numeros (ibge, assinatura, json, ms) VALUES (?, ?, ?, ?)').run(ibge, assinatura, JSON.stringify(numeros), Date.now() - t0);
  return numeros;
}

/** Etapa do pipeline: números de todas as cidades com bairros já baixados (pula as que não mudaram). */
export async function recalcularBairrosEmCache() {
  if (!fs.existsSync(PASTA_BAIRROS)) return { linhas: 0, recalculadas: 0 };
  const gravadas = new Map(db.prepare('SELECT ibge, assinatura FROM bairro_numeros').all().map((r) => [r.ibge, r.assinatura]));
  let base = assinaturaMapa();
  let n = 0;
  let recalculadas = 0;
  for (const f of fs.readdirSync(PASTA_BAIRROS).filter((x) => /^\d{7}\.json$/.test(x))) {
    const ibge = f.slice(0, 7);
    n++;
    if (gravadas.get(ibge) === assinaturaBairros(ibge, base)) continue;
    const d = lerJson(path.join(PASTA_BAIRROS, f));
    if (!d.bairros?.length) continue;
    numerosBairrosGravados(ibge, d);
    recalculadas++;
    base = assinaturaMapa();
    if (recalculadas % 25 === 0) await new Promise((ok) => setImmediate(ok));
  }
  return { linhas: n, recalculadas };
}

function calcularNumerosBairros(ibge, d) {

  const aneis = d.bairros.map((b) => b.a.map(decodificarAnel));
  const caixas = aneis.map(caixaAneis);
  const achar = (lng, lat) => {
    for (let i = 0; i < aneis.length; i++) {
      const [o, s, l, n] = caixas[i];
      if (lng < o || lng > l || lat < s || lat > n) continue;
      if (dentroAneis(lng, lat, aneis[i])) return i;
    }
    return -1;
  };
  const num = d.bairros.map(() => ({ farmacias: 0, independentes: 0, nao_clientes: 0, novas_12m: 0, clientes: 0, clientes_ativos: 0, valor_90d: 0 }));
  const ha12 = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  for (const f of db.prepare('SELECT lat, lng, rede, id_cliente, data_inicio FROM rf_farmacia WHERE municipio_ibge = ? AND lat IS NOT NULL AND aproximado = 0').iterate(String(ibge))) {
    const i = achar(f.lng, f.lat);
    if (i < 0) continue;
    const x = num[i];
    x.farmacias++;
    if (!f.rede || f.rede <= 1) x.independentes++;
    if (f.id_cliente == null) x.nao_clientes++;
    if (f.data_inicio && f.data_inicio >= ha12) x.novas_12m++;
  }
  const ref = db.prepare("SELECT MAX(data_pedido) AS d FROM fato_vendas WHERE status = 'Faturado'").get()?.d;
  const clientes = db
    .prepare(
      `WITH v AS (SELECT id_cliente, SUM(valor_total) AS valor FROM fato_vendas
                   WHERE status = 'Faturado' AND data_pedido > date(?, '-90 day') AND data_pedido <= ? GROUP BY id_cliente)
       SELECT cg.lat, cg.lng, COALESCE(v.valor, 0) AS valor FROM cliente_geo cg LEFT JOIN v ON v.id_cliente = cg.id_cliente
        WHERE cg.municipio_ibge = ? AND cg.origem <> 'cidade'`,
    )
    .all(ref, ref, String(ibge));
  for (const c of clientes) {
    const i = achar(c.lng, c.lat);
    if (i < 0) continue;
    num[i].clientes++;
    if (c.valor > 0) {
      num[i].clientes_ativos++;
      num[i].valor_90d += c.valor;
    }
  }
  const semBairro = db.prepare("SELECT COUNT(*) AS n FROM cliente_geo WHERE municipio_ibge = ? AND origem = 'cidade'").get(String(ibge)).n;
  return {
    clientes_sem_bairro: semBairro,
    bairros: d.bairros.map((b, i) => ({
      ...b,
      ...num[i],
      valor_90d: Math.round(num[i].valor_90d),
      penetracao: num[i].farmacias ? Math.round((num[i].clientes_ativos / num[i].farmacias) * 1000) / 10 : null,
    })),
  };
}

/** Situação do cache de malhas (para a tela de dados e diagnósticos). */
export function statusMalhas() {
  const contar = (p, ext) => (fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith(ext)).length : 0);
  return { ufs_municipios: contar(PASTA_MUN, '.geojson'), municipios_com_bairros_em_cache: contar(PASTA_BAIRROS, '.json'), ufs_bairros_processadas: contar(PASTA_BAIRROS_UF, '.json') };
}

// ------------------------------------------------------------------ malha pronta para enviar (gzip em disco)
const PASTA_GZ = path.join(PASTA_MUN, '_gz');

/** JSON da malha municipal já comprimido, guardado em disco (a rota só lê o arquivo). */
export async function malhaComprimida(uf, qualidade = 'intermediaria') {
  uf = String(uf || '').toUpperCase();
  const q = qualidadeValida(qualidade);
  const fonte = await garantirMalhaUf(uf, q);
  const arq = path.join(PASTA_GZ, `${uf}-${q}.json.gz`);
  if (fs.existsSync(arq) && fs.statSync(arq).mtimeMs >= fs.statSync(fonte).mtimeMs) return fs.readFileSync(arq);
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(await municipiosUf(uf, { qualidade: q }))), { level: 6 });
  fs.mkdirSync(PASTA_GZ, { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, buf);
  fs.renameSync(`${arq}.tmp`, arq);
  return buf;
}
