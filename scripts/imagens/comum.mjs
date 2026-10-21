// Utilidades compartilhadas pelos scripts de imagens (coleta, ilustração, logos).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PASTA_PRODUTOS = path.join(RAIZ, 'dados', 'imagens', 'produtos');
export const PASTA_FABRICANTES = path.join(RAIZ, 'dados', 'imagens', 'fabricantes');
export const PASTA_MARCAS = path.join(RAIZ, 'dados', 'imagens', 'marcas');
export const USER_AGENT = 'ApuradorCampanhas/1.0 (ferramenta interna de apuracao de campanhas; imagens com licenca registrada)';

export function lerProdutos() {
  const linhas = fs.readFileSync(path.join(RAIZ, 'dados', 'dm_produto.csv'), 'utf8').trim().split(/\r?\n/);
  const cab = linhas[0].split(';');
  return linhas.slice(1).map((l) => {
    const v = l.split(';');
    const o = Object.fromEntries(cab.map((c, i) => [c, v[i]]));
    o.id_produto = Number(o.id_produto);
    return o;
  });
}

export const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const slug = (s) => semAcento(s).toLowerCase().replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buscarJson(url, { tentativas = 5, espera = 5000 } = {}) {
  for (let t = 1; t <= tentativas; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get('retry-after')) || 0;
        if (ra) await esperar(Math.min(ra, 120) * 1000);
        throw new Error(`HTTP ${r.status}`);
      }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (t === tentativas) throw e;
      await esperar(espera * t);
    }
  }
  return null;
}

export async function baixar(url, destino) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error('arquivo grande demais');
  fs.writeFileSync(destino, buf);
  return buf;
}

/** CSV simples com ; (escapa aspas). */
export function escreverCsv(arquivo, linhas, colunas) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(arquivo, [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => esc(l[c])).join(';'))].join('\n') + '\n');
}

/** EAN-13/EAN-8/GTIN-14 com dígito verificador válido. */
export function eanValido(e) {
  const s = String(e ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(s.length)) return false;
  const d = s.split('').map(Number);
  const dv = d.pop();
  const soma = d.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

/** EAN real de cada produto: coluna ean do cadastro (se válida) ou o mapeamento de referência. */
export function mapaEans() {
  const mapa = new Map();
  const arq = path.join(RAIZ, 'dados', 'referencia', 'mapa_produtos_atuais.csv');
  if (fs.existsSync(arq)) {
    const linhas = fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const sep = linhas[0].includes(';') ? ';' : ',';
    const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));
    const iId = cab.findIndex((c) => c === 'id_produto');
    const iEan = ['ean_real', 'ean', 'gtin', 'codigo_barras'].map((n) => cab.indexOf(n)).find((i) => i >= 0);
    if (iId >= 0 && iEan != null && iEan >= 0) {
      for (const l of linhas.slice(1)) {
        const v = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
        const e = v[iEan].replace(/\D/g, '');
        if (eanValido(e)) mapa.set(Number(v[iId]), e);
      }
    }
  }
  return mapa;
}
export function eanDoProduto(p, mapa) {
  const proprio = String(p.ean || '').replace(/\D/g, '');
  if (eanValido(proprio)) return proprio;
  return mapa?.get(p.id_produto) || null;
}

// ------------------------------------------------------------------ registro de origem das imagens de produto
export const ARQ_ORIGEM = path.join(PASTA_PRODUTOS, 'origem.csv');
export const COLS_ORIGEM = ['id_produto', 'arquivo', 'tipo', 'fonte', 'confianca', 'ean_usado', 'nome_encontrado', 'url_origem', 'pagina', 'licenca', 'autor', 'formato', 'gerado_em'];

function lerCsvPontoVirgula(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  const ls = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cab = ls[0].split(';');
  return ls.slice(1).map((l) => {
    const v = []; let cur = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ';') { v.push(cur); cur = ''; } else cur += ch;
    }
    v.push(cur);
    return Object.fromEntries(cab.map((c, i) => [c, v[i] ?? '']));
  });
}
export function lerOrigem() {
  return new Map(lerCsvPontoVirgula(ARQ_ORIGEM).map((o) => [Number(o.id_produto), o]));
}
export function gravarOrigem(mapa) {
  escreverCsv(ARQ_ORIGEM, [...mapa.values()].sort((a, b) => Number(a.id_produto) - Number(b.id_produto)), COLS_ORIGEM);
}
export const lerCsv = lerCsvPontoVirgula;
