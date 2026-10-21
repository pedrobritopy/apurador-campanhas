import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABELAS_DADOS, ESQUEMA_APP } from './esquema.js';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA_DADOS = process.env.PASTA_DADOS || path.join(RAIZ, 'dados');
const PASTA_VAR = path.join(RAIZ, 'var');
fs.mkdirSync(PASTA_VAR, { recursive: true });

export const db = new DatabaseSync(process.env.BANCO || path.join(PASTA_VAR, 'apurador.db'));
db.exec(`
  PRAGMA busy_timeout = 60000;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -64000;
`);

export function criarTabelaDados(nome) {
  const t = TABELAS_DADOS[nome];
  const cols = Object.entries(t.colunas)
    .map(([c, tipo]) => `${c} ${tipo === 'BOOL' ? 'INTEGER' : tipo}${c === t.pk ? ' PRIMARY KEY' : ''}`)
    .join(', ');
  db.exec(`CREATE TABLE IF NOT EXISTS ${nome} (${cols})`);
  for (const idx of t.indices || []) {
    const sufixo = idx.replace(/[^a-z_]+/gi, '_');
    db.exec(`CREATE INDEX IF NOT EXISTS ix_${nome}_${sufixo} ON ${nome}(${idx})`);
  }
}

for (const nome of Object.keys(TABELAS_DADOS)) criarTabelaDados(nome);
db.exec(ESQUEMA_APP);

export const agoraISO = () => new Date().toISOString();

export function transacao(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- configuração ----------

export const CONFIG_PADRAO = {
  nome_empresa: 'Minha Distribuidora',
  calendario: 'uteis', // 'uteis' (seg-sex menos feriados) | 'corridos'
  feriados: null, // null = feriados nacionais calculados automaticamente
  data_referencia: 'auto', // 'auto' = último dia com vendas (limitado a hoje) | 'AAAA-MM-DD'
  smtp: { host: '', porta: 587, seguro: false, usuario: '', senha: '', remetente: '' },
  webhook: { url: '', token: '' },
  destinatarios_gerais: '',
  url_publica: '', // endereço usado nos links dos boletins (ex.: http://servidor:3000). Vazio = localhost.
  janela_recente: 7,
  // Atendimento: bot do Telegram (token do BotFather) e caixa de entrada de e-mail (IMAP).
  telegram: { token: '', ativo: false, nome_bot: '' },
  imap: { host: '', porta: 993, seguro: true, usuario: '', senha: '', pasta: 'INBOX', ativo: false },
  // IA (Anthropic). A chave fica só no .env (ANTHROPIC_API_KEY); aqui ficam limites e preferências.
  ia: { habilitada: true, modelo: 'claude-haiku-5-5', limite_diario_usd: 5, esforco: 'low' },
};

export function lerConfig() {
  const out = structuredClone(CONFIG_PADRAO);
  for (const { chave, valor } of db.prepare('SELECT chave, valor FROM config').all()) {
    try { out[chave] = JSON.parse(valor); } catch { /* valor inválido: mantém padrão */ }
  }
  return out;
}

export function salvarConfig(parcial) {
  const st = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  transacao(() => {
    for (const [k, v] of Object.entries(parcial)) {
      if (k in CONFIG_PADRAO) st.run(k, JSON.stringify(v));
    }
  });
  invalidarCache();
}

// ---------- versão dos dados (invalida caches de apuração) ----------

let versao = 1;
const ouvintes = new Set();
export const versaoDados = () => versao;
export function invalidarCache() {
  versao++;
  for (const fn of ouvintes) fn(versao);
}
export const aoInvalidar = (fn) => ouvintes.add(fn);

export function contarLinhas(tabela) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get().n;
}
