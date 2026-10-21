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

export const seletorVazio = () => ({ fabricantes: [], marcas: [], subcategorias: [], grupos: [], ids: [], excluir: [] });

/** Grupos de produtos (linhas) salvos pelo usuário: id -> { nome, seletor } */
export function gruposDeProdutos() {
  return new Map(
    db.prepare('SELECT id, nome, seletor FROM grupo_produto').all().map((g) => {
      let seletor = {};
      try {
        seletor = JSON.parse(g.seletor);
      } catch {
        /* seletor inválido: grupo vazio */
      }
      return [Number(g.id), { nome: g.nome, seletor }];
    }),
  );
}

/**
 * Seletor de produtos:
 *  - filtros (fabricantes, marcas, subcategorias) se combinam com E;
 *  - "grupos" (linhas salvas) e "ids" adicionam produtos; "excluir" remove;
 *  - sem filtro, sem grupo e sem ids = todos os produtos.
 * @returns {number[]} ids de produto
 */
export function resolverProdutos(sel = {}, _profundidade = 0) {
  carregar();
  const fab = new Set(sel.fabricantes || []);
  const mar = new Set(sel.marcas || []);
  const sub = new Set(sel.subcategorias || []);
  const temFiltro = fab.size || mar.size || sub.size;
  const ids = (sel.ids || []).map(Number).filter((id) => porId.has(id));
  const grupos = (sel.grupos || []).map(Number).filter(Number.isFinite);
  const out = new Set();
  if (temFiltro) {
    for (const p of produtos) {
      if ((!fab.size || fab.has(p.fabricante)) && (!mar.size || mar.has(p.marca)) && (!sub.size || sub.has(p.subcategoria))) out.add(p.id);
    }
  }
  if (grupos.length && _profundidade < 3) {
    const mapa = gruposDeProdutos();
    for (const g of grupos) {
      const def = mapa.get(g);
      if (def) for (const id of resolverProdutos({ ...def.seletor, grupos: def.seletor.grupos || [] }, _profundidade + 1)) out.add(id);
    }
  }
  for (const id of ids) out.add(id);
  if (!temFiltro && !ids.length && !grupos.length) for (const p of produtos) out.add(p.id);
  for (const id of sel.excluir || []) out.delete(Number(id));
  return [...out];
}

export function descreverSeletor(sel = {}) {
  const partes = [];
  if (sel.fabricantes?.length) partes.push(`Fabricante: ${sel.fabricantes.join(', ')}`);
  if (sel.marcas?.length) partes.push(`Marca: ${sel.marcas.join(', ')}`);
  if (sel.subcategorias?.length) partes.push(`Subcategoria: ${sel.subcategorias.join(', ')}`);
  if (sel.grupos?.length) {
    const mapa = gruposDeProdutos();
    partes.push(`Linha: ${sel.grupos.map((g) => mapa.get(Number(g))?.nome || `#${g}`).join(', ')}`);
  }
  if (sel.ids?.length) partes.push(`${sel.ids.length} produto(s) avulso(s)`);
  if (sel.excluir?.length) partes.push(`exceto ${sel.excluir.length}`);
  return partes.length ? partes.join(' · ') : 'Todos os produtos';
}
