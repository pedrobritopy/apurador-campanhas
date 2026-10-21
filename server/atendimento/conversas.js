// Central de atendimento: contatos, conversas (kanban) e mensagens de todos os canais
// (Telegram, e-mail e "simulado" para testes). Emite eventos para o tempo real (SSE).
import { EventEmitter } from 'node:events';
import { db, agoraISO, transacao } from '../db.js';
import { fotoVendedor } from '../participantes.js';

export const STATUS_KANBAN = ['novo', 'em_atendimento', 'aguardando', 'resolvido'];
export const CANAIS = ['telegram', 'email', 'simulado'];

db.exec(`
CREATE TABLE IF NOT EXISTS atd_contato (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canal TEXT NOT NULL,
  identificador TEXT NOT NULL,
  nome TEXT,
  username TEXT,
  telefone TEXT,
  email TEXT,
  id_vendedor INTEGER,
  id_cliente INTEGER,
  verificado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  UNIQUE (canal, identificador)
);
CREATE INDEX IF NOT EXISTS ix_atd_contato_vendedor ON atd_contato(id_vendedor);
CREATE TABLE IF NOT EXISTS atd_conversa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canal TEXT NOT NULL,
  id_contato INTEGER NOT NULL REFERENCES atd_contato(id) ON DELETE CASCADE,
  assunto TEXT,
  chave_thread TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  responsavel TEXT,
  prioridade TEXT NOT NULL DEFAULT 'normal',
  etiquetas TEXT NOT NULL DEFAULT '[]',
  nao_lidas INTEGER NOT NULL DEFAULT 0,
  ultima_mensagem_em TEXT,
  ultima_entrada_em TEXT,
  ultima_previa TEXT,
  ultima_direcao TEXT,
  criado_em TEXT NOT NULL,
  resolvido_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_atd_conversa_status ON atd_conversa(status, ultima_mensagem_em);
CREATE INDEX IF NOT EXISTS ix_atd_conversa_contato ON atd_conversa(id_contato, status);
CREATE TABLE IF NOT EXISTS atd_mensagem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_conversa INTEGER NOT NULL REFERENCES atd_conversa(id) ON DELETE CASCADE,
  direcao TEXT NOT NULL,
  canal TEXT NOT NULL,
  texto TEXT,
  html TEXT,
  anexos TEXT NOT NULL DEFAULT '[]',
  autor TEXT,
  externo_id TEXT,
  status TEXT NOT NULL,
  erro TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_atd_mensagem_conversa ON atd_mensagem(id_conversa, id);
CREATE INDEX IF NOT EXISTS ix_atd_mensagem_externo ON atd_mensagem(canal, externo_id);
CREATE TABLE IF NOT EXISTS atd_estado (chave TEXT PRIMARY KEY, valor TEXT);
`);

// ------------------------------------------------------------------ eventos (tempo real)
export const eventos = new EventEmitter();
eventos.setMaxListeners(200);
export const emitir = (tipo, dados) => eventos.emit('evento', { tipo, dados });

export function lerEstado(chave, padrao = null) {
  const r = db.prepare('SELECT valor FROM atd_estado WHERE chave = ?').get(chave);
  if (!r) return padrao;
  try {
    return JSON.parse(r.valor);
  } catch {
    return padrao;
  }
}
export function gravarEstado(chave, valor) {
  db.prepare('INSERT INTO atd_estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, JSON.stringify(valor));
}

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const linha = (r) => (r ? { ...r } : null);

// ------------------------------------------------------------------ vínculo do contato (quem é?)
const consultaVendedor = db.prepare(
  `SELECT v.id_vendedor AS id, v.nome_vendedor AS nome, v.nivel, v.telefone, v.email, v.cidade, v.estado,
          v.id_superior, g.nome_vendedor AS gerente
     FROM dm_vendedor v LEFT JOIN dm_vendedor g ON g.id_vendedor = v.id_superior WHERE v.id_vendedor = ?`,
);
const consultaCliente = db.prepare(
  `SELECT c.id_cliente AS id, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.razao_social, c.cidade, c.estado, c.segmento, c.porte,
          c.id_vendedor, v.nome_vendedor AS vendedor
     FROM dm_cliente c LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor WHERE c.id_cliente = ?`,
);

export function vinculoDe(contato) {
  if (!contato) return { tipo: null };
  if (contato.id_vendedor) {
    const v = linha(consultaVendedor.get(contato.id_vendedor));
    if (v) return { tipo: v.nivel === 'gerente' ? 'gerente' : 'vendedor', vendedor: v };
  }
  if (contato.id_cliente) {
    const c = linha(consultaCliente.get(contato.id_cliente));
    if (c) return { tipo: 'cliente', cliente: c };
  }
  return { tipo: null };
}

function formatarConversa(r) {
  if (!r) return null;
  const contato = {
    id: r.c_id,
    canal: r.c_canal,
    identificador: r.c_identificador,
    nome: r.c_nome,
    username: r.c_username,
    telefone: r.c_telefone,
    email: r.c_email,
    id_vendedor: r.c_id_vendedor,
    id_cliente: r.c_id_cliente,
    verificado: Boolean(r.c_verificado),
  };
  const v = vinculoDe(contato);
  return {
    id: r.id,
    canal: r.canal,
    assunto: r.assunto,
    status: r.status,
    responsavel: r.responsavel,
    prioridade: r.prioridade,
    etiquetas: JSON.parse(r.etiquetas || '[]'),
    nao_lidas: r.nao_lidas,
    ultima_mensagem_em: r.ultima_mensagem_em,
    ultima_entrada_em: r.ultima_entrada_em,
    ultima_previa: r.ultima_previa,
    ultima_direcao: r.ultima_direcao,
    criado_em: r.criado_em,
    resolvido_em: r.resolvido_em,
    contato,
    vinculo: { tipo: v.tipo, nome: v.vendedor?.nome || v.cliente?.nome || null, equipe: v.vendedor?.gerente || null, cidade: v.vendedor?.cidade || v.cliente?.cidade || null, foto: contato.id_vendedor ? fotoVendedor(contato.id_vendedor) : null },
  };
}

const SELECT_CONVERSA = `
  SELECT cv.*, ct.id AS c_id, ct.canal AS c_canal, ct.identificador AS c_identificador, ct.nome AS c_nome, ct.username AS c_username,
         ct.telefone AS c_telefone, ct.email AS c_email, ct.id_vendedor AS c_id_vendedor, ct.id_cliente AS c_id_cliente, ct.verificado AS c_verificado
    FROM atd_conversa cv JOIN atd_contato ct ON ct.id = cv.id_contato`;

export function obterConversa(id) {
  return formatarConversa(db.prepare(`${SELECT_CONVERSA} WHERE cv.id = ?`).get(Number(id)));
}

// ------------------------------------------------------------------ contatos
export function obterContato(id) {
  return linha(db.prepare('SELECT * FROM atd_contato WHERE id = ?').get(Number(id)));
}

export function obterOuCriarContato({ canal, identificador, nome, username, telefone, email }) {
  const ident = String(identificador);
  let c = db.prepare('SELECT * FROM atd_contato WHERE canal = ? AND identificador = ?').get(canal, ident);
  if (!c) {
    const r = db
      .prepare('INSERT INTO atd_contato (canal, identificador, nome, username, telefone, email, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(canal, ident, nome || null, username || null, telefone || null, email || null, agoraISO(), agoraISO());
    c = db.prepare('SELECT * FROM atd_contato WHERE id = ?').get(Number(r.lastInsertRowid));
  } else {
    const novo = { nome: nome || c.nome, username: username || c.username, telefone: telefone || c.telefone, email: email || c.email };
    if (novo.nome !== c.nome || novo.username !== c.username || novo.telefone !== c.telefone || novo.email !== c.email) {
      db.prepare('UPDATE atd_contato SET nome = ?, username = ?, telefone = ?, email = ?, atualizado_em = ? WHERE id = ?').run(novo.nome, novo.username, novo.telefone, novo.email, agoraISO(), c.id);
      c = db.prepare('SELECT * FROM atd_contato WHERE id = ?').get(c.id);
    }
  }
  return linha(c);
}

export function atualizarContato(id, campos) {
  const c = obterContato(id);
  if (!c) throw erro('Contato não encontrado.', 404);
  const novo = {
    nome: campos.nome !== undefined ? String(campos.nome || '').trim() || c.nome : c.nome,
    telefone: campos.telefone !== undefined ? campos.telefone || null : c.telefone,
    email: campos.email !== undefined ? campos.email || null : c.email,
    id_vendedor: campos.id_vendedor !== undefined ? (campos.id_vendedor ? Number(campos.id_vendedor) : null) : c.id_vendedor,
    id_cliente: campos.id_cliente !== undefined ? (campos.id_cliente ? Number(campos.id_cliente) : null) : c.id_cliente,
    verificado: campos.verificado !== undefined ? (campos.verificado ? 1 : 0) : c.verificado,
  };
  if (novo.id_vendedor && !consultaVendedor.get(novo.id_vendedor)) throw erro('Vendedor não encontrado.');
  if (novo.id_cliente && !consultaCliente.get(novo.id_cliente)) throw erro('Cliente não encontrado.');
  db.prepare('UPDATE atd_contato SET nome = ?, telefone = ?, email = ?, id_vendedor = ?, id_cliente = ?, verificado = ?, atualizado_em = ? WHERE id = ?').run(
    novo.nome, novo.telefone, novo.email, novo.id_vendedor, novo.id_cliente, novo.verificado, agoraISO(), c.id,
  );
  const atualizado = obterContato(c.id);
  for (const cv of db.prepare('SELECT id FROM atd_conversa WHERE id_contato = ?').all(c.id)) emitir('conversa', obterConversa(cv.id));
  return atualizado;
}

export function listarContatos({ q } = {}) {
  const linhas = db
    .prepare(
      `SELECT ct.*, (SELECT COUNT(*) FROM atd_conversa cv WHERE cv.id_contato = ct.id) AS conversas,
              (SELECT MAX(cv.ultima_mensagem_em) FROM atd_conversa cv WHERE cv.id_contato = ct.id) AS ultima_mensagem_em
         FROM atd_contato ct ORDER BY ultima_mensagem_em DESC NULLS LAST, ct.id DESC`,
    )
    .all()
    .map((c) => {
      const v = vinculoDe(c);
      return { ...c, verificado: Boolean(c.verificado), vinculo: { tipo: v.tipo, nome: v.vendedor?.nome || v.cliente?.nome || null, equipe: v.vendedor?.gerente || null } };
    });
  if (!q) return linhas;
  const n = normalizar(q);
  return linhas.filter((c) => normalizar([c.nome, c.username, c.telefone, c.email, c.identificador, c.vinculo.nome].join(' ')).includes(n));
}

// ------------------------------------------------------------------ conversas
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Conversa aberta (não resolvida) do contato no canal, ou null. */
export function conversaAberta(idContato, canal) {
  return linha(db.prepare("SELECT * FROM atd_conversa WHERE id_contato = ? AND canal = ? AND status <> 'resolvido' ORDER BY id DESC LIMIT 1").get(idContato, canal));
}

export function criarConversa({ canal, id_contato, assunto = null, chave_thread = null, status = 'novo' }) {
  const agora = agoraISO();
  const r = db
    .prepare('INSERT INTO atd_conversa (canal, id_contato, assunto, chave_thread, status, criado_em, ultima_mensagem_em, resolvido_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(canal, id_contato, assunto, chave_thread, status, agora, agora, status === 'resolvido' ? agora : null);
  return Number(r.lastInsertRowid);
}

/** Conversa do contato para uma nova mensagem: a aberta mais recente ou a última (que será reaberta), ou uma nova. */
export function conversaParaContato(contato, { assunto = null, statusNova = 'novo' } = {}) {
  // e-mail: uma conversa por assunto/encadeamento (quem chama já procurou a conversa do thread)
  if (contato.canal === 'email') return criarConversa({ canal: contato.canal, id_contato: contato.id, assunto, status: statusNova });
  const aberta = conversaAberta(contato.id, contato.canal);
  if (aberta) return aberta.id;
  // chat (Telegram): um fio por contato, como no WhatsApp — a última conversa é reaberta por nova mensagem
  const ultima = db.prepare('SELECT id FROM atd_conversa WHERE id_contato = ? AND canal = ? ORDER BY id DESC LIMIT 1').get(contato.id, contato.canal);
  if (ultima) return ultima.id;
  return criarConversa({ canal: contato.canal, id_contato: contato.id, assunto, status: statusNova });
}

const previa = (texto) => String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * Registra uma mensagem e atualiza a conversa (prévia, não lidas, reabertura).
 * @param {{ id_conversa, direcao: 'entrada'|'saida'|'sistema', canal, texto, html?, anexos?, autor?, externo_id?, status, erro?, criado_em?, automatica? }} m
 *   automatica: interação tratada pelo bot (não conta como não lida nem reabre a conversa)
 */
export function registrarMensagem(m) {
  const criado = m.criado_em || agoraISO();
  let id;
  transacao(() => {
    const r = db
      .prepare('INSERT INTO atd_mensagem (id_conversa, direcao, canal, texto, html, anexos, autor, externo_id, status, erro, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id_conversa, m.direcao, m.canal, m.texto ?? null, m.html ?? null, JSON.stringify(m.anexos || []), m.autor ?? null, m.externo_id ?? null, m.status, m.erro ?? null, criado);
    id = Number(r.lastInsertRowid);
    const cv = db.prepare('SELECT * FROM atd_conversa WHERE id = ?').get(m.id_conversa);
    const entradaHumana = m.direcao === 'entrada' && !m.automatica;
    let status = cv.status;
    if (entradaHumana && status === 'resolvido') status = 'novo';
    if (entradaHumana && status === 'aguardando') status = 'em_atendimento';
    const textoPrevia = previa(m.texto) || (m.anexos?.length ? `📎 ${m.anexos[0].nome || 'anexo'}` : '');
    // resposta automática numa conversa aberta (ex.: "recebemos sua mensagem") não muda a fila: continua esperando um humano
    if (m.status === 'bot' && status !== 'resolvido') return;
    const direcao = m.status === 'bot' ? 'bot' : m.direcao;
    db.prepare(
      `UPDATE atd_conversa SET ultima_mensagem_em = ?, ultima_previa = ?, ultima_direcao = ?, status = ?,
              nao_lidas = nao_lidas + ?, ultima_entrada_em = CASE WHEN ? THEN ? ELSE ultima_entrada_em END,
              resolvido_em = CASE WHEN ? = 'resolvido' THEN resolvido_em ELSE NULL END
        WHERE id = ?`,
    ).run(criado, textoPrevia, direcao, status, entradaHumana ? 1 : 0, entradaHumana ? 1 : 0, criado, status, m.id_conversa);
  });
  const msg = obterMensagem(id);
  emitir('mensagem', msg);
  emitir('conversa', obterConversa(m.id_conversa));
  return msg;
}

export function obterMensagem(id) {
  const r = db.prepare('SELECT * FROM atd_mensagem WHERE id = ?').get(Number(id));
  return r ? { ...r, anexos: JSON.parse(r.anexos || '[]') } : null;
}

export function atualizarMensagem(id, campos) {
  db.prepare('UPDATE atd_mensagem SET status = COALESCE(?, status), erro = ?, externo_id = COALESCE(?, externo_id) WHERE id = ?').run(campos.status ?? null, campos.erro ?? null, campos.externo_id ?? null, Number(id));
  const msg = obterMensagem(id);
  emitir('mensagem', msg);
  return msg;
}

export function listarConversas({ status, canal, responsavel, q, limite = 300 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    const lista = String(status).split(',').filter((s) => STATUS_KANBAN.includes(s));
    if (lista.length) {
      where.push(`cv.status IN (${lista.map(() => '?').join(',')})`);
      params.push(...lista);
    }
  }
  if (canal) {
    where.push('cv.canal = ?');
    params.push(String(canal));
  }
  if (responsavel === '_sem') where.push("(cv.responsavel IS NULL OR cv.responsavel = '')");
  else if (responsavel) {
    where.push('cv.responsavel = ?');
    params.push(String(responsavel));
  }
  const linhas = db
    .prepare(`${SELECT_CONVERSA} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY cv.ultima_mensagem_em DESC LIMIT ${Math.min(2000, Number(limite) || 300)}`)
    .all(...params)
    .map(formatarConversa);
  if (!q) return linhas;
  const n = normalizar(q);
  return linhas.filter((c) => normalizar([c.contato.nome, c.contato.username, c.contato.email, c.contato.telefone, c.assunto, c.ultima_previa, c.vinculo.nome, c.responsavel].join(' ')).includes(n));
}

export function mensagensDaConversa(id, { antes, limite = 60 } = {}) {
  const lim = Math.min(300, Number(limite) || 60);
  const linhas = db
    .prepare(`SELECT * FROM atd_mensagem WHERE id_conversa = ? ${antes ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ${lim + 1}`)
    .all(...(antes ? [Number(id), Number(antes)] : [Number(id)]))
    .map((r) => ({ ...r, anexos: JSON.parse(r.anexos || '[]') }));
  return { mensagens: linhas.slice(0, lim).reverse(), tem_mais: linhas.length > lim };
}

function exigirConversa(id) {
  const c = db.prepare('SELECT * FROM atd_conversa WHERE id = ?').get(Number(id));
  if (!c) throw erro('Conversa não encontrada.', 404);
  return c;
}

export function moverConversa(id, status) {
  if (!STATUS_KANBAN.includes(status)) throw erro('Situação inválida.');
  exigirConversa(id);
  db.prepare('UPDATE atd_conversa SET status = ?, resolvido_em = ? WHERE id = ?').run(status, status === 'resolvido' ? agoraISO() : null, Number(id));
  if (status === 'resolvido') db.prepare('UPDATE atd_conversa SET nao_lidas = 0 WHERE id = ?').run(Number(id));
  const c = obterConversa(id);
  emitir('conversa', c);
  return c;
}

export function atribuirConversa(id, responsavel) {
  const cv = exigirConversa(id);
  const r = String(responsavel || '').trim() || null;
  db.prepare("UPDATE atd_conversa SET responsavel = ?, status = CASE WHEN status = 'novo' AND ? IS NOT NULL THEN 'em_atendimento' ELSE status END WHERE id = ?").run(r, r, cv.id);
  const c = obterConversa(id);
  emitir('conversa', c);
  return c;
}

export function etiquetarConversa(id, etiquetas) {
  exigirConversa(id);
  const lista = [...new Set((Array.isArray(etiquetas) ? etiquetas : []).map((e) => String(e).trim()).filter(Boolean))].slice(0, 12);
  db.prepare('UPDATE atd_conversa SET etiquetas = ? WHERE id = ?').run(JSON.stringify(lista), Number(id));
  const c = obterConversa(id);
  emitir('conversa', c);
  return c;
}

export function priorizarConversa(id, prioridade) {
  exigirConversa(id);
  const p = ['baixa', 'normal', 'alta', 'urgente'].includes(prioridade) ? prioridade : 'normal';
  db.prepare('UPDATE atd_conversa SET prioridade = ? WHERE id = ?').run(p, Number(id));
  const c = obterConversa(id);
  emitir('conversa', c);
  return c;
}

export function marcarLida(id) {
  exigirConversa(id);
  db.prepare('UPDATE atd_conversa SET nao_lidas = 0 WHERE id = ?').run(Number(id));
  const c = obterConversa(id);
  emitir('conversa', c);
  return c;
}

export function resumo() {
  const porStatus = Object.fromEntries(STATUS_KANBAN.map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM atd_conversa GROUP BY status').all()) porStatus[r.status] = r.n;
  const porCanal = {};
  for (const r of db.prepare("SELECT canal, SUM(nao_lidas) AS n, COUNT(*) AS conversas FROM atd_conversa WHERE status <> 'resolvido' GROUP BY canal").all()) porCanal[r.canal] = { nao_lidas: r.n || 0, abertas: r.conversas };
  const naoLidas = db.prepare('SELECT COALESCE(SUM(nao_lidas), 0) AS n FROM atd_conversa').get().n;
  const paradas = db
    .prepare("SELECT COUNT(*) AS n FROM atd_conversa WHERE status IN ('novo','em_atendimento') AND ultima_direcao IN ('entrada','bot') AND ultima_entrada_em < ?")
    .get(new Date(Date.now() - 2 * 3600 * 1000).toISOString()).n;
  const responsaveis = db.prepare("SELECT DISTINCT responsavel FROM atd_conversa WHERE responsavel IS NOT NULL AND responsavel <> '' ORDER BY 1").all().map((r) => r.responsavel);
  return { nao_lidas: naoLidas, abertas: porStatus.novo + porStatus.em_atendimento + porStatus.aguardando, por_status: porStatus, por_canal: porCanal, paradas, responsaveis };
}

/** Remove contatos/conversas do canal simulado (limpeza de testes). */
export function limparSimulados() {
  const ids = db.prepare("SELECT id FROM atd_contato WHERE canal = 'simulado'").all().map((r) => r.id);
  transacao(() => {
    for (const id of ids) {
      const convs = db.prepare('SELECT id FROM atd_conversa WHERE id_contato = ?').all(id).map((r) => r.id);
      for (const cv of convs) db.prepare('DELETE FROM atd_mensagem WHERE id_conversa = ?').run(cv);
      db.prepare('DELETE FROM atd_conversa WHERE id_contato = ?').run(id);
      db.prepare('DELETE FROM atd_contato WHERE id = ?').run(id);
    }
  });
  emitir('recarregar', { motivo: 'simulados removidos' });
  return { contatos: ids.length };
}
