import { useState } from 'react';
import { ArrowLeft, Copy, Crosshair, Mail, MessageCircle, Package, Phone, Printer, Target, Trophy } from 'lucide-react';
import { post, useApi } from '../lib/api.js';
import { navegar } from '../lib/rotas.js';
import { fmtData, fmtDataHora, fmtMoeda, fmtNumero, fmtPerc, fmtPeriodo, primeiroNome } from '../lib/formato.js';
import { Anel, Avatar, Botao, Carregando, ErroCarga, Movimento, Progresso, STATUS, useToast } from '../componentes/ui.jsx';
import { Destaques } from './campanha/GavetaParticipante.jsx';
import { fmtCrit } from './campanha/util.js';
import { ComInfo, EXPLICA } from '../lib/explicacoes.jsx';
import './campanha/campanha.css';
import { FotoProduto, LogoFabricante } from '../componentes/Imagens.jsx';

function Numero2({ rotulo, valor, sub }) {
  return (
    <div className="cmp-estat">
      <span className="cmp-estat-rotulo">{rotulo}</span>
      <span className="cmp-estat-valor">{valor}</span>
      {sub && <span className="cmp-estat-sub">{sub}</span>}
    </div>
  );
}

function textoFaixa(b) {
  const pf = b.proxima_faixa;
  if (!pf) return null;
  const crit = b.criterios?.[0];
  const falta = pf.falta_unidades != null ? fmtCrit(pf.falta_unidades, crit) : `${fmtNumero(pf.falta_pontos, pf.falta_pontos < 10 ? 1 : 0)} pontos percentuais`;
  const daMeta = (min) => (min === 100 ? 'a meta' : `${fmtNumero(min)}% da meta`);
  const alvo = pf.tipo === 'bloco' ? 'o próximo bloco'
    : pf.tipo === 'gatilho' ? (pf.exigencia === 'quantidade' ? `o mínimo de ${fmtCrit(pf.min, crit)}` : daMeta(pf.min))
      : pf.tipo === 'bonus' ? daMeta(pf.min) : `${fmtNumero(pf.min)}%`;
  return { falta, alvo, premio: pf.premio };
}

/** Boletim individual — a "informação" que o participante recebe. Imprimível (Ctrl+P). */
export default function Boletim({ params }) {
  const { id, chave } = params;
  const toast = useToast();
  const { dados: b, erro, carregando, recarregar } = useApi(`/campanhas/${id}/boletins/${encodeURIComponent(chave)}`);
  const [mensagem, setMensagem] = useState(null);

  const obterMensagem = async () => {
    if (mensagem) return mensagem;
    const r = await post(`/campanhas/${id}/mensagens/previa`, { destino: 'participantes', filtro: 'todos', chaves: [chave] });
    const m = Array.isArray(r) ? r[0] : null;
    setMensagem(m);
    return m;
  };
  const copiar = async () => {
    try {
      const m = await obterMensagem();
      if (!m?.texto) throw new Error('Mensagem indisponível para este participante.');
      await navigator.clipboard.writeText(m.texto);
      toast.ok('Texto copiado. É só colar no WhatsApp.');
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const abrirWhatsApp = async () => {
    try {
      const m = await obterMensagem();
      if (m?.whatsapp_url) window.open(m.whatsapp_url, '_blank', 'noopener');
      else {
        await navigator.clipboard?.writeText(m?.texto || '');
        toast.info('Sem telefone cadastrado. O texto foi copiado.');
      }
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const voltar = () => navegar(`/campanhas/${id}?participante=${encodeURIComponent(chave)}`);

  if (erro && !b) {
    return (
      <div className="boletim-pagina">
        <div className="boletim-acoes"><Botao icone={ArrowLeft} onClick={voltar}>Voltar</Botao></div>
        <div style={{ maxWidth: 880, margin: '0 auto' }}><ErroCarga erro={erro} aoTentar={recarregar} /></div>
      </div>
    );
  }
  if (!b) return <div className="boletim-pagina"><Carregando altura={420} texto="Montando o boletim…" /></div>;

  const st = STATUS[b.status] || STATUS.sem_meta;
  const IconeStatus = st.icone;
  const faixa = textoFaixa(b);
  const cmp = b.comparativo || {};
  const camp = b.campanha || {};

  return (
    <div className="boletim-pagina" style={{ opacity: carregando ? 0.7 : 1 }}>
      <div className="boletim-acoes nao-imprimir">
        <Botao icone={ArrowLeft} onClick={voltar}>Voltar à apuração</Botao>
        <div className="cresce" />
        <Botao icone={Copy} onClick={copiar}>Copiar texto para WhatsApp</Botao>
        <Botao icone={MessageCircle} variante="sutil" onClick={abrirWhatsApp}>Abrir WhatsApp</Botao>
        <Botao icone={Printer} variante="primario" onClick={() => window.print()}>Imprimir / PDF</Botao>
      </div>

      <article className="boletim-folha">
        <header className="boletim-cabeca">
          <span className="boletim-cabeca-faixa" style={{ background: camp.cor || 'var(--acento)' }} />
          <div className="boletim-sobre">Boletim de desempenho · {camp.nome}</div>
          <div className="linha" style={{ gap: 14 }}>
            {b.foto && <Avatar nome={b.nome} foto={b.foto} tamanho="g" />}
            <div className="boletim-nome">{b.nome}</div>
          </div>
          <div className="linha quebra sec pequeno" style={{ gap: 12, marginTop: 6 }}>
            {camp.fornecedor && <span className="linha g4"><LogoFabricante nome={camp.fornecedor} tamanho={18} />{camp.fornecedor}</span>}
            {camp.inicio && <span>{fmtPeriodo(camp.inicio, camp.fim)}</span>}
            {camp.referencia && <span>Posição em {fmtData(camp.referencia)}</span>}
            {b.responsavel?.nome && <span>Gestor: {b.responsavel.nome}</span>}
            {b.contato?.telefone && <span className="linha g4"><Phone size={12} />{b.contato.telefone}</span>}
            {b.contato?.email && <span className="linha g4"><Mail size={12} />{b.contato.email}</span>}
          </div>
        </header>

        <div className="boletim-corpo">
          <section className="boletim-resumo">
            <Anel valor={b.score} tamanho={150} espessura={12} rotulo="pontuação" />
            <div className="coluna" style={{ gap: 10 }}>
              <div className="linha quebra" style={{ gap: 12 }}>
                <span className={`boletim-status ${st.cor}`}>
                  <IconeStatus size={17} />
                  {b.status_rotulo || st.rotulo}
                </span>
                {b.posicao != null && (
                  <span className="linha g4" style={{ fontSize: 15 }}>
                    <Trophy size={16} style={{ color: 'var(--tinta-3)' }} />
                    <b className="num">{b.posicao}º</b>
                    <span className="sec">de {fmtNumero(b.total_participantes)}</span>
                    <Movimento valor={b.movimento ?? null} />
                  </span>
                )}
              </div>
              <div className="sec" style={{ fontSize: 14.5, lineHeight: 1.55 }}>
                {primeiroNome(b.primeiro_nome || b.nome)}, {textoAbertura(b)}
              </div>
              <div className="boletim-numeros">
                <Numero2 rotulo={<ComInfo titulo="Pontuação" {...EXPLICA.pontuacao}>Pontuação atual</ComInfo>} valor={fmtPerc(b.score)} />
                <Numero2 rotulo={<ComInfo titulo="Projeção" {...EXPLICA.projecao}>Projeção no ritmo atual</ComInfo>} valor={fmtPerc(b.score_proj)} />
                <Numero2 rotulo="Prêmio até agora" valor={fmtMoeda(b.premio || 0)} />
                <Numero2 rotulo="Prêmio projetado" valor={fmtMoeda(b.premio_proj || 0)} />
              </div>
            </div>
          </section>

          {faixa && (
            <section className="boletim-faixa">
              <span className="boletim-faixa-icone"><Target size={20} /></span>
              <div>
                <div className="forte" style={{ fontSize: 15 }}>
                  Faltam {faixa.falta} para chegar a {faixa.alvo}
                  {faixa.premio > 0 && <> e garantir {fmtMoeda(faixa.premio)}</>}
                </div>
                {camp.dias_restantes != null && (
                  <div className="sec pequeno" style={{ marginTop: 2 }}>
                    {camp.dias_restantes > 0 ? `Restam ${camp.dias_restantes} dias ${camp.calendario || ''} até ${fmtData(camp.fim)}.` : 'O período da campanha terminou.'}
                  </div>
                )}
              </div>
            </section>
          )}

          <section>
            <div className="boletim-secao-titulo">Seus critérios</div>
            {(b.criterios || []).map((c, i) => (
              <div key={i} className="boletim-crit">
                <div className="linha entre" style={{ marginBottom: 8, gap: 12 }}>
                  <span className="forte">{c.nome}</span>
                  <span className="num">
                    <b>{fmtCrit(c.realizado, c)}</b>
                    {c.meta != null && <span className="sec"> de {fmtCrit(c.meta, c)}</span>}
                  </span>
                </div>
                {c.atingimento != null && <Progresso valor={c.atingimento} projecao={c.atingimento_proj} />}
                <div className="linha entre pequeno" style={{ marginTop: 8, gap: 12 }}>
                  <span className="sec">{c.texto}</span>
                  {c.projecao != null && <span className="mudo num" style={{ whiteSpace: 'nowrap' }}>projeção {fmtCrit(c.projecao, c)} ({fmtPerc(c.atingimento_proj)})</span>}
                </div>
              </div>
            ))}
          </section>

          {b.destaques?.length > 0 && (
            <section>
              <div className="boletim-secao-titulo">O que os números dizem</div>
              <Destaques itens={b.destaques} />
            </section>
          )}

          {(cmp.media_score != null || cmp.lider_nome) && (
            <section>
              <div className="boletim-secao-titulo">Como você está em relação ao grupo</div>
              <div className="boletim-numeros">
                <Numero2 rotulo="Você" valor={fmtPerc(b.score)} />
                {cmp.media_grupo != null ? (
                  <Numero2 rotulo="Média da sua equipe" valor={fmtPerc(cmp.media_grupo)} sub={cmp.media_score != null ? `geral ${fmtPerc(cmp.media_score)}` : null} />
                ) : (
                  <Numero2 rotulo="Média dos participantes" valor={fmtPerc(cmp.media_score)} />
                )}
                <Numero2 rotulo={`Líder${cmp.lider_nome ? ` · ${primeiroNome(cmp.lider_nome)}` : ''}`} valor={fmtPerc(cmp.lider_score)}
                  sub={cmp.distancia_lider > 0 ? `${fmtNumero(cmp.distancia_lider, cmp.distancia_lider < 10 ? 1 : 0)} p.p. à sua frente` : null} />
                <Numero2 rotulo={<ComInfo {...EXPLICA.boletimPosicaoRelativa}>Posição relativa</ComInfo>} valor={cmp.percentil != null ? `${fmtNumero(cmp.percentil)}%` : '-'} sub={cmp.percentil != null ? 'dos participantes atrás de você' : null} />
              </div>
            </section>
          )}

          {b.oportunidades?.length > 0 && (
            <section>
              <div className="boletim-secao-titulo"><ComInfo titulo="Clientes para atacar" {...EXPLICA.gavetaOportunidades}>Clientes para atacar agora</ComInfo></div>
              <div className="coluna" style={{ gap: 0 }}>
                {b.oportunidades.map((o, i) => (
                  <div key={i} className="cmp-oportunidade">
                    <div style={{ minWidth: 0 }}>
                      <div className="linha g4 forte">
                        <Crosshair size={13} style={{ color: 'var(--acento)', flex: 'none' }} />
                        <span className="truncar">{o.cliente}</span>
                      </div>
                      <div className="mudo pequeno truncar">{[o.cidade, o.motivo].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {o.valor_hist > 0 && <div className="num forte">{fmtMoeda(o.valor_hist, { compacto: true })}</div>}
                      {o.ultima && <div className="mudo mini">última compra {fmtData(o.ultima)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {b.alertas_estoque?.length > 0 && (
            <section>
              <div className="boletim-secao-titulo">Atenção ao estoque</div>
              <div className="coluna" style={{ gap: 6 }}>
                {b.alertas_estoque.map((a, i) => (
                  <div key={i} className="cmp-destaque alerta">
                    {a.id_produto != null ? <FotoProduto id={a.id_produto} nome={a.produto} tamanho={30} /> : <Package size={15} />}
                    <span>
                      <b>{a.produto}</b>: cobertura de {a.cobertura_dias != null ? `${fmtNumero(a.cobertura_dias, a.cobertura_dias < 10 ? 1 : 0)} dias` : 'poucos dias'}. Garanta o pedido antes que falte.
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="boletim-rodape">
          <span>Dados até {fmtData(camp.referencia)} · Apurador de Campanhas</span>
          <span>Gerado em {fmtDataHora(new Date().toISOString())}</span>
        </footer>
      </article>
    </div>
  );
}

function textoAbertura(b) {
  const restantes = b.campanha?.dias_restantes;
  const quando = restantes > 0 ? ` ${restantes === 1 ? 'Falta 1 dia' : `Faltam ${restantes} dias`} de campanha.` : '';
  switch (b.status) {
    case 'atingiu':
      return `você já bateu a meta${b.premio > 0 ? ` e garantiu ${fmtMoeda(b.premio)}` : ''}. Agora é ampliar o resultado.${quando}`;
    case 'no_ritmo':
      return `no seu ritmo atual você bate a meta${b.score_proj != null ? ` e chega a ${fmtPerc(b.score_proj)}` : ''}. Mantenha a constância.${quando}`;
    case 'atencao':
      return `você está perto: a projeção é de ${fmtPerc(b.score_proj)}. Um pequeno aumento no ritmo garante a meta.${quando}`;
    case 'risco':
      return `no ritmo atual a projeção é de ${fmtPerc(b.score_proj)}. Veja abaixo onde acelerar e quais clientes atacar primeiro.${quando}`;
    case 'nao_atingiu':
      return 'a campanha terminou sem atingir a meta. Veja abaixo o que faltou para a próxima.';
    case 'aguardando':
      return 'a campanha ainda vai começar. Prepare sua carteira com os clientes sugeridos abaixo.';
    default:
      return 'confira abaixo seu desempenho na campanha.';
  }
}
