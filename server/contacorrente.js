// Conta corrente de verbas por fabricante (indústria).
//
// Como as distribuidoras fazem: a indústria concede verba por acordo comercial (% sobre as compras), verbas
// pontuais cobradas por nota de débito (ND), propaganda cooperada (VPC), bonificação em mercadoria e rebaixa de
// preço (proteção do estoque). A distribuidora usa essa verba em campanhas de incentivo, ações comerciais e
// descontos repassados. Cada crédito tem validade; a ND é liquidada por abatimento em duplicata ou depósito; o uso
// precisa de comprovação. Aqui: a campanha reserva a verba ao ser ativada, debita o prêmio apurado ao encerrar e
// devolve a sobra; sem saldo, a campanha não é ativada (salvo exceção autorizada e registrada).
import { db, agoraISO, transacao } from './db.js';
import { addDias, hojeISO, periodoAnterior } from './calendario.js';
import { apurarComCache, normalizarCampanha } from './motor.js';
import { catalogoProdutos, resolverProdutos } from './seletor.js';

db.exec(`
CREATE TABLE IF NOT EXISTS cc_conta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fabricante TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  politica TEXT NOT NULL DEFAULT 'confirmado',
  limite REAL NOT NULL DEFAULT 0,
  perc_acordo REAL,
  validade_meses INTEGER NOT NULL DEFAULT 12,
  prazo_nd_dias INTEGER NOT NULL DEFAULT 30,
  margem_reserva REAL NOT NULL DEFAULT 20,
  bloqueada INTEGER NOT NULL DEFAULT 0,
  motivo_bloqueio TEXT,
  responsavel TEXT,
  contato TEXT,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_lancamento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_conta INTEGER NOT NULL,
  data TEXT NOT NULL,
  natureza TEXT NOT NULL,
  origem TEXT NOT NULL,
  situacao TEXT NOT NULL,
  valor REAL NOT NULL,
  valor_utilizado REAL,
  descricao TEXT NOT NULL,
  documento TEXT,
  emitido_em TEXT,
  vencimento TEXT,
  validade TEXT,
  liquidado_em TEXT,
  forma_liquidacao TEXT,
  comprovacao TEXT,
  id_campanha INTEGER,
  id_origem INTEGER,
  regra TEXT,
  excecao INTEGER NOT NULL DEFAULT 0,
  justificativa TEXT,
  autorizado_por TEXT,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_lanc_conta ON cc_lancamento(id_conta, data);
CREATE INDEX IF NOT EXISTS idx_cc_lanc_camp ON cc_lancamento(id_campanha);
`);

export const PROPRIA = '__propria__';
export const NOME_PROPRIA = 'Verba própria (distribuidora)';
const JANELA_VENCENDO = 45;

export const ORIGENS = {
  acordo: { natureza: 'credito', rotulo: 'Acordo comercial' },
  nd: { natureza: 'credito', rotulo: 'Verba negociada (ND)' },
  vpc: { natureza: 'credito', rotulo: 'Propaganda cooperada (VPC)' },
  bonificacao: { natureza: 'credito', rotulo: 'Bonificação em mercadoria' },
  rebaixa: { natureza: 'credito', rotulo: 'Rebaixa de preço' },
  orcamento: { natureza: 'credito', rotulo: 'Orçamento interno' },
  campanha: { natureza: 'debito', rotulo: 'Campanha de incentivo' },
  acao_trade: { natureza: 'debito', rotulo: 'Ação comercial' },
  repasse: { natureza: 'debito', rotulo: 'Desconto repassado' },
  expiracao: { natureza: 'debito', rotulo: 'Baixa de verba vencida' },
  ajuste: { natureza: null, rotulo: 'Ajuste' },
  estorno: { natureza: null, rotulo: 'Estorno' },
};
export const SITUACOES = ['previsto', 'a_receber', 'realizado', 'reservado', 'consumido', 'liberado', 'cancelado'];
export const POLITICAS = ['realizado', 'confirmado', 'previsto'];

const R = (v) => Math.round((Number(v) || 0) * 100) / 100;
const moeda = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(R(v)).replace(/ /g, ' ');
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
// transação que tolera chamada dentro de outra (o seed e os ganchos reaproveitam as mesmas funções)
const tx = (fn) => (db.isTransaction ? fn() : transacao(fn));
const erro = (msg, status = 400, detalhes) => Object.assign(new Error(msg), { status, ...(detalhes ? { detalhes } : {}) });
const fmtDataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// ------------------------------------------------------------------ contas
export function fabricantesDaBase() {
  return [...new Set(catalogoProdutos().map((p) => p.fabricante).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export const nomeDaConta = (fabricante) => (fabricante === PROPRIA ? NOME_PROPRIA : fabricante);

export function contaPorFabricante(fabricante) {
  return db.prepare('SELECT * FROM cc_conta WHERE fabricante = ?').get(String(fabricante)) || null;
}

export function contaPorId(id) {
  const c = db.prepare('SELECT * FROM cc_conta WHERE id = ?').get(Number(id));
  if (!c) throw erro('Conta corrente não encontrada.', 404);
  return c;
}

export function garantirConta(fabricante, extra = {}) {
  const atual = contaPorFabricante(fabricante);
  if (atual) return atual;
  const agora = agoraISO();
  db.prepare(
    `INSERT INTO cc_conta (fabricante, nome, politica, limite, perc_acordo, validade_meses, prazo_nd_dias, margem_reserva, responsavel, contato, observacao, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fabricante, extra.nome || nomeDaConta(fabricante), POLITICAS.includes(extra.politica) ? extra.politica : 'confirmado',
    R(extra.limite ?? 0), extra.perc_acordo ?? null, extra.validade_meses ?? 12, extra.prazo_nd_dias ?? 30, extra.margem_reserva ?? 20,
    extra.responsavel ?? null, extra.contato ?? null, extra.observacao ?? null, agora, agora,
  );
  return contaPorFabricante(fabricante);
}

const lancamentosDaConta = (idConta) => db.prepare('SELECT * FROM cc_lancamento WHERE id_conta = ? ORDER BY data, id').all(idConta).map((l) => ({ ...l }));

/** Conta créditos para o saldo conforme a política da conta. */
function creditoConta(l, politica) {
  if (l.natureza !== 'credito') return false;
  if (l.situacao === 'realizado') return true;
  if (l.situacao === 'a_receber') return politica !== 'realizado';
  if (l.situacao === 'previsto') return politica === 'previsto';
  return false;
}

/**
 * Saldos da conta.
 * realizado = créditos recebidos − débitos realizados; a_receber = NDs emitidas e não liquidadas;
 * previsto = provisões ainda sem ND; reservado = reservas de campanhas ativas + débitos previstos;
 * vencido/vencendo = verba não usada cuja validade passou / vence em até 45 dias (consumo pela validade mais curta);
 * disponível = (base da política) − reservado − vencido; capacidade = disponível + limite.
 */
export function calcularSaldos(conta, lancs, hoje = hojeISO()) {
  let crReal = 0;
  let dbReal = 0;
  let aReceber = 0;
  let previsto = 0;
  let reservado = 0;
  let ndAtrasada = 0;
  let nNdAtrasada = 0;
  for (const l of lancs) {
    const v = l.valor;
    if (l.natureza === 'credito') {
      if (l.situacao === 'realizado') crReal += v;
      else if (l.situacao === 'a_receber') {
        aReceber += v;
        if (l.vencimento && l.vencimento < hoje) {
          ndAtrasada += v;
          nNdAtrasada++;
        }
      } else if (l.situacao === 'previsto') previsto += v;
    } else if (l.situacao === 'realizado') dbReal += v;
    else if (l.situacao === 'reservado' || l.situacao === 'previsto') reservado += v;
  }
  const realizado = crReal - dbReal;
  const base = realizado + (conta.politica !== 'realizado' ? aReceber : 0) + (conta.politica === 'previsto' ? previsto : 0);

  // validade: o consumo (débitos + reservas) usa primeiro a verba que vence antes
  const creditos = lancs.filter((l) => creditoConta(l, conta.politica)).sort((a, b) =>
    (a.validade || '9999-12-31').localeCompare(b.validade || '9999-12-31') || a.data.localeCompare(b.data) || a.id - b.id);
  let resto = dbReal + reservado;
  let vencido = 0;
  let vencendo = 0;
  let proximoVencimento = null;
  const limiteVenc = addDias(hoje, JANELA_VENCENDO);
  for (const l of creditos) {
    const usado = Math.min(l.valor, Math.max(0, resto));
    resto -= usado;
    const sobra = l.valor - usado;
    if (sobra > 0.005 && l.validade) {
      if (l.validade < hoje) vencido += sobra;
      else if (l.validade <= limiteVenc) {
        vencendo += sobra;
        if (!proximoVencimento || l.validade < proximoVencimento) proximoVencimento = l.validade;
      }
    }
  }
  const disponivel = base - reservado - vencido;
  // ritmo de entrada: crédito médio por mês nos últimos 6 meses (referência de saldo baixo)
  const seisMeses = addDias(hoje, -182);
  const mediaMensal = lancs.filter((l) => l.natureza === 'credito' && l.origem !== 'estorno' && ['realizado', 'a_receber', 'previsto'].includes(l.situacao) && l.data >= seisMeses)
    .reduce((a, l) => a + l.valor, 0) / 6;
  const capacidade = disponivel + (conta.limite || 0);
  return {
    creditos_realizados: R(crReal),
    debitos_realizados: R(dbReal),
    realizado: R(realizado),
    a_receber: R(aReceber),
    previsto: R(previsto),
    reservado: R(reservado),
    vencido: R(vencido),
    vencendo: R(vencendo),
    proximo_vencimento: proximoVencimento,
    nd_atrasada: R(ndAtrasada),
    n_nd_atrasada: nNdAtrasada,
    base: R(base),
    disponivel: R(disponivel),
    limite: R(conta.limite || 0),
    capacidade: R(capacidade),
    credito_medio_mensal: R(mediaMensal),
    saldo_baixo: disponivel >= 0 && disponivel < Math.max(500, mediaMensal * 0.25),
    uso_limite: conta.limite > 0 ? Math.max(0, Math.min(1.5, -disponivel / conta.limite)) : disponivel < 0 ? 1 : 0,
  };
}

export const SITUACAO_CONTA = {
  ok: 'Saudável',
  atencao: 'Atenção',
  no_limite: 'Usando o limite',
  estourada: 'Negativa',
  bloqueada: 'Bloqueada',
};

function situacaoConta(conta, s) {
  if (conta.bloqueada) return 'bloqueada';
  if (s.capacidade < -0.005 || (s.disponivel < -0.005 && !(conta.limite > 0))) return 'estourada';
  if (s.disponivel < -0.005) return 'no_limite';
  if (s.n_nd_atrasada || s.vencendo > 0 || s.vencido > 0 || s.saldo_baixo) return 'atencao';
  return 'ok';
}

export function saldosDaConta(conta) {
  return calcularSaldos(conta, lancamentosDaConta(conta.id));
}

// ------------------------------------------------------------------ campanha × conta
/** De qual conta sai a verba da campanha: fabricante definido, texto do fornecedor ou produtos dos critérios. */
export function fabricanteDaCampanha(def) {
  const c = def?.criterios && def?.premiacao ? def : normalizarCampanha(def || {});
  const fabs = fabricantesDaBase();
  if (c.fabricante) return { fabricante: c.fabricante, como: 'definido' };
  if (c.varios_fornecedores) return { fabricante: PROPRIA, como: 'varios' };
  const f = norm(c.fornecedor);
  if (f) {
    const achado = fabs.find((x) => norm(x) === f) || fabs.find((x) => f.includes(norm(x)) || norm(x).includes(f));
    if (achado) return { fabricante: achado, como: 'fornecedor' };
    if (/vario|divers|todos|geral/.test(f)) return { fabricante: PROPRIA, como: 'varios' };
  }
  const achados = new Set();
  let todos = false;
  for (const cr of c.criterios || []) {
    const sels = cr.metrica === 'combo' && cr.combo?.itens?.length ? cr.combo.itens.map((i) => i.produtos) : [cr.produtos];
    for (const s of sels) {
      if (!s) continue;
      const vazio = !s.fabricantes?.length && !s.marcas?.length && !s.subcategorias?.length && !s.ids?.length && !s.grupos?.length;
      if (vazio) {
        todos = true;
        continue;
      }
      const porId = new Map(catalogoProdutos().map((p) => [p.id, p.fabricante]));
      for (const id of resolverProdutos(s)) if (porId.get(id)) achados.add(porId.get(id));
    }
  }
  if (!todos && achados.size === 1) return { fabricante: [...achados][0], como: 'produtos' };
  return { fabricante: PROPRIA, como: achados.size > 1 ? 'varios' : 'geral' };
}

/** Período completo mais recente com a mesma duração (para estimar campanhas futuras). */
function periodoCompletoAnterior(inicio, fim, referencia) {
  let p = periodoAnterior(inicio, fim);
  for (let i = 0; i < 6 && p.fim > referencia; i++) p = periodoAnterior(p.inicio, p.fim);
  return p;
}

/** Prêmio se todos baterem exatamente 100% da meta (reserva conservadora quando não há histórico). */
function potencialNaMeta(c, r) {
  const pr = c.premiacao;
  const idx = Math.max(0, c.criterios.findIndex((cr) => cr.id === pr.criterio_base));
  const faixa = pr.faixas.filter((f) => f.min <= 100).pop() || pr.faixas[0];
  let total = 0;
  for (const l of r.participantes) {
    const meta = l.criterios?.[idx]?.meta || 0;
    let p = 0;
    if (pr.tipo === 'faixas' && faixa) p = faixa.fixo + (pr.variavel_sobre === 'total' ? faixa.variavel * meta : 0);
    if (pr.tipo === 'bloco' && pr.bloco?.sobre !== 'excedente') {
      let blocos = Math.floor(meta / pr.bloco.tamanho);
      if (pr.bloco.max_blocos > 0) blocos = Math.min(blocos, pr.bloco.max_blocos);
      p = blocos * pr.bloco.valor;
    }
    if (pr.bonus?.ativo && pr.bonus.min <= 100) p += pr.bonus.valor;
    if (pr.teto_participante > 0) p = Math.min(p, pr.teto_participante);
    total += p;
  }
  return R(total);
}

/** Quanto a campanha precisa reservar e por quê. */
export function necessidadeDaCampanha(def, conta = null) {
  const c = def?.criterios && def?.premiacao ? def : normalizarCampanha(def || {});
  const pr = c.premiacao;
  const margem = (conta?.margem_reserva ?? 20) / 100;
  if (pr.tipo === 'nenhuma') return { valor: 0, base: 'sem_premio', texto: 'Campanha sem prêmio: não reserva verba.' };
  if (pr.orcamento > 0) return { valor: R(pr.orcamento), base: 'orcamento', texto: `Orçamento da premiação: ${moeda(pr.orcamento)}.` };

  let proj = 0;
  let estimado = false;
  let periodo = null;
  let potencial = 0;
  let nPart = 0;
  try {
    const r = apurarComCache(c);
    potencial = potencialNaMeta(c, r);
    nPart = r.participantes.length;
    proj = r.resumo.premio_proj_total || 0;
    if (r.tempo.status === 'futura' || !(proj > 0)) {
      periodo = periodoCompletoAnterior(c.inicio, c.fim, r.tempo.referencia);
      const r2 = apurarComCache({ ...c, inicio: periodo.inicio, fim: periodo.fim });
      if ((r2.resumo.premio_total || 0) > proj) {
        proj = r2.resumo.premio_total;
        estimado = true;
      }
    }
  } catch {
    proj = 0;
  }
  let fixo = 0;
  if (pr.tipo === 'ranking') fixo = pr.ranking.posicoes.reduce((a, p) => a + p.valor * (p.ate - p.de + 1), 0);
  if (pr.tipo === 'rateio') fixo = pr.rateio.valor_total;
  const porProj = proj > 0 ? Math.ceil((proj * (1 + margem)) / 100) * 100 : 0;
  // ranking e rateio têm teto conhecido; só passam dele com bônus por meta ou acelerador
  const extras = pr.bonus?.ativo || pr.multiplicadores.some((m) => m.fator > 1 || m.senao > 1);
  const valor = R(fixo > 0 && !extras ? fixo : Math.max(fixo, porProj));
  const folga = Math.round(margem * 100);
  let texto;
  let base;
  if (fixo > 0 && (fixo >= porProj || !extras)) {
    base = pr.tipo === 'ranking' ? 'ranking' : 'rateio';
    texto = pr.tipo === 'ranking' ? `Soma dos prêmios do ranking: ${moeda(fixo)}.` : `Verba total do rateio: ${moeda(fixo)}.`;
  } else if (porProj > 0) {
    base = estimado ? 'estimativa' : 'projecao';
    texto = estimado
      ? `Sem orçamento: estimado pelo prêmio que a campanha pagaria de ${fmtDataBR(periodo.inicio)} a ${fmtDataBR(periodo.fim)} (${moeda(proj)}) mais ${folga}% de folga.`
      : `Sem orçamento: prêmio projetado (${moeda(proj)}) mais ${folga}% de folga.`;
  } else if (potencial > 0) {
    base = 'potencial';
    texto = `Sem orçamento e sem histórico de venda: reservado o prêmio se todos os ${nPart} participantes baterem a meta (${moeda(potencial)}).`;
  } else {
    base = 'sem_estimativa';
    texto = 'Sem orçamento e sem histórico para estimar o prêmio: nada a reservar agora. Defina um orçamento.';
  }
  return {
    valor: base === 'potencial' ? R(Math.ceil(potencial / 100) * 100) : valor,
    base,
    texto,
    premio_projetado: R(proj),
    aviso: ['projecao', 'estimativa', 'potencial', 'sem_estimativa'].includes(base)
      ? 'Defina um orçamento na premiação para travar o valor reservado.'
      : null,
  };
}

const reservasAtivas = (idCampanha) =>
  db.prepare("SELECT * FROM cc_lancamento WHERE id_campanha = ? AND situacao = 'reservado' ORDER BY id").all(Number(idCampanha)).map((l) => ({ ...l }));

const regraDaCampanha = (c) => JSON.stringify([c.premiacao, c.inicio, c.fim, c.participantes, c.fabricante, c.fornecedor, c.varios_fornecedores]);

function validarExcecao(excecao) {
  const j = String(excecao?.justificativa || '').trim();
  if (j.length < 10) return null;
  return { justificativa: j, autorizado_por: String(excecao?.autorizado_por || '').trim() || null };
}

/** Situação de saldo de uma conta (que pode nem existir ainda) diante de um valor. */
export function coberturaDe(fabricante, valor) {
  const conta = contaPorFabricante(fabricante);
  const s = conta ? saldosDaConta(conta) : null;
  const capacidade = s ? s.capacidade : 0;
  const disponivel = s ? s.disponivel : 0;
  const bloqueada = Boolean(conta?.bloqueada);
  const cobre = !bloqueada && capacidade + 0.005 >= valor;
  return {
    fabricante,
    nome: conta?.nome || nomeDaConta(fabricante),
    id_conta: conta?.id ?? null,
    existe: Boolean(conta),
    disponivel,
    limite: s?.limite ?? 0,
    capacidade,
    reservado: s?.reservado ?? 0,
    a_receber: s?.a_receber ?? 0,
    previsto: s?.previsto ?? 0,
    situacao: conta && s ? situacaoConta(conta, s) : 'estourada',
    rotulo_situacao: conta && s ? SITUACAO_CONTA[situacaoConta(conta, s)] : 'Sem conta',
    bloqueada,
    motivo_bloqueio: conta?.motivo_bloqueio || null,
    necessario: R(valor),
    cobre,
    falta: cobre ? 0 : R(Math.max(0, valor - capacidade)),
  };
}

function mensagemBloqueio(cob, valor) {
  if (!cob.existe) {
    return `A conta corrente ${cob.nome} ainda não tem verba lançada. A campanha precisa reservar ${moeda(valor)}. Lance o acordo, a ND ou o orçamento antes de ativar, ou peça uma exceção com justificativa.`;
  }
  if (cob.bloqueada) {
    return `A conta corrente ${cob.nome} está bloqueada${cob.motivo_bloqueio ? ` (${cob.motivo_bloqueio})` : ''}. A campanha precisa reservar ${moeda(valor)}. Só é possível ativar com exceção autorizada.`;
  }
  const comLimite = cob.limite > 0 ? ` (já contando o limite de ${moeda(cob.limite)})` : '';
  return `Saldo insuficiente na conta corrente ${cob.nome}: disponível ${moeda(cob.capacidade)}${comLimite}, a campanha precisa reservar ${moeda(valor)}. Faltam ${moeda(cob.falta)}. Lance a verba (acordo ou ND) ou peça uma exceção com justificativa.`;
}

/**
 * Antes de gravar a campanha: decide o que fazer com a verba e BLOQUEIA (erro 409) se não houver saldo.
 * @returns {null | {acao: 'reservar'|'liberar'|'encerrar', ...}}
 */
export function planejarVerba(def, { status, idCampanha = null, statusAnterior = null, excecao = null } = {}) {
  const c = def?.criterios && def?.premiacao ? def : normalizarCampanha(def || {});
  const atuais = idCampanha ? reservasAtivas(idCampanha) : [];
  const reabrir = statusAnterior === 'encerrada' && status === 'ativa';
  if (status === 'encerrada') return statusAnterior === 'encerrada' ? null : { acao: 'encerrar' };
  if (status !== 'ativa') return atuais.length ? { acao: 'liberar', motivo: status === 'rascunho' ? 'Campanha voltou para rascunho' : 'Campanha arquivada' } : null;

  const { fabricante, como } = fabricanteDaCampanha(c);
  const regra = regraDaCampanha(c);
  const conta = contaPorFabricante(fabricante);
  const mesma = atuais.length === 1 && conta && atuais[0].id_conta === conta.id ? atuais[0] : null;
  // campanha já ativa e regras de prêmio iguais: mantém a reserva (editar a descrição não mexe na verba)
  if (mesma && mesma.regra === regra && !reabrir) return null;

  const nec = necessidadeDaCampanha(c, conta);
  const delta = R(nec.valor - (mesma ? mesma.valor : 0));
  const exc = validarExcecao(excecao);
  if (delta > 0.005) {
    const cob = coberturaDe(fabricante, delta);
    if (!cob.cobre && !exc) {
      throw erro(mensagemBloqueio(cob, delta), 409, {
        codigo: 'saldo_insuficiente',
        conta_corrente: { ...cob, necessario_total: nec.valor, base: nec.base, texto: nec.texto, como },
      });
    }
    return { acao: 'reservar', fabricante, como, regra, reabrir, necessidade: nec, delta, excecao: !cob.cobre ? exc : null, mesma: mesma?.id ?? null, liberar: atuais.filter((l) => l.id !== mesma?.id).map((l) => l.id) };
  }
  return { acao: 'reservar', fabricante, como, regra, reabrir, necessidade: nec, delta, excecao: null, mesma: mesma?.id ?? null, liberar: atuais.filter((l) => l.id !== mesma?.id).map((l) => l.id) };
}

function liberarReservas(ids, motivo) {
  const st = db.prepare("UPDATE cc_lancamento SET situacao = 'liberado', observacao = COALESCE(observacao || ' · ', '') || ?, atualizado_em = ? WHERE id = ? AND situacao = 'reservado'");
  for (const id of ids) st.run(motivo, agoraISO(), id);
}

function inserir(l) {
  const agora = agoraISO();
  const r = db.prepare(
    `INSERT INTO cc_lancamento (id_conta, data, natureza, origem, situacao, valor, valor_utilizado, descricao, documento, emitido_em, vencimento, validade,
       liquidado_em, forma_liquidacao, comprovacao, id_campanha, id_origem, regra, excecao, justificativa, autorizado_por, observacao, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    l.id_conta, l.data, l.natureza, l.origem, l.situacao, R(l.valor), l.valor_utilizado ?? null, l.descricao, l.documento ?? null, l.emitido_em ?? null,
    l.vencimento ?? null, l.validade ?? null, l.liquidado_em ?? null, l.forma_liquidacao ?? null, l.comprovacao ?? null, l.id_campanha ?? null,
    l.id_origem ?? null, l.regra ?? null, l.excecao ? 1 : 0, l.justificativa ?? null, l.autorizado_por ?? null, l.observacao ?? null,
    l.criado_em || agora, l.criado_em || agora,
  );
  return Number(r.lastInsertRowid);
}

/** Estorna débitos realizados de uma campanha (reabertura): lançamento inverso, nada é apagado. */
function estornarDebitosDaCampanha(idCampanha, motivo) {
  const debitos = db.prepare(
    `SELECT * FROM cc_lancamento d WHERE d.id_campanha = ? AND d.natureza = 'debito' AND d.origem = 'campanha' AND d.situacao = 'realizado'
       AND NOT EXISTS (SELECT 1 FROM cc_lancamento e WHERE e.id_origem = d.id AND e.origem = 'estorno' AND e.situacao = 'realizado')`,
  ).all(Number(idCampanha));
  for (const d of debitos) {
    inserir({
      id_conta: d.id_conta, data: hojeISO(), natureza: 'credito', origem: 'estorno', situacao: 'realizado', valor: d.valor, liquidado_em: hojeISO(),
      descricao: `Estorno: ${d.descricao}`, id_campanha: d.id_campanha, id_origem: d.id, observacao: motivo,
    });
  }
  return debitos.length;
}

function nomeCampanha(id, def) {
  return def?.nome || db.prepare('SELECT nome FROM campanha WHERE id = ?').get(Number(id))?.nome || `Campanha ${id}`;
}

/** Depois de gravar a campanha: aplica o plano (reserva, ajuste, liberação ou encerramento). */
export function aplicarVerba(idCampanha, def, plano) {
  if (!plano) return null;
  if (plano.acao === 'encerrar') return aoEncerrarCampanha(idCampanha, def, null, null);
  return tx(() => {
    if (plano.acao === 'liberar') {
      liberarReservas(reservasAtivas(idCampanha).map((l) => l.id), plano.motivo);
      return { acao: 'liberar' };
    }
    if (plano.reabrir) estornarDebitosDaCampanha(idCampanha, 'Campanha reaberta');
    if (plano.liberar?.length) liberarReservas(plano.liberar, 'Fornecedor ou regra da campanha mudou');
    const conta = garantirConta(plano.fabricante);
    const nome = nomeCampanha(idCampanha, def);
    const nec = plano.necessidade;
    if (plano.mesma) {
      if (nec.valor <= 0) liberarReservas([plano.mesma], 'Campanha sem prêmio a reservar');
      else {
        db.prepare(
          `UPDATE cc_lancamento SET valor = ?, regra = ?, descricao = ?, observacao = ?, excecao = MAX(excecao, ?), justificativa = COALESCE(?, justificativa),
             autorizado_por = COALESCE(?, autorizado_por), atualizado_em = ? WHERE id = ?`,
        ).run(R(nec.valor), plano.regra, `Reserva: ${nome}`, nec.texto, plano.excecao ? 1 : 0, plano.excecao?.justificativa ?? null, plano.excecao?.autorizado_por ?? null, agoraISO(), plano.mesma);
      }
    } else if (nec.valor > 0) {
      inserir({
        id_conta: conta.id, data: hojeISO(), natureza: 'debito', origem: 'campanha', situacao: 'reservado', valor: nec.valor,
        descricao: `Reserva: ${nome}`, id_campanha: Number(idCampanha), regra: plano.regra, observacao: nec.texto,
        excecao: Boolean(plano.excecao), justificativa: plano.excecao?.justificativa, autorizado_por: plano.excecao?.autorizado_por,
      });
    }
    return { acao: 'reservar', conta: conta.nome, valor: nec.valor, texto: nec.texto, aviso: nec.aviso, excecao: Boolean(plano.excecao) };
  });
}

/**
 * Encerramento: debita o prêmio apurado (comprovação pendente), consome a reserva e devolve a sobra.
 * Encerrar de novo refaz o débito (estorna o anterior).
 */
export function aoEncerrarCampanha(idCampanha, def, resultado, idFotografia) {
  const c = def?.criterios && def?.premiacao ? def : normalizarCampanha(def || {});
  const r = resultado || apurarComCache(c);
  const premio = R(r.resumo?.premio_total || 0);
  return tx(() => {
    estornarDebitosDaCampanha(idCampanha, 'Novo fechamento da campanha');
    const reservas = reservasAtivas(idCampanha);
    const conta = reservas.length ? contaPorId(reservas[0].id_conta) : garantirConta(fabricanteDaCampanha(c).fabricante);
    const nome = nomeCampanha(idCampanha, c);
    const data = r.tempo?.fim && r.tempo.fim < hojeISO() ? r.tempo.fim : hojeISO();
    const reservado = R(reservas.reduce((a, l) => a + l.valor, 0));
    let idDebito = null;
    if (premio > 0) {
      idDebito = inserir({
        id_conta: conta.id, data, natureza: 'debito', origem: 'campanha', situacao: 'realizado', valor: premio, liquidado_em: data,
        descricao: `Premiação: ${nome}`, documento: idFotografia ? `Apuração de fechamento nº ${idFotografia}` : 'Apuração de fechamento',
        comprovacao: 'pendente', id_campanha: Number(idCampanha), id_origem: reservas[0]?.id ?? null,
        observacao: reservado && premio > reservado ? `O prêmio passou da reserva em ${moeda(premio - reservado)}.` : null,
      });
    }
    let restante = premio;
    for (const res of reservas) {
      const usado = R(Math.min(res.valor, restante));
      restante = R(restante - usado);
      db.prepare("UPDATE cc_lancamento SET situacao = 'consumido', valor_utilizado = ?, atualizado_em = ? WHERE id = ?").run(usado, agoraISO(), res.id);
      const sobra = R(res.valor - usado);
      if (sobra > 0.005) {
        inserir({
          id_conta: res.id_conta, data, natureza: 'credito', origem: 'estorno', situacao: 'liberado', valor: sobra,
          descricao: `Sobra da reserva devolvida ao disponível: ${nome}`, id_campanha: Number(idCampanha), id_origem: res.id,
        });
      }
    }
    return { acao: 'encerrar', conta: conta.nome, premio, reservado, sobra: R(Math.max(0, reservado - premio)), id_debito: idDebito };
  });
}

export function aoExcluirCampanha(idCampanha) {
  const ids = reservasAtivas(idCampanha).map((l) => l.id);
  if (ids.length) liberarReservas(ids, 'Campanha excluída');
}

/** Situação da verba de uma campanha (para a tela da campanha e o construtor). */
export function verbaDaCampanha(idCampanha) {
  const camp = db.prepare('SELECT * FROM campanha WHERE id = ?').get(Number(idCampanha));
  if (!camp) throw erro('Campanha não encontrada.', 404);
  const def = JSON.parse(camp.definicao);
  const { fabricante, como } = fabricanteDaCampanha(def);
  const lancs = db.prepare('SELECT * FROM cc_lancamento WHERE id_campanha = ? ORDER BY id').all(camp.id).map((l) => ({ ...l }));
  const reservado = R(lancs.filter((l) => l.situacao === 'reservado').reduce((a, l) => a + l.valor, 0));
  let premioProj = null;
  if (camp.status === 'ativa') {
    try {
      premioProj = apurarComCache(def).resumo.premio_proj_total;
    } catch {
      premioProj = null;
    }
  }
  return {
    id_campanha: camp.id,
    status: camp.status,
    fabricante,
    como,
    conta: coberturaDe(fabricante, 0),
    reservado,
    premio_projetado: premioProj,
    reserva_curta: premioProj != null && reservado > 0 && premioProj > reservado + 0.005,
    lancamentos: lancs.map(formatarLancamento),
  };
}

// ------------------------------------------------------------------ lançamentos manuais
function formatarLancamento(l) {
  return {
    ...l,
    excecao: Boolean(l.excecao),
    rotulo_origem: ORIGENS[l.origem]?.rotulo || l.origem,
    sinal: l.natureza === 'credito' ? 1 : -1,
    conta_no_saldo: ['realizado'].includes(l.situacao),
  };
}

function lerLancamento(b, conta) {
  const origem = String(b.origem || '');
  if (!ORIGENS[origem] || origem === 'estorno') throw erro('Escolha a origem do lançamento.');
  const natureza = ORIGENS[origem].natureza || (b.natureza === 'debito' ? 'debito' : b.natureza === 'credito' ? 'credito' : null);
  if (!natureza) throw erro('Ajuste precisa dizer se é crédito ou débito.');
  const valor = R(b.valor);
  if (!(valor > 0)) throw erro('Informe um valor maior que zero.');
  const data = ehData(b.data) ? b.data : hojeISO();
  const permitidas = natureza === 'credito' ? ['previsto', 'a_receber', 'realizado'] : ['previsto', 'realizado'];
  const situacao = permitidas.includes(b.situacao) ? b.situacao : natureza === 'credito' ? 'previsto' : 'realizado';
  const descricao = String(b.descricao || '').trim() || `${ORIGENS[origem].rotulo}`;
  const validade = natureza === 'credito'
    ? ehData(b.validade) ? b.validade : ultimoDiaDoMes(addMeses(data, conta.validade_meses || 12))
    : null;
  const emitido = situacao === 'a_receber' || (situacao === 'realizado' && b.documento) ? (ehData(b.emitido_em) ? b.emitido_em : data) : null;
  return {
    id_conta: conta.id, data, natureza, origem, situacao, valor, descricao,
    documento: String(b.documento || '').trim() || null,
    emitido_em: emitido,
    vencimento: situacao === 'a_receber' ? (ehData(b.vencimento) ? b.vencimento : addDias(emitido || data, conta.prazo_nd_dias || 30)) : null,
    validade,
    liquidado_em: situacao === 'realizado' ? (ehData(b.liquidado_em) ? b.liquidado_em : data) : null,
    forma_liquidacao: situacao === 'realizado' && natureza === 'credito' ? (['abatimento_duplicata', 'deposito', 'mercadoria'].includes(b.forma_liquidacao) ? b.forma_liquidacao : origem === 'bonificacao' ? 'mercadoria' : 'abatimento_duplicata') : null,
    comprovacao: natureza === 'debito' && ['campanha', 'acao_trade'].includes(origem) ? (['pendente', 'enviada', 'aprovada'].includes(b.comprovacao) ? b.comprovacao : 'pendente') : null,
    id_campanha: Number.isFinite(Number(b.id_campanha)) && b.id_campanha ? Number(b.id_campanha) : null,
    observacao: String(b.observacao || '').trim() || null,
  };
}

function addMeses(iso, n) {
  const [a, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
function ultimoDiaDoMes(iso) {
  const [a, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export function criarLancamento(idConta, b = {}) {
  const conta = contaPorId(idConta);
  const l = lerLancamento(b, conta);
  // débito novo também precisa de saldo (mesma regra das campanhas)
  if (l.natureza === 'debito') {
    const cob = coberturaDe(conta.fabricante, l.valor);
    const exc = validarExcecao(b.excecao);
    if (!cob.cobre && !exc) {
      throw erro(mensagemBloqueio(cob, l.valor).replace('a campanha precisa reservar', 'o lançamento precisa de'), 409, { codigo: 'saldo_insuficiente', conta_corrente: cob });
    }
    if (!cob.cobre && exc) Object.assign(l, { excecao: true, ...exc });
  }
  return inserir(l);
}

/** Muda a situação de um lançamento seguindo o ciclo real: provisão → ND emitida → liquidada. */
export function atualizarLancamento(id, b = {}) {
  const l = db.prepare('SELECT * FROM cc_lancamento WHERE id = ?').get(Number(id));
  if (!l) throw erro('Lançamento não encontrado.', 404);
  const conta = contaPorId(l.id_conta);
  const agora = agoraISO();
  const acao = String(b.acao || 'editar');
  if (acao === 'emitir_nd') {
    if (l.natureza !== 'credito' || l.situacao !== 'previsto') throw erro('Só provisões (crédito previsto) viram ND emitida.');
    const emitido = ehData(b.emitido_em) ? b.emitido_em : hojeISO();
    const doc = String(b.documento || '').trim() || proximaND(emitido);
    db.prepare("UPDATE cc_lancamento SET situacao = 'a_receber', documento = ?, emitido_em = ?, vencimento = ?, atualizado_em = ? WHERE id = ?")
      .run(doc, emitido, ehData(b.vencimento) ? b.vencimento : addDias(emitido, conta.prazo_nd_dias || 30), agora, l.id);
  } else if (acao === 'liquidar') {
    if (l.natureza !== 'credito' || !['previsto', 'a_receber'].includes(l.situacao)) throw erro('Só créditos previstos ou a receber podem ser liquidados.');
    const forma = ['abatimento_duplicata', 'deposito', 'mercadoria'].includes(b.forma_liquidacao) ? b.forma_liquidacao : 'abatimento_duplicata';
    db.prepare("UPDATE cc_lancamento SET situacao = 'realizado', liquidado_em = ?, forma_liquidacao = ?, emitido_em = COALESCE(emitido_em, ?), atualizado_em = ? WHERE id = ?")
      .run(ehData(b.liquidado_em) ? b.liquidado_em : hojeISO(), forma, ehData(b.liquidado_em) ? b.liquidado_em : hojeISO(), agora, l.id);
  } else if (acao === 'cancelar') {
    if (l.situacao === 'reservado') liberarReservas([l.id], String(b.motivo || 'Reserva liberada manualmente'));
    else if (['previsto', 'a_receber'].includes(l.situacao)) {
      db.prepare("UPDATE cc_lancamento SET situacao = 'cancelado', observacao = COALESCE(observacao || ' · ', '') || ?, atualizado_em = ? WHERE id = ?")
        .run(String(b.motivo || 'Cancelado'), agora, l.id);
    } else throw erro('Lançamento realizado não se cancela: use o estorno.');
  } else if (acao === 'comprovacao') {
    if (!['pendente', 'enviada', 'aprovada'].includes(b.comprovacao)) throw erro('Situação de comprovação inválida.');
    db.prepare('UPDATE cc_lancamento SET comprovacao = ?, atualizado_em = ? WHERE id = ?').run(b.comprovacao, agora, l.id);
  } else {
    db.prepare('UPDATE cc_lancamento SET descricao = ?, documento = ?, validade = ?, vencimento = ?, observacao = ?, atualizado_em = ? WHERE id = ?').run(
      String(b.descricao ?? l.descricao).trim() || l.descricao, b.documento !== undefined ? String(b.documento || '').trim() || null : l.documento,
      b.validade !== undefined ? (ehData(b.validade) ? b.validade : null) : l.validade, b.vencimento !== undefined ? (ehData(b.vencimento) ? b.vencimento : null) : l.vencimento,
      b.observacao !== undefined ? String(b.observacao || '').trim() || null : l.observacao, agora, l.id,
    );
  }
  return formatarLancamento(db.prepare('SELECT * FROM cc_lancamento WHERE id = ?').get(l.id));
}

export function estornarLancamento(id, motivo) {
  const l = db.prepare('SELECT * FROM cc_lancamento WHERE id = ?').get(Number(id));
  if (!l) throw erro('Lançamento não encontrado.', 404);
  if (l.situacao !== 'realizado') throw erro('Só lançamentos realizados são estornados. Provisões e NDs em aberto se cancelam.');
  if (l.origem === 'estorno') throw erro('Este lançamento já é um estorno.');
  if (db.prepare("SELECT 1 FROM cc_lancamento WHERE id_origem = ? AND origem = 'estorno' AND situacao = 'realizado'").get(l.id)) throw erro('Este lançamento já foi estornado.');
  return inserir({
    id_conta: l.id_conta, data: hojeISO(), natureza: l.natureza === 'credito' ? 'debito' : 'credito', origem: 'estorno', situacao: 'realizado', valor: l.valor,
    liquidado_em: hojeISO(), descricao: `Estorno: ${l.descricao}`, id_campanha: l.id_campanha, id_origem: l.id, observacao: String(motivo || '').trim() || null,
  });
}

function proximaND(data) {
  const ano = data.slice(0, 4);
  const ult = db.prepare("SELECT documento FROM cc_lancamento WHERE documento LIKE ? ORDER BY documento DESC LIMIT 1").get(`ND %/${ano}`);
  const n = ult ? Number(ult.documento.slice(3, 9)) + 1 : 1;
  return `ND ${String(n).padStart(6, '0')}/${ano}`;
}

export function baixarVencidas(idConta) {
  const conta = contaPorId(idConta);
  const s = saldosDaConta(conta);
  if (!(s.vencido > 0)) throw erro('Não há verba vencida para baixar nesta conta.');
  return inserir({
    id_conta: conta.id, data: hojeISO(), natureza: 'debito', origem: 'expiracao', situacao: 'realizado', valor: s.vencido, liquidado_em: hojeISO(),
    descricao: 'Baixa de verba vencida sem uso',
  });
}

// ------------------------------------------------------------------ leitura (telas)
/** Evolução mensal: saldo realizado e saldo confirmado (realizado + NDs a receber) no fim de cada mês. */
function serieDaConta(lancs, hoje, meses = 13) {
  const pontos = [];
  const [a, m] = hoje.split('-').map(Number);
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i + 1, 0)).toISOString().slice(0, 10);
    pontos.push(d > hoje ? hoje : d);
  }
  return pontos.map((fim) => {
    let realizado = 0;
    let aReceber = 0;
    for (const l of lancs) {
      if (l.situacao === 'cancelado' || l.situacao === 'liberado' || l.situacao === 'reservado' || l.situacao === 'consumido') continue;
      if (l.natureza === 'credito') {
        if (l.liquidado_em && l.liquidado_em <= fim) realizado += l.valor;
        else if (l.emitido_em && l.emitido_em <= fim && l.situacao !== 'previsto') aReceber += l.valor;
      } else if (l.situacao === 'realizado' && (l.liquidado_em || l.data) <= fim) realizado -= l.valor;
    }
    return { data: fim, realizado: R(realizado), confirmado: R(realizado + aReceber) };
  });
}

function alertasDaConta(conta, s, lancs, hoje, extras = {}) {
  const a = [];
  const nome = conta.nome;
  const sit = situacaoConta(conta, s);
  if (sit === 'estourada') a.push({ tipo: 'critico', codigo: 'negativa', texto: `${nome}: conta negativa em ${moeda(-s.capacidade)} além do limite. Novas campanhas ficam bloqueadas.` });
  else if (sit === 'no_limite') a.push({ tipo: 'aviso', codigo: 'limite', texto: `${nome}: usando ${moeda(-s.disponivel)} do limite de ${moeda(s.limite)}.` });
  if (s.saldo_baixo && !conta.bloqueada) a.push({ tipo: 'aviso', codigo: 'saldo_baixo', texto: `${nome}: só ${moeda(s.disponivel)} disponíveis, menos de uma semana de verba. Campanha nova deste fornecedor pode não caber.` });
  if (conta.bloqueada) a.push({ tipo: 'critico', codigo: 'bloqueada', texto: `${nome}: conta bloqueada${conta.motivo_bloqueio ? ` (${conta.motivo_bloqueio})` : ''}.` });
  for (const l of lancs) {
    if (l.natureza === 'credito' && l.situacao === 'a_receber' && l.vencimento && l.vencimento < hoje) {
      const dias = Math.round((Date.parse(hoje) - Date.parse(l.vencimento)) / 86400000);
      a.push({ tipo: 'aviso', codigo: 'nd_atrasada', id_lancamento: l.id, texto: `${nome}: ${l.documento || 'ND'} de ${moeda(l.valor)} venceu há ${dias} ${dias === 1 ? 'dia' : 'dias'} e não foi abatida.` });
    }
    if (l.natureza === 'credito' && l.situacao === 'previsto' && l.data < addDias(hoje, -45)) {
      a.push({ tipo: 'aviso', codigo: 'provisao_parada', id_lancamento: l.id, texto: `${nome}: provisão de ${moeda(l.valor)} (${l.descricao}) está há mais de 45 dias sem ND emitida.` });
    }
    if (l.natureza === 'debito' && l.situacao === 'realizado' && l.comprovacao === 'pendente' && l.data <= addDias(hoje, -3)) {
      a.push({ tipo: 'info', codigo: 'comprovacao', id_lancamento: l.id, texto: conta.fabricante === PROPRIA ? `${nome}: falta registrar o pagamento de "${l.descricao}" (${moeda(l.valor)}).` : `${nome}: comprovação pendente de "${l.descricao}" (${moeda(l.valor)}). Sem ela a indústria pode glosar o valor.` });
    }
  }
  if (s.vencendo > 0) a.push({ tipo: 'aviso', codigo: 'vencendo', texto: `${nome}: ${moeda(s.vencendo)} de verba vencem até ${fmtDataBR(s.proximo_vencimento)} e ainda não têm uso.` });
  if (s.vencido > 0) a.push({ tipo: 'aviso', codigo: 'vencida', texto: `${nome}: ${moeda(s.vencido)} de verba venceram sem uso. Faça a baixa para o saldo ficar fiel.` });
  for (const r of extras.reservasCurtas || []) {
    a.push({ tipo: 'aviso', codigo: 'reserva_curta', id_campanha: r.id_campanha, texto: `${nome}: o prêmio projetado de "${r.nome}" (${moeda(r.projetado)}) já passa da reserva (${moeda(r.reservado)}).` });
  }
  return a;
}

/** Reservas ativas por campanha (com nome, situação e prêmio projetado). */
function reservasDaConta(conta, lancs, { comProjecao = true } = {}) {
  const res = lancs.filter((l) => l.situacao === 'reservado');
  return res.map((l) => {
    const camp = l.id_campanha ? db.prepare('SELECT id, nome, status, inicio, fim, definicao FROM campanha WHERE id = ?').get(l.id_campanha) : null;
    let projetado = null;
    if (camp && comProjecao) {
      try {
        projetado = apurarComCache(JSON.parse(camp.definicao)).resumo.premio_proj_total;
      } catch {
        projetado = null;
      }
    }
    return {
      id_lancamento: l.id, id_campanha: l.id_campanha, nome: camp?.nome || l.descricao.replace(/^Reserva: /, ''), status: camp?.status || null,
      inicio: camp?.inicio || null, fim: camp?.fim || null, reservado: l.valor, projetado: projetado == null ? null : R(projetado),
      base: l.observacao, excecao: Boolean(l.excecao), justificativa: l.justificativa, autorizado_por: l.autorizado_por, data: l.data,
    };
  });
}

function resumoConta(conta, { comProjecao = true } = {}) {
  const hoje = hojeISO();
  const lancs = lancamentosDaConta(conta.id);
  const s = calcularSaldos(conta, lancs, hoje);
  const reservas = reservasDaConta(conta, lancs, { comProjecao });
  const reservasCurtas = reservas.filter((r) => r.projetado != null && r.projetado > r.reservado + 0.005).map((r) => ({ ...r }));
  const situacao = situacaoConta(conta, s);
  return {
    conta: { ...conta, bloqueada: Boolean(conta.bloqueada), propria: conta.fabricante === PROPRIA },
    saldos: s,
    situacao,
    rotulo_situacao: SITUACAO_CONTA[situacao],
    reservas,
    alertas: alertasDaConta(conta, s, lancs, hoje, { reservasCurtas }),
    serie: serieDaConta(lancs, hoje),
    n_lancamentos: lancs.length,
    lancs,
  };
}

const ORDEM_SIT = { bloqueada: 0, estourada: 1, no_limite: 2, atencao: 3, ok: 4 };

export function visaoGeral() {
  const contas = db.prepare('SELECT * FROM cc_conta ORDER BY nome').all().map((c) => ({ ...c }));
  const itens = contas.map((c) => resumoConta(c));
  const tot = (k) => R(itens.reduce((a, i) => a + i.saldos[k], 0));
  const alertas = itens.flatMap((i) => i.alertas.map((a) => ({ ...a, id_conta: i.conta.id, conta: i.conta.nome })));
  const peso = { critico: 0, aviso: 1, info: 2 };
  alertas.sort((a, b) => peso[a.tipo] - peso[b.tipo]);
  return {
    hoje: hojeISO(),
    totais: {
      contas: itens.length,
      disponivel: tot('disponivel'),
      reservado: tot('reservado'),
      a_receber: tot('a_receber'),
      previsto: tot('previsto'),
      realizado: tot('realizado'),
      vencendo: tot('vencendo'),
      nd_atrasada: tot('nd_atrasada'),
      bloqueadas: itens.filter((i) => ['bloqueada', 'estourada'].includes(i.situacao)).length,
      campanhas_reservadas: itens.reduce((a, i) => a + i.reservas.length, 0),
    },
    contas: itens
      .map(({ lancs, alertas: al, ...i }) => ({ ...i, n_alertas: al.length, serie: i.serie.map((p) => p.confirmado) }))
      .sort((a, b) => ORDEM_SIT[a.situacao] - ORDEM_SIT[b.situacao] || b.saldos.reservado - a.saldos.reservado || a.conta.nome.localeCompare(b.conta.nome, 'pt-BR')),
    alertas,
  };
}

export function detalheConta(id) {
  const conta = contaPorId(id);
  const { lancs, ...r } = resumoConta(conta);
  const porOrigem = {};
  const desde = addDias(hojeISO(), -365);
  for (const l of lancs) {
    if (l.situacao !== 'realizado' || l.data < desde) continue;
    const k = l.origem;
    porOrigem[k] = porOrigem[k] || { origem: k, rotulo: ORIGENS[k]?.rotulo || k, creditos: 0, debitos: 0 };
    porOrigem[k][l.natureza === 'credito' ? 'creditos' : 'debitos'] += l.valor;
  }
  return {
    ...r,
    composicao_12m: Object.values(porOrigem).map((o) => ({ ...o, creditos: R(o.creditos), debitos: R(o.debitos) })).sort((a, b) => b.creditos + b.debitos - (a.creditos + a.debitos)),
    campanhas_encerradas: lancs
      .filter((l) => l.natureza === 'debito' && l.origem === 'campanha' && l.situacao === 'realizado')
      .slice(-8)
      .reverse()
      .map(formatarLancamento),
  };
}

/** Extrato com saldo acumulado (realizado) e filtros. */
export function extrato(id, q = {}) {
  const conta = contaPorId(id);
  const lancs = lancamentosDaConta(conta.id);
  let saldo = 0;
  const comSaldo = lancs.map((l) => {
    if (l.situacao === 'realizado') saldo += l.natureza === 'credito' ? l.valor : -l.valor;
    return { ...formatarLancamento(l), saldo_realizado: R(saldo) };
  });
  const filtra = (l) =>
    (!ehData(q.de) || l.data >= q.de) &&
    (!ehData(q.ate) || l.data <= q.ate) &&
    (!q.natureza || l.natureza === q.natureza) &&
    (!q.origem || String(q.origem).split(',').includes(l.origem)) &&
    (!q.situacao || String(q.situacao).split(',').includes(l.situacao)) &&
    (!q.busca || norm(`${l.descricao} ${l.documento || ''}`).includes(norm(q.busca)));
  const linhas = comSaldo.filter(filtra).reverse();
  const limite = Math.min(2000, Number(q.limite) || 500);
  return { conta: { id: conta.id, nome: conta.nome, fabricante: conta.fabricante }, total: linhas.length, linhas: linhas.slice(0, limite) };
}

export function listarFabricantes() {
  const contas = new Map(db.prepare('SELECT id, fabricante FROM cc_conta').all().map((c) => [c.fabricante, c.id]));
  return [
    { fabricante: PROPRIA, nome: NOME_PROPRIA, id_conta: contas.get(PROPRIA) ?? null },
    ...fabricantesDaBase().map((f) => ({ fabricante: f, nome: f, id_conta: contas.get(f) ?? null })),
  ];
}

export function salvarConta(id, b = {}) {
  const atual = id ? contaPorId(id) : null;
  if (!atual) {
    const fab = String(b.fabricante || '').trim();
    if (!fab) throw erro('Escolha o fabricante da conta.');
    if (fab !== PROPRIA && !fabricantesDaBase().includes(fab)) throw erro('Fabricante não encontrado na base de produtos.');
    if (contaPorFabricante(fab)) throw erro('Este fabricante já tem conta corrente.');
    garantirConta(fab, {});
  }
  const c = atual || contaPorFabricante(String(b.fabricante).trim());
  const num = (v, pad) => (v === undefined ? pad : v === null || v === '' ? null : Number(v));
  db.prepare(
    `UPDATE cc_conta SET politica = ?, limite = ?, perc_acordo = ?, validade_meses = ?, prazo_nd_dias = ?, margem_reserva = ?, bloqueada = ?, motivo_bloqueio = ?,
       responsavel = ?, contato = ?, observacao = ?, atualizado_em = ? WHERE id = ?`,
  ).run(
    POLITICAS.includes(b.politica) ? b.politica : c.politica,
    Math.max(0, R(num(b.limite, c.limite) ?? 0)),
    num(b.perc_acordo, c.perc_acordo),
    Math.max(1, Math.round(num(b.validade_meses, c.validade_meses) ?? 12)),
    Math.max(0, Math.round(num(b.prazo_nd_dias, c.prazo_nd_dias) ?? 30)),
    Math.max(0, num(b.margem_reserva, c.margem_reserva) ?? 20),
    b.bloqueada === undefined ? c.bloqueada : b.bloqueada ? 1 : 0,
    b.motivo_bloqueio === undefined ? c.motivo_bloqueio : String(b.motivo_bloqueio || '').trim() || null,
    b.responsavel === undefined ? c.responsavel : String(b.responsavel || '').trim() || null,
    b.contato === undefined ? c.contato : String(b.contato || '').trim() || null,
    b.observacao === undefined ? c.observacao : String(b.observacao || '').trim() || null,
    agoraISO(), c.id,
  );
  return contaPorId(c.id);
}

/** Simulação para o construtor: de onde sai a verba, quanto reserva e se cabe. */
export function simularCampanha(def, idCampanha = null) {
  const c = normalizarCampanha(def || {});
  const { fabricante, como } = fabricanteDaCampanha(c);
  const conta = contaPorFabricante(fabricante);
  const nec = necessidadeDaCampanha(c, conta);
  const atual = idCampanha ? reservasAtivas(idCampanha).filter((l) => conta && l.id_conta === conta.id).reduce((a, l) => a + l.valor, 0) : 0;
  const delta = R(Math.max(0, nec.valor - atual));
  return { fabricante, como, necessidade: nec, ja_reservado: R(atual), delta, cobertura: coberturaDe(fabricante, delta) };
}

export { moeda as formatarMoeda, inserir as inserirLancamentoBruto, addMeses, ultimoDiaDoMes };
