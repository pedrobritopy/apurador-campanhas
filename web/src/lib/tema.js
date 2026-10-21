import { useEffect, useState } from 'react';

// 'auto' segue o sistema operacional; 'claro'/'escuro' fixam (data-theme no <html>).
export function useTema() {
  const [tema, setTema] = useState(() => {
    try {
      return localStorage.getItem('tema') || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (tema === 'claro') el.dataset.theme = 'light';
    else if (tema === 'escuro') el.dataset.theme = 'dark';
    else delete el.dataset.theme;
    try {
      localStorage.setItem('tema', tema);
    } catch {
      /* armazenamento indisponível: tema só vale nesta sessão */
    }
    window.dispatchEvent(new Event('tema-mudou'));
  }, [tema]);
  return [tema, setTema];
}

/** true se o tema efetivo for escuro (para canvas, que precisa de cores resolvidas). */
export function temaEscuro() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Lê o valor resolvido de um token CSS (ex.: '--s1'). */
export function cor(token) {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

/** Re-renderiza quando o tema muda (para componentes canvas). */
export function useVersaoTema() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((x) => x + 1);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('tema-mudou', f);
    mq.addEventListener('change', f);
    return () => {
      window.removeEventListener('tema-mudou', f);
      mq.removeEventListener('change', f);
    };
  }, []);
  return v;
}
