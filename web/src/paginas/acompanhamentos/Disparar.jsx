import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, ExternalLink, FileText, Mail, MessageCircle, Pencil, Phone, PhoneOff, RefreshCw, Search, Send, Sparkles, Users, X,
} from 'lucide-react';
import { post, useApi } from '../../lib/api.js';
import { useAtrasado } from '../../lib/anim.js';
import { definirQuery } from '../../lib/rotas.js';
import { fmtNumero, fmtPeriodo, fmtPerc, plural } from '../../lib/formato.js';
import {
  AreaTexto, Aviso, Avatar, Botao, Campo, Cartao, Carregando, Chip, Entrada, ErroCarga, Explica, Progresso, Segmentado, Selo, Seletor, Vazio, cx, useToast,
} from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import TextoMensagem, { InfosMensagem, resumoTexto } from './TextoMensagem.jsx';
import { CANAIS, CANAL, DESTINOS, FILTROS, linkWhatsapp, opcoesCampanhas, ordenarCampanhas } from '../sistema/comum.js';
import { useConfirmar } from '../sistema/Confirmar.jsx';

const LIVRE = 'livre';

/** Precisa de qual contato para o canal escolhido? */
function elegivel(item, canal) {
  if (canal === 'whatsapp') return Boolean(item.contato?.telefone);
  if (canal === 'email') return Boolean(item.contato?.email);
  return true;
}

function inserirNoCursor(ref, valorAtual, trecho, aoMudar) {
  const el = ref.current;
  if (!el) return aoMudar(`${valorAtual}${trecho}`);
  const ini = el.selectionStart ?? valorAtual.length;
  const fim = el.selectionEnd ?? valorAtual.length;
  const novo = valorAtual.slice(0, ini) + trecho + valorAtual.slice(fim);
  aoMudar(novo);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(ini + trecho.length, ini + trecho.length);
  });
}

// ------------------------------------------------------------------ visualização da mensagem
function VisualMensagem({ item, canal }) {
  if (!item) return <Vazio icone={FileText} titulo="Selecione um destinatário" texto="A mensagem completa aparece aqui." />;
  const tel = item.contato?.telefone;
  const mail = item.contato?.email;
  return (
    <div className="coluna" style={{ gap: 14 }}>
      <div className="linha entre quebra" style={{ gap: 10 }}>
        <div className="linha" style={{ gap: 10, minWidth: 0 }}>
          <Avatar nome={item.destinatario} foto={item.foto} />
          <div style={{ minWidth: 0 }}>
            <div className="forte truncar">{item.destinatario}</div>
            <div className="mini mudo linha g12">
              <span className="linha g4">{tel ? <Phone size={11} /> : <PhoneOff size={11} />}{tel || 'sem telefone'}</span>
              <span className="linha g4"><Mail size={11} />{mail || 'sem e-mail'}</span>
            </div>
          </div>
        </div>
        {canal === 'whatsapp' && item.whatsapp_url && (
          <a className="botao p sutil" href={item.whatsapp_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Testar no WhatsApp</a>
        )}
      </div>

      <div>
        <div className="mini mudo" style={{ marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Informação que esta mensagem entrega</div>
        <InfosMensagem texto={item.texto} />
      </div>

      {canal === 'email' ? (
        <div className="email-moldura">
          <div className="email-cabeca">
            <span className="r">Para</span><span className="truncar">{mail || '-'}</span>
            <span className="r">Assunto</span><span className="forte truncar">{item.assunto || '(sem assunto)'}</span>
          </div>
          {item.html ? (
            <iframe className="email-frame" title={`E-mail para ${item.destinatario}`} sandbox="" srcDoc={item.html} />
          ) : (
            <div style={{ padding: 16 }}><TextoMensagem texto={item.texto} /></div>
          )}
        </div>
      ) : (
        <div className="whats-fundo">
          <div className="whats-bolha">
            {item.assunto && canal !== 'whatsapp' && <div className="forte" style={{ marginBottom: 6 }}>{item.assunto}</div>}
            <TextoMensagem texto={item.texto} />
            <span className="hora">agora</span>
          </div>
        </div>
      )}
      <div className="mini mudo">Os trechos destacados são números calculados pelo motor de apuração para esta pessoa. Não é preciso conferir planilha.</div>
    </div>
  );
}

// ------------------------------------------------------------------ fila do WhatsApp (pós-disparo)
function FilaWhatsapp({ itens, previa, aoAbrir, aoFechar }) {
  const total = itens.length;
  const feitos = itens.filter((i) => i.status === 'enviado').length;
  const proximo = itens.find((i) => i.status !== 'enviado' && (i.whatsapp_url || previa.get(i.chave)?.whatsapp_url));
  return (
    <Cartao
      titulo="Fila de envio pelo WhatsApp"
      subtitulo="Cada clique abre a conversa com a mensagem pronta e marca como enviada."
      acoes={
        <>
          <Botao variante="primario" icone={MessageCircle} disabled={!proximo} onClick={() => proximo && aoAbrir(proximo)}>
            {proximo ? `Abrir próximo: ${proximo.destinatario.split(' ')[0]}` : 'Tudo enviado'}
          </Botao>
          <Botao variante="fantasma" icone={X} onClick={aoFechar}>Fechar fila</Botao>
        </>
      }
    >
      <div className="coluna" style={{ gap: 12 }}>
        <div className="linha" style={{ gap: 12 }}>
          <div className="cresce"><Progresso valor={total ? (feitos / total) * 100 : 0} cor="bom" /></div>
          <span className="pequeno forte num">{feitos}/{total}</span>
        </div>
        <div className="coluna" style={{ gap: 2, maxHeight: 'calc(100vh - 320px)', overflow: 'auto' }}>
          {itens.map((it) => {
            const url = it.whatsapp_url || previa.get(it.chave)?.whatsapp_url;
            const feito = it.status === 'enviado';
            return (
              <div key={it.chave} className={cx('fila-linha', feito && 'feito')}>
                <Avatar nome={it.destinatario} foto={it.foto} tamanho="p" />
                <div style={{ minWidth: 0 }}>
                  <div className="pequeno forte truncar">{it.destinatario}</div>
                  <div className="mini mudo truncar">{resumoTexto(previa.get(it.chave)?.texto)}</div>
                </div>
                {feito ? (
                  <Selo cor="bom" icone={CheckCircle2}>Enviado</Selo>
                ) : it.status === 'erro' ? (
                  <Selo cor="critico" title={it.erro}>Erro</Selo>
                ) : url ? (
                  <Botao tamanho="p" variante="sutil" icone={MessageCircle} onClick={() => aoAbrir(it)}>Abrir</Botao>
                ) : (
                  <Selo cor="aviso" icone={PhoneOff}>Sem telefone</Selo>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Cartao>
  );
}

// ------------------------------------------------------------------ aba Disparar
export default function Disparar({ campanhaInicial }) {
  const toast = useToast();
  const [confirmar, dialogo] = useConfirmar();
  const { dados: campanhas, erro: erroCampanhas, recarregar: recarregarCampanhas } = useApi('/campanhas');
  const { dados: modelos } = useApi('/modelos-mensagem');
  const { dados: variaveis } = useApi('/variaveis-mensagem');

  const [idCampanha, setIdCampanha] = useState(campanhaInicial ? String(campanhaInicial) : '');
  const [destino, setDestino] = useState('participantes');
  const [filtro, setFiltro] = useState('todos');
  const [idModelo, setIdModelo] = useState('');
  const [livre, setLivre] = useState({ assunto: '{campanha}', corpo: '' });
  const [canal, setCanal] = useState('whatsapp');
  const [previa, setPrevia] = useState(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [erroPrevia, setErroPrevia] = useState(null);
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [focado, setFocado] = useState(null);
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [fila, setFila] = useState(null);
  const refCorpo = useRef(null);
  const contador = useRef(0);

  // campanha padrão: a primeira ativa
  useEffect(() => {
    if (!idCampanha && campanhas?.length) {
      const c = ordenarCampanhas(campanhas)[0];
      if (c) setIdCampanha(String(c.id));
    }
  }, [campanhas, idCampanha]);

  // modelo padrão para o destino
  const modelosDoDestino = useMemo(() => (modelos || []).filter((m) => (m.destino || 'participantes') === destino), [modelos, destino]);
  useEffect(() => {
    if (!modelos) return;
    const atualValido = idModelo === LIVRE || modelosDoDestino.some((m) => String(m.id) === String(idModelo));
    if (!atualValido) setIdModelo(modelosDoDestino[0] ? String(modelosDoDestino[0].id) : LIVRE);
  }, [modelos, modelosDoDestino, idModelo]);

  const livreAtrasado = useAtrasado(livre, 650);
  const corpoPedido = useMemo(() => {
    if (!idCampanha || !idModelo) return null;
    const base = { destino, filtro: destino === 'geral' ? 'todos' : filtro };
    if (idModelo === LIVRE) {
      if (!livreAtrasado.corpo.trim()) return null;
      return { ...base, corpo: livreAtrasado.corpo, assunto: livreAtrasado.assunto };
    }
    return { ...base, id_modelo: Number(idModelo) };
  }, [idCampanha, idModelo, destino, filtro, livreAtrasado]);

  async function gerarPrevia() {
    if (!corpoPedido) return;
    const id = ++contador.current;
    setCarregandoPrevia(true);
    setErroPrevia(null);
    try {
      const r = await post(`/campanhas/${idCampanha}/mensagens/previa`, corpoPedido);
      if (id !== contador.current) return;
      const lista = Array.isArray(r) ? r : r?.itens || [];
      setPrevia(lista);
      setSelecionados(new Set(lista.filter((it) => elegivel(it, canal)).map((it) => it.chave)));
      setFocado((f) => (lista.some((it) => it.chave === f) ? f : lista[0]?.chave ?? null));
      setResultado(null);
    } catch (e) {
      if (id === contador.current) setErroPrevia(e);
    } finally {
      if (id === contador.current) setCarregandoPrevia(false);
    }
  }

  useEffect(() => {
    setFila(null);
    gerarPrevia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpoPedido, idCampanha]);

  // ao trocar de canal, reaplica a seleção padrão (só quem tem o contato necessário)
  useEffect(() => {
    if (previa) setSelecionados(new Set(previa.filter((it) => elegivel(it, canal)).map((it) => it.chave)));
  }, [canal]); // eslint-disable-line react-hooks/exhaustive-deps

  const campanha = campanhas?.find((c) => String(c.id) === String(idCampanha));
  const porChave = useMemo(() => new Map((previa || []).map((it) => [it.chave, it])), [previa]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (previa || []).filter((it) => !q || `${it.destinatario} ${it.contato?.email || ''}`.toLowerCase().includes(q));
  }, [previa, busca]);
  const itemFocado = focado != null ? porChave.get(focado) : null;
  const nSel = selecionados.size;
  const semContato = (previa || []).filter((it) => !elegivel(it, canal)).length;

  const variaveisDestino = useMemo(
    () => (variaveis || []).filter((v) => !v.destino || v.destino === 'todos' || v.destino === destino),
    [variaveis, destino],
  );

  const alternar = (chave) => setSelecionados((s) => {
    const n = new Set(s);
    if (n.has(chave)) n.delete(chave);
    else n.add(chave);
    return n;
  });

  async function disparar() {
    if (!previa || !nSel) return;
    const c = CANAL[canal];
    if (canal === 'email' || canal === 'webhook') {
      const ok = await confirmar({
        titulo: `Enviar ${plural(nSel, 'mensagem', 'mensagens')} por ${c.rotulo}?`,
        texto: canal === 'email' ? 'Os e-mails saem agora. Se o SMTP não estiver configurado, ficam registrados como simulados na caixa de saída.' : 'As mensagens serão entregues agora para a URL de webhook configurada.',
        rotulo: 'Enviar agora',
      });
      if (!ok) return;
    }
    setEnviando(true);
    try {
      const chaves = previa.filter((it) => selecionados.has(it.chave)).map((it) => it.chave);
      const r = await post(`/campanhas/${idCampanha}/disparos`, { ...corpoPedido, canal, chaves });
      setResultado(r);
      if (canal === 'whatsapp') {
        const itens = (r?.itens?.length ? r.itens : chaves.map((k) => ({ chave: k, destinatario: porChave.get(k)?.destinatario, status: 'pendente' })))
          .map((it) => ({ ...it, destinatario: it.destinatario || porChave.get(it.chave)?.destinatario || it.chave }));
        setFila(itens);
        toast.ok('Mensagens prontas. Abra cada conversa pela fila.');
      } else {
        toast.ok(`${fmtNumero(r?.enviados ?? 0)} enviadas · ${fmtNumero(r?.simulados ?? 0)} simuladas · ${fmtNumero(r?.erros ?? 0)} erros`);
      }
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function abrirWhatsapp(it) {
    const p = porChave.get(it.chave);
    const url = it.whatsapp_url || p?.whatsapp_url || linkWhatsapp(p?.contato?.telefone, p?.texto);
    if (url) window.open(url, '_blank', 'noopener');
    const id = it.id ?? it.id_disparo;
    if (id != null) {
      try {
        await post(`/disparos/${id}/marcar`, { status: 'enviado' });
      } catch {
        /* marcação é best-effort; a mensagem já foi aberta */
      }
    }
    setFila((f) => f.map((x) => (x.chave === it.chave ? { ...x, status: 'enviado' } : x)));
  }

  if (erroCampanhas && !campanhas) return <ErroCarga erro={erroCampanhas} aoTentar={recarregarCampanhas} />;
  if (!campanhas) return <Carregando />;
  if (!campanhas.length) return <Vazio icone={Send} titulo="Nenhuma campanha" texto="Crie uma campanha para começar a enviar acompanhamentos." />;

  const ehLivre = idModelo === LIVRE;
  const r = campanha?.resumo;

  return (
    <div className="disparo-grade">
      {dialogo}
      <Cartao className="disparo-config" semMargem>
        {/* 1. campanha */}
        <div className="passo">
          <span className="passo-num">1</span>
          <div className="passo-corpo">
            <div className="passo-titulo com-explica">Campanha<Explica titulo="Campanha" texto="A campanha cujos números vão na mensagem. A apuração é refeita na hora, com os dados mais recentes." tamanho={13} /></div>
            <Seletor opcoes={opcoesCampanhas(campanhas)} valor={idCampanha} aoMudar={(v) => { setIdCampanha(v); definirQuery({ campanha: v }); }} />
            {campanha && (
              <div className="mini mudo">
                {fmtPeriodo(campanha.inicio, campanha.fim)}
                {r && <> · {fmtNumero(r.participantes)} participantes · atingimento {fmtPerc(r.atingimento_geral)} → projeção {fmtPerc(r.atingimento_geral_proj)}</>}
              </div>
            )}
          </div>
        </div>

        {/* 2. destino e filtro */}
        <div className="passo">
          <span className="passo-num">2</span>
          <div className="passo-corpo">
            <div className="passo-titulo com-explica">Para quem<Explica titulo="Para quem" {...EXPLICA.disparoPublico} como="Os filtros embaixo escolhem só uma parte: todos, em risco, quem ainda não atingiu, quem já atingiu ou quem está perto da próxima faixa de prêmio." tamanho={13} /></div>
            <div><Segmentado tamanho="p" opcoes={DESTINOS} valor={destino} aoMudar={setDestino} /></div>
            {destino !== 'geral' ? (
              <div className="linha quebra g4">
                {FILTROS.map((f) => <Chip key={f.valor} ativo={filtro === f.valor} aoClicar={() => setFiltro(f.valor)}>{f.rotulo}</Chip>)}
              </div>
            ) : (
              <div className="mini mudo">Um resumo da campanha para os destinatários gerais (definidos em Configurações › Envio).</div>
            )}
          </div>
        </div>

        {/* 3. mensagem */}
        <div className="passo">
          <span className="passo-num">3</span>
          <div className="passo-corpo">
            <div className="passo-titulo com-explica">Mensagem<Explica titulo="Mensagem" texto="Escolha um modelo pronto ou escreva um texto livre. Os modelos usam variáveis que viram os números de cada pessoa." exemplo={EXPLICA.variaveis.exemplo} tamanho={13} /></div>
            <Seletor
              opcoes={[...modelosDoDestino.map((m) => ({ valor: String(m.id), rotulo: m.nome })), { valor: LIVRE, rotulo: '✎ Texto livre (escrever agora)' }]}
              valor={idModelo}
              aoMudar={setIdModelo}
            />
            {!ehLivre && (
              <button type="button" className="botao p fantasma" style={{ alignSelf: 'flex-start' }} onClick={() => definirQuery({ aba: 'modelos', modelo: idModelo })}>
                <Pencil size={13} /> Editar este modelo
              </button>
            )}
            {ehLivre && (
              <>
                {canal === 'email' && (
                  <Campo rotulo="Assunto">
                    <Entrada tamanho="p" value={livre.assunto} onChange={(e) => setLivre((l) => ({ ...l, assunto: e.target.value }))} />
                  </Campo>
                )}
                <AreaTexto ref={refCorpo} rows={8} value={livre.corpo} placeholder="Escreva e use as variáveis abaixo. Elas viram os números de cada pessoa."
                  onChange={(e) => setLivre((l) => ({ ...l, corpo: e.target.value }))} />
                <div className="var-chips">
                  {variaveisDestino.map((v) => (
                    <button key={v.chave} type="button" className="var-chip" title={`${v.descricao}${v.exemplo ? ` (ex.: ${v.exemplo})` : ''}`}
                      onClick={() => inserirNoCursor(refCorpo, livre.corpo, v.chave, (corpo) => setLivre((l) => ({ ...l, corpo })))}>
                      {v.chave}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 4. canal */}
        <div className="passo">
          <span className="passo-num">4</span>
          <div className="passo-corpo">
            <div className="passo-titulo com-explica">Canal<Explica titulo="Canal" {...EXPLICA.disparoCanal} tamanho={13} /></div>
            <div className="canais">
              {CANAIS.map((c) => (
                <button key={c.valor} type="button" className={cx('canal-opcao', canal === c.valor && 'ativo')} onClick={() => setCanal(c.valor)} aria-pressed={canal === c.valor}>
                  <span className="t"><c.icone size={15} />{c.rotulo}</span>
                  <span className="d">{c.descricao}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 18px 18px', borderTop: '1px solid var(--borda)' }} className="coluna">
          {semContato > 0 && previa && (
            <div className="mini mudo">{plural(semContato, 'destinatário sem', 'destinatários sem')} {canal === 'email' ? 'e-mail' : 'telefone'}, fora da seleção.</div>
          )}
          <Botao variante="primario" tamanho="g" icone={Send} carregando={enviando} disabled={!nSel || carregandoPrevia} onClick={disparar}>
            {canal === 'whatsapp' ? `Preparar ${plural(nSel, 'mensagem', 'mensagens')}` : `Enviar ${plural(nSel, 'mensagem', 'mensagens')}`}
          </Botao>
          {resultado && canal !== 'whatsapp' && (
            <Aviso tipo={resultado.erros ? 'aviso' : 'ok'} titulo="Disparo concluído">
              {fmtNumero(resultado.enviados ?? 0)} enviadas · {fmtNumero(resultado.simulados ?? 0)} simuladas · {fmtNumero(resultado.erros ?? 0)} com erro.{' '}
              <a href="#/acompanhamentos?aba=historico">Ver caixa de saída</a>
            </Aviso>
          )}
        </div>
      </Cartao>

      <div className="coluna" style={{ gap: 14, minWidth: 0 }}>
        {fila ? (
          <FilaWhatsapp itens={fila} previa={porChave} aoAbrir={abrirWhatsapp} aoFechar={() => setFila(null)} />
        ) : (
          <Cartao semMargem>
            <div className="previa-cabeca">
              <div className="linha" style={{ gap: 10 }}>
                <Sparkles size={16} style={{ color: 'var(--acento)' }} />
                <div>
                  <div className="forte com-explica">Prévia das mensagens<Explica titulo="Prévia das mensagens" texto="Cada pessoa com a mensagem que vai receber, já com os números dela. Nada é enviado até você clicar no botão." como={['Marque ou desmarque quem recebe.', 'Clique numa linha para ler a mensagem inteira.', 'Quem não tem telefone (ou e-mail) aparece apagado.']} tamanho={13} /></div>
                  <div className="mini mudo">
                    {previa ? `${plural(previa.length, 'destinatário', 'destinatários')} · ${nSel} selecionado${nSel === 1 ? '' : 's'}` : 'Montando com os números de hoje…'}
                  </div>
                </div>
              </div>
              <div className="linha" style={{ gap: 6 }}>
                <Entrada tamanho="p" icone={Search} placeholder="Buscar destinatário" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: 200 }} />
                <Botao tamanho="p" variante="fantasma" icone={Users} onClick={() => setSelecionados(new Set((previa || []).filter((it) => elegivel(it, canal)).map((it) => it.chave)))}>Todos</Botao>
                <Botao tamanho="p" variante="fantasma" onClick={() => setSelecionados(new Set())}>Nenhum</Botao>
                <Botao tamanho="p" variante="fantasma" icone={RefreshCw} carregando={carregandoPrevia} onClick={gerarPrevia} title="Recalcular prévia" />
              </div>
            </div>
            {erroPrevia && <div style={{ padding: 16 }}><ErroCarga erro={erroPrevia} aoTentar={gerarPrevia} /></div>}
            {!previa && !erroPrevia && (
              ehLivre && !livre.corpo.trim()
                ? <Vazio icone={Pencil} titulo="Escreva a mensagem" texto="Use as variáveis para cada pessoa receber os próprios números: posição, projeção, ritmo necessário, próxima faixa…" />
                : <Carregando texto="Apurando e montando as mensagens…" altura={420} />
            )}
            {previa && (
              previa.length === 0 ? (
                <Vazio icone={Users} titulo="Ninguém neste filtro" texto="Troque o filtro ou o destino para ver as mensagens." />
              ) : (
                <div className={cx('previa-corpo', carregandoPrevia && 'previa-carregando')}>
                  <div className="previa-lista" role="listbox" aria-label="Destinatários">
                    {visiveis.map((it) => {
                      const ok = elegivel(it, canal);
                      return (
                        <div key={it.chave} className={cx('dest-linha', focado === it.chave && 'ativa', !ok && 'inelegivel')} onClick={() => setFocado(it.chave)} role="option" aria-selected={focado === it.chave}>
                          <input type="checkbox" checked={selecionados.has(it.chave)} disabled={!ok} onClick={(e) => e.stopPropagation()} onChange={() => alternar(it.chave)} aria-label={`Selecionar ${it.destinatario}`} />
                          <Avatar nome={it.destinatario} foto={it.foto} tamanho="p" />
                          <div className="cresce" style={{ minWidth: 0 }}>
                            <div className="pequeno forte truncar">{it.destinatario}</div>
                            <div className="mini mudo truncar">{resumoTexto(it.texto)}</div>
                          </div>
                          {canal === 'whatsapp' && (ok ? <Phone size={13} className="ok" aria-label="Tem telefone" /> : <PhoneOff size={13} className="falta" aria-label="Sem telefone" />)}
                          {canal === 'email' && (ok ? <Mail size={13} className="ok" aria-label="Tem e-mail" /> : <X size={13} className="falta" aria-label="Sem e-mail" />)}
                        </div>
                      );
                    })}
                    {!visiveis.length && <div className="mudo pequeno" style={{ padding: 12 }}>Nenhum destinatário com esse nome.</div>}
                  </div>
                  <div className="previa-detalhe">
                    <VisualMensagem item={itemFocado} canal={canal} />
                  </div>
                </div>
              )
            )}
          </Cartao>
        )}
      </div>
    </div>
  );
}
