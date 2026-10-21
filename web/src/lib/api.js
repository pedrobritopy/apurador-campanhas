import { useCallback, useEffect, useRef, useState } from 'react';

export class ErroApi extends Error {
  constructor(mensagem, status, corpo) {
    super(mensagem);
    this.status = status;
    this.corpo = corpo;
  }
}

/** Chamada genérica à API. Lança ErroApi com a mensagem amigável do servidor. */
export async function api(metodo, caminho, corpo, opcoes = {}) {
  const init = { method: metodo, headers: {}, signal: opcoes.signal };
  if (corpo !== undefined) {
    if (typeof corpo === 'string' || corpo instanceof Blob || corpo instanceof ArrayBuffer) {
      init.body = corpo;
      init.headers['Content-Type'] = opcoes.tipo || 'text/plain';
    } else {
      init.body = JSON.stringify(corpo);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  const r = await fetch(`/api${caminho}`, init);
  const tipo = r.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) throw new ErroApi(dados?.erro || `Erro ${r.status}`, r.status, dados);
  return dados;
}

export const get = (c, o) => api('GET', c, undefined, o);
export const post = (c, b, o) => api('POST', c, b ?? {}, o);
export const put = (c, b, o) => api('PUT', c, b ?? {}, o);
export const del = (c, o) => api('DELETE', c, undefined, o);

/**
 * Busca dados com estado. Mantém os dados anteriores durante recarga (sem piscar).
 * @param {string|null} caminho null = não busca
 * @returns {{ dados, erro, carregando, recarregar, setDados }}
 */
/**
 * Busca e mantém um recurso. `vivo: true` refaz a busca em silêncio quando a pipeline de dados termina
 * de processar (evento "dados-atualizados"), sem piscar a tela.
 */
export function useApi(caminho, { intervalo, vivo = false } = {}) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(Boolean(caminho));
  const atual = useRef(0);

  const recarregar = useCallback(async () => {
    if (!caminho) return;
    const id = ++atual.current;
    setCarregando(true);
    try {
      const d = await get(caminho);
      if (id === atual.current) {
        setDados(d);
        setErro(null);
      }
    } catch (e) {
      if (id === atual.current) setErro(e);
    } finally {
      if (id === atual.current) setCarregando(false);
    }
  }, [caminho]);

  useEffect(() => {
    if (!vivo || !caminho) return undefined;
    const silencioso = async () => {
      try {
        const dd = await get(caminho);
        setDados(dd);
        setErro(null);
      } catch {
        /* mantém o que já está na tela */
      }
    };
    window.addEventListener('dados-atualizados', silencioso);
    return () => window.removeEventListener('dados-atualizados', silencioso);
  }, [vivo, caminho]);

  useEffect(() => {
    recarregar();
    if (!intervalo) return undefined;
    const t = setInterval(recarregar, intervalo);
    return () => clearInterval(t);
  }, [recarregar, intervalo]);

  return { dados, erro, carregando, recarregar, setDados };
}

/**
 * POST com resposta em Server-Sent Events.
 * @param {(evento: string, dados: any) => void} aoEvento
 * @returns {AbortController}
 */
export function sse(caminho, corpo, aoEvento) {
  const controle = new AbortController();
  (async () => {
    try {
      const r = await fetch(`/api${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(corpo),
        signal: controle.signal,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        aoEvento('erro', { erro: d.erro || `Erro ${r.status}` });
        return;
      }
      const leitor = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const bloco = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let evento = 'message';
          let dado = '';
          for (const l of bloco.split('\n')) {
            if (l.startsWith('event:')) evento = l.slice(6).trim();
            else if (l.startsWith('data:')) dado += l.slice(5).trim();
          }
          try {
            aoEvento(evento, dado ? JSON.parse(dado) : null);
          } catch {
            aoEvento(evento, dado);
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') aoEvento('erro', { erro: e.message });
    }
  })();
  return controle;
}

/** Dispara download de um arquivo servido pela API. */
export function baixar(caminho) {
  const a = document.createElement('a');
  a.href = `/api${caminho}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Monta querystring ignorando vazios. */
export function qs(obj = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
