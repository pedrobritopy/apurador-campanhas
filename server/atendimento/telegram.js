// Canal Telegram (Bot API): long polling de getUpdates, envio de mensagens e status.
// O token vem do BotFather e fica na configuração (nunca é registrado em log).
import { lerConfig, salvarConfig } from '../db.js';
import { emitir, gravarEstado, lerEstado } from './conversas.js';
import { receberMensagem, registrarTransporte } from './entrada.js';
import { COMANDOS } from './bot.js';

const BASE = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const estado = {
  configurado: false,
  ativo: false,
  conectado: false,
  nome_bot: null,
  usuario_bot: null,
  ultimo_update_em: null,
  ultima_verificacao_em: null,
  mensagens_recebidas: 0,
  erro: null,
};

const tokenAtual = () => String(lerConfig().telegram?.token || '').trim();
const esconder = (texto, token) => (token ? String(texto).split(token).join('***') : String(texto));

async function chamar(metodo, params = {}, { token = tokenAtual(), timeoutMs = 15000 } = {}) {
  if (!token) throw new Error('Token do bot não configurado.');
  let r;
  try {
    r = await fetch(`${BASE()}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(esconder(`Falha de rede ao falar com o Telegram: ${e.message}`, token));
  }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    const e = new Error(esconder(j.description || `Telegram respondeu ${r.status}`, token));
    e.codigo = j.error_code || r.status;
    throw e;
  }
  return j.result;
}

function publicarStatus() {
  emitir('status_canal', { canal: 'telegram', ...statusTelegram() });
}

export function statusTelegram() {
  const cfg = lerConfig().telegram || {};
  return { ...estado, configurado: Boolean(String(cfg.token || '').trim()), ativo: Boolean(cfg.ativo) };
}

/** Verifica o token (getMe) e guarda o nome do bot. */
export async function testarTelegram() {
  const eu = await chamar('getMe', {}, { timeoutMs: 10000 });
  estado.nome_bot = eu.first_name;
  estado.usuario_bot = eu.username;
  estado.ultima_verificacao_em = new Date().toISOString();
  estado.erro = null;
  tokenRecusado = null;
  const cfg = lerConfig().telegram || {};
  if (cfg.nome_bot !== `@${eu.username}`) salvarConfig({ telegram: { ...cfg, nome_bot: `@${eu.username}` } });
  publicarStatus();
  return { ok: true, nome: eu.first_name, usuario: eu.username };
}

/** Envia texto a um chat. html=true usa parse_mode HTML (respostas do bot); atendentes enviam texto puro. */
export async function enviarTelegram(chatId, texto, { html = false, teclado } = {}) {
  const partes = [];
  const t = String(texto);
  for (let i = 0; i < t.length; i += 4000) partes.push(t.slice(i, i + 4000));
  let ultimo = null;
  for (const [k, parte] of partes.entries()) {
    ultimo = await chamar('sendMessage', {
      chat_id: chatId,
      text: parte,
      ...(html ? { parse_mode: 'HTML' } : {}),
      disable_web_page_preview: true,
      ...(teclado && k === partes.length - 1 ? { reply_markup: teclado } : {}),
    });
  }
  return { externo_id: ultimo ? String(ultimo.message_id) : null };
}

registrarTransporte('telegram', {
  enviar: (contato, conversa, texto, opcoes) => enviarTelegram(contato.identificador, texto, opcoes),
});

function anexosDe(msg) {
  const out = [];
  if (msg.photo?.length) out.push({ tipo: 'imagem', nome: 'foto.jpg', tamanho: msg.photo[msg.photo.length - 1].file_size });
  if (msg.document) out.push({ tipo: 'documento', nome: msg.document.file_name || 'documento', mime: msg.document.mime_type, tamanho: msg.document.file_size });
  if (msg.voice) out.push({ tipo: 'audio', nome: 'mensagem de voz', duracao: msg.voice.duration });
  if (msg.audio) out.push({ tipo: 'audio', nome: msg.audio.file_name || 'áudio', duracao: msg.audio.duration });
  if (msg.video) out.push({ tipo: 'video', nome: msg.video.file_name || 'vídeo', duracao: msg.video.duration });
  if (msg.sticker) out.push({ tipo: 'figurinha', nome: msg.sticker.emoji || 'figurinha' });
  if (msg.location) out.push({ tipo: 'localizacao', nome: `${msg.location.latitude}, ${msg.location.longitude}` });
  return out;
}

async function processarUpdate(u) {
  const msg = u.message || u.edited_message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const de = msg.from || {};
  const nome = [de.first_name, de.last_name].filter(Boolean).join(' ') || de.username || `Telegram ${msg.chat.id}`;
  const compartilhado = msg.contact && (!msg.contact.user_id || msg.contact.user_id === de.id) ? { telefone: msg.contact.phone_number } : null;
  const texto = msg.text ?? msg.caption ?? (compartilhado ? null : anexosDe(msg).length ? '' : '[mensagem não suportada]');
  await receberMensagem({
    canal: 'telegram',
    contato: { identificador: String(msg.chat.id), nome, username: de.username ? `@${de.username}` : null, telefone: compartilhado?.telefone || null },
    texto,
    anexos: anexosDe(msg),
    externo_id: String(msg.message_id),
    criado_em: new Date((msg.edit_date || msg.date) * 1000).toISOString(),
    compartilhado,
  });
  estado.mensagens_recebidas++;
  estado.ultimo_update_em = new Date().toISOString();
}

let iniciado = false;
let tokenDoLaco = null;
let tokenRecusado = null; // token que o Telegram recusou (não insiste até ser trocado)

/** Laço de long polling: lê a configuração a cada volta (liga/desliga e troca de token sem reiniciar). */
export function iniciarTelegram() {
  if (iniciado) return;
  iniciado = true;
  (async () => {
    for (;;) {
      const cfg = lerConfig().telegram || {};
      const token = String(cfg.token || '').trim();
      if (!cfg.ativo || !token || token === tokenRecusado) {
        if (estado.conectado) {
          estado.conectado = false;
          publicarStatus();
        }
        tokenDoLaco = null;
        await dormir(3000);
        continue;
      }
      try {
        if (token !== tokenDoLaco) {
          tokenDoLaco = token;
          await testarTelegram();
          await chamar('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
          await chamar('setMyCommands', { commands: COMANDOS.map((c) => ({ command: c.comando, description: c.descricao.slice(0, 250) })) }).catch(() => {});
        }
        const offset = lerEstado(`telegram_offset_${tokenDoLaco.split(':')[0]}`, 0);
        const updates = await chamar('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'edited_message'] }, { timeoutMs: 35000 });
        if (!estado.conectado || estado.erro) {
          estado.conectado = true;
          estado.erro = null;
          publicarStatus();
        }
        estado.ultima_verificacao_em = new Date().toISOString();
        for (const u of updates) {
          try {
            await processarUpdate(u);
          } catch (e) {
            console.error('[telegram] erro ao processar mensagem:', esconder(e.message, token));
          }
          gravarEstado(`telegram_offset_${tokenDoLaco.split(':')[0]}`, u.update_id + 1);
        }
      } catch (e) {
        estado.conectado = false;
        estado.erro = e.message;
        publicarStatus();
        if (e.codigo === 401 || e.codigo === 404) {
          tokenRecusado = token; // token inválido: só tenta de novo quando for trocado
          tokenDoLaco = null;
        }
        await dormir(e.codigo === 409 ? 8000 : 5000);
      }
    }
  })();
}
