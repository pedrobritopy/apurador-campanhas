import crypto from 'node:crypto';
import { Worker, isMainThread } from 'node:worker_threads';
import { db, agoraISO, transacao } from './db.js';
import { addDias, hojeISO } from './calendario.js';
import { apurarComCache, estoqueDaCampanha, oportunidadesDaCampanha } from './motor.js';
import { NIVEIS } from './participantes.js';
import { resolverProdutos } from './seletor.js';
import {
  VENDA_VALIDA, assinaturaDados, atualizarPerfis, dataReferenciaVendas, fx, gravarEstado, lerEstado, normalizarTexto, perfilDesatualizado,
} from './perfil.js';
import { TIPOS_PLANO, atualizarConversoes, calcularBacktest, taxasConversao } from './planos.js';
import { dispararPipeline, statusPipeline } from './pipeline.js';

// =====================================================================
// Base de conhecimento da IA ("RAG" local, sem custo):
//  1. o motor e consultas SQL pré-calculam FATOS curtos com números prontos (a IA nunca calcula);
//  2. DUPLA VALIDAÇÃO: os números-chave são conferidos por um segundo caminho independente
//     (motor × SQL direto; vendas × saída de estoque; soma por vendedor × soma por cliente);
//     fato que diverge fica com validado = 0 e NÃO vai para a IA;
//  3. RECUPERAÇÃO: linkagem de entidades (vendedor, cliente, marca, campanha, cidade, UF...) + BM25.
// =====================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS fato_ia (
  id TEXT PRIMARY KEY,
  escopo TEXT NOT NULL,
  chave TEXT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  dados TEXT,
  entidades TEXT,
  termos TEXT,
  relevancia REAL DEFAULT 0,
  validado INTEGER NOT NULL DEFAULT 1,
  validacao TEXT,
  gerado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fato_escopo ON fato_ia(escopo, chave);
CREATE TABLE IF NOT EXISTS verificacao_dados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regra TEXT NOT NULL,
  descricao TEXT,
  valor_a REAL, valor_b REAL, divergencias INTEGER,
  ok INTEGER NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL
);
`);

const TOLERANCIA = 0.005; // 0,5%
const confere = (a, b) => Math.abs((a || 0) - (b || 0)) <= Math.max(TOLERANCIA * Math.abs(b || 0), 0.01);
const slug = (s) => normalizarTexto(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ints = (arr) => (arr.length ? arr.map((x) => Math.trunc(Number(x))).join(',') : '-1');
const ph = (arr) => arr.map(() => '?').join(',');

const STATUS_ROTULO = {
  atingiu: 'atingiu a meta', no_ritmo: 'no ritmo para bater', atencao: 'em atenção', risco: 'em risco',
  nao_atingiu: 'não atingiu', sem_meta: 'sem meta', aguardando: 'aguardando início',
};

// ---------------------------------------------------------------------
// Verificações de qualidade (integridade + cruzamento de fontes)
// ---------------------------------------------------------------------

export function verificarQualidade() {
  const ref = dataReferenciaVendas();
  const agora = agoraISO();
  const checks = [];
  const add = (regra, descricao, a, b, divergencias, ok, detalhe) => checks.push({ regra, descricao, valor_a: a, valor_b: b, divergencias, ok: ok ? 1 : 0, detalhe, criado_em: agora });
  const total = db.prepare('SELECT COUNT(*) AS n FROM fato_vendas').get().n || 0;
  const limite = Math.max(1, Math.round(total * 0.005));

  const r1 = db.prepare('SELECT COUNT(*) AS n FROM fato_vendas WHERE ABS(valor_total - quantidade * valor_unitario) > 0.01 * ABS(valor_total) + 0.05').get().n;
  add('valor_x_unitario', 'Valor total da linha = quantidade × valor unitário', total - r1, total, r1, r1 <= limite, `${fx.num(r1)} de ${fx.num(total)} linhas fora da tolerância`);
  const r2 = db.prepare('SELECT COUNT(*) AS n FROM fato_vendas WHERE ABS(margem_bruta - (valor_total - custo_total)) > 0.05').get().n;
  add('margem_x_custo', 'Margem bruta = valor − custo', total - r2, total, r2, r2 <= limite, `${fx.num(r2)} linhas divergentes`);
  const r3 = db.prepare('SELECT COUNT(*) AS n FROM fato_vendas WHERE ABS(valor_impostos_total - (COALESCE(valor_icms,0) + COALESCE(valor_pis,0) + COALESCE(valor_cofins,0))) > 0.05').get().n;
  add('impostos_x_soma', 'Impostos totais = ICMS + PIS + COFINS', total - r3, total, r3, r3 <= limite, `${fx.num(r3)} linhas divergentes`);
  const r4 = db
    .prepare(
      `SELECT SUM(p.id_produto IS NULL) AS prod, SUM(c.id_cliente IS NULL) AS cli, SUM(vd.id_vendedor IS NULL) AS vend FROM fato_vendas v
         LEFT JOIN dm_produto p ON p.id_produto = v.id_produto LEFT JOIN dm_cliente c ON c.id_cliente = v.id_cliente
         LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor`,
    )
    .get();
  const orfas = (r4.prod || 0) + (r4.cli || 0) + (r4.vend || 0);
  add('cadastros_orfaos', 'Toda venda tem produto, cliente e vendedor cadastrados', total - orfas, total, orfas, orfas === 0, `produto: ${r4.prod || 0}, cliente: ${r4.cli || 0}, vendedor: ${r4.vend || 0}`);
  const r5 = db.prepare('SELECT COUNT(*) AS n FROM fato_vendas WHERE data_faturamento < data_pedido').get().n;
  add('datas_coerentes', 'Faturamento nunca antes do pedido', total - r5, total, r5, r5 <= limite, `${fx.num(r5)} linhas com faturamento antes do pedido`);

  // cruzamento de fontes: vendas faturadas (produto × dia do pedido) × saída registrada no estoque
  const est = db.prepare('SELECT COUNT(*) AS n, MIN(data) AS ini, MAX(data) AS fim FROM fato_estoque').get();
  if (est.n) {
    const r6 = db
      .prepare(
        `WITH v AS (SELECT v.id_produto, v.data_pedido AS d, SUM(v.quantidade) AS q FROM fato_vendas v
                     WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY 1, 2),
              e AS (SELECT id_produto, data AS d, quantidade_vendida AS q FROM fato_estoque)
         SELECT SUM(COALESCE(v.q, 0)) AS vendas, SUM(e.q) AS estoque, SUM(ABS(COALESCE(v.q, 0) - e.q) >= 0.5) AS divergentes, COUNT(*) AS n
           FROM e LEFT JOIN v ON v.id_produto = e.id_produto AND v.d = e.d`,
      )
      .get(est.ini, est.fim);
    const okEst = (r6.divergentes || 0) <= Math.max(1, r6.n * 0.01) && confere(r6.vendas, r6.estoque);
    add('vendas_x_estoque', 'Unidades vendidas (vendas) = saída registrada no estoque, por produto e dia', r6.vendas, r6.estoque, r6.divergentes || 0, okEst,
      `${fx.num(r6.divergentes || 0)} de ${fx.num(r6.n)} combinações produto×dia divergentes (${fx.data(est.ini)} a ${fx.data(est.fim)})`);
  }

  // dupla soma: faturamento 30 dias por vendedor direto × soma das parcelas por cliente
  if (ref) {
    const ini = addDias(ref, -29);
    const a = db.prepare(`SELECT SUM(v.valor_total) AS s FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ?`).get(ini, ref).s || 0;
    const partes = db.prepare(`SELECT v.id_vendedor, v.id_cliente, SUM(v.valor_total) AS s FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY 1, 2`).all(ini, ref);
    const b = partes.reduce((s, p) => s + (p.s || 0), 0);
    add('soma_total_x_partes', 'Faturamento 30 dias: soma direta = soma das parcelas vendedor × cliente', a, b, confere(a, b) ? 0 : 1, confere(a, b), `${fx.moeda(a)} × ${fx.moeda(b)}`);
  }

  transacao(() => {
    db.exec('DELETE FROM verificacao_dados');
    const st = db.prepare('INSERT INTO verificacao_dados (regra, descricao, valor_a, valor_b, divergencias, ok, detalhe, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of checks) st.run(c.regra, c.descricao, c.valor_a, c.valor_b, c.divergencias, c.ok, c.detalhe, c.criado_em);
  });
  return checks;
}

export function listarVerificacoes() {
  return db.prepare('SELECT regra, descricao, valor_a, valor_b, divergencias, ok, detalhe, criado_em FROM verificacao_dados ORDER BY ok, id').all().map((r) => ({ ...r, ok: Boolean(r.ok) }));
}

// ---------------------------------------------------------------------
// Dupla validação de um critério de campanha: motor × SQL direto independente
// ---------------------------------------------------------------------

const FILTROS_CONHECIDOS = new Set(['canais', 'segmentos', 'portes', 'estados', 'clientes', 'cfops', 'cfops_excluir', 'cidades']);

export function validarCriterioDireto(res, idx) {
  const c = res.campanha;
  const cr = c.criterios[idx];
  const tot = res.criterios[idx]?.total;
  if (!tot || tot.qtd == null || tot.valor == null) return { metodo: 'motor × SQL direto', aplicavel: false, ok: null, observacao: 'motor não expôs totais' };
  const naoReplicavel = Object.entries(c.filtros || {}).filter(([k, v]) => Array.isArray(v) && v.length && !FILTROS_CONHECIDOS.has(k));
  if (naoReplicavel.length) return { metodo: 'motor × SQL direto', aplicavel: false, ok: null, observacao: `filtro não replicável: ${naoReplicavel.map(([k]) => k).join(', ')}` };
  if (res.tempo.status === 'futura') return { metodo: 'motor × SQL direto', aplicavel: true, ok: true, a: { qtd: tot.qtd, valor: tot.valor }, b: { qtd: 0, valor: 0 } };

  const col = c.data_base === 'faturamento' ? 'data_faturamento' : 'data_pedido';
  const fim = res.tempo.referencia < c.fim ? res.tempo.referencia : c.fim;
  const prods = cr.metrica === 'combo' ? [...new Set((cr.combo?.itens || []).flatMap((it) => resolverProdutos(it.produtos)))] : resolverProdutos(cr.produtos);
  const where = [`v.${col} BETWEEN ? AND ?`, `v.status IN (${ph(c.status_venda)})`, `v.id_produto IN (${ints(prods)})`];
  const p = [c.inicio, fim, ...c.status_venda];
  const f = c.filtros || {};
  if (f.canais?.length) where.push(`v.id_canal IN (${ints(f.canais)})`);
  if (f.clientes?.length) where.push(`v.id_cliente IN (${ints(f.clientes)})`);
  for (const [colf, arr, neg] of [['c.segmento', f.segmentos], ['c.porte', f.portes], ['c.estado', f.estados], ['c.cidade', f.cidades], ['v.cfop', f.cfops], ['v.cfop', f.cfops_excluir, true]]) {
    if (arr?.length) {
      where.push(`${colf} ${neg ? 'NOT IN' : 'IN'} (${ph(arr)})`);
      p.push(...arr);
    }
  }
  const chaveSql = NIVEIS[c.participantes.nivel]?.chaveSql || 'v.id_vendedor';
  where.push(`CAST(${chaveSql} AS TEXT) IN (SELECT value FROM json_each(?))`);
  p.push(JSON.stringify(res.participantes.map((l) => l.chave)));
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(v.quantidade), 0) AS qtd, COALESCE(SUM(v.valor_total), 0) AS valor FROM fato_vendas v
         LEFT JOIN dm_cliente c ON c.id_cliente = v.id_cliente LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor
        WHERE ${where.join(' AND ')}`,
    )
    .get(...p);
  const ok = confere(tot.qtd, r.qtd) && confere(tot.valor, r.valor);
  return {
    metodo: 'motor × SQL direto',
    aplicavel: true,
    ok,
    a: { qtd: tot.qtd, valor: Math.round(tot.valor * 100) / 100 },
    b: { qtd: r.qtd, valor: Math.round(r.valor * 100) / 100 },
    diferenca: { qtd: (tot.qtd || 0) - r.qtd, valor: Math.round(((tot.valor || 0) - r.valor) * 100) / 100 },
  };
}

// ---------------------------------------------------------------------
// Geração dos fatos
// ---------------------------------------------------------------------

function campanhasAtuais() {
  return db
    .prepare("SELECT id, nome, fornecedor, status, definicao, atualizado_em FROM campanha WHERE status IN ('ativa', 'encerrada') ORDER BY id")
    .all()
    .map((c) => {
      try {
        return { ...c, definicao: JSON.parse(c.definicao) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function assinaturaCampanhas() {
  const r = db.prepare("SELECT COUNT(*) AS n, MAX(atualizado_em) AS m, GROUP_CONCAT(id || status, ',') AS s FROM campanha WHERE status IN ('ativa','encerrada')").get();
  return `${r.n}:${r.m}:${r.s}`;
}

export function assinaturaConhecimento() {
  return `${assinaturaDados()}|${assinaturaCampanhas()}|${hojeISO()}`;
}

const fmtCrit = (cr, v) => {
  const s = fx.valor(v, cr.formato);
  return cr.unidade && cr.formato === 'numero' && s !== 'n/d' ? `${s} ${cr.unidade}` : s;
};

/** Gera todos os fatos (síncrono; chamado em etapas pelo atualizarConhecimento). */
function fatosGerais(ref, verificacoes) {
  const fatos = [];
  const okVendasEstoque = verificacoes.find((v) => v.regra === 'vendas_x_estoque')?.ok !== 0;
  const ini30 = addDias(ref, -29);
  const iniAnt = addDias(ref, -59);
  const fimAnt = addDias(ref, -30);

  const g = db
    .prepare(
      `SELECT SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor,
              SUM(CASE WHEN v.data_pedido < ? THEN v.valor_total ELSE 0 END) AS valor_ant,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_pedido END) AS pedidos,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_cliente END) AS clientes,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.quantidade ELSE 0 END) AS qtd
         FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ?`,
    )
    .get(ini30, ini30, ini30, ini30, ini30, iniAnt, ref);
  const base = db.prepare('SELECT COUNT(*) AS n FROM dm_cliente').get().n || 1;
  const somaPorDia = db.prepare(`SELECT SUM(s) AS s FROM (SELECT SUM(v.valor_total) AS s FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY v.data_pedido)`).get(ini30, ref).s || 0;
  const var30 = g.valor_ant > 0 ? (g.valor / g.valor_ant - 1) * 100 : null;
  fatos.push({
    id: 'F-geral-vendas', escopo: 'geral', chave: 'vendas', tipo: 'vendas_30d', relevancia: 0.75,
    titulo: `Vendas da empresa nos últimos 30 dias (até ${fx.data(ref)})`,
    texto: `Faturamento válido (sem cancelamentos e devoluções) de ${fx.data(ini30)} a ${fx.data(ref)}: ${fx.moeda(g.valor)} (${fx.sinal(var30, 1)}% vs os 30 dias anteriores, ${fx.moeda(g.valor_ant)}). ${fx.num(g.pedidos)} pedidos, ticket médio ${fx.moeda(g.valor / (g.pedidos || 1))}, ${fx.num(g.qtd)} unidades, ${fx.num(g.clientes)} clientes compradores de ${fx.num(base)} cadastrados (${fx.perc((g.clientes / base) * 100)} da base).`,
    dados: { valor: g.valor, valor_ant: g.valor_ant, variacao: var30, pedidos: g.pedidos, clientes: g.clientes, base },
    validacao: { metodo: 'soma direta × soma por dia', a: g.valor, b: somaPorDia, ok: confere(g.valor, somaPorDia) },
  });

  const canais = db
    .prepare(
      `SELECT cn.nome_canal AS canal, SUM(v.valor_total) AS valor FROM fato_vendas v LEFT JOIN dm_canal cn ON cn.id_canal = v.id_canal
        WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY v.id_canal ORDER BY valor DESC`,
    )
    .all(ini30, ref);
  const totCanais = canais.reduce((s, c) => s + c.valor, 0) || 1;
  fatos.push({
    id: 'F-geral-canais', escopo: 'geral', chave: 'canais', tipo: 'canais', relevancia: 0.45,
    titulo: 'Participação dos canais de venda (30 dias)',
    texto: `Faturamento por canal nos últimos 30 dias: ${canais.map((c) => `${c.canal || 'sem canal'} ${fx.moeda(c.valor)} (${fx.perc((c.valor / totCanais) * 100, 1)})`).join('; ')}.`,
    dados: { canais },
    validacao: { metodo: 'soma dos canais × total', a: totCanais, b: g.valor, ok: confere(totCanais, g.valor) },
  });

  const marcas = db
    .prepare(
      `SELECT p.marca, p.fabricante, SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS atual,
              SUM(CASE WHEN v.data_pedido < ? THEN v.valor_total ELSE 0 END) AS ant
         FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
        WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY p.marca HAVING ant >= 5000`,
    )
    .all(ini30, ini30, iniAnt, ref)
    .map((m) => ({ ...m, variacao: (m.atual / m.ant - 1) * 100 }));
  const sobe = [...marcas].sort((a, b) => b.variacao - a.variacao).slice(0, 5);
  const desce = [...marcas].sort((a, b) => a.variacao - b.variacao).slice(0, 5);
  fatos.push({
    id: 'F-geral-marcas', escopo: 'geral', chave: 'marcas', tipo: 'tendencia_marcas', relevancia: 0.55,
    titulo: 'Marcas que mais cresceram e mais caíram (30 dias vs 30 anteriores)',
    texto: `Maiores altas: ${sobe.map((m) => `${m.marca} ${fx.sinal(m.variacao)}% (${fx.moeda(m.atual)})`).join(', ')}. Maiores quedas: ${desce.map((m) => `${m.marca} ${fx.sinal(m.variacao)}% (${fx.moeda(m.atual)})`).join(', ')}.`,
    dados: { sobe, desce },
    entidades: [...sobe, ...desce].map((m) => `marca:${slug(m.marca)}`),
  });

  const dev = db
    .prepare(
      `SELECT SUM(CASE WHEN lower(status) LIKE 'devol%' THEN valor_total ELSE 0 END) AS devolvido,
              SUM(CASE WHEN lower(status) LIKE 'cancel%' THEN valor_total ELSE 0 END) AS cancelado,
              SUM(valor_total) AS bruto FROM fato_vendas WHERE data_pedido BETWEEN ? AND ?`,
    )
    .get(ini30, ref);
  fatos.push({
    id: 'F-geral-devolucoes', escopo: 'geral', chave: 'devolucoes', tipo: 'qualidade_venda', relevancia: 0.4,
    titulo: 'Devoluções e cancelamentos (30 dias)',
    texto: `Nos últimos 30 dias, devoluções somaram ${fx.moeda(dev.devolvido)} (${fx.perc((dev.devolvido / (dev.bruto || 1)) * 100, 1)} do valor bruto) e cancelamentos ${fx.moeda(dev.cancelado)} (${fx.perc((dev.cancelado / (dev.bruto || 1)) * 100, 1)}).`,
    dados: dev,
  });

  const rfv = db.prepare('SELECT segmento_rfv AS seg, COUNT(*) AS n, SUM(valor_90d) AS valor FROM cliente_perfil GROUP BY 1 ORDER BY valor DESC').all();
  if (rfv.length) {
    fatos.push({
      id: 'F-geral-rfv', escopo: 'geral', chave: 'rfv', tipo: 'segmentacao', relevancia: 0.5,
      titulo: 'Base de clientes por perfil de compra (RFV)',
      texto: `Clientes por perfil RFV (recência, frequência e valor em 90 dias): ${rfv.map((r) => `${r.seg} ${fx.num(r.n)} (${fx.moeda(r.valor)})`).join('; ')}.`,
      dados: { rfv },
    });
  }

  const ultEst = db.prepare('SELECT MAX(data) AS d FROM fato_estoque').get()?.d;
  if (ultEst) {
    const criticos = db
      .prepare(
        `SELECT p.nome_produto AS nome, p.marca, e.estoque_final AS estoque, e.estoque_minimo AS minimo,
                (SELECT AVG(x.quantidade_vendida) FROM fato_estoque x WHERE x.id_produto = e.id_produto AND x.data > date(?, '-30 day')) AS media
           FROM fato_estoque e JOIN dm_produto p ON p.id_produto = e.id_produto WHERE e.data = ?`,
      )
      .all(ultEst, ultEst)
      .map((r) => ({ ...r, cobertura: r.media > 0 ? r.estoque / r.media : null }))
      .filter((r) => r.estoque <= r.minimo || (r.cobertura != null && r.cobertura < 7))
      .sort((a, b) => (a.cobertura ?? 0) - (b.cobertura ?? 0));
    fatos.push({
      id: 'F-geral-estoque', escopo: 'geral', chave: 'estoque', tipo: 'estoque', relevancia: 0.5,
      titulo: `Produtos com estoque crítico (posição de ${fx.data(ultEst)})`,
      texto: criticos.length
        ? `${fx.num(criticos.length)} produtos abaixo do mínimo ou com cobertura menor que 7 dias. Mais críticos: ${criticos.slice(0, 6).map((r) => `${r.nome} (${fx.num(r.estoque)} un, cobre ${r.cobertura == null ? 'n/d' : fx.num(r.cobertura, 1)} dias)`).join('; ')}.`
        : 'Nenhum produto abaixo do estoque mínimo ou com cobertura menor que 7 dias.',
      dados: { quantidade: criticos.length, criticos: criticos.slice(0, 20) },
      entidades: criticos.slice(0, 6).map((r) => `marca:${slug(r.marca)}`),
      validacao: { metodo: 'vendas × saída de estoque', ok: okVendasEstoque },
    });
  }

  for (const v of verificacoes) {
    fatos.push({
      id: `F-qual-${v.regra}`, escopo: 'qualidade', chave: v.regra, tipo: 'verificacao', relevancia: v.ok ? 0.3 : 1,
      titulo: `Verificação de dados: ${v.descricao}`,
      texto: `${v.ok ? 'Conferido, sem divergência relevante' : 'DIVERGÊNCIA encontrada'}: ${v.detalhe}.`,
      dados: v,
    });
  }

  // retroalimentação (taxas de conversão das sugestões)
  for (const t of taxasConversao()) {
    const bt = t.backtest;
    fatos.push({
      id: `F-retro-${t.tipo}`, escopo: 'retroalimentacao', chave: t.tipo, tipo: 'conversao', relevancia: 0.55,
      titulo: `Conversão das sugestões “${t.rotulo}”`,
      texto: `Taxa usada nas prioridades: ${fx.perc(t.taxa * 100, 1)} (fonte: ${t.fonte}). ${bt?.total ? `Backtest (regra aplicada 30 dias atrás): ${fx.num(bt.convertidas)} de ${fx.num(bt.total)} sugestões viraram compra em 30 dias (${fx.perc(bt.taxa * 100, 1)}; ${fx.moeda(bt.valor_convertido)}).` : 'Sem backtest disponível.'} Registradas no sistema: ${fx.num(t.registros.total)} encerradas (${fx.num(t.registros.convertidas)} convertidas, ${fx.moeda(t.registros.valor_convertido)}) e ${fx.num(t.registros.abertas)} em aberto.`,
      dados: t,
      entidades: [`tipo:${t.tipo}`],
    });
  }

  const assoc = db.prepare('SELECT * FROM associacao_marca WHERE confianca >= 0.3 ORDER BY lift DESC LIMIT 40').all();
  assoc.forEach((a, i) => {
    fatos.push({
      id: `F-assoc-${i + 1}`, escopo: 'associacao', chave: `${a.marca_a}>${a.marca_b}`, tipo: 'associacao', relevancia: 0.3,
      titulo: `Quem compra ${a.marca_a} também compra ${a.marca_b}`,
      texto: `${fx.perc(a.confianca * 100)} dos ${fx.num(a.clientes_a)} clientes que compram ${a.marca_a} também compram ${a.marca_b} (${fx.num(a.lift, 2)}× a média da base; ${fx.num(a.clientes_ab)} clientes em comum nos últimos 90 dias).`,
      dados: a,
      entidades: [`marca:${slug(a.marca_a)}`, `marca:${slug(a.marca_b)}`],
    });
  });
  return fatos;
}

function fatosMarcas(ref, verificacoes) {
  const okEst = verificacoes.find((v) => v.regra === 'vendas_x_estoque')?.ok !== 0;
  const ini30 = addDias(ref, -29);
  const iniAnt = addDias(ref, -59);
  const base = db.prepare(`SELECT COUNT(DISTINCT v.id_cliente) AS n FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ?`).get(addDias(ref, -89), ref).n || 1;
  const linhas = db
    .prepare(
      `SELECT p.marca, MAX(p.fabricante) AS fabricante,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor,
              SUM(CASE WHEN v.data_pedido >= ? THEN v.quantidade ELSE 0 END) AS qtd,
              SUM(CASE WHEN v.data_pedido < ? THEN v.valor_total ELSE 0 END) AS valor_ant,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_cliente END) AS clientes,
              COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_vendedor END) AS vendedores
         FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
        WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY p.marca`,
    )
    .all(ini30, ini30, ini30, ini30, ini30, iniAnt, ref);
  const topVend = db
    .prepare(
      `SELECT p.marca, vd.nome_vendedor AS nome, SUM(v.valor_total) AS valor FROM fato_vendas v
         JOIN dm_produto p ON p.id_produto = v.id_produto JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor
        WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY p.marca, v.id_vendedor`,
    )
    .all(ini30, ref);
  const porMarcaVend = new Map();
  for (const t of topVend) {
    if (!porMarcaVend.has(t.marca)) porMarcaVend.set(t.marca, []);
    porMarcaVend.get(t.marca).push(t);
  }
  const ultEst = db.prepare('SELECT MAX(data) AS d FROM fato_estoque').get()?.d;
  const estoque = new Map(
    ultEst
      ? db
          .prepare(
            `SELECT p.marca, SUM(e.estoque_final) AS estoque, SUM(e.estoque_final <= e.estoque_minimo) AS abaixo,
                    (SELECT SUM(x.quantidade_vendida) / 30.0 FROM fato_estoque x JOIN dm_produto px ON px.id_produto = x.id_produto
                      WHERE px.marca = p.marca AND x.data > date(?, '-30 day')) AS media
               FROM fato_estoque e JOIN dm_produto p ON p.id_produto = e.id_produto WHERE e.data = ? GROUP BY p.marca`,
          )
          .all(ultEst, ultEst)
          .map((r) => [r.marca, r])
      : [],
  );
  return linhas.map((m) => {
    const variacao = m.valor_ant > 0 ? (m.valor / m.valor_ant - 1) * 100 : null;
    const top = (porMarcaVend.get(m.marca) || []).sort((a, b) => b.valor - a.valor).slice(0, 3);
    const e = estoque.get(m.marca);
    const cobertura = e?.media > 0 ? e.estoque / e.media : null;
    return {
      id: `F-marca-${slug(m.marca)}`, escopo: 'marca', chave: m.marca, tipo: 'marca', relevancia: 0.4,
      titulo: `Marca ${m.marca} (${m.fabricante})`,
      texto: `${m.marca} (${m.fabricante}) nos últimos 30 dias: ${fx.moeda(m.valor)} e ${fx.num(m.qtd)} un (${fx.sinal(variacao)}% vs 30 dias anteriores), ${fx.num(m.clientes)} clientes compradores (${fx.perc((m.clientes / base) * 100)} da base ativa) e ${fx.num(m.vendedores)} vendedores. Quem mais vende: ${top.map((t) => `${t.nome} (${fx.moeda(t.valor)})`).join(', ') || 'nenhum'}.${e ? ` Estoque: ${fx.num(e.estoque)} un${cobertura != null ? `, cobertura ~${fx.num(cobertura)} dias` : ''}${e.abaixo ? `, ${fx.num(e.abaixo)} produto(s) abaixo do mínimo` : ''}.` : ''}`,
      dados: { ...m, variacao, cobertura, top_vendedores: top },
      entidades: [`marca:${slug(m.marca)}`, `fabricante:${slug(m.fabricante)}`],
      validacao: e ? { metodo: 'vendas × saída de estoque', ok: okEst } : undefined,
    };
  });
}

function fatosVendedores(ref) {
  const ini30 = addDias(ref, -29);
  const iniAnt = addDias(ref, -59);
  const vend = db
    .prepare(
      `SELECT vd.id_vendedor AS id, vd.nome_vendedor AS nome, vd.id_superior, g.nome_vendedor AS gerente, vd.nivel,
              (SELECT COUNT(*) FROM dm_cliente c WHERE c.id_vendedor = vd.id_vendedor) AS carteira
         FROM dm_vendedor vd LEFT JOIN dm_vendedor g ON g.id_vendedor = vd.id_superior`,
    )
    .all();
  const agg = new Map(
    db
      .prepare(
        `SELECT v.id_vendedor AS id, SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total ELSE 0 END) AS valor,
                SUM(CASE WHEN v.data_pedido < ? THEN v.valor_total ELSE 0 END) AS valor_ant,
                COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_pedido END) AS pedidos,
                COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_cliente END) AS clientes,
                COUNT(DISTINCT CASE WHEN v.data_pedido >= ? THEN v.id_cliente || '-' || v.id_produto END) AS cli_skus
           FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY v.id_vendedor`,
      )
      .all(ini30, ini30, ini30, ini30, ini30, iniAnt, ref)
      .map((r) => [r.id, r]),
  );
  // caminho B (dupla validação): soma das parcelas por cliente
  const partes = new Map();
  for (const r of db.prepare(`SELECT v.id_vendedor AS id, v.id_cliente, SUM(v.valor_total) AS s FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY 1, 2`).all(ini30, ref)) {
    partes.set(r.id, (partes.get(r.id) || 0) + r.s);
  }
  const marcas = new Map();
  for (const r of db
    .prepare(
      `SELECT v.id_vendedor AS id, p.marca, SUM(v.valor_total) AS valor FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
        WHERE ${VENDA_VALIDA} AND v.data_pedido BETWEEN ? AND ? GROUP BY 1, 2`,
    )
    .all(ini30, ref)) {
    if (!marcas.has(r.id)) marcas.set(r.id, []);
    marcas.get(r.id).push(r);
  }
  const risco = new Map();
  for (const r of db
    .prepare(
      `SELECT p.id_vendedor AS id, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, p.segmento_rfv, p.valor_90d FROM cliente_perfil p
         JOIN dm_cliente c ON c.id_cliente = p.id_cliente WHERE p.segmento_rfv IN ('Em risco', 'Não pode perder', 'Hibernando', 'Perdidos') ORDER BY p.valor_90d DESC`,
    )
    .all()) {
    if (!risco.has(r.id)) risco.set(r.id, []);
    risco.get(r.id).push(r);
  }
  const atrasos = new Map(
    db
      .prepare(
        `SELECT c.id_vendedor AS id, COUNT(*) AS n, SUM(cm.valor / cm.compras) AS potencial FROM cliente_marca cm JOIN dm_cliente c ON c.id_cliente = cm.id_cliente
          WHERE cm.compras >= 2 AND cm.intervalo_medio >= 5 AND julianday(?) - julianday(cm.ultima) > 1.5 * cm.intervalo_medio
            AND julianday(?) - julianday(cm.ultima) <= 120 GROUP BY c.id_vendedor`,
      )
      .all(ref, ref)
      .map((r) => [r.id, r]),
  );
  const fatos = [];
  const equipes = new Map();
  for (const v of vend) {
    const a = agg.get(v.id);
    if (v.id_superior != null) {
      if (!equipes.has(v.id_superior)) equipes.set(v.id_superior, []);
      equipes.get(v.id_superior).push({ ...v, a });
    }
    if (!a && !v.carteira) continue;
    const variacao = a?.valor_ant > 0 ? (a.valor / a.valor_ant - 1) * 100 : null;
    const top = (marcas.get(v.id) || []).sort((x, y) => y.valor - x.valor).slice(0, 3);
    const rs = risco.get(v.id) || [];
    const at = atrasos.get(v.id);
    fatos.push({
      id: `F-vend-${v.id}`, escopo: 'vendedor', chave: String(v.id), tipo: 'desempenho', relevancia: 0.5,
      titulo: `Vendedor ${v.nome}${v.gerente ? ` (equipe ${v.gerente})` : ''}`,
      texto: `${v.nome} nos últimos 30 dias: ${fx.moeda(a?.valor || 0)} (${fx.sinal(variacao)}% vs 30 dias anteriores), ${fx.num(a?.pedidos || 0)} pedidos, ticket médio ${fx.moeda((a?.valor || 0) / (a?.pedidos || 1))}, ${fx.num(a?.clientes || 0)} clientes atendidos${v.carteira ? ` (carteira de ${fx.num(v.carteira)}: ${fx.perc(((a?.clientes || 0) / v.carteira) * 100)} positivados)` : ''}, mix médio de ${fx.num((a?.cli_skus || 0) / (a?.clientes || 1), 1)} SKUs por cliente. Marcas que mais vende: ${top.map((t) => `${t.marca} (${fx.moeda(t.valor)})`).join(', ') || 'nenhum'}. Clientes com perfil em risco: ${fx.num(rs.length)}${rs.length ? ` (${rs.slice(0, 3).map((r) => `${r.nome}: ${r.segmento_rfv}`).join('; ')})` : ''}. Recompras atrasadas na carteira: ${fx.num(at?.n || 0)} (potencial ${fx.moeda(at?.potencial || 0)}).`,
      dados: { ...a, variacao, carteira: v.carteira, risco: rs.length, atrasos: at?.n || 0 },
      entidades: [`vendedor:${v.id}`, ...(v.id_superior != null ? [`equipe:${v.id_superior}`] : []), ...top.map((t) => `marca:${slug(t.marca)}`)],
      validacao: { metodo: 'soma direta por vendedor × soma das parcelas por cliente', a: a?.valor || 0, b: partes.get(v.id) || 0, ok: confere(a?.valor || 0, partes.get(v.id) || 0) },
    });
  }
  for (const [idg, membros] of equipes) {
    const g = vend.find((x) => x.id === idg);
    const tot = membros.reduce((s, m) => s + (m.a?.valor || 0), 0);
    const ant = membros.reduce((s, m) => s + (m.a?.valor_ant || 0), 0);
    const ord = [...membros].sort((x, y) => (y.a?.valor || 0) - (x.a?.valor || 0));
    fatos.push({
      id: `F-equipe-${idg}`, escopo: 'equipe', chave: String(idg), tipo: 'equipe', relevancia: 0.5,
      titulo: `Equipe ${g?.nome || idg}`,
      texto: `Equipe ${g?.nome || idg} (${fx.num(membros.length)} vendedores) nos últimos 30 dias: ${fx.moeda(tot)} (${fx.sinal(ant > 0 ? (tot / ant - 1) * 100 : null)}% vs 30 dias anteriores). Maiores: ${ord.slice(0, 3).map((m) => `${m.nome} ${fx.moeda(m.a?.valor || 0)}`).join(', ')}. Menores: ${ord.slice(-3).reverse().map((m) => `${m.nome} ${fx.moeda(m.a?.valor || 0)}`).join(', ')}.`,
      dados: { total: tot, anterior: ant },
      entidades: [`equipe:${idg}`, `vendedor:${idg}`, ...membros.map((m) => `vendedor:${m.id}`)],
    });
  }
  return fatos;
}

function fatosClientes(ref) {
  const perfis = db
    .prepare(
      `SELECT p.*, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.cidade, c.estado, c.segmento, c.porte, vd.nome_vendedor AS vendedor
         FROM cliente_perfil p JOIN dm_cliente c ON c.id_cliente = p.id_cliente LEFT JOIN dm_vendedor vd ON vd.id_vendedor = p.id_vendedor`,
    )
    .all();
  const marcas = new Map();
  for (const r of db.prepare('SELECT * FROM cliente_marca ORDER BY id_cliente, valor_90d DESC').all()) {
    if (!marcas.has(r.id_cliente)) marcas.set(r.id_cliente, []);
    marcas.get(r.id_cliente).push(r);
  }
  return perfis.map((p) => {
    const ms = marcas.get(p.id_cliente) || [];
    const top = ms.filter((m) => m.valor_90d > 0).slice(0, 3);
    const atrasadas = ms
      .filter((m) => m.compras >= 2 && m.intervalo_medio >= 5)
      .map((m) => ({ ...m, dias: Math.round((Date.parse(ref) - Date.parse(m.ultima)) / 86400000) }))
      .filter((m) => m.dias > 1.5 * m.intervalo_medio && m.dias <= 120)
      .sort((a, b) => b.valor / b.compras - a.valor / a.compras)
      .slice(0, 3);
    const variacao = p.valor_30d_ant > 0 ? (p.valor_30d / p.valor_30d_ant - 1) * 100 : null;
    return {
      id: `F-cli-${p.id_cliente}`, escopo: 'cliente', chave: String(p.id_cliente), tipo: 'cliente', relevancia: 0.3,
      titulo: `Cliente ${p.nome} (#${p.id_cliente})`,
      texto: `${p.nome} (#${p.id_cliente}, ${p.cidade}/${p.estado}, ${p.segmento}, porte ${p.porte}; vendedor ${p.vendedor || 'n/d'}): curva ${p.curva}, perfil “${p.segmento_rfv}”. 90 dias: ${fx.moeda(p.valor_90d)} em ${fx.num(p.pedidos_90d)} pedidos e ${fx.num(p.marcas_90d)} marcas; últimos 30 dias ${fx.moeda(p.valor_30d)} (${fx.sinal(variacao)}% vs 30 anteriores). Última compra ${fx.data(p.ultima_compra)} (${p.dias_sem_compra === 1 ? '1 dia' : `${fx.num(p.dias_sem_compra)} dias`})${p.intervalo_medio ? `; compra a cada ~${fx.num(p.intervalo_medio, 1)} dias` : ''}. Marcas principais: ${top.map((m) => `${m.marca} (${fx.moeda(m.valor_90d)})`).join(', ') || 'nenhum'}.${atrasadas.length ? ` Recompra atrasada: ${atrasadas.map((m) => `${m.marca} (há ${fx.num(m.dias)} dias; costuma ${fx.num(m.intervalo_medio)})`).join(', ')}.` : ''} Potencial estimado em 90 dias ${fx.moeda(p.potencial_90d)} (espaço de ${fx.moeda(p.gap_90d)}).`,
      dados: { curva: p.curva, segmento_rfv: p.segmento_rfv, valor_90d: p.valor_90d, gap_90d: p.gap_90d, variacao, atrasadas: atrasadas.length, id_vendedor: p.id_vendedor },
      entidades: [`cliente:${p.id_cliente}`, `vendedor:${p.id_vendedor}`, `cidade:${slug(`${p.cidade}-${p.estado}`)}`, `uf:${slug(p.estado)}`, `segmento:${slug(p.segmento)}`, ...top.map((m) => `marca:${slug(m.marca)}`), ...atrasadas.map((m) => `marca:${slug(m.marca)}`)],
    };
  });
}

/** Fatos de uma campanha (resumo, critérios validados, destaques, participantes e oportunidades). */
function fatosCampanha(camp, okEstoque) {
  const res = apurarComCache(camp.definicao);
  const c = res.campanha;
  const t = res.tempo;
  const r = res.resumo;
  const id = camp.id;
  const ent = [`campanha:${id}`, ...(c.fornecedor ? [`fabricante:${slug(c.fornecedor)}`] : [])];
  const nivel = c.participantes.nivel;
  const entPart = (chave) => (nivel === 'vendedor' ? `vendedor:${chave}` : nivel === 'equipe' ? `equipe:${chave}` : nivel === 'cliente' ? `cliente:${chave}` : nivel === 'estado' ? `uf:${slug(chave)}` : `${nivel}:${slug(chave)}`);
  const fatos = [];
  const tempoTxt =
    t.status === 'futura' ? `começa em ${fx.data(t.inicio)}` : t.status === 'encerrada' ? `período encerrado em ${fx.data(t.fim)}` : `dia ${fx.num(t.decorridos)} de ${fx.num(t.total)} dias ${t.calendario} (${fx.perc(t.progresso * 100)} do tempo; faltam ${fx.num(t.restantes)})`;
  if (t.status === 'futura') {
    fatos.push({
      id: `F-cmp-${id}`, escopo: 'campanha', chave: String(id), tipo: 'resumo', relevancia: 0.6,
      titulo: `Campanha “${camp.nome}”${c.fornecedor ? ` (${c.fornecedor})` : ''} (agendada)`,
      texto: `Campanha “${camp.nome}” (${c.nivel_rotulo.toLowerCase()}, ${fx.data(t.inicio)} a ${fx.data(t.fim)}) ainda não começou: ${tempoTxt}. ${fx.num(r.participantes)} participantes; ${fx.num(res.criterios.length)} critério(s): ${res.criterios.map((cr) => `“${cr.nome}” (${cr.produtos_descricao})`).join('; ')}.`,
      dados: { status_campanha: camp.status, tempo: { status: t.status }, resumo: r },
      entidades: ent,
    });
    return fatos;
  }
  fatos.push({
    id: `F-cmp-${id}`, escopo: 'campanha', chave: String(id), tipo: 'resumo', relevancia: 1,
    titulo: `Campanha “${camp.nome}”${c.fornecedor ? ` (${c.fornecedor})` : ''}`,
    texto: `Campanha “${camp.nome}” (${c.nivel_rotulo.toLowerCase()}, ${fx.data(t.inicio)} a ${fx.data(t.fim)}, dados até ${fx.data(t.referencia)}): ${tempoTxt}. Atingimento geral ${fx.perc(r.atingimento_geral)}, projeção ${fx.perc(r.atingimento_geral_proj)}. ${fx.num(r.participantes)} participantes: ${fx.num(r.atingiram)} atingiram, ${fx.num(r.no_ritmo)} no ritmo, ${fx.num(r.atencao)} em atenção, ${fx.num(r.risco)} em risco${r.nao_atingiu ? `, ${fx.num(r.nao_atingiu)} não atingiram` : ''}; ${fx.num(r.participantes - r.com_venda)} ainda sem venda. Prêmios: ${fx.moeda(r.premio_total)} apurados e ${fx.moeda(r.premio_proj_total)} projetados${r.orcamento ? ` para um orçamento de ${fx.moeda(r.orcamento)} (${fx.perc((r.uso_orcamento_proj || 0) * 100)} projetado)` : ''}.`,
    dados: { status_campanha: camp.status, tempo: { status: t.status, progresso: t.progresso, restantes: t.restantes }, resumo: r },
    entidades: ent,
  });

  res.criterios.forEach((cr, i) => {
    const val = validarCriterioDireto(res, i);
    const tot = cr.total;
    fatos.push({
      id: `F-cmp-${id}-c-${cr.id}`, escopo: 'campanha', chave: String(id), tipo: 'criterio', relevancia: 0.9,
      titulo: `“${camp.nome}” · critério “${cr.nome}”`,
      texto: `Critério “${cr.nome}” (${cr.metrica_nome}; ${cr.produtos_descricao}, ${fx.num(cr.n_produtos)} produtos${cr.peso !== 1 ? `, peso ${fx.num(cr.peso, 1)}` : ''}): realizado ${fmtCrit(cr, tot.realizado)} de meta ${fmtCrit(cr, tot.meta)} (${fx.perc(tot.atingimento)}), projeção ${fmtCrit(cr, tot.projecao)} (${fx.perc(tot.atingimento_proj)}). Período anterior (${fx.data(cr.periodo_base.inicio)} a ${fx.data(cr.periodo_base.fim)}): ${fmtCrit(cr, tot.base)}${tot.variacao_proj != null ? `; projeção ${fx.sinal(tot.variacao_proj)}% vs anterior` : ''}. Volume no critério até agora: ${fx.num(tot.qtd)} un e ${fx.moeda(tot.valor)}.`,
      dados: { ...tot, formato: cr.formato, unidade: cr.unidade },
      entidades: ent,
      validacao: val,
    });
  });

  const P = res.participantes;
  const descrever = (l, i0 = 0) => {
    const x = l.criterios[i0];
    const cr = res.criterios[i0];
    return `${l.nome} (${fx.num(l.posicao)}º, pontuação ${fx.perc(l.score)}, projeção ${fx.perc(l.score_proj)}${x?.falta > 0 ? `, falta ${fmtCrit(cr, x.falta)}` : ''}${l.premio_proj ? `, prêmio projetado ${fx.moeda(l.premio_proj)}` : ''})`;
  };
  fatos.push({
    id: `F-cmp-${id}-lideres`, escopo: 'campanha', chave: String(id), tipo: 'lideres', relevancia: 0.8,
    titulo: `Líderes de “${camp.nome}”`,
    texto: `Melhores colocados: ${P.slice(0, 5).map((l) => descrever(l)).join('; ')}.`,
    dados: { chaves: P.slice(0, 5).map((l) => l.chave) },
    entidades: [...ent, ...P.slice(0, 5).map((l) => entPart(l.chave))],
  });
  const emRisco = P.filter((l) => l.status === 'risco').sort((a, b) => (a.score_proj ?? 0) - (b.score_proj ?? 0));
  if (emRisco.length) {
    fatos.push({
      id: `F-cmp-${id}-risco`, escopo: 'campanha', chave: String(id), tipo: 'risco', relevancia: 0.85,
      titulo: `Participantes em risco em “${camp.nome}”`,
      texto: `${fx.num(emRisco.length)} participantes em risco (projeção abaixo de 85%). Mais atrasados: ${emRisco.slice(0, 8).map((l) => descrever(l)).join('; ')}.`,
      dados: { quantidade: emRisco.length, chaves: emRisco.slice(0, 8).map((l) => l.chave) },
      entidades: [...ent, ...emRisco.slice(0, 8).map((l) => entPart(l.chave))],
    });
  }
  const perto = P.filter((l) => l.proxima_faixa && l.proxima_faixa.falta_pontos <= 15 && l.status !== 'aguardando').sort((a, b) => a.proxima_faixa.falta_pontos - b.proxima_faixa.falta_pontos);
  if (perto.length) {
    const ganho = perto.reduce((s, l) => s + Math.max(0, (l.proxima_faixa.premio || 0) - (l.premio || 0)), 0);
    fatos.push({
      id: `F-cmp-${id}-faixa`, escopo: 'campanha', chave: String(id), tipo: 'perto_faixa', relevancia: 0.8,
      titulo: `Perto da próxima faixa em “${camp.nome}”`,
      texto: `${fx.num(perto.length)} participantes a até 15 pontos da próxima faixa de prêmio (ganho somado de ${fx.moeda(ganho)} se todos chegarem): ${perto.slice(0, 8).map((l) => `${l.nome} a ${fx.num(l.proxima_faixa.falta_pontos, 1)} pontos${l.proxima_faixa.falta_unidades != null ? ` (faltam ${fmtCrit(res.criterios[0], l.proxima_faixa.falta_unidades)})` : ''}, faixa vale ${fx.moeda(l.proxima_faixa.premio)}`).join('; ')}.`,
      dados: { quantidade: perto.length, ganho, chaves: perto.slice(0, 8).map((l) => l.chave) },
      entidades: [...ent, ...perto.slice(0, 8).map((l) => entPart(l.chave))],
    });
  }
  const semVenda = P.filter((l) => !l.vendeu && l.status !== 'aguardando');
  if (semVenda.length && t.status !== 'futura') {
    fatos.push({
      id: `F-cmp-${id}-semvenda`, escopo: 'campanha', chave: String(id), tipo: 'sem_venda', relevancia: 0.7,
      titulo: `Sem venda em “${camp.nome}”`,
      texto: `${fx.num(semVenda.length)} de ${fx.num(P.length)} participantes ainda não venderam nenhum produto da campanha com ${fx.perc(t.progresso * 100)} do tempo decorrido: ${semVenda.slice(0, 10).map((l) => l.nome).join(', ')}${semVenda.length > 10 ? '…' : ''}.`,
      dados: { quantidade: semVenda.length },
      entidades: [...ent, ...semVenda.slice(0, 10).map((l) => entPart(l.chave))],
    });
  }
  try {
    const est = estoqueDaCampanha(res).filter((e) => e.risco !== 'ok');
    if (est.length) {
      fatos.push({
        id: `F-cmp-${id}-estoque`, escopo: 'campanha', chave: String(id), tipo: 'estoque', relevancia: 0.75,
        titulo: `Estoque dos produtos de “${camp.nome}”`,
        texto: `${fx.num(est.length)} produtos da campanha com risco de faltar antes do fim (${fx.num(est[0]?.dias_campanha_restantes || 0)} dias restantes) ou abaixo do mínimo: ${est.slice(0, 6).map((e) => `${e.nome} (${fx.num(e.estoque)} un, cobre ${e.cobertura_dias == null ? 'n/d' : fx.num(e.cobertura_dias, 1)} dias)`).join('; ')}.`,
        dados: { quantidade: est.length, itens: est.slice(0, 10) },
        entidades: ent,
        validacao: { metodo: 'vendas × saída de estoque', ok: okEstoque },
      });
    }
  } catch {
    /* estoque indisponível */
  }

  // participantes (um fato por participante, com o número que interessa a ele)
  for (const l of P) {
    const partes = l.criterios.map((x, i) => {
      const cr = res.criterios[i];
      return `“${cr.nome}”: ${fmtCrit(cr, x.realizado)} de ${fmtCrit(cr, x.meta)} (${fx.perc(x.atingimento)}), projeção ${fmtCrit(cr, x.projecao)}${x.falta > 0 ? `, falta ${fmtCrit(cr, x.falta)}${x.ritmo_necessario ? ` (${fmtCrit(cr, x.ritmo_necessario)} por dia)` : ''}` : ''}`;
    });
    const pf = l.proxima_faixa;
    fatos.push({
      id: `F-par-${id}-${slug(l.chave)}`, escopo: 'participante', chave: `${id}:${l.chave}`, tipo: 'participante', relevancia: 0.5,
      titulo: `${l.nome} em “${camp.nome}”`,
      texto: `${l.nome}${l.grupo ? ` (${l.grupo})` : ''} em “${camp.nome}”: ${fx.num(l.posicao)}º de ${fx.num(P.length)}, ${STATUS_ROTULO[l.status] || l.status}, pontuação ${fx.perc(l.score)} (projeção ${fx.perc(l.score_proj)}). ${partes.join('; ')}. Prêmio apurado ${fx.moeda(l.premio)}, projetado ${fx.moeda(l.premio_proj)}.${pf ? ` Próxima faixa: ${fx.perc(pf.min)} (faltam ${fx.num(pf.falta_pontos, 1)} pontos${pf.falta_unidades != null ? `, ${fmtCrit(res.criterios[0], pf.falta_unidades)}` : ''}) vale ${fx.moeda(pf.premio)}.` : ''}`,
      dados: { campanha: id, chave: l.chave, posicao: l.posicao, status: l.status, score: l.score, score_proj: l.score_proj, falta_pontos: pf?.falta_pontos ?? null, vendeu: l.vendeu },
      entidades: [...ent, entPart(l.chave), ...(l.responsavel?.chave ? [`vendedor:${l.responsavel.chave}`] : [])],
    });
  }

  // oportunidades por participante (clientes que compravam os produtos e ainda não compraram na campanha)
  if (['vendedor', 'equipe'].includes(nivel) && t.status === 'andamento') {
    let ops = [];
    try {
      ops = oportunidadesDaCampanha(res, res.criterios[0].id, 3);
    } catch {
      ops = [];
    }
    for (const o of ops) {
      fatos.push({
        id: `F-opo-${id}-${slug(o.chave)}`, escopo: 'oportunidade', chave: `${id}:${o.chave}`, tipo: 'oportunidade', relevancia: o.status === 'risco' ? 0.7 : 0.55,
        titulo: `Clientes a atacar de ${o.nome} em “${camp.nome}”`,
        texto: `Clientes de ${o.nome} que compraram ${res.criterios[0].produtos_descricao} nos 120 dias antes de “${camp.nome}” e ainda não compraram na campanha: ${o.oportunidades.map((x) => `${x.nome} (#${x.id}, ${x.cidade}/${x.estado}; ${fx.moeda(x.valor_hist)} antes, última compra ${fx.data(x.ultima)})`).join('; ')}.`,
        dados: { campanha: id, chave: o.chave, status: o.status, clientes: o.oportunidades.map((x) => x.id) },
        entidades: [...ent, entPart(o.chave), ...o.oportunidades.map((x) => `cliente:${x.id}`)],
      });
    }
  }
  return fatos;
}

// ---------------------------------------------------------------------
// Persistência e atualização
// ---------------------------------------------------------------------

const PARADA = new Set('a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se ao aos as os ou e é ser foi sao são esta está estao estão tem ter ha há mais menos como qual quais quem onde quando muito pouco ja já nao não sim eu voce você ele ela eles elas isso isto esse essa este esta sobre entre ate até pelo pela pelos pelas lhe me te seu sua seus suas meu minha nosso nossa qualquer cada todo toda todos todas'.split(' '));

export function tokenizar(s) {
  return normalizarTexto(s)
    .replace(/[^a-z0-9#]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !PARADA.has(t));
}

function persistir(fatos) {
  const agora = agoraISO();
  transacao(() => {
    db.exec('DELETE FROM fato_ia');
    const st = db.prepare(
      'INSERT OR REPLACE INTO fato_ia (id, escopo, chave, tipo, titulo, texto, dados, entidades, termos, relevancia, validado, validacao, gerado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    for (const f of fatos) {
      const validado = f.validacao && f.validacao.ok === false ? 0 : 1;
      st.run(
        f.id, f.escopo, f.chave ?? null, f.tipo, f.titulo, f.texto, JSON.stringify(f.dados ?? null), (f.entidades || []).join(' '),
        tokenizar(`${f.titulo} ${f.texto}`).join(' '), f.relevancia ?? 0.3, validado, f.validacao ? JSON.stringify(f.validacao) : null, agora,
      );
    }
  });
  indiceCache = null;
}

let atualizando = null;
const pausa = () => new Promise((r) => setImmediate(r));

/**
 * Recalcula perfil (se preciso), conversões, backtest, verificações e todos os fatos.
 * No servidor, roda numa thread separada (server/trabalhador.js, com conexão própria ao SQLite)
 * para nunca travar as requisições. Chamadas concorrentes compartilham a mesma execução.
 */
export function atualizarConhecimento({ forcar = false } = {}) {
  if (atualizando) return atualizando;
  if (isMainThread && process.env.CONHECIMENTO_NA_THREAD_PRINCIPAL !== '1') {
    atualizando = new Promise((resolve, reject) => {
      const w = new Worker(new URL('./trabalhador.js', import.meta.url), { workerData: { tarefa: 'conhecimento', forcar } });
      w.once('message', (m) => (m?.erro ? reject(new Error(m.erro)) : resolve(m)));
      w.once('error', reject);
      w.once('exit', (cod) => cod !== 0 && reject(new Error(`trabalhador terminou com código ${cod}`)));
    }).finally(() => {
      atualizando = null;
      indiceCache = null; // fatos novos: refaz o índice de busca na próxima consulta
    });
    return atualizando;
  }
  return atualizarConhecimentoAgora({ forcar });
}

/** Execução efetiva (dentro do trabalhador). */
export function atualizarConhecimentoAgora({ forcar = false } = {}) {
  if (atualizando) return atualizando;
  atualizando = (async () => {
    const inicio = Date.now();
    try {
      const ref = dataReferenciaVendas();
      if (!ref) return { fatos: 0, validados: 0, invalidos: 0, duracao_ms: 0 };
      if (forcar || perfilDesatualizado()) {
        atualizarPerfis();
        await pausa();
        calcularBacktest();
        await pausa();
      } else if (!lerEstado('backtest')) {
        calcularBacktest();
        await pausa();
      }
      atualizarConversoes();
      await pausa();
      const verificacoes = verificarQualidade();
      await pausa();
      const okEstoque = verificacoes.find((v) => v.regra === 'vendas_x_estoque')?.ok !== 0;
      const fatos = [...fatosGerais(ref, verificacoes)];
      await pausa();
      fatos.push(...fatosMarcas(ref, verificacoes));
      await pausa();
      fatos.push(...fatosVendedores(ref));
      await pausa();
      fatos.push(...fatosClientes(ref));
      await pausa();
      let divergentes = 0;
      for (const camp of campanhasAtuais()) {
        try {
          const fs = fatosCampanha(camp, okEstoque);
          divergentes += fs.filter((f) => f.validacao?.ok === false).length;
          fatos.push(...fs);
        } catch (e) {
          console.error(`[conhecimento] campanha ${camp.id}:`, e.message);
        }
        await pausa();
      }
      // resumo da dupla validação motor × SQL (vira verificação e fato)
      const crits = fatos.filter((f) => f.tipo === 'criterio' && f.validacao?.aplicavel);
      if (crits.length) {
        const div = crits.filter((f) => f.validacao.ok === false);
        db.prepare('INSERT INTO verificacao_dados (regra, descricao, valor_a, valor_b, divergencias, ok, detalhe, criado_em) VALUES (?,?,?,?,?,?,?,?)').run(
          'motor_x_sql', 'Totais das campanhas: motor de apuração × consulta SQL independente', crits.length - div.length, crits.length, div.length, div.length ? 0 : 1,
          div.length ? `Divergência em: ${div.map((f) => f.titulo).join('; ')}` : `${crits.length} critérios conferidos (quantidade e valor)`, agoraISO(),
        );
        fatos.push({
          id: 'F-qual-motor_x_sql', escopo: 'qualidade', chave: 'motor_x_sql', tipo: 'verificacao', relevancia: div.length ? 1 : 0.3,
          titulo: 'Verificação de dados: totais das campanhas (motor × SQL independente)',
          texto: div.length ? `DIVERGÊNCIA em ${fx.num(div.length)} de ${fx.num(crits.length)} critérios; esses números foram retirados da análise.` : `Conferido: ${fx.num(crits.length)} critérios com quantidade e valor idênticos nos dois cálculos.`,
          dados: { conferidos: crits.length, divergentes: div.length },
        });
      }
      persistir(fatos);
      const r = { fatos: fatos.length, validados: fatos.filter((f) => f.validacao?.ok !== false).length, invalidos: fatos.filter((f) => f.validacao?.ok === false).length, divergentes, duracao_ms: Date.now() - inicio };
      gravarEstado('conhecimento', { ...r, atualizado_em: agoraISO(), assinatura: assinaturaConhecimento(), referencia: ref });
      return r;
    } finally {
      atualizando = null;
    }
  })();
  return atualizando;
}

export const conhecimentoDesatualizado = () => lerEstado('conhecimento')?.assinatura !== assinaturaConhecimento();
export const conhecimentoEmAtualizacao = () => Boolean(atualizando) || (isMainThread && statusPipeline().etapa_atual === 'conhecimento');

/**
 * Garante uma base para a IA. Só espera quando ainda não existe nenhum fato (primeira execução); se a base
 * está apenas desatualizada, usa a gravada e pede a pipeline (sem bloquear).
 */
export async function garantirConhecimento() {
  if (!db.prepare('SELECT 1 FROM fato_ia LIMIT 1').get()) await atualizarConhecimento();
  else if (conhecimentoDesatualizado() && isMainThread) dispararPipeline('dia', { origem: 'conhecimento' });
}

export function resumoConhecimento() {
  const e = lerEstado('conhecimento') || {};
  const t = db.prepare('SELECT COUNT(*) AS n, SUM(validado) AS v FROM fato_ia').get();
  const por = {};
  for (const r of db.prepare('SELECT escopo, COUNT(*) AS n FROM fato_ia GROUP BY escopo').all()) por[r.escopo] = r.n;
  return {
    fatos: t.n || 0,
    validados: t.v || 0,
    invalidos: (t.n || 0) - (t.v || 0),
    por_escopo: por,
    atualizado_em: e.atualizado_em || null,
    duracao_ms: e.duracao_ms ?? null,
    referencia: e.referencia || null,
    desatualizado: conhecimentoDesatualizado(),
    em_atualizacao: conhecimentoEmAtualizacao(),
  };
}

const linhaParaFato = (r) => ({
  id: r.id,
  escopo: r.escopo,
  chave: r.chave,
  tipo: r.tipo,
  titulo: r.titulo,
  texto: r.texto,
  dados: r.dados ? JSON.parse(r.dados) : null,
  relevancia: r.relevancia,
  validado: Boolean(r.validado),
  validacao: r.validacao ? JSON.parse(r.validacao) : null,
  gerado_em: r.gerado_em,
});

export function listarFatos({ escopo, chave, q, id, limite = 50, validados } = {}) {
  const where = [];
  const p = [];
  if (id) {
    const ids = String(id).split(',').filter(Boolean);
    where.push(`id IN (${ph(ids)})`);
    p.push(...ids);
  }
  if (escopo) {
    where.push('escopo = ?');
    p.push(escopo);
  }
  if (chave) {
    where.push('chave = ?');
    p.push(String(chave));
  }
  if (validados === true) where.push('validado = 1');
  if (validados === false) where.push('validado = 0');
  if (q) {
    const toks = tokenizar(q);
    for (const tk of toks) {
      where.push('(termos LIKE ? OR entidades LIKE ?)');
      p.push(`%${tk}%`, `%${tk}%`);
    }
  }
  return db
    .prepare(`SELECT * FROM fato_ia ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY validado ASC, relevancia DESC, id LIMIT ${Math.min(500, Math.trunc(limite) || 50)}`)
    .all(...p)
    .map(linhaParaFato);
}

// ---------------------------------------------------------------------
// Recuperação: linkagem de entidades + BM25
// ---------------------------------------------------------------------

let indiceCache = null;
const UF_NOMES = {
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara', DF: 'distrito federal', ES: 'espirito santo', GO: 'goias',
  MA: 'maranhao', MT: 'mato grosso', MS: 'mato grosso do sul', MG: 'minas gerais', PA: 'para', PB: 'paraiba', PR: 'parana', PE: 'pernambuco',
  PI: 'piaui', RJ: 'rio de janeiro', RN: 'rio grande do norte', RS: 'rio grande do sul', RO: 'rondonia', RR: 'roraima', SC: 'santa catarina',
  SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins',
};

function indice() {
  const n = db.prepare('SELECT COUNT(*) AS n, MAX(gerado_em) AS g FROM fato_ia').get();
  const versao = `${n.n}:${n.g}`;
  if (indiceCache?.versao === versao) return indiceCache;
  const fatos = db.prepare('SELECT * FROM fato_ia').all();
  const df = new Map();
  let somaDl = 0;
  const docs = fatos.map((f) => {
    const toks = (f.termos || '').split(' ').filter(Boolean);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    somaDl += toks.length;
    return { f, tf, dl: toks.length, ents: new Set((f.entidades || '').split(' ').filter(Boolean)) };
  });
  // dicionário de entidades para linkagem
  const dic = [];
  const addEnt = (nome, chave) => {
    const n2 = normalizarTexto(nome).replace(/[^a-z0-9]+/g, ' ').trim();
    if (n2.length >= 3) dic.push({ nome: n2, chave });
  };
  for (const v of db.prepare('SELECT id_vendedor, nome_vendedor, nivel FROM dm_vendedor').all()) {
    addEnt(v.nome_vendedor, `vendedor:${v.id_vendedor}`);
    if (String(v.nivel).toLowerCase() === 'gerente') addEnt(`equipe ${v.nome_vendedor}`, `equipe:${v.id_vendedor}`);
  }
  for (const c of db.prepare('SELECT id_cliente, nome_fantasia, nome_cliente FROM dm_cliente').all()) {
    if (c.nome_fantasia) addEnt(c.nome_fantasia, `cliente:${c.id_cliente}`);
    if (c.nome_cliente) addEnt(c.nome_cliente, `cliente:${c.id_cliente}`);
  }
  for (const m of db.prepare('SELECT DISTINCT marca, fabricante FROM dm_produto').all()) {
    if (m.marca) addEnt(m.marca, `marca:${slug(m.marca)}`);
    if (m.fabricante) addEnt(m.fabricante, `fabricante:${slug(m.fabricante)}`);
  }
  for (const c of db.prepare('SELECT id, nome FROM campanha').all()) addEnt(c.nome, `campanha:${c.id}`);
  for (const c of db.prepare('SELECT DISTINCT cidade, estado FROM dm_cliente').all()) addEnt(c.cidade, `cidade:${slug(`${c.cidade}-${c.estado}`)}`);
  for (const [uf, nome] of Object.entries(UF_NOMES)) addEnt(nome, `uf:${uf.toLowerCase()}`);
  for (const s of db.prepare('SELECT DISTINCT segmento FROM dm_cliente').all()) if (s.segmento) addEnt(s.segmento, `segmento:${slug(s.segmento)}`);
  dic.sort((a, b) => b.nome.length - a.nome.length);
  indiceCache = { versao, docs, df, n: docs.length || 1, avgdl: somaDl / (docs.length || 1), dic };
  return indiceCache;
}

/** Entidades citadas num texto livre (pergunta). */
export function linkarEntidades(texto) {
  const idx = indice();
  let alvo = ` ${normalizarTexto(texto).replace(/[^a-z0-9#]+/g, ' ')} `;
  const achadas = [];
  for (const e of idx.dic) {
    if (alvo.includes(` ${e.nome} `)) {
      achadas.push(e.chave);
      alvo = alvo.replace(` ${e.nome} `, ' ');
    }
  }
  for (const m of String(texto).matchAll(/#(\d{1,7})/g)) achadas.push(`cliente:${m[1]}`);
  for (const m of String(texto).matchAll(/\b([A-Z]{2})\b/g)) if (UF_NOMES[m[1]]) achadas.push(`uf:${m[1].toLowerCase()}`);
  const nt = normalizarTexto(texto);
  for (const [tipo, re] of Object.entries(PALAVRAS_TIPO)) if (re.test(nt)) achadas.push(`tipo:${tipo}`);
  return [...new Set(achadas)];
}

const PALAVRAS_TIPO = {
  recompra: /recompra|deixou de comprar|parou de comprar/,
  cross_sell: /venda cruzada|cross|nunca comprou|mix novo/,
  queda: /queda|caiu|caindo|reduziu/,
  campanha: /positivar|positivacao/,
  inativo: /inativ|sem comprar|reativ/,
};

const estimarTokens = (f) => Math.ceil((f.titulo.length + f.texto.length + 24) / 3.2);

/**
 * Seleciona os fatos mais úteis para uma pergunta/contexto, dentro de um orçamento de tokens.
 * Só fatos validados (os divergentes ficam de fora, mas a verificação que acusou a divergência entra).
 */
export function recuperarFatos({ pergunta = '', contexto = {}, limite = 40, maxTokens = 6000, extras = [] } = {}) {
  const idx = indice();
  const ents = new Set([...linkarEntidades(pergunta), ...extras]);
  if (contexto.campanha) ents.add(`campanha:${contexto.campanha}`);
  if (contexto.vendedor) ents.add(`vendedor:${contexto.vendedor}`);
  if (contexto.cliente) ents.add(`cliente:${contexto.cliente}`);
  const qtoks = [...new Set(tokenizar(pergunta))];
  const k1 = 1.2;
  const b = 0.75;
  const pontuados = [];
  for (const d of idx.docs) {
    const f = d.f;
    if (!f.validado) continue;
    let s = (f.relevancia || 0) * 0.6;
    for (const t of qtoks) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      const dfi = idx.df.get(t) || 0;
      const idf = Math.log(1 + (idx.n - dfi + 0.5) / (dfi + 0.5));
      s += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.dl) / idx.avgdl)));
    }
    let ligados = 0;
    for (const e of ents) if (d.ents.has(e)) ligados++;
    if (ligados) {
      s += 4 + ligados * 2;
      // fato "do próprio" sujeito (ex.: o fato do vendedor citado) pesa mais que fatos que só o mencionam
      const [esc, ch] = [...ents][0]?.split(':') || [];
      if (esc && (f.escopo === esc && String(f.chave) === ch)) s += 6;
    }
    if (f.escopo === 'qualidade' && f.relevancia >= 1) s += 5; // divergências sempre visíveis
    if (s > 0.2) pontuados.push({ f, s });
  }
  pontuados.sort((a, b2) => b2.s - a.s);
  const out = [];
  let tokens = 0;
  for (const { f } of pontuados) {
    const tk = estimarTokens(f);
    if (out.length >= limite || tokens + tk > maxTokens) continue;
    out.push(linhaParaFato(f));
    tokens += tk;
  }
  return { fatos: out, entidades: [...ents], tokens };
}

/** Conjunto de fatos para uma análise estruturada (campanha, vendedor ou geral). */
export function fatosParaAnalise(tipo, referencia) {
  const pegar = (sql, ...p) => db.prepare(sql).all(...p);
  const sel = [];
  const ids = new Set();
  const add = (linhas) => {
    for (const l of linhas) {
      if (!l || ids.has(l.id) || !l.validado) continue;
      ids.add(l.id);
      sel.push(l);
    }
  };
  const qualidade = pegar("SELECT * FROM fato_ia WHERE escopo = 'qualidade' AND relevancia >= 1");
  if (tipo === 'campanha') {
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'campanha' AND chave = ? ORDER BY relevancia DESC", String(referencia)));
    const parts = pegar("SELECT * FROM fato_ia WHERE escopo = 'participante' AND chave LIKE ?", `${referencia}:%`).map((r) => ({ r, d: JSON.parse(r.dados || '{}') }));
    add(parts.filter((x) => x.d.posicao <= 5).map((x) => x.r));
    add(parts.filter((x) => x.d.status === 'risco').sort((a, b) => (a.d.score_proj ?? 0) - (b.d.score_proj ?? 0)).slice(0, 6).map((x) => x.r));
    add(parts.filter((x) => x.d.falta_pontos != null && x.d.falta_pontos <= 10).sort((a, b) => a.d.falta_pontos - b.d.falta_pontos).slice(0, 5).map((x) => x.r));
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'oportunidade' AND chave LIKE ? ORDER BY relevancia DESC LIMIT 8", `${referencia}:%`));
    add(pegar("SELECT * FROM fato_ia WHERE id IN ('F-geral-vendas', 'F-geral-estoque')"));
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'retroalimentacao' AND chave = 'campanha'"));
  } else if (tipo === 'vendedor') {
    const v = String(referencia);
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'vendedor' AND chave = ?", v));
    const sup = db.prepare('SELECT id_superior FROM dm_vendedor WHERE id_vendedor = ?').get(Number(v))?.id_superior;
    if (sup != null) add(pegar("SELECT * FROM fato_ia WHERE escopo = 'equipe' AND chave = ?", String(sup)));
    add(pegar("SELECT * FROM fato_ia WHERE escopo IN ('participante', 'oportunidade') AND (chave LIKE ? OR chave LIKE ?)", `%:${v}`, `%:${sup ?? '-'}`));
    add(
      pegar("SELECT * FROM fato_ia WHERE escopo = 'cliente' AND (' ' || entidades || ' ') LIKE ? ORDER BY json_extract(dados, '$.gap_90d') DESC LIMIT 8", `% vendedor:${v} %`),
    );
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'retroalimentacao'"));
    add(pegar("SELECT * FROM fato_ia WHERE id = 'F-geral-vendas'"));
  } else {
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'geral' ORDER BY relevancia DESC"));
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'campanha' AND tipo IN ('resumo', 'criterio', 'risco', 'perto_faixa', 'estoque') ORDER BY relevancia DESC LIMIT 24"));
    const vend = pegar("SELECT * FROM fato_ia WHERE escopo = 'vendedor' AND validado = 1").map((r) => ({ r, v: JSON.parse(r.dados || '{}').variacao ?? 0 }));
    vend.sort((a, b) => b.v - a.v);
    add(vend.slice(0, 4).map((x) => x.r));
    add(vend.slice(-4).map((x) => x.r));
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'equipe' LIMIT 6"));
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'retroalimentacao'"));
    add(pegar("SELECT * FROM fato_ia WHERE escopo = 'associacao' ORDER BY relevancia DESC LIMIT 5"));
  }
  add(qualidade);
  // limita ~6 mil tokens mantendo a ordem de prioridade
  const out = [];
  let tokens = 0;
  for (const f of sel) {
    const tk = estimarTokens(f);
    if (tokens + tk > 6500) continue;
    out.push(linhaParaFato(f));
    tokens += tk;
  }
  return { fatos: out, tokens };
}

export function assinaturaFatos(fatos) {
  return crypto.createHash('sha1').update(fatos.map((f) => `${f.id}|${f.texto}`).join('\n')).digest('hex');
}
