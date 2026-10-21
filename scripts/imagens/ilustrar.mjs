// Embalagem ilustrada (SVG) para produtos sem foto real aberta.
// Desenho próprio e neutro: formato pela categoria, cor da marca, nome, apresentação,
// tarja (vermelha/preta) e faixa amarela de genérico como nas embalagens reais.
// Nunca imita logotipo nem arte real; o arquivo leva "ilustracao" no metadado.
import { semAcento } from './comum.mjs';

// cores aproximadas das marcas (só a cor; nenhuma arte da embalagem é copiada)
const CORES_MARCA = {
  sensodyne: '#5b2a86', mucilon: '#e2a524', allegra: '#6a2c91', 'la roche-posay': '#2f6db5', alivium: '#c8102e', cotonetes: '#1f63b6',
  arboreto: '#0f8a5f', colgate: '#d71920', bioderma: '#00a3e0', epocler: '#0b8a3a', kendall: '#00539f', 'oral-b': '#1d4f91', cerave: '#1c5aa8',
  tupi: '#1b7f3b', novalgina: '#d4252b', mucosolvan: '#0068b3', avene: '#7fb3d5', sonrisal: '#1a4c9a', 'lacto-purga': '#e1251b', neutrogena: '#0067b1',
  cebion: '#f39200', listerine: '#00843d', sorine: '#0072bc', rexona: '#00205b', 'g-tech': '#0099d8', vichy: '#1b4a8f', pantene: '#bf9b30',
  jontex: '#7a1f6e', engov: '#e30613', minancora: '#c8102e', tamarine: '#6b8e23', afrin: '#0055a5', 'band-aid': '#d50032', corega: '#00a9a5',
  buscopan: '#00529b', nivea: '#0a2c7a', vick: '#00843d', nan: '#2a7abf', dove: '#1d3c6e', merthiolate: '#b0122a', clearblue: '#003da5',
  'accu-chek': '#e2001a', advil: '#1e3f8a', protex: '#0072ce', bepantol: '#3a5ba8', doril: '#0067b1', polaramine: '#8a1538', bisolvon: '#00539b',
  always: '#5b2d90', floratil: '#e85d04', redoxon: '#f28c00', mam: '#00a0dc', 'philips avent': '#0b5ed7', naldecon: '#c41230', huggies: '#d2232a',
  fenergan: '#004f9f', salonpas: '#c8102e', centrum: '#0a3d91', nebacetin: '#00843d', tylenol: '#c8102e', andolba: '#0d6aa8', asseptgel: '#00a0e4',
  'biotonico fontoura': '#c8102e', cremer: '#00539f', ns: '#1d6fb8', sundown: '#f29400', plasil: '#005eb8', neve: '#2b5fa6', cicatricure: '#6b2c91',
  cimegripe: '#e30613', vitafor: '#00843d', strepsils: '#e2001a', 'head & shoulders': '#0057a8', rinosoro: '#00a3e0', dramin: '#1f4e9c',
  cataflam: '#e4002b', estomazil: '#0072bc', omron: '#005eb8', curaprox: '#e2001a', torsilax: '#00539f', addera: '#f39200', gaviscon: '#5c2d91',
  aptamil: '#0a3d91', neosaldina: '#d7282f', olla: '#d6006f', eno: '#00a3e0', eucerin: '#c8102e', histamin: '#00843d', resfenol: '#e30613',
  calminex: '#006aa7', hipoglos: '#00a0e4', dorflex: '#00529b', pharmaton: '#c8102e', luftal: '#0072bc', sanavita: '#78a22f', apolo: '#1b75bc',
  intimus: '#c2185b', coristina: '#e30613', gillette: '#1d3c6e', pampers: '#00a2a6', desalex: '#5b2a86', supradyn: '#f39200', neosoro: '#00a3e0',
  claritin: '#0058a3', farmax: '#00843d', gelol: '#00529b', missner: '#2c5aa0', aspirina: '#00843d', benegrip: '#e30613', episol: '#f39200',
  "johnson's baby": '#ec6fa0', lavitan: '#e4002b',
};
const PALETA = ['#2a5ca8', '#1b7f5a', '#9c2f4a', '#b5651d', '#5a3d8a', '#0f7c8c', '#8a6d1f', '#3b4d6b', '#a8323e', '#2e7d32'];

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function corDaMarca(marca) {
  const k = semAcento(String(marca || '').replace(/\s*Gen[eé]rico$/i, '')).toLowerCase().trim();
  return CORES_MARCA[k] || PALETA[hash(k) % PALETA.length];
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Mistura a cor com branco (t=0 cor, t=1 branco). */
function clarear(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
function escurecer(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - t)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const RX_APRES = /(\d+[.,]?\d*\s?(?:mg\/ml|mg\/g|mcg|mg|g|kg|ml|l|ui|%)(?:\s*\+\s*\d+[.,]?\d*\s?(?:mg|g|ml))?)/i;
const RX_QTD = /(\d+)\s*(comprimidos?|c[aá]psulas?|dr[aá]geas?|sach[eê]s?|envelopes?|flaconetes?|efervescentes?|unidades|un\b|gomas?|pastilhas?|tiras|lancetas|fraldas|ampolas?|ovulos?|adesivos?|cpr|caps)/i;

/** Separa linha do produto e apresentação a partir do nome. */
export function partesDoNome(nome, marca) {
  let resto = String(nome || '');
  const apres = [];
  const q = resto.match(RX_QTD);
  if (q) { apres.push(q[0]); resto = resto.replace(q[0], ' '); }
  const a = resto.match(RX_APRES);
  if (a) { apres.unshift(a[0]); resto = resto.replace(a[0], ' '); }
  const x = resto.match(/\bx\s?\d+\b/i);
  if (x) { apres.push(x[0]); resto = resto.replace(x[0], ' '); }
  const m = String(marca || '').replace(/\s*Gen[eé]rico$/i, '').trim();
  let linha = resto;
  if (m && m.length > 2) linha = linha.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  linha = linha.replace(/\s+/g, ' ').trim();
  if (!linha) linha = resto.replace(/\s+/g, ' ').trim();
  return { linha, apresentacao: apres.join(' · ').replace(/\s+/g, ' ').trim() };
}

const PRESCRICAO = /(omeprazol|pantoprazol|amoxicilina|azitromicina|cefalexina|ciprofloxacino|losartana|enalapril|captopril|atenolol|anlodipino|sinvastatina|atorvastatina|metformina|glibenclamida|levotiroxina|sertralina|fluoxetina|escitalopram|amitriptilina|clonazepam|alprazolam|diazepam|zolpidem|prednisona|dexametasona|cetoconazol comprimido|fluconazol|nimesulida|diclofenaco 50|meloxicam|tramadol|codeina|sildenafila|tadalafila|anticoncepcional|levonorgestrel|desogestrel|ivermectina|metronidazol|ranitidina|domperidona|ondansetrona|propranolol|hidroclorotiazida|furosemida|espironolactona|varfarina|clopidogrel|alendronato|rivotril)/i;
const CONTROLADO = /(clonazepam|alprazolam|diazepam|zolpidem|lorazepam|bromazepam|rivotril|tramadol|codeina|metilfenidato|morfina|oxicodona|fenobarbital|carbamazepina|sibutramina)/i;

/** Tarja e genérico: usa colunas do cadastro quando existem, senão heurística pelo nome. */
export function regulatorio(p) {
  const txt = semAcento(`${p.nome_produto} ${p.marca}`).toLowerCase();
  let tarja = String(p.tarja || '').toLowerCase();
  if (/preta/.test(tarja)) tarja = 'preta';
  else if (/vermelha/.test(tarja)) tarja = 'vermelha';
  else if (/sem tarja|livre|isento|mip/.test(tarja)) tarja = null;
  else tarja = CONTROLADO.test(txt) ? 'preta' : PRESCRICAO.test(txt) ? 'vermelha' : null;
  const tipo = String(p.tipo_produto || p.tipo || '').toLowerCase();
  const generico = /gen[eé]rico/i.test(tipo) || /gen[eé]rico/i.test(p.marca || '');
  return { tarja, generico };
}

/** Escolhe o formato da embalagem. */
export function formatoDe(p) {
  const t = semAcento(`${p.nome_produto} ${p.subcategoria}`).toLowerCase();
  if (/escova/.test(t)) return 'escova';
  if (/fralda|absorvente|lenco|algodao|hastes|cotonete|curativo|gaze|esparadrapo|protetor de seio|toalh|meia de compressao|meia elastica/.test(t)) return 'pacote';
  if (/preservativo|fio dental|mamadeira|chupeta|bico|teste de gravidez|tiras reagentes|lancetas/.test(t)) return 'caixa';
  if (/oximetro|termometro|medidor|aparelho|nebulizador|inalador|balanca|glicosimetro|monitor de|bomba tira-leite|esterilizador|equipamentos/.test(t)) return 'aparelho';
  if (/flaconete.*xs?d|d+s?xs?d+s?ml|ampolas?/.test(t)) return 'caixa';
  if (/(formula|leite|composto lacteo|aptamil|\bnan\b|mucilon|cereal infantil|suplemento em po|whey|po \d|\d+\s?g lata)/.test(t) && /\d{3,4}\s?g/.test(t)) return 'lata';
  if (/desodorante|aerossol|aerosol/.test(t) && !/roll|bastao|creme/.test(t)) return 'aerossol';
  if (/spray|nasal|jato/.test(t)) return 'spray';
  if (/xarope|solucao|gotas|suspensao|frasco|soro|alcool|agua termal|enxaguante|tonico|sabonete liquido|locao|shampoo|condicionador|oleo|demaquilante|micelar|antisseptico|flaconete|\d+\s?ml|\d+\s?l\b/.test(t)) {
    if (/creme|pomada|gel|baume|protetor solar|fps/.test(t) && /\b([1-9]\d?|1\d\d)\s?(ml|g)\b/.test(t) && !/xarope|gotas|solucao|locao|shampoo/.test(t)) return 'bisnaga';
    return 'frasco';
  }
  if (/creme|pomada|gel|baume|unguento|protetor|fps|bisnaga|hidratante|pasta|creme dental|dentifricio/.test(t)) return 'bisnaga';
  if (/sache|envelope|granulado|po para/.test(t)) return 'sache';
  return 'caixa';
}

function quebrar(texto, max, linhasMax = 3) {
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const w of palavras) {
    if ((atual + ' ' + w).trim().length > max && atual) { linhas.push(atual); atual = w; } else atual = (atual + ' ' + w).trim();
  }
  if (atual) linhas.push(atual);
  if (linhas.length > linhasMax) {
    const r = linhas.slice(0, linhasMax);
    r[linhasMax - 1] = r[linhasMax - 1].replace(/\s*\S*$/, '') + '…';
    return r;
  }
  return linhas;
}

const FONTE = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

function textoLinhas(linhas, x, y, tam, cor, peso = 600, anc = 'middle', alt = 1.18) {
  return linhas.map((l, i) => `<text x="${x}" y="${y + i * tam * alt}" font-family="${FONTE}" font-size="${tam}" font-weight="${peso}" fill="${cor}" text-anchor="${anc}">${esc(l)}</text>`).join('');
}

/** Ícone discreto do tipo de produto (pílula, gota, folha...). */
function icone(tipo, cx, cy, cor) {
  const c1 = cor, c2 = clarear(cor, 0.55);
  if (tipo === 'gota') return `<path d="M${cx} ${cy - 22} C${cx + 16} ${cy - 2} ${cx + 18} ${cy + 6} ${cx + 18} ${cy + 10} A18 18 0 0 1 ${cx - 18} ${cy + 10} C${cx - 18} ${cy + 6} ${cx - 16} ${cy - 2} ${cx} ${cy - 22} Z" fill="${c1}" opacity="0.85"/>`;
  if (tipo === 'folha') return `<path d="M${cx - 20} ${cy + 16} C${cx - 20} ${cy - 14} ${cx} ${cy - 22} ${cx + 22} ${cy - 20} C${cx + 22} ${cy + 4} ${cx + 6} ${cy + 18} ${cx - 20} ${cy + 16} Z" fill="${c1}" opacity="0.8"/>`;
  if (tipo === 'cruz') return `<path d="M${cx - 7} ${cy - 20} h14 v13 h13 v14 h-13 v13 h-14 v-13 h-13 v-14 h13 Z" fill="${c1}" opacity="0.85"/>`;
  return `<g transform="rotate(-35 ${cx} ${cy})"><rect x="${cx - 26}" y="${cy - 11}" width="52" height="22" rx="11" fill="${c2}"/><path d="M${cx} ${cy - 11} h15 a11 11 0 0 1 0 22 h-15 Z" fill="${c1}"/></g>`;
}
function tipoIcone(linha, apres, sub) {
  const t = semAcento(`${linha} ${apres} ${sub}`).toLowerCase();
  if (/gotas|xarope|solucao|soro|spray|ml|liquido|agua/.test(t)) return 'gota';
  if (/vitamina|suplemento|natural|fitoterap|ervas|dermocosm|hidrat|higiene|infantil|bucal|cabelo|shampoo/.test(t)) return 'folha';
  if (/curativo|primeiros socorros|antissept|band/.test(t)) return 'cruz';
  return 'pilula';
}

/** Rótulo (marca, linha, apresentação, tarja, genérico) desenhado num retângulo de largura w. */
function rotulo({ x, y, w, h, cor, marca, linha, apres, tarja, generico, sub = '', escuro = false, enfeite = true }) {
  const cx = x + w / 2;
  const tinta = escuro ? '#ffffff' : '#1d2433';
  // genérico: o princípio ativo é o destaque, o laboratório fica pequeno (como na embalagem real)
  const titulo = generico ? linha : marca;
  let corpo = generico ? '' : linha;
  if (!generico && semAcento(corpo).toLowerCase() === semAcento(marca).toLowerCase()) corpo = sub;
  const titTam = Math.min(30, Math.max(17, (w * 1.6) / Math.max(6, titulo.length)));
  const linhas = corpo ? quebrar(corpo, Math.max(10, Math.floor(w / 12.5)), 3) : [];
  const linhaTam = linhas.length > 2 ? 18 : 21;
  const th = tarja ? h * 0.11 : 0;
  let s = '';
  let topo = y;
  if (generico) {
    const gh = h * 0.15;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${gh}" fill="#ffd200"/>`;
    s += `<text x="${x + 14}" y="${y + gh * 0.83}" font-family="${FONTE}" font-size="${gh * 0.86}" font-weight="800" fill="#0c3c8c">G</text>`;
    s += `<text x="${x + 18 + gh * 0.62}" y="${y + gh * 0.45}" font-family="${FONTE}" font-size="${Math.min(13, gh * 0.24)}" font-weight="700" fill="#0c3c8c">MEDICAMENTO</text>`;
    s += `<text x="${x + 18 + gh * 0.62}" y="${y + gh * 0.78}" font-family="${FONTE}" font-size="${Math.min(13, gh * 0.24)}" font-weight="700" fill="#0c3c8c">GENÉRICO</text>`;
    topo += gh;
  }
  const bh = h * 0.2;
  s += `<rect x="${x}" y="${topo}" width="${w}" height="${bh}" fill="${cor}"/>`;
  const titLinhas = quebrar(titulo.toUpperCase(), Math.max(8, Math.floor(w / (titTam * 0.62))), 2);
  const tt = titLinhas.length > 1 ? Math.min(titTam, 20) : titTam;
  s += textoLinhas(titLinhas, cx, topo + bh / 2 + tt * 0.36 - (titLinhas.length - 1) * tt * 0.55, tt, '#ffffff', 800, 'middle', 1.1);
  let cursor = topo + bh + 30;
  if (generico) {
    s += textoLinhas([marca], cx, cursor - 2, 15, escurecer(cor, 0.1), 700);
    cursor += 22;
  }
  if (linhas.length) {
    s += textoLinhas(linhas, cx, cursor, linhaTam, tinta, 650);
    cursor += linhas.length * linhaTam * 1.18;
  }
  if (apres) {
    const pw = Math.min(w - 24, apres.length * 8.6 + 28);
    s += `<rect x="${cx - pw / 2}" y="${cursor - 12}" width="${pw}" height="28" rx="14" fill="${clarear(cor, escuro ? 0.25 : 0.86)}"/>`;
    s += textoLinhas([apres], cx, cursor + 7, 15, escuro ? '#ffffff' : escurecer(cor, 0.25), 650);
    cursor += 34;
  }
  // enfeite: onda suave + ícone, ocupa o espaço livre acima da tarja
  const base = y + h - th;
  const livre = base - cursor;
  if (enfeite && livre > 46) {
    const oy = Math.max(cursor + 6, base - Math.min(livre, h * 0.3));
    s += `<path d="M${x} ${oy + 18} C${x + w * 0.3} ${oy - 6} ${x + w * 0.55} ${oy + 30} ${x + w} ${oy + 4} L${x + w} ${base} L${x} ${base} Z" fill="${clarear(cor, escuro ? 0.15 : 0.82)}"/>`;
    s += `<path d="M${x} ${oy + 30} C${x + w * 0.35} ${oy + 8} ${x + w * 0.6} ${oy + 40} ${x + w} ${oy + 18} L${x + w} ${base} L${x} ${base} Z" fill="${clarear(cor, escuro ? 0.05 : 0.68)}" opacity="0.6"/>`;
    if (base - oy > 60) s += icone(tipoIcone(linha, apres, sub), x + w - 40, base - (base - oy) / 2 + 8, escuro ? '#ffffff' : cor);
  }
  if (tarja) {
    const ty = base;
    s += `<rect x="${x}" y="${ty}" width="${w}" height="${th}" fill="${tarja === 'preta' ? '#111111' : '#d4141c'}"/>`;
    s += textoLinhas(['VENDA SOB PRESCRIÇÃO MÉDICA'], cx, ty + th * 0.45, Math.min(11.5, w / 24), '#ffffff', 700);
    s += textoLinhas([tarja === 'preta' ? 'O ABUSO DESTE MEDICAMENTO PODE CAUSAR DEPENDÊNCIA' : 'SÓ PODE SER VENDIDO COM RETENÇÃO DA RECEITA'], cx, ty + th * 0.8, Math.min(7.6, w / 36), '#ffffff', 600);
  }
  return s;
}

const SOMBRA = '<ellipse cx="256" cy="452" rx="170" ry="16" fill="#0b1220" opacity="0.10"/>';

function caixa(o) {
  const { cor } = o;
  const x = 118, y = 96, w = 262, h = 340, d = 30;
  return `${SOMBRA}
  <path d="M${x} ${y} L${x + d} ${y - d * 0.62} L${x + w + d} ${y - d * 0.62} L${x + w} ${y} Z" fill="${clarear(cor, 0.55)}"/>
  <path d="M${x + w} ${y} L${x + w + d} ${y - d * 0.62} L${x + w + d} ${y + h - d * 0.62} L${x + w} ${y + h} Z" fill="${escurecer(cor, 0.18)}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>
  ${rotulo({ ...o, x, y, w, h })}
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#0b1220" stroke-opacity="0.08"/>`;
}

function aparelho(o) {
  const { cor } = o;
  const x = 96, y = 110, w = 320, h = 300, d = 26;
  const ic = `<g transform="translate(${x + w - 92} ${y + h - 96})" opacity="0.9"><rect width="64" height="72" rx="14" fill="${clarear(cor, 0.85)}" stroke="${cor}" stroke-width="3"/><rect x="12" y="12" width="40" height="24" rx="4" fill="${cor}"/><circle cx="32" cy="54" r="7" fill="${cor}"/></g>`;
  return `${SOMBRA}
  <path d="M${x} ${y} L${x + d} ${y - d * 0.62} L${x + w + d} ${y - d * 0.62} L${x + w} ${y} Z" fill="${clarear(cor, 0.55)}"/>
  <path d="M${x + w} ${y} L${x + w + d} ${y - d * 0.62} L${x + w + d} ${y + h - d * 0.62} L${x + w} ${y + h} Z" fill="${escurecer(cor, 0.18)}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>
  ${rotulo({ ...o, x, y, w, h, tarja: null, generico: false })}${ic}
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#0b1220" stroke-opacity="0.08"/>`;
}

function frasco(o) {
  const { cor } = o;
  const x = 150, y = 150, w = 212, h = 290;
  const tampa = `<rect x="${x + 58}" y="${y - 74}" width="${w - 116}" height="62" rx="8" fill="${escurecer(cor, 0.2)}"/><rect x="${x + 70}" y="${y - 18}" width="${w - 140}" height="22" fill="${clarear(cor, 0.4)}"/>`;
  return `${SOMBRA}${tampa}
  <path d="M${x + 40} ${y} Q${x} ${y + 10} ${x} ${y + 60} L${x} ${y + h - 18} Q${x} ${y + h} ${x + 18} ${y + h} L${x + w - 18} ${y + h} Q${x + w} ${y + h} ${x + w} ${y + h - 18} L${x + w} ${y + 60} Q${x + w} ${y + 10} ${x + w - 40} ${y} Z" fill="${clarear(cor, 0.9)}" stroke="#0b1220" stroke-opacity="0.08"/>
  ${rotulo({ ...o, x, y: y + 52, w, h: h - 70 })}
  <rect x="${x + 10}" y="${y + 60}" width="10" height="${h - 90}" rx="5" fill="#ffffff" opacity="0.35"/>`;
}

function spray(o) {
  const { cor } = o;
  const x = 176, y = 170, w = 160, h = 272;
  return `${SOMBRA}
  <path d="M${x + 58} ${y - 104} L${x + 102} ${y - 104} L${x + 96} ${y - 40} L${x + 64} ${y - 40} Z" fill="${clarear(cor, 0.5)}"/>
  <rect x="${x + 42}" y="${y - 44}" width="${w - 84}" height="46" rx="8" fill="${escurecer(cor, 0.15)}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" fill="${clarear(cor, 0.9)}" stroke="#0b1220" stroke-opacity="0.08"/>
  ${rotulo({ ...o, x, y: y + 24, w, h: h - 44 })}`;
}

function aerossol(o) {
  const { cor } = o;
  const x = 176, y = 128, w = 160, h = 314;
  return `${SOMBRA}
  <rect x="${x + 22}" y="${y - 54}" width="${w - 44}" height="58" rx="18" fill="${escurecer(cor, 0.25)}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${cor}"/>
  ${rotulo({ ...o, x, y: y + 30, w, h: h - 60, escuro: true })}
  <rect x="${x + 12}" y="${y + 16}" width="10" height="${h - 32}" rx="5" fill="#ffffff" opacity="0.18"/>`;
}

function bisnaga(o) {
  const { cor } = o;
  // bisnaga deitada levemente inclinada
  return `${SOMBRA}
  <g transform="rotate(-8 256 270)">
    <path d="M86 186 L392 160 Q414 158 414 180 L414 360 Q414 382 392 380 L86 354 Z" fill="#ffffff" stroke="#0b1220" stroke-opacity="0.08"/>
    <path d="M70 180 L92 182 L92 358 L70 360 Z" fill="${escurecer(cor, 0.12)}"/>
    <rect x="414" y="232" width="38" height="76" rx="8" fill="${escurecer(cor, 0.2)}"/>
    ${rotulo({ ...o, x: 120, y: 182, w: 270, h: 176, enfeite: false })}
  </g>`;
}

function lata(o) {
  const { cor } = o;
  const x = 126, y = 136, w = 260, h = 300;
  return `${SOMBRA}
  <ellipse cx="${x + w / 2}" cy="${y}" rx="${w / 2}" ry="26" fill="${escurecer(cor, 0.2)}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>
  <ellipse cx="${x + w / 2}" cy="${y + h}" rx="${w / 2}" ry="26" fill="#ffffff"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#0b1220" stroke-opacity="0.06"/>
  ${rotulo({ ...o, x, y: y + 20, w, h: h - 30 })}
  <ellipse cx="${x + w / 2}" cy="${y}" rx="${w / 2 - 14}" ry="18" fill="${clarear(cor, 0.6)}"/>`;
}

function pacote(o) {
  const { cor } = o;
  return `${SOMBRA}
  <path d="M120 120 Q256 96 392 120 L404 420 Q256 440 108 420 Z" fill="${clarear(cor, 0.88)}" stroke="#0b1220" stroke-opacity="0.08"/>
  <path d="M120 120 Q256 96 392 120 L394 150 Q256 128 118 150 Z" fill="${escurecer(cor, 0.1)}"/>
  ${rotulo({ ...o, x: 134, y: 160, w: 244, h: 240 })}`;
}

function sache(o) {
  const { cor } = o;
  return `${SOMBRA}
  <path d="M146 96 L366 96 L376 430 L136 430 Z" fill="#ffffff" stroke="#0b1220" stroke-opacity="0.08"/>
  <path d="M146 96 L366 96 L367 122 L145 122 Z" fill="${escurecer(cor, 0.15)}"/>
  <path d="M137 404 L375 404 L376 430 L136 430 Z" fill="${escurecer(cor, 0.15)}"/>
  ${rotulo({ ...o, x: 150, y: 128, w: 212, h: 270 })}`;
}

function escova(o) {
  const { cor } = o;
  return `${SOMBRA}
  <rect x="150" y="70" width="212" height="372" rx="16" fill="${clarear(cor, 0.9)}" stroke="#0b1220" stroke-opacity="0.08"/>
  <g transform="rotate(-6 256 300)"><rect x="236" y="96" width="40" height="120" rx="14" fill="#ffffff" stroke="${cor}" stroke-width="3"/>
  <rect x="244" y="104" width="24" height="70" rx="6" fill="${clarear(cor, 0.55)}"/><rect x="242" y="214" width="28" height="210" rx="13" fill="${cor}"/></g>
  ${rotulo({ ...o, x: 150, y: 250, w: 212, h: 180, tarja: null, generico: false })}`;
}

const DESENHOS = { caixa, aparelho, frasco, spray, aerossol, bisnaga, lata, pacote, sache, escova };

/** SVG 512x512 da embalagem ilustrada. */
export function svgEmbalagem(p) {
  const formato = formatoDe(p);
  const { tarja, generico } = regulatorio(p);
  const cor = corDaMarca(p.marca);
  const marca = String(p.marca || p.fabricante || '').replace(/\s*Gen[eé]rico$/i, '').trim() || 'Produto';
  const { linha, apresentacao } = partesDoNome(p.nome_produto, p.marca);
  const corpo = DESENHOS[formato]({ cor, marca, linha, apres: apresentacao, tarja, generico, sub: p.subcategoria || '' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Ilustração: ${esc(p.nome_produto)}</title>${corpo}</svg>`;
  return { svg, formato, tarja, generico, cor };
}
