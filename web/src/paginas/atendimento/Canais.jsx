import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, FlaskConical, Inbox, Mail, PlugZap, RefreshCw, Save, Send, Trash2, UserPlus, XCircle } from 'lucide-react';
import { del, get, post, put } from '../../lib/api.js';
import { fmtNumero, fmtRelativo } from '../../lib/formato.js';
import { Alternador, Aviso, Botao, Cartao, Campo, Carregando, Entrada, EntradaNumero, Selo, useToast } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';

const MASCARA = '••••••••';

function Situacao({ ok, ligado, erro, rotuloOk = 'Conectado', rotuloDesligado = 'Desligado' }) {
  if (!ligado) return <Selo cor="neutro">{rotuloDesligado}</Selo>;
  if (erro) return <Selo cor="critico" icone={XCircle} title={erro}>Com erro</Selo>;
  if (ok) return <Selo cor="bom" icone={CheckCircle2}>{rotuloOk}</Selo>;
  return <Selo cor="aviso">Conectando…</Selo>;
}

function Telegram({ cfg, status, aoSalvo }) {
  const toast = useToast();
  const [token, setToken] = useState(cfg.token || '');
  const [ativo, setAtivo] = useState(Boolean(cfg.ativo));
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const salvar = async (extra = {}) => {
    setSalvando(true);
    try {
      await put('/config', { telegram: { ...cfg, token, ativo, ...extra } });
      toast.ok(ativo || extra.ativo ? 'Telegram salvo. Conectando…' : 'Telegram salvo');
      aoSalvo();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };
  const testar = async () => {
    setTestando(true);
    try {
      if (token !== cfg.token) await put('/config', { telegram: { ...cfg, token, ativo } });
      const r = await post('/atendimento/canais/telegram/testar');
      toast.ok(`Token válido: ${r.nome} (@${r.usuario})`);
      aoSalvo();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setTestando(false);
    }
  };
  const usuario = status?.usuario_bot || String(cfg.nome_bot || '').replace(/^@/, '');
  return (
    <Cartao titulo={<span className="linha g4"><Send size={16} style={{ color: 'var(--s1)' }} /> Bot do Telegram</span>}
      subtitulo="Vendedores conversam com o bot; comandos são respondidos sozinhos e o resto cai no kanban."
      info={{ titulo: 'Bot do Telegram', texto: 'O bot é a conta do Telegram que conversa com os vendedores em nome da empresa.', como: ['No Telegram, fale com @BotFather e mande /newbot.', 'Escolha um nome e um usuário terminado em "bot".', 'Copie o token que o BotFather devolve e cole aqui.', 'Ligue "Receber mensagens", salve e clique em Testar.'], exemplo: 'Token parece com 123456789:AAH...' }}
      acoes={<Situacao ligado={status?.ativo} ok={status?.conectado} erro={status?.erro} />}>
      <div className="grade-2" style={{ alignItems: 'start' }}>
        <div className="coluna g12">
          <ol className="atd-passos">
            <li>No Telegram, abra o <strong>@BotFather</strong> e envie <code>/newbot</code>.</li>
            <li>Escolha um nome (ex.: “Campanhas Minha Distribuidora”) e um usuário terminado em <code>bot</code>.</li>
            <li>Copie o <strong>token</strong> que o BotFather responder e cole ao lado.</li>
            <li>Ative, salve e clique em <strong>Testar</strong>.</li>
            <li>Divulgue o link do bot aos vendedores: ao tocarem em <em>Iniciar</em>, o bot pede o telefone e os identifica pelo cadastro.</li>
          </ol>
          {usuario && (
            <Aviso tipo="ok" titulo={`Seu bot: @${usuario}`}>
              Link para os vendedores: <a href={`https://t.me/${usuario}`} target="_blank" rel="noopener noreferrer">t.me/{usuario}</a>
            </Aviso>
          )}
        </div>
        <div className="coluna g12">
          <Campo rotulo="Token do bot" ajuda={cfg.token === MASCARA ? 'Token salvo (oculto). Cole um novo para trocar.' : 'Formato: 123456789:AA…'}>
            <Entrada type="password" autoComplete="off" placeholder="Cole o token do BotFather" value={token} onChange={(e) => setToken(e.target.value.trim())} />
          </Campo>
          <Alternador ligado={ativo} aoMudar={setAtivo} rotulo="Receber mensagens do Telegram" descricao="Liga a leitura contínua (long polling). Não precisa de servidor público." />
          <div className="linha">
            <Botao variante="primario" icone={Save} carregando={salvando} onClick={() => salvar()}>Salvar</Botao>
            <Botao icone={PlugZap} carregando={testando} disabled={!token} onClick={testar}>Testar</Botao>
          </div>
          {status && (
            <div className="coluna" style={{ gap: 4 }}>
              {status.erro && <Aviso tipo="erro">{status.erro}</Aviso>}
              <div className="atd-status-linha mudo">Mensagens recebidas nesta sessão: <strong style={{ color: 'var(--tinta)' }}>{fmtNumero(status.mensagens_recebidas || 0)}</strong></div>
              {status.ultimo_update_em && <div className="atd-status-linha mudo">Última mensagem: {fmtRelativo(status.ultimo_update_em)}</div>}
              {status.ultima_verificacao_em && <div className="atd-status-linha mudo">Última verificação: {fmtRelativo(status.ultima_verificacao_em)}</div>}
            </div>
          )}
        </div>
      </div>
    </Cartao>
  );
}

function Email({ cfg, smtp, status, aoSalvo }) {
  const toast = useToast();
  const [f, setF] = useState({ host: '', porta: 993, seguro: true, usuario: '', senha: '', pasta: 'INBOX', ativo: false, ...cfg });
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const muda = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async () => {
    setSalvando(true);
    try {
      await put('/config', { imap: f });
      toast.ok('E-mail salvo');
      aoSalvo();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };
  const testar = async () => {
    setTestando(true);
    try {
      await put('/config', { imap: f });
      const r = await post('/atendimento/canais/email/testar');
      toast.ok(`Conectado: ${fmtNumero(r.mensagens)} mensagens, ${fmtNumero(r.nao_lidas)} não lidas`);
      aoSalvo();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setTestando(false);
    }
  };
  const lerAgora = async () => {
    setLendo(true);
    try {
      const r = await post('/atendimento/canais/email/ler');
      toast.ok(r.lidas ? `${r.lidas} e-mail(s) novo(s)` : 'Nenhum e-mail novo');
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setLendo(false);
    }
  };
  return (
    <Cartao titulo={<span className="linha g4"><Mail size={16} style={{ color: 'var(--s2)' }} /> E-mail</span>}
      subtitulo="Lê a caixa de entrada por IMAP a cada minuto; as respostas saem pelo SMTP de Configurações › Envio, no mesmo fio."
      info={{ titulo: 'Caixa de e-mail', texto: 'A central lê os e-mails que chegam numa caixa (IMAP) e mostra como conversas. As respostas saem pelo e-mail configurado em Configurações › Envio.', como: ['Informe servidor, porta, usuário e senha da caixa.', 'No Gmail ou Outlook, gere uma "senha de app" e use ela aqui.', 'Salve e use Testar para conferir.'], exemplo: 'Gmail: servidor imap.gmail.com, porta 993.' }}
      acoes={<Situacao ligado={status?.ativo} ok={status?.conectado} erro={status?.erro} />}>
      <div className="grade-2" style={{ alignItems: 'start' }}>
        <div className="coluna g12">
          <div className="grade-2" style={{ gridTemplateColumns: '1fr 110px' }}>
            <Campo rotulo="Servidor IMAP"><Entrada placeholder="imap.gmail.com" value={f.host} onChange={(e) => muda('host')(e.target.value.trim())} /></Campo>
            <Campo rotulo="Porta"><EntradaNumero valor={f.porta} aoMudar={muda('porta')} /></Campo>
          </div>
          <Campo rotulo="Usuário"><Entrada autoComplete="off" placeholder="atendimento@empresa.com.br" value={f.usuario} onChange={(e) => muda('usuario')(e.target.value.trim())} /></Campo>
          <Campo rotulo="Senha" ajuda="No Gmail/Outlook use uma senha de app."><Entrada type="password" autoComplete="new-password" value={f.senha} onChange={(e) => muda('senha')(e.target.value)} /></Campo>
          <div className="grade-2">
            <Campo rotulo="Pasta"><Entrada value={f.pasta} onChange={(e) => muda('pasta')(e.target.value)} /></Campo>
            <div style={{ paddingTop: 26 }}><Alternador ligado={f.seguro} aoMudar={muda('seguro')} rotulo="Conexão segura (TLS)" /></div>
          </div>
        </div>
        <div className="coluna g12">
          <Alternador ligado={f.ativo} aoMudar={muda('ativo')} rotulo="Ler a caixa automaticamente" descricao="Verifica e-mails não lidos a cada 60 segundos e os marca como lidos." />
          <div className="linha quebra">
            <Botao variante="primario" icone={Save} carregando={salvando} onClick={salvar}>Salvar</Botao>
            <Botao icone={PlugZap} carregando={testando} disabled={!f.host || !f.usuario} onClick={testar}>Testar</Botao>
            <Botao icone={RefreshCw} carregando={lendo} disabled={!status?.ativo} onClick={lerAgora}>Ler agora</Botao>
          </div>
          {status?.erro && <Aviso tipo="erro">{status.erro}</Aviso>}
          {status?.ultima_leitura_em && <div className="atd-status-linha mudo">Última leitura: {fmtRelativo(status.ultima_leitura_em)} · {fmtNumero(status.recebidas || 0)} recebidos nesta sessão</div>}
          {smtp?.host
            ? <Aviso tipo="ok" titulo="SMTP configurado">Respostas sairão por {smtp.host} como {smtp.remetente || smtp.usuario}.</Aviso>
            : <Aviso tipo="aviso" titulo="SMTP não configurado">Para responder e-mails pela central, configure o envio em <a href="#/config?aba=envio">Configurações → Envio</a>.</Aviso>}
        </div>
      </div>
    </Cartao>
  );
}

function Simulacao({ canais, aoMudar }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(null);
  const simular = async (corpo, rotulo) => {
    setOcupado(rotulo);
    try {
      await post('/atendimento/simular', corpo);
      toast.ok('Mensagem simulada recebida');
      aoMudar();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setOcupado(null);
    }
  };
  const limpar = async () => {
    setOcupado('limpar');
    try {
      const r = await del('/atendimento/simulados');
      toast.ok(`${r.contatos} contato(s) simulado(s) removido(s)`);
      aoMudar();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setOcupado(null);
    }
  };
  return (
    <Cartao titulo={<span className="linha g4"><FlaskConical size={16} style={{ color: 'var(--s7)' }} /> Simulação</span>}
      subtitulo="Para conhecer a central sem configurar canais: gera mensagens fictícias no canal “Simulado” (o bot responde de verdade, com os dados das campanhas).">
      <div className="linha quebra">
        <Botao icone={UserPlus} carregando={ocupado === 'v'} onClick={() => simular({}, 'v')}>Mensagem de um vendedor</Botao>
        <Botao icone={Bot} carregando={ocupado === 'b'} onClick={() => simular({ texto: '/boletim' }, 'b')}>Vendedor pede /boletim</Botao>
        <Botao icone={Inbox} carregando={ocupado === 'd'} onClick={() => simular({ desconhecido: true, texto: 'Olá, gostaria de ser atendido.' }, 'd')}>Contato desconhecido</Botao>
        <Botao variante="perigo" icone={Trash2} carregando={ocupado === 'limpar'} disabled={!canais?.simulacao?.contatos} onClick={limpar}>
          Limpar simulações{canais?.simulacao?.contatos ? ` (${canais.simulacao.contatos})` : ''}
        </Botao>
      </div>
    </Cartao>
  );
}

export default function Canais({ canais, aoMudar }) {
  const [cfg, setCfg] = useState(null);
  const carregar = () => get('/config').then(setCfg).catch(() => setCfg({}));
  useEffect(() => {
    carregar();
  }, []);
  const salvo = () => {
    carregar();
    aoMudar();
  };
  if (!cfg) return <Carregando altura={300} />;
  return (
    <div className="coluna g16" style={{ maxWidth: 1180 }}>
      <Telegram cfg={cfg.telegram || {}} status={canais?.telegram} aoSalvo={salvo} />
      <Email cfg={cfg.imap || {}} smtp={cfg.smtp} status={canais?.email} aoSalvo={salvo} />
      {canais?.comandos && (
        <Cartao titulo="Comandos do bot" subtitulo="Respondidos automaticamente para vendedores identificados, com os dados da apuração ao vivo." info={EXPLICA.identificacao}>
          <div className="grade-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {canais.comandos.map((c) => (
              <div key={c.comando} className="linha-topo" style={{ gap: 8 }}>
                <span className="atd-codigo">/{c.comando}</span>
                <span className="pequeno sec">{c.descricao}</span>
              </div>
            ))}
          </div>
        </Cartao>
      )}
      <Simulacao canais={canais} aoMudar={aoMudar} />
    </div>
  );
}
