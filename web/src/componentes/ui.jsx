import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Info, Loader2,
  MinusCircle, Target, TrendingDown, TrendingUp, X, XCircle,
} from 'lucide-react';
import { useContagem, useMontado } from '../lib/anim.js';
import { fmtDelta, fmtValor, iniciais } from '../lib/formato.js';
import { Sparkline } from './graficos.jsx';

/* =====================================================================
   Kit de interface. Componentes pequenos, sem estado global (exceto toasts).
   Convenções: `icone` recebe um componente do lucide-react; textos em pt-BR.
   ===================================================================== */

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

// ------------------------------------------------------------------ botões
/**
 * @param {{variante?: 'padrao'|'primario'|'fantasma'|'perigo'|'sutil', tamanho?: 'p'|'m'|'g', icone?: any, iconeDireita?: any, carregando?: boolean}} p
 */
export function Botao({ variante = 'padrao', tamanho = 'm', icone: Icone, iconeDireita: IconeD, carregando, children, className, ...resto }) {
  const t = tamanho === 'p' ? 14 : 16;
  return (
    <button type="button" className={cx('botao', variante !== 'padrao' && variante, tamanho !== 'm' && tamanho, !children && 'icone', className)} disabled={carregando || resto.disabled} {...resto}>
      {carregando ? <Loader2 size={t} className="girando" /> : Icone ? <Icone size={t} strokeWidth={2} /> : null}
      {children}
      {IconeD && !carregando ? <IconeD size={t} strokeWidth={2} /> : null}
    </button>
  );
}

export function BotaoIcone({ icone: Icone, rotulo, tamanho = 'm', variante = 'fantasma', ...resto }) {
  return (
    <button type="button" title={rotulo} aria-label={rotulo} className={cx('botao icone', variante !== 'padrao' && variante, tamanho !== 'm' && tamanho)} {...resto}>
      <Icone size={tamanho === 'p' ? 14 : 16} />
    </button>
  );
}

// ------------------------------------------------------------------ cartões e cabeçalhos
/** `info` ({titulo?, texto, como, exemplo}) põe o "i" de explicação ao lado do título. */
export function Cartao({ titulo, subtitulo, acoes, children, rodape, className, corpoClassName, semMargem, interativo, destaque, info, ...resto }) {
  return (
    <section className={cx('cartao', interativo && 'interativo', destaque && 'destaque', className)} {...resto}>
      {(titulo || acoes) && (
        <div className="cartao-topo">
          <div className="cresce">
            {titulo && (
              <h3 className="cartao-titulo">
                {titulo}
                {info && <Explica titulo={typeof titulo === 'string' ? titulo : undefined} {...info} tamanho={13} />}
              </h3>
            )}
            {subtitulo && <div className="cartao-sub">{subtitulo}</div>}
          </div>
          {acoes && <div className="linha">{acoes}</div>}
        </div>
      )}
      <div className={cx('cartao-corpo', semMargem && 'sem-margem', corpoClassName)}>{children}</div>
      {rodape && <div className="cartao-rodape">{rodape}</div>}
    </section>
  );
}

export function Cabecalho({ sobre, titulo, subtitulo, acoes, children, info }) {
  return (
    <header className="cabecalho">
      <div className="cabecalho-titulo">
        {sobre && <div className="cabecalho-sobre">{sobre}</div>}
        <h1 className="com-explica">
          {titulo}
          {info && <Explica titulo={typeof titulo === 'string' ? titulo : undefined} {...info} tamanho={15} />}
        </h1>
        {subtitulo && <div className="cabecalho-sub">{subtitulo}</div>}
        {children}
      </div>
      {acoes && <div className="cabecalho-acoes">{acoes}</div>}
    </header>
  );
}

// ------------------------------------------------------------------ selos e status
export function Selo({ cor = 'neutro', icone: Icone, children, className, ...resto }) {
  return (
    <span className={cx('selo', cor !== 'neutro' && cor, className)} {...resto}>
      {Icone && <Icone size={12} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

export const STATUS = {
  atingiu: { rotulo: 'Atingiu', cor: 'bom', icone: CheckCircle2 },
  no_ritmo: { rotulo: 'No ritmo', cor: 'acento', icone: TrendingUp },
  atencao: { rotulo: 'Atenção', cor: 'aviso', icone: AlertTriangle },
  risco: { rotulo: 'Em risco', cor: 'critico', icone: TrendingDown },
  nao_atingiu: { rotulo: 'Não atingiu', cor: 'critico', icone: XCircle },
  sem_meta: { rotulo: 'Sem meta', cor: 'neutro', icone: MinusCircle },
  aguardando: { rotulo: 'Aguardando', cor: 'neutro', icone: Clock },
};

/** Status de participante: sempre ícone + rótulo (cor nunca sozinha). */
export function SeloStatus({ status, compacto }) {
  const s = STATUS[status] || STATUS.sem_meta;
  return (
    <Selo cor={s.cor} icone={s.icone} title={s.rotulo}>
      {!compacto && s.rotulo}
    </Selo>
  );
}

export const STATUS_CAMPANHA = {
  rascunho: { rotulo: 'Rascunho', cor: 'neutro' },
  ativa: { rotulo: 'Ativa', cor: 'acento' },
  encerrada: { rotulo: 'Encerrada', cor: 'bom' },
  arquivada: { rotulo: 'Arquivada', cor: 'neutro' },
};

export function SeloCampanha({ status, tempo }) {
  let s = STATUS_CAMPANHA[status] || STATUS_CAMPANHA.rascunho;
  if (status === 'ativa' && tempo === 'futura') s = { rotulo: 'Agendada', cor: 'neutro' };
  if (status === 'ativa' && tempo === 'encerrada') s = { rotulo: 'Aguardando fechamento', cor: 'aviso' };
  return (
    <Selo cor={s.cor}>
      {status === 'ativa' && tempo === 'andamento' && <span className="ponto vivo" />}
      {s.rotulo}
    </Selo>
  );
}

/** Avatar com foto (quando houver) e iniciais como reserva. */
export function Avatar({ nome, tamanho = 'm', cor, foto }) {
  const [falhou, setFalhou] = useState(false);
  const comFoto = foto && !falhou;
  return (
    <span className={cx('avatar', tamanho !== 'm' && tamanho, comFoto && 'com-foto')} style={cor && !comFoto ? { background: cor, color: '#fff' } : undefined} aria-hidden title={nome}>
      {comFoto ? <img src={foto} alt="" loading="lazy" onError={() => setFalhou(true)} /> : iniciais(nome)}
    </span>
  );
}

export function Delta({ valor, formato = 'perc', bomQuandoSobe = true, sufixo, casas = 0 }) {
  if (valor == null || !Number.isFinite(valor)) return <span className="delta neutro">-</span>;
  const sobe = valor > 0.0001;
  const desce = valor < -0.0001;
  const bom = (sobe && bomQuandoSobe) || (desce && !bomQuandoSobe);
  const Ic = sobe ? ArrowUp : desce ? ArrowDown : null;
  return (
    <span className={cx('delta', !sobe && !desce ? 'neutro' : bom ? 'bom' : 'ruim')}>
      {Ic && <Ic size={12} strokeWidth={2.6} />}
      {formato === 'perc' ? `${fmtDelta(valor, casas)}%` : formato === 'pp' ? `${fmtDelta(valor, casas)} p.p.` : fmtDelta(valor, casas)}
      {sufixo && <span className="mudo" style={{ fontWeight: 500 }}>&nbsp;{sufixo}</span>}
    </span>
  );
}

export function Movimento({ valor }) {
  if (valor == null) return null;
  if (valor === 0) return <span className="movimento igual">-</span>;
  const sobe = valor > 0;
  return (
    <span className={cx('movimento', sobe ? 'sobe' : 'desce')} title={sobe ? `Subiu ${valor} posições` : `Caiu ${-valor} posições`}>
      {sobe ? <ChevronUp size={13} strokeWidth={2.8} /> : <ChevronDown size={13} strokeWidth={2.8} />}
      {Math.abs(valor)}
    </span>
  );
}

// ------------------------------------------------------------------ números animados
/** Número que conta até o valor. formato: numero|moeda|perc|decimal */
export function Numero({ valor, formato = 'numero', compacto = false, duracao = 900, className }) {
  const v = useContagem(valor ?? null, duracao);
  const casasFinais = formato === 'numero' && valor != null && Math.abs(valor) < 10 && valor % 1 !== 0;
  const exibido = v == null ? null : formato === 'numero' && !casasFinais ? Math.round(v) : v;
  return <span className={cx('num', className)}>{fmtValor(exibido, formato, { compacto })}</span>;
}

/** Stat tile: rótulo · valor (conta) · delta · sparkline opcional. */
export function Kpi({ rotulo, valor, formato = 'numero', compacto, icone: Icone, delta, deltaFormato = 'perc', deltaRotulo, bomQuandoSobe = true, serie, rodape, heroi, dica, onClick, className }) {
  return (
    <div className={cx('cartao kpi', onClick && 'interativo', className)} onClick={onClick} title={dica}>
      <div className="kpi-rotulo">
        {Icone && <Icone size={15} />}
        <span className="truncar">{rotulo}</span>
      </div>
      <div className={cx('kpi-valor', heroi && 'heroi')}>
        <Numero valor={valor} formato={formato} compacto={compacto} />
      </div>
      <div className="kpi-rodape">
        <div className="linha g4">
          {delta !== undefined && <Delta valor={delta} formato={deltaFormato} bomQuandoSobe={bomQuandoSobe} />}
          {deltaRotulo && <span className="mudo pequeno">{deltaRotulo}</span>}
          {rodape}
        </div>
        {serie?.length > 1 && <Sparkline valores={serie} largura={84} altura={24} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ progresso, medidores
/**
 * Barra de progresso de atingimento. `valor` em % (pode passar de 100), `projecao` marca tracejada.
 * Cor por severidade: >=100 bom, >=85 acento, >=60 aviso, senão crítico (ou fixa via `cor`).
 */
export function Progresso({ valor, projecao, cor, espessura = 'm', mostrarMeta = false, max = 100, className, titulo }) {
  const montado = useMontado();
  const v = Math.max(0, valor ?? 0);
  const larg = Math.min(v, max) / max * 100;
  const excesso = v > max ? Math.min(v - max, max * 0.5) / max * 100 : 0;
  const c = cor || (v >= 100 ? 'bom' : v >= 85 ? '' : v >= 60 ? 'aviso' : 'critico');
  return (
    <div className={cx('progresso', espessura === 'p' && 'fino', espessura === 'g' && 'grosso', className)} title={titulo} role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={max}>
      <div className={cx('progresso-barra', c)} style={{ width: `${montado ? larg : 0}%` }} />
      {excesso > 0 && <div className="progresso-excesso" style={{ left: `calc(${larg}% - 4px)`, width: montado ? `calc(${excesso}% + 4px)` : 0, maxWidth: `calc(100% - ${larg}% + 4px)` }} />}
      {projecao != null && Number.isFinite(projecao) && (
        <div className="progresso-marca proj" style={{ left: `${montado ? Math.min(projecao, max) / max * 100 : 0}%` }} title={`Projeção: ${fmtValor(projecao, 'perc')}`} />
      )}
      {mostrarMeta && <div className="progresso-meta" style={{ left: '100%' }} />}
    </div>
  );
}

/** Anel (gauge) de atingimento. */
export function Anel({ valor, tamanho = 120, espessura = 10, rotulo, sub, cor }) {
  const montado = useMontado();
  const v = Math.max(0, valor ?? 0);
  const r = (tamanho - espessura) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(v, 100) / 100;
  const extra = v > 100 ? Math.min(v - 100, 100) / 100 : 0;
  const corBarra = cor || (v >= 100 ? 'var(--bom)' : v >= 85 ? 'var(--acento)' : v >= 60 ? 'var(--aviso)' : 'var(--critico)');
  return (
    <div style={{ position: 'relative', width: tamanho, height: tamanho, flex: 'none' }}>
      <svg width={tamanho} height={tamanho} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="var(--superficie-3)" strokeWidth={espessura} />
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke={corBarra} strokeWidth={espessura} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={montado ? c * (1 - frac) : c} style={{ transition: 'stroke-dashoffset 1100ms var(--curva)' }} />
        {extra > 0 && (
          <circle cx={tamanho / 2} cy={tamanho / 2} r={r - espessura - 2} fill="none" stroke="var(--bom)" strokeOpacity={0.45} strokeWidth={3} strokeLinecap="round"
            strokeDasharray={2 * Math.PI * (r - espessura - 2)} strokeDashoffset={montado ? 2 * Math.PI * (r - espessura - 2) * (1 - extra) : 2 * Math.PI * (r - espessura - 2)}
            style={{ transition: 'stroke-dashoffset 1300ms var(--curva) 300ms' }} />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: tamanho * 0.2, fontWeight: 650, letterSpacing: '-0.03em', lineHeight: 1 }}>
            {valor == null ? '-' : <Numero valor={valor} formato="perc" />}
          </div>
          {rotulo && <div className="mudo" style={{ fontSize: 11, marginTop: 4 }}>{rotulo}</div>}
          {sub && <div style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/** Barra 100% empilhada (distribuição de status), com 2px de respiro entre partes. */
export function BarraEmpilhada({ partes, altura = 10, mostrarLegenda = true }) {
  const total = partes.reduce((a, p) => a + (p.valor || 0), 0) || 1;
  const [dica, setDica] = useState(null);
  return (
    <div className="coluna g4" style={{ gap: 8 }}>
      <div className="empilhada" style={{ height: altura }} onMouseLeave={() => setDica(null)}>
        {partes.filter((p) => p.valor > 0).map((p) => (
          <span key={p.rotulo} style={{ flexGrow: p.valor, background: p.cor }} onMouseEnter={() => setDica(p)} title={`${p.rotulo}: ${p.valor}`} />
        ))}
      </div>
      {mostrarLegenda && (
        <div className="legenda">
          {partes.map((p) => (
            <span key={p.rotulo} className="legenda-item" style={{ opacity: dica && dica !== p ? 0.55 : 1 }}>
              <span className="legenda-chave barra" style={{ background: p.cor }} />
              {p.rotulo} <span className="forte num" style={{ color: 'var(--tinta)' }}>{p.valor}</span>
              <span className="mudo">({Math.round((p.valor / total) * 100)}%)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ abas, segmentado, chips
export function Abas({ abas, ativa, aoMudar, className }) {
  const id = useId();
  return (
    <div className={cx('abas', className)} role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={ativa === a.id} className={cx('aba', ativa === a.id && 'ativa')} onClick={() => aoMudar(a.id)}>
          {a.icone && <a.icone size={15} />}
          {a.rotulo}
          {a.contador != null && <span className="aba-contador">{a.contador}</span>}
          {ativa === a.id && <motion.span layoutId={`sub-${id}`} className="aba-sublinhado" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}

export function Segmentado({ opcoes, valor, aoMudar, tamanho = 'm' }) {
  const ref = useRef(null);
  const [marca, setMarca] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector('button.ativo');
    if (el) setMarca({ left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight });
  }, [valor, opcoes.length]);
  return (
    <div ref={ref} className={cx('segmentado', tamanho === 'p' && 'p')} role="radiogroup">
      {marca && <motion.span className="marcador" initial={false} animate={marca} transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
      {opcoes.map((o) => (
        <button key={String(o.valor)} type="button" role="radio" aria-checked={valor === o.valor} className={cx(valor === o.valor && 'ativo')} onClick={() => aoMudar(o.valor)} title={o.dica}>
          {o.icone && <o.icone size={14} />}
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export function Chip({ ativo, aoClicar, aoRemover, icone: Icone, children, ...resto }) {
  return (
    <button type="button" className={cx('chip', ativo && 'ativo')} onClick={aoClicar} {...resto}>
      {Icone && <Icone size={13} />}
      {children}
      {aoRemover && (
        <span className="remover" onClick={(e) => { e.stopPropagation(); aoRemover(); }} role="button" aria-label="Remover">
          <X size={12} />
        </span>
      )}
    </button>
  );
}

// ------------------------------------------------------------------ formulários
/**
 * Rótulo + controle + ajuda. É um <div role="group"> (não <label>) para não disparar
 * o primeiro botão interno ao clicar no rótulo quando o controle é composto (chips, multisseleção…).
 */
/** `dica` (texto) ou `info` ({titulo, texto, como, exemplo}) mostram o "i" de explicação ao lado do rótulo. */
export function Campo({ rotulo, ajuda, erro, children, dica, info, className, style }) {
  const id = useId();
  return (
    <div className={cx('campo', className)} style={style} role="group" aria-labelledby={rotulo ? id : undefined}>
      {rotulo && (
        <span className="campo-rotulo" id={id}>
          {rotulo}
          {info ? <Explica titulo={typeof rotulo === 'string' ? rotulo : undefined} {...info} tamanho={13} />
            : dica ? <Explica titulo={typeof rotulo === 'string' ? rotulo : undefined} texto={dica} tamanho={13} /> : null}
        </span>
      )}
      {children}
      {erro ? <span className="campo-erro">{erro}</span> : ajuda ? <span className="campo-ajuda">{ajuda}</span> : null}
    </div>
  );
}

export function Entrada({ icone: Icone, sufixo, tamanho, className, ...resto }) {
  const input = <input className={cx('entrada', tamanho === 'p' && 'p', resto.type === 'number' && 'num', className)} {...resto} />;
  if (!Icone && !sufixo) return input;
  return (
    <div className={cx('entrada-grupo', sufixo && 'com-sufixo')}>
      {Icone && <Icone size={15} />}
      {input}
      {sufixo && <span className="sufixo">{sufixo}</span>}
    </div>
  );
}

/** Entrada numérica que aceita vazio (null) e vírgula decimal. */
export function EntradaNumero({ valor, aoMudar, tamanho, sufixo, placeholder, min, passo, className, ...resto }) {
  const [texto, setTexto] = useState(valor == null ? '' : String(valor).replace('.', ','));
  useEffect(() => {
    const atual = texto.trim() === '' ? null : Number(texto.replace(/\./g, '').replace(',', '.'));
    if (atual !== valor) setTexto(valor == null ? '' : String(valor).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <Entrada
      inputMode="decimal"
      tamanho={tamanho}
      sufixo={sufixo}
      placeholder={placeholder}
      className={cx('num', className)}
      value={texto}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d,.-]/g, '');
        setTexto(t);
        if (t.trim() === '') return aoMudar(null);
        const n = Number(t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (Number.isFinite(n)) aoMudar(min != null ? Math.max(min, n) : n);
      }}
      {...resto}
    />
  );
}

export function AreaTexto({ className, ...resto }) {
  return <textarea className={cx('area-texto', className)} {...resto} />;
}

/** opcoes: [{ valor, rotulo }] ou strings */
export function Seletor({ opcoes, valor, aoMudar, tamanho, vazio, className, ...resto }) {
  return (
    <select className={cx('seletor', tamanho === 'p' && 'p', className)} value={valor ?? ''} onChange={(e) => aoMudar(e.target.value)} {...resto}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {opcoes.map((o) => {
        const op = typeof o === 'object' ? o : { valor: o, rotulo: o };
        return (
          <option key={String(op.valor)} value={op.valor} disabled={op.desabilitado}>
            {op.rotulo}
          </option>
        );
      })}
    </select>
  );
}

export function Alternador({ ligado, aoMudar, rotulo, descricao }) {
  return (
    <label className={cx('alternador', ligado && 'ligado')} onClick={(e) => { e.preventDefault(); aoMudar(!ligado); }}>
      <span className="alternador-trilho" role="switch" aria-checked={ligado} tabIndex={0}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); aoMudar(!ligado); } }} />
      {(rotulo || descricao) && (
        <span className="coluna" style={{ gap: 0 }}>
          {rotulo && <span style={{ fontWeight: 550 }}>{rotulo}</span>}
          {descricao && <span className="mudo pequeno">{descricao}</span>}
        </span>
      )}
    </label>
  );
}

// ------------------------------------------------------------------ avisos, vazio, carregando
const ICONE_AVISO = { info: Info, aviso: AlertTriangle, erro: XCircle, ok: CheckCircle2 };
export function Aviso({ tipo = 'info', titulo, children, acao, className }) {
  const Ic = ICONE_AVISO[tipo] || Info;
  return (
    <div className={cx('aviso-caixa', tipo, className)} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Ic size={16} />
      <div className="cresce">
        {titulo && <div className="forte" style={{ marginBottom: children ? 2 : 0 }}>{titulo}</div>}
        {children}
      </div>
      {acao}
    </div>
  );
}

export function Vazio({ icone: Icone = Target, titulo, texto, acao }) {
  return (
    <div className="vazio">
      <div className="vazio-icone"><Icone size={20} /></div>
      {titulo && <div className="forte" style={{ color: 'var(--tinta)' }}>{titulo}</div>}
      {texto && <div className="pequeno" style={{ maxWidth: 420 }}>{texto}</div>}
      {acao && <div style={{ marginTop: 8 }}>{acao}</div>}
    </div>
  );
}

export function Esqueleto({ altura = 16, largura = '100%', linhas = 1, raio, style }) {
  return (
    <div className="coluna" style={{ gap: 8, ...style }}>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="esqueleto" style={{ height: altura, width: i === linhas - 1 && linhas > 1 ? '70%' : largura, borderRadius: raio }} />
      ))}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…', altura = 200 }) {
  return (
    <div className="vazio" style={{ minHeight: altura }}>
      <Loader2 size={22} className="girando" style={{ color: 'var(--acento)' }} />
      <div className="pequeno">{texto}</div>
    </div>
  );
}

export function ErroCarga({ erro, aoTentar }) {
  return (
    <Aviso tipo="erro" titulo="Não foi possível carregar" acao={aoTentar && <Botao tamanho="p" onClick={aoTentar}>Tentar de novo</Botao>}>
      {erro?.message || String(erro)}
    </Aviso>
  );
}

// ------------------------------------------------------------------ tooltip simples
/**
 * Ícone "i" com explicação curta: o que é, como usar e um exemplo.
 * Abre ao passar o mouse (e some ao sair) ou fica fixo com um clique. Esc ou clique fora fecha.
 * @param {{titulo?: string, texto?: any, como?: string|string[], exemplo?: any, tamanho?: number, largura?: number}} p
 */
export function Explica({ titulo, texto, como, exemplo, children, tamanho = 14, largura = 330 }) {
  const [modo, setModo] = useState(null); // 'hover' | 'fixo' | null
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const caixa = useRef(null);
  const timer = useRef(null);
  const corpo = texto ?? children;
  const passos = como == null ? [] : Array.isArray(como) ? como : [como];

  const calcular = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(largura, window.innerWidth - 24);
    const x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
    // abre para o lado com mais espaço e nunca passa da janela (rolagem interna se precisar)
    const livreAbaixo = window.innerHeight - r.bottom - 16;
    const livreAcima = r.top - 16;
    const abaixo = livreAbaixo >= 320 || livreAbaixo >= livreAcima;
    setPos({ x, y: abaixo ? r.bottom + 8 : r.top - 8, abaixo, w, maxH: Math.max(140, abaixo ? livreAbaixo : livreAcima) });
  };
  const abrir = (m) => { clearTimeout(timer.current); calcular(); setModo(m); };
  const fecharDepois = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setModo((m) => (m === 'hover' ? null : m)), 160);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (modo !== 'fixo') return undefined;
    const fora = (e) => { if (!ref.current?.contains(e.target) && !caixa.current?.contains(e.target)) setModo(null); };
    const esc = (e) => e.key === 'Escape' && setModo(null);
    const rolar = (e) => { if (!caixa.current?.contains(e.target)) setModo(null); };
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', rolar, true);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', rolar, true);
    };
  }, [modo]);

  const alternar = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (modo === 'fixo') setModo(null);
    else abrir('fixo');
  };

  return (
    <>
      <span ref={ref} role="button" tabIndex={0} className="explica-botao" aria-label={titulo ? `Explicação: ${titulo}` : 'Explicação'} aria-expanded={!!modo}
        onMouseEnter={() => !modo && abrir('hover')} onMouseLeave={() => modo === 'hover' && fecharDepois()}
        onClick={alternar} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && alternar(e)}>
        <Info size={tamanho} strokeWidth={2.2} />
      </span>
      {modo && pos && createPortal(
        <div ref={caixa} className="explica-caixa" role="dialog" aria-label={titulo || 'Explicação'}
          style={{ left: pos.x, top: pos.y, width: pos.w, maxHeight: pos.maxH, overflowY: 'auto', transform: pos.abaixo ? 'none' : 'translateY(-100%)' }}
          onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => modo === 'hover' && fecharDepois()}>
          {titulo && <div className="explica-titulo">{titulo}</div>}
          {corpo && <div className="explica-texto">{corpo}</div>}
          {passos.length > 0 && (
            <div className="explica-bloco">
              <span className="explica-rotulo">Como usar</span>
              {passos.length === 1 ? <div>{passos[0]}</div> : <ol>{passos.map((p, i) => <li key={i}>{p}</li>)}</ol>}
            </div>
          )}
          {exemplo && (
            <div className="explica-exemplo"><span className="explica-rotulo">Exemplo</span><div>{exemplo}</div></div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export function Dica({ texto, children, lado = 'cima' }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const mostrar = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: lado === 'cima' ? r.top : r.bottom });
  };
  return (
    <span ref={ref} onMouseEnter={mostrar} onMouseLeave={() => setPos(null)} onFocus={mostrar} onBlur={() => setPos(null)} style={{ display: 'inline-flex' }}>
      {children}
      {pos && texto && createPortal(
        <div className="dica-flutuante" style={{ left: pos.x, top: pos.y, transform: lado === 'cima' ? 'translate(-50%, calc(-100% - 8px))' : 'translate(-50%, 8px)' }}>
          {texto}
        </div>,
        document.body,
      )}
    </span>
  );
}

// ------------------------------------------------------------------ modal e gaveta
function useEsc(ativo, fn) {
  useEffect(() => {
    if (!ativo) return undefined;
    const h = (e) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ativo, fn]);
}

export function Modal({ aberto, aoFechar, titulo, subtitulo, largura = 680, children, rodape }) {
  useEsc(aberto, aoFechar);
  return createPortal(
    <AnimatePresence>
      {aberto && (
        <>
          <motion.div className="veu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={aoFechar} />
          <motion.div className="modal" role="dialog" aria-modal="true" style={{ width: `min(${largura}px, calc(100vw - 32px))` }}
            initial={{ opacity: 0, y: 14, scale: 0.98, x: '-50%' }} animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }} exit={{ opacity: 0, y: 8, scale: 0.98, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
            <div className="modal-topo">
              <div>
                <h2>{titulo}</h2>
                {subtitulo && <div className="mudo pequeno" style={{ marginTop: 2 }}>{subtitulo}</div>}
              </div>
              <BotaoIcone icone={X} rotulo="Fechar" onClick={aoFechar} />
            </div>
            <div className="modal-corpo">{children}</div>
            {rodape && <div className="modal-rodape">{rodape}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Gaveta({ aberto, aoFechar, titulo, subtitulo, largura = 720, children, acoes }) {
  useEsc(aberto, aoFechar);
  return createPortal(
    <AnimatePresence>
      {aberto && (
        <>
          <motion.div className="veu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={aoFechar} />
          <motion.aside className="gaveta" role="dialog" aria-modal="true" style={{ width: `min(${largura}px, 100vw)` }}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}>
            <div className="gaveta-topo">
              <div className="cresce" style={{ minWidth: 0 }}>
                <h2 className="truncar">{titulo}</h2>
                {subtitulo && <div className="mudo pequeno" style={{ marginTop: 2 }}>{subtitulo}</div>}
              </div>
              {acoes}
              <BotaoIcone icone={X} rotulo="Fechar" onClick={aoFechar} />
            </div>
            <div className="gaveta-corpo">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ------------------------------------------------------------------ menu suspenso
export function Menu({ gatilho, itens, alinhar = 'direita' }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const f = (e) => !ref.current?.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [aberto]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span onClick={() => setAberto((a) => !a)} style={{ display: 'inline-flex' }}>{gatilho}</span>
      <AnimatePresence>
        {aberto && (
          <motion.div className="menu-lista" style={{ top: 'calc(100% + 6px)', [alinhar === 'direita' ? 'right' : 'left']: 0 }}
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
            {itens.filter(Boolean).map((it, i) =>
              it === '-' ? <div key={i} className="separador" style={{ margin: '4px 0' }} /> : (
                <button key={i} type="button" className={cx('menu-item', it.perigo && 'perigo')} disabled={it.desabilitado}
                  onClick={() => { setAberto(false); it.aoClicar?.(); }}>
                  {it.icone && <it.icone size={15} />}
                  <span className="cresce">{it.rotulo}</span>
                  {it.atalho && <span className="tecla">{it.atalho}</span>}
                </button>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ tabela ordenável
/**
 * colunas: [{ chave, titulo, alinhar: 'direita'|'centro', largura, ordenavel, valor: (linha) => comparável, render: (linha, i) => node, dica }]
 */
export function Tabela({ colunas, linhas, chaveLinha = (l, i) => l.id ?? i, aoClicarLinha, selecionada, ordenacaoInicial, densa, maxAltura, vazio, className, rodape, limite }) {
  const [ord, setOrd] = useState(ordenacaoInicial || null); // { chave, dir: 'asc'|'desc' }
  const ordenadas = useMemo(() => {
    if (!ord) return linhas;
    const col = colunas.find((c) => c.chave === ord.chave);
    if (!col) return linhas;
    const f = col.valor || ((l) => l[col.chave]);
    return [...linhas].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y;
      return ord.dir === 'asc' ? r : -r;
    });
  }, [linhas, ord, colunas]);
  const visiveis = limite ? ordenadas.slice(0, limite) : ordenadas;
  const alternar = (c) => {
    if (!c.ordenavel) return;
    setOrd((o) => (o?.chave === c.chave ? { chave: c.chave, dir: o.dir === 'desc' ? 'asc' : 'desc' } : { chave: c.chave, dir: c.dirInicial || 'desc' }));
  };
  if (!linhas.length && vazio) return vazio;
  return (
    <div className={cx('tabela-envolta', className)} style={maxAltura ? { maxHeight: maxAltura } : undefined}>
      <table className={cx('tabela', densa && 'densa')}>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.chave} className={cx(c.alinhar, c.ordenavel && 'ordenavel')} style={{ width: c.largura }} onClick={() => alternar(c)} title={c.dica}>
                <span className="linha g4" style={{ display: 'inline-flex', justifyContent: c.alinhar === 'direita' ? 'flex-end' : undefined }}>
                  {c.titulo}
                  {ord?.chave === c.chave && (ord.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visiveis.map((l, i) => {
            const k = chaveLinha(l, i);
            return (
              <tr key={k} className={cx(aoClicarLinha && 'clicavel', selecionada === k && 'selecionada')} onClick={aoClicarLinha ? () => aoClicarLinha(l) : undefined}>
                {colunas.map((c) => (
                  <td key={c.chave} className={c.alinhar}>{c.render ? c.render(l, i) : l[c.chave]}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rodape}
    </div>
  );
}

// ------------------------------------------------------------------ toasts
const CtxToast = createContext(null);

export function ProvedorToast({ children }) {
  const [itens, setItens] = useState([]);
  const remover = useCallback((id) => setItens((l) => l.filter((t) => t.id !== id)), []);
  const add = useCallback((tipo, texto, ms = 4200) => {
    const id = Math.random().toString(36).slice(2);
    setItens((l) => [...l.slice(-3), { id, tipo, texto }]);
    setTimeout(() => remover(id), ms);
  }, [remover]);
  const api = useMemo(() => ({ ok: (t) => add('ok', t), erro: (t) => add('erro', t, 6500), info: (t) => add('info', t) }), [add]);
  return (
    <CtxToast.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          <AnimatePresence>
            {itens.map((t) => (
              <motion.div key={t.id} layout className={cx('toast', t.tipo)} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }}>
                <span className="ic">{t.tipo === 'ok' ? <Check size={16} strokeWidth={2.6} /> : t.tipo === 'erro' ? <XCircle size={16} /> : <Info size={16} />}</span>
                <span className="cresce">{t.texto}</span>
                <button type="button" className="botao fantasma p icone" onClick={() => remover(t.id)} aria-label="Fechar"><X size={13} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </CtxToast.Provider>
  );
}

/** const toast = useToast(); toast.ok('Salvo'); toast.erro('...'); */
export function useToast() {
  return useContext(CtxToast) || { ok: console.log, erro: console.error, info: console.log };
}

// ------------------------------------------------------------------ utilidades de layout
export function Secao({ titulo, descricao, acoes, children, className, info }) {
  return (
    <section className={cx('coluna', className)} style={{ gap: 12, marginBottom: 24 }}>
      {(titulo || acoes) && (
        <div className="linha entre">
          <div>
            {titulo && (
              <h2 className="com-explica">
                {titulo}
                {info && <Explica titulo={typeof titulo === 'string' ? titulo : undefined} {...info} />}
              </h2>
            )}
            {descricao && <div className="mudo pequeno" style={{ marginTop: 2 }}>{descricao}</div>}
          </div>
          {acoes && <div className="linha">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function LinkExterno({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="linha g4" style={{ display: 'inline-flex' }}>
      {children}
      <ArrowUpRight size={12} />
    </a>
  );
}

/** Lista com animação de reordenação (FLIP) — use para rankings. */
export function ListaAnimada({ itens, chave, render, className, gap = 6 }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap }}>
      <AnimatePresence initial={false}>
        {itens.map((it, i) => (
          <motion.div key={chave(it)} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36, opacity: { duration: 0.2 } }}>
            {render(it, i)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
