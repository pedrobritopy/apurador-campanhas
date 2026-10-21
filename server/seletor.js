import { db, versaoDados } from './db.js';

let versaoCache = -1;
let produtos = [];
let porId = new Map();

function carregar() {
  if (versaoCache === versaoDados()) return;
  produtos = db
    .prepare(
      `SELECT id_produto AS id, nome_produto AS nome, fabricante, marca, categoria, subcategoria, ean,
              preco_lista AS preco, status AS ativo
         FROM dm_produto ORDER BY nome_produto`,
    )
    .all()
    .map((r) => ({ ...r }));
  porId = new Map(produtos.map((p) => [p.id, p]));
  versaoCache = versaoDados();
}

export function catalogoProdutos() {
  carregar();
  return produtos;
}

export function produtoPorId(id) {
  carregar();
  return porId.get(Number(id));
}

export const seletorVazio = () => ({ fabricantes: [], marcas: [], subcategorias: [], ids: [], excluir: [] });

/**
 * Seletor de produtos:
 *  - filtros (fabricantes, marcas, subcategorias) se combinam com E;
 *  - "ids" adiciona produtos avulsos; "excluir" remove;
 *  - sem filtro e sem ids = todos os produtos.
 * @returns {number[]} ids de produto
 */
export function resolverProdutos(sel = {}) {
  carregar();
  const fab = new Set(sel.fabricantes || []);
  const mar = new Set(sel.marcas || []);
  const sub = new Set(sel.subcategorias || []);
  const temFiltro = fab.size || mar.size || sub.size;
  const ids = (sel.ids || []).map(Number).filter((id) => porId.has(id));
  const out = new Set();
  if (temFiltro) {
    for (const p of produtos) {
      if ((!fab.size || fab.has(p.fabricante)) && (!mar.size || mar.has(p.marca)) && (!sub.size || sub.has(p.subcategoria))) out.add(p.id);
    }
  }
  for (const id of ids) out.add(id);
  if (!temFiltro && !ids.length) for (const p of produtos) out.add(p.id);
  for (const id of sel.excluir || []) out.delete(Number(id));
  return [...out];
}

export function descreverSeletor(sel = {}) {
  const partes = [];
  if (sel.fabricantes?.length) partes.push(`Fabricante: ${sel.fabricantes.join(', ')}`);
  if (sel.marcas?.length) partes.push(`Marca: ${sel.marcas.join(', ')}`);
  if (sel.subcategorias?.length) partes.push(`Subcategoria: ${sel.subcategorias.join(', ')}`);
  if (sel.ids?.length) partes.push(`${sel.ids.length} produto(s) avulso(s)`);
  if (sel.excluir?.length) partes.push(`exceto ${sel.excluir.length}`);
  return partes.length ? partes.join(' · ') : 'Todos os produtos';
}
