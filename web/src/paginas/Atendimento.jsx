import { useEffect, useMemo, useState } from 'react';
import { Columns3, FlaskConical, Mail, MessagesSquare, PlugZap, Send, Users } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { definirQuery } from '../lib/rotas.js';
import { fmtNumero } from '../lib/formato.js';
import { Abas, Botao, Carregando, ErroCarga, Explica, useToast } from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import ListaConversas from './atendimento/ListaConversas.jsx';
import Chat from './atendimento/Chat.jsx';
import PainelContato from './atendimento/PainelContato.jsx';
import Kanban from './atendimento/Kanban.jsx';
import Canais from './atendimento/Canais.jsx';
import Contatos from './atendimento/Contatos.jsx';
import { useCentral } from './atendimento/useCentral.js';
import './atendimento/atendimento.css';

function PilulaCanal({ icone: Icone, rotulo, status, aoClicar }) {
  const classe = !status?.ativo ? 'desligado' : status.erro ? 'erro' : status.conectado ? 'vivo' : '';
  const texto = !status?.ativo ? 'desligado' : status.erro ? 'com erro' : status.conectado ? 'conectado' : 'conectando';
  return (
    <button type="button" className="atd-pilula" onClick={aoClicar} title={status?.erro || `${rotulo}: ${texto}`}>
      <span className={`ponto ${classe}`} />
      <Icone size={12} /> {rotulo} <span className="mudo">· {texto}</span>
    </button>
  );
}

const estreito = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;

export default function Atendimento({ query }) {
  const toast = useToast();
  const aba = query.get('aba') || 'conversas';
  const idAtiva = Number(query.get('conversa')) || null;
  const central = useCentral();
  const { conversas, resumo, canais, aoVivo, erro, recarregar, carregarCanais, aplicarConversa, ouvirMensagens } = central;
  const [painel, setPainel] = useState(false);
  const [respostas, setRespostas] = useState([]);
  const [responsaveis, setResponsaveis] = useState([]);

  useEffect(() => {
    get('/atendimento/respostas-rapidas').then(setRespostas).catch(() => {});
    get('/atendimento/responsaveis').then(setResponsaveis).catch(() => {});
  }, []);
  useEffect(() => {
    if (resumo?.responsaveis) setResponsaveis((r) => [...new Set([...resumo.responsaveis, ...r])]);
  }, [resumo?.responsaveis]);

  const ativa = useMemo(() => (conversas || []).find((c) => c.id === idAtiva) || null, [conversas, idAtiva]);
  const abrir = (id) => definirQuery({ aba: 'conversas', conversa: id });
  const abrirDoContato = (idContato) => {
    const c = (conversas || []).find((x) => x.contato.id === idContato);
    if (c) abrir(c.id);
    else toast.info('Este contato não tem conversas.');
  };

  const canalReal = canais && (canais.telegram?.ativo || canais.email?.ativo);
  const simular = async () => {
    try {
      const r = await post('/atendimento/simular', {});
      abrir(r.id_conversa);
    } catch (e) {
      toast.erro(e.message);
    }
  };

  const abas = [
    { id: 'conversas', rotulo: 'Conversas', icone: MessagesSquare, contador: resumo?.nao_lidas || undefined },
    { id: 'kanban', rotulo: 'Kanban', icone: Columns3, contador: resumo?.abertas || undefined },
    { id: 'canais', rotulo: 'Canais', icone: PlugZap },
    { id: 'contatos', rotulo: 'Contatos', icone: Users },
  ];

  return (
    <div className="atd">
      <div className="atd-topo">
        <div className="atd-titulo">
          <div className="coluna" style={{ gap: 4 }}>
            <h1 className="com-explica">Atendimento<Explica titulo="Atendimento" {...EXPLICA.atendimento} tamanho={15} /></h1>
            <span className="cabecalho-sub pequeno">
              Telegram e e-mail num só lugar. O bot responde <span className="atd-codigo">/boletim</span>, <span className="atd-codigo">/ranking</span> e <span className="atd-codigo">/plano</span> sozinho com os números das campanhas.
            </span>
          </div>
          <div className="atd-canais-pilulas">
            {resumo && (
              <span className="pequeno sec">
                <strong style={{ color: 'var(--tinta)' }}>{fmtNumero(resumo.abertas)}</strong> abertas ·{' '}
                <strong style={{ color: 'var(--tinta)' }}>{fmtNumero(resumo.nao_lidas)}</strong> não lidas
                {resumo.paradas > 0 && <> · <strong style={{ color: 'var(--critico-texto)' }}>{resumo.paradas}</strong> paradas há +2 h</>}
              </span>
            )}
            <PilulaCanal icone={Send} rotulo="Telegram" status={canais?.telegram} aoClicar={() => definirQuery({ aba: 'canais', conversa: null })} />
            <PilulaCanal icone={Mail} rotulo="E-mail" status={canais?.email} aoClicar={() => definirQuery({ aba: 'canais', conversa: null })} />
            <span className="atd-pilula" style={{ cursor: 'default' }} title={aoVivo ? 'Recebendo em tempo real' : 'Reconectando…'}>
              <span className={`ponto ${aoVivo ? 'vivo' : 'desligado'}`} /> {aoVivo ? 'Ao vivo' : 'Reconectando'}
            </span>
            {canais && !canalReal && (
              <Botao tamanho="p" variante="fantasma" icone={FlaskConical} onClick={simular} title="Gera uma mensagem fictícia para testar a central">Simular mensagem</Botao>
            )}
          </div>
        </div>
        <Abas abas={abas} ativa={aba} aoMudar={(a) => definirQuery({ aba: a })} />
      </div>

      <div className="atd-corpo">
        {erro && !conversas ? (
          <div className="atd-rolagem"><ErroCarga erro={erro} aoTentar={recarregar} /></div>
        ) : !conversas ? (
          <div className="atd-rolagem"><Carregando altura={360} /></div>
        ) : aba === 'conversas' ? (
          <div className={`atd-conversas${painel ? ' painel-aberto' : ''}${ativa ? ' com-chat' : ''}`}>
            <ListaConversas conversas={conversas} ativa={idAtiva} aoEscolher={abrir} responsaveis={responsaveis} />
            <Chat key={ativa?.id || 'nenhuma'} conversa={ativa} ouvirMensagens={ouvirMensagens} aplicarConversa={aplicarConversa}
              aoVoltar={estreito() ? () => definirQuery({ conversa: null }) : null}
              aoAlternarPainel={() => setPainel((p) => !p)} smtpConfigurado={canais?.email?.smtp_configurado} respostas={respostas} />
            {ativa ? <PainelContato conversa={ativa} aplicarConversa={aplicarConversa} responsaveis={responsaveis} /> : <aside className="atd-painel" />}
          </div>
        ) : aba === 'kanban' ? (
          <Kanban conversas={conversas} aplicarConversa={aplicarConversa} aoAbrir={abrir} responsaveis={responsaveis} />
        ) : aba === 'canais' ? (
          <div className="atd-rolagem"><Canais canais={canais} aoMudar={() => { carregarCanais(); recarregar(); }} /></div>
        ) : (
          <div className="atd-rolagem"><Contatos aoAbrirConversa={abrirDoContato} /></div>
        )}
      </div>
    </div>
  );
}
