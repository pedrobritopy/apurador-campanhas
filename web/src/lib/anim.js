import { useEffect, useRef, useState } from 'react';

export const movimentoReduzido = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const suave = (t) => 1 - (1 - t) ** 3;

/**
 * Número que "conta" até o valor alvo (de onde estava antes). Respeita movimento reduzido.
 * @returns {number|null}
 */
export function useContagem(alvo, duracao = 900) {
  const [valor, setValor] = useState(alvo == null ? null : movimentoReduzido() ? alvo : 0);
  const anterior = useRef(valor ?? 0);
  useEffect(() => {
    if (alvo == null || !Number.isFinite(alvo)) {
      setValor(alvo);
      return undefined;
    }
    if (movimentoReduzido()) {
      setValor(alvo);
      anterior.current = alvo;
      return undefined;
    }
    const de = anterior.current ?? 0;
    const inicio = performance.now();
    let quadro;
    const passo = (agora) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const v = de + (alvo - de) * suave(t);
      setValor(v);
      if (t < 1) quadro = requestAnimationFrame(passo);
      else anterior.current = alvo;
    };
    quadro = requestAnimationFrame(passo);
    return () => {
      cancelAnimationFrame(quadro);
      anterior.current = alvo;
    };
  }, [alvo, duracao]);
  return valor;
}

/** true depois do primeiro quadro (para animar barras a partir de zero). */
export function useMontado(atraso = 30) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setM(true), atraso);
    return () => clearTimeout(t);
  }, [atraso]);
  return m;
}

/** Largura do elemento (ResizeObserver) — usada pelos gráficos responsivos. */
export function useLargura(ref, inicial = 600) {
  const [w, setW] = useState(inicial);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Valor "atrasado" (debounce) — usado na prévia ao vivo do construtor. */
export function useAtrasado(valor, ms = 500) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Atalho de teclado global. combo: 'mod+k', 'escape', '/' */
export function useAtalho(combo, fn) {
  useEffect(() => {
    const h = (e) => {
      const partes = combo.toLowerCase().split('+');
      const tecla = partes.pop();
      const mod = partes.includes('mod');
      if (mod && !(e.ctrlKey || e.metaKey)) return;
      if (!mod && (e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== tecla) return;
      if (!mod && /input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [combo, fn]);
}
