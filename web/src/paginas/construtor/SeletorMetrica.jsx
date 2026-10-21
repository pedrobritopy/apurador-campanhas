import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BadgePercent, Check, ChevronDown, Package, Search, ShieldCheck, ShoppingCart, Sparkles, TrendingUp, Users } from 'lucide-react';
import { normalizarTexto } from './util.js';

export const ORDEM_GRUPOS = ['Volume', 'Rentabilidade', 'Clientes e cobertura', 'Pedidos e frequência', 'Crescimento e participação', 'Qualidade', 'Especiais'];
const ICONES_GRUPO = {
  Volume: Package,
  Rentabilidade: BadgePercent,
  'Clientes e cobertura': Users,
  'Pedidos e frequência': ShoppingCart,
  'Crescimento e participação': TrendingUp,
  Qualidade: ShieldCheck,
  Especiais: Sparkles,
};
export const iconeDoGrupo = (g) => ICONES_GRUPO[g] || Sparkles;
const ordem = (g) => {
  const i = ORDEM_GRUPOS.indexOf(g);
  return i < 0 ? 99 : i;
};

/** Escolha da métrica num popover agrupado, com busca e descrição de cada opção. */
export default function SeletorMetrica({ valor, aoMudar, catalogo }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const ref = useRef(null);
  const entrada = useRef(null);
  const metricas = catalogo?.metricas || {};
  const atual = metricas[valor];
  const Icone = iconeDoGrupo(atual?.grupo);

  const lista = useMemo(() => {
    const q = normalizarTexto(busca);
    return Object.entries(metricas)
      .map(([chave, m]) => ({ chave, ...m }))
      .filter((m) => !q || normalizarTexto(`${m.nome} ${m.descricao} ${m.grupo} ${m.chave} ${m.expr || ''}`).includes(q))
      .sort((a, b) => ordem(a.grupo) - ordem(b.grupo));
  }, [metricas, busca]);

  useEffect(() => {
    if (!aberto) return undefined;
    setBusca('');
    setAtivo(Math.max(0, Object.keys(metricas).indexOf(valor)));
    setTimeout(() => entrada.current?.focus(), 20);
    const f = (e) => !ref.current?.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setAtivo(0), [busca]);
  useEffect(() => {
    ref.current?.querySelector('.cons-metrica-op.ativa')?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  const escolher = (m) => {
    aoMudar(m.chave);
    setAberto(false);
  };
  const tecla = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => Math.min(lista.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (lista[ativo]) escolher(lista[ativo]);
    } else if (e.key === 'Escape') setAberto(false);
  };

  let grupoAnterior = null;
  return (
    <div className="cons-metrica" ref={ref}>
      <button type="button" className="cons-metrica-botao" onClick={() => setAberto((a) => !a)} aria-haspopup="listbox" aria-expanded={aberto}>
        <span className="cons-metrica-icone"><Icone size={16} /></span>
        <span className="cresce" style={{ minWidth: 0 }}>
          <span className="forte" style={{ display: 'block' }}>{atual?.nome || valor}</span>
          <span className="mudo pequeno truncar" style={{ display: 'block' }}>{atual?.descricao || 'Escolha o que será medido'}</span>
        </span>
        {atual?.expr && <code className="mono mudo" style={{ fontSize: 11.5, maxWidth: 220 }} title={atual.expr}><span className="truncar" style={{ display: 'block' }}>{atual.expr}</span></code>}
        <ChevronDown size={16} className="mudo" />
      </button>
      <AnimatePresence>
        {aberto && (
          <motion.div className="cons-metrica-pop" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
            <div className="cons-metrica-busca">
              <div className="entrada-grupo">
                <Search size={15} />
                <input ref={entrada} className="entrada" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={tecla} placeholder={`Buscar entre ${Object.keys(metricas).length} métricas (ex.: positivação, margem, share)…`} />
              </div>
            </div>
            <div className="cons-metrica-lista" role="listbox">
              {!lista.length && <div className="cons-metrica-op mudo">Nenhuma métrica encontrada</div>}
              {lista.map((m, i) => {
                const cab = m.grupo !== grupoAnterior ? <div className="cons-metrica-grupo">{m.grupo}</div> : null;
                grupoAnterior = m.grupo;
                const IcG = iconeDoGrupo(m.grupo);
                return (
                  <div key={m.chave}>
                    {cab}
                    <div role="option" aria-selected={m.chave === valor} className={`cons-metrica-op${i === ativo ? ' ativa' : ''}${m.chave === valor ? ' sel' : ''}`}
                      onMouseEnter={() => setAtivo(i)} onClick={() => escolher(m)}>
                      <span className="n">
                        <IcG size={13} className="mudo" />
                        {m.nome}
                        {m.sentido === 'menor' && <span className="selo" style={{ height: 18, fontSize: 10.5 }}>menor é melhor</span>}
                        {m.chave === valor && <Check size={14} style={{ marginLeft: 'auto', color: 'var(--acento)' }} />}
                      </span>
                      <span className="d">{m.descricao}</span>
                      {m.expr && <span className="e">{m.expr}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
