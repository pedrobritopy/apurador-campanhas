// Etapa 1b: consulta cada EAN real nas bases Open Facts (Beauty, Food, Products), com cache retomável.
// Uso: node scripts/imagens/buscar-ean.mjs <arquivo-cache.json>
// Ritmo: ~85 consultas/min por servidor (limite público de 100/min para leitura de produto).
import fs from 'node:fs';
import { buscarJson, eanDoProduto, esperar, lerProdutos, mapaEans } from './comum.mjs';

const arq = process.argv[2];
if (!arq) throw new Error('informe o arquivo de cache');
const cache = fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : {};
const SERV = { obf: 'https://world.openbeautyfacts.org', off: 'https://world.openfoodfacts.org', opf: 'https://world.openproductsfacts.org' };
const CAMPOS = 'code,product_name,product_name_pt,product_name_en,brands,quantity,countries_tags,image_front_url,image_url';

const mapa = mapaEans();
const eans = [...new Set(lerProdutos().map((p) => eanDoProduto(p, mapa)).filter(Boolean))];
console.log('EANs válidos:', eans.length);
let salvos = 0;
const salvar = () => fs.writeFileSync(arq, JSON.stringify(cache));

async function servidor(sigla, base) {
  for (const ean of eans) {
    const c = (cache[ean] ||= {});
    if (c[sigla] !== undefined) continue;
    if (Object.values(c).some((v) => v && v.image_front_url)) continue; // já achou foto em outro servidor
    try {
      const j = await buscarJson(`${base}/api/v2/product/${ean}.json?fields=${CAMPOS}`, { espera: 10000 });
      c[sigla] = j?.status === 1 && j.product ? j.product : null;
    } catch (e) {
      console.log(sigla, ean, e.message);
    }
    if (++salvos % 25 === 0) salvar();
    await esperar(700);
  }
}
await Promise.all(Object.entries(SERV).map(([s, b]) => servidor(s, b)));
salvar();
const achados = Object.values(cache).filter((c) => Object.values(c).some((v) => v?.image_front_url)).length;
console.log('com foto:', achados, 'de', eans.length);
