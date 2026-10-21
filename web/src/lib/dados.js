import { useEffect, useState } from 'react';
import { get } from './api.js';

// Cache de recursos "quase estáticos" compartilhados entre telas (dimensões, catálogo, produtos...).
const cache = new Map(); // caminho -> { dados, promessa, ouvintes:Set }

function entrada(caminho) {
  if (!cache.has(caminho)) cache.set(caminho, { dados: null, erro: null, promessa: null, ouvintes: new Set() });
  return cache.get(caminho);
}

function carregar(caminho) {
  const e = entrada(caminho);
  if (!e.promessa) {
    e.promessa = get(caminho)
      .then((d) => {
        e.dados = d;
        e.erro = null;
      })
      .catch((err) => {
        e.erro = err;
        e.promessa = null;
      })
      .finally(() => e.ouvintes.forEach((f) => f()));
  }
  return e.promessa;
}

/** Recurso cacheado: { dados, erro, carregando } */
export function useRecurso(caminho) {
  const e = entrada(caminho);
  const [, forcar] = useState(0);
  useEffect(() => {
    const f = () => forcar((x) => x + 1);
    e.ouvintes.add(f);
    if (!e.dados && !e.promessa) carregar(caminho);
    return () => e.ouvintes.delete(f);
  }, [caminho, e]);
  return { dados: e.dados, erro: e.erro, carregando: !e.dados && !e.erro };
}

/** Força recarga (ex.: após importar dados ou criar um grupo). */
export function invalidarRecurso(caminho) {
  const alvos = caminho ? [caminho] : [...cache.keys()];
  for (const c of alvos) {
    const e = cache.get(c);
    if (!e) continue;
    e.promessa = null;
    if (e.ouvintes.size) carregar(c);
    else e.dados = null;
  }
}

export const useDimensoes = () => useRecurso('/dimensoes');
export const useCatalogo = () => useRecurso('/catalogo');
export const useProdutos = () => useRecurso('/produtos');
export const useClientes = () => useRecurso('/clientes');
