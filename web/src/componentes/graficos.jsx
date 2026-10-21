import { useMemo, useRef, useState } from 'react';
import { useLargura, useMontado } from '../lib/anim.js';
import { fmtCompacto, fmtValor } from '../lib/formato.js';

/* =====================================================================
   Gráficos em SVG puro, seguindo as especificações de marcas:
   linhas 2px, área a ~10%, barras <=24px com ponta arredondada de 4px,
   grade em linha fina sólida, crosshair + tooltip com todas as séries,
   legenda para >=2 séries, textos sempre na cor de tinta (nunca a cor da série).
   Cores por papel: var(--s1..s8), status var(--bom|aviso|serio|critico).
   ===================================================================== */

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

/** Ticks "bonitos" (1, 2, 2.5, 5 × 10^n). */
export function ticksBonitos(min, max, alvo = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    max = min + 1;
    min = Math.min(0, min);
  }
  const bruto = (max - min) / alvo;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) || bruto;
  const ini = Math.floor(min / passo) * passo;
  const fim = Math.ceil(max / passo) * passo;
  const out = [];
  for (let v = ini; v <= fim + passo / 2; v += passo) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const fmtEixo = (v, formato) => {
  if (formato === 'moeda') return Math.abs(v) >= 1000 ? `R$ ${fmtCompacto(v)}` : `R$ ${fmtValor(v, 'numero')}`;
  if (formato === 'perc') return `${fmtValor(v, 'numero')}%`;
  return fmtCompacto(v);
};

function caminho(pontos) {
  let d = '';
  let aberto = false;
  for (const p of pontos) {
    if (p == null) {
      aberto = false;
      continue;
    }
    d += `${aberto ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    aberto = true;
  }
  return d;
}

export function Legenda({ itens, style }) {
  return (
    <div className="legenda" style={style}>
      {itens.map((it) => (
        <span key={it.rotulo} className="legenda-item">
          <span className={`legenda-chave ${it.tipo || ''}`} style={it.tipo === 'tracejada' ? { borderColor: it.cor } : { background: it.cor }} />
          {it.rotulo}
        </span>
      ))}
    </div>
  );
}

/**
 * Gráfico de linhas com crosshair.
 * @param {{ rotulos: string[], formatarX?: (r:string)=>string, formatarDica?: (r:string)=>string,
 *   series: {id:string,nome:string,valores:(number|null)[],cor:string,estilo?:'solida'|'tracejada',area?:boolean,rotuloFinal?:boolean}[],
 *   formato?: string, altura?: number, marcadorX?: number, rotuloMarcador?: string, legenda?: boolean, zeroBase?: boolean }} p
 */
export function GraficoLinha({ rotulos, formatarX = (r) => r, formatarDica, series, formato = 'numero', altura = 260, marcadorX, rotuloMarcador = 'Hoje', legenda = true, zeroBase = true }) {
  const ref = useRef(null);
  const largura = useLargura(ref);
  const [foco, setFoco] = useState(null);
  const n = rotulos.length;

  const { ys, ticks, x, y, m } = useMemo(() => {
    const todos = series.flatMap((s) => s.valores.filter((v) => v != null && Number.isFinite(v)));
    let mn = todos.length ? Math.min(...todos) : 0;
    let mx = todos.length ? Math.max(...todos) : 1;
    if (zeroBase) mn = Math.min(0, mn);
    if (mx === mn) mx = mn + 1;
    const tk = ticksBonitos(mn, mx + (mx - mn) * 0.04, 4);
    const lblMax = Math.max(...tk.map((t) => fmtEixo(t, formato).length));
    const margem = { e: Math.max(34, lblMax * 6.6 + 10), d: 14, t: 10, b: 26 };
    const w = largura - margem.e - margem.d;
    const h = altura - margem.t - margem.b;
    const y0 = tk[0];
    const y1 = tk[tk.length - 1];
    return {
      m: margem,
      ticks: tk,
      x: (i) => margem.e + (n <= 1 ? w / 2 : (i / (n - 1)) * w),
      y: (v) => margem.t + h - ((v - y0) / (y1 - y0 || 1)) * h,
      ys: [y0, y1],
    };
  }, [series, largura, altura, formato, n, zeroBase]);

  const caminhos = useMemo(
    () =>
      series.map((s) => {
        const pts = s.valores.map((v, i) => (v == null || !Number.isFinite(v) ? null : [x(i), y(v)]));
        let area = null;
        if (s.area) {
          const validos = pts.map((p, i) => (p ? [p, i] : null)).filter(Boolean);
          if (validos.length > 1) {
            const base = y(Math.max(ys[0], 0));
            area = `${caminho(validos.map((v) => v[0]))}L${validos[validos.length - 1][0][0].toFixed(1)},${base}L${validos[0][0][0].toFixed(1)},${base}Z`;
          }
        }
        const ultimo = [...pts].reverse().find(Boolean);
        return { s, d: caminho(pts), area, ultimo, ultimoValor: [...s.valores].reverse().find((v) => v != null) };
      }),
    [series, x, y, ys],
  );

  const passoX = n > 1 ? Math.ceil(n / Math.max(2, Math.floor((largura - m.e) / 70))) : 1;
  const mover = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const w = largura - m.e - m.d;
    const i = Math.round(((px - m.e) / (w || 1)) * (n - 1));
    setFoco(Math.max(0, Math.min(n - 1, i)));
  };

  const dicaX = foco != null ? x(foco) : 0;
  const dicaEsquerda = dicaX > largura * 0.62;

  return (
    <div className="coluna" style={{ gap: 10 }}>
      {legenda && series.length > 1 && (
        <Legenda itens={series.map((s) => ({ rotulo: s.nome, cor: s.cor, tipo: s.estilo === 'tracejada' ? 'tracejada' : '' }))} />
      )}
      <div className="grafico" ref={ref} style={{ height: altura }} onPointerMove={mover} onPointerLeave={() => setFoco(null)}
        role="img" aria-label={`Gráfico de linhas: ${series.map((s) => s.nome).join(', ')}`}>
        <svg width={largura} height={altura}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grade-linha" x1={m.e} x2={largura - m.d} y1={y(t)} y2={y(t)} />
              <text className="eixo-texto" x={m.e - 8} y={y(t) + 4} textAnchor="end">{fmtEixo(t, formato)}</text>
            </g>
          ))}
          <line className="eixo-linha" x1={m.e} x2={largura - m.d} y1={y(ys[0])} y2={y(ys[0])} />
          {rotulos.map((r, i) =>
            (i % passoX === 0 && (i === n - 1 || n - 1 - i >= passoX * 0.6)) || i === n - 1 ? (
              <text key={i} className="eixo-texto" x={x(i)} y={altura - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                {formatarX(r)}
              </text>
            ) : null,
          )}
          {marcadorX != null && marcadorX >= 0 && marcadorX < n - 1 && (
            <g>
              <line className="marca-hoje" x1={x(marcadorX)} x2={x(marcadorX)} y1={m.t} y2={y(ys[0])} />
              <text className="rotulo-hoje" x={x(marcadorX) + 5} y={m.t + 9}>{rotuloMarcador}</text>
            </g>
          )}
          {caminhos.map(({ s, area }) => area && <path key={`a-${s.id}`} className="serie-area" d={area} style={{ fill: s.cor }} />)}
          {caminhos.map(({ s, d }) => (
            <path key={`l-${s.id}-${largura}`} className={`serie-linha ${s.estilo === 'tracejada' ? 'tracejada' : 'desenhar'}`} d={d} style={{ stroke: s.cor }} pathLength={s.estilo === 'tracejada' ? undefined : 1} />
          ))}
          {caminhos.map(({ s, ultimo }) =>
            ultimo && s.pontoFinal !== false && s.estilo !== 'tracejada' ? <circle key={`p-${s.id}`} className="ponto-serie" cx={ultimo[0]} cy={ultimo[1]} r={4.5} style={{ fill: s.cor }} /> : null,
          )}
          {caminhos.map(({ s, ultimo, ultimoValor }) =>
            s.rotuloFinal && ultimo ? (
              <text key={`r-${s.id}`} x={Math.min(ultimo[0] + 8, largura - 4)} y={ultimo[1] - 8} textAnchor={ultimo[0] > largura - 60 ? 'end' : 'start'} style={{ fill: 'var(--tinta)', fontSize: 11.5, fontWeight: 650 }}>
                {fmtValor(ultimoValor, formato, { compacto: true })}
              </text>
            ) : null,
          )}
          {foco != null && (
            <g>
              <line className="cruz" x1={x(foco)} x2={x(foco)} y1={m.t} y2={y(ys[0])} />
              {series.map((s) => {
                const v = s.valores[foco];
                return v == null ? null : <circle key={s.id} className="ponto-serie" cx={x(foco)} cy={y(v)} r={4.5} style={{ fill: s.cor }} />;
              })}
            </g>
          )}
        </svg>
        {foco != null && (
          <div className="dica-grafico" style={{ left: 0, top: 6, transform: `translateX(${dicaEsquerda ? dicaX - 190 : dicaX + 12}px)` }}>
            <div className="titulo">{(formatarDica || formatarX)(rotulos[foco])}</div>
            {series.map((s) => (
              <div key={s.id} className="linha-serie">
                <span className="nome">
                  <span className={`chave ${s.estilo === 'tracejada' ? 'tracejada' : ''}`} style={{ background: s.cor, color: s.cor }} />
                  {s.nome}
                </span>
                <span className="valor">{fmtValor(s.valores[foco], formato)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Minigráfico de tendência (sem eixos). O último ponto ganha destaque. */
export function Sparkline({ valores, largura = 96, altura = 28, cor = 'var(--tinta-3)', destaque = 'var(--acento)', area = true }) {
  const vs = valores.map((v) => (v == null || !Number.isFinite(v) ? null : v));
  const validos = vs.filter((v) => v != null);
  if (validos.length < 2) return <svg width={largura} height={altura} />;
  const mn = Math.min(...validos);
  const mx = Math.max(...validos);
  const x = (i) => 2 + (i / (vs.length - 1)) * (largura - 6);
  const y = (v) => altura - 3 - ((v - mn) / (mx - mn || 1)) * (altura - 6);
  const pts = vs.map((v, i) => (v == null ? null : [x(i), y(v)]));
  const d = caminho(pts);
  let iu = vs.length - 1;
  while (iu > 0 && vs[iu] == null) iu--;
  const primeiro = pts.findIndex(Boolean);
  const dArea = area ? `${d}L${x(iu).toFixed(1)},${altura}L${x(primeiro).toFixed(1)},${altura}Z` : null;
  return (
    <svg width={largura} height={altura} style={{ overflow: 'visible', flex: 'none' }} aria-hidden>
      {dArea && <path d={dArea} style={{ fill: destaque, opacity: 0.08 }} />}
      <path d={d} fill="none" style={{ stroke: cor }} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(iu)} cy={y(vs[iu])} r={3} style={{ fill: destaque, stroke: 'var(--superficie)' }} strokeWidth={1.5} />
    </svg>
  );
}

/**
 * Barras horizontais (ranking/composição). itens: [{ rotulo, valor, cor?, sub?, chave? }]
 * Valor na ponta; dica por barra; clique opcional.
 */
export function GraficoBarras({ itens, formato = 'numero', limite = 12, aoClicar, corPadrao = 'var(--s1)', alturaBarra = 16, largRotulo = 150, referencia }) {
  const montado = useMontado();
  const [foco, setFoco] = useState(null);
  const lista = itens.slice(0, limite);
  const max = Math.max(referencia || 0, ...lista.map((i) => i.valor || 0), 1e-9);
  return (
    <div className="coluna" style={{ gap: 8 }} role="list">
      {lista.map((it, i) => {
        const p = Math.max(0, (it.valor || 0) / max) * 100;
        return (
          <div key={it.chave ?? it.rotulo} role="listitem" className="linha" style={{ gap: 10, cursor: aoClicar ? 'pointer' : 'default', opacity: foco != null && foco !== i ? 0.6 : 1, transition: 'opacity 120ms' }}
            onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)} onClick={aoClicar ? () => aoClicar(it) : undefined} title={`${it.rotulo}: ${fmtValor(it.valor, formato)}`}>
            <div style={{ width: largRotulo, flex: 'none' }} className="coluna g4">
              <span className="truncar pequeno" style={{ color: 'var(--tinta)' }}>{it.rotulo}</span>
              {it.sub && <span className="truncar mini mudo" style={{ marginTop: -4 }}>{it.sub}</span>}
            </div>
            <div className="cresce" style={{ position: 'relative', height: alturaBarra }}>
              <div className="barra-grafico" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${montado ? p : 0}%`, minWidth: it.valor > 0 ? 2 : 0, background: it.cor || corPadrao, borderRadius: '0 4px 4px 0', transition: `width 800ms var(--curva) ${i * 25}ms` }} />
              {referencia != null && <div style={{ position: 'absolute', left: `${(referencia / max) * 100}%`, top: -3, bottom: -3, width: 1, background: 'var(--tinta-3)' }} title="Meta" />}
            </div>
            <span className="num pequeno forte" style={{ width: 84, textAlign: 'right', flex: 'none' }}>{fmtValor(it.valor, formato, { compacto: true })}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Colunas verticais (ex.: vendas por dia). itens: [{ rotulo, valor, destaque? }] */
export function GraficoColunas({ itens, formato = 'numero', altura = 160, formatarX = (r) => r, cor = 'var(--s1)', corDestaque = 'var(--s2)' }) {
  const ref = useRef(null);
  const largura = useLargura(ref);
  const montado = useMontado();
  const [foco, setFoco] = useState(null);
  const n = itens.length || 1;
  const mx = Math.max(1e-9, ...itens.map((i) => i.valor || 0));
  const tk = ticksBonitos(0, mx, 3);
  const top = tk[tk.length - 1];
  const m = { e: 40, d: 6, t: 8, b: 22 };
  const w = largura - m.e - m.d;
  const h = altura - m.t - m.b;
  const banda = w / n;
  const bw = Math.min(24, Math.max(2, banda - 2));
  const passoX = Math.ceil(n / Math.max(2, Math.floor(w / 56)));
  return (
    <div className="grafico" ref={ref} style={{ height: altura }} onPointerLeave={() => setFoco(null)}>
      <svg width={largura} height={altura}>
        {tk.map((t) => (
          <g key={t}>
            <line className="grade-linha" x1={m.e} x2={largura - m.d} y1={m.t + h - (t / top) * h} y2={m.t + h - (t / top) * h} />
            <text className="eixo-texto" x={m.e - 6} y={m.t + h - (t / top) * h + 4} textAnchor="end">{fmtEixo(t, formato)}</text>
          </g>
        ))}
        {itens.map((it, i) => {
          const bh = montado ? ((it.valor || 0) / top) * h : 0;
          const x0 = m.e + i * banda + (banda - bw) / 2;
          const r = Math.min(4, bw / 2, bh);
          const y0 = m.t + h - bh;
          const d = bh <= 0 ? '' : `M${x0},${m.t + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${m.t + h}Z`;
          return (
            <g key={i} onPointerEnter={() => setFoco(i)}>
              <rect x={m.e + i * banda} y={m.t} width={banda} height={h} fill="transparent" />
              <path d={d} style={{ fill: it.destaque ? corDestaque : cor, opacity: foco != null && foco !== i ? 0.55 : 1, transition: 'opacity 120ms, d 600ms var(--curva)' }} />
            </g>
          );
        })}
        {itens.map((it, i) => (i % passoX === 0 ? <text key={`x${i}`} className="eixo-texto" x={m.e + i * banda + banda / 2} y={altura - 6} textAnchor="middle">{formatarX(it.rotulo)}</text> : null))}
      </svg>
      {foco != null && (
        <div className="dica-grafico" style={{ left: 0, top: 4, transform: `translateX(${Math.min(largura - 180, m.e + foco * banda + banda)}px)` }}>
          <div className="titulo">{formatarX(itens[foco].rotulo)}</div>
          <div className="valor">{fmtValor(itens[foco].valor, formato)}</div>
        </div>
      )}
    </div>
  );
}

/** Rosca (donut) com 2px de respiro entre fatias. fatias: [{ rotulo, valor, cor }] */
export function Rosca({ fatias, tamanho = 150, espessura = 18, centro, subCentro, formato = 'numero' }) {
  const montado = useMontado();
  const [foco, setFoco] = useState(null);
  const total = fatias.reduce((a, f) => a + (f.valor || 0), 0) || 1;
  const r = (tamanho - espessura) / 2;
  const c = 2 * Math.PI * r;
  const respiro = fatias.filter((f) => f.valor > 0).length > 1 ? 2 : 0;
  let acum = 0;
  const f = foco != null ? fatias[foco] : null;
  return (
    <div style={{ position: 'relative', width: tamanho, height: tamanho, flex: 'none' }}>
      <svg width={tamanho} height={tamanho} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="var(--superficie-2)" strokeWidth={espessura} />
        {fatias.map((fa, i) => {
          if (!(fa.valor > 0)) return null;
          const comp = (fa.valor / total) * c;
          const el = (
            <circle key={fa.rotulo} cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" style={{ stroke: fa.cor, transition: 'stroke-dasharray 900ms var(--curva), opacity 120ms' }}
              strokeWidth={foco === i ? espessura + 4 : espessura} strokeDasharray={`${montado ? Math.max(0, comp - respiro) : 0} ${c}`} strokeDashoffset={-acum}
              opacity={foco != null && foco !== i ? 0.45 : 1} onPointerEnter={() => setFoco(i)} onPointerLeave={() => setFoco(null)}>
              <title>{`${fa.rotulo}: ${fmtValor(fa.valor, formato)}`}</title>
            </circle>
          );
          acum += comp;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <div>
          <div style={{ fontSize: tamanho * 0.16, fontWeight: 650, letterSpacing: '-0.02em' }}>{f ? fmtValor(f.valor, formato) : centro}</div>
          <div className="mudo" style={{ fontSize: 11 }}>{f ? f.rotulo : subCentro}</div>
        </div>
      </div>
    </div>
  );
}
