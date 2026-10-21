import { Crown, MoreHorizontal, Pencil, Users } from 'lucide-react';
import { navegar } from '../../lib/rotas.js';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc, fmtPeriodo, fmtRelativo } from '../../lib/formato.js';
import { Anel, BarraEmpilhada, Botao, BotaoIcone, Menu, Progresso, Selo, SeloCampanha } from '../../componentes/ui.jsx';
import { corDaCampanha, nomeNivel, partesStatus, textoTempoResumo } from './util.js';
import { LogoFabricante } from '../../componentes/Imagens.jsx';

function Estat({ rotulo, valor, grande, sub }) {
  return (
    <div className="cmp-estat">
      <span className="cmp-estat-rotulo">{rotulo}</span>
      <span className={`cmp-estat-valor${grande ? ' g' : ''}`}>{valor}</span>
      {sub && <span className="cmp-estat-sub">{sub}</span>}
    </div>
  );
}

/** Cartão de campanha na lista. `itensMenu(c)` vem de useAcoesCampanha. */
export default function CartaoCampanha({ c, indice, itensMenu }) {
  const r = c.resumo && !c.resumo.erro ? c.resumo : null;
  const cor = corDaCampanha(c, indice);
  const rascunho = c.status === 'rascunho' || !r;
  const ir = () => navegar(rascunho ? `/campanhas/${c.id}/editar` : `/campanhas/${c.id}`);
  const partes = r ? partesStatus(r) : [];
  const acelerar = (r?.risco || 0) + (r?.atencao || 0) + (r?.nao_atingiu || 0);
  const futura = r?.tempo_status === 'futura';
  const terminou = r?.tempo_status === 'encerrada';
  const ranking = r && r.atingimento_geral == null && !futura;

  let estatPrincipal;
  if (futura) estatPrincipal = <Estat rotulo="Início" valor={fmtData(c.inicio)} grande />;
  else if (ranking) estatPrincipal = <Estat rotulo="Formato" valor={<span className="linha g4"><Crown size={18} />Ranking</span>} grande />;
  else if (terminou) estatPrincipal = <Estat rotulo="Prêmio apurado" valor={fmtMoeda(r.premio_total, { compacto: true })} grande />;
  else estatPrincipal = <Estat rotulo="Projeção" valor={fmtPerc(r?.atingimento_geral_proj)} grande />;

  return (
    <div className="cartao cmp-cartao interativo" onClick={ir} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && ir()}>
      <span className="cmp-cartao-faixa" style={{ background: cor }} />
      <div className="cmp-cartao-topo">
        <div className="cresce" style={{ minWidth: 0 }}>
          <div className="pequeno mudo linha g4" style={{ marginBottom: 4, minWidth: 0 }}>
            {c.fornecedor && <LogoFabricante nome={c.fabricante || c.fornecedor} tamanho={18} />}
            <span className="truncar">{c.fornecedor || 'Sem fornecedor'} · {fmtPeriodo(c.inicio, c.fim)}</span>
          </div>
          <div className="cmp-cartao-nome" title={c.nome}>{c.nome}</div>
        </div>
        <div className="linha g4" onClick={(e) => e.stopPropagation()}>
          <SeloCampanha status={c.status} tempo={r?.tempo_status} />
          <Menu gatilho={<BotaoIcone icone={MoreHorizontal} rotulo="Ações da campanha" tamanho="p" />} itens={itensMenu(c)} />
        </div>
      </div>

      <div className="cartao-corpo cresce">
        {rascunho ? (
          <div className="coluna" style={{ gap: 12 }}>
            <div className="sec pequeno">
              {c.status === 'rascunho' ? 'Rascunho' : 'Sem apuração'} · {fmtNumero(c.n_criterios || 0)} {c.n_criterios === 1 ? 'critério' : 'critérios'} · editado {fmtRelativo(c.atualizado_em)}
            </div>
            {c.descricao && <div className="mudo pequeno" style={{ lineHeight: 1.5 }}>{c.descricao}</div>}
            <div onClick={(e) => e.stopPropagation()}>
              <Botao tamanho="p" variante="sutil" icone={Pencil} onClick={() => navegar(`/campanhas/${c.id}/editar`)}>
                Continuar editando
              </Botao>
            </div>
          </div>
        ) : (
          <div className="coluna" style={{ gap: 14 }}>
            <div className="cmp-cartao-meio">
              <Anel valor={futura || ranking ? null : r.atingimento_geral} tamanho={86} espessura={8} rotulo={futura ? 'agendada' : ranking ? 'sem meta' : terminou ? 'final' : 'atual'} />
              <div className="coluna" style={{ gap: 10 }}>
                <div className="linha" style={{ gap: 18 }}>
                  {estatPrincipal}
                  {!futura && !ranking && (
                    <Estat rotulo="Bateram" valor={<>{fmtNumero(r.atingiram)}<span className="mudo" style={{ fontSize: 13, fontWeight: 500 }}> / {fmtNumero(r.participantes)}</span></>} />
                  )}
                </div>
                <div className="cmp-mini-tempo">
                  <div className="rotulo">
                    <span>{textoTempoResumo(r, c.inicio, c.fim)}</span>
                    <span className="num">{fmtPerc((r.progresso || 0) * 100)}</span>
                  </div>
                  <Progresso valor={(r.progresso || 0) * 100} cor="tempo" espessura="p" titulo="Tempo decorrido da campanha" />
                </div>
              </div>
            </div>
            {futura ? (
              <div className="mudo pequeno" style={{ lineHeight: 1.5 }}>{c.descricao || 'A apuração começa automaticamente na data de início.'}</div>
            ) : ranking ? (
              <div className="mudo pequeno" style={{ lineHeight: 1.5 }}>Competição sem meta individual: premia os melhores colocados.</div>
            ) : (
              partes.length > 0 && (
                <div className="coluna g4" style={{ gap: 6 }}>
                  <BarraEmpilhada partes={partes} altura={6} mostrarLegenda={false} />
                  <div className="linha quebra pequeno sec" style={{ gap: 10 }}>
                    {r.atingiram > 0 && <span><b className="num" style={{ color: 'var(--tinta)' }}>{fmtNumero(r.atingiram)}</b> atingiram</span>}
                    {r.no_ritmo > 0 && <span><b className="num" style={{ color: 'var(--tinta)' }}>{fmtNumero(r.no_ritmo)}</b> no ritmo</span>}
                    {acelerar > 0 && <span><b className="num" style={{ color: 'var(--tinta)' }}>{fmtNumero(acelerar)}</b> {terminou ? 'não atingiram' : 'precisam acelerar'}</span>}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="cmp-cartao-rodape">
        <span className="linha g4" style={{ whiteSpace: 'nowrap' }}>
          <Users size={13} />
          {r ? `${fmtNumero(r.participantes)} ${nomeNivel(c.nivel, r.participantes)}` : `Nível: ${nomeNivel(c.nivel, 2)}`}
        </span>
        {r && (r.premio_proj_total > 0 || r.premio_total > 0) ? (
          <span className="truncar" title={`Prêmio apurado até agora: ${fmtMoeda(r.premio_total)}`}>
            {terminou ? 'Prêmio' : 'Prêmio proj.'} <b className="num" style={{ color: 'var(--tinta)' }}>{fmtMoeda(terminou ? r.premio_total : r.premio_proj_total, { compacto: true })}</b>
          </span>
        ) : (
          <Selo>{fmtNumero(c.n_criterios || 0)} {c.n_criterios === 1 ? 'critério' : 'critérios'}</Selo>
        )}
      </div>
    </div>
  );
}
