// Formatação pt-BR. Toda exibição de número/data passa por aqui.

const cacheNf = new Map();
function nf(min, max, extra = {}) {
  const k = `${min}|${max}|${JSON.stringify(extra)}`;
  if (!cacheNf.has(k)) cacheNf.set(k, new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra }));
  return cacheNf.get(k);
}

const vazio = (v) => v == null || Number.isNaN(v) || !Number.isFinite(Number(v));

export function fmtNumero(v, casas = 0) {
  if (vazio(v)) return '-';
  return nf(casas, casas).format(v);
}

export function fmtDecimal(v, casas = 2) {
  if (vazio(v)) return '-';
  return nf(0, casas).format(v);
}

export function fmtMoeda(v, { compacto = false, casas } = {}) {
  if (vazio(v)) return '-';
  if (compacto && Math.abs(v) >= 1000) return `R$ ${fmtCompacto(v)}`;
  const c = casas ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return nf(c, c, { style: 'currency', currency: 'BRL' }).format(v);
}

export function fmtPerc(v, casas = 0) {
  if (vazio(v)) return '-';
  return `${nf(casas, casas).format(v)}%`;
}

export function fmtCompacto(v) {
  if (vazio(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf(0, 1).format(v / 1e9)} bi`;
  if (a >= 1e6) return `${nf(0, 1).format(v / 1e6)} mi`;
  if (a >= 1e4) return `${nf(0, 1).format(v / 1e3)} mil`;
  if (a >= 1e3) return nf(0, 0).format(v);
  return nf(0, a < 10 ? 1 : 0).format(v);
}

export function fmtUsd(v) {
  if (vazio(v)) return '-';
  return `US$ ${nf(2, v < 1 ? 4 : 2).format(v)}`;
}

/** Formata conforme o formato de uma métrica: numero | moeda | perc | decimal */
export function fmtValor(v, formato = 'numero', { compacto = false } = {}) {
  if (vazio(v)) return '-';
  switch (formato) {
    case 'moeda':
      return fmtMoeda(v, { compacto });
    case 'perc':
      return fmtPerc(v, Math.abs(v) < 10 ? 1 : 0);
    case 'decimal':
      return fmtDecimal(v, 2);
    default:
      return compacto ? fmtCompacto(v) : fmtNumero(v, Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0);
  }
}

/** Valor + unidade ("1.240 un", "R$ 12.300", "38 clientes") */
export function fmtComUnidade(v, formato, unidade) {
  const s = fmtValor(v, formato);
  return unidade && formato === 'numero' && s !== '-' ? `${s} ${unidade}` : s;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const partes = (iso) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { a, m, d };
};

export function fmtData(iso) {
  if (!iso) return '-';
  const { a, m, d } = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

export function fmtDataCurta(iso) {
  if (!iso) return '-';
  const { m, d } = partes(iso);
  return `${d} ${MESES[m - 1]}`;
}

export function fmtMesAno(iso) {
  const { a, m } = partes(iso);
  return `${MESES_LONGOS[m - 1]} de ${a}`;
}

export function fmtDiaSemana(iso) {
  const { a, m, d } = partes(iso);
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

export function fmtPeriodo(inicio, fim) {
  if (!inicio || !fim) return '-';
  const i = partes(inicio);
  const f = partes(fim);
  if (i.a === f.a && i.m === f.m) return `${i.d} a ${f.d} ${MESES[f.m - 1]} ${f.a}`;
  if (i.a === f.a) return `${i.d} ${MESES[i.m - 1]} a ${f.d} ${MESES[f.m - 1]} ${f.a}`;
  return `${fmtData(inicio)} a ${fmtData(fim)}`;
}

export function fmtDataHora(isoCompleto) {
  if (!isoCompleto) return '-';
  const d = new Date(isoCompleto);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function fmtRelativo(isoCompleto) {
  if (!isoCompleto) return '-';
  const s = (Date.now() - new Date(isoCompleto).getTime()) / 1000;
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.round(s / 86400)} d`;
  return fmtDataHora(isoCompleto).slice(0, 10);
}

export function fmtDelta(v, casas = 0) {
  if (vazio(v)) return '-';
  const s = nf(casas, casas).format(Math.abs(v));
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`;
}

export function primeiroNome(nome = '') {
  return String(nome).replace(/^Equipe\s+/i, '').split(/\s+/)[0] || nome;
}

export function iniciais(nome = '') {
  const p = String(nome).replace(/^Equipe\s+/i, '').replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

export const plural = (n, um, varios) => `${fmtNumero(n)} ${n === 1 ? um : varios}`;
