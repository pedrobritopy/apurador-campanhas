// Dados iniciais da conta corrente: acordos (% sobre compras reais do DW), NDs, bonificações, rebaixas, VPC,
// uso histórico da verba e as reservas das campanhas que já existem. Calibrado para contar uma história:
// contas saudáveis, uma ND atrasada, verba vencendo, uma conta negativa (Bayer) e uma sem saldo para a
// próxima campanha (Sanofi, lançamento Allegra).
import { db } from './db.js';
import { addDias, hojeISO } from './calendario.js';
import {
  PROPRIA, aoEncerrarCampanha, aplicarVerba, calcularSaldos, contaPorFabricante, fabricanteDaCampanha, garantirConta, inserirLancamentoBruto as inserir,
  necessidadeDaCampanha, planejarVerba, ultimoDiaDoMes, addMeses,
} from './contacorrente.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;

// alvo = disponível final desejado (depois das reservas); null = calculado
const PERFIS = [
  { fab: 'Haleon', pct: 1.8, limite: 10000, alvo: 21400, resp: 'Marina Duarte' },
  { fab: 'Hypera Pharma', pct: 1.5, limite: 15000, alvo: 9800, resp: 'Rogério Lima', ndAtrasada: true },
  { fab: 'Kenvue', pct: 1.6, limite: 10000, alvo: 38600, resp: 'Fernanda Prado', comprovacaoPendente: true },
  { fab: 'Sanofi', pct: 1.0, limite: 0, alvo: 1850, resp: 'Carlos Menezes' },
  { fab: 'Bayer', pct: 0.8, limite: 5000, alvo: -11200, resp: 'Juliana Arantes', pico: 3.2 },
  { fab: "L'Oréal", pct: 2.0, limite: 20000, alvo: 64000, resp: 'Patrícia Godoy', comprovacaoPendente: true },
  { fab: 'Procter & Gamble', pct: 0.3, limite: 5000, alvo: 'vencendo', resp: 'Eduardo Sales' },
  { fab: 'Cimed', pct: 1.2, limite: 5000, alvo: 46000, resp: 'Renato Viana' },
  { fab: 'NS Indústria', pct: 1.0, limite: 10000, alvo: 31500 },
  { fab: 'Roche', pct: 0.7, limite: 0, alvo: 12800 },
  { fab: 'NAOS', pct: 1.5, limite: 0, alvo: 9400 },
  { fab: 'Takeda', pct: 1.0, limite: 0, alvo: 4100 },
  { fab: 'Colgate-Palmolive', pct: 1.2, limite: 0, alvo: 5300 },
  { fab: 'Reckitt', pct: 1.5, limite: 0, alvo: 3900 },
  { fab: 'EMS', pct: 1.5, limite: 0, alvo: 2600 },
  { fab: 'Neo Química', pct: 2.0, limite: 0, alvo: 1700 },
  { fab: 'Aché', pct: 1.2, limite: 0, alvo: 1450 },
  { fab: 'Medley', pct: 1.5, limite: 0, alvo: 520 },
];

// créditos pontuais (situação realizado, salvo indicação)
const PONTUAIS = {
  Haleon: [
    { data: '2025-11-18', origem: 'bonificacao', valor: 6800, descricao: 'Bonificação Sensodyne em mercadoria (giro de fim de ano)' },
    { data: '2026-03-10', origem: 'nd', valor: 15000, descricao: 'Verba de aniversário da distribuidora' },
  ],
  'Hypera Pharma': [
    { data: '2026-01-15', origem: 'nd', valor: 12000, descricao: 'Verba Engov e Epocler verão 2026' },
    { data: '2026-04-20', origem: 'rebaixa', valor: 7450, descricao: 'Rebaixa de preço CMED abril/2026 (proteção do estoque)' },
  ],
  Kenvue: [
    { data: '2026-02-12', origem: 'bonificacao', valor: 12000, descricao: 'Bonificação Tylenol em mercadoria' },
    { data: '2026-06-05', origem: 'vpc', valor: 9000, descricao: 'VPC encarte Tylenol e Listerine' },
  ],
  Sanofi: [
    { data: '2026-04-22', origem: 'rebaixa', valor: 5200, descricao: 'Rebaixa de preço CMED abril/2026 (proteção do estoque)' },
    { data: '2026-10-10', origem: 'nd', valor: 18000, descricao: 'Verba de lançamento Allegra (acordo em assinatura)', situacao: 'previsto' },
  ],
  Bayer: [
    { data: '2026-05-15', origem: 'rebaixa', valor: 9500, descricao: 'Rebaixa de preço CMED abril/2026 (em negociação com a Bayer)', situacao: 'previsto' },
  ],
  "L'Oréal": [
    { data: '2025-12-04', origem: 'vpc', valor: 25000, descricao: 'VPC dermocosméticos fim de ano' },
    { data: '2026-07-08', origem: 'nd', valor: 30000, descricao: 'Verba de sell-out dermo 2º semestre' },
  ],
  'Procter & Gamble': [
    { data: '2026-08-15', origem: 'nd', valor: 20000, descricao: 'Verba Vick inverno (uso até 15/11/2026)', validade: '2026-11-15' },
  ],
  Roche: [
    { data: '2025-03-12', origem: 'vpc', valor: 8000, descricao: 'VPC 1º semestre 2025', validade: '2025-09-30' },
  ],
};

const DEBITOS_FIXOS = {
  Roche: [{ data: '2025-10-01', origem: 'expiracao', valor: 8000, descricao: 'Baixa de verba vencida: VPC 1º semestre 2025 sem uso' }],
};

const ACOES = ['Tabloide da rede de farmácias', 'Ponto extra e degustação em lojas', 'Ação de sell-out com redes associativistas', 'Encarte promocional do mês', 'Ativação no balcão (PDV)'];
const REPASSES = ['Desconto financeiro repassado em pedidos', 'Bonificação repassada a clientes (giro)', 'Condição especial para clientes curva A'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = (v) => Math.round(v * 100) / 100;

function mesesEntre(ini, fim) {
  const out = [];
  let [a, m] = ini.split('-').map(Number);
  const [af, mf] = fim.split('-').map(Number);
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; a++; }
  }
  return out;
}

export function recriarContaCorrenteExemplo({ log = () => {} } = {}) {
  const hoje = hojeISO();
  const mesAtual = hoje.slice(0, 7);
  const ref = db.prepare("SELECT MAX(data_pedido) d FROM fato_vendas").get().d || hoje;
  const sorteio = rng(2026);
  db.exec('DELETE FROM cc_lancamento; DELETE FROM cc_conta;');

  // compras do mês ≈ custo das vendas faturadas (sell-in acompanha o sell-out)
  const cmv = new Map();
  for (const r of db.prepare(
    `SELECT p.fabricante f, substr(v.data_pedido, 1, 7) m, SUM(v.custo_total) c
       FROM fato_vendas v JOIN dm_produto p ON p.id_produto = v.id_produto
      WHERE v.status = 'Faturado' GROUP BY 1, 2`,
  ).all()) cmv.set(`${r.f}|${r.m}`, r.c);
  const primeiroMes = db.prepare('SELECT MIN(data_pedido) d FROM fato_vendas').get().d.slice(0, 7);
  const meses = mesesEntre(primeiroMes, mesAtual);

  // campanhas existentes: quanto cada uma vai reservar (para calibrar o saldo final)
  const campanhas = db.prepare("SELECT * FROM campanha WHERE status IN ('ativa', 'encerrada') ORDER BY id").all().map((c) => ({ ...c, def: JSON.parse(c.definicao) }));
  const reservasPorFab = new Map();
  const planoCamp = [];
  for (const c of campanhas.filter((x) => x.status === 'ativa')) {
    const { fabricante } = fabricanteDaCampanha(c.def);
    const nec = necessidadeDaCampanha(c.def, null);
    planoCamp.push({ c, fabricante, valor: nec.valor });
    reservasPorFab.set(fabricante, (reservasPorFab.get(fabricante) || 0) + nec.valor);
  }

  // ---------- contas e créditos do acordo
  const acordos = [];
  for (const p of PERFIS) {
    if (!db.prepare('SELECT 1 FROM dm_produto WHERE fabricante = ? LIMIT 1').get(p.fab)) continue;
    const conta = garantirConta(p.fab, {
      limite: p.limite, perc_acordo: p.pct, validade_meses: 12, prazo_nd_dias: 30,
      responsavel: p.resp ? `${p.resp} (gerente de contas)` : null,
      observacao: `Acordo comercial: ${String(p.pct).replace('.', ',')}% sobre as compras do mês, apurado no fechamento e cobrado por ND com abatimento em duplicata.`,
    });
    p.conta = conta;
    for (const m of meses) {
      const base = cmv.get(`${p.fab}|${m}`) || 0;
      const valor = R((base * p.pct) / 100);
      if (valor < 1) continue;
      const fimMes = ultimoDiaDoMes(`${m}-01`);
      const validade = ultimoDiaDoMes(addMeses(`${m}-01`, 12));
      if (m === mesAtual) {
        acordos.push({ conta, data: ref < fimMes ? ref : fimMes, valor, situacao: 'previsto', validade, descricao: `Provisão do acordo comercial ${nomeMes(m)} (parcial, compras até ${ref.slice(8, 10)}/${ref.slice(5, 7)})` });
        continue;
      }
      const emitido = `${addMeses(`${m}-01`, 1).slice(0, 7)}-05`;
      const vencimento = addDias(emitido, conta.prazo_nd_dias);
      const atrasada = p.ndAtrasada && m === addMeses(`${mesAtual}-01`, -2).slice(0, 7);
      const liquidada = vencimento <= hoje && !atrasada;
      acordos.push({
        conta, data: fimMes, valor, validade, emitido, vencimento,
        situacao: liquidada ? 'realizado' : 'a_receber',
        liquidado_em: liquidada ? vencimento : null,
        descricao: `Acordo comercial ${nomeMes(m)}: ${String(p.pct).replace('.', ',')}% sobre compras`,
      });
    }
  }
  // NDs numeradas em ordem de emissão
  const seq = {};
  for (const a of acordos.filter((x) => x.emitido).sort((x, y) => x.emitido.localeCompare(y.emitido) || x.conta.nome.localeCompare(y.conta.nome))) {
    const ano = a.emitido.slice(0, 4);
    seq[ano] = (seq[ano] || 0) + 1;
    a.documento = `ND ${String(seq[ano]).padStart(6, '0')}/${ano}`;
  }
  for (const a of acordos) {
    inserir({
      id_conta: a.conta.id, data: a.data, natureza: 'credito', origem: 'acordo', situacao: a.situacao, valor: a.valor, descricao: a.descricao,
      documento: a.documento, emitido_em: a.emitido, vencimento: a.vencimento, validade: a.validade, liquidado_em: a.liquidado_em,
      forma_liquidacao: a.situacao === 'realizado' ? 'abatimento_duplicata' : null, criado_em: `${a.data}T12:00:00.000Z`,
    });
  }
  for (const [fab, itens] of Object.entries(PONTUAIS)) {
    const conta = contaPorFabricante(fab);
    if (!conta) continue;
    for (const it of itens) {
      const sit = it.situacao || 'realizado';
      const emitido = it.origem === 'nd' && sit !== 'previsto' ? it.data : null;
      seq[it.data.slice(0, 4)] = (seq[it.data.slice(0, 4)] || 0) + 1;
      inserir({
        id_conta: conta.id, data: it.data, natureza: 'credito', origem: it.origem, situacao: sit, valor: it.valor, descricao: it.descricao,
        documento: it.origem === 'nd' && sit !== 'previsto' ? `ND ${String(seq[it.data.slice(0, 4)]).padStart(6, '0')}/${it.data.slice(0, 4)}` : it.origem === 'bonificacao' ? `NF bonificação ${Math.round(80000 + sorteio() * 9999)}` : null,
        emitido_em: emitido, vencimento: emitido ? addDias(emitido, 30) : null,
        validade: it.validade || ultimoDiaDoMes(addMeses(it.data, 12)),
        liquidado_em: sit === 'realizado' ? (emitido ? addDias(emitido, 30) < hoje ? addDias(emitido, 30) : it.data : it.data) : null,
        forma_liquidacao: sit !== 'realizado' ? null : it.origem === 'bonificacao' ? 'mercadoria' : it.origem === 'nd' ? 'abatimento_duplicata' : 'deposito',
        criado_em: `${it.data}T12:00:00.000Z`,
      });
    }
  }
  for (const [fab, itens] of Object.entries(DEBITOS_FIXOS)) {
    const conta = contaPorFabricante(fab);
    if (!conta) continue;
    for (const it of itens) inserir({ id_conta: conta.id, data: it.data, natureza: 'debito', origem: it.origem, situacao: 'realizado', valor: it.valor, descricao: it.descricao, liquidado_em: it.data, criado_em: `${it.data}T12:00:00.000Z` });
  }

  // ---------- verba própria: orçamento mensal de incentivo da diretoria comercial
  const propria = garantirConta(PROPRIA, {
    limite: 0, validade_meses: 2, politica: 'realizado',
    responsavel: 'Diretoria comercial', observacao: 'Orçamento interno para campanhas sem patrocínio de indústria (ex.: meta geral do mês). Não acumula: vale por 2 meses.',
  });
  for (const m of meses) {
    const valor = m === mesAtual ? 90000 : 60000;
    inserir({
      id_conta: propria.id, data: `${m}-01`, natureza: 'credito', origem: 'orcamento', situacao: 'realizado', valor, liquidado_em: `${m}-01`,
      descricao: `Orçamento de incentivo ${nomeMes(m)}`, validade: ultimoDiaDoMes(addMeses(`${m}-01`, 2)), criado_em: `${m}-01T09:00:00.000Z`,
    });
  }

  // ---------- encerrada: reserva consumida, débito do prêmio e sobra devolvida
  for (const c of campanhas.filter((x) => x.status === 'encerrada')) {
    const foto = db.prepare("SELECT id, resultado FROM fotografia WHERE id_campanha = ? AND tipo = 'fechamento' ORDER BY id DESC LIMIT 1").get(c.id);
    if (!foto) continue;
    const r = JSON.parse(foto.resultado);
    const premio = r.resumo?.premio_total || 0;
    const { fabricante } = fabricanteDaCampanha(c.def);
    const conta = garantirConta(fabricante);
    const reserva = Math.ceil((premio * 1.2) / 100) * 100;
    inserir({
      id_conta: conta.id, data: addDias(c.inicio, -3), natureza: 'debito', origem: 'campanha', situacao: 'reservado', valor: reserva,
      descricao: `Reserva: ${c.nome}`, id_campanha: c.id, observacao: 'Sem orçamento: prêmio projetado mais 20% de folga.', criado_em: `${addDias(c.inicio, -3)}T14:00:00.000Z`,
    });
    aoEncerrarCampanha(c.id, c.def, r, foto.id);
    db.prepare("UPDATE cc_lancamento SET comprovacao = 'enviada', criado_em = ? WHERE id_campanha = ? AND origem = 'campanha' AND situacao = 'realizado'").run(`${c.fim}T18:00:00.000Z`, c.id);
  }

  // ---------- uso histórico da verba, calibrado para chegar ao disponível desejado
  for (const p of [...PERFIS.filter((x) => x.conta), { fab: PROPRIA, conta: contaPorFabricante(PROPRIA), alvo: 22600, propria: true }]) {
    const conta = contaPorFabricante(p.fab);
    const lancs = db.prepare('SELECT * FROM cc_lancamento WHERE id_conta = ?').all(conta.id).map((l) => ({ ...l }));
    const s = calcularSaldos(conta, lancs, hoje);
    const reservas = reservasPorFab.get(p.fab) || 0;
    let alvo = p.alvo;
    if (alvo === 'vencendo') {
      // deixa parte da verba Vick (vence 15/11) sem uso: alerta de verba vencendo
      const tardios = lancs.filter((l) => l.natureza === 'credito' && ['realizado', 'a_receber'].includes(l.situacao) && l.validade > hoje).reduce((a, l) => a + l.valor, 0);
      alvo = R(tardios - 0.45 * 20000);
    }
    const consumir = R(s.base - s.reservado - reservas - alvo);
    if (consumir <= 0) continue;
    // distribui pelos meses passados, proporcional ao crédito de cada mês
    // a verba é usada depois de confirmada: o uso de cada mês acompanha o crédito de dois meses antes;
    // contas com pico (Bayer) gastaram pesado nos dois últimos meses e ficaram negativas
    const passados = meses.filter((m) => m < mesAtual);
    const credMes = (m) => lancs.filter((l) => l.natureza === 'credito' && l.data.startsWith(m)).reduce((a, l) => a + l.valor, 0);
    const pesos = passados.map((m, i) => {
      const base = i < 2 ? 0 : credMes(passados[i - 2]);
      const pico = p.pico && i >= passados.length - 2 ? p.pico : 1;
      return { m, peso: base * pico * (0.75 + sorteio() * 0.5) };
    });
    const total = pesos.reduce((a, x) => a + x.peso, 0);
    let restante = consumir;
    let guardado = 0; // valores pequenos se juntam com o mês seguinte (ninguém lança ação de R$ 40)
    pesos.forEach(({ m, peso }, i) => {
      const ultimo = i === pesos.length - 1;
      const parcela = ultimo ? restante : R((consumir * peso) / total);
      restante = R(restante - parcela);
      guardado = R(guardado + parcela);
      if (guardado <= 0 || (!ultimo && guardado < 600)) return;
      const doMes = guardado;
      guardado = 0;
      const trimestre = Number(m.slice(5, 7)) % 3 === 0 && doMes >= 1500;
      const partes = doMes < 1200 && !p.propria
        ? [{ origem: 'acao_trade', frac: 1, descricao: `${ACOES[Math.floor(sorteio() * ACOES.length)]} ${nomeMes(m)}` }]
        : p.propria
        ? [{ origem: 'campanha', frac: 1, descricao: `Campanhas internas de incentivo ${nomeMes(m)} (apuradas em planilha)` }]
        : [
          { origem: 'acao_trade', frac: trimestre ? 0.45 : 0.62, descricao: `${ACOES[Math.floor(sorteio() * ACOES.length)]} ${nomeMes(m)}` },
          { origem: 'repasse', frac: trimestre ? 0.25 : 0.38, descricao: `${REPASSES[Math.floor(sorteio() * REPASSES.length)]} ${nomeMes(m)}` },
          ...(trimestre ? [{ origem: 'campanha', frac: 0.3, descricao: `Campanha de incentivo ${Math.ceil(Number(m.slice(5, 7)) / 3)}º tri/${m.slice(0, 4)} (apurada em planilha)` }] : []),
        ];
      let acumulado = 0;
      partes.forEach((pt, j) => {
        const v = j === partes.length - 1 ? R(doMes - acumulado) : R(doMes * pt.frac);
        acumulado = R(acumulado + v);
        const dia = String(Math.min(28, 8 + Math.floor(sorteio() * 20))).padStart(2, '0');
        const data = `${m}-${dia}`;
        const idade = (Date.parse(hoje) - Date.parse(data)) / 86400000;
        inserir({
          id_conta: conta.id, data, natureza: 'debito', origem: pt.origem, situacao: 'realizado', valor: v, descricao: pt.descricao, liquidado_em: data,
          documento: pt.origem === 'acao_trade' ? `Contrato de ação ${m.replace('-', '')}-${conta.id}` : null,
          comprovacao: p.propria || !['acao_trade', 'campanha'].includes(pt.origem) ? null : idade > 70 ? 'aprovada' : !(p.comprovacaoPendente && pt.origem === 'campanha') ? 'enviada' : 'pendente',
          criado_em: `${data}T15:00:00.000Z`,
        });
      });
    });
  }

  // ---------- reservas das campanhas ativas (a Bayer só entrou com exceção da diretoria)
  for (const { c } of planoCamp) {
    const plano = planejarVerba(c.def, {
      status: 'ativa', idCampanha: c.id,
      excecao: { justificativa: 'Aprovado pela diretoria comercial em reunião de 28/09/2026: ND de rebaixa da Bayer em negociação.', autorizado_por: 'Diretoria comercial' },
    });
    aplicarVerba(c.id, c.def, plano);
    const data = addDias(c.inicio, -3) < hoje ? addDias(c.inicio, -3) : hoje;
    db.prepare("UPDATE cc_lancamento SET data = ?, criado_em = ? WHERE id_campanha = ? AND situacao = 'reservado'").run(data, `${data}T14:00:00.000Z`, c.id);
  }
  const n = db.prepare('SELECT COUNT(*) n FROM cc_lancamento').get().n;
  log(`conta corrente: ${db.prepare('SELECT COUNT(*) n FROM cc_conta').get().n} contas, ${n} lançamentos`);
  return n;
}

