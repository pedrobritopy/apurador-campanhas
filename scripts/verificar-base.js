// =====================================================================
// Conferência da base importada (var/apurador.db): 15 regras do DW, todas com zero divergências,
// mais um retrato da aderência das carteiras e da aderência à demanda real (SNGPC).
// Uso: node scripts/verificar-base.js
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(path.join(RAIZ, 'var', 'apurador.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 60000');
const um = (s) => ({ ...db.prepare(s).get() });

const regras = {
  'valor_total = qtd × unitário': 'SELECT SUM(ABS(valor_total - quantidade*valor_unitario) > 0.011) div, COUNT(*) n FROM fato_vendas',
  'unitário = lista × (1 − desconto)': 'SELECT SUM(ABS(valor_unitario - ROUND(preco_lista*(1-desconto_perc/100.0),2)) > 0.011) div, COUNT(*) n FROM fato_vendas',
  'margem = valor − custo': 'SELECT SUM(ABS(margem_bruta - (valor_total - custo_total)) > 0.011) div, COUNT(*) n FROM fato_vendas',
  'impostos = ICMS + PIS + COFINS': 'SELECT SUM(ABS(valor_impostos_total - (valor_icms+valor_pis+valor_cofins)) > 0.011) div, COUNT(*) n FROM fato_vendas',
  'ICMS 12%, PIS 1,65%, COFINS 7,6%': 'SELECT SUM(ABS(valor_icms - ROUND(valor_total*0.12,2)) > 0.011 OR ABS(valor_pis - ROUND(valor_total*0.0165,2)) > 0.011 OR ABS(valor_cofins - ROUND(valor_total*0.076,2)) > 0.011) div, COUNT(*) n FROM fato_vendas',
  'cadastros órfãos (produto, cliente, vendedor)': 'SELECT SUM(p.id_produto IS NULL OR c.id_cliente IS NULL OR vd.id_vendedor IS NULL) div, COUNT(*) n FROM fato_vendas v LEFT JOIN dm_produto p USING(id_produto) LEFT JOIN dm_cliente c USING(id_cliente) LEFT JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor',
  'faturamento antes do pedido': 'SELECT SUM(data_faturamento < data_pedido) div, COUNT(*) n FROM fato_vendas',
  'compra antes do cadastro do cliente': 'SELECT SUM(v.data_pedido < c.data_cadastro) div, COUNT(*) n FROM fato_vendas v JOIN dm_cliente c USING(id_cliente)',
  'pedido tirado só por vendedor (nunca gestor)': "SELECT SUM(lower(COALESCE(vd.nivel,'')) <> 'vendedor') div, COUNT(*) n FROM fato_vendas v JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor",
  'pedido fora da carteira só por colega da equipe ou divisa':
    'SELECT SUM(v.id_vendedor <> c.id_vendedor AND (vd.id_superior IS NOT dono.id_superior OR vd.estado <> dono.estado)) div, COUNT(*) n FROM fato_vendas v JOIN dm_cliente c USING(id_cliente) JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor JOIN dm_vendedor dono ON dono.id_vendedor = c.id_vendedor',
  'pedido com 1 cliente, vendedor, canal, data, NF e situação': 'SELECT SUM(nc>1 OR nv>1 OR nk>1 OR nd>1 OR nn>1 OR ns>1) div, COUNT(*) n FROM (SELECT COUNT(DISTINCT id_cliente) nc, COUNT(DISTINCT id_vendedor) nv, COUNT(DISTINCT id_canal) nk, COUNT(DISTINCT data_pedido) nd, COUNT(DISTINCT numero_nf) nn, COUNT(DISTINCT status) ns FROM fato_vendas GROUP BY id_pedido)',
  'estoque: final = inicial − vendido + entrada': 'SELECT SUM(ABS(estoque_final - (estoque_inicial - quantidade_vendida + quantidade_entrada)) > 0.01) div, COUNT(*) n FROM fato_estoque',
  'estoque encadeado (inicial = final de ontem)': "SELECT SUM(ABS(e.estoque_inicial - a.estoque_final) > 0.01) div, COUNT(*) n FROM fato_estoque e JOIN fato_estoque a ON a.id_produto = e.id_produto AND a.data = date(e.data, '-1 day')",
  'saída de estoque = vendas faturadas (produto × dia)': "WITH v AS (SELECT id_produto, data_pedido d, SUM(quantidade) q FROM fato_vendas WHERE status='Faturado' GROUP BY 1,2) SELECT SUM(ABS(COALESCE(v.q,0) - e.quantidade_vendida) > 0.5) + SUM(e.estoque_final < 0) div, COUNT(*) n FROM fato_estoque e LEFT JOIN v ON v.id_produto = e.id_produto AND v.d = e.data",
  'metas: realizado = vendas faturadas (todos os níveis)':
    "WITH RECURSIVE abaixo(gestor, vend) AS (SELECT id_vendedor, id_vendedor FROM dm_vendedor UNION ALL SELECT a.gestor, v.id_vendedor FROM abaixo a JOIN dm_vendedor v ON v.id_superior = a.vend), r AS (SELECT a.gestor, CAST(substr(f.data_pedido,1,4) AS INT) ano, CAST(substr(f.data_pedido,6,2) AS INT) mes, SUM(f.valor_total) v FROM fato_vendas f JOIN abaixo a ON a.vend = f.id_vendedor WHERE f.status='Faturado' GROUP BY 1,2,3) SELECT SUM(ABS(COALESCE(r.v,0) - m.realizado_valor) > 1) div, COUNT(*) n FROM fato_metas m LEFT JOIN r ON r.gestor = m.id_vendedor AND r.ano = m.ano AND r.mes = m.mes",
};

let falhas = 0;
for (const [nome, sql] of Object.entries(regras)) {
  const r = um(sql);
  if (r.div) falhas++;
  console.log(`${r.div === 0 ? 'ok  ' : 'ERRO'} ${nome.padEnd(58)} ${String(r.div).padStart(7)} divergências em ${Number(r.n).toLocaleString('pt-BR')}`);
}

// ---------------- retrato
const ref = um("SELECT MAX(data_pedido) d FROM fato_vendas WHERE status = 'Faturado'").d;
console.log(`\nbase: ${um('SELECT COUNT(*) n FROM fato_vendas').n.toLocaleString('pt-BR')} linhas de venda · ${um('SELECT COUNT(*) n FROM dm_cliente').n} clientes · ${um('SELECT COUNT(*) n FROM dm_produto').n} produtos · ${um('SELECT COUNT(*) n FROM dm_vendedor').n} pessoas · até ${ref}`);
const ader = (where) => um(`SELECT ROUND(100.0*SUM(CASE WHEN v.id_vendedor = c.id_vendedor THEN v.valor_total END)/SUM(v.valor_total),1) dono, ROUND(100.0*SUM(CASE WHEN vd.estado = c.estado THEN v.valor_total END)/SUM(v.valor_total),1) mesma_uf FROM fato_vendas v JOIN dm_cliente c USING(id_cliente) JOIN dm_vendedor vd ON vd.id_vendedor = v.id_vendedor WHERE v.status = 'Faturado' AND v.data_pedido > date('${ref}', '-90 day') ${where}`);
console.log('venda 90d feita pelo dono do cliente / por vendedor da mesma UF (Brasil):', ader(''));
console.log('idem no ES:', ader("AND c.estado = 'ES'"));

// aderência à demanda real (SNGPC): correlação de postos entre unidades geradas e caixas/mês reais
const arqDem = path.join(RAIZ, 'dados', 'base', 'produto_demanda.csv');
if (fs.existsSync(arqDem)) {
  const dem = parse(fs.readFileSync(arqDem, 'utf8'), { delimiter: ';', columns: true }).filter((d) => d.fonte === 'SNGPC/ANVISA');
  const peso = new Map(dem.map((d) => [Number(d.id_produto), Number(d.peso)]));
  const gerado = new Map(db.prepare("SELECT id_produto, SUM(quantidade) q FROM fato_vendas WHERE status='Faturado' GROUP BY id_produto").all().map((r) => [r.id_produto, r.q]));
  const pares = [...peso.keys()].map((id) => [peso.get(id), gerado.get(id) || 0]);
  const postos = (l) => {
    const o = l.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = Array(l.length);
    o.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const spearman = (a, b) => {
    const ra = postos(a);
    const rb = postos(b);
    const n = a.length;
    const d2 = ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0);
    return 1 - (6 * d2) / (n * (n * n - 1));
  };
  console.log(`correlação de Spearman (unidades geradas × demanda real SNGPC, ${pares.length} produtos): ${spearman(pares.map((p) => p[0]), pares.map((p) => p[1])).toFixed(3)}`);
  const top = [...pares].sort((a, b) => b[0] - a[0]).slice(0, 100);
  console.log(`  top 100 do SNGPC: ${spearman(top.map((p) => p[0]), top.map((p) => p[1])).toFixed(3)}`);
}
console.log(falhas ? `\n${falhas} regra(s) com divergência` : '\nTodas as 15 regras sem divergência.');
process.exit(falhas ? 1 : 0);
