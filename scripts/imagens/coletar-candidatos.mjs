// Etapa 1: lista produtos das bases abertas Open Facts (Beauty, Food, Products) por marca.
// Uso: node scripts/imagens/coletar-candidatos.mjs <pasta-de-cache>
// Respeita o limite de buscas (10/min por servidor): uma busca a cada 6,5 s por servidor.
import fs from 'node:fs';
import path from 'node:path';
import { buscarJson, esperar, lerProdutos, slug } from './comum.mjs';

const pasta = process.argv[2];
if (!pasta) throw new Error('informe a pasta de cache');
fs.mkdirSync(pasta, { recursive: true });

const SERVIDORES = {
  obf: 'https://world.openbeautyfacts.org',
  off: 'https://world.openfoodfacts.org',
  opf: 'https://world.openproductsfacts.org',
};
const CAMPOS = 'code,product_name,product_name_pt,product_name_en,generic_name,brands,quantity,countries_tags,image_front_url,image_url,lang';

const marcas = [...new Set(lerProdutos().map((p) => p.marca.replace(/\s*Gen[eé]rico$/i, '').trim()))];

async function porServidor(sigla, base) {
  for (const marca of marcas) {
    const arq = path.join(pasta, `${sigla}_${slug(marca)}.json`);
    if (fs.existsSync(arq)) continue;
    const produtos = [];
    for (let pagina = 1; pagina <= 3; pagina++) {
      const url = `${base}/cgi/search.pl?action=process&tagtype_0=brands&tag_contains_0=contains&tag_0=${encodeURIComponent(marca)}&json=1&page_size=100&page=${pagina}&fields=${CAMPOS}`;
      let j = null;
      try {
        j = await buscarJson(url, { espera: 15000 });
      } catch (e) {
        console.log(sigla, marca, 'falhou:', e.message);
      }
      await esperar(6500);
      if (!j?.products?.length) break;
      produtos.push(...j.products);
      if (produtos.length >= (j.count || 0)) break;
    }
    fs.writeFileSync(arq, JSON.stringify(produtos));
    console.log(sigla, marca, produtos.length);
  }
}

await Promise.all(Object.entries(SERVIDORES).map(([s, b]) => porServidor(s, b)));
console.log('fim');
