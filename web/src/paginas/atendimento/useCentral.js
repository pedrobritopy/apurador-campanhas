import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../../lib/api.js';

const ordenar = (lista) => [...lista].sort((a, b) => String(b.ultima_mensagem_em || '').localeCompare(String(a.ultima_mensagem_em || '')));

/**
 * Estado compartilhado da central: conversas, resumo e canais, atualizados em tempo real (SSE)
 * com recarga periódica de segurança caso o stream caia.
 */
export function useCentral() {
  const [conversas, setConversas] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [canais, setCanais] = useState(null);
  const [aoVivo, setAoVivo] = useState(false);
  const [erro, setErro] = useState(null);
  const ouvintes = useRef(new Set());
  const timerResumo = useRef(null);

  const carregarResumo = useCallback(() => get('/atendimento/resumo').then(setResumo).catch(() => {}), []);
  const carregarCanais = useCallback(() => get('/atendimento/canais').then(setCanais).catch(() => {}), []);
  const recarregar = useCallback(async () => {
    try {
      const [c] = await Promise.all([get('/atendimento/conversas?limite=600'), carregarResumo(), carregarCanais()]);
      setConversas(ordenar(c));
      setErro(null);
    } catch (e) {
      setErro(e);
    }
  }, [carregarResumo, carregarCanais]);

  const resumoDepois = useCallback(() => {
    clearTimeout(timerResumo.current);
    timerResumo.current = setTimeout(carregarResumo, 400);
  }, [carregarResumo]);

  /** Atualiza (ou insere) uma conversa na lista local. */
  const aplicarConversa = useCallback((c) => {
    if (!c?.id) return;
    setConversas((lista) => ordenar([c, ...(lista || []).filter((x) => x.id !== c.id)]));
    resumoDepois();
  }, [resumoDepois]);

  useEffect(() => {
    recarregar();
    let es;
    let tentativa;
    const conectar = () => {
      es = new EventSource('/api/atendimento/eventos');
      es.addEventListener('pronto', () => setAoVivo(true));
      es.addEventListener('conversa', (e) => aplicarConversa(JSON.parse(e.data)));
      es.addEventListener('mensagem', (e) => {
        const m = JSON.parse(e.data);
        for (const f of ouvintes.current) f(m);
      });
      es.addEventListener('status_canal', (e) => {
        const d = JSON.parse(e.data);
        setCanais((c) => (c ? { ...c, [d.canal]: { ...c[d.canal], ...d } } : c));
      });
      es.addEventListener('recarregar', () => recarregar());
      es.onerror = () => {
        setAoVivo(false);
        es.close();
        tentativa = setTimeout(conectar, 4000);
      };
    };
    conectar();
    const seguranca = setInterval(recarregar, 30000);
    return () => {
      es?.close();
      clearTimeout(tentativa);
      clearInterval(seguranca);
      clearTimeout(timerResumo.current);
    };
  }, [recarregar, aplicarConversa]);

  const ouvirMensagens = useCallback((fn) => {
    ouvintes.current.add(fn);
    return () => ouvintes.current.delete(fn);
  }, []);

  return { conversas, resumo, canais, aoVivo, erro, recarregar, carregarCanais, aplicarConversa, ouvirMensagens };
}
