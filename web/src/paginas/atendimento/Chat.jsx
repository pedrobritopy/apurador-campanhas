import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle, ArrowLeft, Bot, Check, CheckCheck, ChevronDown, Clock, FileText, Image as ImagemIcone, MapPin, MessageSquareText,
  Mic, MoreVertical, PanelRight, Paperclip, SendHorizontal, Sparkles, Video, Zap,
} from 'lucide-react';
import { get, post } from '../../lib/api.js';
import { Aviso, Botao, BotaoIcone, Carregando, Menu, Modal, Seletor, Vazio, useToast } from '../../componentes/ui.jsx';
import { AvatarContato, RotuloCanal, SeloVinculo } from './comum.jsx';
import { COLUNAS, PRIORIDADES, chaveDia, horaMinuto, nomeContato, rotuloDia } from './util.js';

const ICONE_ANEXO = { imagem: ImagemIcone, documento: FileText, audio: Mic, video: Video, localizacao: MapPin, figurinha: Sparkles };

function Anexos({ anexos }) {
  if (!anexos?.length) return null;
  return (
    <div className="anexos">
      {anexos.map((a, i) => {
        const Ic = ICONE_ANEXO[a.tipo] || Paperclip;
        return (
          <span key={i} className="atd-anexo" title={a.mime || a.tipo}>
            <Ic size={13} /> {a.nome || a.tipo}
          </span>
        );
      })}
    </div>
  );
}

function StatusEnvio({ m }) {
  if (m.direcao !== 'saida') return null;
  if (m.status === 'enviando') return <Clock size={11} />;
  if (m.status === 'erro') return <AlertTriangle size={11} style={{ color: 'var(--critico)' }} />;
  if (m.status === 'bot') return <Bot size={11} />;
  return <CheckCheck size={12} className="lido" />;
}

function Bolha({ m, seguida, mostrarAutor }) {
  const [verHtml, setVerHtml] = useState(false);
  const bot = m.status === 'bot' || m.autor === 'Bot';
  const classe = m.direcao === 'entrada' ? 'msg-in' : bot ? 'msg-bot' : 'msg-out';
  if (m.direcao === 'sistema') return <div className="atd-sistema">{m.texto}</div>;
  return (
    <motion.div className={`atd-bolha ${classe}${m.status === 'erro' ? ' erro' : ''}${seguida ? ' seguida' : ''}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 36 }}
      title={m.status === 'erro' ? `Falha no envio: ${m.erro || ''}` : undefined}>
      {mostrarAutor && classe !== 'msg-in' && (
        <div className="autor">{bot ? <><Bot size={12} /> Bot automático</> : m.autor || 'Atendente'}</div>
      )}
      <Anexos anexos={m.anexos} />
      {m.texto && <div className="texto">{m.texto}</div>}
      {m.html && (
        <div style={{ marginTop: 4 }}>
          <button type="button" className="botao fantasma p" onClick={() => setVerHtml((v) => !v)}>
            <ChevronDown size={12} style={{ transform: verHtml ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
            {verHtml ? 'Ocultar e-mail formatado' : 'Ver e-mail formatado'}
          </button>
          {verHtml && <iframe className="atd-email-quadro" sandbox="" srcDoc={m.html} title="E-mail original" />}
        </div>
      )}
      <div className="rodape">
        {m.status === 'erro' && <span style={{ color: 'var(--critico-texto)' }}>não enviada</span>}
        <span>{horaMinuto(m.criado_em)}</span>
        <StatusEnvio m={m} />
      </div>
    </motion.div>
  );
}

function ModalBoletim({ aberto, aoFechar, idVendedor, nome, aoInserir }) {
  const [dados, setDados] = useState(null);
  const [campanha, setCampanha] = useState('');
  const [erro, setErro] = useState(null);
  useEffect(() => {
    if (!aberto || !idVendedor) return;
    setDados(null);
    setErro(null);
    get(`/atendimento/boletim?vendedor=${idVendedor}${campanha ? `&campanha=${campanha}` : ''}`).then(setDados).catch(setErro);
  }, [aberto, idVendedor, campanha]);
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Inserir boletim" subtitulo={`Situação de ${nome} nas campanhas, pronta para enviar`} largura={640}
      rodape={<>
        <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
        <Botao variante="primario" icone={MessageSquareText} disabled={!dados} onClick={() => { aoInserir(dados.texto); aoFechar(); }}>Inserir na mensagem</Botao>
      </>}>
      <div className="coluna g12">
        <Seletor valor={campanha} aoMudar={setCampanha} vazio="Todas as campanhas ativas"
          opcoes={(dados?.campanhas || []).map((c) => ({ valor: String(c.id), rotulo: `${c.nome} (${c.posicao}º de ${c.total})` }))} />
        {erro && <Aviso tipo="erro">{erro.message}</Aviso>}
        {!dados && !erro && <Carregando texto="Apurando as campanhas…" altura={160} />}
        {dados && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, margin: 0, padding: 12, borderRadius: 10, background: 'var(--superficie-2)', maxHeight: 380, overflow: 'auto' }}>{dados.texto}</pre>}
      </div>
    </Modal>
  );
}

export default function Chat({ conversa, ouvirMensagens, aplicarConversa, aoVoltar, aoAlternarPainel, smtpConfigurado, respostas = [] }) {
  const toast = useToast();
  const id = conversa?.id;
  const [mensagens, setMensagens] = useState(null);
  const [temMais, setTemMais] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [boletim, setBoletim] = useState(false);
  const area = useRef(null);
  const caixa = useRef(null);
  const noFim = useRef(true);
  const alturaAntes = useRef(null);

  const carregar = useCallback(async () => {
    if (!id) return;
    setMensagens(null);
    try {
      const d = await get(`/atendimento/conversas/${id}`);
      setMensagens(d.mensagens);
      setTemMais(d.tem_mais);
      noFim.current = true;
      if (d.conversa.nao_lidas) post(`/atendimento/conversas/${id}/lida`).then(aplicarConversa).catch(() => {});
    } catch (e) {
      toast.erro(e.message);
    }
  }, [id, aplicarConversa, toast]);

  useEffect(() => {
    setTexto('');
    carregar();
  }, [carregar]);

  // novas mensagens em tempo real
  useEffect(() => ouvirMensagens((m) => {
    if (m.id_conversa !== id) return;
    setMensagens((lista) => {
      if (!lista) return lista;
      const i = lista.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const nova = [...lista];
        nova[i] = m;
        return nova;
      }
      return [...lista, m];
    });
    if (m.direcao === 'entrada' && document.visibilityState === 'visible') post(`/atendimento/conversas/${id}/lida`).catch(() => {});
  }), [id, ouvirMensagens]);

  // rolagem: no fim ao abrir e ao chegar mensagem (se o usuário já estava no fim); mantém posição ao carregar antigas
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !mensagens) return;
    if (alturaAntes.current != null) {
      el.scrollTop = el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
    } else if (noFim.current) el.scrollTop = el.scrollHeight;
  }, [mensagens]);

  const anteriores = async () => {
    if (!mensagens?.length) return;
    alturaAntes.current = area.current.scrollHeight;
    const d = await get(`/atendimento/conversas/${id}?antes=${mensagens[0].id}`);
    setMensagens((l) => [...d.mensagens, ...l]);
    setTemMais(d.tem_mais);
  };

  const ajustarAltura = () => {
    const t = caixa.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(180, t.scrollHeight)}px`;
  };
  useEffect(ajustarAltura, [texto]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    noFim.current = true;
    try {
      const m = await post(`/atendimento/conversas/${id}/mensagens`, { texto: t, autor: 'Atendente' });
      setTexto('');
      if (m.status === 'erro') toast.erro(`Não foi enviada: ${m.erro}`);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setEnviando(false);
      caixa.current?.focus();
    }
  };

  const acao = async (caminho, corpo, ok) => {
    try {
      aplicarConversa(await post(`/atendimento/conversas/${id}/${caminho}`, corpo));
      if (ok) toast.ok(ok);
    } catch (e) {
      toast.erro(e.message);
    }
  };

  const grupos = useMemo(() => {
    const out = [];
    let dia = null;
    let anterior = null;
    for (const m of mensagens || []) {
      const k = chaveDia(m.criado_em);
      if (k !== dia) {
        out.push({ tipo: 'dia', chave: `d-${k}`, texto: rotuloDia(m.criado_em) });
        dia = k;
        anterior = null;
      }
      const ehBot = m.status === 'bot' || m.autor === 'Bot';
      const mesmoAutor = anterior && anterior.direcao === m.direcao && (anterior.status === 'bot') === ehBot && new Date(m.criado_em) - new Date(anterior.criado_em) < 180000;
      out.push({ tipo: 'msg', chave: m.id, m, seguida: Boolean(mesmoAutor), mostrarAutor: !mesmoAutor });
      anterior = m;
    }
    return out;
  }, [mensagens]);

  if (!conversa) {
    return (
      <section className="atd-chat">
        <div className="atd-vazio-chat">
          <Vazio icone={MessageSquareText} titulo="Escolha uma conversa" texto="As mensagens do Telegram e do e-mail chegam aqui em tempo real. Comandos como /boletim são respondidos automaticamente pelo bot." />
        </div>
      </section>
    );
  }

  const c = conversa.contato;
  const nome = nomeContato(conversa);
  const semEnvio = conversa.canal === 'email' && !smtpConfigurado;
  const sub = [c.username, conversa.canal === 'email' ? c.email || c.identificador : c.telefone].filter(Boolean).join(' · ');

  return (
    <section className="atd-chat">
      <header className="atd-chat-topo">
        {aoVoltar && <BotaoIcone icone={ArrowLeft} rotulo="Voltar para a lista" onClick={aoVoltar} />}
        <AvatarContato nome={nome} canal={conversa.canal} foto={conversa.vinculo?.foto} />
        <div className="quem">
          <div className="linha g4" style={{ minWidth: 0 }}>
            <strong className="truncar">{nome}</strong>
            <SeloVinculo tipo={conversa.vinculo?.tipo} />
          </div>
          <span className="mudo pequeno truncar">
            <RotuloCanal canal={conversa.canal} />{sub ? ` · ${sub}` : ''}{conversa.assunto && conversa.canal === 'email' ? ` · ${conversa.assunto}` : ''}
          </span>
        </div>
        <Seletor tamanho="p" valor={conversa.status} aoMudar={(s) => acao('status', { status: s }, s === 'resolvido' ? 'Conversa resolvida' : null)}
          opcoes={COLUNAS.map((col) => ({ valor: col.id, rotulo: col.rotulo }))} style={{ width: 150 }} aria-label="Situação" />
        <Menu gatilho={<BotaoIcone icone={MoreVertical} rotulo="Mais ações" />} itens={[
          ...PRIORIDADES.map((p) => ({ rotulo: `Prioridade ${p.rotulo.toLowerCase()}${conversa.prioridade === p.valor ? ' ✓' : ''}`, aoClicar: () => acao('prioridade', { prioridade: p.valor }) })),
          '-',
          { rotulo: 'Resolver conversa', icone: Check, aoClicar: () => acao('status', { status: 'resolvido' }, 'Conversa resolvida') },
        ]} />
        {aoAlternarPainel && <BotaoIcone icone={PanelRight} rotulo="Detalhes do contato" onClick={aoAlternarPainel} />}
      </header>

      <div className="atd-msgs" ref={area} onScroll={(e) => {
        const el = e.currentTarget;
        noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}>
        {!mensagens && <Carregando altura={240} texto="Abrindo conversa…" />}
        {temMais && <button type="button" className="atd-dia" style={{ cursor: 'pointer', border: 0 }} onClick={anteriores}>Carregar mensagens anteriores</button>}
        {grupos.map((g) =>
          g.tipo === 'dia' ? <div key={g.chave} className="atd-dia">{g.texto}</div> : <Fragment key={g.chave}><Bolha m={g.m} seguida={g.seguida} mostrarAutor={g.mostrarAutor} /></Fragment>,
        )}
      </div>

      {semEnvio && <Aviso tipo="aviso" className="nao-imprimir">Para responder e-mails, configure o SMTP em <a href="#/config?aba=envio">Configurações → Envio</a>.</Aviso>}
      <div className="atd-compositor">
        <Menu alinhar="esquerda" gatilho={<BotaoIcone icone={Zap} rotulo="Respostas rápidas" variante="fantasma" />}
          itens={respostas.map((r) => ({ rotulo: r.titulo, aoClicar: () => setTexto((t) => (t ? `${t}\n${r.texto}` : r.texto)) }))} />
        {conversa.contato.id_vendedor && (
          <Botao variante="sutil" icone={Sparkles} onClick={() => setBoletim(true)} title="Inserir a situação do vendedor nas campanhas">Boletim</Botao>
        )}
        <textarea ref={caixa} rows={1} value={texto} disabled={semEnvio} placeholder={conversa.canal === 'email' ? 'Escreva a resposta do e-mail… (Enter envia, Shift+Enter quebra linha)' : 'Mensagem (Enter envia, Shift+Enter quebra linha)'}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }} />
        <Botao variante="primario" className="enviar" icone={SendHorizontal} carregando={enviando} disabled={!texto.trim() || semEnvio} onClick={enviar} aria-label="Enviar" />
      </div>
      <ModalBoletim aberto={boletim} aoFechar={() => setBoletim(false)} idVendedor={conversa.contato.id_vendedor} nome={nome}
        aoInserir={(t) => setTexto((x) => (x ? `${x}\n\n${t}` : t))} />
    </section>
  );
}
