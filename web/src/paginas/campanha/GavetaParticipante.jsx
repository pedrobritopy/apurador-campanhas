import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Crosshair, FileText, Info, Mail, MessageCircle, Phone, Target, TrendingUp,
} from 'lucide-react';
import { post, qs, useApi } from '../../lib/api.js';
import { navegar } from '../../lib/rotas.js';
import { fmtData, fmtDataCurta, fmtDiaSemana, fmtMoeda, fmtNumero, fmtPerc, fmtRelativo } from '../../lib/formato.js';
import {
  Aviso, Avatar, Botao, Carregando, ErroCarga, Explica, Gaveta, Movimento, Progresso, Segmentado, SeloStatus, Tabela, Vazio, useToast,
} from '../../componentes/ui.jsx';
import { ComInfo, EXPLICA } from '../../lib/explicacoes.jsx';
import { GraficoBarras, GraficoLinha } from '../../componentes/graficos.jsx';
import { fmtCrit, textoCriterioLinha, textoProximaFaixa } from './util.js';

const ICONE_DESTAQUE = { positivo: TrendingUp, alerta: AlertTriangle, acao: Crosshair, info: Info };

export function Destaques({ itens }) {
  if (!itens?.length) return null;
  return (
    <div className="cmp-destaques">
      {itens.map((d, i) => {
        const Ic = ICONE_DESTAQUE[d.tipo] || Info;
        return (
          <div key={i} className={`cmp-destaque ${d.tipo || 'info'}`}>
            <Ic size={15} />
            <span>{d.texto}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Abre o WhatsApp com o acompanhamento do participante (ou copia o texto se não houver telefone). */
export async function enviarWhatsApp(idCampanha, chave, toast) {
  try {
    const msgs = await post(`/campanhas/${idCampanha}/mensagens/previa`, { destino: 'participantes', filtro: 'todos', chaves: [chave] });
    const m = Array.isArray(msgs) ? msgs[0] : null;
    if (!m) {
      toast.erro('Não foi possível montar a mensagem para este participante.');
      return;
    }
    if (m.whatsapp_url) {
      window.open(m.whatsapp_url, '_blank', 'noopener');
    } else {
      await navigator.clipboard?.writeText(m.texto || '');
      toast.info('Participante sem telefone cadastrado. O texto foi copiado.');
    }
  } catch (e) {
    toast.erro(e.message);
  }
}

/** Gaveta de detalhe de um participante da campanha. */
export default function GavetaParticipante({ idCampanha, chave, ap, referencia, aoFechar }) {
  const toast = useToast();
  const [criterio, setCriterio] = useState(ap?.criterios?.[0]?.id);
  useEffect(() => {
    if (!ap?.criterios?.some((c) => c.id === criterio)) setCriterio(ap?.criterios?.[0]?.id);
  }, [ap, criterio]);
  const caminho = chave ? `/campanhas/${idCampanha}/participantes/${encodeURIComponent(chave)}${qs({ criterio, referencia })}` : null;
  const { dados: d, erro, carregando, recarregar } = useApi(caminho);
  const linha = useMemo(() => ap?.participantes?.find((l) => l.chave === chave) || d?.participante, [ap, chave, d]);
  const idx = Math.max(0, ap?.criterios?.findIndex((c) => c.id === criterio) ?? 0);
  const crit = ap?.criterios?.[idx];
  const tempo = ap?.tempo;
  const nivel = ap?.campanha?.participantes?.nivel;

  const series = useMemo(() => {
    if (!d?.serie) return [];
    const s = [{ id: 'real', nome: 'Realizado', valores: d.serie.realizado, cor: 'var(--s1)', area: true }];
    if (d.serie.meta?.some((v) => v != null)) s.push({ id: 'meta', nome: crit?.totalizar === 'soma' ? 'Meta (ritmo ideal)' : 'Meta', valores: d.serie.meta, cor: 'var(--tinta-3)', estilo: 'tracejada' });
    if (d.serie.projecao?.some((v) => v != null)) s.push({ id: 'proj', nome: 'Projeção', valores: d.serie.projecao, cor: 'var(--acento)', estilo: 'tracejada' });
    return s;
  }, [d, crit]);

  const dicaFaixa = linha ? textoProximaFaixa(linha, ap) : null;
  const usarValor = crit?.formato === 'moeda';

  return (
    <Gaveta
      aberto={Boolean(chave)}
      aoFechar={aoFechar}
      titulo={linha?.nome || 'Participante'}
      subtitulo={linha?.grupo || ap?.campanha?.nivel_singular}
      largura={780}
      acoes={
        linha && (
          <div className="linha g4">
            <Botao tamanho="p" icone={FileText} onClick={() => navegar(`/boletim/${idCampanha}/${encodeURIComponent(chave)}`)}>Boletim</Botao>
            <Botao tamanho="p" variante="sutil" icone={MessageCircle} onClick={() => enviarWhatsApp(idCampanha, chave, toast)}>WhatsApp</Botao>
          </div>
        )
      }
    >
      {!linha ? (
        erro ? <ErroCarga erro={erro} aoTentar={recarregar} /> : <Carregando />
      ) : (
        <div>
          <div className="cmp-gaveta-topo">
            <Avatar nome={linha.nome} foto={linha.foto} tamanho="g" />
            <div className="cresce" style={{ minWidth: 0 }}>
              <div className="linha" style={{ gap: 8, flexWrap: 'wrap' }}>
                <SeloStatus status={linha.status} />
                <span className="sec pequeno num">
                  {linha.posicao}º de {fmtNumero(ap.participantes.length)}
                </span>
                <Movimento valor={linha.movimento ?? null} />
                {linha.movimento != null && <span className="mudo pequeno">em 7 dias</span>}
              </div>
              <div className="linha quebra mudo pequeno" style={{ gap: 12, marginTop: 6 }}>
                {linha.contato?.telefone && <span className="linha g4"><Phone size={12} />{linha.contato.telefone}</span>}
                {linha.contato?.email && <span className="linha g4"><Mail size={12} />{linha.contato.email}</span>}
                {linha.responsavel?.nome && nivel !== 'equipe' && <span>Responsável: {linha.responsavel.nome}</span>}
              </div>
            </div>
          </div>

          <div className="cmp-gaveta-numeros">
            {linha.score == null ? (
              <>
                <div className="cmp-estat">
                  <span className="cmp-estat-rotulo truncar">{ap.criterios[0]?.nome || 'Realizado'}</span>
                  <span className="cmp-estat-valor g">{fmtCrit(linha.criterios[0]?.realizado, ap.criterios[0], { compacto: true })}</span>
                </div>
                <div className="cmp-estat">
                  <span className="cmp-estat-rotulo">Projeção</span>
                  <span className="cmp-estat-valor g">{fmtCrit(linha.criterios[0]?.projecao, ap.criterios[0], { compacto: true })}</span>
                  {linha.posicao_proj != null && <span className="cmp-estat-sub">termina em {linha.posicao_proj}º</span>}
                </div>
              </>
            ) : (
              <>
                <div className="cmp-estat">
                  <span className="cmp-estat-rotulo"><ComInfo {...EXPLICA.pontuacao}>Pontuação</ComInfo></span>
                  <span className="cmp-estat-valor g">{fmtPerc(linha.score)}</span>
                </div>
                <div className="cmp-estat">
                  <span className="cmp-estat-rotulo"><ComInfo {...EXPLICA.projecao}>Projeção</ComInfo></span>
                  <span className="cmp-estat-valor g">{fmtPerc(linha.score_proj)}</span>
                  {linha.posicao_proj != null && <span className="cmp-estat-sub">termina em {linha.posicao_proj}º</span>}
                </div>
              </>
            )}
            <div className="cmp-estat">
              <span className="cmp-estat-rotulo"><ComInfo titulo="Prêmio atual e projetado" {...EXPLICA.gavetaPremio}>Prêmio atual</ComInfo></span>
              <span className="cmp-estat-valor">{fmtMoeda(linha.premio || 0)}</span>
              {linha.premio_partes?.length > 0 && (
                <span className="cmp-estat-sub" title={linha.premio_partes.map((p) => `${p.rotulo}: ${fmtMoeda(p.valor)}`).join(' + ')}>
                  {linha.premio_partes.map((p) => p.rotulo).join(' + ')}
                </span>
              )}
            </div>
            <div className="cmp-estat">
              <span className="cmp-estat-rotulo">Prêmio projetado</span>
              <span className="cmp-estat-valor">{fmtMoeda(linha.premio_proj || 0)}</span>
              {linha.multiplicador != null && linha.multiplicador !== 1 && <span className="cmp-estat-sub">multiplicador ×{fmtNumero(linha.multiplicador, 2)}</span>}
            </div>
          </div>

          {dicaFaixa && (
            <Aviso tipo="info" className="cmp-bloco">
              <span className="linha g4"><Target size={14} /> {dicaFaixa}</span>
            </Aviso>
          )}

          <div className="cmp-bloco">
            <div className="cmp-bloco-titulo">Critérios</div>
            {ap.criterios.map((c, i) => {
              const lc = linha.criterios[i] || {};
              return (
                <div key={c.id} className="cmp-crit-linha">
                  <div className="linha entre" style={{ marginBottom: 6 }}>
                    <span className="forte">{c.nome}</span>
                    <span className="num forte">{fmtPerc(lc.atingimento)}</span>
                  </div>
                  {lc.atingimento != null && <Progresso valor={lc.atingimento} projecao={lc.atingimento_proj} espessura="p" />}
                  <div className="linha entre pequeno" style={{ marginTop: 6, gap: 12 }}>
                    <span className="sec">{textoCriterioLinha(lc, c)}</span>
                    {lc.projecao != null && <span className="mudo num" style={{ whiteSpace: 'nowrap' }}>proj. {fmtCrit(lc.projecao, c, { compacto: true })}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {d?.boletim?.destaques?.length > 0 && (
            <div className="cmp-bloco">
              <div className="cmp-bloco-titulo"><ComInfo titulo="O que os números dizem" {...EXPLICA.gavetaDestaques}>O que os números dizem</ComInfo></div>
              <Destaques itens={d.boletim.destaques} />
            </div>
          )}

          {ap.criterios.length > 1 && (
            <div className="cmp-bloco">
              <Segmentado tamanho="p" valor={criterio} aoMudar={setCriterio} opcoes={ap.criterios.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
            </div>
          )}

          {erro && !d ? (
            <ErroCarga erro={erro} aoTentar={recarregar} />
          ) : !d ? (
            <Carregando altura={160} texto="Montando o detalhe…" />
          ) : (
            <div style={{ opacity: carregando ? 0.6 : 1, transition: 'opacity 160ms' }}>
              {series.length > 0 && tempo && (
                <div className="cmp-bloco">
                  <div className="cmp-bloco-titulo">Evolução · {crit?.nome}</div>
                  <GraficoLinha
                    rotulos={d.dias || tempo.dias}
                    formatarX={fmtDataCurta}
                    formatarDica={(x) => `${fmtDiaSemana(x)}, ${fmtData(x)}`}
                    series={series}
                    formato={crit?.formato}
                    altura={210}
                    marcadorX={tempo.status === 'andamento' ? tempo.idx_ref : undefined}
                    zeroBase={crit?.totalizar === 'soma'}
                  />
                </div>
              )}

              {(nivel === 'vendedor' || nivel === 'equipe') && (
                <div className="cmp-bloco">
                  <div className="cmp-bloco-titulo">
                    <ComInfo titulo="Clientes para atacar" {...EXPLICA.gavetaOportunidades}>Clientes para atacar</ComInfo>
                    <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                      {nivel === 'equipe' ? 'compram com a equipe' : 'da carteira ou que compram com o vendedor'} e ainda não compraram estes produtos na campanha
                    </span>
                  </div>
                  {d.oportunidades?.length ? (
                    <div className="cartao" style={{ padding: '2px 14px' }}>
                      {d.oportunidades.slice(0, 12).map((o) => (
                        <div key={o.id} className="cmp-oportunidade">
                          <div style={{ minWidth: 0 }}>
                            <div className="forte truncar">{o.nome}</div>
                            <div className="mudo pequeno truncar">
                              {[o.cidade && `${o.cidade}/${o.estado}`, o.segmento, o.porte].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            {o.valor_hist > 0 ? (
                              <>
                                <div className="num forte">{fmtMoeda(o.valor_hist, { compacto: true })}</div>
                                <div className="mudo mini">comprou destes produtos até {o.ultima ? fmtData(o.ultima) : '-'}</div>
                              </>
                            ) : (
                              <>
                                <div className="num sec">{fmtMoeda(o.valor_geral || 0, { compacto: true })}</div>
                                <div className="mudo mini">em compras gerais · última {o.ultima_compra ? fmtRelativoData(o.ultima_compra) : '-'}</div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Vazio icone={Crosshair} titulo="Nenhuma oportunidade aberta" texto="Todos os clientes da carteira já compraram os produtos deste critério." />
                  )}
                </div>
              )}

              {d.produtos?.length > 0 && (
                <div className="cmp-bloco">
                  <div className="cmp-bloco-titulo">Produtos vendidos</div>
                  <GraficoBarras
                    itens={d.produtos.map((p) => ({ chave: p.id, rotulo: p.nome, sub: `${fmtNumero(p.clientes)} ${p.clientes === 1 ? 'cliente' : 'clientes'}`, valor: usarValor ? p.valor : p.qtd }))}
                    formato={usarValor ? 'moeda' : 'numero'}
                    limite={10}
                    largRotulo={300}
                  />
                </div>
              )}

              {d.clientes?.length > 0 && (
                <div className="cmp-bloco">
                  <div className="cmp-bloco-titulo">Clientes que compraram</div>
                  <div className="cartao">
                    <Tabela
                      densa
                      maxAltura={320}
                      linhas={d.clientes}
                      chaveLinha={(c) => c.id}
                      ordenacaoInicial={{ chave: 'valor', dir: 'desc' }}
                      colunas={[
                        { chave: 'nome', titulo: 'Cliente', ordenavel: true, dirInicial: 'asc', render: (c) => <div><div className="truncar" style={{ maxWidth: 240 }}>{c.nome}</div><div className="mudo mini">{c.cidade}/{c.estado}</div></div> },
                        { chave: 'qtd', titulo: 'Un.', alinhar: 'direita', ordenavel: true, render: (c) => <span className="num">{fmtNumero(c.qtd)}</span> },
                        { chave: 'valor', titulo: 'Valor', alinhar: 'direita', ordenavel: true, render: (c) => <span className="num">{fmtMoeda(c.valor)}</span> },
                        { chave: 'pedidos', titulo: 'Pedidos', alinhar: 'direita', ordenavel: true, render: (c) => <span className="num">{fmtNumero(c.pedidos)}</span> },
                        { chave: 'ultima', titulo: 'Última', ordenavel: true, render: (c) => <span className="num sec">{fmtData(c.ultima)}</span> },
                      ]}
                    />
                  </div>
                </div>
              )}

              {d.vendedores?.length > 0 && nivel !== 'vendedor' && (
                <div className="cmp-bloco">
                  <div className="cmp-bloco-titulo">Quem vendeu</div>
                  <GraficoBarras
                    itens={d.vendedores.map((v) => ({ chave: v.id, rotulo: v.nome, sub: `${fmtNumero(v.clientes)} clientes`, valor: usarValor ? v.valor : v.qtd }))}
                    formato={usarValor ? 'moeda' : 'numero'}
                    limite={12}
                    largRotulo={200}
                  />
                </div>
              )}

              {!d.produtos?.length && !d.clientes?.length && (
                <Vazio icone={Info} titulo="Sem vendas neste critério" texto={tempo?.status === 'futura' ? 'A campanha ainda não começou.' : 'Ainda não há vendas dos produtos deste critério para este participante.'} />
              )}
            </div>
          )}
        </div>
      )}
    </Gaveta>
  );
}

function fmtRelativoData(iso) {
  const dias = Math.round((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 60) return `há ${dias} dias`;
  return fmtRelativo(`${iso}T12:00:00`);
}
