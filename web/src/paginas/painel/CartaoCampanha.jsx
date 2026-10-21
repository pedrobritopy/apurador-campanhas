import { ArrowDownRight, ArrowUpRight, CalendarClock, Hourglass } from 'lucide-react';
import { navegar } from '../../lib/rotas.js';
import { useMontado } from '../../lib/anim.js';
import { fmtComUnidade, fmtData, fmtMoeda, fmtPerc, fmtPeriodo, fmtDataCurta, fmtDelta, primeiroNome } from '../../lib/formato.js';
import { Avatar, BarraEmpilhada, Dica, Numero, SeloCampanha, cx } from '../../componentes/ui.jsx';
import { GraficoLinha } from '../../componentes/graficos.jsx';

export const PARTES_STATUS = [
  { chave: 'atingiram', rotulo: 'Atingiu', cor: 'var(--bom)' },
  { chave: 'no_ritmo', rotulo: 'No ritmo', cor: 'var(--acento)' },
  { chave: 'atencao', rotulo: 'Atenção', cor: 'var(--aviso)' },
  { chave: 'risco', rotulo: 'Em risco', cor: 'var(--critico)' },
  { chave: 'nao_atingiu', rotulo: 'Não atingiu', cor: 'var(--serio)' },
  { chave: 'sem_meta', rotulo: 'Sem meta', cor: 'var(--tinta-3)' },
  { chave: 'aguardando', rotulo: 'Aguardando', cor: 'var(--superficie-3)' },
];

export function partesStatus(resumo = {}) {
  return PARTES_STATUS.map((p) => ({ rotulo: p.rotulo, cor: p.cor, valor: Number(resumo[p.chave] || 0) })).filter((p) => p.valor > 0);
}

const corCampanha = (c, i) => c.cor || `var(--s${(i % 8) + 1})`;

const diasAte = (de, ate) => {
  if (!de || !ate) return null;
  return Math.round((new Date(`${ate}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / 86400000);
};

/** Régua: quanto do tempo passou (marca "hoje") x quanto da meta foi atingido (barra) x projeção (tracejado). */
export function ReguaRitmo({ atingimento, progressoTempo, projecao }) {
  const montado = useMontado();
  const escala = Math.max(100, Math.min(160, Math.max(atingimento ?? 0, projecao ?? 0) + 10));
  const p = (v) => `${(Math.max(0, Math.min(v ?? 0, escala)) / escala) * 100}%`;
  const v = atingimento ?? 0;
  const cor = v >= 100 ? 'var(--bom)' : v >= (progressoTempo ?? 0) ? 'var(--acento)' : v >= (progressoTempo ?? 0) * 0.85 ? 'var(--aviso)' : 'var(--critico)';
  return (
    <div className="ritmo" role="img" aria-label={`Atingimento ${fmtPerc(atingimento)}, tempo decorrido ${fmtPerc(progressoTempo)}`}>
      <div className="ritmo-barra" style={{ width: montado ? p(v) : 0, background: cor }} />
      {projecao != null && <div className="ritmo-proj" style={{ left: montado ? p(projecao) : 0 }} title={`Projeção: ${fmtPerc(projecao)}`} />}
      {progressoTempo != null && <div className="ritmo-hoje" style={{ left: montado ? p(progressoTempo) : 0 }} title={`Tempo decorrido: ${fmtPerc(progressoTempo)}`} />}
      <div style={{ position: 'absolute', top: -3, bottom: -3, left: p(100), width: 1, background: 'var(--tinta-3)' }} title="Meta (100%)" />
    </div>
  );
}

export default function CartaoCampanha({ c, indice = 0 }) {
  const t = c.tempo || {};
  const r = c.resumo || {};
  const ating = r.atingimento_geral;
  const proj = r.atingimento_geral_proj;
  const progresso = t.progresso != null ? t.progresso * 100 : null;
  const emAndamento = t.status === 'andamento';
  const dif = emAndamento && ating != null && progresso != null ? ating - progresso : null;
  const cor = corCampanha(c, indice);
  const serie = c.serie;
  const formato = c.criterios?.[0]?.formato || 'numero';
  const idxRef = serie?.dias ? serie.dias.indexOf(t.referencia) : -1;
  const temSerie = serie?.dias?.length > 1 && (serie.realizado || []).some((v) => v != null);
  const diasParaInicio = t.status === 'futura' ? diasAte(t.referencia, t.inicio) : null;
  const abrir = () => navegar(`/campanhas/${c.id}`);

  let projTexto = null;
  if (emAndamento && proj != null) {
    projTexto = (
      <span className={cx('cc-proj', proj >= 100 ? 'bom' : proj >= 85 ? 'neutro' : 'ruim')}>
        {proj >= 100 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        Projeção {fmtPerc(proj)}
      </span>
    );
  }

  return (
    <article className="cartao cc" role="link" tabIndex={0} onClick={abrir} onKeyDown={(e) => e.key === 'Enter' && abrir()} aria-label={`Abrir apuração de ${c.nome}`}>
      <div className="cc-topo">
        <span className="cc-cor" style={{ background: cor }} />
        <div className="cresce" style={{ minWidth: 0 }}>
          <div className="linha entre" style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="cc-nome truncar">{c.nome}</div>
              <div className="cc-sub truncar">
                {[c.fornecedor, c.nivel_rotulo, fmtPeriodo(t.inicio, t.fim)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <SeloCampanha status={c.status} tempo={t.status} />
          </div>
        </div>
      </div>

      <div className="cc-corpo">
        <div>
          <div className="cc-numero">{ating == null ? '-' : <Numero valor={ating} formato="perc" />}</div>
          <div className="cc-legenda-num">atingimento geral</div>
          {projTexto}
          {t.status === 'futura' && (
            <span className="cc-proj neutro"><CalendarClock size={14} /> Começa {diasParaInicio != null ? `em ${diasParaInicio} dia${diasParaInicio === 1 ? '' : 's'}` : `em ${fmtData(t.inicio)}`}</span>
          )}
          {t.status === 'encerrada' && c.status === 'ativa' && (
            <span className="cc-proj ruim"><Hourglass size={14} /> Feche a apuração</span>
          )}
        </div>
        <div style={{ minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
          {temSerie ? (
            <GraficoLinha
              rotulos={serie.dias}
              formatarX={fmtDataCurta}
              formatarDica={(d) => fmtData(d)}
              formato={formato}
              altura={112}
              legenda={false}
              marcadorX={idxRef >= 0 ? idxRef : undefined}
              series={[
                { id: 'r', nome: 'Realizado', valores: serie.realizado || [], cor: 'var(--s1)', area: true },
                { id: 'm', nome: 'Meta (ritmo ideal)', valores: serie.meta || [], cor: 'var(--tinta-3)', estilo: 'tracejada' },
                { id: 'p', nome: 'Projeção', valores: serie.projecao || [], cor: 'var(--s1)', estilo: 'tracejada' },
              ]}
            />
          ) : (
            <div className="mudo pequeno" style={{ height: 112, display: 'grid', placeItems: 'center', background: 'var(--superficie-2)', borderRadius: 10 }}>
              {t.status === 'futura' ? 'Ainda não começou' : 'Sem vendas no período'}
            </div>
          )}
        </div>
      </div>

      {emAndamento && (
        <div className="cc-ritmo">
          <div className="cc-ritmo-rotulos">
            <span>Tempo decorrido <strong style={{ color: 'var(--tinta)' }}>{fmtPerc(progresso)}</strong> · faltam {t.restantes} dias {t.calendario || ''}</span>
            {dif != null && (
              <Dica texto="Diferença entre o atingimento e a fração do período já decorrida. Positivo = à frente do ritmo necessário.">
                <strong style={{ color: dif >= 0 ? 'var(--bom-texto)' : 'var(--critico-texto)' }}>
                  {dif >= 0 ? 'À frente' : 'Atrás'} {fmtDelta(dif)} p.p.
                </strong>
              </Dica>
            )}
          </div>
          <ReguaRitmo atingimento={ating} progressoTempo={progresso} projecao={proj} />
        </div>
      )}

      {c.criterios?.length > 0 && (
        <div className="cc-crit">
          {c.criterios.slice(0, 2).map((cr) => (
            <div key={cr.nome} className="cc-crit-linha">
              <span className="nome truncar">{cr.nome}</span>
              <span className="num" style={{ color: 'var(--tinta)' }}>{fmtComUnidade(cr.realizado, cr.formato, cr.unidade)}</span>
              {cr.meta != null && <span className="mudo num">/ {fmtComUnidade(cr.meta, cr.formato, cr.unidade)}</span>}
              {cr.atingimento != null && <span className="num forte" style={{ minWidth: 40, textAlign: 'right' }}>{fmtPerc(cr.atingimento)}</span>}
            </div>
          ))}
          {c.criterios.length > 2 && <span className="mini mudo">+ {c.criterios.length - 2} critério(s)</span>}
        </div>
      )}

      {r.participantes > 0 && (
        <div className="cc-status" onClick={(e) => e.stopPropagation()}>
          <BarraEmpilhada partes={partesStatus(r)} altura={8} />
        </div>
      )}

      <div className="cc-rodape">
        <div className="cc-lideres" title="Líderes">
          {(c.lideres || []).slice(0, 3).map((l) => <Avatar key={l.chave} nome={l.nome} foto={l.foto} tamanho="p" />)}
          {c.lideres?.[0] && (
            <span className="pequeno truncar sec">
              Líder: <strong style={{ color: 'var(--tinta)' }}>{primeiroNome(c.lideres[0].nome)}</strong>
              {c.lideres[0].score != null && ` · ${fmtPerc(c.lideres[0].score)}`}
            </span>
          )}
        </div>
        <div className="linha g12" style={{ flex: 'none' }}>
          {c.alertas > 0 && <span className="selo critico">{c.alertas} alerta{c.alertas > 1 ? 's' : ''}</span>}
          <span className="pequeno sec">
            Prêmio proj. <strong className="num" style={{ color: 'var(--tinta)' }}>{fmtMoeda(r.premio_proj_total ?? 0, { compacto: true })}</strong>
          </span>
        </div>
      </div>
    </article>
  );
}
