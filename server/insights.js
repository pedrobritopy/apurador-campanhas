import { isMainThread } from 'node:worker_threads';
import { db } from './db.js';
import { assinaturaBase, dispararPipeline } from './pipeline.js';
import { diasEntre, hojeISO } from './calendario.js';
import { apurarComCache, estoqueDaCampanha } from './motor.js';
import { fx } from './perfil.js';
import { visaoGeral as visaoContaCorrente } from './contacorrente.js';

// Central de insights: alertas por regra sobre todas as campanhas (custo zero, sem IA).
// Cada alerta traz uma ação direta para a tela onde se resolve o problema.

export const SEVERIDADES = ['critica', 'alta', 'media', 'info', 'positiva'];
const PESO = Object.fromEntries(SEVERIDADES.map((s, i) => [s, i]));

function campanhas(campanhaId) {
  const where = campanhaId ? 'WHERE id = ?' : "WHERE status = 'ativa'";
  return db
    .prepare(`SELECT id, nome, fornecedor, status, atualizado_em, definicao FROM campanha ${where} ORDER BY id`)
    .all(...(campanhaId ? [Number(campanhaId)] : []))
    .map((c) => {
      try {
        return { ...c, definicao: JSON.parse(c.definicao) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const porDia = (cal) => (cal === 'corridos' ? 'por dia corrido' : 'por dia útil');
const reticencias = (n, max) => (n > max ? '…' : '.');

const fmtCrit = (cr, v) => {
  const s = fx.valor(v, cr.formato);
  return cr.unidade && cr.formato === 'numero' && s !== 'n/d' ? `${s} ${cr.unidade}` : s;
};

function insightsDaCampanha(camp, agoraIso) {
  const out = [];
  let res;
  try {
    res = apurarComCache(camp.definicao);
  } catch (e) {
    return [{ id: `erro-${camp.id}`, campanha_id: camp.id, campanha: camp.nome, tipo: 'erro_apuracao', severidade: 'alta', titulo: `Não foi possível apurar “${camp.nome}”`, descricao: e.message, acao: { rotulo: 'Revisar campanha', rota: `/campanhas/${camp.id}/editar` }, gerado_em: agoraIso }];
  }
  const t = res.tempo;
  const r = res.resumo;
  const base = { campanha_id: camp.id, campanha: camp.nome, fornecedor: camp.fornecedor, gerado_em: agoraIso };
  const add = (tipo, severidade, titulo, descricao, extra = {}) => out.push({ id: `${tipo}-${camp.id}`, ...base, tipo, severidade, titulo, descricao, ...extra });
  const rota = (q = '') => `/campanhas/${camp.id}${q}`;
  const diasCorridosAteFim = diasEntre(t.referencia > t.inicio ? t.referencia : t.inicio, t.fim);
  const principal = res.criterios.findIndex((c) => c.total.meta != null);
  const cr = res.criterios[principal >= 0 ? principal : 0];

  if (camp.status === 'ativa' && t.status === 'encerrada') {
    add('fechar_periodo', 'alta', `Período de “${camp.nome}” terminou: falta fechar a apuração`,
      `A campanha acabou em ${fx.data(t.fim)}. Encerre para congelar o resultado (${fx.num(r.atingiram)} de ${fx.num(r.participantes)} atingiram; ${fx.moeda(r.premio_total)} em prêmios).`,
      { valor: r.premio_total, acao: { rotulo: 'Encerrar e congelar', rota: rota('?acao=encerrar') } });
    return out;
  }
  if (t.status === 'futura') {
    const dias = t.dias_para_inicio ?? diasEntre(t.referencia, t.inicio);
    if (dias <= 3) {
      add('comecando', 'info', `“${camp.nome}” começa em ${dias <= 1 ? '1 dia' : `${fx.num(dias)} dias`}`,
        `Envie o regulamento e as metas para os ${fx.num(r.participantes)} participantes antes do início (${fx.data(t.inicio)}).`,
        { acao: { rotulo: 'Enviar comunicado', rota: `/acompanhamentos?campanha=${camp.id}` } });
    }
    return out;
  }

  // 1) risco de não bater a meta
  const proj = r.atingimento_geral_proj;
  if (t.status === 'andamento' && proj != null && proj < 90) {
    const falta = cr.total.meta != null && cr.total.realizado != null ? Math.max(0, cr.total.meta - cr.total.realizado) : null;
    const ritmo = falta != null && t.restantes > 0 && cr.totalizar === 'soma' ? falta / t.restantes : null;
    add('risco_meta', proj < 75 ? 'critica' : 'alta', `“${camp.nome}” projeta ${fx.perc(proj)} da meta`,
      `No ritmo atual a campanha fecha em ${fx.perc(proj)} (hoje em ${fx.perc(r.atingimento_geral)} com ${fx.perc(t.progresso * 100)} do tempo).${falta != null && cr.sentido === 'maior' ? ` Faltam ${fmtCrit(cr, falta)} em “${cr.nome}”${ritmo ? `: ${fmtCrit(cr, ritmo)} ${porDia(t.calendario)} até ${fx.data(t.fim)}` : ''}.` : ''}`,
      { valor: proj, acao: { rotulo: 'Ver quem está em risco', rota: rota('?aba=ranking&status=risco') }, participantes: res.participantes.filter((l) => l.status === 'risco').map((l) => l.chave) });
  } else if (t.status === 'andamento' && cr.total.atingimento != null && cr.total.atingimento >= 100) {
    add('meta_superada', 'positiva', `“${camp.nome}” já superou a meta total`,
      `“${cr.nome}” está em ${fx.perc(cr.total.atingimento)} da meta com ${fx.num(t.restantes)} dias ${t.calendario} pela frente (projeção ${fx.perc(cr.total.atingimento_proj)}).`,
      { valor: cr.total.atingimento, acao: { rotulo: 'Ver ranking', rota: rota('?aba=ranking') } });
  }

  // 2) desaceleração (ritmo recente < 70% da média), só para métricas somáveis
  const s = cr.serie?.realizado || [];
  const i = t.idx_ref ?? s.findLastIndex?.((x) => x != null);
  if (cr.totalizar === 'soma' && i >= 13 && s[i] > 0) {
    const recente = (s[i] - (s[i - 7] ?? 0)) / 7;
    const media = s[i] / (i + 1);
    if (media > 0 && recente < 0.7 * media) {
      add('desaceleracao', 'media', `Vendas de “${cr.nome}” desaceleraram`,
        `Nos últimos 7 dias o ritmo foi de ${fmtCrit(cr, recente)} por dia, ${fx.perc((1 - recente / media) * 100)} abaixo da média da campanha (${fmtCrit(cr, media)} por dia).`,
        { valor: recente / media, acao: { rotulo: 'Ver evolução', rota: rota('?aba=visao') } });
    }
  }

  // 3) orçamento
  if (r.orcamento) {
    if (r.premio_proj_total > r.orcamento) {
      add('orcamento', 'alta', `Prêmios projetados estouram o orçamento de “${camp.nome}”`,
        `Projeção de ${fx.moeda(r.premio_proj_total)} para um orçamento de ${fx.moeda(r.orcamento)} (${fx.perc((r.premio_proj_total / r.orcamento) * 100)}). Já apurados: ${fx.moeda(r.premio_total)}.`,
        { valor: r.premio_proj_total - r.orcamento, acao: { rotulo: 'Revisar premiação', rota: `/campanhas/${camp.id}/editar` } });
    } else if (r.premio_proj_total > 0.9 * r.orcamento) {
      add('orcamento', 'media', `Prêmios de “${camp.nome}” perto do teto do orçamento`,
        `Projeção de ${fx.moeda(r.premio_proj_total)} (${fx.perc((r.premio_proj_total / r.orcamento) * 100)} do orçamento de ${fx.moeda(r.orcamento)}).`,
        { valor: r.premio_proj_total, acao: { rotulo: 'Ver premiação', rota: rota('?aba=ranking') } });
    }
  }

  // 4) ruptura de estoque antes do fim
  try {
    const est = estoqueDaCampanha(res).filter((e) => e.risco !== 'ok');
    if (est.length) {
      add('ruptura', est.some((e) => e.risco === 'ruptura') ? 'alta' : 'media', `${fx.num(est.length)} produto(s) de “${camp.nome}” podem faltar`,
        `${est.slice(0, 3).map((e) => `${e.nome}: ${fx.num(e.estoque)} un, cobre ${e.cobertura_dias == null ? 'n/d' : fx.num(e.cobertura_dias, 1)} dias`).join('; ')}${reticencias(est.length, 3)} Faltam ${fx.num(diasCorridosAteFim)} dias de campanha.`,
        { valor: est.length, acao: { rotulo: 'Ver estoque', rota: rota('?aba=estoque') } });
    }
  } catch {
    /* sem estoque */
  }

  // 5) perto da próxima faixa (oportunidade de prêmio e de venda)
  const perto = res.participantes.filter((l) => l.proxima_faixa && l.proxima_faixa.falta_pontos <= 10 && l.status !== 'aguardando');
  if (perto.length && t.status === 'andamento') {
    const ganho = perto.reduce((s2, l) => s2 + Math.max(0, (l.proxima_faixa.premio || 0) - (l.premio || 0)), 0);
    add('perto_faixa', 'media', `${fx.num(perto.length)} participante(s) a menos de 10 pontos da próxima faixa`,
      `Um empurrão agora vale ${fx.moeda(ganho)} a mais em prêmios para eles: ${perto.slice(0, 4).map((l) => `${l.nome} (${fx.num(l.proxima_faixa.falta_pontos, 1)} pts${l.proxima_faixa.falta_unidades != null ? `, ${fmtCrit(res.criterios[0], l.proxima_faixa.falta_unidades)}` : ''})`).join(', ')}${reticencias(perto.length, 4)}`,
      { valor: ganho, participantes: perto.map((l) => l.chave), acao: { rotulo: 'Avisar quem está perto', rota: `/acompanhamentos?campanha=${camp.id}&filtro=perto_faixa` } });
  }

  // 6) sem venda depois de 30% do período
  const semVenda = res.participantes.filter((l) => !l.vendeu);
  if (t.progresso >= 0.3 && semVenda.length) {
    const p = semVenda.length / (res.participantes.length || 1);
    add('sem_venda', p > 0.2 ? 'alta' : 'media', `${fx.num(semVenda.length)} participante(s) sem nenhuma venda em “${camp.nome}”`,
      `Com ${fx.perc(t.progresso * 100)} do período decorrido, ${fx.perc(p * 100)} dos participantes ainda não venderam: ${semVenda.slice(0, 5).map((l) => l.nome).join(', ')}${reticencias(semVenda.length, 5)}`,
      { valor: semVenda.length, participantes: semVenda.map((l) => l.chave), acao: { rotulo: 'Cobrar com acompanhamento', rota: `/acompanhamentos?campanha=${camp.id}&filtro=risco` } });
  }

  // 7) concentração do resultado
  if (cr.totalizar === 'soma' && res.participantes.length >= 10 && cr.total.realizado > 0) {
    const reais = res.participantes.map((l) => Math.max(0, l.criterios[principal >= 0 ? principal : 0]?.realizado || 0)).sort((a, b) => b - a);
    const n10 = Math.max(1, Math.round(reais.length * 0.1));
    const fatia = reais.slice(0, n10).reduce((a, b) => a + b, 0) / (reais.reduce((a, b) => a + b, 0) || 1);
    if (fatia > 0.6) {
      add('concentracao', 'info', `Resultado concentrado em poucos participantes`,
        `Os ${fx.num(n10)} melhores (10%) respondem por ${fx.perc(fatia * 100)} do realizado em “${cr.nome}”. Vale distribuir esforço para o meio do ranking.`,
        { valor: fatia, acao: { rotulo: 'Ver ranking', rota: rota('?aba=ranking') } });
    }
  }

  // 8) encerrando
  if (t.status === 'andamento' && diasCorridosAteFim <= 3) {
    add('encerrando', 'media', `“${camp.nome}” termina em ${diasCorridosAteFim <= 1 ? '1 dia' : `${fx.num(diasCorridosAteFim)} dias`}`,
      `${fx.num(r.no_ritmo + r.atencao)} participantes ainda podem virar a faixa. Último acompanhamento agora tem o maior efeito.`,
      { acao: { rotulo: 'Disparar acompanhamento final', rota: `/acompanhamentos?campanha=${camp.id}` } });
  }

  // 9) queda versus período anterior
  for (const c of res.criterios) {
    const v = c.total.variacao_proj;
    if (v != null && v < -10 && t.status === 'andamento') {
      add(`queda_anterior`, v < -25 ? 'alta' : 'media', `“${c.nome}” projeta ${fx.sinal(v)}% vs período anterior`,
        `Projeção de ${fmtCrit(c, c.total.projecao)} contra ${fmtCrit(c, c.total.base)} em ${fx.data(c.periodo_base.inicio)} a ${fx.data(c.periodo_base.fim)}.`,
        { valor: v, acao: { rotulo: 'Ver análise', rota: rota('?aba=visao') } });
      break;
    }
  }

  // 10) metas desbalanceadas
  const comMeta = res.participantes.filter((l) => l.criterios.some((x, k) => res.criterios[k].meta_tipo !== 'sem_meta'));
  if (comMeta.length >= 10 && t.progresso >= 0.25) {
    const zero = comMeta.filter((l) => l.criterios.some((x, k) => res.criterios[k].meta_tipo !== 'sem_meta' && !(x.meta > 0))).length;
    const altas = comMeta.filter((l) => (l.score ?? 0) > 300).length;
    if (zero / comMeta.length > 0.1 || altas / comMeta.length > 0.15) {
      add('metas_desbalanceadas', 'media', `Metas de “${camp.nome}” parecem mal calibradas`,
        `${zero ? `${fx.num(zero)} participante(s) com meta zerada` : ''}${zero && altas ? ' e ' : ''}${altas ? `${fx.num(altas)} acima de 300% de atingimento` : ''}. Revise a distribuição para manter a campanha desafiadora.`,
        { valor: zero + altas, acao: { rotulo: 'Ajustar metas', rota: `/campanhas/${camp.id}/editar` } });
    }
  }

  // 11) sem acompanhamento recente
  if (t.status === 'andamento' && t.progresso > 0.15) {
    const ult = db.prepare("SELECT MAX(criado_em) AS d FROM disparo WHERE id_campanha = ? AND status <> 'erro'").get(camp.id)?.d;
    const dias = ult ? diasEntre(ult.slice(0, 10), hojeISO()) : null;
    if (dias == null || dias >= 7) {
      add('sem_acompanhamento', 'info', `Ninguém recebe acompanhamento de “${camp.nome}” ${dias == null ? 'desde o início' : `há ${fx.num(dias)} dias`}`,
        'Participantes que recebem a posição e o que falta costumam acelerar. Dispare o boletim (posição, projeção, próxima faixa e clientes a atacar).',
        { acao: { rotulo: 'Disparar boletins', rota: `/acompanhamentos?campanha=${camp.id}` } });
    }
  }
  return out;
}

function insightsDeDados(agoraIso) {
  return db
    .prepare('SELECT regra, descricao, detalhe, divergencias FROM verificacao_dados WHERE ok = 0')
    .all()
    .map((v) => ({
      id: `divergencia-${v.regra}`, campanha_id: null, campanha: null, tipo: 'divergencia_dados', severidade: 'critica',
      titulo: `Divergência nos dados: ${v.descricao}`,
      descricao: `${v.detalhe}. Os números afetados foram retirados da base da IA até a próxima importação.`,
      valor: v.divergencias, acao: { rotulo: 'Ver qualidade dos dados', rota: '/insights?aba=qualidade' }, gerado_em: agoraIso,
    }));
}

/** Alertas da conta corrente dos fabricantes (verba negativa, ND atrasada, verba vencendo...). */
function insightsDaContaCorrente(agoraIso) {
  let alertas = [];
  try {
    alertas = visaoContaCorrente().alertas;
  } catch {
    return [];
  }
  const sev = { critico: 'alta', aviso: 'media', info: 'info' };
  return alertas.map((a, i) => ({
    id: `cc-${a.codigo}-${a.id_conta}-${a.id_lancamento ?? a.id_campanha ?? i}`, campanha_id: a.id_campanha ?? null, campanha: null,
    tipo: `conta_corrente`, severidade: sev[a.tipo] || 'info',
    titulo: `Conta corrente ${a.conta}`,
    descricao: a.texto.startsWith(`${a.conta}: `) ? a.texto.slice(a.conta.length + 2).replace(/^./, (c) => c.toUpperCase()) : a.texto,
    acao: { rotulo: 'Abrir a conta', rota: `/conta-corrente/${a.id_conta}` }, gerado_em: agoraIso,
  }));
}

// ---------------------------------------------------------------- dados prontos
// Os alertas de cada campanha ativa são calculados pela pipeline (etapa "insights") e gravados com a
// assinatura dos insumos; a rota só lê. Alertas de qualidade dos dados e da conta corrente são consultas
// leves e saem na hora.

db.exec(`CREATE TABLE IF NOT EXISTS insight_pronto (
  id_campanha INTEGER PRIMARY KEY, assinatura TEXT NOT NULL, json TEXT NOT NULL, gerado_em TEXT NOT NULL
)`);

/** Assinatura dos alertas de uma campanha: vendas e estoque, dia, definição e último disparo. Barata. */
function assinaturaInsight(c) {
  const disparo = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM disparo WHERE id_campanha = ?').get(c.id).m;
  return `${assinaturaBase()}|${hojeISO()}|${c.id}@${c.atualizado_em}|${c.status}|${disparo}`;
}

/** Etapa "insights" da pipeline: recalcula só as campanhas ativas cuja assinatura mudou. */
export async function atualizarInsightsProntos({ forcar = false, pausa = async () => {} } = {}) {
  const gravadas = new Map(db.prepare('SELECT id_campanha, assinatura FROM insight_pronto').all().map((r) => [r.id_campanha, r.assinatura]));
  const up = db.prepare(
    `INSERT INTO insight_pronto (id_campanha, assinatura, json, gerado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT(id_campanha) DO UPDATE SET assinatura = excluded.assinatura, json = excluded.json, gerado_em = excluded.gerado_em`,
  );
  const ativas = campanhas();
  let linhas = 0;
  for (const c of ativas) {
    const sig = assinaturaInsight(c);
    if (!forcar && gravadas.get(c.id) === sig) continue;
    const agoraIso = new Date().toISOString();
    up.run(c.id, sig, JSON.stringify(insightsDaCampanha(c, agoraIso)), agoraIso);
    linhas++;
    await pausa();
  }
  if (ativas.length) db.prepare(`DELETE FROM insight_pronto WHERE id_campanha NOT IN (${ativas.map((c) => c.id).join(',')})`).run();
  else db.prepare('DELETE FROM insight_pronto').run();
  return { linhas };
}

/**
 * Alertas por regra (só leitura do que está pronto).
 * @param {{ campanhaId?: number|string, severidades?: string[]|string }} p
 */
export function gerarInsights({ campanhaId, severidades } = {}) {
  const sev = (Array.isArray(severidades) ? severidades : String(severidades || '').split(',')).map((s) => s.trim()).filter((s) => SEVERIDADES.includes(s));
  const agoraIso = new Date().toISOString();
  const itens = [...insightsDeDados(agoraIso), ...(campanhaId ? [] : insightsDaContaCorrente(agoraIso))];
  const prontos = new Map(db.prepare('SELECT id_campanha, assinatura, json FROM insight_pronto').all().map((r) => [r.id_campanha, r]));
  let velho = false;
  for (const c of campanhas(campanhaId)) {
    const p = prontos.get(c.id);
    if (c.status !== 'ativa') {
      // campanha fora das ativas consultada diretamente (rara): calcula na hora
      itens.push(...insightsDaCampanha(c, agoraIso));
      continue;
    }
    if (!p || p.assinatura !== assinaturaInsight(c)) velho = true;
    if (p) itens.push(...JSON.parse(p.json));
  }
  if (velho && isMainThread) dispararPipeline('campanha', { origem: 'insights' });
  itens.sort((a, b) => PESO[a.severidade] - PESO[b.severidade] || (a.campanha_id ?? 0) - (b.campanha_id ?? 0));
  return sev.length ? itens.filter((i) => sev.includes(i.severidade)) : itens;
}

export function contarInsights() {
  const itens = gerarInsights();
  const por = Object.fromEntries(SEVERIDADES.map((s) => [s, 0]));
  for (const i of itens) por[i.severidade]++;
  return { total: itens.length, por_severidade: por };
}
