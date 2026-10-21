// Envio de acompanhamentos (WhatsApp por link, e-mail SMTP, webhook) e agendador automático.
import nodemailer from 'nodemailer';
import { db, agoraISO, lerConfig } from './db.js';
import { apurarComCache } from './motor.js';
import { gerarMensagens, obterModelo, baseUrlPublica } from './mensagens.js';

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

function registrar(item, { canal, status, erroMsg, idCampanha, idAgendamento }) {
  const contato = canal === 'email' ? item.contato?.email : item.contato?.telefone || item.contato?.email;
  const r = db
    .prepare('INSERT INTO disparo (id_campanha, id_agendamento, canal, destinatario, contato, assunto, mensagem, status, erro, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(idCampanha ?? null, idAgendamento ?? null, canal, item.destinatario, contato || null, item.assunto || null, item.texto, status, erroMsg || null, agoraISO());
  return Number(r.lastInsertRowid);
}

let transporte = null;
let chaveTransporte = '';
function smtp() {
  const cfg = lerConfig().smtp || {};
  if (!cfg.host) return null;
  const chave = JSON.stringify(cfg);
  if (!transporte || chave !== chaveTransporte) {
    transporte = nodemailer.createTransport({
      host: cfg.host,
      port: Number(cfg.porta) || 587,
      secure: Boolean(cfg.seguro),
      auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.senha } : undefined,
    });
    chaveTransporte = chave;
  }
  return { transporte, remetente: cfg.remetente || cfg.usuario };
}

async function postarWebhook(corpo) {
  const cfg = lerConfig().webhook || {};
  if (!cfg.url) return null;
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Webhook respondeu ${r.status}`);
  return true;
}

/**
 * Envia mensagens já renderizadas por um canal.
 * WhatsApp: gera os links wa.me e registra como "pendente" (o envio é um clique no navegador).
 * E-mail/webhook sem configuração: registra como "simulado" (aparece na caixa de saída).
 */
export async function enviarMensagens(itens, { canal = 'registro', idCampanha = null, idAgendamento = null, campanhaNome = '' } = {}) {
  const out = { total: itens.length, enviados: 0, simulados: 0, pendentes: 0, erros: 0, itens: [] };
  const conta = (status) => {
    if (status === 'enviado' || status === 'registrado') out.enviados++;
    else if (status === 'simulado') out.simulados++;
    else if (status === 'pendente') out.pendentes++;
    else if (status === 'erro') out.erros++;
  };
  const mail = canal === 'email' ? smtp() : null;
  for (const it of itens) {
    let status = 'registrado';
    let erroMsg = null;
    try {
      if (canal === 'whatsapp') status = it.contato?.telefone ? 'pendente' : 'sem_contato';
      else if (canal === 'email') {
        if (!it.contato?.email) status = 'sem_contato';
        else if (!mail) status = 'simulado';
        else {
          await mail.transporte.sendMail({ from: mail.remetente, to: it.contato.email, subject: it.assunto, text: it.texto, html: it.html });
          status = 'enviado';
        }
      } else if (canal === 'webhook') {
        const ok = await postarWebhook({ campanha: campanhaNome, id_campanha: idCampanha, destinatario: it.destinatario, contato: it.contato, assunto: it.assunto, texto: it.texto, html: it.html, whatsapp_url: it.whatsapp_url });
        status = ok ? 'enviado' : 'simulado';
      }
    } catch (e) {
      status = 'erro';
      erroMsg = e.message;
    }
    if (status === 'sem_contato') erroMsg = 'Destinatário sem contato cadastrado para este canal';
    const id = registrar(it, { canal, status: status === 'sem_contato' ? 'erro' : status, erroMsg, idCampanha, idAgendamento });
    conta(status === 'sem_contato' ? 'erro' : status);
    out.itens.push({ id, chave: it.chave, destinatario: it.destinatario, status: status === 'sem_contato' ? 'erro' : status, erro: erroMsg, whatsapp_url: it.whatsapp_url });
  }
  return out;
}

export async function testarEmail(para) {
  const mail = smtp();
  if (!mail) throw erro('Configure o servidor SMTP antes de testar.');
  if (!para) throw erro('Informe um e-mail para o teste.');
  await mail.transporte.sendMail({ from: mail.remetente, to: para, subject: 'Teste do Apurador de Campanhas', text: 'Se você recebeu esta mensagem, o envio de e-mails está funcionando.' });
  return { ok: true };
}

export async function testarWebhook() {
  if (!lerConfig().webhook?.url) throw erro('Configure a URL do webhook antes de testar.');
  await postarWebhook({ teste: true, mensagem: 'Teste do Apurador de Campanhas', criado_em: agoraISO() });
  return { ok: true };
}

// ------------------------------------------------------------------ agendador

const DIAS = [0, 1, 2, 3, 4, 5, 6];
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function proximaExecucao(ag, de = new Date()) {
  if (!ag.ativo) return null;
  const dias = String(ag.dias_semana || '').split(',').map(Number).filter((d) => DIAS.includes(d));
  if (!dias.length) return null;
  const [h, m] = String(ag.hora || '08:00').split(':').map(Number);
  for (let k = 0; k <= 7; k++) {
    const d = new Date(de);
    d.setDate(d.getDate() + k);
    d.setHours(h || 0, m || 0, 0, 0);
    if (dias.includes(d.getDay()) && d > de) return d.toISOString();
  }
  return null;
}

function devida(ag, agora = new Date()) {
  if (!ag.ativo) return false;
  const dias = String(ag.dias_semana || '').split(',').map(Number);
  if (!dias.includes(agora.getDay())) return false;
  const [h, m] = String(ag.hora || '08:00').split(':').map(Number);
  const alvo = new Date(agora);
  alvo.setHours(h || 0, m || 0, 0, 0);
  if (agora < alvo) return false;
  if (!ag.ultima_execucao) return true;
  return new Date(ag.ultima_execucao) < alvo;
}

/** Executa um agendamento agora (para todas as campanhas ativas em andamento, ou uma específica). */
export async function executarAgendamento(id) {
  const ag = db.prepare('SELECT * FROM agendamento WHERE id = ?').get(Number(id));
  if (!ag) throw erro('Agendamento não encontrado.', 404);
  const modelo = obterModelo(ag.id_modelo);
  if (!modelo) throw erro('O modelo de mensagem deste agendamento foi excluído.');
  const campanhas = ag.id_campanha
    ? db.prepare('SELECT * FROM campanha WHERE id = ?').all(ag.id_campanha)
    : db.prepare("SELECT * FROM campanha WHERE status = 'ativa'").all();
  const resultado = { campanhas: 0, total: 0, enviados: 0, simulados: 0, pendentes: 0, erros: 0 };
  for (const camp of campanhas) {
    const definicao = JSON.parse(camp.definicao);
    const r = apurarComCache(definicao);
    if (r.tempo.status !== 'andamento' && ag.id_campanha == null) continue;
    const itens = gerarMensagens({ ...camp, definicao }, r, {
      destino: modelo.destino,
      filtro: ag.filtro,
      corpo: modelo.corpo,
      assunto: modelo.assunto,
      baseUrl: baseUrlPublica(),
      lista: ag.lista || undefined,
    });
    // WhatsApp não envia sozinho (precisa de clique); no automático vira registro com o link pronto.
    const canal = ag.canal === 'whatsapp' ? 'whatsapp' : ag.canal;
    const env = await enviarMensagens(itens, { canal, idCampanha: camp.id, idAgendamento: ag.id, campanhaNome: camp.nome });
    resultado.campanhas++;
    for (const k of ['total', 'enviados', 'simulados', 'pendentes', 'erros']) resultado[k] += env[k];
  }
  db.prepare('UPDATE agendamento SET ultima_execucao = ? WHERE id = ?').run(agoraISO(), ag.id);
  return resultado;
}

let timer = null;
let rodando = false;
export function iniciarAgendador() {
  if (timer) return;
  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const agora = new Date();
      for (const ag of db.prepare('SELECT * FROM agendamento WHERE ativo = 1').all()) {
        if (devida(ag, agora)) {
          try {
            const r = await executarAgendamento(ag.id);
            console.log(`[agendador] "${ag.nome}": ${r.total} mensagens (${r.enviados} enviadas, ${r.simulados} simuladas, ${r.pendentes} WhatsApp pendentes, ${r.erros} erros)`);
          } catch (e) {
            console.error(`[agendador] "${ag.nome}":`, e.message);
            db.prepare('UPDATE agendamento SET ultima_execucao = ? WHERE id = ?').run(agoraISO(), ag.id);
          }
        }
      }
    } finally {
      rodando = false;
    }
  };
  timer = setInterval(ciclo, 60 * 1000);
  timer.unref?.();
  setTimeout(ciclo, 5000).unref?.();
}

export const hojeLocal = () => isoLocal(new Date());
