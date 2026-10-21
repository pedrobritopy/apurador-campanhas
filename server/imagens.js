// Imagens de produtos, fabricantes e marcas (arquivos em dados/imagens, servidos em /imagens).
// As fotos reais e logos são montados pelos scripts de scripts/imagens; aqui só:
//  - o índice do que existe (para o front saber se é foto real ou ilustração e se há logo);
//  - a garantia de que todo produto tem imagem: produto novo sem arquivo ganha a embalagem ilustrada.
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { hash } from './pipeline.js';
import { ARQ_ORIGEM, PASTA_FABRICANTES, PASTA_MARCAS, PASTA_PRODUTOS, gravarOrigem, lerOrigem } from '../scripts/imagens/comum.mjs';

const MINI = path.join(PASTA_PRODUTOS, 'mini');
const listar = (pasta) => (fs.existsSync(pasta) ? fs.readdirSync(pasta) : []);
const mtime = (arq) => (fs.existsSync(arq) ? fs.statSync(arq).mtimeMs : 0);

export function assinaturaImagens() {
  let prod = { n: 0, max: 0, nomes: 0 };
  try {
    prod = db.prepare('SELECT COUNT(*) n, MAX(id_produto) max, SUM(LENGTH(nome_produto)) nomes FROM dm_produto').get();
  } catch { /* base vazia */ }
  return hash(prod, listar(PASTA_PRODUTOS).length, listar(MINI).length, mtime(ARQ_ORIGEM), listar(PASTA_FABRICANTES).length, listar(PASTA_MARCAS).length, mtime(PASTA_FABRICANTES), mtime(PASTA_MARCAS));
}

/** { produtos: { id: 'r' | 'i' }, fabricantes: [slug], marcas: [slug], reais, ilustradas } */
export function indiceImagens() {
  const produtos = {};
  let reais = 0;
  let ilustradas = 0;
  for (const [id, o] of lerOrigem()) {
    if (!fs.existsSync(path.join(MINI, `produto_${id}.webp`))) continue;
    produtos[id] = o.tipo === 'real' ? 'r' : 'i';
    if (o.tipo === 'real') reais++;
    else ilustradas++;
  }
  const slugs = (pasta, prefixo) => listar(pasta).filter((f) => f.startsWith(prefixo) && f.endsWith('.webp')).map((f) => f.slice(prefixo.length, -5));
  return { produtos, reais, ilustradas, fabricantes: slugs(PASTA_FABRICANTES, 'fabricante_'), marcas: slugs(PASTA_MARCAS, 'marca_') };
}

/** Gera a embalagem ilustrada para todo produto do cadastro que ainda não tem imagem. */
export async function garantirImagensProdutos({ pausa = async () => {} } = {}) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return { geradas: 0, aviso: 'sharp não instalado' };
  }
  const { svgEmbalagem } = await import('../scripts/imagens/ilustrar.mjs');
  fs.mkdirSync(MINI, { recursive: true });
  const origem = lerOrigem();
  const faltam = db.prepare('SELECT * FROM dm_produto').all().filter((p) => !fs.existsSync(path.join(MINI, `produto_${p.id_produto}.webp`)) || !fs.existsSync(path.join(PASTA_PRODUTOS, `produto_${p.id_produto}.webp`)));
  const agora = new Date().toISOString();
  let n = 0;
  for (const p of faltam) {
    const { svg, formato } = svgEmbalagem(p);
    const png = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).png().toBuffer();
    await sharp(png).webp({ quality: 86 }).toFile(path.join(PASTA_PRODUTOS, `produto_${p.id_produto}.webp`));
    await sharp(png).resize(128, 128).webp({ quality: 78 }).toFile(path.join(MINI, `produto_${p.id_produto}.webp`));
    origem.set(Number(p.id_produto), {
      id_produto: p.id_produto, arquivo: `produto_${p.id_produto}.webp`, tipo: 'ilustracao', fonte: 'Apurador de Campanhas (desenho próprio)',
      licenca: 'Uso interno; desenho gerado pelo sistema', autor: 'Apurador de Campanhas', formato, gerado_em: agora,
    });
    if (++n % 50 === 0) await pausa();
  }
  if (n) gravarOrigem(origem);
  return { geradas: n };
}
