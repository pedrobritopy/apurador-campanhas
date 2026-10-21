// Etapa 2: procura logos de fabricantes e marcas no Wikidata (propriedade P154) e a licença no Commons.
// Uso: node scripts/imagens/buscar-logos.mjs <saida.json>
// Só lista candidatos; a escolha final passa por revisão (ver logos-revisados.json).
import fs from 'node:fs';
import { buscarJson, esperar, lerProdutos } from './comum.mjs';

const saida = process.argv[2];
const prods = lerProdutos();
const nomes = [
  ...new Set(prods.map((p) => p.fabricante)),
].map((n) => ({ tipo: 'fabricante', nome: n }))
  .concat([...new Set(prods.map((p) => p.marca.replace(/\s*Gen[eé]rico$/i, '').trim()))].map((n) => ({ tipo: 'marca', nome: n })));

const WD = 'https://www.wikidata.org/w/api.php';
const CM = 'https://commons.wikimedia.org/w/api.php';
const out = fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, 'utf8')) : [];
const feito = new Set(out.map((o) => `${o.tipo}|${o.nome}`));
for (const item of nomes) {
  if (feito.has(`${item.tipo}|${item.nome}`)) continue;
  const cands = [];
  for (const lang of ['pt', 'en']) {
    const s = await buscarJson(`${WD}?action=wbsearchentities&search=${encodeURIComponent(item.nome)}&language=${lang}&uselang=${lang}&limit=7&format=json`);
    for (const e of s?.search || []) if (!cands.some((c) => c.id === e.id)) cands.push({ id: e.id, label: e.label, descricao: e.description || '' });
    await esperar(1200);
  }
  if (!cands.length) { out.push({ ...item, candidatos: [] }); fs.writeFileSync(saida, JSON.stringify(out, null, 1)); continue; }
  const ent = await buscarJson(`${WD}?action=wbgetentities&ids=${cands.map((c) => c.id).join('|')}&props=claims&format=json`);
  for (const c of cands) {
    const cl = ent?.entities?.[c.id]?.claims || {};
    c.logo = cl.P154?.[0]?.mainsnak?.datavalue?.value || null;
    c.tipos = (cl.P31 || []).map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean);
    c.site = cl.P856?.[0]?.mainsnak?.datavalue?.value || null;
  }
  const comLogo = cands.filter((c) => c.logo);
  for (const c of comLogo) {
    const ii = await buscarJson(`${CM}?action=query&titles=${encodeURIComponent(`File:${c.logo}`)}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=512&format=json`);
    const pg = Object.values(ii?.query?.pages || {})[0];
    const inf = pg?.imageinfo?.[0];
    if (inf) {
      const m = inf.extmetadata || {};
      c.url = inf.url;
      c.mime = inf.mime;
      c.licenca = m.LicenseShortName?.value || null;
      c.licenca_url = m.LicenseUrl?.value || null;
      c.autor = (m.Artist?.value || '').replace(/<[^>]+>/g, '').trim() || null;
      c.pagina = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(c.logo.replace(/ /g, '_'))}`;
    }
    await esperar(800);
  }
  out.push({ ...item, candidatos: cands });
  fs.writeFileSync(saida, JSON.stringify(out, null, 1));
  console.log(item.tipo, item.nome, comLogo.map((c) => `${c.id} ${c.label} (${c.descricao}) ${c.licenca || ''}`).join(' | ') || '-');
}
fs.writeFileSync(saida, JSON.stringify(out, null, 1));
