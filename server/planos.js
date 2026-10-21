import { isMainThread } from 'node:worker_threads';
import { db, agoraISO, transacao } from './db.js';
import { addDias, diasEntre, hojeISO } from './calendario.js';
import { apurar, apurarComCache, oportunidadesDaCampanha } from './motor.js';
import { assinaturaBase, dispararPipeline, hash } from './pipeline.js';
import { VENDA_VALIDA, dataReferenciaVendas, fx, gravarEstado, lerEstado } from './perfil.js';

// Planos de ataque por vendedor, montados só com dados reais de compra, e a retroalimentação:
// cada sugestão registrada é acompanhada até virar compra (convertida) ou expirar; as taxas reais
// por tipo (e um backtest no histórico) calibram a probabilidade usada no score.

db.exec(`
CREATE TABLE IF NOT EXISTS recomendacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origem TEXT NOT NULL,
  tipo TEXT NOT NULL,
  id_vendedor INTEGER,
  id_cliente INTEGER,
  id_campanha INTEGER,
  marcas TEXT,
  motivo TEXT,
  valor_potencial REAL,
  score REAL,
  probabilidade REAL,
  status TEXT NOT NULL DEFAULT 'aberta',
  data_base TEXT,
  expira_em TEXT,
  convertida_em TEXT,
  valor_convertido REAL,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recomendacao_status ON recomendacao(status, id_vendedor);
CREATE INDEX IF NOT EXISTS ix_recomendacao_cliente ON recomendacao(id_cliente);
CREATE TABLE IF NOT EXISTS taxa_conversao (
  tipo TEXT NOT NULL, fonte TEXT NOT NULL,
  total INTEGER, convertidas INTEGER, taxa REAL, valor_convertido REAL, calculado_em TEXT,
  PRIMARY KEY (tipo, fonte)
);
`);

export const TIPOS_PLANO = {
  recompra: { rotulo: 'Recompra atrasada', prior: 0.35, descricao: 'Cliente passou do intervalo habitual de compra da marca.' },
  campanha: { rotulo: 'Positivar na campanha', prior: 0.3, descricao: 'Comprava os produtos da campanha e ainda não comprou nela.' },
  queda: { rotulo: 'Queda de compra', prior: 0.25, descricao: 'Comprou bem menos nos últimos 30 dias que nos 30 anteriores.' },
  cross_sell: { rotulo: 'Venda cruzada', prior: 0.15, descricao: 'Marca que clientes parecidos compram e este cliente nunca comprou.' },
  inativo: { rotulo: 'Cliente inativo', prior: 0.12, descricao: 'Sem comprar há mais de 45 dias.' },
};

const K_SUAVIZACAO = 10;

// ======================================================================
// Taxas de conversão (retroalimentação + backtest)
// ======================================================================

/** Taxa usada no score por tipo: registros reais suavizados pelo backtest (ou prior). */
export function taxasConversao() {
  const linhas = db.prepare('SELECT * FROM taxa_conversao').all();
  const por = (tipo, fonte) => linhas.find((l) => l.tipo === tipo && l.fonte === fonte);
  const reg = new Map(
    db.prepare(
      `SELECT tipo, COUNT(*) AS total, SUM(status = 'convertida') AS convertidas, SUM(COALESCE(valor_convertido, 0)) AS valor
         FROM recomendacao WHERE status IN ('convertida', 'expirada') GROUP BY tipo`,
    ).all().map((r) => [r.tipo, r]),
  );
  const abertas = new Map(db.prepare("SELECT tipo, COUNT(*) AS n FROM recomendacao WHERE status = 'aberta' GROUP BY tipo").all().map((r) => [r.tipo, r.n]));
  return Object.entries(TIPOS_PLANO).map(([tipo, def]) => {
    const bt = por(tipo, 'backtest');
    const r = reg.get(tipo);
    const base = bt && bt.total >= 20 ? bt.taxa : def.prior;
    let taxa = base;
    let fonte = bt && bt.total >= 20 ? 'backtest' : 'referência';
    if (r && r.total > 0) {
      taxa = (r.convertidas + K_SUAVIZACAO * base) / (r.total + K_SUAVIZACAO);
      fonte = r.total >= K_SUAVIZACAO ? 'registros' : `${fonte} + registros`;
    }
    return {
      tipo,
      rotulo: def.rotulo,
      prior: def.prior,
      backtest: bt ? { total: bt.total, convertidas: bt.convertidas, taxa: bt.taxa, valor_convertido: bt.valor_convertido, calculado_em: bt.calculado_em } : null,
      registros: { total: r?.total || 0, convertidas: r?.convertidas || 0, taxa: r?.total ? r.convertidas / r.total : null, valor_convertido: r?.valor || 0, abertas: abertas.get(tipo) || 0 },
      taxa,
      fonte,
    };
  });
}

const mapaTaxas = () => new Map(taxasConversao().map((t) => [t.tipo, t.taxa]));

/**
 * Backtest: aplica as regras como se a data de referência fosse 30 dias atrás e mede
 * quantas sugestões converteram nos 30 dias seguintes. Calibra as taxas sem esperar dados novos.
 */
export function calcularBacktest() {
  const ref = dataReferenciaVendas();
  if (!ref) return [];
  const ref0 = addDias(ref, -30);
  const minimo = db.prepare(`SELECT MIN(v.data_pedido) AS d FROM fato_vendas v WHERE ${VENDA_VALIDA}`).get()?.d;
  if (!minimo || diasEntre(minimo, ref0) < 20) return [];
  const agora = agoraISO();
  const resultados = [];

  // recompra atrasada em ref0 → comprou a marca nos 30 dias seguintes?
  const rec = db
    .prepare(
      `WITH h AS (
         SELECT v.id_cliente, p.marca, COUNT(DISTINCT v.data_pedido) AS n, MIN(v.data_pedido) AS pri, MAX(v.data_pedido) AS ult
           FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
          WHERE ${VENDA_VALIDA} AND v.data_pedido <= ? GROUP BY 1, 2 HAVING COUNT(DISTINCT v.data_pedido) >= 2
       ), alvo AS (
         SELECT * FROM h WHERE (julianday(ult) - julianday(pri)) / (n - 1) >= 5
                           AND julianday(?) - julianday(ult) > 1.5 * ((julianday(ult) - julianday(pri)) / (n - 1))
                           AND julianday(?) - julianday(ult) <= 120
       ), depois AS (
         SELECT v.id_cliente, p.marca, SUM(v.valor_total) AS valor FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
          WHERE ${VENDA_VALIDA} AND v.data_pedido > ? AND v.data_pedido <= ? GROUP BY 1, 2
       )
       SELECT COUNT(*) AS total, SUM(d.valor IS NOT NULL) AS conv, SUM(COALESCE(d.valor, 0)) AS valor
         FROM alvo a LEFT JOIN depois d ON d.id_cliente = a.id_cliente AND d.marca = a.marca`,
    )
    .get(ref0, ref0, ref0, ref0, ref);
  resultados.push(['recompra', rec.total, rec.conv || 0, rec.valor || 0]);

  // queda em ref0 → recuperou (≥ 80% do valor anterior) nos 30 dias seguintes?
  const q = db
    .prepare(
      `WITH c AS (
         SELECT v.id_cliente,
                SUM(CASE WHEN v.data_pedido > ? AND v.data_pedido <= ? THEN v.valor_total ELSE 0 END) AS atual,
                SUM(CASE WHEN v.data_pedido > ? AND v.data_pedido <= ? THEN v.valor_total ELSE 0 END) AS anterior,
                SUM(CASE WHEN v.data_pedido > ? AND v.data_pedido <= ? THEN v.valor_total ELSE 0 END) AS depois
           FROM fato_vendas v WHERE ${VENDA_VALIDA} GROUP BY v.id_cliente
       )
       SELECT COUNT(*) AS total, SUM(depois >= 0.8 * anterior) AS conv, SUM(CASE WHEN depois >= 0.8 * anterior THEN depois ELSE 0 END) AS valor
         FROM c WHERE anterior >= 300 AND atual < 0.6 * anterior`,
    )
    .get(addDias(ref0, -30), ref0, addDias(ref0, -60), addDias(ref0, -30), ref0, ref);
  resultados.push(['queda', q.total, q.conv || 0, q.valor || 0]);

  // inativo (> 45 dias sem comprar em ref0) → voltou a comprar?
  const ina = db
    .prepare(
      `WITH u AS (SELECT v.id_cliente, MAX(v.data_pedido) AS ult FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido <= ? GROUP BY 1),
            d AS (SELECT v.id_cliente, SUM(v.valor_total) AS valor FROM fato_vendas v WHERE ${VENDA_VALIDA} AND v.data_pedido > ? AND v.data_pedido <= ? GROUP BY 1)
       SELECT COUNT(*) AS total, SUM(d.valor IS NOT NULL) AS conv, SUM(COALESCE(d.valor, 0)) AS valor
         FROM u LEFT JOIN d ON d.id_cliente = u.id_cliente WHERE julianday(?) - julianday(u.ult) > 45`,
    )
    .get(ref0, ref0, ref, ref0);
  resultados.push(['inativo', ina.total, ina.conv || 0, ina.valor || 0]);

  // venda cruzada por pares (segmento × porte): marca com penetração ≥ 50% nos pares e nunca comprada pelo cliente até ref0
  db.exec('DROP TABLE IF EXISTS temp._plano_cm; DROP TABLE IF EXISTS temp._plano_pen');
  db.prepare(
    `CREATE TEMP TABLE _plano_cm AS
     SELECT DISTINCT v.id_cliente, p.marca FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
      WHERE ${VENDA_VALIDA} AND v.data_pedido <= ?`,
  ).run(ref0);
  db.exec('CREATE INDEX temp.ix_plano_cm ON _plano_cm(id_cliente, marca)');
  db.exec(`CREATE TEMP TABLE _plano_pen AS
     SELECT c.segmento, c.porte, cm.marca, COUNT(*) * 1.0 / g.n AS pen
       FROM _plano_cm cm JOIN dm_cliente c ON c.id_cliente = cm.id_cliente
       JOIN (SELECT segmento, porte, COUNT(*) AS n FROM dm_cliente WHERE id_cliente IN (SELECT id_cliente FROM _plano_cm) GROUP BY 1, 2) g
         ON g.segmento = c.segmento AND g.porte = c.porte
      GROUP BY c.segmento, c.porte, cm.marca`);
  const cs = db
    .prepare(
      `WITH cand AS (
         SELECT c.id_cliente, pe.marca FROM dm_cliente c JOIN _plano_pen pe ON pe.segmento = c.segmento AND pe.porte = c.porte
          WHERE pe.pen >= 0.5 AND c.id_cliente IN (SELECT id_cliente FROM _plano_cm)
            AND NOT EXISTS (SELECT 1 FROM _plano_cm x WHERE x.id_cliente = c.id_cliente AND x.marca = pe.marca)
       ), d AS (
         SELECT v.id_cliente, p.marca, SUM(v.valor_total) AS valor FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
          WHERE ${VENDA_VALIDA} AND v.data_pedido > ? AND v.data_pedido <= ? GROUP BY 1, 2
       )
       SELECT COUNT(*) AS total, SUM(d.valor IS NOT NULL) AS conv, SUM(COALESCE(d.valor, 0)) AS valor
         FROM cand LEFT JOIN d ON d.id_cliente = cand.id_cliente AND d.marca = cand.marca`,
    )
    .get(ref0, ref);
  db.exec('DROP TABLE IF EXISTS temp._plano_cm; DROP TABLE IF EXISTS temp._plano_pen');
  resultados.push(['cross_sell', cs.total, cs.conv || 0, cs.valor || 0]);

  transacao(() => {
    db.prepare("DELETE FROM taxa_conversao WHERE fonte = 'backtest'").run();
    const st = db.prepare("INSERT INTO taxa_conversao (tipo, fonte, total, convertidas, taxa, valor_convertido, calculado_em) VALUES (?, 'backtest', ?, ?, ?, ?, ?)");
    for (const [tipo, total, conv, valor] of resultados) st.run(tipo, total || 0, conv, total ? conv / total : null, valor, agora);
  });
  gravarEstado('backtest', { referencia: ref0, ate: ref, calculado_em: agora });
  return resultados.map(([tipo, total, convertidas, valor]) => ({ tipo, total, convertidas, taxa: total ? convertidas / total : null, valor }));
}

// ======================================================================
// Dados prontos. O plano de cada vendedor e o resumo de cada equipe ficam gravados no banco com a
// assinatura dos insumos (etapa "planos" da pipeline, em server/etapas/inteligencia.js). As rotas só
// leem; se a assinatura mudou, devolvem o último resultado gravado (marcado "atualizando") e pedem a
// pipeline, sem bloquear. Os insumos reaproveitáveis (taxas, associações, ticket, penetração e
// oportunidades por campanha) também ficam gravados, cada um com a sua assinatura, para o recálculo
// refazer só o que mudou.
// ======================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS plano_insumo (
  chave TEXT PRIMARY KEY, assinatura TEXT NOT NULL, json TEXT NOT NULL, gerado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plano_pronto (
  escopo TEXT NOT NULL, chave TEXT NOT NULL, assinatura TEXT NOT NULL, json TEXT NOT NULL, resumo TEXT, gerado_em TEXT NOT NULL,
  PRIMARY KEY (escopo, chave)
);
`);

const LIMITE_GRAVADO = 200; // itens gravados por vendedor (a tela mostra 60; a equipe resume 200)

const estadoPerfis = () =>
  db.prepare("SELECT group_concat(chave || '=' || valor, '|') AS s FROM (SELECT chave, valor FROM inteligencia_estado WHERE chave IN ('perfil', 'backtest', 'conversoes') ORDER BY chave)").get()?.s || '';
const assinaturaComum = () => `${assinaturaBase()}|${hash(estadoPerfis())}`;
const assinaturaCampanha = (c) => `${assinaturaBase()}|${hojeISO()}|${c.id}@${c.atualizado_em}`;

/** Assinatura de tudo de que o plano depende: vendas, dia, perfis e conversões, campanhas ativas. Barata. */
// Suba quando mudar o formato ou a regra do que é gravado: força o recálculo de todos os prontos.
const VERSAO_PLANOS = 2;

export function assinaturaPlanos() {
  const camp = db.prepare("SELECT group_concat(id || '@' || atualizado_em, ',') AS s FROM (SELECT id, atualizado_em FROM campanha WHERE status = 'ativa' ORDER BY id)").get()?.s || '';
  return `v${VERSAO_PLANOS}|${assinaturaBase()}|${hojeISO()}|${hash(estadoPerfis(), camp)}`;
}

function lerInsumo(chave, assinatura) {
  const r = db.prepare('SELECT assinatura, json FROM plano_insumo WHERE chave = ?').get(chave);
  return r && r.assinatura === assinatura ? JSON.parse(r.json) : null;
}
function gravarInsumo(chave, assinatura, valor) {
  db.prepare(
    `INSERT INTO plano_insumo (chave, assinatura, json, gerado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET assinatura = excluded.assinatura, json = excluded.json, gerado_em = excluded.gerado_em`,
  ).run(chave, assinatura, JSON.stringify(valor), agoraISO());
}

const memo = { comum: null, campanhas: new Map() };

/** Consultas iguais para todos os vendedores (taxas, associações entre marcas, ticket e penetração por grupo). */
function dadosComuns() {
  const sig = assinaturaComum();
  if (memo.comum?.sig === sig) return memo.comum.valor;
  let bruto = lerInsumo('comum', sig);
  if (!bruto) {
    const pen = new Map();
    const penetracao = db
      .prepare(
        `SELECT c.segmento, c.porte, cm.marca, COUNT(*) * 1.0 / g.n AS pen
           FROM cliente_marca cm JOIN dm_cliente c ON c.id_cliente = cm.id_cliente
           JOIN (SELECT segmento, porte, COUNT(*) AS n FROM dm_cliente GROUP BY 1, 2) g ON g.segmento = c.segmento AND g.porte = c.porte
          WHERE cm.valor_90d > 0 GROUP BY c.segmento, c.porte, cm.marca HAVING pen >= 0.5`,
      )
      .all();
    for (const p of penetracao) {
      const k = `${p.segmento}|${p.porte}`;
      if (!pen.has(k)) pen.set(k, []);
      pen.get(k).push(p);
    }
    bruto = {
      taxas: [...mapaTaxas()],
      assoc: db.prepare('SELECT marca_a, marca_b, confianca, lift, clientes_ab FROM associacao_marca WHERE confianca >= 0.35 AND lift >= 1.1 ORDER BY lift DESC').all(),
      ticket: db.prepare('SELECT marca, AVG(valor_90d) / 3 AS mensal FROM cliente_marca WHERE valor_90d > 0 GROUP BY marca').all().map((r) => [r.marca, r.mensal]),
      pen: [...pen],
    };
    gravarInsumo('comum', sig, bruto);
  }
  const valor = { taxas: new Map(bruto.taxas), assoc: bruto.assoc, ticketMarca: new Map(bruto.ticket), penPorGrupo: new Map(bruto.pen) };
  memo.comum = { sig, valor };
  return valor;
}

/** Índice do critério mais atrasado de um participante. */
function criterioMaisAtrasado(linha) {
  let idx = 0;
  linha.criterios.forEach((x, i) => {
    if ((x.atingimento ?? 999) < (linha.criterios[idx].atingimento ?? 999)) idx = i;
  });
  return idx;
}

/**
 * O que o plano precisa de uma campanha ativa, em forma compacta: situação de cada participante que
 * ainda não atingiu (critério mais atrasado) e as oportunidades dele, calculadas em lote (a base da
 * campanha é montada uma vez por critério, não uma vez por vendedor). Gravado com a assinatura da
 * campanha: só é refeito quando a campanha, as vendas ou o dia mudam.
 */
function insumoCampanha(c) {
  const sig = assinaturaCampanha(c);
  const chave = `campanha:${c.id}`;
  const m = memo.campanhas.get(chave);
  if (m?.sig === sig) return m.valor;
  let valor = lerInsumo(chave, sig);
  if (!valor) {
    valor = { id: c.id, nome: c.nome, ativa: false };
    try {
      const definicao = JSON.parse(c.definicao);
      let res = apurarComCache(definicao);
      const nivel = res.campanha.participantes.nivel;
      if (res.tempo.status === 'andamento' && ['vendedor', 'equipe'].includes(nivel)) {
        if (!res._interno) res = apurar(definicao); // apuração lida do banco não traz a base interna das oportunidades
        const participantes = {};
        const porCriterio = new Map();
        for (const l of res.participantes) {
          if (l.status === 'atingiu') continue;
          const idx = criterioMaisAtrasado(l);
          const cl = l.criterios[idx];
          participantes[l.chave] = { idx, atingimento: cl.atingimento ?? 0, falta: cl.falta ?? 0 };
          porCriterio.set(res.criterios[idx].id, idx);
        }
        const ops = {};
        for (const [idCriterio, idx] of porCriterio) {
          for (const p of oportunidadesDaCampanha(res, idCriterio, 15)) {
            if (participantes[p.chave]?.idx !== idx) continue;
            ops[p.chave] = p.oportunidades
              .filter((o) => o.valor_hist > 0)
              .map((o) => ({ id: o.id, valor_hist: o.valor_hist, qtd_hist: o.qtd_hist, ultima: o.ultima, pedidos_hist: o.pedidos_hist }));
          }
        }
        valor = {
          id: c.id, nome: c.nome, ativa: true, nivel, restantes: res.tempo.restantes, calendario: res.tempo.calendario,
          criterios: res.criterios.map((cr) => ({
            id: cr.id, nome: cr.nome, produtos_descricao: cr.produtos_descricao, formato: cr.formato, unidade: cr.unidade, produtos_amostra: (cr.produtos_amostra || []).slice(0, 3),
          })),
          participantes,
          ops,
        };
      }
    } catch (e) {
      valor.erro = e.message;
    }
    gravarInsumo(chave, sig, valor);
  }
  memo.campanhas.set(chave, { sig, valor });
  return valor;
}

const campanhasParaPlano = () =>
  db.prepare("SELECT id, nome, atualizado_em, definicao FROM campanha WHERE status = 'ativa' ORDER BY id").all().map(insumoCampanha).filter((c) => c.ativa);

// ======================================================================
// Geração do plano (roda na pipeline, dentro do trabalhador)
// ======================================================================

function vendedorInfo(id) {
  return db
    .prepare(
      `SELECT v.id_vendedor AS id, v.nome_vendedor AS nome, v.telefone, v.email, v.id_superior, g.nome_vendedor AS gerente
         FROM dm_vendedor v LEFT JOIN dm_vendedor g ON g.id_vendedor = v.id_superior WHERE v.id_vendedor = ?`,
    )
    .get(Number(id));
}

function carteira(idVendedor, ref) {
  return db
    .prepare(
      `SELECT c.id_cliente AS id, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.cidade, c.estado, c.segmento, c.porte,
              p.curva, p.segmento_rfv, p.valor_90d, p.valor_30d, p.valor_30d_ant, p.dias_sem_compra, p.intervalo_medio, p.ultima_compra
         FROM dm_cliente c LEFT JOIN cliente_perfil p ON p.id_cliente = c.id_cliente
        WHERE c.id_vendedor = ?
           OR c.id_cliente IN (SELECT DISTINCT id_cliente FROM fato_vendas WHERE id_vendedor = ? AND data_pedido > ?)`,
    )
    .all(Number(idVendedor), Number(idVendedor), addDias(ref, -90));
}

/** Plano completo de um vendedor: todos os motivos, até LIMITE_GRAVADO itens, em ordem de prioridade. */
function montarPlano(vendedor) {
  const ref = dataReferenciaVendas();
  const v = vendedorInfo(vendedor);
  if (!v) throw Object.assign(new Error('Vendedor não encontrado.'), { status: 404 });
  const cabecalho = { vendedor: { id: String(v.id), nome: v.nome, equipe: v.gerente || null, telefone: v.telefone, email: v.email }, referencia: ref, gerado_em: agoraISO() };
  if (!ref) return { ...cabecalho, carteira: 0, total_encontrado: 0, itens: [] };

  const { taxas, assoc, ticketMarca, penPorGrupo } = dadosComuns();
  const clientes = carteira(v.id, ref);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const ids = clientes.map((c) => c.id);
  const lista = ids.length ? ids.join(',') : '-1';
  const itens = [];
  const base = (c) => ({
    id_cliente: c.id, cliente: c.nome, cidade: c.cidade, estado: c.estado, segmento: c.segmento, porte: c.porte,
    curva: c.curva, segmento_rfv: c.segmento_rfv,
  });
  const empurrar = (c, tipo, extra, urgencia = 1) => {
    const prob = taxas.get(tipo) ?? TIPOS_PLANO[tipo].prior;
    itens.push({
      chave: `${tipo}:${c.id}${extra.id_campanha ? `:${extra.id_campanha}` : ''}`,
      ...base(c),
      tipo,
      tipo_rotulo: TIPOS_PLANO[tipo].rotulo,
      ...extra,
      valor_potencial: Math.round(extra.valor_potencial * 100) / 100,
      probabilidade: prob,
      taxa_conversao_tipo: prob,
      urgencia: Math.round(urgencia * 100) / 100,
      score: Math.round(extra.valor_potencial * prob * urgencia * 100) / 100,
    });
  };

  { // motivos do histórico de compra: recompra, queda, inativo e venda cruzada
    // ---- recompra atrasada (cliente × marca)
    const atrasos = db
      .prepare(
        `SELECT id_cliente, marca, compras, ultima, intervalo_medio, valor, qtd,
                julianday(?) - julianday(ultima) AS dias
           FROM cliente_marca
          WHERE id_cliente IN (${lista}) AND compras >= 2 AND intervalo_medio >= 5
            AND julianday(?) - julianday(ultima) > 1.5 * intervalo_medio AND julianday(?) - julianday(ultima) <= 120
          ORDER BY id_cliente, valor / compras DESC`,
      )
      .all(ref, ref, ref);
    const porCliente = new Map();
    for (const a of atrasos) {
      if (!porCliente.has(a.id_cliente)) porCliente.set(a.id_cliente, []);
      porCliente.get(a.id_cliente).push(a);
    }
    for (const [idc, l] of porCliente) {
      const c = porId.get(idc);
      const top = l.slice(0, 3);
      const potencial = top.reduce((s, a) => s + a.valor / a.compras, 0);
      const razao = Math.max(...top.map((a) => a.dias / a.intervalo_medio));
      empurrar(c, 'recompra', {
        titulo: `Recompra de ${top.map((a) => a.marca).join(', ')}`,
        motivo: top.length === 1
          ? `Compra ${top[0].marca} a cada ~${fx.num(top[0].intervalo_medio)} dias e está há ${fx.num(top[0].dias)} dias sem comprar (${fx.num(top[0].dias - top[0].intervalo_medio)} dias além do habitual). Ticket médio da marca: ${fx.moeda(top[0].valor / top[0].compras)} por compra.`
          : `${top.length} marcas passaram do intervalo habitual: ${top.map((a) => `${a.marca} (${fx.num(a.dias)} dias; costuma ${fx.num(a.intervalo_medio)})`).join(', ')}.`,
        produtos_sugeridos: top.map((a) => ({ marca: a.marca })),
        evidencias: top.map((a) => `${a.marca}: ${fx.num(a.compras)} compras, ${fx.moeda(a.valor)} no total, última em ${fx.data(a.ultima)}`),
        valor_potencial: potencial,
      }, Math.min(2, Math.max(1, razao / 1.5)));
    }

    // ---- queda de compra (30d vs 30d anteriores)
    for (const c of clientes) {
      if (!(c.valor_30d_ant >= 300) || !(c.valor_30d < 0.6 * c.valor_30d_ant)) continue;
      const quedas = db
        .prepare(
          `SELECT marca, valor_30d_ant - valor_30d AS queda FROM cliente_marca
            WHERE id_cliente = ? AND valor_30d_ant > valor_30d ORDER BY queda DESC LIMIT 3`,
        )
        .all(c.id);
      const pct = (1 - c.valor_30d / c.valor_30d_ant) * 100;
      empurrar(c, 'queda', {
        titulo: `Recuperar volume (${fx.sinal(-pct)}%)`,
        motivo: `Comprou ${fx.moeda(c.valor_30d_ant)} nos 30 dias anteriores e ${fx.moeda(c.valor_30d)} nos últimos 30 (${fx.sinal(-pct)}%).${quedas.length ? ` Maiores quedas: ${quedas.map((q) => `${q.marca} (−${fx.moeda(q.queda)})`).join(', ')}.` : ''}`,
        produtos_sugeridos: quedas.map((q) => ({ marca: q.marca })),
        evidencias: [`Últimos 30 dias: ${fx.moeda(c.valor_30d)}`, `30 dias anteriores: ${fx.moeda(c.valor_30d_ant)}`, `Curva ${c.curva || 'n/d'} · ${c.segmento_rfv || 'n/d'}`],
        valor_potencial: c.valor_30d_ant - c.valor_30d,
      }, 1 + Math.min(0.5, pct / 200));
    }

    // ---- inativo
    for (const c of clientes) {
      if (!(c.dias_sem_compra > 45)) continue;
      const mensal = (c.valor_90d || 0) / 3;
      empurrar(c, 'inativo', {
        titulo: `Reativar (${fx.num(c.dias_sem_compra)} dias sem comprar)`,
        motivo: `Sem comprar há ${fx.num(c.dias_sem_compra)} dias${c.intervalo_medio ? `; antes comprava a cada ~${fx.num(c.intervalo_medio)} dias` : ''}. Última compra em ${fx.data(c.ultima_compra)}.`,
        produtos_sugeridos: [],
        evidencias: [`Valor nos últimos 90 dias: ${fx.moeda(c.valor_90d)}`],
        valor_potencial: Math.max(mensal, 300),
      }, 1 + Math.min(1, (c.dias_sem_compra - 45) / 90));
    }

    // ---- venda cruzada: associação entre marcas (e, sem associação forte, penetração nos pares segmento × porte)
    const marcasCliente = new Map();
    for (const r of db.prepare(`SELECT id_cliente, marca, valor_90d FROM cliente_marca WHERE id_cliente IN (${lista})`).all()) {
      if (!marcasCliente.has(r.id_cliente)) marcasCliente.set(r.id_cliente, new Map());
      marcasCliente.get(r.id_cliente).set(r.marca, r.valor_90d);
    }
    for (const c of clientes) {
      const ja = marcasCliente.get(c.id) || new Map();
      const candidatos = [];
      for (const a of assoc) {
        if ((ja.get(a.marca_a) || 0) > 0 && !ja.has(a.marca_b)) {
          candidatos.push({ marca: a.marca_b, forca: a.confianca * a.lift, texto: `${fx.perc(a.confianca * 100)} dos clientes que compram ${a.marca_a} também compram ${a.marca_b} (${fx.num(a.lift, 2)}× a média)` });
        }
      }
      for (const p of penPorGrupo.get(`${c.segmento}|${c.porte}`) || []) {
        if (!ja.has(p.marca)) candidatos.push({ marca: p.marca, forca: p.pen, texto: `${fx.perc(p.pen * 100)} dos clientes ${c.segmento} de porte ${c.porte} compram ${p.marca}` });
      }
      const vistos = new Set();
      const top = candidatos.sort((a, b) => b.forca - a.forca).filter((x) => (vistos.has(x.marca) ? false : vistos.add(x.marca))).slice(0, 2);
      if (!top.length) continue;
      empurrar(c, 'cross_sell', {
        titulo: `Apresentar ${top.map((x) => x.marca).join(' e ')}`,
        motivo: `Nunca comprou ${top.map((x) => x.marca).join(' nem ')}. ${top[0].texto}.`,
        produtos_sugeridos: top.map((x) => ({ marca: x.marca })),
        evidencias: top.map((x) => x.texto),
        valor_potencial: top.reduce((s, x) => s + (ticketMarca.get(x.marca) || 0), 0),
      });
    }
  }

  // ---- campanhas ativas em que o vendedor (ou a equipe dele) ainda não atingiu
  for (const camp of campanhasParaPlano()) {
    const nivel = camp.nivel;
    const chave = nivel === 'vendedor' ? String(v.id) : String(v.id_superior ?? v.id);
    const sit = camp.participantes[chave];
    if (!sit) continue;
    const crit = camp.criterios[sit.idx];
    for (const o of (camp.ops[chave] || []).filter((o) => porId.has(o.id)).slice(0, 10)) {
      const c = porId.get(o.id);
      empurrar(c, 'campanha', {
        id_campanha: camp.id,
        campanha: { id: camp.id, nome: camp.nome },
        titulo: `Positivar em “${camp.nome}”`,
        motivo: `Comprou ${fx.moeda(o.valor_hist)} de ${crit.produtos_descricao} nos 120 dias antes da campanha (última compra em ${fx.data(o.ultima)}) e ainda não comprou nela. ${nivel === 'vendedor' ? 'Você está' : 'A equipe está'} em ${fx.perc(sit.atingimento)} no critério “${crit.nome}”${sit.falta > 0 ? `; faltam ${fx.valor(sit.falta, crit.formato)}${crit.unidade && crit.formato === 'numero' ? ` ${crit.unidade}` : ''}` : ''}.`,
        produtos_sugeridos: crit.produtos_amostra.map((nome) => ({ produto: nome })),
        evidencias: [`${fx.num(o.qtd_hist)} un em ${fx.num(o.pedidos_hist)} pedido(s) antes da campanha`, `Dias restantes: ${fx.num(camp.restantes)} (${camp.calendario})`],
        valor_potencial: o.valor_hist / Math.max(1, o.pedidos_hist || 1),
      }, camp.restantes <= 7 ? 1.6 : 1.25);
    }
  }

  itens.sort((a, b) => b.score - a.score);
  return { ...cabecalho, carteira: clientes.length, total_encontrado: itens.length, itens: itens.slice(0, LIMITE_GRAVADO) };
}

/** Recorte para a tela: filtro de campanha, limite e resumo (contas leves sobre o plano gravado). */
function recortar(plano, { campanha, limite = 60 } = {}) {
  const todos = campanha ? plano.itens.filter((i) => String(i.id_campanha) === String(campanha)) : plano.itens;
  const final = todos.slice(0, limite);
  const porTipo = {};
  for (const it of final) porTipo[it.tipo] = (porTipo[it.tipo] || 0) + 1;
  return {
    vendedor: plano.vendedor,
    referencia: plano.referencia,
    gerado_em: plano.gerado_em,
    resumo: {
      clientes: new Set(final.map((i) => i.id_cliente)).size,
      carteira: plano.carteira,
      potencial_total: Math.round(final.reduce((s, i) => s + i.valor_potencial, 0) * 100) / 100,
      valor_esperado: Math.round(final.reduce((s, i) => s + i.valor_potencial * i.probabilidade, 0) * 100) / 100,
      por_tipo: porTipo,
      total_encontrado: campanha ? todos.length : plano.total_encontrado,
    },
    itens: final,
  };
}

/** Linha do vendedor na visão da equipe. */
function resumoParaEquipe(plano) {
  const r = recortar(plano, { limite: LIMITE_GRAVADO }).resumo;
  return {
    id: plano.vendedor.id, vendedor: plano.vendedor.nome, clientes: r.clientes, carteira: r.carteira, potencial_total: r.potencial_total,
    valor_esperado: r.valor_esperado, por_tipo: r.por_tipo, acoes: Object.values(r.por_tipo).reduce((s, n) => s + n, 0),
  };
}

const gravarPlanoPronto = () =>
  db.prepare(
    `INSERT INTO plano_pronto (escopo, chave, assinatura, json, resumo, gerado_em) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(escopo, chave) DO UPDATE SET assinatura = excluded.assinatura, json = excluded.json, resumo = excluded.resumo, gerado_em = excluded.gerado_em`,
  );

/**
 * Etapa "planos" da pipeline: recalcula só os vendedores cuja assinatura gravada difere da atual
 * (todos, quando vendas, dia, perfis ou campanhas mudam; nenhum, quando nada mudou) e as equipes deles.
 * Os insumos de cada campanha e os comuns são reaproveitados do banco quando a assinatura deles bate.
 */
export async function atualizarPlanosProntos({ forcar = false, pausa = async () => {}, log = () => {} } = {}) {
  const inicio = Date.now();
  const sig = assinaturaPlanos();
  const ref = dataReferenciaVendas();
  if (!ref) return { linhas: 0 };
  dadosComuns();
  await pausa();
  campanhasParaPlano();
  await pausa();
  const vendedores = db.prepare('SELECT id_vendedor AS id, id_superior FROM dm_vendedor ORDER BY id_vendedor').all();
  const gravadas = new Map(db.prepare("SELECT chave, assinatura FROM plano_pronto WHERE escopo = 'vendedor'").all().map((r) => [r.chave, r.assinatura]));
  const up = gravarPlanoPronto();
  const agora = agoraISO();
  const equipesAfetadas = new Set();
  const vendedoresAfetados = new Set();
  let lote = [];
  let nVend = 0;
  const descarregar = () => {
    const l = lote;
    lote = [];
    transacao(() => l.forEach((a) => up.run(...a)));
  };
  for (const v of vendedores) {
    if (!forcar && gravadas.get(String(v.id)) === sig) continue;
    const p = montarPlano(v.id);
    lote.push(['vendedor', String(v.id), sig, JSON.stringify(p), JSON.stringify(resumoParaEquipe(p)), agora]);
    if (v.id_superior != null) equipesAfetadas.add(String(v.id_superior));
    vendedoresAfetados.add(String(v.id));
    nVend++;
    if (lote.length >= 20) {
      descarregar();
      await pausa();
    }
  }
  descarregar();

  const gravEq = new Map(db.prepare("SELECT chave, assinatura FROM plano_pronto WHERE escopo = 'equipe'").all().map((r) => [r.chave, r.assinatura]));
  const resumos = new Map(db.prepare("SELECT chave, resumo FROM plano_pronto WHERE escopo = 'vendedor'").all().map((r) => [r.chave, JSON.parse(r.resumo)]));
  // hierarquia: a equipe de um gestor soma TODOS os vendedores abaixo dele (coordenador > gerente > vendedor)
  const filhos = new Map();
  for (const v of vendedores) if (v.id_superior != null) {
    const k = String(v.id_superior);
    if (!filhos.has(k)) filhos.set(k, []);
    filhos.get(k).push(String(v.id));
  }
  const descendentes = (k, vistos = new Set()) => {
    const out = [];
    for (const f of filhos.get(k) || []) {
      if (vistos.has(f)) continue;
      vistos.add(f);
      out.push(f, ...descendentes(f, vistos));
    }
    return out;
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const somar = (lista) => {
    const t = lista.reduce(
      (a, x) => ({ valor_esperado: a.valor_esperado + x.valor_esperado, potencial_total: a.potencial_total + x.potencial_total, clientes: a.clientes + x.clientes, carteira: a.carteira + x.carteira, acoes: a.acoes + x.acoes }),
      { valor_esperado: 0, potencial_total: 0, clientes: 0, carteira: 0, acoes: 0 },
    );
    return { ...t, valor_esperado: r2(t.valor_esperado), potencial_total: r2(t.potencial_total), vendedores: lista.length };
  };
  const afetada = (e) => descendentes(e).some((d) => vendedoresAfetados.has(d));
  let nEq = 0;
  for (const e of filhos.keys()) {
    if (!forcar && !equipesAfetadas.has(e) && !afetada(e) && gravEq.get(e) === sig) continue;
    const lista = descendentes(e).map((d) => resumos.get(d)).filter((x) => x && x.carteira > 0).sort((a, b) => b.valor_esperado - a.valor_esperado);
    up.run('equipe', e, sig, JSON.stringify({ equipe: e, referencia: ref, gerado_em: agora, total: somar(lista), vendedores: lista }), null, agora);
    nEq++;
  }

  // visão geral: total da empresa (cada vendedor contado uma vez) + uma linha por equipe
  const geral = db.prepare("SELECT assinatura FROM plano_pronto WHERE escopo = 'geral' AND chave = 'todas'").get();
  if (forcar || nVend > 0 || nEq > 0 || geral?.assinatura !== sig) {
    const nomes = new Map(db.prepare('SELECT id_vendedor, nome_vendedor FROM dm_vendedor').all().map((v) => [String(v.id_vendedor), v.nome_vendedor]));
    const todos = [...resumos.values()].filter((x) => x && x.carteira > 0);
    const equipes = db.prepare("SELECT chave, json FROM plano_pronto WHERE escopo = 'equipe'").all()
      .map((r) => ({ id: r.chave, gerente: nomes.get(r.chave) || r.chave, ...JSON.parse(r.json).total }))
      .filter((x) => x.vendedores > 0)
      .sort((a, b) => b.valor_esperado - a.valor_esperado);
    up.run('geral', 'todas', sig, JSON.stringify({ equipe: null, referencia: ref, gerado_em: agora, total: { ...somar(todos), equipes: equipes.length }, equipes }), null, agora);
  }
  log(`${nVend} vendedor(es) e ${nEq} equipe(s) recalculados em ${Date.now() - inicio} ms`);
  return { linhas: nVend + nEq };
}

// ======================================================================
// Leitura (rotas): só lê o que está gravado. Nada pesado roda aqui.
// ======================================================================

function pedirPipeline(evento, detalhe) {
  if (isMainThread) dispararPipeline(evento, detalhe);
}

/** Marca, na hora da leitura, as ações que já estão registradas em aberto (não exige recálculo). */
function marcarRegistradas(plano, idVendedor) {
  const abertas = new Set(
    db.prepare("SELECT tipo, id_cliente, COALESCE(id_campanha, 0) AS c FROM recomendacao WHERE status = 'aberta' AND id_vendedor = ?").all(Number(idVendedor)).map((r) => `${r.tipo}:${r.id_cliente}:${r.c}`),
  );
  if (!abertas.size) return plano;
  return { ...plano, itens: plano.itens.map((i) => (abertas.has(`${i.tipo}:${i.id_cliente}:${i.id_campanha || 0}`) ? { ...i, registrada: true } : i)) };
}

/**
 * Plano pronto de um vendedor (recortado por campanha e limite).
 * Sem nada gravado ainda (primeira execução da pipeline), devolve `pendente: true` e pede o cálculo.
 */
export function lerPlano({ vendedor, campanha, limite = 60 } = {}) {
  const r = db.prepare("SELECT assinatura, json FROM plano_pronto WHERE escopo = 'vendedor' AND chave = ?").get(String(vendedor));
  const atualizando = !r || r.assinatura !== assinaturaPlanos();
  if (atualizando) pedirPipeline('plano', { vendedor: Number(vendedor) });
  if (!r) {
    const v = vendedorInfo(vendedor);
    if (!v) throw Object.assign(new Error('Vendedor não encontrado.'), { status: 404 });
    return { pendente: true, atualizando: true, vendedor: { id: String(v.id), nome: v.nome, equipe: v.gerente || null, telefone: v.telefone }, itens: [], resumo: null };
  }
  return { ...marcarRegistradas(recortar(JSON.parse(r.json), { campanha, limite }), vendedor), atualizando };
}

/** Visão pronta de todas as equipes: { total, equipes, atualizando }. */
export function lerGeral() {
  const r = db.prepare("SELECT assinatura, json FROM plano_pronto WHERE escopo = 'geral' AND chave = 'todas'").get();
  const atualizando = !r || r.assinatura !== assinaturaPlanos();
  if (atualizando) pedirPipeline('plano', { geral: true });
  if (!r) return { pendente: true, atualizando: true, equipes: [], total: null };
  return { ...JSON.parse(r.json), atualizando };
}

/** Visão pronta da equipe: { vendedores, total, atualizando }. */
export function lerEquipe(equipe) {
  const r = db.prepare("SELECT assinatura, json FROM plano_pronto WHERE escopo = 'equipe' AND chave = ?").get(String(equipe));
  const atualizando = !r || r.assinatura !== assinaturaPlanos();
  if (atualizando) pedirPipeline('plano', { equipe: Number(equipe) });
  if (!r) return { pendente: true, atualizando: true, vendedores: [], total: null };
  return { ...JSON.parse(r.json), atualizando };
}

/**
 * Plano de um vendedor para quem precisa dele na hora (bot do Telegram, roteiro da IA): lê o pronto e,
 * só se nunca houve cálculo, monta na hora.
 */
export function gerarPlano({ vendedor, campanha, limite = 60 } = {}) {
  const p = lerPlano({ vendedor, campanha, limite });
  if (!p.pendente) return p;
  return marcarRegistradas(recortar(montarPlano(vendedor), { campanha, limite }), vendedor);
}

// ======================================================================
// Retroalimentação
// ======================================================================

export function registrarPlano({ vendedor, campanha, itens = [], origem = 'plano' } = {}) {
  const ref = dataReferenciaVendas();
  if (!ref) throw Object.assign(new Error('Sem dados de venda para registrar.'), { status: 400 });
  const agora = agoraISO();
  const existe = db.prepare("SELECT 1 FROM recomendacao WHERE status = 'aberta' AND tipo = ? AND id_cliente = ? AND COALESCE(id_campanha, 0) = ?");
  const ins = db.prepare(
    `INSERT INTO recomendacao (origem, tipo, id_vendedor, id_cliente, id_campanha, marcas, motivo, valor_potencial, score, probabilidade, status, data_base, expira_em, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?)`,
  );
  let registradas = 0;
  let ignoradas = 0;
  transacao(() => {
    for (const it of itens) {
      if (!TIPOS_PLANO[it.tipo] || !it.id_cliente) continue;
      const idCamp = Number(it.id_campanha || campanha || 0) || null;
      if (existe.get(it.tipo, Number(it.id_cliente), idCamp || 0)) {
        ignoradas++;
        continue;
      }
      const marcas = (it.produtos_sugeridos || []).map((p) => p.marca).filter(Boolean);
      ins.run(origem, it.tipo, Number(vendedor) || null, Number(it.id_cliente), idCamp, JSON.stringify(marcas), String(it.motivo || '').slice(0, 1000),
        Number(it.valor_potencial) || 0, Number(it.score) || 0, Number(it.probabilidade) || null, ref, addDias(ref, 30), agora);
      registradas++;
    }
  });
  if (registradas) pedirPipeline('plano', { vendedor: Number(vendedor) });
  return { registradas, ignoradas, data_base: ref, expira_em: addDias(ref, 30) };
}

/** Marca como convertidas as sugestões em que o cliente comprou depois; expira as vencidas. */
export function atualizarConversoes() {
  const ref = dataReferenciaVendas();
  if (!ref) return { convertidas: 0, expiradas: 0 };
  const abertas = db.prepare("SELECT * FROM recomendacao WHERE status = 'aberta'").all();
  let convertidas = 0;
  let expiradas = 0;
  transacao(() => {
    const conv = db.prepare("UPDATE recomendacao SET status = 'convertida', convertida_em = ?, valor_convertido = ? WHERE id = ?");
    const exp = db.prepare("UPDATE recomendacao SET status = 'expirada' WHERE id = ?");
    for (const r of abertas) {
      let marcas = [];
      try {
        marcas = JSON.parse(r.marcas || '[]');
      } catch {
        marcas = [];
      }
      const filtroMarca = marcas.length ? `AND p.marca IN (${marcas.map(() => '?').join(',')})` : '';
      const camp = r.id_campanha ? db.prepare('SELECT definicao FROM campanha WHERE id = ?').get(r.id_campanha) : null;
      let filtroProd = '';
      if (!marcas.length && camp) {
        // sugestão de campanha sem marcas: qualquer compra dos produtos da campanha conta
        try {
          const def = JSON.parse(camp.definicao);
          const marcasDef = (def.criterios || []).flatMap((c) => c.produtos?.marcas || []);
          const fabsDef = (def.criterios || []).flatMap((c) => c.produtos?.fabricantes || []);
          if (marcasDef.length) filtroProd = `AND p.marca IN (${marcasDef.map((m) => `'${String(m).replace(/'/g, "''")}'`).join(',')})`;
          else if (fabsDef.length) filtroProd = `AND p.fabricante IN (${fabsDef.map((m) => `'${String(m).replace(/'/g, "''")}'`).join(',')})`;
        } catch {
          /* definição inválida: qualquer compra conta */
        }
      }
      const c = db
        .prepare(
          `SELECT MIN(v.data_pedido) AS primeira, SUM(v.valor_total) AS valor FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
            WHERE ${VENDA_VALIDA} AND v.id_cliente = ? AND v.data_pedido > ? AND v.data_pedido <= ? ${filtroMarca} ${filtroProd}`,
        )
        .get(r.id_cliente, r.data_base, r.expira_em, ...marcas);
      if (c?.primeira) {
        conv.run(c.primeira, c.valor, r.id);
        convertidas++;
      } else if (ref > r.expira_em) {
        exp.run(r.id);
        expiradas++;
      }
    }
  });
  gravarEstado('conversoes', { atualizado_em: agoraISO(), convertidas, expiradas, referencia: ref });
  return { convertidas, expiradas };
}

export function listarRecomendacoes({ status, vendedor, limite = 200 } = {}) {
  const where = [];
  const p = [];
  if (status) {
    where.push('r.status = ?');
    p.push(status);
  }
  if (vendedor) {
    where.push('r.id_vendedor = ?');
    p.push(Number(vendedor));
  }
  return db
    .prepare(
      `SELECT r.id, r.tipo, r.origem, r.id_cliente, COALESCE(c.nome_fantasia, c.nome_cliente) AS cliente, r.id_vendedor, v.nome_vendedor AS vendedor,
              r.id_campanha, r.marcas, r.motivo, r.valor_potencial, r.probabilidade, r.status, r.data_base, r.expira_em, r.convertida_em, r.valor_convertido, r.criado_em
         FROM recomendacao r LEFT JOIN dm_cliente c ON c.id_cliente = r.id_cliente LEFT JOIN dm_vendedor v ON v.id_vendedor = r.id_vendedor
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ${Math.trunc(limite)}`,
    )
    .all(...p)
    .map((r) => ({ ...r, tipo_rotulo: TIPOS_PLANO[r.tipo]?.rotulo || r.tipo, marcas: (() => { try { return JSON.parse(r.marcas || '[]'); } catch { return []; } })() }));
}

export function resumoRecomendacoes() {
  const t = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(status = 'convertida') AS convertidas, SUM(status = 'aberta') AS abertas, SUM(status = 'expirada') AS expiradas,
              SUM(COALESCE(valor_convertido, 0)) AS valor_convertido FROM recomendacao`,
    )
    .get();
  const fechadas = (t.convertidas || 0) + (t.expiradas || 0);
  return {
    total: t.total || 0,
    abertas: t.abertas || 0,
    convertidas: t.convertidas || 0,
    expiradas: t.expiradas || 0,
    taxa: fechadas ? (t.convertidas || 0) / fechadas : null,
    valor_convertido: t.valor_convertido || 0,
    por_tipo: taxasConversao(),
    backtest: lerEstado('backtest'),
    atualizado_em: lerEstado('conversoes')?.atualizado_em || null,
  };
}
