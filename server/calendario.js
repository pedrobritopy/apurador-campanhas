// Datas são sempre strings 'AAAA-MM-DD' tratadas em UTC para não sofrer com fuso horário.

const pad = (n) => String(n).padStart(2, '0');
const paraData = (iso) => new Date(`${iso}T00:00:00Z`);
const paraISO = (d) => d.toISOString().slice(0, 10);

export function addDias(iso, n) {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return paraISO(d);
}

export const diaSemana = (iso) => paraData(iso).getUTCDay(); // 0 = domingo

export function intervalo(inicio, fim) {
  const out = [];
  for (let d = inicio; d <= fim; d = addDias(d, 1)) out.push(d);
  return out;
}

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const ultimoDiaMes = (ano, mes) => paraISO(new Date(Date.UTC(ano, mes, 0)));

export function diasEntre(a, b) {
  return Math.round((paraData(b) - paraData(a)) / 86400000);
}

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

/** Feriados nacionais (inclui Carnaval e Corpus Christi, que costumam parar o comercial). */
export function feriadosNacionais(ano) {
  const p = pascoa(ano);
  return [
    { data: `${ano}-01-01`, nome: 'Confraternização Universal' },
    { data: addDias(p, -48), nome: 'Carnaval (segunda)' },
    { data: addDias(p, -47), nome: 'Carnaval (terça)' },
    { data: addDias(p, -2), nome: 'Sexta-feira Santa' },
    { data: `${ano}-04-21`, nome: 'Tiradentes' },
    { data: `${ano}-05-01`, nome: 'Dia do Trabalho' },
    { data: addDias(p, 60), nome: 'Corpus Christi' },
    { data: `${ano}-09-07`, nome: 'Independência do Brasil' },
    { data: `${ano}-10-12`, nome: 'Nossa Senhora Aparecida' },
    { data: `${ano}-11-02`, nome: 'Finados' },
    { data: `${ano}-11-15`, nome: 'Proclamação da República' },
    { data: `${ano}-11-20`, nome: 'Dia da Consciência Negra' },
    { data: `${ano}-12-25`, nome: 'Natal' },
  ].sort((x, y) => x.data.localeCompare(y.data));
}

/** Lista efetiva de feriados: a configurada pelo usuário ou os nacionais do ano anterior/atual/seguinte. */
export function listaFeriados(configFeriados) {
  if (Array.isArray(configFeriados)) return configFeriados;
  const ano = Number(hojeISO().slice(0, 4));
  return [ano - 1, ano, ano + 1].flatMap(feriadosNacionais);
}

/**
 * @param {'uteis'|'corridos'} modo
 * @param {{data: string}[]} feriados
 */
export function criarCalendario(modo, feriados = []) {
  const set = new Set(feriados.map((f) => (typeof f === 'string' ? f : f.data)));
  const conta =
    modo === 'corridos'
      ? () => true
      : (iso) => {
          const ds = diaSemana(iso);
          return ds !== 0 && ds !== 6 && !set.has(iso);
        };
  return { modo, conta, rotulo: modo === 'corridos' ? 'corridos' : 'úteis' };
}

/** Período-base padrão para comparação: mês anterior (se a campanha é um mês cheio) ou a mesma duração imediatamente antes. */
export function periodoAnterior(inicio, fim) {
  const [a, m, d] = inicio.split('-').map(Number);
  const mesCheio = d === 1 && fim === ultimoDiaMes(a, m);
  if (mesCheio) {
    const ini = paraISO(new Date(Date.UTC(a, m - 2, 1)));
    return { inicio: ini, fim: ultimoDiaMes(Number(ini.slice(0, 4)), Number(ini.slice(5, 7))) };
  }
  const dur = diasEntre(inicio, fim);
  return { inicio: addDias(inicio, -(dur + 1)), fim: addDias(inicio, -1) };
}
