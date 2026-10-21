// Etapa 3: escolhe a imagem de cada produto e grava as versões normalizadas.
// Ordem: foto real pelo EAN (Open Facts) > foto real por nome dentro da marca (Open Facts) > ilustração própria.
// Incremental e retomável: pula produto que já tem imagem válida, a não ser que surja foto real melhor.
//
// Uso: node scripts/imagens/montar-imagens.mjs --cache <pasta-cache> [--brutas <pasta-downloads>] [--so-ilustrar] [--refazer-ilustracoes]
//   <pasta-cache>: onde ficam candidatos (obf_*.json...), ean.json; <pasta-downloads>: pasta própria para arquivos baixados.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PASTA_PRODUTOS, baixar, eanDoProduto, gravarOrigem, lerOrigem, lerProdutos, mapaEans, semAcento, slug } from './comum.mjs';
import { svgEmbalagem } from './ilustrar.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const pastaCache = opt('--cache');
const pastaBrutas = opt('--brutas') || (pastaCache ? path.join(pastaCache, '..', 'brutas') : null);
const soIlustrar = args.includes('--so-ilustrar');
const refazerIlustr = args.includes('--refazer-ilustracoes');
const simular = args.includes('--simular'); // só lista as correspondências, sem baixar nem gravar

const MINI = path.join(PASTA_PRODUTOS, 'mini');
fs.mkdirSync(MINI, { recursive: true });
if (pastaBrutas) fs.mkdirSync(pastaBrutas, { recursive: true });
const origem = lerOrigem();
const temArquivo = (id) => fs.existsSync(path.join(PASTA_PRODUTOS, `produto_${id}.webp`)) && fs.existsSync(path.join(MINI, `produto_${id}.webp`));

// ------------------------------------------------------------------ correspondência por nome
const PARADAS = new Set('de da do das dos e com para sem em a o ao x un unidade unidades the and with for of de la le les et pour avec en el'.split(' '));
// termos genéricos (pt/en/fr/es) traduzidos para uma raiz comum, para comparar nomes em línguas diferentes
const SINONIMOS = [
  [/hidratante|moisturi[sz]\w*|hydrat\w*|hidratan\w*/g, 'hidrat'], [/loc(a|ã)o|lotion/g, 'locao'], [/creme|cream|creme|crema/g, 'creme'],
  [/gel de limpeza|cleanser|cleansing|nettoyant|limpieza|limpeza|foaming/g, 'limpeza'], [/protetor solar|sunscreen|solaire|solar|sun/g, 'solar'],
  [/shampoo|champu|shampooing/g, 'shampoo'], [/condicionador|conditioner|apres-shampooing|acondicionador/g, 'condicionador'],
  [/desodorante|deodorant|deodorante|antitranspirante|antiperspirant/g, 'desodorante'], [/creme dental|pasta de dente|toothpaste|dentifrice|dentifrico/g, 'dental'],
  [/enxaguante bucal|enxaguante|mouthwash|bain de bouche|enjuague/g, 'enxaguante'], [/escova dental|escova|toothbrush|brosse/g, 'escova'],
  [/fio dental|floss/g, 'fio'], [/sabonete liquido|liquid soap|savon liquide/g, 'sabliq'], [/sabonete|soap|savon|jabon/g, 'sabonete'],
  [/agua termal|thermal water|eau thermale|thermal spring water/g, 'termal'], [/agua micelar|micellar|micellaire/g, 'micelar'],
  [/oleo|oil|huile|aceite/g, 'oleo'], [/serum|sérum/g, 'serum'], [/fralda|diaper|nappy|couche|panal/g, 'fralda'], [/lenco umedecido|wipes|lingettes|toallitas/g, 'lenco'],
  [/absorvente|pads|serviette|toalla femenina/g, 'absorvente'], [/infantil|baby|bebe|kids|enfant/g, 'bebe'], [/sensivel|sensitive|sensible/g, 'sensivel'],
  [/clareador|whitening|blancheur|blanqueador/g, 'branco'], [/anticaspa|anti-dandruff|antipelliculaire/g, 'caspa'],
];
function normalizar(txt) {
  let t = semAcento(String(txt || '')).toLowerCase().replace(/[®™]/g, ' ');
  for (const [re, raiz] of SINONIMOS) t = t.replace(re, ` ${raiz} `);
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(txt, excluir = new Set()) {
  return normalizar(txt).split(' ').filter((w) => w.length > 1 && !PARADAS.has(w) && !excluir.has(w));
}
const TAMANHO = /(\d+(?:[.,]\d+)?)\s?(ml|g|kg|l|un|mg)\b/i;
function tamanho(txt) {
  const m = String(txt || '').toLowerCase().replace(',', '.').match(TAMANHO);
  if (!m) return null;
  let v = Number(m[1]); let u = m[2];
  if (u === 'kg') { v *= 1000; u = 'g'; }
  if (u === 'l') { v *= 1000; u = 'ml'; }
  return { v, u };
}
const RAIZES = new Set(SINONIMOS.map((s) => s[1]));

/** Pontua o quanto um item das bases abertas parece com o nosso produto (0 a 1). */
function pontuar(prod, cand) {
  const marcaTok = new Set(tokens(prod.marca.replace(/gen[eé]rico/i, '')).concat(tokens(prod.fabricante)));
  const nosso = tokens(prod.nome_produto, marcaTok).filter((w) => !/^\d/.test(w));
  const nome = cand.product_name_pt || cand.product_name || cand.product_name_en || '';
  const deles = new Set(tokens(`${nome} ${cand.generic_name || ''}`, marcaTok).filter((w) => !/^\d/.test(w)));
  if (!nosso.length || !deles.size) return 0;
  const distintivos = nosso.filter((w) => !RAIZES.has(w));
  const comuns = nosso.filter((w) => deles.has(w));
  const distComuns = distintivos.filter((w) => deles.has(w));
  let s = comuns.length / Math.max(nosso.length, Math.min(deles.size, nosso.length + 2));
  if (distintivos.length && !distComuns.length) s *= 0.35; // linha do produto (Hydro Boost, Anthelios...) precisa bater
  // tipo de produto diferente (ex.: nosso é creme dental, o deles é fio dental) derruba a nota
  const tiposNossos = new Set(nosso.filter((w) => RAIZES.has(w)));
  const tiposDeles = [...deles].filter((w) => RAIZES.has(w));
  if (tiposDeles.some((w) => !tiposNossos.has(w)) && tiposNossos.size) s *= 0.5;
  else if (tiposNossos.size && !tiposDeles.some((w) => tiposNossos.has(w))) s *= 0.6; // não diz que é o mesmo tipo de produto
  const t1 = tamanho(prod.nome_produto); const t2 = tamanho(`${cand.quantity || ''} ${nome}`);
  if (t1 && t2 && t1.u === t2.u) s += Math.abs(t1.v - t2.v) / t1.v < 0.12 ? 0.15 : -0.1;
  if ((cand.countries_tags || []).includes('en:brazil')) s += 0.08;
  return Math.max(0, Math.min(1, s));
}
function mesmaMarca(prod, cand) {
  const nossa = [prod.marca.replace(/gen[eé]rico/i, ''), prod.fabricante].map((x) => slug(x)).filter(Boolean);
  const deles = slug(cand.brands || '');
  return nossa.some((n) => n.length > 2 && deles.includes(n));
}

// ------------------------------------------------------------------ fontes
const cacheEan = pastaCache && fs.existsSync(path.join(pastaCache, 'ean.json')) ? JSON.parse(fs.readFileSync(path.join(pastaCache, 'ean.json'), 'utf8')) : {};
const candidatosPorMarca = new Map();
function candidatosDaMarca(marca) {
  const m = slug(marca.replace(/\s*Gen[eé]rico$/i, '').trim());
  if (candidatosPorMarca.has(m)) return candidatosPorMarca.get(m);
  const lista = [];
  for (const s of ['obf', 'off', 'opf']) {
    const arq = pastaCache && path.join(pastaCache, 'candidatos', `${s}_${m}.json`);
    if (arq && fs.existsSync(arq)) for (const c of JSON.parse(fs.readFileSync(arq, 'utf8'))) if (c.image_front_url) lista.push({ ...c, _fonte: s });
  }
  candidatosPorMarca.set(m, lista);
  return lista;
}
const NOME_FONTE = { obf: 'Open Beauty Facts', off: 'Open Food Facts', opf: 'Open Products Facts' };
const SITE = { obf: 'https://world.openbeautyfacts.org', off: 'https://world.openfoodfacts.org', opf: 'https://world.openproductsfacts.org' };

function melhorFoto(prod, ean) {
  if (ean && cacheEan[ean]) {
    for (const s of ['obf', 'off', 'opf']) {
      const c = cacheEan[ean][s];
      if (c?.image_front_url && mesmaMarca(prod, c)) return { c, fonte: s, confianca: 'alta (EAN)', ean };
    }
  }
  const usados = new Set();
  let melhor = null;
  for (const c of candidatosDaMarca(prod.marca)) {
    if (usados.has(c.code)) continue;
    const p = pontuar(prod, c);
    if (!melhor || p > melhor.p) melhor = { c, p, fonte: c._fonte };
  }
  if (melhor && melhor.p >= 0.62) return { ...melhor, confianca: melhor.p >= 0.8 ? 'alta (nome)' : 'media (nome)' };
  return null;
}

// ------------------------------------------------------------------ gravação
async function gravar(id, entrada, { fundo = '#ffffff' } = {}) {
  const base = sharp(entrada, { failOn: 'error', limitInputPixels: 60e6 }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height || meta.width < 80 || meta.height < 80) throw new Error('imagem pequena ou inválida');
  const limpa = await base.flatten({ background: fundo }).trim({ background: fundo, threshold: 18 }).toBuffer().catch(() => sharp(entrada).flatten({ background: fundo }).toBuffer());
  const corpo = await sharp(limpa).resize(440, 440, { fit: 'contain', background: fundo }).extend({ top: 36, bottom: 36, left: 36, right: 36, background: fundo }).toBuffer();
  await sharp(corpo).webp({ quality: 82, effort: 4 }).toFile(path.join(PASTA_PRODUTOS, `produto_${id}.webp`));
  await sharp(corpo).resize(128, 128).webp({ quality: 74, effort: 4 }).toFile(path.join(MINI, `produto_${id}.webp`));
}

async function ilustrar(p) {
  const { svg, formato } = svgEmbalagem(p);
  const png = await sharp(Buffer.from(svg), { density: 96 }).flatten({ background: '#ffffff' }).png().toBuffer();
  await sharp(png).webp({ quality: 86, effort: 4 }).withExifMerge({ IFD0: { ImageDescription: 'ilustracao (embalagem desenhada pelo sistema, nao e foto real)', Software: 'Apurador de Campanhas' } }).toFile(path.join(PASTA_PRODUTOS, `produto_${p.id_produto}.webp`));
  await sharp(png).resize(128, 128).webp({ quality: 78, effort: 4 }).toFile(path.join(MINI, `produto_${p.id_produto}.webp`));
  return formato;
}

// ------------------------------------------------------------------ execução
const produtos = lerProdutos();
const mapa = mapaEans();
const agora = new Date().toISOString();
const cont = { real: 0, ilustr: 0, pulados: 0, erros: 0, upgrade: 0 };
const fila = [...produtos];
let feitos = 0;

async function processar(p) {
  const atual = origem.get(p.id_produto);
  const ean = eanDoProduto(p, mapa);
  const jaReal = atual?.tipo === 'real' && temArquivo(p.id_produto);
  if (jaReal) { cont.pulados++; return; }
  if (!soIlustrar && pastaBrutas) {
    const f = melhorFoto(p, ean);
    if (f && simular) { console.log(`${p.id_produto}	${f.confianca}	${p.nome_produto}  =>  ${f.c.product_name || ''} (${f.c.brands || ''}) ${f.c.quantity || ''} [${f.fonte}]`); cont.real++; return; }
    if (simular) return;
    if (f) {
      const url = f.c.image_front_url.replace(/\.(200|400)\.jpg$/, '.full.jpg');
      const destino = path.join(pastaBrutas, `${f.fonte}_${f.c.code}.img`);
      try {
        const buf = fs.existsSync(destino) ? fs.readFileSync(destino) : await baixar(url, destino).catch(() => baixar(f.c.image_front_url, destino));
        await gravar(p.id_produto, buf);
        origem.set(p.id_produto, {
          id_produto: p.id_produto, arquivo: `produto_${p.id_produto}.webp`, tipo: 'real', fonte: NOME_FONTE[f.fonte], confianca: f.confianca,
          ean_usado: f.ean || '', nome_encontrado: `${f.c.product_name || f.c.product_name_pt || ''} (${f.c.brands || ''}) ${f.c.quantity || ''}`.trim(),
          url_origem: url, pagina: `${SITE[f.fonte]}/product/${f.c.code}`, licenca: 'CC BY-SA 3.0 (imagem) / ODbL (dados)',
          autor: `Colaboradores do ${NOME_FONTE[f.fonte]}`, formato: '', gerado_em: agora,
        });
        if (atual?.tipo === 'ilustracao') cont.upgrade++;
        cont.real++;
        return;
      } catch (e) {
        cont.erros++;
        console.log('falha foto', p.id_produto, e.message);
      }
    }
  }
  if (atual?.tipo === 'ilustracao' && temArquivo(p.id_produto) && !refazerIlustr) { cont.pulados++; return; }
  const formato = await ilustrar(p);
  origem.set(p.id_produto, {
    id_produto: p.id_produto, arquivo: `produto_${p.id_produto}.webp`, tipo: 'ilustracao', fonte: 'Apurador de Campanhas (desenho próprio)', confianca: '',
    ean_usado: ean || '', nome_encontrado: '', url_origem: '', pagina: '', licenca: 'Uso interno; desenho gerado pelo sistema', autor: 'Apurador de Campanhas', formato, gerado_em: agora,
  });
  cont.ilustr++;
}

async function trabalhador() {
  while (fila.length) {
    const p = fila.shift();
    try { await processar(p); } catch (e) { cont.erros++; console.log('erro', p.id_produto, e.message); }
    if (++feitos % 200 === 0) {
      console.log(`${feitos}/${produtos.length}`, JSON.stringify(cont));
      gravarOrigem(origem);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, trabalhador));
if (!simular) gravarOrigem(origem);
console.log('fim', JSON.stringify(cont));
