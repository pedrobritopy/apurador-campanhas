// Canal e-mail: leitura por IMAP (imapflow + mailparser) a cada 60 s e resposta por SMTP (nodemailer),
// mantendo o encadeamento (In-Reply-To / References / "Re:").
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { db, lerConfig } from '../db.js';
import { emitir, normalizar } from './conversas.js';
import { receberMensagem, registrarTransporte } from './entrada.js';

const estado = { configurado: false, ativo: false, conectado: false, ultima_leitura_em: null, recebidas: 0, erro: null, smtp_configurado: false };

export function statusEmail() {
  const cfg = lerConfig();
  return { ...estado, configurado: Boolean(cfg.imap?.host && cfg.imap?.usuario), ativo: Boolean(cfg.imap?.ativo), smtp_configurado: Boolean(cfg.smtp?.host) };
}
const publicarStatus = () => emitir('status_canal', { canal: 'email', ...statusEmail() });

/** Remove o que é perigoso de exibir (scripts, estilos externos, eventos); o front ainda exibe num iframe isolado. */
export function sanitizarHtml(html) {
  if (!html) return null;
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|form|noscript|template)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
    .slice(0, 300000);
}

const assuntoNormalizado = (s) => normalizar(String(s || '').replace(/^\s*((re|res|fw|fwd|enc|encaminhado)\s*:\s*)+/i, '')).trim();

/** Conversa existente para um e-mail: pelo encadeamento (In-Reply-To/References) ou pelo assunto do mesmo remetente. */
function conversaDoEmail(parsed, enderecoRemetente) {
  const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])].filter(Boolean);
  if (refs.length) {
    const r = db.prepare(`SELECT id_conversa FROM atd_mensagem WHERE canal = 'email' AND externo_id IN (${refs.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`).get(...refs);
    if (r) return r.id_conversa;
  }
  const alvo = assuntoNormalizado(parsed.subject);
  if (!alvo) return null;
  const candidatas = db
    .prepare(
      `SELECT cv.id, cv.assunto FROM atd_conversa cv JOIN atd_contato ct ON ct.id = cv.id_contato
        WHERE cv.canal = 'email' AND ct.identificador = ? AND cv.criado_em > ? ORDER BY cv.id DESC`,
    )
    .all(enderecoRemetente, new Date(Date.now() - 30 * 86400000).toISOString());
  return candidatas.find((c) => assuntoNormalizado(c.assunto) === alvo)?.id || null;
}

async function processarEmail(parsed) {
  const remetente = parsed.from?.value?.[0];
  if (!remetente?.address) return;
  const endereco = remetente.address.toLowerCase();
  const cfg = lerConfig();
  const proprios = [cfg.imap?.usuario, cfg.smtp?.usuario, cfg.smtp?.remetente].filter(Boolean).map((x) => String(x).toLowerCase());
  if (proprios.some((p) => p.includes(endereco))) return; // ignora o que nós mesmos enviamos
  if (parsed.messageId && db.prepare("SELECT 1 FROM atd_mensagem WHERE canal = 'email' AND externo_id = ?").get(parsed.messageId)) return; // já importado
  const idConversa = conversaDoEmail(parsed, endereco);
  await receberMensagem({
    canal: 'email',
    contato: { identificador: endereco, nome: remetente.name || endereco, email: endereco },
    texto: (parsed.text || '').trim() || (parsed.html ? '[mensagem em HTML]' : ''),
    html: sanitizarHtml(parsed.html || null),
    anexos: (parsed.attachments || []).map((a) => ({ tipo: 'documento', nome: a.filename || 'anexo', mime: a.contentType, tamanho: a.size })),
    externo_id: parsed.messageId || null,
    criado_em: (parsed.date || new Date()).toISOString(),
    assunto: parsed.subject || '(sem assunto)',
    idConversa: idConversa || undefined,
  });
  estado.recebidas++;
}

function clienteImap(cfg) {
  return new ImapFlow({
    host: cfg.host,
    port: Number(cfg.porta) || 993,
    secure: cfg.seguro !== false,
    auth: { user: cfg.usuario, pass: cfg.senha },
    logger: false,
    socketTimeout: 60000,
  });
}

let lendo = false;
/** Lê as mensagens não lidas da pasta configurada e marca como lidas. */
export async function lerCaixa() {
  const cfg = lerConfig().imap || {};
  if (!cfg.ativo || !cfg.host || !cfg.usuario || lendo) return { lidas: 0 };
  lendo = true;
  const cliente = clienteImap(cfg);
  let lidas = 0;
  try {
    await cliente.connect();
    const trava = await cliente.getMailboxLock(cfg.pasta || 'INBOX');
    try {
      const fontes = [];
      for await (const m of cliente.fetch({ seen: false }, { source: true, uid: true }, { uid: true })) {
        fontes.push({ uid: m.uid, source: m.source });
        if (fontes.length >= 50) break;
      }
      for (const f of fontes) {
        try {
          await processarEmail(await simpleParser(f.source));
          lidas++;
        } catch (e) {
          console.error('[email] mensagem ignorada:', e.message);
        }
      }
      if (fontes.length) await cliente.messageFlagsAdd(fontes.map((f) => f.uid), ['\\Seen'], { uid: true });
    } finally {
      trava.release();
    }
    await cliente.logout();
    estado.conectado = true;
    estado.erro = null;
  } catch (e) {
    estado.conectado = false;
    estado.erro = e.responseText || e.message;
    try {
      cliente.close();
    } catch {
      /* conexão já fechada */
    }
  } finally {
    lendo = false;
    estado.ultima_leitura_em = new Date().toISOString();
    publicarStatus();
  }
  return { lidas };
}

export async function testarEmail() {
  const cfg = lerConfig().imap || {};
  if (!cfg.host || !cfg.usuario) throw Object.assign(new Error('Preencha servidor e usuário do IMAP.'), { status: 400 });
  const cliente = clienteImap(cfg);
  try {
    await cliente.connect();
    const st = await cliente.status(cfg.pasta || 'INBOX', { messages: true, unseen: true });
    await cliente.logout();
    estado.conectado = true;
    estado.erro = null;
    publicarStatus();
    return { ok: true, mensagens: st.messages, nao_lidas: st.unseen };
  } catch (e) {
    estado.conectado = false;
    estado.erro = e.responseText || e.message;
    publicarStatus();
    throw Object.assign(new Error(`Não consegui conectar ao IMAP: ${estado.erro}`), { status: 400 });
  }
}

/** Resposta por SMTP, encadeada na conversa. */
async function enviarEmail(contato, conversa, texto) {
  const smtp = lerConfig().smtp || {};
  if (!smtp.host) throw new Error('SMTP não configurado (Configurações → Envio).');
  const destino = contato.email || contato.identificador;
  const ids = db.prepare("SELECT externo_id FROM atd_mensagem WHERE id_conversa = ? AND canal = 'email' AND externo_id IS NOT NULL ORDER BY id").all(conversa.id).map((r) => r.externo_id);
  const ultimoRecebido = db.prepare("SELECT externo_id FROM atd_mensagem WHERE id_conversa = ? AND direcao = 'entrada' AND externo_id IS NOT NULL ORDER BY id DESC LIMIT 1").get(conversa.id)?.externo_id;
  const assunto = conversa.assunto ? (/^\s*re\s*:/i.test(conversa.assunto) ? conversa.assunto : `Re: ${conversa.assunto}`) : 'Atendimento';
  const transporte = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.porta) || 587,
    secure: Boolean(smtp.seguro),
    auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.senha } : undefined,
  });
  const info = await transporte.sendMail({
    from: smtp.remetente || smtp.usuario,
    to: destino,
    subject: assunto,
    text: texto,
    ...(ultimoRecebido ? { inReplyTo: ultimoRecebido, references: ids } : {}),
  });
  return { externo_id: info.messageId || null };
}

registrarTransporte('email', { enviar: (contato, conversa, texto) => enviarEmail(contato, conversa, texto) });

let iniciado = false;
export function iniciarEmail() {
  if (iniciado) return;
  iniciado = true;
  const ciclo = () => lerCaixa().catch((e) => console.error('[email]', e.message));
  setTimeout(ciclo, 8000).unref?.();
  setInterval(ciclo, 60000).unref?.();
}

export const _teste = { processarEmail, sanitizarHtml, conversaDoEmail };
