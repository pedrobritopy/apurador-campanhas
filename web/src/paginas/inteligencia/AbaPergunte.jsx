import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Database, MessageSquareText, Send, Square, Trash2 } from 'lucide-react';
import { sse, useApi } from '../../lib/api.js';
import { useDimensoes } from '../../lib/dados.js';
import { fmtNumero, fmtUsd } from '../../lib/formato.js';
import { AreaTexto, Botao, Cartao, Chip, Explica, Seletor, Selo, Vazio, useToast } from '../../componentes/ui.jsx';
import { ESCOPO_FATO, EXPLICA_INSIGHTS, MedidorIa, ModalFato, TextoComFontes } from './comum.jsx';

const SUGESTOES = [
  'Quais campanhas correm mais risco de não bater a meta e por quê?',
  'Quem está perto da próxima faixa de prêmio?',
  'Quais clientes têm recompra atrasada de maior valor?',
  'Que produtos podem faltar no estoque antes do fim das campanhas?',
  'Quais vendedores mais caíram nos últimos 30 dias?',
  'Que marcas costumam ser compradas juntas?',
];

export default function AbaPergunte() {
  const toast = useToast();
  const { dados: dim } = useDimensoes();
  const { dados: campanhas } = useApi('/campanhas');
  const { dados: status, recarregar: recarregarStatus } = useApi('/ia/status');
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [campanha, setCampanha] = useState('');
  const [vendedor, setVendedor] = useState('');
  const [fatos, setFatos] = useState([]);
  const [respondendo, setRespondendo] = useState(false);
  const [fatoAberto, setFatoAberto] = useState(null);
  const controle = useRef(null);
  const fim = useRef(null);

  const opcoesCamp = useMemo(() => (campanhas || []).filter((c) => ['ativa', 'encerrada'].includes(c.status)).map((c) => ({ valor: String(c.id), rotulo: c.nome })), [campanhas]);
  const opcoesVend = useMemo(() => (dim?.vendedores || []).map((v) => ({ valor: String(v.id), rotulo: v.nome })), [dim]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [mensagens]);
  useEffect(() => () => controle.current?.abort(), []);

  const enviar = (pergunta) => {
    const q = (pergunta ?? texto).trim();
    if (!q || respondendo) return;
    const historico = mensagens.filter((m) => !m.erro).map((m) => ({ papel: m.papel, texto: m.texto }));
    setTexto('');
    setRespondendo(true);
    setFatos([]);
    setMensagens((l) => [...l, { papel: 'usuario', texto: q }, { papel: 'ia', texto: '', pendente: true }]);
    const atualizarUltima = (fn) => setMensagens((l) => l.map((m, i) => (i === l.length - 1 ? fn(m) : m)));
    controle.current = sse('/ia/perguntar', { pergunta: q, historico, contexto: { campanha: campanha || undefined, vendedor: vendedor || undefined } }, (ev, d) => {
      if (ev === 'fatos') setFatos(d.fatos || []);
      else if (ev === 'texto') atualizarUltima((m) => ({ ...m, texto: m.texto + (d.delta || '') }));
      else if (ev === 'fim') {
        atualizarUltima((m) => ({ ...m, pendente: false, custo: d.custo_usd, verificacao: d.verificacao, simulada: d.simulada, truncada: d.truncada }));
        setRespondendo(false);
        recarregarStatus();
      } else if (ev === 'erro') {
        atualizarUltima((m) => ({ ...m, pendente: false, erro: true, texto: m.texto || d.erro }));
        setRespondendo(false);
        toast.erro(d.erro);
      }
    });
  };

  const parar = () => {
    controle.current?.abort();
    setRespondendo(false);
    setMensagens((l) => l.map((m, i) => (i === l.length - 1 ? { ...m, pendente: false, interrompida: true } : m)));
  };

  const validos = useMemo(() => new Set(fatos.map((f) => f.id)), [fatos]);

  return (
    <div className="ig-chat">
      <Cartao semMargem className="ig-conversa">
        <div className="linha quebra" style={{ padding: '12px 14px', borderBottom: '1px solid var(--borda)', gap: 8 }}>
          <span className="pequeno sec linha g4">Contexto opcional <Explica titulo="Pergunte à IA" {...EXPLICA_INSIGHTS.pergunte} tamanho={13} /></span>
          <Seletor tamanho="p" opcoes={opcoesCamp} valor={campanha} aoMudar={setCampanha} vazio="Qualquer campanha" style={{ width: 220 }} />
          <Seletor tamanho="p" opcoes={opcoesVend} valor={vendedor} aoMudar={setVendedor} vazio="Qualquer vendedor" style={{ width: 200 }} />
          <div className="cresce" />
          {mensagens.length > 0 && <Botao tamanho="p" variante="fantasma" icone={Trash2} onClick={() => { setMensagens([]); setFatos([]); }}>Limpar</Botao>}
        </div>
        <div className="ig-mensagens">
          {!mensagens.length && (
            <div className="coluna" style={{ margin: 'auto', alignItems: 'center', gap: 16, textAlign: 'center', padding: 20 }}>
              <Vazio icone={MessageSquareText} titulo="Pergunte sobre campanhas, vendedores, clientes ou marcas" texto="A resposta usa só fatos validados da base e cita a origem de cada número. Para custar pouco, cada pergunta envia apenas os fatos relevantes." />
              <div className="ig-sugestoes">
                {SUGESTOES.map((s) => <Chip key={s} onClick={() => enviar(s)}>{s}</Chip>)}
              </div>
            </div>
          )}
          {mensagens.map((m, i) => (
            <div key={i} className={`ig-msg ${m.papel}`}>
              {m.papel === 'ia' ? (
                <>
                  {m.pendente && !m.texto ? <span className="ig-pensando"><span /><span /><span /></span> : <TextoComFontes texto={m.texto} aoAbrir={setFatoAberto} validos={validos.size ? validos : undefined} />}
                  {m.pendente && m.texto && <span className="ig-cursor" />}
                  {!m.pendente && !m.erro && (
                    <div className="ig-msg-rodape">
                      {m.verificacao && (m.verificacao.aprovado
                        ? <span className="ig-marca-verificado sim"><BadgeCheck size={12} /> {fmtNumero(m.verificacao.numeros_conferidos)} número(s) conferido(s)</span>
                        : <span className="ig-marca-verificado nao" title={(m.verificacao.numeros_sem_fonte || []).join(', ')}><AlertTriangle size={12} /> {fmtNumero(m.verificacao.numeros_nao_encontrados)} número(s) sem fonte</span>)}
                      {m.custo != null && <span>{m.simulada ? 'simulação' : fmtUsd(m.custo)}</span>}
                      {m.interrompida && <span>interrompida</span>}
                      {m.truncada && <span>resposta cortada</span>}
                    </div>
                  )}
                </>
              ) : (
                m.texto
              )}
            </div>
          ))}
          <div ref={fim} />
        </div>
        <div className="ig-compositor">
          <AreaTexto value={texto} placeholder="Ex.: Quais clientes da Giovana Campos estão com recompra atrasada?" rows={1}
            onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
          {respondendo ? <Botao icone={Square} onClick={parar}>Parar</Botao> : <Botao variante="primario" icone={Send} onClick={() => enviar()} disabled={!texto.trim()}>Enviar</Botao>}
        </div>
      </Cartao>

      <div className="ig-pegajoso">
        <Cartao><MedidorIa status={status} /></Cartao>
        <Cartao titulo="Fatos usados na resposta" info={EXPLICA_INSIGHTS.fatos} subtitulo={fatos.length ? `${fatos.length} fatos validados enviados à IA` : 'Aparecem aqui a cada pergunta'} acoes={<Database size={15} className="mudo" />}>
          {!fatos.length ? (
            <div className="mudo pequeno">Nenhum ainda.</div>
          ) : (
            <div className="coluna" style={{ gap: 6, maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
              {fatos.map((f) => (
                <button key={f.id} type="button" className="menu-item" style={{ alignItems: 'flex-start' }} onClick={() => setFatoAberto(f.id)}>
                  <Selo className="mini">{ESCOPO_FATO[f.escopo] || f.escopo}</Selo>
                  <span className="cresce" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{f.titulo}</span>
                </button>
              ))}
            </div>
          )}
        </Cartao>
      </div>
      <ModalFato id={fatoAberto} fatoInicial={fatos.find((f) => f.id === fatoAberto)} aoFechar={() => setFatoAberto(null)} />
    </div>
  );
}
