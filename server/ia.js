import Anthropic from '@anthropic-ai/sdk';
import { db, agoraISO, lerConfig, CONFIG_PADRAO } from './db.js';
import { fatosParaAnalise, recuperarFatos, assinaturaFatos, garantirConhecimento, listarFatos } from './conhecimento.js';
import { gerarPlano } from './planos.js';
import { normalizarTexto } from './perfil.js';

// =====================================================================
// IA (Anthropic · Claude Haiku 5.5) com custo sob controle:
//  - só é chamada quando o usuário pede; análises são reaproveitadas enquanto os fatos não mudam;
//  - teto diário em US$ (config ia.limite_diario_usd) checado ANTES de cada chamada, pelo pior caso;
//  - recebe apenas fatos prontos e validados (nada de dados brutos, nada de cálculo);
//  - a resposta é conferida: citações precisam existir e os números precisam aparecer nos fatos citados.
// =====================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS uso_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  referencia TEXT,
  modelo TEXT,
  tokens_entrada INTEGER, tokens_saida INTEGER, tokens_cache_leitura INTEGER, tokens_cache_escrita INTEGER,
  custo_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  erro TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_uso_ia_data ON uso_ia(criado_em);
CREATE TABLE IF NOT EXISTS analise_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  referencia TEXT,
  assinatura TEXT NOT NULL,
  resultado TEXT NOT NULL,
  fatos TEXT,
  verificacao TEXT,
  custo_usd REAL,
  simulada INTEGER DEFAULT 0,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_analise_ref ON analise_ia(tipo, referencia, criado_em);
`);

// US$ por milhão de tokens (prompts até 100 mil tokens). Modelo desconhecido: assume o mais caro (conservador).
const PRECOS = {
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, longo: { entrada: 0.5, saida: 2.5 } },
  'claude-sonnet-5-5': { entrada: 2, saida: 10 },
  'claude-opus-5-5': { entrada: 4, saida: 20 },
};
const PRECO_PADRAO = { entrada: 10, saida: 50 };

const MAX_TOKENS = { analise: 6000, chat: 4000, roteiro: 5000 };

const simulada = () => process.env.IA_SIMULADA === '1';

function configIa() {
  return { ...CONFIG_PADRAO.ia, ...(lerConfig().ia || {}) };
}

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

function inicioDoDiaLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function gastoHoje() {
  return db.prepare("SELECT COALESCE(SUM(custo_usd), 0) AS s, COUNT(*) AS n FROM uso_ia WHERE criado_em >= ? AND status <> 'simulado'").get(inicioDoDiaLocal());
}

function precoDe(modelo, tokensEntrada = 0) {
  const p = PRECOS[modelo] || PRECO_PADRAO;
  return tokensEntrada > 100000 && p.longo ? p.longo : p;
}

function custoDe(usage, modelo) {
  if (!usage) return 0;
  const p = precoDe(modelo, (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0));
  return (
    ((usage.input_tokens || 0) * p.entrada +
      (usage.output_tokens || 0) * p.saida +
      (usage.cache_read_input_tokens || 0) * p.entrada * 0.1 +
      (usage.cache_creation_input_tokens || 0) * p.entrada * 1.25) /
    1e6
  );
}

/**
 * Tokens estimados de forma conservadora. Medido numa chamada real: ~1,8 caractere por token
 * (pt-BR com muitos números, mais o schema da saída estruturada). Usamos 1,5 + folga fixa.
 */
const estimarTokens = (texto) => Math.ceil(String(texto).length / 1.5) + 400;

export function custoMaximo(textoEntrada, maxTokens, modelo = configIa().modelo) {
  const ent = estimarTokens(textoEntrada);
  const p = precoDe(modelo, ent);
  return { tokens_entrada: ent, max_tokens: maxTokens, custo_max_usd: (ent * p.entrada + maxTokens * p.saida) / 1e6 };
}

function verificarOrcamento(custoMax) {
  const cfg = configIa();
  if (cfg.habilitada === false) throw erro('A IA está desabilitada nas configurações.', 403);
  if (!process.env.ANTHROPIC_API_KEY && !simulada()) throw erro('Chave da Anthropic não configurada (ANTHROPIC_API_KEY no arquivo .env).', 503);
  const limite = Number(cfg.limite_diario_usd) || 0;
  const { s } = gastoHoje();
  if (!simulada() && s + custoMax > limite) {
    throw erro(`Limite diário de IA atingido: gasto hoje US$ ${s.toFixed(4)} de US$ ${limite.toFixed(2)} (esta chamada pode custar até US$ ${custoMax.toFixed(4)}). Amanhã o limite renova, ou ajuste em Configurações › IA.`, 429);
  }
}

function registrarUso(tipo, referencia, modelo, usage, custo, status, msgErro = null) {
  db.prepare(
    `INSERT INTO uso_ia (tipo, referencia, modelo, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo_usd, status, erro, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(tipo, referencia == null ? null : String(referencia), modelo, usage?.input_tokens ?? null, usage?.output_tokens ?? null, usage?.cache_read_input_tokens ?? null,
    usage?.cache_creation_input_tokens ?? null, custo || 0, status, msgErro, agoraISO());
}

let clienteSdk = null;
function cliente() {
  if (!clienteSdk) clienteSdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  return clienteSdk;
}

function traduzirErro(e) {
  if (e instanceof Anthropic.AuthenticationError) return erro('A chave da Anthropic foi recusada. Confira ANTHROPIC_API_KEY no .env.', 502);
  if (e instanceof Anthropic.PermissionDeniedError) return erro('A chave da Anthropic não tem permissão para este modelo.', 502);
  if (e instanceof Anthropic.RateLimitError) return erro('A Anthropic limitou as requisições agora. Tente de novo em instantes.', 429);
  if (e instanceof Anthropic.BadRequestError) return erro(`Requisição recusada pela Anthropic: ${e.message}`, 502);
  if (e instanceof Anthropic.APIConnectionError) return erro('Sem conexão com a Anthropic. Verifique a internet.', 502);
  if (e instanceof Anthropic.APIError) return erro(`Erro da Anthropic (${e.status}): ${e.message}`, 502);
  return e;
}

export function statusIa() {
  const cfg = configIa();
  const { s, n } = gastoHoje();
  return {
    configurada: Boolean(process.env.ANTHROPIC_API_KEY) && cfg.habilitada !== false,
    simulada: simulada(),
    modelo: cfg.modelo,
    esforco: cfg.esforco,
    gasto_hoje_usd: Math.round(s * 1e6) / 1e6,
    chamadas_hoje: n,
    limite_diario_usd: Number(cfg.limite_diario_usd) || 0,
  };
}

export function statusIaDetalhado() {
  const base = statusIa();
  const k = process.env.ANTHROPIC_API_KEY || '';
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const mes = db.prepare("SELECT COALESCE(SUM(custo_usd), 0) AS s, COUNT(*) AS n FROM uso_ia WHERE criado_em >= ? AND status <> 'simulado'").get(inicioMes.toISOString());
  const desde = new Date(Date.now() - 29 * 86400000);
  desde.setHours(0, 0, 0, 0);
  const historico = db
    .prepare(
      `SELECT date(criado_em, 'localtime') AS dia, SUM(custo_usd) AS custo_usd, COUNT(*) AS chamadas,
              SUM(COALESCE(tokens_entrada, 0)) AS tokens_entrada, SUM(COALESCE(tokens_saida, 0)) AS tokens_saida
         FROM uso_ia WHERE criado_em >= ? AND status <> 'simulado' GROUP BY 1 ORDER BY 1`,
    )
    .all(desde.toISOString());
  const recentes = db.prepare('SELECT tipo, referencia, modelo, tokens_entrada, tokens_saida, custo_usd, status, erro, criado_em FROM uso_ia ORDER BY id DESC LIMIT 20').all();
  return {
    ...base,
    chave_mascarada: k ? `${k.slice(0, 7)}…${k.slice(-4)}` : null,
    gasto_mes_usd: Math.round(mes.s * 1e6) / 1e6,
    chamadas_mes: mes.n,
    historico,
    recentes,
    precos_usd_por_milhao: PRECOS[base.modelo] || PRECO_PADRAO,
  };
}

// ---------------------------------------------------------------------
// Validação pós-IA
// ---------------------------------------------------------------------

/** Números de um texto, com as leituras possíveis (pt-BR e en), ignorando datas, anos e ids de fato. */
function numerosDe(texto) {
  const limpo = String(texto || '')
    .replace(/\[?F-[A-Za-z0-9_-]+\]?/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ');
  const out = [];
  for (const m of limpo.matchAll(/(\d[\d.,]*)(\s*(mil|mi|milh(?:ão|ões|oes|ao)|bi)\b)?/gi)) {
    const bruto = m[1].replace(/[.,]+$/, '');
    if (!bruto) continue;
    const mult = !m[3] ? 1 : /^mil$/i.test(m[3]) ? 1e3 : /^bi$/i.test(m[3]) ? 1e9 : 1e6;
    const pt = Number(bruto.replace(/\./g, '').replace(',', '.')) * mult;
    const en = Number(bruto.replace(/,/g, '')) * mult;
    const cand = [...new Set([pt, en].filter(Number.isFinite))];
    if (!cand.length) continue;
    const v = cand[0];
    if (Math.abs(v) <= 3) continue; // números pequenos demais para conferir (1º, 2 dias…)
    if (Number.isInteger(v) && v >= 1990 && v <= 2100 && !m[3]) continue; // anos
    out.push({ texto: m[0].trim(), cand });
  }
  return out;
}

function numerosDosFatos(fatos) {
  const mapa = new Map();
  for (const f of fatos) mapa.set(f.id, numerosDe(`${f.titulo} ${f.texto}`).flatMap((n) => n.cand));
  return mapa;
}

const bate = (x, valores) => valores.some((v) => Math.abs(v - x) <= Math.max(Math.abs(v) * 0.01, 0.6));

/** Confere um item (com fontes) contra os fatos enviados. */
function conferirItem(texto, fontes, numsFatos, todosNums, resumo) {
  const ids = Array.isArray(fontes) ? fontes : [];
  const invalidas = ids.filter((id) => !numsFatos.has(id));
  const validas = ids.filter((id) => numsFatos.has(id));
  resumo.citacoes_validas += validas.length;
  resumo.citacoes_invalidas += invalidas.length;
  const base = validas.length ? validas.flatMap((id) => numsFatos.get(id)) : todosNums;
  const semFonte = [];
  for (const n of numerosDe(texto)) {
    if (n.cand.some((x) => bate(x, base))) resumo.numeros_conferidos++;
    else {
      resumo.numeros_nao_encontrados++;
      semFonte.push(n.texto);
    }
  }
  const verificado = invalidas.length === 0 && semFonte.length === 0 && (validas.length > 0 || numerosDe(texto).length === 0);
  return { verificado, fontes_invalidas: invalidas, numeros_sem_fonte: semFonte };
}

function verificarResultado(resultado, fatos) {
  const numsFatos = numerosDosFatos(fatos);
  const todos = [...numsFatos.values()].flat();
  const resumo = { citacoes_validas: 0, citacoes_invalidas: 0, numeros_conferidos: 0, numeros_nao_encontrados: 0 };
  for (const lista of ['destaques', 'acoes', 'oportunidades_clientes', 'roteiro']) {
    for (const it of resultado[lista] || []) {
      const texto = [it.titulo, it.detalhe, it.motivo, it.sugestao, it.abordagem, it.oferta, ...(it.argumentos || [])].filter(Boolean).join(' ');
      const c = conferirItem(texto, it.fontes, numsFatos, todos, resumo);
      it.verificado = c.verificado;
      it.verificacao = { fontes_invalidas: c.fontes_invalidas, numeros_sem_fonte: c.numeros_sem_fonte };
    }
  }
  for (const campo of ['resumo', 'mensagem_equipe', 'abertura', 'fechamento']) {
    if (!resultado[campo]) continue;
    for (const n of numerosDe(resultado[campo])) {
      if (n.cand.some((x) => bate(x, todos))) resumo.numeros_conferidos++;
      else resumo.numeros_nao_encontrados++;
    }
  }
  const totalNum = resumo.numeros_conferidos + resumo.numeros_nao_encontrados;
  resumo.aprovado = resumo.citacoes_invalidas === 0 && resumo.numeros_nao_encontrados <= Math.max(1, Math.floor(totalNum * 0.1));
  return resumo;
}

function verificarTextoLivre(texto, fatos) {
  const numsFatos = numerosDosFatos(fatos);
  const citados = [...new Set([...String(texto).matchAll(/\[(F-[A-Za-z0-9_-]+)\]/g)].map((m) => m[1]))];
  const resumo = { citacoes_validas: 0, citacoes_invalidas: 0, numeros_conferidos: 0, numeros_nao_encontrados: 0 };
  const c = conferirItem(texto, citados, numsFatos, [...numsFatos.values()].flat(), resumo);
  const totalNum = resumo.numeros_conferidos + resumo.numeros_nao_encontrados;
  return { ...resumo, citados, numeros_sem_fonte: c.numeros_sem_fonte, aprovado: resumo.citacoes_invalidas === 0 && resumo.numeros_nao_encontrados <= Math.max(1, Math.floor(totalNum * 0.1)) };
}

// ---------------------------------------------------------------------
// Prompts e schemas
// ---------------------------------------------------------------------

const SISTEMA = `Você é um analista comercial sênior de uma distribuidora farmacêutica brasileira. Responda sempre em português do Brasil, com objetividade e foco em ação.
Regras obrigatórias:
1. Use SOMENTE os fatos fornecidos. Cada fato tem um id entre colchetes, por exemplo [F-cmp-3]. Não invente pessoas, clientes, produtos nem números.
2. NUNCA calcule números novos (somas, médias, diferenças, percentuais). Copie os números exatamente como aparecem nos fatos.
3. Toda afirmação que traga número deve citar, em "fontes", o(s) id(s) dos fatos de onde o número saiu.
4. Se a informação necessária não estiver nos fatos, diga explicitamente que ela não está disponível.
5. Priorize o que mais move o resultado: quem precisa de ajuda, quais clientes atacar, com quais produtos, e o que fazer primeiro.
6. Seja breve: títulos com até 10 palavras; detalhes com até 2 frases.
Estilo: escreva como um gerente comercial experiente fala com a equipe, em frases simples e diretas. Nunca use travessão (— ou –); use vírgula, dois-pontos, ponto ou parênteses. Evite clichês e floreios ("vale destacar", "em suma", "não é apenas X, é Y") e não use emojis.`;

const FONTES = { type: 'array', items: { type: 'string' } };
const obj = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, required: req, properties: props });

const SCHEMA_ANALISE = obj({
  resumo: { type: 'string' },
  saude: { type: 'string', enum: ['otima', 'boa', 'atencao', 'critica'] },
  probabilidade_meta: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  destaques: { type: 'array', items: obj({ titulo: { type: 'string' }, detalhe: { type: 'string' }, tipo: { type: 'string', enum: ['positivo', 'alerta', 'risco', 'oportunidade'] }, fontes: FONTES }) },
  acoes: { type: 'array', items: obj({ titulo: { type: 'string' }, detalhe: { type: 'string' }, responsavel: { type: 'string' }, impacto: { type: 'string', enum: ['alto', 'medio', 'baixo'] }, prazo: { type: 'string' }, fontes: FONTES }) },
  oportunidades_clientes: { type: 'array', items: obj({ cliente: { type: 'string' }, participante: { type: 'string' }, motivo: { type: 'string' }, sugestao: { type: 'string' }, fontes: FONTES }) },
  mensagem_equipe: { type: 'string' },
});

const SCHEMA_ROTEIRO = obj({
  abertura: { type: 'string' },
  roteiro: { type: 'array', items: obj({ cliente: { type: 'string' }, abordagem: { type: 'string' }, argumentos: { type: 'array', items: { type: 'string' } }, oferta: { type: 'string' }, fontes: FONTES }) },
  fechamento: { type: 'string' },
});

const TAREFA = {
  campanha: (nome) => `Analise a campanha “${nome}”. Gere: "resumo" (2 a 3 frases sobre onde a campanha está e para onde vai); "saude" (otima, boa, atencao ou critica); "probabilidade_meta" (0 a 100, sua leitura qualitativa da chance de bater a meta a partir da projeção informada; null se não houver meta); 3 a 5 "destaques"; 3 a 5 "acoes" priorizadas (responsavel = nome do participante como aparece nos fatos, ou "Gestão comercial"; prazo curto, ex.: "hoje", "esta semana"); até 5 "oportunidades_clientes" (cliente e participante exatamente como nos fatos); "mensagem_equipe" curta e motivadora para o time.`,
  vendedor: (nome) => `Analise o desempenho de ${nome} e monte um plano de ação para os próximos dias. Gere: "resumo"; "saude"; "probabilidade_meta" (chance de bater as metas das campanhas em que participa, ou null); 3 a 5 "destaques"; 3 a 5 "acoes" priorizadas (responsavel = ${nome} ou o gerente); até 5 "oportunidades_clientes" com o cliente, o motivo e a sugestão de produto/abordagem; "mensagem_equipe" = mensagem curta e direta para ${nome}.`,
  geral: () => 'Faça um diagnóstico geral das campanhas e da operação comercial. Gere: "resumo"; "saude"; "probabilidade_meta" (chance média de as campanhas ativas baterem a meta, ou null); 3 a 5 "destaques"; 3 a 5 "acoes" priorizadas para a gestão comercial; até 5 "oportunidades_clientes"; "mensagem_equipe" curta para todo o time.',
};

const blocoFatos = (fatos) => fatos.map((f) => `[${f.id}] ${f.titulo}: ${f.texto}`).join('\n');

/** Tira travessões (marca de texto de IA): "1–2" vira "1 a 2"; " — " vira vírgula. */
export function semTravessao(s) {
  return String(s ?? '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 a $2')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/([.:;!?(])\s*,\s*/g, '$1 ');
}

function textoDaResposta(msg) {
  return semTravessao((msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

// ---------------------------------------------------------------------
// Respostas simuladas (IA_SIMULADA=1): fluxo completo sem custo
// ---------------------------------------------------------------------

function analiseSimulada(fatos, nome) {
  const f = fatos.filter((x) => x.escopo !== 'qualidade');
  const pega = (i) => f[i % Math.max(1, f.length)];
  return {
    resumo: `[Simulação] ${pega(0)?.texto?.slice(0, 220) || 'Sem fatos suficientes.'}`,
    saude: 'atencao',
    probabilidade_meta: 55,
    destaques: [0, 1, 2].filter((i) => pega(i)).map((i) => ({ titulo: pega(i).titulo.slice(0, 60), detalhe: pega(i).texto.slice(0, 160), tipo: ['alerta', 'oportunidade', 'positivo'][i], fontes: [pega(i).id] })),
    acoes: [3, 4].filter((i) => pega(i)).map((i) => ({ titulo: `Agir sobre: ${pega(i).titulo.slice(0, 40)}`, detalhe: pega(i).texto.slice(0, 140), responsavel: 'Gestão comercial', impacto: 'alto', prazo: 'esta semana', fontes: [pega(i).id] })),
    oportunidades_clientes: f.filter((x) => x.escopo === 'oportunidade' || x.escopo === 'cliente').slice(0, 2).map((x) => ({ cliente: x.titulo.slice(0, 50), participante: nome || 'n/d', motivo: x.texto.slice(0, 120), sugestao: 'Visitar com oferta dos produtos da campanha.', fontes: [x.id] })),
    mensagem_equipe: '[Simulação] Foco nos clientes que já compravam os produtos: são as vendas mais rápidas da semana.',
  };
}

// ---------------------------------------------------------------------
// Análise estruturada
// ---------------------------------------------------------------------

function nomeDaReferencia(tipo, referencia) {
  if (tipo === 'campanha') return db.prepare('SELECT nome FROM campanha WHERE id = ?').get(Number(referencia))?.nome;
  if (tipo === 'vendedor') return db.prepare('SELECT nome_vendedor AS nome FROM dm_vendedor WHERE id_vendedor = ?').get(Number(referencia))?.nome;
  return 'Visão geral';
}

function linhaAnalise(r, comFatos = true) {
  const resultado = JSON.parse(r.resultado);
  const ids = JSON.parse(r.fatos || '[]');
  return {
    id: r.id,
    tipo: r.tipo,
    referencia: r.referencia,
    referencia_nome: nomeDaReferencia(r.tipo, r.referencia),
    criado_em: r.criado_em,
    custo_usd: r.custo_usd,
    simulada: Boolean(r.simulada),
    resultado,
    verificacao: r.verificacao ? JSON.parse(r.verificacao) : null,
    fatos_ids: ids,
    ...(comFatos ? { fatos_usados: ids.length ? listarFatos({ id: ids.join(','), limite: 500 }) : [] } : {}),
  };
}

export function listarAnalises({ tipo, referencia, limite = 20 } = {}) {
  const where = [];
  const p = [];
  if (tipo) {
    where.push('tipo = ?');
    p.push(tipo);
  }
  if (referencia != null && referencia !== '') {
    where.push('referencia = ?');
    p.push(String(referencia));
  }
  return db
    .prepare(`SELECT * FROM analise_ia ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${Math.trunc(limite)}`)
    .all(...p)
    .map((r) => linhaAnalise(r, false));
}

export function obterAnalise(id) {
  const r = db.prepare('SELECT * FROM analise_ia WHERE id = ?').get(Number(id));
  if (!r) throw erro('Análise não encontrada.', 404);
  return linhaAnalise(r, true);
}

/** Custo estimado (pior caso) de uma nova análise, mostrado antes de o usuário clicar. */
export async function estimarAnalise({ tipo = 'geral', referencia } = {}) {
  await garantirConhecimento();
  const { fatos, tokens } = fatosParaAnalise(tipo, referencia);
  const nome = nomeDaReferencia(tipo, referencia);
  const entrada = `${SISTEMA}\n${TAREFA[tipo]?.(nome) || ''}\n${blocoFatos(fatos)}\n${JSON.stringify(SCHEMA_ANALISE)}`;
  const assinatura = assinaturaFatos(fatos);
  const ultima = db
    .prepare("SELECT id, assinatura, criado_em FROM analise_ia WHERE tipo = ? AND COALESCE(referencia, '') = ? AND simulada = ? ORDER BY id DESC LIMIT 1")
    .get(tipo, referencia == null ? '' : String(referencia), simulada() ? 1 : 0);
  return { ...custoMaximo(entrada, MAX_TOKENS.analise), fatos: fatos.length, tokens_fatos: tokens, reaproveitavel: Boolean(ultima && ultima.assinatura === assinatura), ultima_em: ultima?.criado_em || null, status: statusIa() };
}

export async function analisar({ tipo = 'geral', referencia, forcar = false } = {}) {
  if (!TAREFA[tipo]) throw erro('Tipo de análise inválido (use campanha, vendedor ou geral).');
  if (tipo !== 'geral' && (referencia == null || referencia === '')) throw erro('Informe a campanha ou o vendedor a analisar.');
  const nome = nomeDaReferencia(tipo, referencia);
  if (!nome) throw erro('Referência não encontrada.', 404);
  await garantirConhecimento();
  const { fatos } = fatosParaAnalise(tipo, referencia);
  if (!fatos.length) throw erro('Ainda não há fatos validados para essa análise.', 409);
  const assinatura = assinaturaFatos(fatos);
  const ref = referencia == null ? null : String(referencia);

  if (!forcar) {
    const igual = db
      .prepare("SELECT * FROM analise_ia WHERE tipo = ? AND COALESCE(referencia, '') = ? AND assinatura = ? AND simulada = ? ORDER BY id DESC LIMIT 1")
      .get(tipo, ref ?? '', assinatura, simulada() ? 1 : 0);
    if (igual) return { ...linhaAnalise(igual, true), reaproveitada: true, custo_usd: 0, custo_original_usd: igual.custo_usd };
  }

  const cfg = configIa();
  const conteudo = `${TAREFA[tipo](nome)}\n\nFATOS (pré-calculados e validados):\n${blocoFatos(fatos)}`;
  const { custo_max_usd: custoMax } = custoMaximo(`${SISTEMA}\n${conteudo}\n${JSON.stringify(SCHEMA_ANALISE)}`, MAX_TOKENS.analise, cfg.modelo);
  verificarOrcamento(custoMax);

  let resultado;
  let custo = 0;
  let usage = null;
  if (simulada()) {
    resultado = analiseSimulada(fatos, nome);
    registrarUso(`analise_${tipo}`, ref, cfg.modelo, null, 0, 'simulado');
  } else {
    let msg;
    try {
      msg = await cliente().messages.create({
        model: cfg.modelo,
        max_tokens: MAX_TOKENS.analise,
        system: SISTEMA,
        output_config: { effort: cfg.esforco || 'low', format: { type: 'json_schema', schema: SCHEMA_ANALISE } },
        messages: [{ role: 'user', content: conteudo }],
      });
    } catch (e) {
      registrarUso(`analise_${tipo}`, ref, cfg.modelo, null, 0, 'erro', e.message);
      throw traduzirErro(e);
    }
    usage = msg.usage;
    custo = custoDe(usage, cfg.modelo);
    if (msg.stop_reason === 'refusal') {
      registrarUso(`analise_${tipo}`, ref, cfg.modelo, usage, custo, 'recusada', msg.stop_details?.category || null);
      throw erro('A IA recusou esta análise por política de segurança. Tente reformular ou analisar outro escopo.', 422);
    }
    if (msg.stop_reason === 'max_tokens') {
      registrarUso(`analise_${tipo}`, ref, cfg.modelo, usage, custo, 'truncada');
      throw erro('A resposta da IA foi cortada pelo limite de tamanho. Tente novamente (o custo desta tentativa já foi contabilizado).', 502);
    }
    try {
      resultado = JSON.parse(textoDaResposta(msg));
    } catch {
      registrarUso(`analise_${tipo}`, ref, cfg.modelo, usage, custo, 'invalida', 'JSON inválido');
      throw erro('A IA devolveu uma resposta fora do formato esperado. Tente novamente.', 502);
    }
    registrarUso(`analise_${tipo}`, ref, cfg.modelo, usage, custo, 'ok');
  }

  const verificacao = verificarResultado(resultado, fatos);
  const ins = db
    .prepare('INSERT INTO analise_ia (tipo, referencia, assinatura, resultado, fatos, verificacao, custo_usd, simulada, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(tipo, ref, assinatura, JSON.stringify(resultado), JSON.stringify(fatos.map((f) => f.id)), JSON.stringify(verificacao), custo, simulada() ? 1 : 0, agoraISO());
  return {
    id: Number(ins.lastInsertRowid), tipo, referencia: ref, referencia_nome: nome, criado_em: agoraISO(), custo_usd: Math.round(custo * 1e6) / 1e6,
    reaproveitada: false, simulada: simulada(), resultado, verificacao, fatos_usados: fatos, fatos_ids: fatos.map((f) => f.id), uso: usage,
  };
}

// ---------------------------------------------------------------------
// Pergunte à IA (SSE)
// ---------------------------------------------------------------------

const SISTEMA_CHAT = `${SISTEMA}
7. Responda em texto corrido curto (até 8 frases ou uma lista curta). Cite os fatos no próprio texto entre colchetes, ex.: "as vendas caíram 15% [F-vend-78]".`;

function enviarSse(res, evento, dados) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
}

export async function perguntar({ pergunta, historico = [], contexto = {} } = {}, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let encerrado = false;
  res.on('close', () => {
    encerrado = true;
  });
  try {
    const q = String(pergunta || '').trim();
    if (!q) throw erro('Escreva uma pergunta.');
    if (q.length > 2000) throw erro('Pergunta longa demais (máximo 2.000 caracteres).');
    await garantirConhecimento();
    const hist = (Array.isArray(historico) ? historico : []).slice(-6);
    const textoHist = hist.map((h) => h.texto).join(' ');
    const { fatos, entidades } = recuperarFatos({ pergunta: `${q} ${textoHist}`.slice(0, 3000), contexto, limite: 35, maxTokens: 5000 });
    enviarSse(res, 'fatos', { fatos, entidades });
    const cfg = configIa();
    const mensagens = [];
    for (const h of hist) {
      const papel = h.papel === 'ia' ? 'assistant' : 'user';
      if (mensagens.length && mensagens[mensagens.length - 1].role === papel) mensagens[mensagens.length - 1].content += `\n${h.texto}`;
      else mensagens.push({ role: papel, content: String(h.texto || '').slice(0, 4000) });
    }
    while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift();
    const conteudo = `FATOS (pré-calculados e validados):\n${blocoFatos(fatos)}\n\nPERGUNTA: ${q}`;
    mensagens.push({ role: 'user', content: conteudo });
    const { custo_max_usd: custoMax } = custoMaximo(`${SISTEMA_CHAT}\n${mensagens.map((m) => m.content).join('\n')}`, MAX_TOKENS.chat, cfg.modelo);
    verificarOrcamento(custoMax);

    let texto = '';
    let custo = 0;
    let truncada = false;
    if (simulada()) {
      const f = fatos[0];
      const resposta = f
        ? `[Simulação] Pelo que está na base: ${f.texto.slice(0, 260)} [${f.id}]. ${fatos[1] ? `Também vale olhar: ${fatos[1].titulo} [${fatos[1].id}].` : ''}`
        : '[Simulação] Não encontrei fatos sobre isso na base de conhecimento.';
      for (const pedaco of resposta.match(/.{1,24}/gs) || []) {
        if (encerrado) break;
        texto += pedaco;
        enviarSse(res, 'texto', { delta: pedaco });
        await new Promise((r) => setTimeout(r, 25));
      }
      registrarUso('pergunta', null, cfg.modelo, null, 0, 'simulado');
    } else {
      const stream = cliente().messages.stream({
        model: cfg.modelo,
        max_tokens: MAX_TOKENS.chat,
        system: SISTEMA_CHAT,
        output_config: { effort: cfg.esforco || 'low' },
        messages: mensagens,
      });
      res.on('close', () => {
        if (!res.writableEnded) stream.abort();
      });
      try {
        // espaços do fim de cada pedaço ficam retidos até o próximo, para o travessão virar vírgula sem sobrar espaço
        let retido = '';
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            const bruto = semTravessao(retido + ev.delta.text);
            const m = bruto.match(/[ \t]+$/);
            retido = m ? m[0] : '';
            const pedaco = m ? bruto.slice(0, -retido.length) : bruto;
            texto += pedaco;
            if (!encerrado && pedaco) enviarSse(res, 'texto', { delta: pedaco });
          }
        }
        if (retido) {
          texto += retido;
          if (!encerrado) enviarSse(res, 'texto', { delta: retido });
        }
        const final = await stream.finalMessage();
        custo = custoDe(final.usage, cfg.modelo);
        if (final.stop_reason === 'refusal') {
          registrarUso('pergunta', null, cfg.modelo, final.usage, custo, 'recusada');
          throw erro('A IA recusou responder a esta pergunta.', 422);
        }
        registrarUso('pergunta', null, cfg.modelo, final.usage, custo, final.stop_reason === 'max_tokens' ? 'truncada' : 'ok');
        if (final.stop_reason === 'max_tokens') {
          truncada = true;
          if (!encerrado) enviarSse(res, 'texto', { delta: '\n\n(Resposta cortada pelo limite de tamanho. Peça para continuar ou faça uma pergunta mais específica.)' });
        }
      } catch (e) {
        if (e.status) throw e;
        registrarUso('pergunta', null, cfg.modelo, null, custo, 'erro', e.message);
        throw traduzirErro(e);
      }
    }
    enviarSse(res, 'fim', { custo_usd: Math.round(custo * 1e6) / 1e6, verificacao: verificarTextoLivre(texto, fatos), simulada: simulada(), truncada, status: statusIa() });
  } catch (e) {
    const er = traduzirErro(e);
    if (!encerrado) enviarSse(res, 'erro', { erro: er.message, status: er.status || 500 });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

// ---------------------------------------------------------------------
// Roteiro de abordagem para itens do plano de ataque
// ---------------------------------------------------------------------

export async function roteiro({ vendedor, itens = [], campanha } = {}) {
  const plano = gerarPlano({ vendedor, campanha });
  const escolhidos = (itens.length ? itens.map((i) => (typeof i === 'number' ? plano.itens[i] : plano.itens.find((x) => x.chave === i))) : plano.itens.slice(0, 5)).filter(Boolean).slice(0, 8);
  if (!escolhidos.length) throw erro('Selecione ao menos um item do plano.');
  const fatos = escolhidos.map((it, i) => ({
    id: `F-plano-${i + 1}`,
    escopo: 'plano',
    titulo: `${it.cliente} (${it.cidade}/${it.estado}) · ${it.tipo_rotulo}`,
    texto: `${it.motivo} Evidências: ${(it.evidencias || []).join('; ')}. Produtos sugeridos: ${(it.produtos_sugeridos || []).map((p) => p.marca || p.produto).join(', ') || 'nenhum'}. Perfil: curva ${it.curva || 'n/d'}, ${it.segmento_rfv || 'n/d'}, segmento ${it.segmento}, porte ${it.porte}.`,
  }));
  const cfg = configIa();
  const conteudo = `Monte um roteiro de abordagem para o vendedor ${plano.vendedor.nome} visitar/ligar para os clientes abaixo, na ordem dada. Para cada cliente: "abordagem" (como abrir a conversa, 1 frase), "argumentos" (2 a 3 argumentos curtos baseados nos fatos), "oferta" (o que propor) e "fontes". Inclua "abertura" (dica geral para o dia) e "fechamento" (como registrar e dar sequência).\n\nFATOS:\n${blocoFatos(fatos)}`;
  const { custo_max_usd: custoMax } = custoMaximo(`${SISTEMA}\n${conteudo}\n${JSON.stringify(SCHEMA_ROTEIRO)}`, MAX_TOKENS.roteiro, cfg.modelo);
  verificarOrcamento(custoMax);
  let resultado;
  let custo = 0;
  if (simulada()) {
    resultado = {
      abertura: '[Simulação] Comece pelos clientes com recompra atrasada: a conversa é sobre reposição, não sobre venda nova.',
      roteiro: escolhidos.map((it, i) => ({ cliente: it.cliente, abordagem: `Retomar o contato sobre ${(it.produtos_sugeridos?.[0]?.marca || 'o mix habitual')}.`, argumentos: [it.motivo.slice(0, 120)], oferta: 'Reposição do mix com condição de campanha.', fontes: [`F-plano-${i + 1}`] })),
      fechamento: '[Simulação] Registre o resultado de cada contato para alimentar a taxa de conversão.',
    };
    registrarUso('roteiro', String(vendedor), cfg.modelo, null, 0, 'simulado');
  } else {
    let msg;
    try {
      msg = await cliente().messages.create({
        model: cfg.modelo,
        max_tokens: MAX_TOKENS.roteiro,
        system: SISTEMA,
        output_config: { effort: cfg.esforco || 'low', format: { type: 'json_schema', schema: SCHEMA_ROTEIRO } },
        messages: [{ role: 'user', content: conteudo }],
      });
    } catch (e) {
      registrarUso('roteiro', String(vendedor), cfg.modelo, null, 0, 'erro', e.message);
      throw traduzirErro(e);
    }
    custo = custoDe(msg.usage, cfg.modelo);
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
      registrarUso('roteiro', String(vendedor), cfg.modelo, msg.usage, custo, msg.stop_reason === 'refusal' ? 'recusada' : 'truncada');
      throw erro(msg.stop_reason === 'refusal' ? 'A IA recusou gerar este roteiro.' : 'O roteiro foi cortado pelo limite de tamanho; selecione menos clientes.', 502);
    }
    try {
      resultado = JSON.parse(textoDaResposta(msg));
    } catch {
      registrarUso('roteiro', String(vendedor), cfg.modelo, msg.usage, custo, 'invalida');
      throw erro('A IA devolveu um roteiro fora do formato esperado.', 502);
    }
    registrarUso('roteiro', String(vendedor), cfg.modelo, msg.usage, custo, 'ok');
  }
  const verificacao = verificarResultado(resultado, fatos);
  return { resultado, verificacao, custo_usd: Math.round(custo * 1e6) / 1e6, simulada: simulada(), itens: escolhidos.map((it) => it.chave), status: statusIa() };
}

// ---------------------------------------------------------------------
// Fórmulas em linguagem natural: o usuário descreve, a IA escreve na linguagem de métricas,
// o servidor compila/valida (e pede uma correção se precisar). Custo típico: ~US$ 0,001.
// ---------------------------------------------------------------------

const SCHEMA_FORMULA = {
  type: 'object',
  additionalProperties: false,
  required: ['expressao', 'nome', 'descricao', 'formato', 'totalizar', 'sentido', 'explicacao', 'suposicoes'],
  properties: {
    expressao: { type: 'string' },
    nome: { type: 'string' },
    descricao: { type: 'string' },
    formato: { type: 'string', enum: ['numero', 'moeda', 'perc', 'decimal'] },
    totalizar: { type: 'string', enum: ['soma', 'media'] },
    sentido: { type: 'string', enum: ['maior', 'menor'] },
    explicacao: { type: 'string' },
    suposicoes: { type: 'array', items: { type: 'string' } },
  },
};

let contextoFormulaCache = null;
async function contextoFormula() {
  if (contextoFormulaCache && contextoFormulaCache.versao === versaoDadosAtual()) return contextoFormulaCache.texto;
  const { VARIAVEIS, METRICAS, MEDIDAS_PARAMETRIZAVEIS } = await import('./motor.js');
  const { DIMENSOES_VARIAVEL } = await import('./expressao.js');
  const { FUNCOES_FORMULA } = await import('./rotas/base.js');
  const distintos = (sql) => db.prepare(sql).all().map((r) => r.v).filter((v) => v != null && v !== '');
  const valores = {
    fabricante: distintos('SELECT DISTINCT fabricante AS v FROM dm_produto ORDER BY 1'),
    marca: distintos('SELECT DISTINCT marca AS v FROM dm_produto ORDER BY 1'),
    subcategoria: distintos('SELECT DISTINCT subcategoria AS v FROM dm_produto ORDER BY 1'),
    grupo: distintos('SELECT nome AS v FROM grupo_produto ORDER BY 1'),
    canal: distintos('SELECT nome_canal AS v FROM dm_canal ORDER BY id_canal'),
    segmento: distintos('SELECT DISTINCT segmento AS v FROM dm_cliente ORDER BY 1'),
    porte: distintos('SELECT DISTINCT porte AS v FROM dm_cliente ORDER BY 1'),
    estado: distintos('SELECT DISTINCT estado AS v FROM dm_cliente ORDER BY 1'),
    cidade: distintos("SELECT DISTINCT cidade || '/' || estado AS v FROM dm_cliente ORDER BY 1"),
    curva: ['A', 'B', 'C'],
    cfop: distintos('SELECT DISTINCT cfop AS v FROM fato_vendas ORDER BY 1'),
    status: distintos('SELECT DISTINCT status AS v FROM fato_vendas ORDER BY 1'),
    periodo: ['anterior'],
    produto: ['<código numérico do produto>'],
  };
  const texto = [
    'LINGUAGEM DE FÓRMULAS DO APURADOR (calculada por participante: vendedor, equipe, cliente...)',
    'Operadores: + - * / ^ ( ) e comparações > < >= <= == != (resultam 1 ou 0). Decimal com ponto. Divisão por zero vira vazio.',
    `Funções: ${FUNCOES_FORMULA.map((f) => `${f.assinatura}: ${f.descricao}`).join(' | ')}`,
    'VARIÁVEIS (já somadas no escopo de produtos do critério e no período da campanha):',
    ...Object.entries(VARIAVEIS).map(([k, v]) => `- ${k}: ${v.nome}`),
    `RECORTE por dimensão (variável parametrizada): medida{dimensao: "valor", outra: ["a", "b"]}. Medidas recortáveis: ${MEDIDAS_PARAMETRIZAVEIS.join(', ')}.`,
    'Recortes de produto (fabricante, marca, subcategoria, grupo, produto) SUBSTITUEM o escopo de produtos do critério; os demais (canal, segmento, porte, estado, cidade, curva, cfop, status) se somam aos filtros. periodo: "anterior" = mesmo recorte no período anterior.',
    'VALORES VÁLIDOS (use exatamente como escritos):',
    ...DIMENSOES_VARIAVEL.map((d) => `- ${d}: ${valores[d].join(' | ')}`),
    'MÉTRICAS PRONTAS (exemplos de fórmulas):',
    ...Object.values(METRICAS).filter((m) => m.expr).map((m) => `- ${m.nome}: ${m.expr}`),
    'EXEMPLOS:',
    '- "quanto do faturamento vem do app" → valor{canal: "App Mobile"} / valor * 100 (perc, media)',
    '- "share do Dorflex nos analgésicos" → valor{marca: "Dorflex"} / valor{subcategoria: "Analgésicos e Antitérmicos"} * 100 (perc, media)',
    '- "1 ponto a cada 100 reais e 5 por cliente novo" → valor / 100 + clientes_novos * 5 (numero, soma)',
    '- "crescimento de unidades de Sensodyne vs mês passado" → (qtd{marca: "Sensodyne"} / qtd{marca: "Sensodyne", periodo: "anterior"} - 1) * 100 (perc, media)',
  ].join('\n');
  contextoFormulaCache = { versao: versaoDadosAtual(), texto };
  return texto;
}

const versaoDadosAtual = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS v FROM importacao').get().v + ':' + (db.prepare('SELECT COUNT(*) AS n FROM grupo_produto').get().n);

const SISTEMA_FORMULA = `Você converte pedidos em português em fórmulas da linguagem de métricas do Apurador de Campanhas.
Regras: use SOMENTE variáveis, funções, dimensões e valores listados no contexto, escritos exatamente como lá; nunca invente números de dados (constantes só quando o próprio pedido as trouxer); prefira as métricas prontas quando servirem; escolha formato (numero, moeda, perc, decimal), totalizar ("soma" para contagens/valores que somam entre participantes, "media" para razões e percentuais) e sentido ("menor" só quando menor é melhor, como desconto ou devolução). Se o pedido for ambíguo, escolha a interpretação mais comum no varejo farmacêutico e registre em "suposicoes". "nome" curto (até 6 palavras); "explicacao" em 1 ou 2 frases simples.`;

/** @returns {{ resultado, valida, erro_validacao, custo_usd, tentativas, simulada, status }} */
export async function gerarFormula({ pedido, expressaoAtual } = {}) {
  const texto = String(pedido || '').trim();
  if (texto.length < 4) throw erro('Descreva o que você quer medir.');
  const { validarExpressao } = await import('./formulas.js');
  const contexto = await contextoFormula();
  const cfg = configIa();
  const maxTokens = 2500;
  let conteudo = `${contexto}\n\nPEDIDO DO USUÁRIO: ${texto}${expressaoAtual ? `\nFórmula atual no editor (pode ser ajustada): ${expressaoAtual}` : ''}`;
  let custoTotal = 0;
  let resultado = null;
  let erroValidacao = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { custo_max_usd: custoMax } = custoMaximo(`${SISTEMA_FORMULA}\n${conteudo}\n${JSON.stringify(SCHEMA_FORMULA)}`, maxTokens, cfg.modelo);
    verificarOrcamento(custoMax);
    if (simulada()) {
      resultado = { expressao: 'valor{canal: "App Mobile"} / valor * 100', nome: '[Simulação] Share do App', descricao: 'Participação do App Mobile no faturamento.', formato: 'perc', totalizar: 'media', sentido: 'maior', explicacao: '[Simulação] Divide o faturamento do App pelo total.', suposicoes: [] };
      registrarUso('formula', null, cfg.modelo, null, 0, 'simulado');
    } else {
      let msg;
      try {
        msg = await cliente().messages.create({
          model: cfg.modelo,
          max_tokens: maxTokens,
          system: SISTEMA_FORMULA,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_FORMULA } },
          messages: [{ role: 'user', content: conteudo }],
        });
      } catch (e) {
        registrarUso('formula', null, cfg.modelo, null, 0, 'erro', e.message);
        throw traduzirErro(e);
      }
      const custo = custoDe(msg.usage, cfg.modelo);
      custoTotal += custo;
      if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
        registrarUso('formula', null, cfg.modelo, msg.usage, custo, msg.stop_reason === 'refusal' ? 'recusada' : 'truncada');
        throw erro(msg.stop_reason === 'refusal' ? 'A IA recusou este pedido.' : 'A resposta foi cortada; descreva de forma mais curta.', 502);
      }
      try {
        resultado = JSON.parse(textoDaResposta(msg));
      } catch {
        registrarUso('formula', null, cfg.modelo, msg.usage, custo, 'invalida');
        throw erro('A IA devolveu uma resposta fora do formato esperado.', 502);
      }
      registrarUso('formula', null, cfg.modelo, msg.usage, custo, 'ok');
    }
    try {
      validarExpressao(resultado.expressao);
      erroValidacao = null;
      return { resultado, valida: true, erro_validacao: null, custo_usd: Math.round(custoTotal * 1e6) / 1e6, tentativas: tentativa, simulada: simulada(), status: statusIa() };
    } catch (e) {
      erroValidacao = e.message;
      conteudo += `\n\nSua fórmula anterior "${resultado.expressao}" não compila: ${e.message}. Corrija usando só o que está no contexto.`;
    }
  }
  return { resultado, valida: false, erro_validacao: erroValidacao, custo_usd: Math.round(custoTotal * 1e6) / 1e6, tentativas: 2, simulada: simulada(), status: statusIa() };
}

export const _teste = { numerosDe, verificarResultado, verificarTextoLivre, normalizarTexto };
