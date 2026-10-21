import { AlertTriangle, CalendarClock, Loader2, Medal, Radio, Users, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import { Aviso, BarraEmpilhada, Esqueleto, Explica, Numero, Progresso, SeloStatus } from '../../componentes/ui.jsx';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc, fmtValor } from '../../lib/formato.js';
import { fmtMetrica, infoMetrica, nivelPlural } from './util.js';

function Rotulo({ icone: Icone, children, info }) {
  return (
    <div className="cons-previa-rotulo">
      {Icone && <Icone size={12} />}
      <span>{children}</span>
      {info && <Explica titulo={typeof children === 'string' ? children : undefined} {...info} tamanho={13} />}
    </div>
  );
}

/** Painel lateral: como a campanha em edição estaria hoje, com as vendas reais. Recalcula a cada alteração. */
export default function PreviaAoVivo({ def, previa, catalogo }) {
  const { dados, erro, pendente } = previa;
  const t = dados?.tempo;
  const r = dados?.resumo;
  const pr = def.premiacao;
  const rankingRealizado = pr.tipo === 'ranking' && pr.ranking.por === 'realizado';
  const idxBase = Math.max(0, def.criterios.findIndex((c) => c.id === pr.criterio_base));
  const infoBase = def.criterios[idxBase] ? infoMetrica(def.criterios[idxBase], catalogo) : null;
  const quem = nivelPlural(def.participantes.nivel);
  const semPontuacao = def.criterios.every((c) => c.meta.tipo === 'sem_meta');
  const porRealizado = rankingRealizado || semPontuacao;

  return (
    <aside className={`cons-previa${pendente && dados ? ' recarregando' : ''}`} aria-live="polite">
      <div className="cons-previa-topo">
        <div className="linha g4" style={{ gap: 8 }}>
          <Radio size={16} style={{ color: 'var(--acento)' }} />
          <h3>Prévia ao vivo</h3>
          <Explica titulo="Prévia ao vivo" texto="Uma simulação: o sistema apura a campanha com as regras que você está montando, usando as vendas reais que já existem. Nada é salvo nem enviado."
            como={['Mude qualquer regra à esquerda e veja aqui, em segundos, o efeito nas metas, no ranking e no prêmio.', 'Use para calibrar metas e prêmios antes de ativar.']}
            exemplo="Subiu o crescimento de 10% para 20%? Veja quantos ainda atingem e quanto a campanha vai pagar." />
        </div>
        <span className="cons-previa-estado">
          {pendente ? <><Loader2 size={12} className="girando" /> Calculando…</> : dados ? <>Atualizada</> : null}
        </span>
      </div>
      <div className="cons-previa-intro">
        Como a campanha estaria hoje com estas regras, usando as vendas reais{t?.referencia ? ` até ${fmtData(t.referencia)}` : ''}. A projeção estima como ela deve fechar no último dia.
      </div>

      {erro && (
        <Aviso tipo="erro" titulo="Prévia indisponível">
          {erro.status === 404 ? 'O serviço de prévia ainda não está disponível no servidor.' : erro.message}
        </Aviso>
      )}

      {!dados && !erro && (
        <div className="cons-previa-bloco"><Esqueleto linhas={6} /></div>
      )}

      {dados && (
        <>
          <div className="cons-previa-bloco">
            <Rotulo icone={CalendarClock} info={{
              texto: 'Em que ponto do período a campanha está. Serve para comparar o realizado com o tempo que já passou.',
              como: 'Dias úteis: segunda a sexta sem feriados. Corridos: todos os dias.',
              exemplo: 'Dia 11 de 22 úteis: metade do tempo passou, então o ideal é ter feito metade da meta.',
            }}>Tempo da campanha</Rotulo>
            {t.status === 'futura' ? (
              <div className="pequeno">Começa em {fmtNumero(t.dias_para_inicio)} dia{t.dias_para_inicio === 1 ? '' : 's'}. Por enquanto a prévia mostra as metas e o período anterior.</div>
            ) : (
              <>
                <div className="linha entre pequeno">
                  <span>{t.status === 'encerrada' ? 'Período encerrado' : `Dia ${t.decorridos} de ${t.total} ${t.calendario === 'corridos' ? 'dias corridos' : 'dias úteis'}`}</span>
                  <span className="mudo">{fmtPerc(t.progresso * 100)} do tempo</span>
                </div>
                <Progresso valor={t.progresso * 100} cor="neutro" espessura="p" />
              </>
            )}
          </div>

          <div className="cons-previa-bloco">
            <Rotulo info={{
              texto: `O total de cada critério somando todos os ${quem}.`,
              como: ['Número grande: quanto já foi feito até hoje.', 'Barra: quanto da meta já foi cumprido. O tracinho mostra onde a projeção indica que vai fechar.', '"Antes": o mesmo número no período anterior, para comparar.'],
              exemplo: '59% hoje · 97% no fim: até agora fizeram 59% da meta e, no ritmo atual, devem chegar a 97%.',
            }}>Critérios (total de todos)</Rotulo>
            {dados.criterios.map((c, i) => {
              const cr = def.criterios[i];
              const info = cr ? infoMetrica(cr, catalogo) : { formato: c.formato, unidade: c.unidade };
              return (
                <div key={c.id} className="cons-previa-crit">
                  <div className="linha entre">
                    <span className="forte truncar pequeno">{c.nome}</span>
                    <span className="mini mudo">{fmtNumero(c.n_produtos)} produtos</span>
                  </div>
                  <div className="linha entre" style={{ alignItems: 'baseline' }}>
                    <span className="cons-previa-num"><Numero valor={c.total.realizado} formato={info.formato} compacto /></span>
                    <span className="pequeno mudo">{c.total.meta != null ? `meta ${fmtMetrica(c.total.meta, info)}` : 'sem meta'}</span>
                  </div>
                  {c.total.meta != null && <Progresso valor={c.total.atingimento} projecao={c.total.atingimento_proj} espessura="p" />}
                  <div className="linha entre mini mudo">
                    <span>{c.total.atingimento != null ? `${fmtPerc(c.total.atingimento)} hoje · ${fmtPerc(c.total.atingimento_proj)} no fim` : `no fim: ${fmtMetrica(c.total.projecao, info)}`}</span>
                    <span title={`Período anterior: ${fmtData(c.periodo_base?.inicio)} a ${fmtData(c.periodo_base?.fim)}`}>antes: {fmtValor(c.total.base, info.formato, { compacto: true })}</span>
                  </div>
                </div>
              );
            })}
            <div className="cons-previa-legenda">
              <span><i className="barra" /> feito até hoje</span>
              <span><i className="traco" /> onde deve fechar</span>
            </div>
          </div>

          {r.participantes > 0 && (
            <div className="cons-previa-bloco">
              <Rotulo icone={Users} info={{
                texto: `Em que situação está cada um dos ${fmtNumero(r.participantes)} ${quem}.`,
                como: [
                  'Atingiu: já bateu a meta.',
                  'No ritmo: ainda não bateu, mas a projeção indica que vai bater.',
                  'Atenção: a projeção fica entre 85% e 100% da meta.',
                  'Em risco: a projeção fica abaixo de 85%.',
                  'Sem meta: critério sem meta (só ranking).',
                ],
              }}>{`Como estão os ${fmtNumero(r.participantes)} ${quem}`}</Rotulo>
              <BarraEmpilhada
                partes={[
                  { rotulo: 'Atingiu', valor: r.atingiram, cor: 'var(--bom)' },
                  { rotulo: 'No ritmo', valor: r.no_ritmo, cor: 'var(--acento)' },
                  { rotulo: 'Atenção', valor: r.atencao, cor: 'var(--aviso)' },
                  { rotulo: 'Em risco', valor: r.risco + r.nao_atingiu, cor: 'var(--critico)' },
                  ...(r.sem_meta ? [{ rotulo: 'Sem meta', valor: r.sem_meta, cor: 'var(--tinta-3)' }] : []),
                ].filter((p) => p.valor > 0 || ['Atingiu', 'Em risco'].includes(p.rotulo))}
              />
            </div>
          )}

          {pr.tipo !== 'nenhuma' && (
            <div className="cons-previa-bloco">
              <Rotulo icone={Wallet} info={{
                texto: 'Quanto a campanha pagaria em prêmios, somando todos.',
                como: ['"Se acabasse hoje": usa o resultado de hoje.', '"Previsto no fim": usa a projeção de fechamento. É o número para comparar com o orçamento.'],
                exemplo: 'Previsto R$ 12 mil com orçamento de R$ 10 mil: a barra fica vermelha. Ajuste faixas, teto ou metas.',
              }}>Prêmios</Rotulo>
              <div className="linha entre">
                <div className="cons-mini"><span className="r">Se acabasse hoje</span><span className="v">{fmtMoeda(r.premio_total)}</span></div>
                <div className="cons-mini" style={{ textAlign: 'right' }}><span className="r">Previsto no fim</span><span className="v">{fmtMoeda(r.premio_proj_total)}</span></div>
              </div>
              {r.orcamento ? (
                <>
                  <Progresso valor={(r.uso_orcamento_proj || 0) * 100} cor={r.uso_orcamento_proj > 1 ? 'critico' : r.uso_orcamento_proj > 0.9 ? 'aviso' : 'neutro'} espessura="p" />
                  <div className="mini mudo">O previsto usa {fmtPerc((r.uso_orcamento_proj || 0) * 100)} do orçamento de {fmtMoeda(r.orcamento)}.</div>
                </>
              ) : (
                <div className="mini mudo">Sem orçamento definido (dá para definir em Apuração e prêmios).</div>
              )}
            </div>
          )}

          {dados.participantes.length > 0 && (
            <div className="cons-previa-bloco">
              <Rotulo icone={Medal} info={{
                texto: porRealizado ? `Os 10 primeiros pelo realizado em "${infoBase?.nome?.toLowerCase()}".` : 'Os 10 primeiros pela pontuação: o quanto da meta cada um já cumpriu.',
                como: ['Coluna do meio: pontuação (% da meta) ou realizado.', 'Última coluna: o prêmio previsto para o fim. Sem prêmio, aparece a situação.'],
              }}>Top 10 agora</Rotulo>
              <div className="cons-top">
                <div className="cons-top-linha cab">
                  <span>#</span>
                  <span>Nome</span>
                  <span style={{ textAlign: 'right' }}>{porRealizado ? 'Feito' : '% meta'}</span>
                  <span style={{ textAlign: 'right' }}>Prêmio</span>
                </div>
                {dados.participantes.slice(0, 10).map((p) => (
                  <motion.div key={p.chave} layout="position" transition={{ type: 'spring', stiffness: 420, damping: 38 }} className="cons-top-linha">
                    <span className="pos">{p.posicao}</span>
                    <span className="truncar" title={p.nome}>{p.nome}</span>
                    <span className="num" style={{ textAlign: 'right' }}>
                      {porRealizado ? fmtValor(p.criterios[idxBase]?.realizado, infoBase?.formato, { compacto: true }) : fmtPerc(p.score)}
                    </span>
                    <span className="num mudo" style={{ textAlign: 'right' }} title="Prêmio previsto para o fim da campanha">
                      {p.premio_proj > 0 ? fmtMoeda(p.premio_proj, { compacto: true }) : <SeloStatus status={p.status} compacto />}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {dados.avisos?.length > 0 && (
            <div className="cons-previa-bloco">
              <Rotulo icone={AlertTriangle} info={{ texto: 'Situações que o sistema encontrou ao apurar e que podem deixar o resultado estranho. Leia antes de ativar.' }}>Pontos de atenção</Rotulo>
              {dados.avisos.map((a, i) => <div key={i} className="pequeno sec">• {a}</div>)}
            </div>
          )}
          <div className="mini mudo" style={{ textAlign: 'right' }}>Calculada em {fmtNumero(dados.duracao_ms)} ms</div>
        </>
      )}
    </aside>
  );
}
