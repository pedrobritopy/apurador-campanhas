import { db, agoraISO } from './db.js';
import { addDias } from './calendario.js';
import { referenciaVendas } from './geo.js';
import { fotoVendedor } from './participantes.js';
import { resolverProdutos } from './seletor.js';
import { assinaturaBase, gravarPronto, hash, lerPronto } from './pipeline.js';
import { assinaturaCarteiras } from './carteiras.js';

// =====================================================================
// Ficha do cliente: histórico, frequência, mix, oportunidades frente a clientes parecidos, campanhas em que
// ele conta, carteira e quem vende, comparação com o bairro e participação estimada. Pré-calculada pela
// pipeline (etapa "clientes-ficha") e lida pronta; as ações do plano de ataque entram na leitura.
// =====================================================================

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const quantil = (l, q) => {
  if (!l.length) return 0;
  const s = [...l].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export const assinaturaFichas = () => `${assinaturaBase()}|${assinaturaCarteiras()}|${hash(db.prepare("SELECT id, atualizado_em FROM campanha WHERE status = 'ativa' ORDER BY id").all())}`;

/** Contexto comum a todas as fichas (campanhas ativas e produtos de cada uma). */
function contexto() {
  const ref = referenciaVendas();
  const campanhas = db
    .prepare("SELECT id, nome, inicio, fim, definicao FROM campanha WHERE status = 'ativa' AND inicio <= ? ORDER BY fim")
    .all(ref)
    .map((c) => {
      const def = JSON.parse(c.definicao);
      const cr = def.criterios?.[0];
      let produtos = [];
      try {
        produtos = cr?.produtos ? resolverProdutos(cr.produtos) : [];
      } catch {
        produtos = [];
      }
      const col = def.data_base === 'faturamento' ? 'data_faturamento' : 'data_pedido';
      const ate = c.fim < ref ? c.fim : ref;
      return { id: c.id, nome: c.nome, inicio: c.inicio, ate, col, produtos, criterio: cr?.nome || null };
    })
    .filter((c) => c.produtos.length);
  // por campanha: total do vendedor (para dizer quanto o cliente ajuda)
  for (const c of campanhas) {
    const ids = c.produtos.join(',');
    c.porVendedor = new Map(
      db.prepare(`SELECT id_vendedor, SUM(quantidade) AS q, SUM(valor_total) AS v FROM fato_vendas WHERE status = 'Faturado' AND ${c.col} BETWEEN ? AND ? AND id_produto IN (${ids}) GROUP BY id_vendedor`).all(c.inicio, c.ate).map((r) => [r.id_vendedor, r]),
    );
    c.porCliente = new Map(
      db.prepare(`SELECT id_cliente, id_vendedor, SUM(quantidade) AS q, SUM(valor_total) AS v FROM fato_vendas WHERE status = 'Faturado' AND ${c.col} BETWEEN ? AND ? AND id_produto IN (${ids}) GROUP BY id_cliente, id_vendedor`).all(c.inicio, c.ate).reduce((m, r) => m.set(r.id_cliente, [...(m.get(r.id_cliente) || []), r]), new Map()),
    );
  }
  // valor 90d por cliente (vizinhos, parecidos, potencial)
  const ini90 = addDias(ref, -89);
  const valor90 = new Map(db.prepare("SELECT id_cliente, SUM(valor_total) AS v FROM fato_vendas WHERE status = 'Faturado' AND data_pedido BETWEEN ? AND ? GROUP BY id_cliente").all(ini90, ref).map((r) => [r.id_cliente, r.v]));
  const clientes = db.prepare('SELECT id_cliente, segmento, porte, estado, cidade, bairro FROM dm_cliente').all();
  const grupos = new Map();
  for (const c of clientes) {
    for (const k of [`sp|${c.segmento}|${c.porte}`, `cid|${c.estado}|${c.cidade}`, `bai|${c.estado}|${c.cidade}|${c.bairro}`]) {
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(c.id_cliente);
    }
  }
  // produtos dos parecidos (segmento + porte): penetração e valor médio por comprador
  const parecidos = new Map();
  for (const r of db
    .prepare(
      `SELECT c.segmento, c.porte, v.id_produto, p.nome_produto AS nome, p.marca, COUNT(DISTINCT v.id_cliente) AS n, SUM(v.valor_total) AS v
         FROM fato_vendas v JOIN dm_cliente c ON c.id_cliente = v.id_cliente JOIN dm_produto p ON p.id_produto = v.id_produto
        WHERE v.status = 'Faturado' AND v.data_pedido BETWEEN ? AND ? GROUP BY c.segmento, c.porte, v.id_produto`,
    )
    .all(ini90, ref)) {
    const k = `${r.segmento}|${r.porte}`;
    if (!parecidos.has(k)) parecidos.set(k, []);
    parecidos.get(k).push(r);
  }
  for (const l of parecidos.values()) l.sort((a, b) => b.n - a.n);
  const planos = new Map(db.prepare("SELECT chave, json FROM plano_pronto WHERE escopo = 'vendedor'").all().map((r) => [Number(r.chave), r.json]));
  return { ref, ini90, campanhas, valor90, grupos, parecidos, planos };
}

const stCli = () => ({
  cli: db.prepare(
    `SELECT c.*, v.nome_vendedor AS vendedor_erp, g.lat, g.lng, g.municipio_ibge, g.aproximado,
            cc.id_carteira, cc.nivel AS carteira_nivel, ca.nome AS carteira_nome, ca.cor AS carteira_cor, ca.id_vendedor AS carteira_dono, vd.nome_vendedor AS dono_nome, vd.telefone AS dono_telefone
       FROM dm_cliente c LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor LEFT JOIN cliente_geo g ON g.id_cliente = c.id_cliente
       LEFT JOIN carteira_cliente cc ON cc.id_cliente = c.id_cliente LEFT JOIN carteira ca ON ca.id = cc.id_carteira LEFT JOIN dm_vendedor vd ON vd.id_vendedor = ca.id_vendedor
      WHERE c.id_cliente = ?`,
  ),
  meses: db.prepare("SELECT substr(data_pedido, 1, 7) AS m, SUM(valor_total) AS v, SUM(quantidade) AS q, COUNT(DISTINCT id_pedido) AS p FROM fato_vendas WHERE id_cliente = ? AND status = 'Faturado' AND data_pedido > ? GROUP BY m ORDER BY m"),
  pedidos: db.prepare(
    `SELECT v.id_pedido, MIN(v.data_pedido) AS data, v.status, v.id_vendedor, vd.nome_vendedor AS vendedor, cn.nome_canal AS canal, COUNT(*) AS itens, SUM(v.quantidade) AS q, SUM(v.valor_total) AS valor
       FROM fato_vendas v LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor LEFT JOIN dm_canal cn ON cn.id_canal = v.id_canal
      WHERE v.id_cliente = ? AND v.data_pedido > ? GROUP BY v.id_pedido ORDER BY data DESC`,
  ),
  produtos: db.prepare(
    `SELECT v.id_produto, p.nome_produto AS nome, p.marca, p.fabricante, SUM(CASE WHEN v.data_pedido >= ? THEN v.valor_total END) AS v90, SUM(CASE WHEN v.data_pedido >= ? THEN v.quantidade END) AS q90,
            SUM(CASE WHEN v.data_pedido < ? THEN v.valor_total END) AS vantes, MAX(v.data_pedido) AS ultima, COUNT(DISTINCT v.id_pedido) AS compras
       FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto WHERE v.id_cliente = ? AND v.status = 'Faturado' AND v.data_pedido >= ? GROUP BY v.id_produto`,
  ),
  quem: db.prepare("SELECT v.id_vendedor, vd.nome_vendedor AS nome, SUM(v.valor_total) AS v FROM fato_vendas v LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor WHERE v.id_cliente = ? AND v.status = 'Faturado' AND v.data_pedido BETWEEN ? AND ? GROUP BY v.id_vendedor ORDER BY v DESC"),
});

function montarFicha(id, ctx, st) {
  const c = st.cli.get(Number(id));
  if (!c) return null;
  const { ref, ini90 } = ctx;
  const ha12 = addDias(ref, -364);
  const ha24 = addDias(ref, -729);
  // série mensal: últimos 12 meses e os 12 anteriores (mesmo período)
  const linhasMes = st.meses.all(c.id_cliente, ha24);
  const mesesRef = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${ref.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    mesesRef.push(d.toISOString().slice(0, 7));
  }
  const anoAntes = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  const porMes = new Map(linhasMes.map((r) => [r.m, r]));
  const serie = mesesRef.map((m) => ({ mes: m, valor: r2(porMes.get(m)?.v || 0), unidades: porMes.get(m)?.q || 0, pedidos: porMes.get(m)?.p || 0, valor_ano_anterior: r2(porMes.get(anoAntes(m))?.v || 0) }));
  const v12 = serie.reduce((a, s) => a + s.valor, 0);
  const v12ant = serie.reduce((a, s) => a + s.valor_ano_anterior, 0);
  const ult3 = serie.slice(-3).reduce((a, s) => a + s.valor, 0);
  const ant3 = serie.slice(-6, -3).reduce((a, s) => a + s.valor, 0);
  // pedidos e frequência
  const peds = st.pedidos.all(c.id_cliente, ha12);
  const fat = peds.filter((p) => p.status === 'Faturado');
  const datas = [...new Set(fat.map((p) => p.data))].sort();
  const intervalos = datas.slice(1).map((d, i) => dias(datas[i], d));
  const intervalo = intervalos.length ? r1(intervalos.reduce((a, b) => a + b, 0) / intervalos.length) : null;
  const ultima = datas[datas.length - 1] || null;
  const semComprar = ultima ? dias(ultima, ref) : null;
  const atrasada = intervalo != null && semComprar != null && semComprar > Math.max(7, intervalo * 1.6);
  const ticket = fat.length ? r2(fat.reduce((a, p) => a + p.valor, 0) / fat.length) : null;
  // mix
  const prods = st.produtos.all(ini90, ini90, ini90, c.id_cliente, addDias(ref, -269)).map((p) => ({ ...p }));
  const compra = prods.filter((p) => p.v90 > 0).sort((a, b) => b.v90 - a.v90).slice(0, 8).map((p) => ({ id: p.id_produto, nome: p.nome, marca: p.marca, valor: r2(p.v90), unidades: p.q90, ultima: p.ultima }));
  const deixou = prods.filter((p) => !(p.v90 > 0) && p.vantes > 0 && p.compras >= 2).sort((a, b) => b.vantes - a.vantes).slice(0, 5).map((p) => ({ id: p.id_produto, nome: p.nome, marca: p.marca, valor_antes: r2(p.vantes), ultima: p.ultima, dias_sem: dias(p.ultima, ref) }));
  // oportunidade frente aos parecidos (mesmo tipo e porte): produtos que eles compram e ele não
  const grupoSp = ctx.grupos.get(`sp|${c.segmento}|${c.porte}`) || [];
  const ativosSp = grupoSp.filter((x) => ctx.valor90.get(x) > 0).length || 1;
  const comprou180 = new Set(prods.filter((p) => p.ultima >= addDias(ref, -179)).map((p) => p.id_produto));
  const oportunidades = (ctx.parecidos.get(`${c.segmento}|${c.porte}`) || [])
    .filter((p) => !comprou180.has(p.id_produto) && p.n / ativosSp >= 0.25)
    .slice(0, 5)
    .map((p) => ({ id: p.id_produto, nome: p.nome, marca: p.marca, penetracao: r1((p.n / ativosSp) * 100), valor_trimestre: r2(p.v / p.n) }));
  // quem vende
  const quem = st.quem.all(c.id_cliente, ini90, ref);
  const total90 = quem.reduce((a, q) => a + q.v, 0);
  const vendedores = quem.map((q) => ({ id: q.id_vendedor, nome: q.nome, foto: fotoVendedor(q.id_vendedor), valor: r2(q.v), pct: total90 ? r1((q.v / total90) * 100) : 0, dono: q.id_vendedor === c.carteira_dono }));
  // vizinhos
  const comparar = (k) => {
    const ids = (ctx.grupos.get(k) || []).filter((x) => x !== c.id_cliente);
    const vals = ids.map((x) => ctx.valor90.get(x) || 0).filter((v) => v > 0);
    if (!vals.length) return null;
    const meu = ctx.valor90.get(c.id_cliente) || 0;
    return { clientes: ids.length, ativos: vals.length, mediana: r2(quantil(vals, 0.5)), posicao: vals.filter((v) => v > meu).length + 1, de: vals.length + 1 };
  };
  const valsSp = grupoSp.map((x) => ctx.valor90.get(x) || 0).filter((v) => v > 0);
  const potencial = r2(Math.max(quantil(valsSp, 0.8), ctx.valor90.get(c.id_cliente) || 0));
  // campanhas em que conta
  const campanhas = ctx.campanhas
    .map((k) => {
      const linhas = k.porCliente.get(c.id_cliente) || [];
      if (!linhas.length) return null;
      const q = linhas.reduce((a, l) => a + l.q, 0);
      const v = linhas.reduce((a, l) => a + l.v, 0);
      const vendedor = linhas.sort((a, b) => b.v - a.v)[0].id_vendedor;
      const tot = k.porVendedor.get(vendedor);
      const daVendedor = linhas.find((l) => l.id_vendedor === vendedor);
      return { id: k.id, nome: k.nome, criterio: k.criterio, unidades: q, valor: r2(v), vendedor, vendedor_nome: db.prepare('SELECT nome_vendedor AS n FROM dm_vendedor WHERE id_vendedor = ?').get(vendedor)?.n, pct_do_vendedor: tot?.q ? r1(((daVendedor?.q || 0) / tot.q) * 100) : null };
    })
    .filter(Boolean);
  return {
    id: c.id_cliente,
    gerado_em: agoraISO(),
    referencia: ref,
    cliente: {
      nome: c.nome_fantasia || c.nome_cliente, razao_social: c.razao_social, cnpj: c.cnpj, segmento: c.segmento, porte: c.porte, cadastro: c.data_cadastro, ativo: c.ativo === 1 || c.ativo === 'True' || c.ativo === true,
      endereco: [c.rua, c.numero].filter(Boolean).join(', '), bairro: c.bairro, cidade: c.cidade, uf: c.estado, cep: c.cep, contato: c.nome_cliente,
    },
    carteira: c.id_carteira
      ? { id: c.id_carteira, nome: c.carteira_nome, cor: c.carteira_cor, nivel: c.carteira_nivel, dono: { id: c.carteira_dono, nome: c.dono_nome, foto: fotoVendedor(c.carteira_dono), telefone: c.dono_telefone } }
      : null,
    vendedor_cadastro: { id: c.id_vendedor, nome: c.vendedor_erp, foto: fotoVendedor(c.id_vendedor) },
    quem_vende: vendedores,
    dono_vende_pct: vendedores.find((v) => v.dono)?.pct ?? (c.id_carteira ? 0 : null),
    resumo: {
      valor_12m: r2(v12), valor_12m_anterior: r2(v12ant), variacao_12m: v12ant > 0 ? r1(((v12 - v12ant) / v12ant) * 100) : null,
      valor_90d: r2(ctx.valor90.get(c.id_cliente) || 0), tendencia_trimestre: ant3 > 0 ? r1(((ult3 - ant3) / ant3) * 100) : null,
      pedidos_12m: fat.length, ticket_medio: ticket, intervalo_medio_dias: intervalo, ultima_compra: ultima, dias_sem_comprar: semComprar, recompra_atrasada: atrasada,
      devolucoes_12m: peds.filter((p) => p.status === 'Devolvido').length, cancelados_12m: peds.filter((p) => p.status === 'Cancelado').length,
    },
    serie,
    mix: { compra, deixou_de_comprar: deixou },
    oportunidades,
    participacao: { potencial_90d: potencial, pct: potencial > 0 ? r1(((ctx.valor90.get(c.id_cliente) || 0) / potencial) * 100) : null, base: `${ativosSp} clientes ${c.segmento} de porte ${c.porte}` },
    vizinhos: { bairro: comparar(`bai|${c.estado}|${c.cidade}|${c.bairro}`), cidade: comparar(`cid|${c.estado}|${c.cidade}`), parecidos: comparar(`sp|${c.segmento}|${c.porte}`) },
    campanhas,
    ultimos_pedidos: peds.slice(0, 8).map((p) => ({ pedido: p.id_pedido, data: p.data, status: p.status, vendedor: p.vendedor, canal: p.canal, itens: p.itens, unidades: p.q, valor: r2(p.valor) })),
  };
}

/** Etapa da pipeline: grava a ficha de todos os clientes. */
export function gerarFichas() {
  const t0 = Date.now();
  const ctx = contexto();
  const st = stCli();
  const ids = db.prepare('SELECT id_cliente FROM dm_cliente ORDER BY id_cliente').all().map((r) => r.id_cliente);
  const ass = assinaturaFichas();
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      const f = montarFicha(id, ctx, st);
      if (f) gravarPronto(`ficha:${id}`, ass, f);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { linhas: ids.length, duracao_ms: Date.now() - t0 };
}

/** Leitura: ficha pronta + ações do plano de ataque para este cliente (lidas na hora, são leves). */
export function lerFicha(id) {
  let p = lerPronto(`ficha:${Number(id)}`);
  let atualizando = false;
  if (!p) {
    const f = montarFicha(id, contexto(), stCli());
    if (!f) return null;
    gravarPronto(`ficha:${Number(id)}`, assinaturaFichas(), f);
    p = { conteudo: f, assinatura: assinaturaFichas() };
  } else atualizando = p.assinatura !== assinaturaFichas();
  const f = p.conteudo;
  const idDono = f.carteira?.dono?.id ?? f.vendedor_cadastro?.id;
  const acoes = [];
  for (const idV of new Set([idDono, f.vendedor_cadastro?.id].filter(Boolean))) {
    const j = db.prepare("SELECT json FROM plano_pronto WHERE escopo = 'vendedor' AND chave = ?").get(String(idV))?.json;
    if (!j) continue;
    for (const it of JSON.parse(j).itens || []) {
      if (it.id_cliente === f.id) acoes.push({ tipo: it.tipo, tipo_rotulo: it.tipo_rotulo, titulo: it.titulo, motivo: it.motivo, valor_potencial: it.valor_potencial, probabilidade: it.probabilidade, vendedor: idV });
    }
  }
  return { ...f, acoes, atualizando };
}
