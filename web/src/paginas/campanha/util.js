import { SERIES } from '../../componentes/graficos.jsx';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc, fmtValor } from '../../lib/formato.js';

/* Utilidades das telas de campanha: cores, status, formatação de critério e narrativa. */

export const COR_STATUS = {
  atingiu: 'var(--bom)',
  no_ritmo: 'var(--acento)',
  atencao: 'var(--aviso)',
  risco: 'var(--critico)',
  nao_atingiu: 'var(--critico)',
  sem_meta: 'var(--eixo)',
  aguardando: 'var(--tinta-3)',
};

export const ROTULO_STATUS = {
  atingiu: 'Atingiu',
  no_ritmo: 'No ritmo',
  atencao: 'Atenção',
  risco: 'Em risco',
  nao_atingiu: 'Não atingiu',
  sem_meta: 'Sem meta',
  aguardando: 'Aguardando',
};

const ORDEM_STATUS = ['atingiu', 'no_ritmo', 'atencao', 'risco', 'nao_atingiu', 'sem_meta', 'aguardando'];
const CAMPO_RESUMO = { atingiu: 'atingiram' };

/** Partes da barra de distribuição de status (só as que têm participantes). */
export function partesStatus(resumo = {}) {
  return ORDEM_STATUS.map((k) => ({
    chave: k,
    rotulo: ROTULO_STATUS[k],
    valor: resumo[CAMPO_RESUMO[k] || k] || 0,
    cor: COR_STATUS[k],
  })).filter((p) => p.valor > 0);
}

/** Partes de status contadas a partir das linhas (para filtros e equipes). */
export function contarStatus(linhas) {
  const c = {};
  for (const l of linhas) c[l.status] = (c[l.status] || 0) + 1;
  return ORDEM_STATUS.filter((k) => c[k]).map((k) => ({ chave: k, rotulo: ROTULO_STATUS[k], valor: c[k], cor: COR_STATUS[k] }));
}

export const corDaCampanha = (c, i = 0) => c?.cor || SERIES[Math.abs(Number(c?.id ?? i) || i) % SERIES.length];

const PLURAL_NIVEL = {
  vendedor: ['vendedor', 'vendedores'],
  equipe: ['equipe', 'equipes'],
  cliente: ['cliente', 'clientes'],
  canal: ['canal', 'canais'],
  estado: ['estado', 'estados'],
  segmento: ['segmento', 'segmentos'],
  empresa: ['participante', 'participantes'],
};
export const nomeNivel = (nivel, n) => (PLURAL_NIVEL[nivel] || PLURAL_NIVEL.empresa)[n === 1 ? 0 : 1];

/** Valor de um critério com unidade ("1.240 un", "R$ 12.300", "38 clientes", "28,7%"). */
export function fmtCrit(v, crit, { compacto = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '-';
  const formato = crit?.formato || 'numero';
  const s = fmtValor(v, formato, { compacto });
  return crit?.unidade && formato === 'numero' ? `${s} ${crit.unidade}` : s;
}

export const ehMetaSoma = (crit) => crit?.totalizar === 'soma' && crit?.sentido !== 'menor';

/** Texto do tempo da campanha (a partir de Apuracao.tempo). */
export function textoTempo(t) {
  if (!t) return '';
  if (t.status === 'futura') {
    const d = t.dias_para_inicio;
    return d != null ? `Começa em ${d} ${d === 1 ? 'dia' : 'dias'} (${fmtData(t.inicio)})` : `Começa em ${fmtData(t.inicio)}`;
  }
  if (t.status === 'encerrada') return `Período encerrado em ${fmtData(t.fim)}`;
  return `Dia ${t.decorridos} de ${t.total} ${t.calendario} · ${t.restantes === 1 ? 'falta 1 dia' : `faltam ${t.restantes} dias`}`;
}

/** Texto curto do tempo para a lista (resumo de GET /campanhas). */
export function textoTempoResumo(r, inicio, fim) {
  if (!r) return '';
  if (r.tempo_status === 'futura') return 'Ainda não começou';
  if (r.tempo_status === 'encerrada') return `Terminou em ${fmtData(fim)}`;
  return r.restantes != null ? `${r.restantes === 1 ? 'Falta 1 dia' : `Faltam ${r.restantes} dias`}` : 'Em andamento';
}

/** Dica de próxima faixa de prêmio de um participante. */
export function textoProximaFaixa(linha, ap) {
  const pf = linha?.proxima_faixa;
  if (!pf) return null;
  const faixa = ap?.campanha?.premiacao?.faixas?.[pf.indice];
  const crit = ap.criterios[0];
  const daMeta = (min) => (min === 100 ? 'bater a meta' : `${fmtNumero(min)}% da meta`);
  const alvo = pf.tipo === 'bloco' ? 'o próximo bloco'
    : pf.tipo === 'gatilho' ? (pf.exigencia === 'quantidade' ? `o mínimo de ${fmtCrit(pf.min, crit)}` : daMeta(pf.min))
      : pf.tipo === 'bonus' ? daMeta(pf.min)
        : faixa?.rotulo ? `a faixa ${faixa.rotulo}` : `${fmtNumero(pf.min)}%`;
  const falta = pf.falta_unidades != null ? fmtCrit(pf.falta_unidades, crit) : `${fmtNumero(pf.falta_pontos, pf.falta_pontos < 10 ? 1 : 0)} p.p.`;
  return `Faltam ${falta} para ${alvo}${pf.premio > 0 ? ` (${fmtMoeda(pf.premio)})` : ''}`;
}

/** Resumo de um critério para um participante: "32 de 40 un (80%) · faltam 8 · 1/dia". */
export function textoCriterioLinha(c, crit) {
  if (!c) return '';
  const partes = [];
  if (c.meta != null) partes.push(`${fmtCrit(c.realizado, crit)} de ${fmtCrit(c.meta, crit)}`);
  else partes.push(fmtCrit(c.realizado, crit));
  if (c.atingimento != null) partes.push(`(${fmtPerc(c.atingimento)})`);
  let s = partes.join(' ');
  if (c.falta > 0 && ehMetaSoma(crit)) {
    s += ` · faltam ${fmtCrit(c.falta, crit)}`;
    if (c.ritmo_necessario > 0) s += ` (${fmtValor(c.ritmo_necessario, crit.formato === 'moeda' ? 'moeda' : 'decimal')}/dia)`;
  }
  return s;
}

/**
 * Narrativa da apuração em linguagem natural.
 * @returns {(string|{forte:string})[][]} frases; cada parte é texto ou destaque
 */
export function narrativaApuracao(ap) {
  if (!ap) return [];
  const r = ap.resumo || {};
  const t = ap.tempo || {};
  const n = r.participantes || 0;
  const nivel = ap.campanha?.participantes?.nivel;
  const pl = nomeNivel(nivel, n);
  const frases = [];
  const comMeta = n - (r.sem_meta || 0);

  if (t.status === 'futura') {
    frases.push(['A campanha começa em ', { forte: `${t.dias_para_inicio ?? '?'} ${t.dias_para_inicio === 1 ? 'dia' : 'dias'}` }, ` (${fmtData(t.inicio)}) e vai até ${fmtData(t.fim)}. `]);
    frases.push([{ forte: `${fmtNumero(n)} ${pl}` }, ' participam', ap.criterios?.length > 1 ? ` em ${ap.criterios.length} critérios.` : '.']);
    return frases;
  }

  if (comMeta === 0) {
    const lider = ap.participantes?.[0];
    const crit = ap.criterios?.[0];
    frases.push(['Campanha de ranking, sem meta individual. ']);
    if (lider) frases.push(['Lidera ', { forte: lider.nome }, ' com ', { forte: fmtCrit(lider.criterios?.[0]?.realizado, crit) }, '. ']);
    if (r.premio_proj_total > 0) frases.push(['Premiação projetada: ', { forte: fmtMoeda(r.premio_proj_total) }, '.']);
    return frases;
  }

  if (t.status === 'encerrada') {
    frases.push(['Campanha encerrada com ', { forte: fmtPerc(r.atingimento_geral) }, ' de atingimento geral. ']);
    const f = [{ forte: `${fmtNumero(r.atingiram)} de ${fmtNumero(n)}` }, ` ${pl} bateram a meta`];
    if (r.premio_total > 0) f.push(' e a premiação apurada é de ', { forte: fmtMoeda(r.premio_total) });
    f.push('.');
    frases.push(f);
    return frases;
  }

  const proj = r.atingimento_geral_proj;
  if (proj != null) {
    frases.push([
      'No ritmo atual, a campanha fecha em ',
      { forte: fmtPerc(proj) },
      proj >= 100 ? ' da meta, acima do objetivo. ' : ` da meta. Faltariam ${fmtNumero(100 - proj)} pontos. `,
    ]);
  }
  const f2 = [{ forte: `${fmtNumero(r.atingiram)} de ${fmtNumero(n)}` }, ` ${pl} já bateram a meta`];
  if (r.no_ritmo) f2.push('; ', { forte: fmtNumero(r.no_ritmo) }, ' estão no ritmo');
  const acelerar = (r.risco || 0) + (r.atencao || 0);
  if (acelerar) f2.push(' e ', { forte: fmtNumero(acelerar) }, ' precisam acelerar');
  f2.push('. ');
  frases.push(f2);

  const comProj = (ap.criterios || []).filter((c) => c.total?.atingimento_proj != null);
  if (comProj.length > 1) {
    const fraco = [...comProj].sort((a, b) => a.total.atingimento_proj - b.total.atingimento_proj)[0];
    if (fraco.total.atingimento_proj < 100) {
      frases.push(['O critério mais crítico é ', { forte: fraco.nome }, ', com projeção de ', { forte: fmtPerc(fraco.total.atingimento_proj) }, '. ']);
    }
  }
  const c0 = ap.criterios?.[0];
  if (c0?.total?.variacao_proj != null && Number.isFinite(c0.total.variacao_proj)) {
    const v = c0.total.variacao_proj;
    frases.push([
      `Em ${c0.nome}, a projeção fica `,
      { forte: `${v >= 0 ? '+' : '−'}${fmtNumero(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)}%` },
      ` ${v >= 0 ? 'acima' : 'abaixo'} do período anterior (${fmtCrit(c0.total.base, c0, { compacto: true })}). `,
    ]);
  }
  if (r.orcamento) {
    frases.push(['A premiação projetada é de ', { forte: fmtMoeda(r.premio_proj_total) }, `, ${fmtPerc((r.uso_orcamento_proj || 0) * 100)} do orçamento.`]);
  } else if (r.premio_proj_total > 0) {
    frases.push(['A premiação projetada é de ', { forte: fmtMoeda(r.premio_proj_total) }, '.']);
  }
  return frases;
}

/** Agrega participantes por grupo (equipes, cidades...). */
export function agruparPorGrupo(ap) {
  const grupos = new Map();
  for (const l of ap.participantes || []) {
    const k = l.id_grupo || l.grupo || '-';
    if (!grupos.has(k)) grupos.set(k, { chave: k, nome: l.grupo || 'Sem grupo', linhas: [] });
    grupos.get(k).linhas.push(l);
  }
  return [...grupos.values()].map((g) => {
    const scores = g.linhas.map((l) => l.score).filter((s) => s != null);
    const projs = g.linhas.map((l) => l.score_proj).filter((s) => s != null);
    const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const criterios = (ap.criterios || []).map((crit, i) => {
      if (!ehMetaSoma(crit)) return { realizado: null, meta: null, atingimento: null };
      let real = 0;
      let meta = 0;
      let temMeta = false;
      for (const l of g.linhas) {
        real += l.criterios[i]?.realizado || 0;
        if (l.criterios[i]?.meta != null) {
          meta += l.criterios[i].meta;
          temMeta = true;
        }
      }
      return { realizado: real, meta: temMeta ? meta : null, atingimento: temMeta && meta > 0 ? (real / meta) * 100 : null };
    });
    return {
      ...g,
      membros: g.linhas.length,
      atingiram: g.linhas.filter((l) => l.status === 'atingiu').length,
      no_ritmo: g.linhas.filter((l) => l.status === 'no_ritmo').length,
      acelerar: g.linhas.filter((l) => l.status === 'risco' || l.status === 'atencao' || l.status === 'nao_atingiu').length,
      score: media(scores),
      score_proj: media(projs),
      premio: g.linhas.reduce((a, l) => a + (l.premio || 0), 0),
      premio_proj: g.linhas.reduce((a, l) => a + (l.premio_proj || 0), 0),
      criterios,
      status: contarStatus(g.linhas),
    };
  });
}

export const TIPO_META = {
  fixa: 'Meta fixa',
  distribuida: 'Meta distribuída',
  historico: 'Crescimento s/ histórico',
  meta_geral: '% da meta geral',
  sem_meta: 'Sem meta',
};
