import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { fmtMoeda, fmtNumero, fmtPerc } from '../../lib/formato.js';
import { BarraEmpilhada, Cartao, Progresso, Vazio } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { GraficoBarras } from '../../componentes/graficos.jsx';
import { agruparPorGrupo, fmtCrit } from './util.js';

const TITULO_GRUPO = { vendedor: 'equipe', cliente: 'cidade', canal: 'tipo de canal' };

/** Visão agregada por grupo (equipes quando o nível é vendedor). */
export default function Equipes({ ap, aoFiltrar }) {
  const nivel = ap.campanha?.participantes?.nivel;
  const grupos = useMemo(() => agruparPorGrupo(ap).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.premio_proj - a.premio_proj), [ap]);
  const nomeGrupo = TITULO_GRUPO[nivel] || 'grupo';
  if (grupos.length < 2) {
    return <div className="cartao"><Vazio icone={Users} titulo="Sem grupos para comparar" texto="Esta campanha não tem participantes organizados em grupos." /></div>;
  }
  const comScore = grupos.some((g) => g.score != null);

  return (
    <div className="coluna" style={{ gap: 16 }}>
      {comScore && (
        <Cartao titulo={`Pontuação média por ${nomeGrupo}`} subtitulo="A barra é a média atual; a linha vertical marca 100% (meta)." info={EXPLICA.equipes}>
          <GraficoBarras
            itens={grupos.map((g) => ({ chave: g.chave, rotulo: g.nome.replace(/^Equipe\s+/i, ''), sub: `${g.membros} participantes`, valor: g.score ?? 0 }))}
            formato="perc"
            limite={20}
            referencia={100}
            largRotulo={180}
          />
        </Cartao>
      )}
      <div className="cartao">
        <div className="cmp-equipe mudo pequeno" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, fontSize: 11 }}>
          <span>{nomeGrupo}</span>
          <span className="ocultavel">Situação</span>
          <span style={{ textAlign: 'right' }}>Média / proj.</span>
          <span style={{ textAlign: 'right' }} className="ocultavel">Prêmio proj.</span>
        </div>
        {grupos.map((g) => (
          <div key={g.chave} className="cmp-equipe" style={{ cursor: aoFiltrar ? 'pointer' : 'default' }} onClick={aoFiltrar ? () => aoFiltrar(g.nome) : undefined}
            title={aoFiltrar ? 'Ver participantes deste grupo no ranking' : undefined}>
            <div style={{ minWidth: 0 }}>
              <div className="forte truncar">{g.nome}</div>
              <div className="mudo pequeno">
                {fmtNumero(g.membros)} participantes · {fmtNumero(g.atingiram)} bateram · {fmtNumero(g.acelerar)} precisam acelerar
              </div>
              <div className="linha quebra pequeno sec" style={{ gap: 10, marginTop: 4 }}>
                {ap.criterios.map((c, i) =>
                  g.criterios[i]?.meta != null ? (
                    <span key={c.id} title={c.nome}>
                      {ap.criterios.length > 1 ? `${c.nome}: ` : ''}
                      <b className="num" style={{ color: 'var(--tinta)' }}>{fmtCrit(g.criterios[i].realizado, c, { compacto: true })}</b> / {fmtCrit(g.criterios[i].meta, c, { compacto: true })}
                      {' '}({fmtPerc(g.criterios[i].atingimento)})
                    </span>
                  ) : null,
                )}
              </div>
            </div>
            <div className="ocultavel">
              <BarraEmpilhada partes={g.status} altura={8} mostrarLegenda={false} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="forte num">{fmtPerc(g.score)}</div>
              <div className="mudo pequeno num">→ {fmtPerc(g.score_proj)}</div>
              {g.score != null && <div style={{ marginTop: 6 }}><Progresso valor={g.score} projecao={g.score_proj} espessura="p" /></div>}
            </div>
            <div style={{ textAlign: 'right' }} className="ocultavel">
              <div className="forte num">{fmtMoeda(g.premio_proj, { compacto: true })}</div>
              <div className="mudo pequeno num">atual {fmtMoeda(g.premio, { compacto: true })}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
