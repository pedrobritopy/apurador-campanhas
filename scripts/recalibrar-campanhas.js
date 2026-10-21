// =====================================================================
// Recalibra as campanhas de exemplo depois de regenerar a base: metas e faixas saem dos dados
// (server/exemplos.js), o orçamento acompanha o prêmio projetado (+20%), a campanha "Balcão" escolhe o
// tamanho do bloco para caber no orçamento e a conta corrente de exemplo é refeita sobre o novo volume.
// Uso: node scripts/recalibrar-campanhas.js   (com a base já importada)
// =====================================================================
import { db, agoraISO, invalidarCache } from '../server/db.js';
import { definicoesExemplo } from '../server/exemplos.js';
import { apurar, normalizarCampanha } from '../server/motor.js';
import { recriarContaCorrenteExemplo } from '../server/contacorrente-exemplo.js';

const t0 = Date.now();
const teto = (v, passo = 1000) => Math.max(passo, Math.ceil(v / passo) * passo);
const exemplos = definicoesExemplo();
const ids = db.prepare('SELECT id FROM campanha WHERE id <= 11 ORDER BY id').all().map((r) => r.id);
const linhas = [];
exemplos.forEach((e, i) => {
  const id = ids[i];
  if (!id) return;
  let c = normalizarCampanha(e.definicao);
  let r = apurar(c);
  // metas sobre o histórico: ajusta o crescimento para a projeção ficar perto de 97% (campanha desafiadora, mas alcançável)
  for (let volta = 0; volta < 2 && e.status === 'ativa' && r.tempo.status === 'andamento'; volta++) {
    const cr = c.criterios[0];
    const at = r.criterios[0]?.total?.atingimento_proj;
    if (cr.meta.tipo !== 'historico' || at == null || (at >= 88 && at <= 112)) break;
    const antigo = cr.meta.crescimento;
    const novo = Math.round(((1 + antigo / 100) * (at / 97) - 1) * 100);
    const crit = c.criterios.map((x, i) => (i === 0 ? { ...x, meta: { ...x.meta, crescimento: novo } } : x));
    c = normalizarCampanha({ ...c, criterios: crit, descricao: c.descricao.replace(`${antigo}%`, `${novo}%`) });
    r = apurar(c);
  }
  if (c.premiacao.orcamento != null && c.premiacao.tipo !== 'nenhuma') {
    c = normalizarCampanha({ ...c, premiacao: { ...c.premiacao, orcamento: teto(r.resumo.premio_proj_total * 1.2) } });
    r = apurar(c);
  }
  db.prepare('UPDATE campanha SET nome = ?, fornecedor = ?, status = ?, inicio = ?, fim = ?, definicao = ?, atualizado_em = ? WHERE id = ?').run(c.nome, c.fornecedor, e.status, c.inicio, c.fim, JSON.stringify(c), agoraISO(), id);
  if (e.status === 'encerrada') {
    db.prepare('DELETE FROM fotografia WHERE id_campanha = ?').run(id);
    db.prepare('INSERT INTO fotografia (id_campanha, tipo, observacao, data_referencia, resultado, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'fechamento', 'Fechamento da campanha', r.tempo.referencia, JSON.stringify(r), agoraISO());
  }
  linhas.push({ id, nome: c.nome, participantes: r.resumo.participantes, atingimento_proj: Math.round(r.resumo.atingimento_geral_proj ?? 0), premio_proj: Math.round(r.resumo.premio_proj_total), orcamento: c.premiacao.orcamento });
});

// "Balcão": a cada N unidades, R$ X. Escolhe N para o prêmio projetado ficar perto de 70% do orçamento.
for (const row of db.prepare("SELECT id, definicao FROM campanha WHERE json_extract(definicao, '$.premiacao.tipo') = 'bloco'").all()) {
  const def = JSON.parse(row.definicao);
  const orc = def.premiacao.orcamento || 15000;
  let melhor = null;
  for (const n of [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200]) {
    const c = normalizarCampanha({ ...def, premiacao: { ...def.premiacao, bloco: { ...def.premiacao.bloco, tamanho: n } } });
    const p = apurar(c).resumo.premio_proj_total;
    const d = Math.abs(p - orc * 0.7);
    if (!melhor || d < melhor.d) melhor = { n, p, d, c };
  }
  const v = melhor.c.premiacao.bloco.valor;
  const marca = def.criterios[0].nome?.replace(/^Unidades /, '') || def.fornecedor;
  const c = normalizarCampanha({
    ...melhor.c,
    nome: `Balcão ${marca}: a cada ${melhor.n} un, R$ ${v}`,
    descricao: `A cada ${melhor.n} unidades ${marca} vendidas no mês, o vendedor ganha R$ ${v}${melhor.c.premiacao.teto_participante ? ` (até R$ ${melhor.c.premiacao.teto_participante} por pessoa)` : ''}. Vale pedido faturado.`,
  });
  db.prepare('UPDATE campanha SET nome = ?, definicao = ?, atualizado_em = ? WHERE id = ?').run(c.nome, JSON.stringify(c), agoraISO(), row.id);
  linhas.push({ id: row.id, nome: c.nome, premio_proj: Math.round(melhor.p), orcamento: orc });
}

recriarContaCorrenteExemplo();
invalidarCache();
console.table(linhas);
console.log(`recalibrado em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
