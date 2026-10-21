// =====================================================================
// Pipeline de dados (ETL interno).
//
// Tudo o que é pesado (apuração das campanhas, painel, boletins, Excel, conta corrente, planos, base de
// conhecimento...) é calculado AQUI, em segundo plano, numa thread separada, e gravado em tabelas.
// As rotas só leem o que está pronto; o front só desenha.
//
// Cada ETAPA (server/etapas/*.js) declara:
//   registrarEtapa({
//     nome: 'apuracao', descricao: 'texto curto para a tela',
//     depende: ['outra'],                         // roda depois destas (ordem topológica)
//     gatilhos: ['importacao','dia','campanha','plano','conta_corrente','config','receita'],
//     assinatura: () => string,                   // barata; se não mudou desde a última execução, a etapa é pulada
//     versao: 1,                                  // suba ao mudar regra/formato do que a etapa grava (força recálculo)
//     executar: async (ctx) => ({ linhas }),      // ctx: { eventos, escopo, forcar, pausa(), log() }
//     escopo: (evento) => qualquer,               // opcional: recorte incremental (ex.: { campanhas: [3] })
//   })
//
// Disparo: dispararPipeline('campanha', { id: 3 }). Eventos em sequência são agrupados (1,5 s) e a execução
// acontece num Worker; o servidor nunca fica bloqueado. Na inicialização só roda o que tiver assinatura nova.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread } from 'node:worker_threads';
import { db, agoraISO, RAIZ, lerConfig, aoInvalidar } from './db.js';
import { hojeISO } from './calendario.js';

db.exec(`
CREATE TABLE IF NOT EXISTS pipeline_etapa (
  nome TEXT PRIMARY KEY,
  descricao TEXT,
  depende TEXT,
  gatilhos TEXT,
  status TEXT,
  assinatura TEXT,
  inicio TEXT,
  fim TEXT,
  duracao_ms INTEGER,
  linhas INTEGER,
  erro TEXT,
  execucoes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pipeline_execucao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento TEXT,
  detalhe TEXT,
  status TEXT,
  inicio TEXT,
  fim TEXT,
  duracao_ms INTEGER,
  etapas TEXT,
  erro TEXT
);
CREATE TABLE IF NOT EXISTS dado_pronto (
  chave TEXT PRIMARY KEY,
  assinatura TEXT,
  conteudo TEXT,
  gerado_em TEXT,
  duracao_ms INTEGER
);
`);

const LIMITE_ETAPA_MS = Number(process.env.PIPELINE_LIMITE_ETAPA_MS || 20 * 60 * 1000);

export const GATILHOS = ['importacao', 'dia', 'campanha', 'plano', 'conta_corrente', 'config', 'receita', 'territorio', 'carteira'];

// ---------------------------------------------------------------- utilitários para as etapas

export const hash = (...partes) => crypto.createHash('sha1').update(partes.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('|')).digest('hex').slice(0, 20);

/** Assinatura persistente da base (não muda ao reiniciar; muda a cada importação). Barata: só MAX(rowid). */
export function assinaturaBase() {
  const imp = db.prepare('SELECT MAX(id) AS id FROM importacao').get()?.id || 0;
  const max = (t) => {
    try {
      return db.prepare(`SELECT MAX(rowid) AS m FROM ${t}`).get()?.m || 0;
    } catch {
      return 0;
    }
  };
  const cfg = lerConfig();
  const relevante = { cal: cfg.calendario, fer: cfg.feriados, ref: cfg.data_referencia, jan: cfg.janela_recente };
  return `${imp}.${max('fato_vendas')}.${max('fato_estoque')}.${max('fato_metas')}.${hash(relevante)}`;
}

/** Assinatura das campanhas (definição + situação). */
export function assinaturaCampanhas(where = "status IN ('ativa','encerrada')") {
  const linhas = db.prepare(`SELECT id, status, atualizado_em, definicao FROM campanha WHERE ${where} ORDER BY id`).all();
  return hash(linhas.map((l) => [l.id, l.status, l.atualizado_em, hash(l.definicao)]));
}

/** Resultado pronto (qualquer JSON) por chave. Devolve { conteudo, assinatura, gerado_em } ou null. */
export function lerPronto(chave) {
  const r = db.prepare('SELECT assinatura, conteudo, gerado_em, duracao_ms FROM dado_pronto WHERE chave = ?').get(chave);
  if (!r) return null;
  return { assinatura: r.assinatura, gerado_em: r.gerado_em, duracao_ms: r.duracao_ms, conteudo: JSON.parse(r.conteudo) };
}

export function gravarPronto(chave, assinatura, conteudo, duracao_ms = null) {
  db.prepare(
    'INSERT INTO dado_pronto (chave, assinatura, conteudo, gerado_em, duracao_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chave) DO UPDATE SET assinatura = excluded.assinatura, conteudo = excluded.conteudo, gerado_em = excluded.gerado_em, duracao_ms = excluded.duracao_ms',
  ).run(chave, assinatura, JSON.stringify(conteudo), agoraISO(), duracao_ms);
}

export function apagarPronto(prefixo) {
  db.prepare('DELETE FROM dado_pronto WHERE chave LIKE ?').run(`${prefixo}%`);
}

/**
 * Leitura padrão das rotas ("mostra o pronto; se ficou velho, mostra o último e manda atualizar").
 * - assinatura: a atual (barata). Se o pronto bate, devolve na hora.
 * - calcular: fallback síncrono, usado só quando não existe nada gravado ainda (primeira vez).
 * Devolve { conteudo, atualizando } .
 */
export function servirPronto(chave, { assinatura, calcular, evento = 'pronto', gravar = true }) {
  const p = lerPronto(chave);
  if (p && p.assinatura === assinatura) return { conteudo: p.conteudo, atualizando: false, gerado_em: p.gerado_em };
  if (p) {
    dispararPipeline(evento, { chave });
    return { conteudo: p.conteudo, atualizando: true, gerado_em: p.gerado_em };
  }
  const t = Date.now();
  const conteudo = calcular();
  if (gravar) gravarPronto(chave, assinatura, conteudo, Date.now() - t);
  return { conteudo, atualizando: false, gerado_em: agoraISO() };
}

// ---------------------------------------------------------------- registro

const etapas = new Map();

export function registrarEtapa(def) {
  if (!def?.nome || typeof def.executar !== 'function') throw new Error('Etapa precisa de nome e executar().');
  const e = {
    nome: def.nome,
    descricao: def.descricao || '',
    depende: def.depende || [],
    gatilhos: (def.gatilhos || []).filter((g) => GATILHOS.includes(g)),
    // `versao`: suba ao mudar a regra ou o formato do que a etapa grava; muda a assinatura e força o recálculo
    assinatura: ((f, v) => () => `v${v}|${f()}`)(def.assinatura || (() => `${assinaturaBase()}|${hojeISO()}`), def.versao ?? 1),
    executar: def.executar,
    escopo: def.escopo || null,
    ordem: def.ordem ?? 50,
  };
  etapas.set(e.nome, e);
  if (isMainThread) {
    db.prepare(
      `INSERT INTO pipeline_etapa (nome, descricao, depende, gatilhos, status) VALUES (?, ?, ?, ?, 'pendente')
       ON CONFLICT(nome) DO UPDATE SET descricao = excluded.descricao, depende = excluded.depende, gatilhos = excluded.gatilhos`,
    ).run(e.nome, e.descricao, JSON.stringify(e.depende), JSON.stringify(e.gatilhos));
  }
  return e;
}

let carregadas = null;
/** Importa server/etapas/*.js (cada arquivo chama registrarEtapa). */
export function carregarEtapas() {
  if (carregadas) return carregadas;
  carregadas = (async () => {
    const pasta = path.join(RAIZ, 'server', 'etapas');
    if (!fs.existsSync(pasta)) return etapas;
    for (const arq of fs.readdirSync(pasta).filter((f) => f.endsWith('.js')).sort()) {
      try {
        await import(pathToFileURL(path.join(pasta, arq)).href);
      } catch (e) {
        console.error(`[pipeline] etapa ${arq}:`, e.message);
      }
    }
    return etapas;
  })();
  return carregadas;
}

/** Ordem topológica (dependências antes), desempate por `ordem` e nome. */
function ordenar(nomes) {
  const alvo = new Set(nomes);
  const visto = new Set();
  const saida = [];
  const visitar = (n, pilha = new Set()) => {
    if (visto.has(n) || !etapas.has(n)) return;
    if (pilha.has(n)) throw new Error(`Ciclo de dependência na pipeline: ${[...pilha, n].join(' > ')}`);
    pilha.add(n);
    for (const d of etapas.get(n).depende) if (alvo.has(d)) visitar(d, pilha);
    pilha.delete(n);
    visto.add(n);
    saida.push(n);
  };
  [...alvo].sort((a, b) => etapas.get(a).ordem - etapas.get(b).ordem || a.localeCompare(b)).forEach((n) => visitar(n));
  return saida;
}

/** Etapas afetadas por um conjunto de eventos (gatilho direto + quem depende delas). */
function afetadas(eventos) {
  const todos = eventos.some((e) => ['inicio', 'manual', 'pronto'].includes(e));
  const sel = new Set([...etapas.values()].filter((e) => todos || e.gatilhos.some((g) => eventos.includes(g))).map((e) => e.nome));
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const e of etapas.values()) {
      if (!sel.has(e.nome) && e.depende.some((d) => sel.has(d))) {
        sel.add(e.nome);
        mudou = true;
      }
    }
  }
  return ordenar([...sel]);
}

// ---------------------------------------------------------------- execução (dentro do Worker)

const pausa = () => new Promise((r) => setImmediate(r));

/** Roda as etapas pedidas (já no Worker). Grava o andamento em pipeline_etapa. */
export async function executarEtapasAgora({ nomes = null, eventos = ['manual'], detalhes = [], forcar = false, aoAndamento } = {}) {
  await carregarEtapas();
  const lista = nomes ? ordenar(nomes) : afetadas(eventos);
  const resumo = [];
  const falhas = new Set();
  const marcar = db.prepare('UPDATE pipeline_etapa SET status = ?, inicio = COALESCE(?, inicio), fim = ?, duracao_ms = ?, linhas = ?, erro = ?, assinatura = COALESCE(?, assinatura), execucoes = execucoes + ? WHERE nome = ?');
  for (const nome of lista) {
    const e = etapas.get(nome);
    if (e.depende.some((d) => falhas.has(d))) {
      marcar.run('aguardando', null, null, null, null, 'Uma etapa anterior falhou.', null, 0, nome);
      resumo.push({ nome, status: 'aguardando' });
      continue;
    }
    let assinatura;
    try {
      assinatura = String(e.assinatura());
    } catch (err) {
      assinatura = `erro:${Date.now()}`;
    }
    const anterior = db.prepare('SELECT assinatura, status FROM pipeline_etapa WHERE nome = ?').get(nome);
    if (!forcar && anterior?.assinatura === assinatura && anterior.status === 'ok') {
      resumo.push({ nome, status: 'em_dia' });
      continue;
    }
    const inicio = Date.now();
    marcar.run('rodando', agoraISO(), null, null, null, null, null, 0, nome);
    aoAndamento?.({ nome, status: 'rodando' });
    try {
      const escopo = e.escopo ? detalhes.map((d) => e.escopo(d)).filter(Boolean) : [];
      let ultimoSinal = Date.now();
      const pausaComSinal = async () => {
        if (Date.now() - ultimoSinal > 5000) {
          ultimoSinal = Date.now();
          aoAndamento?.({ nome, status: 'vivo' });
        }
        await pausa();
      };
      const r = (await e.executar({ eventos, detalhes, escopo, forcar, pausa: pausaComSinal, log: (...a) => console.log(`[pipeline:${nome}]`, ...a) })) || {};
      const dur = Date.now() - inicio;
      // a assinatura é relida no fim: se algo mudou durante a execução, a próxima rodada pega
      marcar.run('ok', null, agoraISO(), dur, r.linhas ?? null, null, assinatura, 1, nome);
      resumo.push({ nome, status: 'ok', duracao_ms: dur, linhas: r.linhas ?? null });
      aoAndamento?.({ nome, status: 'ok', duracao_ms: dur });
    } catch (err) {
      const dur = Date.now() - inicio;
      falhas.add(nome);
      marcar.run('erro', null, agoraISO(), dur, null, String(err?.message || err).slice(0, 500), null, 1, nome);
      resumo.push({ nome, status: 'erro', erro: err?.message });
      console.error(`[pipeline] ${nome}:`, err?.message || err);
      aoAndamento?.({ nome, status: 'erro' });
    }
    await pausa();
  }
  return resumo;
}

// ---------------------------------------------------------------- fila (thread principal)

const fila = { eventos: new Set(), detalhes: [], forcar: false, timer: null };
let rodando = null;
let rodandoEtapa = null;
const ouvintesFim = new Set();

/** Chamado depois de cada execução (na thread principal), ex.: para limpar caches em memória. */
export const aoConcluirPipeline = (fn) => ouvintesFim.add(fn);

/**
 * Enfileira um evento. Nunca bloqueia: agrupa eventos por 1,5 s e roda no Worker.
 * @param {string} evento importacao|dia|campanha|plano|conta_corrente|config|receita|territorio|inicio|manual
 */
export function dispararPipeline(evento, detalhe = null, { forcar = false, atraso = 1500 } = {}) {
  if (!isMainThread) return null;
  if (process.env.PIPELINE_DESLIGADA === '1') return null;
  fila.eventos.add(evento);
  if (detalhe) fila.detalhes.push({ evento, ...detalhe });
  if (forcar) fila.forcar = true;
  if (rodando) return rodando; // ao terminar, a fila é processada de novo
  clearTimeout(fila.timer);
  fila.timer = setTimeout(processarFila, atraso);
  return null;
}

function processarFila() {
  if (rodando || !fila.eventos.size) return;
  const eventos = [...fila.eventos];
  const detalhes = fila.detalhes;
  const forcar = fila.forcar;
  fila.eventos = new Set();
  fila.detalhes = [];
  fila.forcar = false;
  const inicio = Date.now();
  const idExec = Number(
    db.prepare("INSERT INTO pipeline_execucao (evento, detalhe, status, inicio) VALUES (?, ?, 'rodando', ?)").run(eventos.join(','), JSON.stringify(detalhes).slice(0, 2000), agoraISO()).lastInsertRowid,
  );
  rodando = new Promise((resolve) => {
    const w = new Worker(new URL('./trabalhador.js', import.meta.url), { workerData: { tarefa: 'pipeline', eventos, detalhes, forcar } });
    let resumo = null;
    let erro = null;
    // vigia: etapa sem sinal de vida por LIMITE_ETAPA_MS é encerrada, para a fila nunca travar
    let vigia = null;
    const armar = () => {
      clearTimeout(vigia);
      vigia = setTimeout(() => {
        erro = `Etapa "${rodandoEtapa || '?'}" passou de ${Math.round(LIMITE_ETAPA_MS / 60000)} min sem terminar e foi interrompida.`;
        if (rodandoEtapa) db.prepare("UPDATE pipeline_etapa SET status = 'erro', erro = ?, fim = ? WHERE nome = ?").run(erro, agoraISO(), rodandoEtapa);
        w.terminate();
      }, LIMITE_ETAPA_MS);
    };
    armar();
    w.on('message', (m) => {
      armar();
      if (m?.andamento) {
        if (m.andamento.status !== 'vivo') rodandoEtapa = m.andamento.status === 'rodando' ? m.andamento.nome : null;
        if (m.andamento.status === 'rodando') console.log(`[pipeline] ${m.andamento.nome}...`);
      } else if (m?.erro) erro = m.erro;
      else if (m?.resumo) resumo = m.resumo;
    });
    w.once('error', (e) => { erro = e.message; });
    w.once('exit', (codigo) => {
      clearTimeout(vigia);
      if (!resumo && !erro && codigo !== 0) erro = `A thread da pipeline terminou com código ${codigo}.`;
      resolve({ resumo, erro });
    });
  }).then(({ resumo, erro }) => {
    const dur = Date.now() - inicio;
    db.prepare('UPDATE pipeline_execucao SET status = ?, fim = ?, duracao_ms = ?, etapas = ?, erro = ? WHERE id = ?')
      .run(erro ? 'erro' : 'ok', agoraISO(), dur, JSON.stringify(resumo || []), erro, idExec);
    db.prepare('DELETE FROM pipeline_execucao WHERE id < ?').run(idExec - 200);
    const rodou = (resumo || []).filter((r) => r.status === 'ok');
    if (rodou.length || erro) console.log(`[pipeline] ${eventos.join(',')}: ${rodou.map((r) => `${r.nome} ${r.duracao_ms}ms`).join(', ') || 'nada mudou'}${erro ? ` (erro: ${erro})` : ''} · ${dur}ms`);
    for (const fn of ouvintesFim) {
      try {
        fn({ eventos, resumo });
      } catch {
        /* ouvinte não pode derrubar a fila */
      }
    }
    rodando = null;
    rodandoEtapa = null;
    if (fila.eventos.size) fila.timer = setTimeout(processarFila, 300);
  });
}

/** Só o essencial para o indicador do topo. */
export function resumoPipeline() {
  const erros = db.prepare("SELECT COUNT(*) AS n FROM pipeline_etapa WHERE status = 'erro'").get().n;
  const descricao = rodandoEtapa ? db.prepare('SELECT descricao FROM pipeline_etapa WHERE nome = ?').get(rodandoEtapa)?.descricao : null;
  return { rodando: Boolean(rodando), etapa_atual: rodandoEtapa, descricao, pendente: fila.eventos.size > 0, erros };
}

/** Situação para a tela e para o indicador "Atualizando dados...". */
export function statusPipeline() {
  const lista = db.prepare('SELECT * FROM pipeline_etapa ORDER BY nome').all();
  const registradas = new Map([...etapas.values()].map((e) => [e.nome, e]));
  const nomes = ordenar(lista.map((l) => l.nome).filter((n) => registradas.has(n)));
  const porNome = new Map(lista.map((l) => [l.nome, l]));
  const ultima = db.prepare('SELECT * FROM pipeline_execucao ORDER BY id DESC LIMIT 1').get();
  return {
    rodando: Boolean(rodando),
    etapa_atual: rodandoEtapa,
    pendente: fila.eventos.size > 0,
    ultima_execucao: ultima ? { ...ultima, etapas: ultima.etapas ? JSON.parse(ultima.etapas) : [] } : null,
    etapas: nomes.map((n) => {
      const l = porNome.get(n);
      return {
        nome: n,
        descricao: l.descricao,
        depende: JSON.parse(l.depende || '[]'),
        gatilhos: JSON.parse(l.gatilhos || '[]'),
        status: l.status,
        inicio: l.inicio,
        fim: l.fim,
        duracao_ms: l.duracao_ms,
        linhas: l.linhas,
        erro: l.erro,
        execucoes: l.execucoes,
      };
    }),
  };
}

// ---------------------------------------------------------------- agenda (thread principal)

let diaAtual = hojeISO();
let agendaIniciada = false;
/** Inicia a pipeline: carrega etapas, roda o que mudou desde a última vez e vigia a virada do dia. */
export async function iniciarPipeline() {
  if (!isMainThread || agendaIniciada) return;
  agendaIniciada = true;
  await carregarEtapas();
  // etapas que sumiram do código saem da tela
  const nomes = [...etapas.keys()];
  if (nomes.length) db.prepare(`DELETE FROM pipeline_etapa WHERE nome NOT IN (${nomes.map(() => '?').join(',')})`).run(...nomes);
  db.prepare("UPDATE pipeline_etapa SET status = 'pendente' WHERE status = 'rodando'").run(); // execução interrompida por reinício
  aoInvalidar(() => dispararPipeline('importacao'));
  setInterval(() => {
    const hoje = hojeISO();
    if (hoje !== diaAtual) {
      diaAtual = hoje;
      dispararPipeline('dia');
    }
  }, 60000).unref();
  dispararPipeline('inicio', null, { atraso: 2000 });
}
