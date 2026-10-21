import { useEffect, useState } from 'react';
import { Mail, MessageCircle, Save, Send, Webhook } from 'lucide-react';
import { post } from '../../lib/api.js';
import { Alternador, AreaTexto, Aviso, Botao, Campo, Cartao, Entrada, EntradaNumero, useToast } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';

// Senhas/tokens chegam mascarados. Se o usuário não mexer, devolvemos o mesmo valor mascarado
// (o servidor mantém o segredo atual ao receber a máscara).

export default function ConfigEnvio({ config, aoSalvar }) {
  const toast = useToast();
  const smtp0 = () => ({ host: '', porta: 587, seguro: false, usuario: '', senha: '', remetente: '', ...(config.smtp || {}) });
  const web0 = () => ({ url: '', token: '', ...(config.webhook || {}) });
  const [smtp, setSmtp] = useState(smtp0);
  const [webhook, setWebhook] = useState(web0);
  const [dest, setDest] = useState(config.destinatarios_gerais || '');
  const [url, setUrl] = useState(config.url_publica || '');
  const [salvando, setSalvando] = useState(null);
  const [para, setPara] = useState('');
  const [testando, setTestando] = useState(null);

  useEffect(() => {
    setSmtp(smtp0());
    setWebhook(web0());
    setDest(config.destinatarios_gerais || '');
    setUrl(config.url_publica || '');
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const sujoSmtp = JSON.stringify(smtp) !== JSON.stringify(smtp0());
  const sujoWeb = JSON.stringify(webhook) !== JSON.stringify(web0());
  const sujoDest = dest !== (config.destinatarios_gerais || '');
  const sujoUrl = url !== (config.url_publica || '');

  async function salvar(qual, parcial) {
    setSalvando(qual);
    try {
      await aoSalvar(parcial);
    } finally {
      setSalvando(null);
    }
  }

  async function testarEmail() {
    if (!para.trim()) return toast.erro('Informe um e-mail para o teste.');
    setTestando('email');
    try {
      const r = await post('/config/testar-email', { para: para.trim() });
      toast.ok(r?.mensagem || `E-mail de teste enviado para ${para.trim()}`);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setTestando(null);
    }
  }

  async function testarWebhook() {
    setTestando('webhook');
    try {
      const r = await post('/config/testar-webhook');
      toast.ok(r?.mensagem || `Webhook respondeu${r?.status ? ` ${r.status}` : ''}`);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setTestando(null);
    }
  }

  return (
    <div className="config-grade">
      <Cartao titulo="E-mail (SMTP)" subtitulo="Usado nos disparos e agendamentos por e-mail" info={{ ...EXPLICA.configEnvio, exemplo: 'Gmail: servidor smtp.gmail.com, porta 587, usuário o e-mail e senha de app.' }}
        acoes={<span className="linha g4 mini mudo"><Mail size={13} /> {config.smtp?.host ? 'configurado' : 'não configurado: e-mails ficam simulados'}</span>}>
        <div className="config-form">
          <div className="config-linha-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 120px' }}>
            <Campo rotulo="Servidor"><Entrada value={smtp.host} placeholder="smtp.suaempresa.com.br" onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} /></Campo>
            <Campo rotulo="Porta"><EntradaNumero valor={smtp.porta} aoMudar={(v) => setSmtp({ ...smtp, porta: v ?? 587 })} /></Campo>
          </div>
          <div className="config-linha-2">
            <Campo rotulo="Usuário"><Entrada value={smtp.usuario} autoComplete="off" onChange={(e) => setSmtp({ ...smtp, usuario: e.target.value })} /></Campo>
            <Campo rotulo="Senha"><Entrada type="password" value={smtp.senha} autoComplete="new-password" onChange={(e) => setSmtp({ ...smtp, senha: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Remetente" ajuda='Ex.: "Campanhas Comerciais <campanhas@suaempresa.com.br>"'>
            <Entrada value={smtp.remetente} onChange={(e) => setSmtp({ ...smtp, remetente: e.target.value })} />
          </Campo>
          <Alternador ligado={Boolean(smtp.seguro)} aoMudar={(v) => setSmtp({ ...smtp, seguro: v })} rotulo="Conexão segura (SSL/TLS)" descricao="Normalmente ligado na porta 465." />
          <div className="config-rodape">
            {sujoSmtp && <span className="sujo">● Não salvo</span>}
            <Botao variante="primario" icone={Save} disabled={!sujoSmtp} carregando={salvando === 'smtp'} onClick={() => salvar('smtp', { smtp })}>Salvar SMTP</Botao>
          </div>
          <div className="separador" />
          <div className="linha" style={{ gap: 8 }}>
            <Entrada placeholder="seu@email.com" value={para} onChange={(e) => setPara(e.target.value)} />
            <Botao icone={Send} carregando={testando === 'email'} onClick={testarEmail} disabled={sujoSmtp}>Enviar teste</Botao>
          </div>
          {sujoSmtp && <span className="mini mudo">Salve antes de testar.</span>}
        </div>
      </Cartao>

      <div className="coluna" style={{ gap: 16 }}>
        <Cartao titulo="Webhook" subtitulo="Integra com WhatsApp Business API, Teams, Slack ou n8n" info={EXPLICA.webhook}
          acoes={<Webhook size={15} className="mudo" />}>
          <div className="config-form">
            <Campo rotulo="URL" ajuda="Cada mensagem é enviada em um POST JSON com campanha, destinatário, contato e texto.">
              <Entrada value={webhook.url} placeholder="https://…" onChange={(e) => setWebhook({ ...webhook, url: e.target.value })} />
            </Campo>
            <Campo rotulo="Token (opcional)" ajuda="Enviado no cabeçalho Authorization: Bearer.">
              <Entrada type="password" value={webhook.token} autoComplete="new-password" onChange={(e) => setWebhook({ ...webhook, token: e.target.value })} />
            </Campo>
            <div className="config-rodape">
              {sujoWeb && <span className="sujo">● Não salvo</span>}
              <Botao icone={Send} carregando={testando === 'webhook'} disabled={sujoWeb || !webhook.url} onClick={testarWebhook}>Testar</Botao>
              <Botao variante="primario" icone={Save} disabled={!sujoWeb} carregando={salvando === 'webhook'} onClick={() => salvar('webhook', { webhook })}>Salvar</Botao>
            </div>
          </div>
        </Cartao>
        <Cartao titulo="Destinatários do resumo geral" subtitulo="Diretoria, trade marketing, fornecedor…" info={{ texto: 'Quem recebe o resumo da campanha quando o disparo é para "Geral" (diretoria). Separe os e-mails por vírgula.' }}>
          <div className="config-form">
            <AreaTexto rows={3} style={{ minHeight: 70 }} value={dest} placeholder="diretoria@empresa.com, trade@empresa.com" onChange={(e) => setDest(e.target.value)} />
            <div className="config-rodape">
              {sujoDest && <span className="sujo">● Não salvo</span>}
              <Botao variante="primario" icone={Save} disabled={!sujoDest} carregando={salvando === 'dest'} onClick={() => salvar('dest', { destinatarios_gerais: dest })}>Salvar</Botao>
            </div>
          </div>
        </Cartao>
        <Cartao titulo="Endereço do sistema nos links" subtitulo="Usado nos links de boletim enviados nas mensagens" info={EXPLICA.enderecoPublico}>
          <div className="config-form">
            <Campo rotulo="Endereço público" ajuda="Ex.: http://192.168.0.10:3210, para os vendedores abrirem o boletim fora deste computador. Vazio = localhost.">
              <Entrada value={url} placeholder="http://servidor:3000" onChange={(e) => setUrl(e.target.value)} />
            </Campo>
            <div className="config-rodape">
              {sujoUrl && <span className="sujo">● Não salvo</span>}
              <Botao variante="primario" icone={Save} disabled={!sujoUrl} carregando={salvando === 'url'} onClick={() => salvar('url', { url_publica: url.trim().replace(/\/+$/, '') })}>Salvar</Botao>
            </div>
          </div>
        </Cartao>
        <Aviso tipo="info" titulo="WhatsApp não precisa de configuração">
          <span className="linha g4" style={{ display: 'inline-flex' }}><MessageCircle size={13} /></span> O disparo por WhatsApp gera links prontos (wa.me) com o telefone do vendedor. Para envio 100% automático, use o webhook com um provedor da API oficial.
        </Aviso>
      </div>
    </div>
  );
}
