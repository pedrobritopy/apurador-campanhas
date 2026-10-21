// Mini-linguagem segura para métricas personalizadas (sem eval).
// Suporta: números, variáveis, + - * / ^, parênteses, comparações (> < >= <= == !=),
// e funções: min, max, abs, arred(x, casas), se(cond, a, b), raiz(x).
// Divisão por zero (ou qualquer resultado não finito) devolve null.

const FUNCOES = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: (x) => Math.abs(x),
  arred: (x, c = 0) => Math.round(x * 10 ** c) / 10 ** c,
  se: (c, a, b) => (c ? a : b),
  raiz: (x) => Math.sqrt(x),
};

function tokenizar(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      // decimal sempre com ponto (a vírgula separa argumentos de funções)
      const txt = src.slice(i, j).replace(/_/g, '');
      if (!/^\d*\.?\d+$|^\d+\.$/.test(txt)) throw new Error(`Número inválido "${src.slice(i, j)}"`);
      toks.push({ t: 'num', v: Number(txt) });
      i = j;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9_]/i.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    const dois = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!='].includes(dois)) { toks.push({ t: 'op', v: dois }); i += 2; continue; }
    if ('+-*/^()<>,'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Caractere inesperado "${c}"`);
  }
  return toks;
}

function analisar(toks) {
  let p = 0;
  const olhar = () => toks[p];
  const comer = (v) => {
    const t = toks[p];
    if (!t || (v && t.v !== v)) throw new Error(v ? `Esperava "${v}"` : 'Fórmula incompleta');
    p++;
    return t;
  };
  const binario = (prox, ops) => () => {
    let esq = prox();
    while (olhar()?.t === 'op' && ops.includes(olhar().v)) {
      const op = comer().v;
      esq = { op, esq, dir: prox() };
    }
    return esq;
  };
  const primario = () => {
    const t = olhar();
    if (!t) throw new Error('Fórmula incompleta');
    if (t.t === 'num') { p++; return { num: t.v }; }
    if (t.t === 'op' && t.v === '-') { p++; return { op: 'neg', esq: potencia() }; }
    if (t.t === 'op' && t.v === '+') { p++; return potencia(); }
    if (t.t === 'op' && t.v === '(') {
      p++;
      const e = comparacao();
      comer(')');
      return e;
    }
    if (t.t === 'id') {
      p++;
      if (olhar()?.v === '(') {
        if (!FUNCOES[t.v]) throw new Error(`Função desconhecida "${t.v}"`);
        p++;
        const args = [];
        if (olhar()?.v !== ')') {
          args.push(comparacao());
          while (olhar()?.v === ',') { p++; args.push(comparacao()); }
        }
        comer(')');
        return { fn: t.v, args };
      }
      return { id: t.v };
    }
    throw new Error(`Símbolo inesperado "${t.v}"`);
  };
  const potencia = () => {
    const base = primario();
    if (olhar()?.v === '^') { p++; return { op: '^', esq: base, dir: potencia() }; }
    return base;
  };
  const termo = binario(potencia, ['*', '/']);
  const soma = binario(termo, ['+', '-']);
  const comparacao = binario(soma, ['>', '<', '>=', '<=', '==', '!=']);
  const arvore = comparacao();
  if (p < toks.length) throw new Error(`Símbolo inesperado "${toks[p].v}"`);
  return arvore;
}

function avaliar(n, vars) {
  if ('num' in n) return n.num;
  if ('id' in n) {
    const v = vars[n.id];
    return v == null ? null : v;
  }
  if (n.fn) {
    const args = n.args.map((a) => avaliar(a, vars));
    if (n.fn !== 'se' && args.some((a) => a == null)) return null;
    return FUNCOES[n.fn](...args);
  }
  const a = avaliar(n.esq, vars);
  if (n.op === 'neg') return a == null ? null : -a;
  const b = avaliar(n.dir, vars);
  if (a == null || b == null) return null;
  switch (n.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : a / b;
    case '^': return a ** b;
    case '>': return a > b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
  }
  return null;
}

function coletarIds(n, out = new Set()) {
  if (n.id) out.add(n.id);
  if (n.esq) coletarIds(n.esq, out);
  if (n.dir) coletarIds(n.dir, out);
  n.args?.forEach((a) => coletarIds(a, out));
  return out;
}

const cache = new Map();

/**
 * Compila a fórmula. Lança Error com mensagem amigável se inválida.
 * @returns {{ avaliar: (vars: object) => number|null, variaveis: string[], temDivisao: boolean }}
 */
export function compilar(fonte, variaveisPermitidas) {
  const chave = `${fonte}|${variaveisPermitidas?.join(',')}`;
  if (cache.has(chave)) return cache.get(chave);
  if (!fonte || !String(fonte).trim()) throw new Error('Fórmula vazia');
  const arvore = analisar(tokenizar(String(fonte)));
  const variaveis = [...coletarIds(arvore)];
  if (variaveisPermitidas) {
    const desconhecida = variaveis.find((v) => !variaveisPermitidas.includes(v));
    if (desconhecida) throw new Error(`Variável desconhecida "${desconhecida}". Disponíveis: ${variaveisPermitidas.join(', ')}`);
  }
  const compilado = {
    variaveis,
    temDivisao: /\//.test(fonte),
    avaliar: (vars) => {
      const r = avaliar(arvore, vars);
      return r == null || !Number.isFinite(r) ? null : r;
    },
  };
  cache.set(chave, compilado);
  return compilado;
}
