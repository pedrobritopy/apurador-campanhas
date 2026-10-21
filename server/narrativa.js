// Narrador: transforma a apuração em INFORMAÇÃO (frases prontas, ranqueadas por relevância),
// em vez de devolver números crus. Usado por boletins, mensagens, painel e IA.
import { db } from './db.js';
import { oportunidadesDaCampanha, oportunidadesDoParticipante, estoqueDaCampanha, STATUS_PARTICIPANTE } from './motor.js';

// ------------------------------------------------------------------ formatação (pt-BR)
const nf = (casas) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const NF0 = nf(0);
const NF1 = nf(1);
const NF2 = nf(2);

export function fmt(v, formato = 'numero') {
  if (v == null || !Number.isFinite(v)) return '-';
  switch (formato) {
    case 'moeda':
      return `R$ ${Math.abs(v) >= 1000 ? NF0.format(v) : NF2.format(v)}`;
    case 'perc':
      return `${Math.abs(v) < 10 ? NF1.format(v) : NF0.format(v)}%`;
    case 'decimal':
      return NF2.format(v);
    default:
      return Math.abs(v) < 10 && v % 1 !== 0 ? NF1.format(v) : NF0.format(v);
  }
}
export const fmtMoeda = (v) => fmt(v, 'moeda');
export const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '-' : `${NF0.format(v)}%`);
const comUnidade = (v, formato, unidade) => {
  const s = fmt(v, formato);
  return unidade && formato === 'numero' && s !== '-' ? `${s} ${unidade}` : s;
};
export const fmtDataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-');
const primeiroNome = (nome = '') => String(nome).replace(/^Equipe\s+/i, '').replace(/\s*\(#\d+\)$/, '').split(/\s+/)[0];
const plural = (n, um, varios) => `${NF0.format(n)} ${n === 1 ? um : varios}`;

// ------------------------------------------------------------------ ritmo por participante (da série interna)
function ritmos(resultado, idxCrit, chave) {
  const { ctx, internos } = resultado._interno;
  const t = ctx.tempo;
  const it = internos[idxCrit];
  if (!it || t.idxRef < 0 || t.decorridos < 3 || it.cr.totalizar !== 'soma') return null;
  const s = it.series.get(chave);
  if (!s) return null;
  const valorEm = (i) => {
    if (i < 0) return 0;
    const o = {};
    for (const v of it.vars) o[v] = s[v] ? s[v][i] : 0;
    return it.fn.avaliar(o) ?? 0;
  };
  const atual = valorEm(t.idxRef);
  const media = atual / t.decorridos;
  const recente = (atual - valorEm(t.iniRecente - 1)) / (t.nRecente || 1);
  return { media, recente, variacao: media > 0 ? (recente / media - 1) * 100 : null };
}

// ------------------------------------------------------------------ oportunidades/estoque com cache por resultado
const cacheOps = new WeakMap();
/** Oportunidades de um participante: usa o lote (se já calculado) ou calcula só para ele. */
const cacheUm = new WeakMap();
function oportunidadesDeUm(resultado, chave) {
  const lote = cacheOps.get(resultado);
  if (lote) return lote.get(chave) || [];
  let porUm = cacheUm.get(resultado);
  if (!porUm) cacheUm.set(resultado, (porUm = new Map()));
  if (!porUm.has(chave)) {
    try {
      porUm.set(chave, oportunidadesDoParticipante(resultado, chave, resultado.campanha.premiacao.criterio_base, 5));
    } catch (e) {
      console.error('[narrativa] oportunidades:', e.message);
      porUm.set(chave, []);
    }
  }
  return porUm.get(chave);
}

function oportunidadesPorChave(resultado) {
  if (cacheOps.has(resultado)) return cacheOps.get(resultado);
  const mapa = new Map();
  try {
    const idCrit = resultado.campanha.premiacao.criterio_base;
    for (const o of oportunidadesDaCampanha(resultado, idCrit, 5)) mapa.set(o.chave, o.oportunidades);
  } catch (e) {
    console.error('[narrativa] oportunidades:', e.message);
  }
  cacheOps.set(resultado, mapa);
  return mapa;
}
const cacheEstoque = new WeakMap();
function estoqueEmRisco(resultado) {
  if (cacheEstoque.has(resultado)) return cacheEstoque.get(resultado);
  let lista = [];
  try {
    lista = estoqueDaCampanha(resultado).filter((e) => e.risco !== 'ok').slice(0, 3);
  } catch (e) {
    console.error('[narrativa] estoque:', e.message);
  }
  cacheEstoque.set(resultado, lista);
  return lista;
}

// ------------------------------------------------------------------ boletim de um participante
/**
 * @param {object} resultado apuração (com _interno)
 * @param {object} linha LinhaParticipante
 * @param {{ idCampanha?: number, movimentos?: Map<string, number>, comOportunidades?: boolean }} op
 */
export function boletimParticipante(resultado, linha, op = {}) {
  const { campanha: c, tempo: t, criterios, participantes } = resultado;
  const tipoDia = t.calendario === 'corridos' ? 'corridos' : 'úteis';
  const destaques = [];
  const add = (tipo, texto, peso = 0) => destaques.push({ tipo, texto, peso });
  const movimento = op.movimentos?.get(linha.chave) ?? linha.movimento ?? null;

  // critérios em texto pronto
  const crits = criterios.map((cd, i) => {
    const x = linha.criterios[i];
    const u = cd.unidade;
    let texto;
    if (x.meta != null) {
      texto = `${comUnidade(x.realizado, cd.formato, u)} de ${comUnidade(x.meta, cd.formato, u)} (${fmtPct(x.atingimento)})`;
      if (x.falta > 0 && cd.sentido === 'maior') {
        texto += `. Faltam ${comUnidade(x.falta, cd.formato, u)}`;
        if (x.ritmo_necessario) texto += ` (${fmt(x.ritmo_necessario, cd.formato === 'numero' ? 'decimal' : cd.formato).replace(/,00$/, '')}/dia)`;
      } else if (cd.sentido === 'menor') texto += ` (meta: no máximo ${fmt(x.meta, cd.formato)})`;
      else if (x.atingimento >= 100) texto += ' ✔';
    } else {
      texto = `${comUnidade(x.realizado, cd.formato, u)}${x.projecao != null && t.status === 'andamento' ? ` · projeção ${comUnidade(x.projecao, cd.formato, u)}` : ''}`;
    }
    return {
      nome: cd.nome,
      unidade: u,
      formato: cd.formato,
      realizado: x.realizado,
      meta: x.meta,
      atingimento: x.atingimento,
      projecao: x.projecao,
      atingimento_proj: x.atingimento_proj,
      falta: x.falta,
      ritmo_necessario: x.ritmo_necessario,
      texto,
    };
  });

  // comparativo
  const comScore = participantes.filter((p) => p.score != null);
  const media = comScore.length ? comScore.reduce((a, p) => a + p.score, 0) / comScore.length : null;
  const lider = participantes[0];
  const doGrupo = linha.id_grupo ? participantes.filter((p) => p.id_grupo === linha.id_grupo && p.score != null) : [];
  const mediaGrupo = doGrupo.length > 1 ? doGrupo.reduce((a, p) => a + p.score, 0) / doGrupo.length : null;
  const percentil = participantes.length > 1 ? Math.round((1 - (linha.posicao - 1) / (participantes.length - 1)) * 100) : 100;

  // ---------- frases (informação) ----------
  const principal = crits[Math.max(0, c.criterios.findIndex((x) => x.id === c.premiacao.criterio_base))];
  const idxPrincipal = Math.max(0, c.criterios.findIndex((x) => x.id === c.premiacao.criterio_base));

  if (t.status === 'futura') {
    add('info', `A campanha começa em ${fmtDataBR(t.inicio)} (${plural(t.dias_para_inicio ?? 0, 'dia', 'dias')}). Prepare a carteira: os clientes abaixo já compraram esses produtos antes.`, 50);
  } else if (linha.status === 'atingiu') {
    add('positivo', `Meta batida: você está em ${fmtPct(linha.score)}${linha.premio > 0 ? ` e já garantiu ${fmtMoeda(linha.premio)}` : ''}.`, 100);
  } else if (linha.status === 'no_ritmo') {
    add('positivo', `No ritmo atual você fecha em ${fmtPct(linha.score_proj)}${linha.premio_proj > 0 ? ` (prêmio projetado ${fmtMoeda(linha.premio_proj)})` : ''}. Mantenha o passo.`, 90);
  } else if (linha.status === 'nao_atingiu') {
    add('alerta', `A campanha terminou com você em ${fmtPct(linha.score)} da meta.`, 90);
  } else if (linha.score != null) {
    const r = ritmos(resultado, idxPrincipal, linha.chave);
    const x = linha.criterios[idxPrincipal];
    if (x?.ritmo_necessario && r && r.media > 0) {
      const fator = x.ritmo_necessario / r.media;
      add(
        'alerta',
        `Para bater a meta você precisa de ${fmt(x.ritmo_necessario, principal.formato === 'numero' ? 'decimal' : principal.formato).replace(/,00$/, '')}${principal.unidade ? ` ${principal.unidade}` : ''}/dia nos ${plural(t.restantes, `dia ${tipoDia.slice(0, -1)}`, `dias ${tipoDia}`)} que faltam${fator >= 1.05 ? `, ${NF1.format(fator)}× o seu ritmo atual (${fmt(r.media, 'decimal').replace(/,00$/, '')}/dia)` : ', dentro do seu ritmo atual'}.`,
        95,
      );
    } else {
      add('alerta', `No ritmo atual você fecha em ${fmtPct(linha.score_proj)} da meta. É hora de acelerar.`, 95);
    }
  }

  // regra "todos": qual critério está travando o prêmio
  if (c.apuracao.regra === 'todos' && t.status !== 'futura') {
    const travando = c.criterios.map((cd, i) => ({ cd, x: linha.criterios[i], txt: crits[i] })).filter(({ cd, x }) => cd.gatilho > 0 && x.atingimento != null && x.atingimento < cd.gatilho);
    if (travando.length) {
      add('acao', `Para liberar o prêmio, complete: ${travando.map(({ cd, txt }) => `${cd.nome} (${txt.texto.split('. Faltam')[0]})`).join('; ')}.`, 92);
    }
  }

  // prêmio por blocos: quanto já está garantido
  const un = (x) => comUnidade(x, principal.formato, principal.unidade);
  const blocosAtuais = linha.premio_partes?.find((p) => p.tipo === 'bloco');
  if (blocosAtuais && t.status !== 'futura') {
    add('positivo', `Você já fechou ${plural(blocosAtuais.blocos, 'bloco', 'blocos')} de ${un(c.premiacao.bloco.tamanho)}, que valem ${fmtMoeda(blocosAtuais.valor)}.`, 93);
  }

  // próximo degrau do prêmio (faixa, bloco, mínimo para começar a ganhar ou prêmio por meta)
  const faltaTexto = (pf) => (pf.falta_unidades != null ? `Faltam ${un(pf.falta_unidades)}` : `Faltam ${NF0.format(Math.ceil(pf.falta_pontos))} pontos`);
  const alvoMeta = (min) => (min === 100 ? 'bater a meta' : `atingir ${fmtPct(min)} da meta`);
  if (linha.proxima_faixa && t.status !== 'futura' && t.status !== 'encerrada') {
    const pf = linha.proxima_faixa;
    const ganho = pf.premio - (linha.premio || 0);
    const mais = ganho > 0 ? `: +${fmtMoeda(ganho)} no seu prêmio` : '';
    if (pf.tipo === 'bloco') {
      add('acao', `Faltam ${un(pf.falta_unidades)} para fechar mais um bloco${mais} (total de ${fmtMoeda(pf.premio)}).`, 88);
    } else if (pf.tipo === 'gatilho') {
      const bl = c.premiacao.bloco;
      const regra = `${fmtMoeda(bl.valor)} a cada ${un(bl.tamanho)}${bl.sobre === 'excedente' ? ' acima da meta' : ''}`;
      add('acao', pf.exigencia === 'quantidade'
        ? `Faltam ${un(pf.falta_unidades)} para chegar ao mínimo de ${un(pf.min)} e começar a ganhar ${regra}${pf.premio > 0 ? ` (nessa hora já entram ${fmtMoeda(pf.premio)})` : ''}.`
        : `${faltaTexto(pf)} para ${alvoMeta(pf.min)} e começar a ganhar ${regra}.`, 88);
    } else if (pf.tipo === 'bonus') {
      add('acao', `${faltaTexto(pf)} para ${alvoMeta(pf.min)} e garantir o prêmio de ${fmtMoeda(pf.valor)}.`, 88);
    } else if (pf.falta_unidades != null) {
      add('acao', `Faltam ${un(pf.falta_unidades)} para a faixa de ${fmtPct(pf.min)}${pf.rotulo ? ` (${pf.rotulo})` : ''}${mais}.`, 88);
    } else {
      add('acao', `Faltam ${NF0.format(Math.ceil(pf.falta_pontos))} pontos para a faixa de ${fmtPct(pf.min)}${mais}.`, 85);
    }
  }
  // prêmio por meta somado aos blocos (quando o próximo degrau mostrado é outro)
  const pb = linha.proximo_bonus;
  if (pb && linha.proxima_faixa?.tipo !== 'bonus' && t.status !== 'futura' && t.status !== 'encerrada') {
    add('acao', `${faltaTexto(pb)} para ${alvoMeta(pb.min)} e ganhar mais ${fmtMoeda(pb.valor)}.`, 84);
  }

  // movimento no ranking
  if (movimento > 0) add('positivo', `Você subiu ${plural(movimento, 'posição', 'posições')} na última semana e agora é ${linha.posicao}º de ${participantes.length}.`, 70);
  else if (movimento < 0) add('alerta', `Você caiu ${plural(-movimento, 'posição', 'posições')} na última semana e agora é ${linha.posicao}º de ${participantes.length}.`, 72);
  if (linha.posicao_proj && linha.posicao_proj < linha.posicao && t.status === 'andamento') {
    add('info', `Pela projeção você termina em ${linha.posicao_proj}º lugar.`, 40);
  }

  // ritmo recente vs média
  const r = t.status === 'andamento' ? ritmos(resultado, idxPrincipal, linha.chave) : null;
  if (r && r.media > 0 && r.recente <= 0) {
    add('alerta', `Nenhuma venda desses produtos na última semana. Sua média na campanha era ${fmt(r.media, 'decimal').replace(/,00$/, '')}${principal.unidade ? ` ${principal.unidade}` : ''}/dia. Retome os clientes abaixo.`, 75);
  } else if (r?.variacao != null && Math.abs(r.variacao) >= 15) {
    add(r.variacao > 0 ? 'positivo' : 'alerta', `Seu ritmo na última semana está ${NF0.format(Math.abs(r.variacao))}% ${r.variacao > 0 ? 'acima' : 'abaixo'} da sua média na campanha.`, 60);
  }

  // comparativo
  if (linha.score != null && media != null) {
    const ref = mediaGrupo ?? media;
    const dif = linha.score - ref;
    if (Math.abs(dif) >= 5) add(dif > 0 ? 'positivo' : 'info', `Você está ${NF0.format(Math.abs(dif))} pontos ${dif > 0 ? 'acima' : 'abaixo'} da média ${mediaGrupo != null ? 'da sua equipe' : 'geral'} (${fmtPct(ref)}).`, 45);
    if (lider && lider.chave !== linha.chave && lider.score != null && linha.posicao <= 10) {
      add('info', `O líder (${primeiroNome(lider.nome)}) está com ${fmtPct(lider.score)}, ${NF0.format(lider.score - linha.score)} pontos à sua frente.`, 35);
    }
  }

  // oportunidades na carteira
  let oportunidades = [];
  if (op.comOportunidades !== false && ['vendedor', 'equipe'].includes(c.participantes.nivel) && linha.status !== 'atingiu') {
    oportunidades = (op.lote ? oportunidadesPorChave(resultado).get(linha.chave) || [] : oportunidadesDeUm(resultado, linha.chave)).slice(0, 5).map((o) => ({
      id_cliente: o.id,
      cliente: o.nome,
      cidade: [o.cidade, o.estado].filter(Boolean).join('/'),
      motivo: o.valor_hist > 0 ? `comprou ${fmtMoeda(o.valor_hist)} desses produtos nos 4 meses antes da campanha` : 'compra com você e ainda não levou os produtos',
      valor_hist: o.valor_hist,
      ultima: o.ultima,
    }));
    if (oportunidades.length) {
      const soma = oportunidades.reduce((a, o) => a + (o.valor_hist || 0), 0);
      add('acao', `${plural(oportunidades.length, 'cliente seu já comprou', 'clientes seus já compraram')} esses produtos antes e ainda não ${oportunidades.length === 1 ? 'comprou' : 'compraram'} nesta campanha${soma > 0 ? ` (histórico de ${fmtMoeda(soma)})` : ''}: ${oportunidades.slice(0, 3).map((o) => o.cliente).join(', ')}.`, 80);
    }
  }

  // estoque
  const alertasEstoque = estoqueEmRisco(resultado).map((e) => ({ id_produto: e.id, produto: e.nome, cobertura_dias: e.cobertura_dias, risco: e.risco }));
  if (alertasEstoque.length && t.status === 'andamento') {
    const e = alertasEstoque[0];
    add('alerta', `Estoque: ${e.produto} ${e.risco === 'abaixo_minimo' ? 'está abaixo do mínimo' : `cobre só ~${NF0.format(e.cobertura_dias || 0)} dias`}. Priorize os pedidos desse item.`, 50);
  }

  destaques.sort((a, b) => b.peso - a.peso);
  return {
    chave: linha.chave,
    nome: linha.nome,
    primeiro_nome: primeiroNome(linha.nome),
    foto: linha.foto || null,
    grupo: linha.grupo,
    contato: linha.contato,
    responsavel: linha.responsavel,
    campanha: {
      id: op.idCampanha ?? null,
      nome: c.nome,
      fornecedor: c.fornecedor,
      cor: c.cor,
      inicio: t.inicio,
      fim: t.fim,
      dias_restantes: t.restantes,
      calendario: tipoDia,
      referencia: t.referencia,
      status_tempo: t.status,
      premiacao: c.premiacao.tipo,
    },
    status: linha.status,
    status_rotulo: STATUS_PARTICIPANTE[linha.status],
    posicao: linha.posicao,
    posicao_proj: linha.posicao_proj,
    total_participantes: participantes.length,
    movimento,
    score: linha.score,
    score_proj: linha.score_proj,
    premio: linha.premio,
    premio_proj: linha.premio_proj,
    proxima_faixa: linha.proxima_faixa,
    criterios: crits,
    destaques: destaques.map(({ tipo, texto }) => ({ tipo, texto })),
    comparativo: { media_score: media, media_grupo: mediaGrupo, lider_nome: lider?.nome, lider_score: lider?.score, distancia_lider: lider?.score != null && linha.score != null ? lider.score - linha.score : null, percentil },
    oportunidades,
    alertas_estoque: alertasEstoque,
  };
}

/** Boletins de todos (ou alguns) participantes. filtro: todos|risco|nao_atingiu|atingiu|perto_faixa */
export function boletins(resultado, { filtro = 'todos', chaves, idCampanha, movimentos, comOportunidades = true } = {}) {
  let linhas = resultado.participantes;
  if (chaves?.length) {
    const set = new Set(chaves.map(String));
    linhas = linhas.filter((l) => set.has(l.chave));
  }
  linhas = filtrarLinhas(linhas, filtro);
  const lote = linhas.length > 3; // muitos boletins: calcula as oportunidades de todos de uma vez
  return linhas.map((l) => boletimParticipante(resultado, l, { idCampanha, movimentos, comOportunidades, lote }));
}

/** Participantes de um filtro de envio (todos, risco, nao_atingiu, atingiu, perto_faixa). */
export function filtrarLinhas(linhas, filtro = 'todos') {
  return linhas.filter((l) => {
    switch (filtro) {
      case 'risco':
        return ['risco', 'atencao'].includes(l.status);
      case 'nao_atingiu':
        return !['atingiu', 'sem_meta'].includes(l.status);
      case 'atingiu':
        return l.status === 'atingiu';
      case 'perto_faixa':
        return l.proxima_faixa && l.proxima_faixa.falta_pontos <= 15;
      default:
        return true;
    }
  });
}

// ------------------------------------------------------------------ resumos para gerente e diretoria
export function resumoEquipes(resultado) {
  const grupos = new Map();
  for (const l of resultado.participantes) {
    const k = l.responsavel?.chave || '_';
    if (!grupos.has(k)) grupos.set(k, { responsavel: l.responsavel, membros: [] });
    grupos.get(k).membros.push(l);
  }
  return [...grupos.values()].filter((g) => g.responsavel).map((g) => {
    const comScore = g.membros.filter((m) => m.score != null);
    const conta = (st) => g.membros.filter((m) => m.status === st).length;
    return {
      responsavel: g.responsavel,
      membros: g.membros,
      media_score: comScore.length ? comScore.reduce((a, m) => a + m.score, 0) / comScore.length : null,
      media_score_proj: comScore.length ? comScore.reduce((a, m) => a + (m.score_proj ?? 0), 0) / comScore.length : null,
      atingiram: conta('atingiu'),
      no_ritmo: conta('no_ritmo'),
      atencao: conta('atencao'),
      risco: conta('risco') + conta('nao_atingiu'),
      premio_proj: g.membros.reduce((a, m) => a + (m.premio_proj || 0), 0),
    };
  });
}

/** Frase-resumo da campanha (para painel, listas e mensagem executiva). */
export function frasesCampanha(resultado) {
  const { resumo: r, tempo: t, criterios } = resultado;
  const frases = [];
  if (t.status === 'futura') {
    frases.push(`Começa em ${fmtDataBR(t.inicio)}.`);
    return frases;
  }
  if (r.atingimento_geral_proj != null && t.status === 'andamento') {
    frases.push(`No ritmo atual a campanha fecha em ${fmtPct(r.atingimento_geral_proj)} da meta (hoje: ${fmtPct(r.atingimento_geral)}).`);
  } else if (r.atingimento_geral != null) frases.push(`Atingimento geral: ${fmtPct(r.atingimento_geral)}.`);
  if (r.participantes) {
    frases.push(`${plural(r.atingiram, 'participante já bateu', 'participantes já bateram')} a meta e ${plural(r.no_ritmo, 'está no ritmo', 'estão no ritmo')}; ${plural(r.risco + r.atencao, 'precisa', 'precisam')} acelerar.`);
  }
  const c0 = criterios[0];
  if (c0?.total.variacao_proj != null && Number.isFinite(c0.total.variacao_proj)) {
    frases.push(`${c0.nome}: projeção ${c0.total.variacao_proj >= 0 ? '+' : ''}${NF0.format(c0.total.variacao_proj)}% vs o período anterior.`);
  }
  if (r.orcamento) frases.push(`Prêmios projetados: ${fmtMoeda(r.premio_proj_total)} de ${fmtMoeda(r.orcamento)} de orçamento (${fmtPct((r.uso_orcamento_proj || 0) * 100)}).`);
  else if (r.premio_proj_total > 0) frases.push(`Prêmios projetados: ${fmtMoeda(r.premio_proj_total)}.`);
  return frases;
}

/** Movimento de posições vs N dias antes (precisa da apuração na data anterior). */
export function movimentosEntre(atual, anterior) {
  const mapa = new Map();
  if (!anterior) return mapa;
  const antes = new Map(anterior.participantes.map((l) => [l.chave, l.posicao]));
  for (const l of atual.participantes) {
    const a = antes.get(l.chave);
    if (a != null) mapa.set(l.chave, a - l.posicao);
  }
  return mapa;
}

/** Último disparo por campanha (para "sem acompanhamento há X dias"). */
export function ultimoDisparo(idCampanha) {
  return db.prepare("SELECT MAX(criado_em) AS d FROM disparo WHERE id_campanha = ? AND status IN ('enviado','simulado','registrado','pendente')").get(idCampanha)?.d || null;
}
