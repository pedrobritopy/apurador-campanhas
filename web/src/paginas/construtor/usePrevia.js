import { useEffect, useMemo, useState } from 'react';
import { post } from '../../lib/api.js';
import { useAtrasado } from '../../lib/anim.js';

/**
 * Apura a definição em rascunho (POST /api/apuracao/previa) com debounce e cancelamento:
 * cada alteração reinicia a espera; a requisição anterior em voo é abortada.
 */
export function usePrevia(def, { ativo = true, atraso = 600 } = {}) {
  const chave = useMemo(() => JSON.stringify(def), [def]);
  const atrasada = useAtrasado(chave, atraso);
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: false, ms: null });

  useEffect(() => {
    if (!ativo || !atrasada) return undefined;
    const controle = new AbortController();
    const t0 = performance.now();
    setEstado((e) => ({ ...e, carregando: true }));
    post('/apuracao/previa', { definicao: JSON.parse(atrasada) }, { signal: controle.signal })
      .then((dados) => setEstado({ dados, erro: null, carregando: false, ms: Math.round(performance.now() - t0) }))
      .catch((erro) => {
        if (erro.name === 'AbortError') return;
        setEstado((e) => ({ ...e, erro, carregando: false }));
      });
    return () => controle.abort();
  }, [atrasada, ativo]);

  return { ...estado, pendente: chave !== atrasada || estado.carregando };
}
