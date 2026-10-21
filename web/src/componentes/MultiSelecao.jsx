import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Seleção múltipla com busca (combobox + chips). Teclado: ↑ ↓ Enter, Backspace remove o último.
 * @param {{ opcoes: {valor:any, rotulo:string, detalhe?:string, grupo?:string, icone?:any}[], valores: any[], aoMudar: (v:any[])=>void,
 *   placeholder?: string, unico?: boolean, limiteLista?: number, desabilitado?: boolean }} p
 */
export default function MultiSelecao({ opcoes, valores = [], aoMudar, placeholder = 'Buscar…', unico = false, limiteLista = 200, desabilitado }) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const ref = useRef(null);
  const entrada = useRef(null);
  const sel = useMemo(() => new Set(valores.map(String)), [valores]);
  const porValor = useMemo(() => new Map(opcoes.map((o) => [String(o.valor), o])), [opcoes]);

  const filtradas = useMemo(() => {
    const q = normalizar(busca.trim());
    const base = q ? opcoes.filter((o) => normalizar(`${o.rotulo} ${o.detalhe || ''} ${o.grupo || ''}`).includes(q)) : opcoes;
    return base.slice(0, limiteLista);
  }, [busca, opcoes, limiteLista]);

  useEffect(() => setAtivo(0), [busca]);
  useEffect(() => {
    if (!aberto) return undefined;
    const f = (e) => !ref.current?.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [aberto]);

  const alternar = (o) => {
    const k = String(o.valor);
    if (unico) {
      aoMudar(sel.has(k) ? [] : [o.valor]);
      setAberto(false);
    } else {
      aoMudar(sel.has(k) ? valores.filter((v) => String(v) !== k) : [...valores, o.valor]);
    }
    setBusca('');
    entrada.current?.focus();
  };

  const tecla = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAberto(true);
      setAtivo((a) => Math.min(filtradas.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtradas[ativo]) alternar(filtradas[ativo]);
    } else if (e.key === 'Backspace' && !busca && valores.length) {
      aoMudar(valores.slice(0, -1));
    } else if (e.key === 'Escape') {
      setAberto(false);
    }
  };

  let grupoAnterior = null;
  return (
    <div className="ms" ref={ref}>
      <div className="ms-caixa" onClick={() => { if (!desabilitado) { setAberto(true); entrada.current?.focus(); } }} style={desabilitado ? { opacity: 0.6 } : undefined}>
        {valores.map((v) => {
          const o = porValor.get(String(v));
          return (
            <span key={String(v)} className="ms-chip" title={o?.detalhe || o?.rotulo}>
              {o?.icone}
              <span className="truncar">{o?.rotulo ?? String(v)}</span>
              <button type="button" aria-label="Remover" onClick={(e) => { e.stopPropagation(); aoMudar(valores.filter((x) => String(x) !== String(v))); }}>
                <X size={12} />
              </button>
            </span>
          );
        })}
        <input ref={entrada} value={busca} disabled={desabilitado} placeholder={valores.length ? '' : placeholder}
          onChange={(e) => { setBusca(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} onKeyDown={tecla} />
      </div>
      {aberto && (
        <div className="ms-lista" role="listbox">
          {!filtradas.length && <div className="ms-opcao mudo">Nada encontrado</div>}
          {filtradas.map((o, i) => {
            const cab = o.grupo && o.grupo !== grupoAnterior ? <div className="ms-grupo">{o.grupo}</div> : null;
            grupoAnterior = o.grupo;
            const marcado = sel.has(String(o.valor));
            return (
              <div key={String(o.valor)}>
                {cab}
                <div role="option" aria-selected={marcado} className={`ms-opcao${i === ativo ? ' ativa' : ''}${marcado ? ' sel' : ''}`}
                  onMouseEnter={() => setAtivo(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => alternar(o)}>
                  <span className="marcado">{marcado && <Check size={11} strokeWidth={3} />}</span>
                  {o.icone}
                  <span className="truncar">{o.rotulo}</span>
                  {o.detalhe && <span className="det">{o.detalhe}</span>}
                </div>
              </div>
            );
          })}
          {opcoes.length > limiteLista && filtradas.length === limiteLista && <div className="ms-opcao mudo pequeno">Digite para refinar…</div>}
        </div>
      )}
    </div>
  );
}
