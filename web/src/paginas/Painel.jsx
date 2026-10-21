import { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon, ArrowRight, Bell, CheckCircle2, Coins, Database, Megaphone, Plus, RefreshCw, Send, Sparkles, TrendingDown,
  Trophy, Users,
} from 'lucide-react';
import { useApi } from '../lib/api.js';
import { navegar } from '../lib/rotas.js';
import { fmtData, fmtMoeda, fmtPerc, fmtRelativo, plural } from '../lib/formato.js';
import {
  Avatar, Botao, Cabecalho, Cartao, ErroCarga, Esqueleto, Explica, ListaAnimada, Numero, Progresso, Selo, Vazio, cx,
} from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import { Legenda } from '../componentes/graficos.jsx';
import CartaoCampanha from './painel/CartaoCampanha.jsx';
import { SEVERIDADE } from './sistema/comum.js';
import './painel/painel.css';

const saudacao = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};

// ------------------------------------------------------------------ KPIs
function KpiPainel({ rotulo, icone: Icone, valor, formato = 'numero', rodape, onClick, alerta, info }) {
  return (
    <div className={cx('cartao painel-kpi', onClick && 'interativo', alerta && 'alerta')} onClick={onClick} role={onClick ? 'link' : undefined}>
      <div className="rotulo"><Icone size={15} /><span className="truncar">{rotulo}</span></div>
      {info && <span className="painel-kpi-info"><Explica titulo={rotulo} {...info} tamanho={13} /></span>}
      <div className="valor">{valor == null ? '-' : <Numero valor={valor} formato={formato} compacto={formato === 'moeda'} />}</div>
      <div className="rodape">{rodape}</div>
    </div>
  );
}

function LinhaKpis({ k }) {
  const perc = (n) => (k.participantes ? `${fmtPerc((n / k.participantes) * 100)} dos participantes` : '');
  const usoOrc = k.orcamento_total > 0 ? ((k.premio_proj_orcado ?? k.premio_proj_total) / k.orcamento_total) * 100 : null;
  return (
    <div className="painel-kpis escalonado">
      <KpiPainel rotulo="Campanhas ativas" icone={Trophy} valor={k.campanhas_ativas} onClick={() => navegar('/campanhas')} info={EXPLICA.painelCampanhasAtivas}
        rodape={k.faturamento_campanhas > 0 ? <span>{fmtMoeda(k.faturamento_campanhas, { compacto: true })} vendidos nelas</span> : null} />
      <KpiPainel rotulo="Participantes" icone={Users} valor={k.participantes} rodape={<span>somando todas as campanhas</span>} info={EXPLICA.painelParticipantes} />
      <KpiPainel rotulo="Bateram a meta" icone={CheckCircle2} valor={k.atingiram} rodape={<span>{perc(k.atingiram)}</span>} info={EXPLICA.painelAtingiram} />
      <KpiPainel rotulo="Em risco" icone={TrendingDown} valor={k.em_risco} rodape={<span>{perc(k.em_risco)}</span>} info={EXPLICA.painelRisco} />
      <KpiPainel rotulo="Prêmios projetados" icone={Coins} valor={k.premio_proj_total} formato="moeda" info={EXPLICA.painelPremios}
        rodape={usoOrc != null ? (
          <div className="coluna" style={{ gap: 5, width: '100%' }}>
            <Progresso valor={Math.min(usoOrc, 100)} espessura="p" cor={usoOrc > 100 ? 'critico' : usoOrc > 90 ? 'aviso' : 'bom'} titulo={`${fmtPerc(usoOrc)} do orçamento`} />
            <span style={usoOrc > 100 ? { color: 'var(--critico-texto)', fontWeight: 600 } : undefined}>
              {fmtPerc(usoOrc)} do orçamento ({fmtMoeda(k.orcamento_total, { compacto: true })})
            </span>
          </div>
        ) : <span>apurado hoje: {fmtMoeda(k.premio_total ?? 0, { compacto: true })}</span>} />
      <KpiPainel rotulo="Alertas críticos" icone={AlertOctagon} valor={k.alertas_criticos} alerta={k.alertas_criticos > 0} info={EXPLICA.painelAlertas}
        onClick={() => navegar('/insights')} rodape={<span className="linha g4">Ver central <ArrowRight size={12} /></span>} />
    </div>
  );
}

function EsqueletoPainel() {
  return (
    <>
      <div className="painel-kpis">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="cartao painel-kpi"><Esqueleto altura={12} largura="60%" /><Esqueleto altura={28} largura="50%" /><Esqueleto altura={10} largura="70%" /></div>)}
      </div>
      <div className="painel-grade">
        <div className="painel-campanhas">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="cartao" style={{ padding: 16 }}><Esqueleto altura={14} largura="50%" /><div style={{ height: 12 }} /><Esqueleto altura={110} /><div style={{ height: 12 }} /><Esqueleto altura={8} /></div>)}
        </div>
        <div className="cartao" style={{ padding: 16 }}><Esqueleto linhas={6} altura={14} /></div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ alertas
function ListaAlertas({ alertas }) {
  if (!alertas?.length) {
    return <Vazio icone={CheckCircle2} titulo="Nenhum alerta agora" texto="As campanhas estão sob controle. Os alertas aparecem aqui automaticamente." />;
  }
  const ordenados = [...alertas].sort((a, b) => (SEVERIDADE[a.severidade]?.ordem ?? 9) - (SEVERIDADE[b.severidade]?.ordem ?? 9)).slice(0, 7);
  return (
    <div className="painel-lista">
      {ordenados.map((a) => {
        const s = SEVERIDADE[a.severidade] || SEVERIDADE.info;
        const irPara = a.acao?.rota || (a.campanha_id ? `/campanhas/${a.campanha_id}` : '/insights');
        return (
          <div key={a.id} className="painel-item" style={{ cursor: 'pointer' }} onClick={() => navegar(irPara)}>
            <Selo cor={s.cor} icone={s.icone} title={s.rotulo} style={{ marginTop: 1 }}>{s.rotulo}</Selo>
            <div className="cresce" style={{ minWidth: 0 }}>
              <div className="forte pequeno" style={{ color: 'var(--tinta)' }}>{a.titulo}</div>
              {a.descricao && <div className="mini sec clamp-2" style={{ marginTop: 2 }}>{a.descricao}</div>}
              <div className="linha g4 mini mudo" style={{ marginTop: 4 }}>
                {a.campanha && <span className="truncar">{a.campanha}</span>}
                {a.acao?.rotulo && <span className="linha g4" style={{ color: 'var(--acento-texto)', flex: 'none' }}>· {a.acao.rotulo} <ArrowRight size={11} /></span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ encerrando em breve
function Encerrando({ campanhas }) {
  const lista = campanhas
    .filter((c) => (c.tempo?.status === 'andamento' && c.tempo?.restantes <= 7) || (c.status === 'ativa' && c.tempo?.status === 'encerrada'))
    .sort((a, b) => (a.tempo?.status === 'encerrada' ? -1 : 0) - (b.tempo?.status === 'encerrada' ? -1 : 0) || (a.tempo?.restantes ?? 0) - (b.tempo?.restantes ?? 0));
  if (!lista.length) return <div className="mudo pequeno" style={{ padding: '6px 0' }}>Nenhuma campanha termina nos próximos 7 dias.</div>;
  return (
    <div className="painel-lista">
      {lista.map((c) => {
        const fechada = c.tempo?.status === 'encerrada';
        const proj = c.resumo?.atingimento_geral_proj;
        return (
          <div key={c.id} className="painel-item" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => navegar(`/campanhas/${c.id}`)}>
            <div className={cx('contagem-regressiva', (fechada || c.tempo?.restantes <= 2) && 'urgente')}>
              <span className="n">{fechada ? '0' : c.tempo?.restantes}</span>
              <span className="u">{fechada ? 'fim' : 'dias'}</span>
            </div>
            <div className="cresce" style={{ minWidth: 0 }}>
              <div className="forte pequeno truncar">{c.nome}</div>
              <div className="mini mudo truncar">
                {fechada ? 'Período terminou. Encerre para congelar a apuração' : `Termina em ${fmtData(c.tempo?.fim)} · projeção ${fmtPerc(proj)}`}
              </div>
            </div>
            {!fechada && proj != null && (
              <Selo cor={proj >= 100 ? 'bom' : proj >= 85 ? 'aviso' : 'critico'}>{proj >= 100 ? 'Vai bater' : proj >= 85 ? 'No limite' : 'Não bate'}</Selo>
            )}
            {fechada && <Selo cor="aviso">Fechar</Selo>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ atividade
const ICONE_ATIVIDADE = { disparo: Send, importacao: Database, campanha: Trophy, ia: Sparkles };
function Atividade({ itens }) {
  if (!itens?.length) return <div className="mudo pequeno">Sem atividade recente.</div>;
  return (
    <div className="painel-lista">
      {itens.slice(0, 8).map((a, i) => {
        const Ic = ICONE_ATIVIDADE[a.tipo] || Bell;
        return (
          <div key={`${a.criado_em}-${i}`} className="painel-item" style={{ alignItems: 'center' }}>
            <span className="ic"><Ic size={14} /></span>
            <span className="cresce pequeno" style={{ minWidth: 0 }}>{a.texto}</span>
            <span className="mini mudo" style={{ flex: 'none' }}>{fmtRelativo(a.criado_em)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ ranking geral
function Medalha({ pos }) {
  if (pos > 3) return <span className="pos">{pos}º</span>;
  return <span className={cx('medalha', pos === 1 ? 'ouro' : pos === 2 ? 'prata' : 'bronze')}>{pos}</span>;
}

function RankingGeral({ itens }) {
  if (!itens?.length) return <Vazio icone={Trophy} titulo="Sem ranking ainda" texto="O ranking geral aparece quando há campanhas ativas por vendedor." />;
  return (
    <ListaAnimada
      itens={itens.slice(0, 10)}
      chave={(x) => x.chave}
      gap={2}
      render={(x, i) => (
        <div className="rg-linha">
          <Medalha pos={i + 1} />
          <div className="linha" style={{ gap: 10, minWidth: 0 }}>
            <Avatar nome={x.nome} foto={x.foto} tamanho="p" />
            <div style={{ minWidth: 0 }}>
              <div className="forte pequeno truncar">{x.nome}</div>
              <div className="mini mudo truncar">
                {[x.equipe, plural(x.campanhas ?? 0, 'campanha', 'campanhas')].filter(Boolean).join(' · ')}
                {x.atingiu > 0 && <span style={{ color: 'var(--bom-texto)', fontWeight: 600 }}> · {x.atingiu} meta{x.atingiu > 1 ? 's' : ''} batida{x.atingiu > 1 ? 's' : ''}</span>}
              </div>
            </div>
          </div>
          <div className="rg-score">
            <span className="pequeno forte num" style={{ textAlign: 'right' }}>{fmtPerc(x.media_score)}</span>
            <Progresso valor={x.media_score} espessura="p" />
          </div>
          <div className="rg-premio pequeno num" style={{ textAlign: 'right' }}>
            <div className="forte">{fmtMoeda(x.premio_proj ?? 0, { compacto: true })}</div>
            <div className="mini mudo">prêmio proj.</div>
          </div>
        </div>
      )}
    />
  );
}

// ------------------------------------------------------------------ página
export default function Painel({ status }) {
  const { dados, erro, carregando, recarregar } = useApi('/painel', { intervalo: 60000, vivo: true });
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const [, tique] = useState(0);
  useEffect(() => {
    if (dados) setAtualizadoEm(new Date().toISOString());
  }, [dados]);
  useEffect(() => {
    const t = setInterval(() => tique((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);

  const campanhas = useMemo(() => {
    const ordem = { andamento: 0, encerrada: 1, futura: 2 };
    return [...(dados?.campanhas || [])].sort((a, b) => (ordem[a.tempo?.status] ?? 3) - (ordem[b.tempo?.status] ?? 3) || (a.tempo?.restantes ?? 99) - (b.tempo?.restantes ?? 99));
  }, [dados]);

  const k = dados?.kpis || {};
  const ref = dados?.referencia || status?.dados?.vendas?.max;

  return (
    <div>
      <Cabecalho
        sobre={<span>{status?.empresa || 'Apurador de campanhas'}</span>}
        titulo={`${saudacao()}! Este é o pulso das suas campanhas.`}
        subtitulo={
          <span className="linha g12 quebra" style={{ display: 'inline-flex' }}>
            {ref && <span>Dados até <strong>{fmtData(ref)}</strong></span>}
            {dados && <span>{plural(k.campanhas_ativas ?? campanhas.length, 'campanha ativa', 'campanhas ativas')}</span>}
            {atualizadoEm && (
              <span className="painel-atualizado">
                <RefreshCw size={12} className={carregando && dados ? 'girando' : undefined} />
                atualizado {fmtRelativo(atualizadoEm)}
              </span>
            )}
          </span>
        }
        acoes={
          <>
            <Botao icone={Megaphone} onClick={() => navegar('/acompanhamentos')}>Disparar acompanhamentos</Botao>
            <Botao variante="primario" icone={Plus} onClick={() => navegar('/campanhas/nova')}>Nova campanha</Botao>
          </>
        }
      />

      {erro && !dados && <ErroCarga erro={erro} aoTentar={recarregar} />}
      {!dados && !erro && <EsqueletoPainel />}

      {dados && (
        <>
          <LinhaKpis k={k} />
          <div className="painel-grade">
            <div className="coluna" style={{ gap: 22 }}>
              <section>
                <div className="painel-secao-topo">
                  <div>
                    <h2 className="com-explica">Campanhas em andamento<Explica titulo="Campanhas em andamento" {...EXPLICA.painelCampanhas} /></h2>
                    <div className="mudo pequeno" style={{ marginTop: 2 }}>Atingimento, ritmo e projeção até o fim de cada campanha</div>
                  </div>
                  {campanhas.length > 0 && (
                    <Legenda itens={[
                      { rotulo: 'Realizado', cor: 'var(--s1)' },
                      { rotulo: 'Meta (ritmo ideal)', cor: 'var(--tinta-3)', tipo: 'tracejada' },
                      { rotulo: 'Projeção', cor: 'var(--s1)', tipo: 'tracejada' },
                    ]} />
                  )}
                </div>
                {campanhas.length ? (
                  <div className="painel-campanhas escalonado">
                    {campanhas.map((c, i) => <CartaoCampanha key={c.id} c={c} indice={i} />)}
                  </div>
                ) : (
                  <Cartao>
                    <Vazio icone={Trophy} titulo="Nenhuma campanha ativa" texto="Crie uma campanha a partir de um modelo pronto. Leva menos de um minuto."
                      acao={<Botao variante="primario" icone={Plus} onClick={() => navegar('/campanhas/nova')}>Criar campanha</Botao>} />
                  </Cartao>
                )}
              </section>

              <section>
                <div className="painel-secao-topo">
                  <div>
                    <h2 className="com-explica">Ranking geral<Explica titulo="Ranking geral" {...EXPLICA.painelRanking} /></h2>
                    <div className="mudo pequeno" style={{ marginTop: 2 }}>Média de pontuação de cada vendedor em todas as campanhas ativas</div>
                  </div>
                </div>
                <Cartao semMargem>
                  <div style={{ padding: 6 }}>
                    <RankingGeral itens={dados.ranking_geral} />
                  </div>
                </Cartao>
              </section>
            </div>

            <aside className="painel-lateral">
              <Cartao titulo="Alertas" subtitulo="Gerados automaticamente a partir das apurações" info={EXPLICA.painelListaAlertas}
                acoes={<Botao tamanho="p" variante="fantasma" iconeDireita={ArrowRight} onClick={() => navegar('/insights')}>Ver todos</Botao>}>
                <ListaAlertas alertas={dados.alertas} />
              </Cartao>
              <Cartao titulo="Encerrando em breve" subtitulo="Próximos 7 dias e campanhas a fechar" info={EXPLICA.painelEncerrando}>
                <Encerrando campanhas={campanhas} />
              </Cartao>
              <Cartao titulo="Atividade recente" info={EXPLICA.painelAtividade}>
                <Atividade itens={dados.atividade} />
              </Cartao>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
