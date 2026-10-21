import { createElement, useEffect, useState } from 'react';

// Roteador por hash (#/campanhas/3?aba=ranking). Funciona servido de qualquer lugar.

function ler() {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [caminho, busca = ''] = h.split('?');
  return { caminho: caminho || '/', query: new URLSearchParams(busca) };
}

export function useRota() {
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const f = () => setRota(ler());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}

export function navegar(caminho, { substituir = false } = {}) {
  const alvo = `#${caminho}`;
  if (substituir) window.history.replaceState(null, '', alvo);
  else if (window.location.hash !== alvo) window.location.hash = alvo;
  if (substituir) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Atualiza só a querystring da rota atual (ex.: aba ativa) sem empilhar histórico. */
export function definirQuery(valores) {
  const { caminho, query } = ler();
  for (const [k, v] of Object.entries(valores)) {
    if (v == null || v === '') query.delete(k);
    else query.set(k, String(v));
  }
  const s = query.toString();
  navegar(`${caminho}${s ? `?${s}` : ''}`, { substituir: true });
}

/** '/campanhas/:id' x '/campanhas/3' => { id: '3' } | null */
export function casar(padrao, caminho) {
  const a = padrao.split('/').filter(Boolean);
  const b = caminho.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ para, children, ...resto }) {
  return createElement('a', { href: `#${para}`, ...resto }, children);
}
