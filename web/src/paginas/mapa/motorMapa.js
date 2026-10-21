import { geoArea, geoBounds, geoCentroid, geoMercator, geoPath } from 'd3-geo';

// =====================================================================
// Motor de desenho do mapa comercial (canvas 2D). Sem React no laço de quadros:
// o componente só repassa dados/estilos e recebe eventos (hover, clique, vista, desenho).
//
// Coordenadas: "base" = projeção Mercator ajustada ao Brasil no tamanho atual do canvas.
// Vista = { cx, cy, k }: centro (em base) e zoom. tela = (base - centro) * k + meio.
//
// Nível de detalhe progressivo (tudo interpolado pelo zoom, sem corte seco):
//   longe: só UFs (malha mínima) · aproximando: divisas municipais surgem (malha intermediária)
//   cidade: malha máxima (litoral preciso) e bairros · territórios e desenhos sempre por cima do mapa.
// =====================================================================

export const K_PONTOS = 11; // farmácias e clientes aparecem um a um
export const K_LIMITES = 1.8; // divisas municipais começam a surgir
export const K_MAXIMA = 20; // a partir daqui o litoral e as divisas usam a malha máxima
export const K_BAIRROS = 15; // bairros começam a surgir
const K_MAX = 900;
const K_MIN = 0.3;
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sairSuave = (t) => 1 - (1 - t) ** 3;
/** 0..1 em escala logarítmica do zoom, com início e fim suaves. */
const rampa = (k, a, b) => {
  const t = Math.max(0, Math.min(1, (Math.log(k) - Math.log(a)) / (Math.log(b) - Math.log(a))));
  return t * t * (3 - 2 * t);
};
const RAD = Math.PI / 180;
const intercepta = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Path2D a partir de anéis em coordenadas base (Float64Array [x0, y0, x1, y1, ...]). */
function caminho(aneis, p = new Path2D()) {
  for (const a of aneis) {
    if (a.length < 6) continue;
    p.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]);
    p.closePath();
  }
  return p;
}

function caixa(aneis) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const a of aneis) {
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < x0) x0 = a[i];
      if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1];
      if (a[i + 1] > y1) y1 = a[i + 1];
    }
  }
  return [x0, y0, x1, y1];
}

/** Ponto para rótulo: centróide do maior anel; se cair fora, o melhor ponto de uma grade dentro dele. */
function pontoRotulo(aneis, ctx) {
  let maior = null;
  let areaMax = -1;
  for (const a of aneis) {
    let s = 0;
    for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) s += a[j] * a[i + 1] - a[i] * a[j + 1];
    if (Math.abs(s) > areaMax) {
      areaMax = Math.abs(s);
      maior = a;
    }
  }
  if (!maior) return null;
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0, j = maior.length - 2; i < maior.length; j = i, i += 2) {
    const f = maior[j] * maior[i + 1] - maior[i] * maior[j + 1];
    cx += (maior[j] + maior[i]) * f;
    cy += (maior[j + 1] + maior[i + 1]) * f;
    a2 += f;
  }
  const p = caminho([maior]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (a2 !== 0) {
    cx /= 3 * a2;
    cy /= 3 * a2;
    if (ctx.isPointInPath(p, cx, cy, 'evenodd')) return [cx, cy];
  }
  const [x0, y0, x1, y1] = caixa([maior]);
  let melhor = null;
  let dMelhor = -1;
  for (let i = 1; i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const x = x0 + ((x1 - x0) * i) / 8;
      const y = y0 + ((y1 - y0) * j) / 8;
      if (!ctx.isPointInPath(p, x, y, 'evenodd')) continue;
      const d = Math.min(x - x0, x1 - x, y - y0, y1 - y);
      if (d > dMelhor) {
        dMelhor = d;
        melhor = [x, y];
      }
    }
  }
  return melhor || [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** Douglas-Peucker em coordenadas base ([[x, y], ...]). */
function simplificar(pts, tol) {
  if (pts.length <= 4) return pts;
  const manter = new Uint8Array(pts.length);
  manter[0] = 1;
  manter[pts.length - 1] = 1;
  const pilha = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (pilha.length) {
    const [a, b] = pilha.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const u = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2));
      const d = (pts[i][0] - ax - u * dx) ** 2 + (pts[i][1] - ay - u * dy) ** 2;
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
  return pts.filter((_, i) => manter[i]);
}

export class MotorMapa {
  constructor(canvas, eventos = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ev = eventos;
    this.w = 1;
    this.h = 1;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.feats = [];
    this.cidades = [];
    this.ordemCidades = [];
    this.pontos = [];
    this.camadas = { estados: true, cidades: true, pontos: true, limites: true, bairros: true, territorios: true };
    this.opcoes = { metricaTamanho: 'farmacias', ufSelecionada: null };
    this.paleta = null;
    this.margens = { esquerda: 0, direita: 0, topo: 0, base: 0 };
    this.vista = { cx: 0, cy: 0, k: 1 };
    this.anim = null;
    this.hover = null;
    this.destaque = null; // item selecionado (anel permanente / realce)
    this.alfaPontos = 0;
    this.entrada = { t0: performance.now(), dur: 1100 };
    this.visiveis = [];
    this.agendado = false;
    this.arrasto = null;
    this.ultimaVista = 0;
    this.timerParada = null;
    // malhas detalhadas
    this.malhas = { intermediaria: new Map(), maxima: new Map() }; // uf -> { itens, lotes }
    this.contornoUf = new Map(); // uf -> { cod, aneis, path, q }
    this.bairros = new Map(); // ibge -> { ibge, nome, fonte, itens, bb, path }
    // territórios e desenho
    this.territorios = [];
    this.terSel = null;
    this.ferramenta = null; // null | 'poligono' | 'laco' | 'retangulo'
    this.rascunho = null; // { forma, pts: [[x, y]], cursor }
    this.pendente = null; // { aneis(base), cor }
    this.edicao = null; // { aneis: [[[x, y]]], cor }
    this.arrastoVertice = null;
    this.realces = new Map(); // chave -> { t0 } (animação de entrada de áreas novas)
    this._ligarEventos();
  }

  // ------------------------------------------------------------------ configuração
  definirPaleta(p) {
    this.paleta = p;
    this.redesenhar();
  }

  /** Área ocupada por painéis flutuantes: a vista inicial enquadra o Brasil no espaço livre. */
  definirMargens(m) {
    this.margens = { ...this.margens, ...m };
  }

  _vistaInicial() {
    if (!this.geo || !this.proj) return { cx: this.w / 2, cy: this.h / 2, k: 1 };
    const [[x0, y0], [x1, y1]] = geoPath(this.proj).bounds(this.geo);
    const { esquerda: e, direita: d, topo: t, base: b } = this.margens;
    const fw = Math.max(160, this.w - e - d);
    const fh = Math.max(160, this.h - t - b);
    const k = Math.min(fw / Math.max(1, x1 - x0), fh / Math.max(1, y1 - y0)) * 0.94;
    const sx = e + fw / 2;
    const sy = t + fh / 2;
    return { k, cx: (x0 + x1) / 2 - (sx - this.w / 2) / k, cy: (y0 + y1) / 2 - (sy - this.h / 2) / k };
  }

  definirCamadas(c) {
    this.camadas = { ...this.camadas, ...c };
    this.redesenhar();
  }

  definirOpcoes(o) {
    this.opcoes = { ...this.opcoes, ...o };
    this._raios();
    this.redesenhar();
  }

  definirBase(geojson) {
    // segurança: se algum anel vier no sentido "errado" para o d3, o polígono cobriria o globo inteiro
    const feats = geojson.features.map((f) => {
      if (geoArea(f) > 2 * Math.PI) {
        const inv = (anel) => [...anel].reverse();
        const g = f.geometry.type === 'Polygon' ? { ...f.geometry, coordinates: f.geometry.coordinates.map(inv) } : { ...f.geometry, coordinates: f.geometry.coordinates.map((p) => p.map(inv)) };
        return { ...f, geometry: g };
      }
      return f;
    });
    this.geo = { type: 'FeatureCollection', features: feats };
    this.feats = feats.map((f) => ({ uf: f.properties.uf, nome: f.properties.nome, feature: f, bounds: geoBounds(f), centroide: geoCentroid(f), path: null, valor: null }));
    this._projetar(true);
    this.redesenhar();
  }

  /** cidades: [{ ibge, nome, uf, lat, lng, farmacias, independentes, clientes_ativos, prioridade, ... }] */
  definirCidades(cidades, ufs = [], animar = false) {
    this.cidades = cidades.map((c) => ({ ...c, bx: 0, by: 0, r: 0 }));
    this.porIbge = new Map(this.cidades.map((c) => [c.ibge, c]));
    const porUf = new Map(ufs.map((u) => [u.uf, u]));
    for (const f of this.feats) f.dados = porUf.get(f.uf) || null;
    this._classesUf();
    this._projetarCidades();
    this._raios();
    if (animar) this.entrada = { t0: performance.now(), dur: 1100 };
    this.redesenhar();
  }

  /** pontos: [{ id, lat, lng, tipo, rede, score, nome }] */
  definirPontos(pontos) {
    this.pontos = pontos.map((p) => ({ ...p, bx: 0, by: 0 }));
    this._projetarPontos();
    this.redesenhar();
  }

  definirDestaque(item) {
    this.destaque = item;
    this.redesenhar();
  }

  // ------------------------------------------------------------------ malhas detalhadas (municípios, UFs, bairros)
  /** Projeção Mercator direta (bem mais rápida que chamar a projeção ponto a ponto em milhares de vértices). */
  _projetor() {
    const s = this.proj.scale();
    const [tx, ty] = this.proj.translate();
    return { s, tx, ty };
  }

  /** Anéis codificados (inteiros 1e-5 grau em delta) -> Float64Array em coordenadas base. */
  _projetarCod(cods) {
    const { s, tx, ty } = this._projetor();
    return cods.map((cod) => {
      const out = new Float64Array(cod.length);
      let x = 0;
      let y = 0;
      for (let i = 0; i < cod.length; i += 2) {
        x += cod[i];
        y += cod[i + 1];
        out[i] = tx + s * (x / 1e5) * RAD;
        out[i + 1] = ty - s * Math.log(Math.tan(Math.PI / 4 + ((y / 1e5) * RAD) / 2));
      }
      return out;
    });
  }

  /** Anéis [[lng, lat], ...] -> Float64Array em coordenadas base. */
  _projetarLngLat(aneis) {
    const { s, tx, ty } = this._projetor();
    return aneis.map((anel) => {
      const out = new Float64Array(anel.length * 2);
      anel.forEach(([lng, lat], i) => {
        out[2 * i] = tx + s * lng * RAD;
        out[2 * i + 1] = ty - s * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
      });
      return out;
    });
  }

  _montarMalha(uf, q, dados) {
    // só a caixa de cada município é projetada agora (cantos lng/lat); os vértices são projetados
    // quando o lote aparece na tela pela primeira vez, para não travar o zoom ao chegar uma UF grande
    const { s, tx, ty } = this._projetor();
    const px = (lng) => tx + s * lng * RAD;
    const py = (lat) => ty - s * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
    const itens = dados.municipios.map((m) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const cod of m.a) {
        let x = 0;
        let y = 0;
        for (let i = 0; i < cod.length; i += 2) {
          x += cod[i];
          y += cod[i + 1];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      return { tipo: 'municipio', ibge: m.ibge, nome: m.nome, uf, cod: m.a, aneis: null, bb: [px(x0 / 1e5), py(y1 / 1e5), px(x1 / 1e5), py(y0 / 1e5)], path: null };
    });
    // lotes espaciais: só os lotes que aparecem na tela são desenhados (cabe a malha máxima de MG sem travar)
    const celula = s * RAD * (q === 'maxima' ? 0.7 : 2);
    const grupos = new Map();
    for (const it of itens) {
      const chave = `${Math.floor((it.bb[0] + it.bb[2]) / 2 / celula)}:${Math.floor((it.bb[1] + it.bb[3]) / 2 / celula)}`;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(it);
    }
    const lotes = [...grupos.values()].map((g) => ({
      itens: g,
      path: null,
      bb: [Math.min(...g.map((i) => i.bb[0])), Math.min(...g.map((i) => i.bb[1])), Math.max(...g.map((i) => i.bb[2])), Math.max(...g.map((i) => i.bb[3]))],
    }));
    return { uf, q, dados, itens, lotes, porIbge: new Map(itens.map((i) => [i.ibge, i])) };
  }

  _aneisItem(it) {
    if (!it.aneis) it.aneis = this._projetarCod(it.cod);
    return it.aneis;
  }

  _caminhoItem(it) {
    if (!it.path) it.path = caminho(this._aneisItem(it));
    return it.path;
  }

  _caminhoLote(l) {
    if (!l.path) {
      l.path = new Path2D();
      for (const it of l.itens) caminho(this._aneisItem(it), l.path);
    }
    return l.path;
  }

  /** Mistura duas cores do tema (terra + tom do coroplético) para pintar cada UF numa passada só. */
  _misturar(a, b, t) {
    const chave = `${a}|${b}|${t.toFixed(3)}`;
    this._cacheCores ||= new Map();
    if (this._cacheCores.has(chave)) return this._cacheCores.get(chave);
    const rgb = (c) => {
      const s = String(c).trim();
      if (s.startsWith('#')) {
        const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      }
      const m = s.match(/rgba?\(([^)]+)\)/);
      return m ? m[1].split(',').slice(0, 3).map((x) => Number(x.trim())) : null;
    };
    const ca = rgb(a);
    const cb = rgb(b);
    const r = ca && cb ? `rgb(${ca.map((v, i) => Math.round(v + (cb[i] - v) * t)).join(',')})` : null;
    if (this._cacheCores.size > 400) this._cacheCores.clear();
    this._cacheCores.set(chave, r);
    return r;
  }

  definirMunicipios(uf, q, dados) {
    this.malhas[q].set(uf, this._montarMalha(uf, q, dados));
    this.redesenhar();
  }

  temMunicipios(uf, q) {
    return this.malhas[q].has(uf);
  }

  definirContornoUfs(q, dados) {
    for (const u of dados.ufs) {
      const atual = this.contornoUf.get(u.uf);
      if (atual && atual.q === 'maxima' && q !== 'maxima') continue;
      const aneis = this._projetarCod(u.a);
      this.contornoUf.set(u.uf, { q, cod: u.a, aneis, path: caminho(aneis) });
    }
    this.redesenhar();
  }

  definirBairros(ibge, dados) {
    const itens = (dados.bairros || []).map((b) => {
      const aneis = this._projetarCod(b.a);
      return { tipo: 'bairro', ibge, id: b.id, nome: b.nome, cod: b.a, dados: b, aneis, bb: caixa(aneis), path: caminho(aneis), rot: null };
    });
    for (const it of itens) it.rot = pontoRotulo(it.aneis, this.ctx);
    const path = new Path2D();
    for (const it of itens) caminho(it.aneis, path);
    const bb = itens.length ? [Math.min(...itens.map((i) => i.bb[0])), Math.min(...itens.map((i) => i.bb[1])), Math.max(...itens.map((i) => i.bb[2])), Math.max(...itens.map((i) => i.bb[3]))] : null;
    this.bairros.set(ibge, { ibge, nome: dados.nome, uf: dados.uf, fonte: dados.fonte, dados, itens, path, bb, t0: performance.now() });
    // memória: guarda só as cidades mais recentes
    if (this.bairros.size > 24) this.bairros.delete(this.bairros.keys().next().value);
    this.redesenhar();
  }

  temBairros(ibge) {
    return this.bairros.has(ibge);
  }

  /** territorios: [{ id, tipo, nome, cor, geometria: [[[lng, lat]]], vendedor, numeros }] */
  /** Camada de carteiras: dono de cada cidade e bairro (cor da carteira). */
  definirCarteiras(c) {
    this.carteiras = c ? { ...c, cor: new Map((c.carteiras || []).map((x) => [x.id, x.cor])) } : null;
    this.redesenhar();
  }

  definirTerritorios(lista) {
    const antes = new Set(this.territorios.map((t) => t.id));
    this.territorios = lista.map((t) => {
      const aneis = this._projetarLngLat(t.geometria);
      const it = { ...t, tipoItem: 'territorio', aneis, bb: caixa(aneis), path: caminho(aneis), rot: null };
      it.rot = pontoRotulo(aneis, this.ctx);
      if (antes.size && !antes.has(t.id)) this.realces.set(`t${t.id}`, performance.now());
      return it;
    });
    this.redesenhar();
  }

  selecionarTerritorio(id) {
    this.terSel = id ?? null;
    if (id != null) this.realces.set(`sel${id}`, performance.now());
    this.redesenhar();
  }

  /** Enquadra uma geometria [[[lng, lat]]] (território, bairro, cidade). */
  enquadrarGeometria(geometria, dur = 800) {
    let o = Infinity;
    let s = Infinity;
    let l = -Infinity;
    let n = -Infinity;
    for (const anel of geometria) {
      for (const [x, y] of anel) {
        o = Math.min(o, x);
        l = Math.max(l, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
    }
    if (Number.isFinite(o)) this.enquadrar([[o, s], [l, n]], dur);
  }

  /** UFs que aparecem na tela agora. */
  ufsNaVista() {
    const bb = this.bbox();
    if (!bb) return [];
    return this.feats.filter((f) => f.bounds[0][0] <= bb[2] && f.bounds[1][0] >= bb[0] && f.bounds[0][1] <= bb[3] && f.bounds[1][1] >= bb[1]).map((f) => f.uf);
  }

  /** Municípios na tela (das malhas já carregadas), do centro para fora. */
  municipiosNaVista(max = 6) {
    const [x0, y0] = this.paraBase(0, 0);
    const [x1, y1] = this.paraBase(this.w, this.h);
    const tela = [x0, y0, x1, y1];
    const { sx, sy } = this._areaLivre();
    const [cx, cy] = this.paraBase(sx, sy);
    const vistos = new Map();
    for (const q of ['maxima', 'intermediaria']) {
      for (const m of this.malhas[q].values()) {
        for (const it of m.itens) {
          if (vistos.has(it.ibge) || !intercepta(it.bb, tela)) continue;
          const dentro = cx >= it.bb[0] && cx <= it.bb[2] && cy >= it.bb[1] && cy <= it.bb[3];
          const d = Math.hypot((it.bb[0] + it.bb[2]) / 2 - cx, (it.bb[1] + it.bb[3]) / 2 - cy) * this.vista.k;
          const tam = Math.max(it.bb[2] - it.bb[0], it.bb[3] - it.bb[1]) * this.vista.k;
          vistos.set(it.ibge, { ibge: it.ibge, nome: it.nome, uf: it.uf, centro: dentro, distancia: dentro ? 0 : d, tamanho: tam });
        }
      }
    }
    // só a cidade do centro e as vizinhas que ocupam boa parte da tela valem a busca de bairros
    return [...vistos.values()].filter((m) => m.centro || m.tamanho > 200).sort((a, b) => a.distancia - b.distancia).slice(0, max);
  }

  // ------------------------------------------------------------------ desenho (ferramentas)
  definirFerramenta(f) {
    this.ferramenta = f || null;
    this.rascunho = null;
    this.canvas.style.cursor = f ? 'crosshair' : '';
    if (f) this._definirHover(null);
    this.redesenhar();
  }

  cancelarRascunho() {
    const tinha = Boolean(this.rascunho);
    this.rascunho = null;
    this.redesenhar();
    return tinha;
  }

  desfazerPonto() {
    if (this.rascunho?.forma !== 'poligono' || !this.rascunho.pts.length) return false;
    this.rascunho.pts.pop();
    if (!this.rascunho.pts.length) this.rascunho = null;
    this.redesenhar();
    return true;
  }

  concluirRascunho() {
    const r = this.rascunho;
    if (!r) return false;
    let pts = r.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) * this.vista.k > 2.5);
    if (r.forma === 'laco') pts = simplificar(pts, 1.4 / this.vista.k);
    if (pts.length < 3) {
      this.rascunho = r.forma === 'poligono' ? r : null;
      this.redesenhar();
      return false;
    }
    this.rascunho = null;
    const anel = pts.map(([x, y]) => this.proj.invert([x, y]).map((v) => Math.round(v * 1e6) / 1e6));
    this.ev.aoDesenho?.({ forma: r.forma, geometria: [anel] });
    this.redesenhar();
    return true;
  }

  /** Área desenhada aguardando o formulário (ou bairro/cidade escolhido para virar território). */
  definirPendente(geometria, cor = null) {
    if (!geometria) this.pendente = null;
    else {
      const aneis = this._projetarLngLat(geometria);
      this.pendente = { geometria, aneis, path: caminho(aneis), cor, t0: performance.now() };
    }
    this.redesenhar();
  }

  definirCorPendente(cor) {
    if (this.pendente) this.pendente.cor = cor;
    this.redesenhar();
  }

  /** Edição de vértices de uma área (só anéis com até 600 vértices recebem alças). */
  editar(geometria, cor = null) {
    if (!geometria) {
      this.edicao = null;
      this.arrastoVertice = null;
    } else {
      this.edicao = {
        cor,
        aneis: geometria.map((anel) => {
          const pts = anel.map((p) => this.proj(p));
          if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
          return pts;
        }),
      };
    }
    this.redesenhar();
  }

  geometriaEditada() {
    if (!this.edicao) return null;
    return this.edicao.aneis.map((pts) => {
      const anel = pts.map(([x, y]) => this.proj.invert([x, y]).map((v) => Math.round(v * 1e6) / 1e6));
      anel.push([...anel[0]]);
      return anel;
    });
  }

  _alcaNaTela(sx, sy) {
    if (!this.edicao) return null;
    let melhor = null;
    let dMin = 10;
    this.edicao.aneis.forEach((pts, a) => {
      if (pts.length > 600) return;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = this.paraTela(pts[i][0], pts[i][1]);
        const d = Math.hypot(x - sx, y - sy);
        if (d < dMin) {
          dMin = d;
          melhor = { anel: a, i, tipo: 'vertice' };
        }
        const j = (i + 1) % pts.length;
        const [mx, my] = this.paraTela((pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2);
        const dm = Math.hypot(mx - sx, my - sy);
        if (dm < dMin - 2) {
          dMin = dm;
          melhor = { anel: a, i, tipo: 'meio' };
        }
      }
    });
    return melhor;
  }

  // ------------------------------------------------------------------ tamanho e projeção
  redimensionar(w, h) {
    const lngLat = this.proj ? this.proj.invert([this.vista.cx, this.vista.cy]) : null;
    const edit = this.geometriaEditada();
    const rasc = this.rascunho ? { ...this.rascunho, pts: this.rascunho.pts.map((p) => this.proj.invert(p)) } : null;
    this.w = Math.max(10, w);
    this.h = Math.max(10, h);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this._projetar(!lngLat);
    if (lngLat && this.proj) {
      const [cx, cy] = this.proj(lngLat);
      this.vista.cx = cx;
      this.vista.cy = cy;
    }
    if (edit) this.editar(edit, this.edicao?.cor);
    if (rasc && this.proj) this.rascunho = { ...rasc, pts: rasc.pts.map((p) => this.proj(p)), cursor: null };
    this.redesenhar();
  }

  _projetar(centralizar) {
    if (!this.geo) return;
    const pad = Math.min(this.w, this.h) * 0.06;
    this.proj = geoMercator().fitExtent([[pad, pad], [this.w - pad, this.h - pad]], this.geo);
    for (const f of this.feats) {
      const p = new Path2D();
      geoPath(this.proj, p)(f.feature);
      f.path = p;
      f._bb = null;
      const [x, y] = this.proj(f.centroide);
      f.cbx = x;
      f.cby = y;
    }
    this._projetarCidades();
    this._projetarPontos();
    // malhas e áreas dependem do tamanho do canvas: reprojeta a partir dos dados guardados
    for (const q of ['intermediaria', 'maxima']) for (const [uf, m] of this.malhas[q]) this.malhas[q].set(uf, this._montarMalha(uf, q, m.dados));
    for (const [uf, c] of this.contornoUf) {
      const aneis = this._projetarCod(c.cod);
      this.contornoUf.set(uf, { ...c, aneis, path: caminho(aneis) });
    }
    for (const b of [...this.bairros.values()]) this.definirBairros(b.ibge, b.dados);
    if (this.territorios.length) this.definirTerritorios(this.territorios);
    if (this.pendente) this.definirPendente(this.pendente.geometria, this.pendente.cor);
    if (centralizar) this.vista = this._vistaInicial();
  }

  _projetarCidades() {
    if (!this.proj) return;
    for (const c of this.cidades) {
      const p = this.proj([c.lng, c.lat]);
      c.bx = p[0];
      c.by = p[1];
    }
    // maiores primeiro (as pequenas ficam por cima e continuam clicáveis)
    this.ordemCidades = [...this.cidades].sort((a, b) => this._tamanho(b) - this._tamanho(a));
  }

  _projetarPontos() {
    if (!this.proj) return;
    for (const p of this.pontos) {
      const q = this.proj([p.lng, p.lat]);
      p.bx = q[0];
      p.by = q[1];
    }
  }

  _tamanho(c) {
    return this.opcoes.metricaTamanho === 'independentes' ? c.independentes : Math.max(c.farmacias, c.clientes || 0);
  }

  _raios() {
    for (const c of this.cidades) c.base = Math.sqrt(Math.max(0, this._tamanho(c)));
    this.ordemCidades = [...this.cidades].sort((a, b) => b.base - a.base);
  }

  _classesUf() {
    // penetração por UF em classes por quantil entre as UFs onde já vendemos
    const vals = this.feats.map((f) => f.dados?.penetracao).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    this.cortesUf = vals.length ? [q(0.25), q(0.5), q(0.75)] : [];
    for (const f of this.feats) {
      const v = f.dados?.penetracao;
      f.classe = !(v > 0) ? -1 : this.cortesUf.filter((c) => v >= c).length; // 0..3
    }
  }

  // ------------------------------------------------------------------ conversões
  paraTela(bx, by) {
    const { cx, cy, k } = this.vista;
    return [(bx - cx) * k + this.w / 2, (by - cy) * k + this.h / 2];
  }

  paraBase(sx, sy) {
    const { cx, cy, k } = this.vista;
    return [(sx - this.w / 2) / k + cx, (sy - this.h / 2) / k + cy];
  }

  bbox() {
    if (!this.proj) return null;
    const [x0, y0] = this.paraBase(0, 0);
    const [x1, y1] = this.paraBase(this.w, this.h);
    const [oeste, norte] = this.proj.invert([x0, y0]);
    const [leste, sul] = this.proj.invert([x1, y1]);
    return [oeste, sul, leste, norte];
  }

  // ------------------------------------------------------------------ navegação
  _alvo(cx, cy, k, dur = 650) {
    k = Math.max(K_MIN, Math.min(K_MAX, k));
    this.anim = { de: { ...this.vista }, para: { cx, cy, k }, t0: performance.now(), dur };
    this.redesenhar();
  }

  /** Centro e tamanho da área livre (fora dos painéis flutuantes), em pixels de tela. */
  _areaLivre() {
    const { esquerda: e, direita: d, topo: t, base: b } = this.margens;
    const fw = Math.max(160, this.w - e - d);
    const fh = Math.max(160, this.h - t - b);
    return { fw, fh, sx: e + fw / 2, sy: t + fh / 2 };
  }

  voarPara(lng, lat, k = 60, dur = 900) {
    if (!this.proj) return;
    const [bx, by] = this.proj([lng, lat]);
    const { sx, sy } = this._areaLivre();
    k = Math.max(K_MIN, Math.min(K_MAX, k));
    this._alvo(bx - (sx - this.w / 2) / k, by - (sy - this.h / 2) / k, k, dur);
  }

  enquadrar([[oeste, sul], [leste, norte]], dur = 800) {
    if (!this.proj) return;
    const [x0, y0] = this.proj([oeste, norte]);
    const [x1, y1] = this.proj([leste, sul]);
    const { fw, fh, sx, sy } = this._areaLivre();
    const k = Math.min(K_MAX, (fw * 0.86) / Math.max(1e-6, x1 - x0), (fh * 0.86) / Math.max(1e-6, y1 - y0));
    this._alvo((x0 + x1) / 2 - (sx - this.w / 2) / k, (y0 + y1) / 2 - (sy - this.h / 2) / k, k, dur);
  }

  enquadrarUf(uf) {
    const f = this.feats.find((x) => x.uf === uf);
    if (f) this.enquadrar(f.bounds);
  }

  reiniciar() {
    const v = this._vistaInicial();
    this._alvo(v.cx, v.cy, v.k, 800);
  }

  zoomEm(fator, sx = this.w / 2, sy = this.h / 2, dur = 320) {
    const base = this.anim ? this.anim.para : this.vista;
    const k = Math.max(K_MIN, Math.min(K_MAX, base.k * fator));
    const [bx, by] = [(sx - this.w / 2) / base.k + base.cx, (sy - this.h / 2) / base.k + base.cy];
    this._alvo(bx - (sx - this.w / 2) / k, by - (sy - this.h / 2) / k, k, dur);
  }

  // ------------------------------------------------------------------ eventos de ponteiro
  _ligarEventos() {
    const c = this.canvas;
    const local = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    this._roda = (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      const fator = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
      this.zoomEm(fator, sx, sy, 220);
    };
    this._baixo = (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      const [sx, sy] = local(e);
      this.anim = null;
      // alça de vértice (edição)
      const alca = this._alcaNaTela(sx, sy);
      if (alca) {
        const pts = this.edicao.aneis[alca.anel];
        if (alca.tipo === 'meio') {
          const j = (alca.i + 1) % pts.length;
          pts.splice(alca.i + 1, 0, [(pts[alca.i][0] + pts[j][0]) / 2, (pts[alca.i][1] + pts[j][1]) / 2]);
          this.arrastoVertice = { anel: alca.anel, i: alca.i + 1 };
        } else this.arrastoVertice = { anel: alca.anel, i: alca.i };
        this.redesenhar();
        return;
      }
      if (this.ferramenta === 'laco' || this.ferramenta === 'retangulo') {
        const p = this.paraBase(sx, sy);
        this.rascunho = { forma: this.ferramenta, pts: [p], inicio: p };
        this.redesenhar();
        return;
      }
      this.arrasto = { x: e.clientX, y: e.clientY, cx: this.vista.cx, cy: this.vista.cy, moveu: false };
    };
    this._mover = (e) => {
      const [sx, sy] = local(e);
      if (this.arrastoVertice) {
        const { anel, i } = this.arrastoVertice;
        this.edicao.aneis[anel][i] = this.paraBase(sx, sy);
        this.redesenhar();
        return;
      }
      const r = this.rascunho;
      if (r && (r.forma === 'laco' || r.forma === 'retangulo') && e.buttons & 1) {
        const p = this.paraBase(sx, sy);
        if (r.forma === 'laco') {
          const u = r.pts[r.pts.length - 1];
          if (Math.hypot(p[0] - u[0], p[1] - u[1]) * this.vista.k > 3) r.pts.push(p);
        } else {
          const [x0, y0] = r.inicio;
          r.pts = [[x0, y0], [p[0], y0], [p[0], p[1]], [x0, p[1]]];
        }
        this.redesenhar();
        return;
      }
      if (this.arrasto) {
        const dx = e.clientX - this.arrasto.x;
        const dy = e.clientY - this.arrasto.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.arrasto.moveu = true;
        if (this.arrasto.moveu) {
          this.vista.cx = this.arrasto.cx - dx / this.vista.k;
          this.vista.cy = this.arrasto.cy - dy / this.vista.k;
          c.style.cursor = 'grabbing';
          this._definirHover(null);
          this.redesenhar();
          return;
        }
      }
      this.ponteiro = { sx, sy };
      if (this.ferramenta) {
        if (r?.forma === 'poligono') {
          r.cursor = this.paraBase(sx, sy);
          const [fx, fy] = this.paraTela(r.pts[0][0], r.pts[0][1]);
          r.fechar = r.pts.length >= 3 && Math.hypot(fx - sx, fy - sy) < 10;
          this.redesenhar();
        }
        return;
      }
      if (this.edicao) {
        const alca = this._alcaNaTela(sx, sy);
        c.style.cursor = alca ? (alca.tipo === 'meio' ? 'copy' : 'move') : '';
        if (alca) return;
      }
      if (!this.testePendente) {
        this.testePendente = true;
        requestAnimationFrame(() => {
          this.testePendente = false;
          if (!this.ponteiro || this.ferramenta) return;
          const item = this.acertar(this.ponteiro.sx, this.ponteiro.sy);
          this._definirHover(item);
          this.ev.aoMover?.(this.ponteiro.sx, this.ponteiro.sy);
        });
      }
    };
    this._cima = (e) => {
      const [sx, sy] = local(e);
      if (this.arrastoVertice) {
        this.arrastoVertice = null;
        this.ev.aoEdicao?.(this.geometriaEditada());
        return;
      }
      const r = this.rascunho;
      if (r && (r.forma === 'laco' || r.forma === 'retangulo')) {
        if (r.forma === 'retangulo' && r.pts.length < 4) this.rascunho = null;
        else this.concluirRascunho();
        this.redesenhar();
        return;
      }
      const a = this.arrasto;
      this.arrasto = null;
      c.style.cursor = this.ferramenta ? 'crosshair' : '';
      if (a && !a.moveu) {
        if (this.ferramenta === 'poligono') {
          const p = this.paraBase(sx, sy);
          if (!this.rascunho) this.rascunho = { forma: 'poligono', pts: [p], cursor: p };
          else if (this.rascunho.fechar) this.concluirRascunho();
          else this.rascunho.pts.push(p);
          this.redesenhar();
          return;
        }
        if (this.ferramenta) return;
        const item = this.acertar(sx, sy);
        this.ev.aoClique?.(item);
      }
    };
    this._sair = () => {
      this.ponteiro = null;
      if (this.rascunho?.forma === 'poligono') this.rascunho.cursor = null;
      this._definirHover(null);
    };
    this._duplo = (e) => {
      const [sx, sy] = local(e);
      if (this.ferramenta === 'poligono') {
        this.concluirRascunho();
        return;
      }
      if (this.ferramenta) return;
      const alca = this._alcaNaTela(sx, sy);
      if (alca?.tipo === 'vertice') {
        const pts = this.edicao.aneis[alca.anel];
        if (pts.length > 3) {
          pts.splice(alca.i, 1);
          this.ev.aoEdicao?.(this.geometriaEditada());
          this.redesenhar();
        }
        return;
      }
      this.zoomEm(2.6, sx, sy, 450);
    };
    c.addEventListener('wheel', this._roda, { passive: false });
    c.addEventListener('pointerdown', this._baixo);
    c.addEventListener('pointermove', this._mover);
    c.addEventListener('pointerup', this._cima);
    c.addEventListener('pointerleave', this._sair);
    c.addEventListener('dblclick', this._duplo);
  }

  destruir() {
    const c = this.canvas;
    c.removeEventListener('wheel', this._roda);
    c.removeEventListener('pointerdown', this._baixo);
    c.removeEventListener('pointermove', this._mover);
    c.removeEventListener('pointerup', this._cima);
    c.removeEventListener('pointerleave', this._sair);
    c.removeEventListener('dblclick', this._duplo);
    clearTimeout(this.timerParada);
    this.destruido = true;
  }

  _idItem(x) {
    if (!x) return null;
    const d = x.dados;
    return `${x.tipo}:${d.ibge || ''}:${d.id ?? d.uf ?? ''}`;
  }

  _definirHover(item) {
    if (this._idItem(item) === this._idItem(this.hover)) return;
    this.hover = item;
    if (!this.ferramenta && !this.edicao) this.canvas.style.cursor = item && item.tipo !== 'uf' ? 'pointer' : '';
    this.ev.aoHover?.(item);
    this.redesenhar();
  }

  // ------------------------------------------------------------------ acerto (hover/clique)
  pontosVisiveis() {
    return this.camadas.pontos && this.vista.k >= K_PONTOS && this.pontos.length > 0;
  }

  _alfaLimites() {
    return this.camadas.limites ? rampa(this.vista.k, K_LIMITES, K_LIMITES * 2.6) : 0;
  }

  _alfaBairros() {
    return this.camadas.bairros ? rampa(this.vista.k, K_BAIRROS, K_BAIRROS * 2.2) : 0;
  }

  _qualidade() {
    return this.vista.k >= K_MAXIMA ? 'maxima' : 'intermediaria';
  }

  /** Malha municipal de uma UF no detalhe pedido (cai para a intermediária enquanto a máxima carrega). */
  _malha(uf, q = this._qualidade()) {
    return this.malhas[q].get(uf) || (q === 'maxima' ? this.malhas.intermediaria.get(uf) : null) || null;
  }

  _municipioEm(bx, by) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of this.feats) {
      const m = this._malha(f.uf);
      if (!m) continue;
      for (const it of m.itens) {
        if (bx < it.bb[0] || bx > it.bb[2] || by < it.bb[1] || by > it.bb[3]) continue;
        if (ctx.isPointInPath(this._caminhoItem(it), bx, by, 'evenodd')) return it;
      }
    }
    return null;
  }

  acertar(sx, sy) {
    if (this.pontosVisiveis()) {
      let melhor = null;
      let dMin = 9 * 9;
      for (const p of this.pontos) {
        const [x, y] = this.paraTela(p.bx, p.by);
        const d = (x - sx) ** 2 + (y - sy) ** 2;
        const peso = p.tipo === 'prospect' ? 1 : 0.6; // clientes ganham preferência quando sobrepostos
        if (d * peso < dMin) {
          dMin = d * peso;
          melhor = p;
        }
      }
      if (melhor) return { tipo: 'ponto', dados: melhor };
    }
    if (this.camadas.cidades) {
      let melhor = null;
      for (const v of this.visiveis) {
        const d = Math.hypot(v.x - sx, v.y - sy);
        if (d <= v.r + 2.5 && (!melhor || v.r < melhor.r)) melhor = v;
      }
      if (melhor) return { tipo: 'cidade', dados: melhor.c };
    }
    const [bx, by] = this.paraBase(sx, sy);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.camadas.territorios && this.territorios.length) {
      // selecionado primeiro, depois de cima para baixo
      const ordem = [...this.territorios].reverse().sort((a, b) => (b.id === this.terSel) - (a.id === this.terSel));
      for (const t of ordem) {
        if (bx < t.bb[0] || bx > t.bb[2] || by < t.bb[1] || by > t.bb[3]) continue;
        if (ctx.isPointInPath(t.path, bx, by, 'evenodd')) return { tipo: 'territorio', dados: t };
      }
    }
    if (this._alfaBairros() > 0.35) {
      for (const b of this.bairros.values()) {
        if (!b.bb || bx < b.bb[0] || bx > b.bb[2] || by < b.bb[1] || by > b.bb[3]) continue;
        for (const it of b.itens) {
          if (bx < it.bb[0] || bx > it.bb[2] || by < it.bb[1] || by > it.bb[3]) continue;
          if (ctx.isPointInPath(it.path, bx, by, 'evenodd')) return { tipo: 'bairro', dados: { ...it.dados, ibge: b.ibge, cidade: b.nome, uf: b.uf, fonte: b.fonte } };
        }
      }
    }
    if (this._alfaLimites() > 0.35) {
      const m = this._municipioEm(bx, by);
      if (m) return { tipo: 'municipio', dados: { ...(this.porIbge?.get(m.ibge) || {}), ibge: m.ibge, nome: m.nome, uf: m.uf } };
    }
    for (const f of this.feats) if (ctx.isPointInPath(f.path, bx, by)) return { tipo: 'uf', dados: { uf: f.uf, nome: f.nome, ...(f.dados || {}) } };
    return null;
  }

  // ------------------------------------------------------------------ desenho
  redesenhar() {
    if (this.agendado || this.destruido) return;
    this.agendado = true;
    requestAnimationFrame((t) => {
      this.agendado = false;
      this._quadro(t);
    });
  }

  _quadro(t) {
    if (!this.paleta || !this.proj) return;
    let continuar = false;
    const animava = Boolean(this.anim);
    if (this.anim) {
      const a = this.anim;
      const p = Math.min(1, (t - a.t0) / a.dur);
      const e = a.dur <= 260 ? sairSuave(p) : suave(p);
      const lk0 = Math.log(a.de.k);
      const lk1 = Math.log(a.para.k);
      const k = Math.exp(lk0 + (lk1 - lk0) * e);
      // interpola o centro em espaço de tela para o zoom parecer "ancorado"
      const f = Math.abs(a.para.k / a.de.k - 1) < 0.01 ? e : (1 / a.de.k - 1 / k) / (1 / a.de.k - 1 / a.para.k);
      this.vista = { k, cx: a.de.cx + (a.para.cx - a.de.cx) * f, cy: a.de.cy + (a.para.cy - a.de.cy) * f };
      if (p >= 1) {
        this.vista = { ...a.para };
        this.anim = null;
      } else continuar = true;
    }
    // transições de camada
    const alvoPontos = this.pontosVisiveis() ? 1 : 0;
    if (Math.abs(this.alfaPontos - alvoPontos) > 0.01) {
      this.alfaPontos += (alvoPontos - this.alfaPontos) * 0.18;
      continuar = true;
    } else this.alfaPontos = alvoPontos;
    const pe = Math.min(1, (t - this.entrada.t0) / this.entrada.dur);
    if (pe < 1) continuar = true;
    // animações curtas (áreas novas, seleção, bairros chegando)
    for (const [ch, t0] of this.realces) {
      if (t - t0 > 900) this.realces.delete(ch);
      else continuar = true;
    }
    for (const b of this.bairros.values()) if (t - b.t0 < 700) continuar = true;
    if (this.pendente && t - this.pendente.t0 < 600) continuar = true;

    this._desenhar(sairSuave(pe), t);
    // a vista mudou sob o mouse parado (voo/zoom animado): o item sob o cursor pode ser outro
    if (animava && this.ponteiro && !this.arrasto && !this.ferramenta) this._definirHover(this.acertar(this.ponteiro.sx, this.ponteiro.sy));
    this._notificarVista();
    if (continuar) this.redesenhar();
  }

  _notificarVista() {
    const v = this.vista;
    const u = this.vistaNotificada;
    if (u && u.cx === v.cx && u.cy === v.cy && u.k === v.k && u.w === this.w && u.h === this.h) return;
    this.vistaNotificada = { ...v, w: this.w, h: this.h };
    const agora = performance.now();
    if (agora - this.ultimaVista > 140) {
      this.ultimaVista = agora;
      this.ev.aoVista?.({ bbox: this.bbox(), k: this.vista.k });
    }
    clearTimeout(this.timerParada);
    this.timerParada = setTimeout(() => {
      if (!this.anim && !this.arrasto) this.ev.aoVistaParada?.({ bbox: this.bbox(), k: this.vista.k });
    }, 260);
  }

  _cor(chave) {
    const P = this.paleta;
    if (!chave) return P.acento;
    if (chave.startsWith('#')) return chave;
    return P.series[Number(String(chave).replace(/\D/g, '')) - 1] || P.acento;
  }

  _desenhar(entrada, agora) {
    const { ctx, dpr, w, h, paleta: P } = this;
    const { cx, cy, k } = this.vista;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [vx0, vy0] = this.paraBase(0, 0);
    const [vx1, vy1] = this.paraBase(w, h);
    const tela = [vx0, vy0, vx1, vy1];
    const naTela = (bb) => bb && intercepta(bb, tela);

    // --- terra e estados
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w / 2 - cx * k), dpr * (h / 2 - cy * k));
    // o coroplético é leitura de país/região: esmaece ao aproximar para não competir com cidades e pontos
    const alfaUf = k <= 3 ? 1 : k >= 30 ? 0.3 : 1 - 0.7 * (Math.log(k / 3) / Math.log(10));
    const detalhe = k >= K_LIMITES;
    const q = this._qualidade();
    // cada UF: com zoom, a terra usa a malha municipal (litoral preciso); sem ela, a malha mínima
    const terra = this.feats.map((f) => {
      const m = detalhe ? this._malha(f.uf, q) : null;
      const lotes = m ? m.lotes.filter((l) => naTela(l.bb)) : null;
      return { f, lotes };
    });
    const preencher = (item, estilo) => {
      ctx.fillStyle = estilo;
      if (item.lotes) for (const l of item.lotes) ctx.fill(this._caminhoLote(l), 'evenodd');
      else ctx.fill(item.f.path);
    };
    // terra + coroplético numa passada (cor já misturada); se a cor do tema não puder ser lida, usa duas passadas
    for (const it of terra) {
      const tom = this.camadas.estados && it.f.classe >= 0 ? this._misturar(P.ufNeutro, P.ufRampa[it.f.classe], alfaUf) : P.ufNeutro;
      if (tom) preencher(it, tom);
      else {
        preencher(it, P.ufNeutro);
        ctx.globalAlpha = alfaUf;
        preencher(it, P.ufRampa[it.f.classe]);
        ctx.globalAlpha = 1;
      }
    }

    // --- divisas municipais (surgem com o zoom; mais firmes quando os bairros aparecem)
    const aLim = this._alfaLimites();
    const aBai = this._alfaBairros();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (aLim > 0.01) {
      const larg = 0.35 + 0.45 * rampa(k, K_LIMITES, 12) + 0.35 * aBai;
      ctx.globalAlpha = aLim * (0.5 + 0.25 * aBai);
      ctx.strokeStyle = P.limite;
      ctx.lineWidth = larg / k;
      for (const it of terra) if (it.lotes) for (const l of it.lotes) ctx.stroke(this._caminhoLote(l));
      ctx.globalAlpha = 1;
    }

    // --- bairros
    if (aBai > 0.01) {
      ctx.strokeStyle = P.limite;
      for (const b of this.bairros.values()) {
        if (!naTela(b.bb)) continue;
        const chegada = sairSuave(Math.min(1, (agora - b.t0) / 600));
        ctx.globalAlpha = aBai * 0.42 * chegada;
        ctx.lineWidth = (0.4 + 0.35 * rampa(k, K_BAIRROS, 90)) / k;
        ctx.setLineDash([3 / k, 2.2 / k]);
        ctx.stroke(b.path);
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // --- carteiras: cada cidade e bairro com a cor do dono
    if (this.camadas.carteiras && this.carteiras && detalhe) {
      const C = this.carteiras;
      const aCart = rampa(k, K_LIMITES, K_LIMITES * 2.4);
      for (const [ibge, v] of Object.entries(C.cidades || {})) {
        const m = this._malha(v.uf, q);
        const it = m?.porIbge.get(ibge);
        if (!it || !naTela(it.bb)) continue;
        ctx.globalAlpha = 0.3 * aCart;
        ctx.fillStyle = this._cor(C.cor.get(v.c));
        ctx.fill(this._caminhoItem(it), 'evenodd');
      }
      if (aBai > 0.01) {
        for (const b of this.bairros.values()) {
          if (!naTela(b.bb)) continue;
          for (const item of b.itens) {
            const id = C.bairros?.[`${b.ibge}:${item.id}`];
            if (id == null) continue;
            ctx.globalAlpha = 0.34 * aBai;
            ctx.fillStyle = this._cor(C.cor.get(id));
            ctx.fill(item.path, 'evenodd');
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- divisas das UFs: claras de longe (separam o coroplético), escuras e finas de perto
    const tUf = rampa(k, K_LIMITES, K_LIMITES * 2);
    const contorno = (f) => (detalhe && this.contornoUf.get(f.uf)?.path) || f.path;
    if (tUf < 0.99) {
      ctx.globalAlpha = 1 - tUf;
      ctx.lineWidth = 1.25 / k;
      ctx.strokeStyle = P.ufContorno;
      for (const f of this.feats) ctx.stroke(contorno(f));
    }
    if (tUf > 0.01) {
      ctx.globalAlpha = tUf * 0.7;
      ctx.lineWidth = (1.1 + 0.3 * aBai) / k;
      ctx.strokeStyle = P.tinta3;
      for (const f of this.feats) if (naTela(this._bbUf(f))) ctx.stroke(contorno(f));
    }
    ctx.globalAlpha = 1;
    const ufSel = this.opcoes.ufSelecionada;
    const ufHover = this.hover?.tipo === 'uf' ? this.hover.dados.uf : null;
    for (const f of this.feats) {
      if (f.uf !== ufSel && f.uf !== ufHover) continue;
      ctx.lineWidth = (f.uf === ufSel ? 2 : 1.25) / k;
      ctx.strokeStyle = f.uf === ufSel ? P.tinta2 : P.tinta3;
      ctx.stroke(contorno(f));
    }

    // --- realce de município e bairro (hover ou selecionado)
    for (const [item, forte] of [[this.destaque, true], [this.hover, false]]) {
      if (!item) continue;
      let path = null;
      if (item.tipo === 'municipio' || (item.tipo === 'cidade' && k >= K_LIMITES * 1.4)) {
        const m = this._malha(item.dados.uf);
        const it = m?.porIbge.get(item.dados.ibge);
        if (it) path = this._caminhoItem(it);
      } else if (item.tipo === 'bairro') {
        path = this.bairros.get(item.dados.ibge)?.itens.find((b) => b.id === item.dados.id)?.path;
      }
      if (!path) continue;
      ctx.globalAlpha = forte ? 0.55 : 0.4;
      ctx.fillStyle = P.acentoLavagem;
      ctx.fill(path, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.lineWidth = (forte ? 2 : 1.4) / k;
      ctx.strokeStyle = forte ? P.acento : P.tinta2;
      ctx.stroke(path);
    }

    // --- territórios e anotações
    if (this.camadas.territorios) {
      const hoverId = this.hover?.tipo === 'territorio' ? this.hover.dados.id : null;
      for (const tr of this.territorios) {
        if (!naTela(tr.bb)) continue;
        const sel = tr.id === this.terSel;
        const hov = tr.id === hoverId;
        const anot = tr.tipo === 'anotacao';
        const cor = this._cor(tr.cor);
        const esmaecer = this.terSel != null && !sel ? 0.45 : 1;
        const nova = this.realces.get(`t${tr.id}`);
        const pulso = this.realces.get(`sel${tr.id}`);
        const fEntrada = nova ? sairSuave(Math.min(1, (agora - nova) / 700)) : 1;
        const fPulso = pulso ? Math.sin(Math.min(1, (agora - pulso) / 700) * Math.PI) : 0;
        ctx.globalAlpha = ((sel ? 0.24 : hov ? 0.2 : anot ? 0.08 : 0.13) + 0.12 * fPulso) * esmaecer * fEntrada;
        ctx.fillStyle = cor;
        ctx.fill(tr.path, 'evenodd');
        if (sel || hov) {
          ctx.globalAlpha = 0.9 * fEntrada;
          ctx.lineWidth = (sel ? 5.5 : 4.5) / k;
          ctx.strokeStyle = P.superficie;
          ctx.stroke(tr.path);
        }
        ctx.globalAlpha = esmaecer * fEntrada;
        ctx.lineWidth = (sel ? 2.6 : hov ? 2.2 : 1.6) / k;
        ctx.strokeStyle = cor;
        if (anot) ctx.setLineDash([7 / k, 4 / k]);
        ctx.stroke(tr.path);
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    // --- área pendente (formulário aberto) e edição de vértices
    if (this.pendente) {
      const cor = this._cor(this.pendente.cor);
      const f = sairSuave(Math.min(1, (agora - this.pendente.t0) / 500));
      ctx.globalAlpha = 0.16 * f;
      ctx.fillStyle = cor;
      ctx.fill(this.pendente.path, 'evenodd');
      ctx.globalAlpha = f;
      ctx.lineWidth = 4.5 / k;
      ctx.strokeStyle = P.superficie;
      ctx.stroke(this.pendente.path);
      ctx.lineWidth = 2.2 / k;
      ctx.strokeStyle = cor;
      ctx.setLineDash([8 / k, 5 / k]);
      ctx.lineDashOffset = -((agora / 40) % 13) / k;
      ctx.stroke(this.pendente.path);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
      if (f < 1) this.redesenhar();
    }
    if (this.edicao) {
      const cor = this._cor(this.edicao.cor);
      const p = new Path2D();
      for (const pts of this.edicao.aneis) {
        p.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
        p.closePath();
      }
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = cor;
      ctx.fill(p, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.2 / k;
      ctx.strokeStyle = cor;
      ctx.stroke(p);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // --- cidades (bolhas)
    this.visiveis = [];
    const alfaCidades = 1 - 0.78 * this.alfaPontos;
    if (this.camadas.cidades && this.cidades.length) {
      const escala = 0.62 + 0.42 * Math.log2(Math.max(1, k));
      const n = this.ordemCidades.length;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = P.superficie;
      for (let i = 0; i < n; i++) {
        const c = this.ordemCidades[i];
        if (!c.base && !c.clientes) continue;
        const [x, y] = this.paraTela(c.bx, c.by);
        let r = Math.min(40, 0.9 + 0.23 * c.base * escala);
        if (x < -r || y < -r || x > w + r || y > h + r) continue;
        // entrada: bolhas crescem em ondas (maiores primeiro)
        const atraso = (i / n) * 0.45;
        const ge = Math.max(0, Math.min(1, (entrada - atraso) / 0.55));
        r *= ge < 1 ? sairSuave(ge) : 1;
        if (r < 0.4) continue;
        this.visiveis.push({ c, x, y, r });
        ctx.globalAlpha = alfaCidades * (r < 2.2 ? 0.5 : 0.88);
        ctx.fillStyle = P.prioridade[this._classePrioridade(c.prioridade)];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (r > 2.2) ctx.stroke();
      }
      // núcleo: onde já vendemos (clientes ativos)
      ctx.globalAlpha = alfaCidades;
      ctx.fillStyle = P.s1;
      ctx.strokeStyle = P.superficie;
      ctx.lineWidth = 1.5;
      for (const v of this.visiveis) {
        if (!v.c.clientes_ativos) continue;
        const r = Math.max(2.4, Math.min(v.r * 0.75, 1.6 + Math.sqrt(v.c.clientes_ativos) * 0.9 * Math.min(2, escala)));
        ctx.beginPath();
        ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- pontos (farmácias/clientes)
    if (this.alfaPontos > 0.01 && this.pontos.length) {
      const rProspect = Math.max(1.8, Math.min(3.6, 1.2 + Math.log2(k / K_PONTOS + 1) * 1.1));
      const grupos = { prospect: new Path2D(), forte: new Path2D(), cliente_ativo: new Path2D(), cliente_inativo: new Path2D() };
      for (const p of this.pontos) {
        const [x, y] = this.paraTela(p.bx, p.by);
        if (x < -6 || y < -6 || x > w + 6 || y > h + 6) continue;
        if (p.tipo === 'prospect') {
          const g = p.score >= 75 ? grupos.forte : grupos.prospect;
          const r = p.score >= 75 ? rProspect + 0.8 : rProspect;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, Math.PI * 2);
        } else {
          const g = grupos[p.tipo];
          g.moveTo(x + 4.6, y);
          g.arc(x, y, 4.6, 0, Math.PI * 2);
        }
      }
      ctx.globalAlpha = this.alfaPontos * 0.5;
      ctx.fillStyle = P.prospect;
      ctx.fill(grupos.prospect);
      ctx.globalAlpha = this.alfaPontos * 0.85;
      ctx.fillStyle = P.prospectForte;
      ctx.fill(grupos.forte);
      ctx.globalAlpha = this.alfaPontos;
      ctx.lineWidth = 2;
      ctx.strokeStyle = P.superficie;
      for (const [tipo, cor] of [['cliente_inativo', P.s2], ['cliente_ativo', P.s1]]) {
        ctx.stroke(grupos[tipo]);
        ctx.fillStyle = cor;
        ctx.fill(grupos[tipo]);
      }
      ctx.globalAlpha = 1;
    }

    // --- rótulos
    this._rotulos(agora);

    // --- hover e destaque (anel em volta de bolhas e pontos)
    for (const [item, forte] of [[this.destaque, true], [this.hover, false]]) {
      if (!item || (item.tipo !== 'cidade' && item.tipo !== 'ponto')) continue;
      let x;
      let y;
      let r;
      if (item.tipo === 'cidade') {
        const v = this.visiveis.find((q2) => q2.c.ibge === item.dados.ibge);
        if (!v) {
          const c = this.cidades.find((q2) => q2.ibge === item.dados.ibge);
          if (!c) continue;
          [x, y] = this.paraTela(c.bx, c.by);
          r = 6;
        } else ({ x, y, r } = v);
      } else {
        const p = item.dados;
        if (p.bx == null) {
          if (!p.lat) continue;
          const q2 = this.proj([p.lng, p.lat]);
          [x, y] = this.paraTela(q2[0], q2[1]);
        } else [x, y] = this.paraTela(p.bx, p.by);
        r = p.tipo === 'prospect' ? 4 : 5.5;
      }
      ctx.beginPath();
      ctx.arc(x, y, r + (forte ? 4 : 3), 0, Math.PI * 2);
      ctx.lineWidth = forte ? 2.5 : 2;
      ctx.strokeStyle = P.tinta;
      ctx.stroke();
      if (forte) {
        ctx.beginPath();
        ctx.arc(x, y, r + 8, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = P.tinta3;
        ctx.stroke();
      }
    }

    // --- rascunho (desenhando agora) e alças de edição
    this._desenharRascunho();
    this._desenharAlcas();
  }

  _bbUf(f) {
    if (!f._bb) {
      const [[o, s], [l, n]] = f.bounds;
      const a = this.proj([o, n]);
      const b = this.proj([l, s]);
      f._bb = [a[0], a[1], b[0], b[1]];
    }
    return f._bb;
  }

  _desenharRascunho() {
    const r = this.rascunho;
    if (!r || !r.pts.length) return;
    const { ctx, paleta: P } = this;
    const tela = r.pts.map(([x, y]) => this.paraTela(x, y));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const p = new Path2D();
    p.moveTo(tela[0][0], tela[0][1]);
    for (let i = 1; i < tela.length; i++) p.lineTo(tela[i][0], tela[i][1]);
    if (r.forma !== 'poligono') p.closePath();
    if (tela.length >= 3) {
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = P.acento;
      ctx.fill(p);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = P.superficie;
    ctx.stroke(p);
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.acento;
    ctx.stroke(p);
    if (r.forma === 'poligono') {
      if (r.cursor) {
        const [ux, uy] = tela[tela.length - 1];
        const [cx2, cy2] = r.fechar ? tela[0] : this.paraTela(r.cursor[0], r.cursor[1]);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ux, uy);
        ctx.lineTo(cx2, cy2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      tela.forEach(([x, y], i) => {
        const primeiro = i === 0;
        ctx.beginPath();
        ctx.arc(x, y, primeiro && r.fechar ? 7 : primeiro ? 5 : 3.6, 0, Math.PI * 2);
        ctx.fillStyle = primeiro && r.fechar ? P.acento : P.superficie;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = P.acento;
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  _desenharAlcas() {
    if (!this.edicao) return;
    const { ctx, paleta: P } = this;
    const cor = this._cor(this.edicao.cor);
    for (const pts of this.edicao.aneis) {
      if (pts.length > 600) continue;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const [mx, my] = this.paraTela((pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2);
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = P.superficie;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = cor;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const [bx, by] of pts) {
        const [x, y] = this.paraTela(bx, by);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = P.superficie;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cor;
        ctx.stroke();
      }
    }
  }

  _classePrioridade(p) {
    return p >= 80 ? 4 : p >= 70 ? 3 : p >= 58 ? 2 : p >= 45 ? 1 : 0;
  }

  _rotulos(agora) {
    const { ctx, paleta: P, w, h } = this;
    const k = this.vista.k;
    const ocupado = new Set();
    const celula = (x, y) => `${Math.floor(x / 90)}:${Math.floor(y / 22)}`;
    const livre = (x, y, larg) => {
      for (let dx = -larg / 2; dx <= larg / 2; dx += 45) if (ocupado.has(celula(x + dx, y))) return false;
      return true;
    };
    const marcar = (x, y, larg) => {
      for (let dx = -larg / 2; dx <= larg / 2; dx += 45) ocupado.add(celula(x + dx, y));
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // territórios primeiro: são o que o usuário desenhou
    if (this.camadas.territorios && this.territorios.length) {
      ctx.font = '600 11.5px "Inter Variable", system-ui, sans-serif';
      for (const t of this.territorios) {
        if (!t.rot) continue;
        const largTela = (t.bb[2] - t.bb[0]) * k;
        if (largTela < 70 && t.id !== this.terSel) continue;
        const [x, y] = this.paraTela(t.rot[0], t.rot[1]);
        if (x < 0 || x > w || y < 0 || y > h) continue;
        const texto = t.nome;
        const sub = t.vendedor?.nome ? t.vendedor.nome.split(' ')[0] : null;
        const larg = Math.max(ctx.measureText(texto).width, sub ? ctx.measureText(sub).width * 0.9 : 0) + 26;
        if (!livre(x, y, larg) && t.id !== this.terSel) continue;
        marcar(x, y, larg);
        marcar(x, y + 14, larg);
        const alt = sub ? 34 : 22;
        const esm = this.terSel != null && t.id !== this.terSel ? 0.55 : 1;
        ctx.globalAlpha = 0.94 * esm;
        ctx.fillStyle = P.superficieElevada;
        ctx.beginPath();
        ctx.roundRect(x - larg / 2, y - alt / 2, larg, alt, 8);
        ctx.fill();
        ctx.globalAlpha = esm;
        ctx.lineWidth = 1;
        ctx.strokeStyle = P.borda;
        ctx.stroke();
        ctx.fillStyle = this._cor(t.cor);
        ctx.beginPath();
        ctx.arc(x - larg / 2 + 10, y - (sub ? 6 : 0), 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = P.tinta;
        ctx.font = '600 11.5px "Inter Variable", system-ui, sans-serif';
        ctx.fillText(texto, x - larg / 2 + 18, y - (sub ? 6 : 0));
        if (sub) {
          ctx.fillStyle = P.tinta3;
          ctx.font = '500 10.5px "Inter Variable", system-ui, sans-serif';
          ctx.fillText(sub, x - larg / 2 + 18, y + 8);
        }
        ctx.textAlign = 'center';
        ctx.globalAlpha = 1;
      }
    }

    if (k < 2.6) {
      ctx.font = '600 10.5px "Inter Variable", system-ui, sans-serif';
      ctx.globalAlpha = 1 - rampa(k, 1.8, 2.6);
      for (const f of this.feats) {
        const [x, y] = this.paraTela(f.cbx, f.cby);
        if (f.uf === 'DF' && k < 1.8) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = P.halo;
        ctx.strokeText(f.uf, x, y);
        ctx.fillStyle = P.tinta3;
        ctx.fillText(f.uf, x, y);
        marcar(x, y, 30);
      }
      ctx.globalAlpha = 1;
    }

    // bairros: nomes em caixa alta discreta quando o bairro já tem tamanho na tela
    const aRot = this._alfaBairros() * rampa(k, K_BAIRROS * 2.2, K_BAIRROS * 4.5);
    if (aRot > 0.02) {
      ctx.font = '600 9.5px "Inter Variable", system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.06em';
      for (const b of this.bairros.values()) {
        if (!b.bb) continue;
        for (const it of b.itens) {
          if (!it.rot) continue;
          const largTela = (it.bb[2] - it.bb[0]) * k;
          if (largTela < 46) continue;
          const [x, y] = this.paraTela(it.rot[0], it.rot[1]);
          if (x < 20 || x > w - 20 || y < 10 || y > h - 10) continue;
          const texto = it.nome.toUpperCase();
          const larg = ctx.measureText(texto).width + 6;
          if (larg > largTela * 1.4 || !livre(x, y, larg)) continue;
          marcar(x, y, larg);
          ctx.globalAlpha = aRot * Math.min(1, (agora - b.t0) / 600);
          ctx.lineWidth = 3;
          ctx.strokeStyle = P.halo;
          ctx.strokeText(texto, x, y);
          ctx.fillStyle = P.tinta3;
          ctx.fillText(texto, x, y);
        }
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }

    if (!this.camadas.cidades && !this.pontosVisiveis()) return;
    if (k < 2.2) return;
    ctx.font = '550 11px "Inter Variable", system-ui, sans-serif';
    const limite = k > 30 ? 60 : k > 8 ? 40 : 22;
    let n = 0;
    const lista = [...this.visiveis].sort((a, b) => b.c.farmacias - a.c.farmacias);
    for (const v of lista) {
      if (n >= limite) break;
      if (v.x < 30 || v.x > w - 30 || v.y < 14 || v.y > h - 14) continue;
      const yRot = v.y + v.r + 9;
      const larg = ctx.measureText(v.c.nome).width + 8;
      if (!livre(v.x, yRot, larg)) continue;
      marcar(v.x, yRot, larg);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = P.halo;
      ctx.strokeText(v.c.nome, v.x, yRot);
      ctx.fillStyle = P.tinta2;
      ctx.fillText(v.c.nome, v.x, yRot);
      n++;
    }
  }
}

/** Lê os tokens do tema para o canvas (que precisa de cores resolvidas). */
export function lerPaleta(cor) {
  return {
    superficie: cor('--superficie') || '#fcfcfb',
    superficieElevada: cor('--superficie-elevada') || cor('--superficie') || '#ffffff',
    borda: cor('--borda') || 'rgba(0,0,0,.1)',
    halo: cor('--plano') || '#f4f4f1',
    tinta: cor('--tinta') || '#0b0b0b',
    tinta2: cor('--tinta-2') || '#52514e',
    tinta3: cor('--tinta-3') || '#898781',
    limite: cor('--mapa-limite') || cor('--tinta-3') || '#898781',
    acento: cor('--acento') || '#1c5cab',
    acentoLavagem: cor('--acento-lavagem') || 'rgba(28,92,171,.12)',
    ufNeutro: cor('--mapa-uf') || cor('--superficie-2'),
    ufContorno: cor('--mapa-uf-contorno') || cor('--superficie'),
    ufRampa: [cor('--mapa-uf-1'), cor('--mapa-uf-2'), cor('--mapa-uf-3'), cor('--mapa-uf-4')],
    prioridade: [cor('--mapa-p1'), cor('--mapa-p2'), cor('--mapa-p3'), cor('--mapa-p4'), cor('--mapa-p5')],
    s1: cor('--s1'),
    s2: cor('--s2'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cor(`--s${i}`)),
    prospect: cor('--mapa-prospect') || cor('--tinta-3'),
    prospectForte: cor('--mapa-prospect-forte') || cor('--tinta-2'),
  };
}
