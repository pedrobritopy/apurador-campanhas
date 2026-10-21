// Carrega módulos opcionais (implementados por partes independentes) sem derrubar quem depende deles.
const cache = new Map();

/** @returns {Promise<object|null>} o módulo, ou null se ainda não existir */
export async function opcional(caminho) {
  if (cache.has(caminho)) return cache.get(caminho);
  try {
    const mod = await import(caminho);
    cache.set(caminho, mod);
    return mod;
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(`[opcional] ${caminho}:`, e.message);
    return null;
  }
}

/** Chama fn do módulo opcional; devolve `padrao` se o módulo/função não existir ou falhar. */
export async function chamarOpcional(caminho, fn, args = [], padrao = null) {
  const mod = await opcional(caminho);
  if (!mod || typeof mod[fn] !== 'function') return padrao;
  try {
    return await mod[fn](...args);
  } catch (e) {
    console.error(`[opcional] ${caminho}#${fn}:`, e.message);
    return padrao;
  }
}

/** true se a tabela existir no SQLite */
export function existeTabela(db, nome) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome));
}
