import { AlertTriangle, Award, CalendarClock, CheckCircle2, Crown, Target, TrendingUp, Users, Wallet, XCircle } from 'lucide-react';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc } from '../../lib/formato.js';
import { Anel, Avatar, BarraEmpilhada, Delta, Explica, Kpi, Numero, Progresso, Selo } from '../../componentes/ui.jsx';
import { ComInfo, EXPLICA } from '../../lib/explicacoes.jsx';
import { TIPO_META, fmtCrit, narrativaApuracao, nomeNivel, partesStatus } from './util.js';

const EPS = 1e-9;

function Narrativa({ frases }) {
  if (!frases.length) return null;
  return (
    <p className="cmp-narrativa">
      {frases.map((f, i) => (
        <span key={i}>
          {f.map((p, j) => (typeof p === 'string' ? <span key={j}>{p}</span> : <strong key={j}>{p.forte}</strong>))}
        </span>
      ))}
    </p>
  );
}

const semMetaEm = (ap) => ap.resumo.participantes > 0 && (ap.resumo.sem_meta || 0) === ap.resumo.participantes;

function Medalhao({ icone: Icone, texto }) {
  return (
    <div style={{ width: 156, height: 156, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--superficie-2)', flex: 'none' }}>
      <div style={{ textAlign: 'center' }}>
        <Icone size={30} style={{ color: 'var(--tinta-3)' }} />
        <div className="mudo pequeno" style={{ marginTop: 6 }}>{texto}</div>
      </div>
    </div>
  );
}

/** Coluna direita do herói antes do início: tamanho do desafio de cada critério. */
function MetasDaCampanha({ ap }) {
  return (
    <div className="coluna" style={{ gap: 12 }}>
      {ap.criterios.map((c) => {
        const exig = c.total.meta != null && c.total.base > 0 && c.totalizar === 'soma' ? (c.total.meta / c.total.base - 1) * 100 : null;
        return (
          <div key={c.id} className="coluna" style={{ gap: 2 }}>
            <span className="forte pequeno">{c.nome}</span>
            <span className="sec pequeno">
              Meta {c.total.meta != null ? <b className="num" style={{ color: 'var(--tinta)' }}>{fmtCrit(c.total.meta, c, { compacto: true })}</b> : '-'}
              {' · '}anterior {fmtCrit(c.total.base, c, { compacto: true })}
            </span>
            {exig != null && <span className="pequeno"><Delta valor={exig} casas={Math.abs(exig) < 10 ? 1 : 0} sufixo="vs período anterior" /></span>}
          </div>
        );
      })}
    </div>
  );
}

/** Coluna direita do herói em campanhas de ranking: os cinco primeiros. */
function Lideres({ ap }) {
  const idx = Math.max(0, ap.criterios.findIndex((c) => c.id === ap.campanha?.premiacao?.criterio_base));
  const crit = ap.criterios[idx];
  return (
    <div className="coluna" style={{ gap: 8 }}>
      {ap.participantes.slice(0, 5).map((l) => (
        <div key={l.chave} className="linha entre" style={{ gap: 10 }}>
          <span className="linha" style={{ gap: 8, minWidth: 0 }}>
            <span className="num mudo" style={{ width: 18, textAlign: 'right', fontWeight: 650 }}>{l.posicao}</span>
            <Avatar nome={l.nome} foto={l.foto} tamanho="p" />
            <span className="truncar pequeno">{l.nome}</span>
          </span>
          <span className="num forte pequeno" style={{ whiteSpace: 'nowrap' }}>{fmtCrit(l.criterios[idx]?.realizado, crit, { compacto: true })}</span>
        </div>
      ))}
    </div>
  );
}

/** Bloco herói da apuração: anel de atingimento, projeção, narrativa e distribuição de status. */
export default function Heroi({ ap }) {
  const r = ap.resumo;
  const t = ap.tempo;
  const nivel = ap.campanha?.participantes?.nivel;
  const semMeta = semMetaEm(ap);
  const futura = t.status === 'futura';
  const partes = partesStatus(r);
  const crit0 = ap.criterios[0];
  const lider = ap.participantes[0];

  let esquerda;
  if (futura) esquerda = <Medalhao icone={CalendarClock} texto="agendada" />;
  else if (semMeta) esquerda = <Medalhao icone={Crown} texto="ranking" />;
  else esquerda = <Anel valor={r.atingimento_geral} tamanho={156} espessura={12} rotulo={t.status === 'encerrada' ? 'resultado final' : 'atingimento atual'} />;

  let rotulo;
  let valor;
  let complemento = null;
  if (futura) {
    rotulo = 'Início da campanha';
    valor = t.dias_para_inicio != null ? `em ${t.dias_para_inicio} ${t.dias_para_inicio === 1 ? 'dia' : 'dias'}` : fmtData(t.inicio);
    complemento = <span className="cmp-heroi-proj">{fmtData(t.inicio)} a {fmtData(t.fim)}</span>;
  } else if (semMeta) {
    rotulo = `Total realizado · ${crit0?.nome || ''}`;
    valor = fmtCrit(crit0?.total?.realizado, crit0, { compacto: true });
    if (lider) complemento = <span className="cmp-heroi-proj">líder <strong>{lider.nome}</strong></span>;
  } else {
    rotulo = t.status === 'encerrada' ? 'Resultado final da campanha' : 'Atingimento geral da campanha';
    valor = <Numero valor={r.atingimento_geral} formato="perc" />;
    if (t.status === 'andamento' && r.atingimento_geral_proj != null) {
      complemento = (
        <span className="cmp-heroi-proj">
          projeção <strong><Numero valor={r.atingimento_geral_proj} formato="perc" /></strong>
          {r.atingimento_geral_proj + EPS >= 100 ? <Selo cor="bom" icone={CheckCircle2}>bate a meta</Selo> : <Selo cor="aviso" icone={AlertTriangle}>abaixo da meta</Selo>}
        </span>
      );
    }
  }

  let direita;
  if (futura) {
    direita = (
      <>
        <span className="forte pequeno">O tamanho do desafio</span>
        <MetasDaCampanha ap={ap} />
      </>
    );
  } else if (semMeta) {
    direita = (
      <>
        <div className="linha entre">
          <span className="forte pequeno">Os cinco primeiros</span>
          <span className="mudo pequeno num">{fmtNumero(r.com_venda)} de {fmtNumero(r.participantes)} com venda</span>
        </div>
        <Lideres ap={ap} />
      </>
    );
  } else {
    direita = (
      <>
        <div className="linha entre">
          <span className="forte pequeno linha g4">Situação dos {nomeNivel(nivel, 2)}<Explica titulo="Situação dos participantes" {...EXPLICA.heroiSituacao} tamanho={13} /></span>
          <span className="mudo pequeno num">{fmtNumero(r.com_venda)} de {fmtNumero(r.participantes)} com venda</span>
        </div>
        {partes.length ? <BarraEmpilhada partes={partes} altura={12} /> : <span className="mudo pequeno">Nenhum participante ainda.</span>}
      </>
    );
  }

  return (
    <div className="cartao destaque cmp-heroi">
      {esquerda}
      <div className="cmp-heroi-principal">
        <div className="linha g4 mudo pequeno">
          <Target size={14} />
          {rotulo}
          {!futura && !semMeta && <Explica titulo={rotulo} {...EXPLICA.heroiAtingimento} tamanho={13} />}
          {semMeta && !futura && <Explica titulo="Campanha de ranking" texto="Esta campanha não tem meta: vale a classificação. O número é o total realizado por todos os participantes." tamanho={13} />}
        </div>
        <div className="cmp-heroi-numeros">
          <span className="cmp-heroi-valor">{valor}</span>
          {complemento}
        </div>
        <Narrativa frases={narrativaApuracao(ap)} />
      </div>
      <div className="cmp-heroi-dist">{direita}</div>
    </div>
  );
}

/** Cartão de premiação: apurado, projetado e consumo do orçamento. */
function CartaoPremio({ r, encerrada }) {
  const uso = (r.uso_orcamento || 0) * 100;
  const usoProj = (r.uso_orcamento_proj || 0) * 100;
  const cor = usoProj > 100 ? 'critico' : usoProj > 90 ? 'aviso' : 'orcamento-ok';
  return (
    <div className="cartao kpi">
      <div className="kpi-rotulo">
        <Award size={15} />
        <ComInfo {...EXPLICA.premiacaoApurada}>{encerrada ? 'Premiação final' : 'Premiação apurada'}</ComInfo>
      </div>
      <div className="kpi-valor">
        <Numero valor={r.premio_total} formato="moeda" compacto />
      </div>
      {r.orcamento ? (
        <div className="coluna" style={{ gap: 6 }}>
          <Progresso valor={uso} projecao={encerrada ? undefined : usoProj} cor={cor} espessura="p" titulo={`Orçamento: ${fmtMoeda(r.orcamento)}`} />
          <div className="linha entre pequeno">
            <span className="mudo">{encerrada ? `orçamento ${fmtMoeda(r.orcamento, { compacto: true })}` : `proj. ${fmtMoeda(r.premio_proj_total, { compacto: true })}`}</span>
            <span className="sec num" title={`Orçamento de ${fmtMoeda(r.orcamento)}`}>
              {fmtPerc(encerrada ? uso : usoProj)} do orçamento
            </span>
          </div>
        </div>
      ) : (
        <div className="kpi-rodape">
          <span className="mudo pequeno">
            {encerrada ? 'sem orçamento definido' : <>projetado <b className="num" style={{ color: 'var(--tinta)' }}>{fmtMoeda(r.premio_proj_total, { compacto: true })}</b></>}
          </span>
        </div>
      )}
    </div>
  );
}

/** KPI com valor textual (sem contagem animada). */
function KpiTexto({ rotulo, icone: Icone, texto, rodape, info }) {
  return (
    <div className="cartao kpi">
      <div className="kpi-rotulo">
        {Icone && <Icone size={15} />}
        {info ? <ComInfo {...info}>{rotulo}</ComInfo> : <span className="truncar">{rotulo}</span>}
      </div>
      <div className="kpi-valor truncar" style={{ fontSize: 22 }}>{texto}</div>
      <div className="kpi-rodape"><span className="mudo pequeno truncar">{rodape}</span></div>
    </div>
  );
}

/** Linha de KPIs abaixo do herói. */
export function KpisApuracao({ ap }) {
  const r = ap.resumo;
  const t = ap.tempo;
  const n = r.participantes || 0;
  const nivel = ap.campanha?.participantes?.nivel;
  const idxBase = Math.max(0, ap.criterios.findIndex((c) => c.id === ap.campanha?.premiacao?.criterio_base));
  const crit = ap.criterios[idxBase];
  const encerrada = t.status === 'encerrada';

  if (t.status === 'futura') {
    const c0 = ap.criterios[0];
    const exig = c0?.total?.meta != null && c0.total.base > 0 && c0.totalizar === 'soma' ? (c0.total.meta / c0.total.base - 1) * 100 : null;
    return (
      <div className="grade-4 escalonado">
        <Kpi rotulo="Participantes" icone={Users} valor={n} rodape={<span className="mudo pequeno">{nomeNivel(nivel, n)}</span>} />
        <Kpi rotulo={<ComInfo titulo="Meta total" {...EXPLICA.metaTotal}>{`Meta total · ${c0?.nome || ''}`}</ComInfo>} icone={Target} valor={c0?.total?.meta} formato={c0?.formato} compacto
          rodape={<span className="mudo pequeno">{[c0?.unidade, TIPO_META[c0?.meta_tipo]].filter(Boolean).join(' · ')}</span>} />
        <Kpi rotulo={<ComInfo {...EXPLICA.exigencia}>Exigência vs período anterior</ComInfo>} icone={TrendingUp} valor={exig} formato="perc"
          rodape={<span className="mudo pequeno">anterior: {fmtCrit(c0?.total?.base, c0, { compacto: true })}</span>} />
        <Kpi rotulo={<ComInfo {...EXPLICA.orcamento}>Orçamento de premiação</ComInfo>} icone={Award} valor={r.orcamento} formato="moeda" compacto
          rodape={<span className="mudo pequeno">{r.orcamento ? 'teto de gasto com prêmios' : 'sem orçamento definido'}</span>} />
      </div>
    );
  }

  if (semMetaEm(ap)) {
    const [l1, l2] = ap.participantes;
    const dif = l1 && l2 ? (l1.criterios[idxBase]?.realizado || 0) - (l2.criterios[idxBase]?.realizado || 0) : null;
    return (
      <div className="grade-4 escalonado">
        <Kpi rotulo={<ComInfo {...EXPLICA.comVenda}>Com venda</ComInfo>} icone={Users} valor={r.com_venda} rodape={<span className="mudo pequeno">de {fmtNumero(n)} {nomeNivel(nivel, n)}</span>} />
        <KpiTexto rotulo="Líder" icone={Crown} texto={l1?.nome || '-'} info={EXPLICA.lider}
          rodape={dif != null ? `${fmtCrit(dif, crit, { compacto: true })} à frente de ${l2.nome}` : ''} />
        <CartaoPremio r={r} encerrada={encerrada} />
        <Kpi rotulo={<ComInfo {...EXPLICA.faturamentoEscopo}>Faturamento no escopo</ComInfo>} icone={Wallet} valor={crit?.total?.valor} formato="moeda" compacto
          rodape={<span className="mudo pequeno truncar" style={{ maxWidth: 240 }}>{crit?.nome}</span>} />
      </div>
    );
  }

  const devemBater = ap.participantes.filter((l) => l.score_proj != null && l.elegivel_proj && l.score_proj + EPS >= 100).length;
  return (
    <div className="grade-4 escalonado">
      <Kpi
        rotulo={<ComInfo {...EXPLICA.bateram}>Bateram a meta</ComInfo>}
        icone={CheckCircle2}
        valor={r.atingiram}
        rodape={<span className="mudo pequeno">de {fmtNumero(n)} {nomeNivel(nivel, n)} · {fmtPerc(n ? (r.atingiram / n) * 100 : 0)}</span>}
      />
      {encerrada ? (
        <Kpi rotulo={<ComInfo {...EXPLICA.naoAtingiram}>Não atingiram</ComInfo>} icone={XCircle} valor={r.nao_atingiu} rodape={<span className="mudo pequeno">ficaram abaixo da meta</span>} />
      ) : (
        <Kpi
          rotulo={<ComInfo {...EXPLICA.devemBater}>Devem bater no ritmo atual</ComInfo>}
          icone={TrendingUp}
          valor={devemBater}
          rodape={
            <span className="mudo pequeno">
              {r.no_ritmo ? `${fmtNumero(r.no_ritmo)} no ritmo · ` : ''}
              {fmtNumero((r.risco || 0) + (r.atencao || 0))} precisam acelerar
            </span>
          }
        />
      )}
      <CartaoPremio r={r} encerrada={encerrada} />
      <Kpi
        rotulo={<ComInfo {...EXPLICA.faturamentoEscopo}>Faturamento no escopo</ComInfo>}
        icone={Wallet}
        valor={crit?.total?.valor}
        formato="moeda"
        compacto
        rodape={<span className="mudo pequeno truncar" style={{ maxWidth: 240 }}>{crit?.nome}</span>}
      />
    </div>
  );
}
