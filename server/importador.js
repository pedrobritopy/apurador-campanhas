import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { db, PASTA_DADOS, invalidarCache, agoraISO, transacao } from './db.js';
import { TABELAS_DADOS } from './esquema.js';

const normalizarNome = (s) =>
  String(s ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_');

function numero(v) {
  let s = v.replace(/\s|R\$/g, '');
  if (s.includes(',') && s.includes('.')) {
    // 1.234,56 (pt-BR) ou 1,234.56 (en-US)
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function converter(valor, tipo, coluna) {
  if (valor == null) return null;
  const v = String(valor).trim();
  if (v === '' || /^(null|nan|none)$/i.test(v)) return null;
  switch (tipo) {
    case 'INTEGER': {
      const n = numero(v);
      return n == null ? null : Math.round(n);
    }
    case 'REAL':
      return numero(v);
    case 'BOOL':
      return /^(true|1|sim|s|yes|y|verdadeiro|t)$/i.test(v) ? 1 : 0;
    default: {
      // datas dd/mm/aaaa -> aaaa-mm-dd
      if (coluna.startsWith('data')) {
        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        return v.slice(0, 10);
      }
      return v;
    }
  }
}

/** Descobre a tabela pelo nome do arquivo (ex.: "fato_vendas (1).csv") ou, se falhar, pelo cabeçalho. */
export function detectarTabela(nomeArquivo, cabecalho = []) {
  const base = normalizarNome(path.basename(nomeArquivo || '', path.extname(nomeArquivo || '')));
  const porNome = Object.keys(TABELAS_DADOS)
    .filter((t) => base.startsWith(t))
    .sort((a, b) => b.length - a.length)[0];
  if (porNome) return porNome;
  let melhor = null;
  let melhorNota = 0;
  for (const [t, spec] of Object.entries(TABELAS_DADOS)) {
    const cols = Object.keys(spec.colunas);
    if (!cabecalho.includes(spec.pk)) continue;
    const nota = cols.filter((c) => cabecalho.includes(c)).length / cols.length;
    if (nota > melhorNota) [melhor, melhorNota] = [t, nota];
  }
  return melhorNota >= 0.7 ? melhor : null;
}

function primeiraLinha(entrada) {
  let buf;
  if (Buffer.isBuffer(entrada)) buf = entrada.subarray(0, 65536);
  else {
    const fd = fs.openSync(entrada, 'r');
    buf = Buffer.alloc(65536);
    const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    buf = buf.subarray(0, lidos);
  }
  return buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
}

/**
 * Importa um CSV para a tabela correspondente.
 * @param {string|Buffer} entrada caminho do arquivo ou conteúdo
 * @param {{tabela?: string, modo?: 'substituir'|'mesclar', nomeArquivo?: string}} opcoes
 */
export async function importarArquivo(entrada, opcoes = {}) {
  const modo = opcoes.modo === 'mesclar' ? 'mesclar' : 'substituir';
  const nomeArquivo = opcoes.nomeArquivo || (typeof entrada === 'string' ? path.basename(entrada) : 'upload.csv');
  const linha1 = primeiraLinha(entrada);
  const delimitador = [';', ',', '\t', '|'].map((d) => [d, linha1.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const cabecalho = linha1.split(delimitador).map(normalizarNome);
  const tabela = opcoes.tabela || detectarTabela(nomeArquivo, cabecalho);
  if (!tabela || !TABELAS_DADOS[tabela]) {
    throw Object.assign(new Error(`Não reconheci a tabela do arquivo "${nomeArquivo}". Use um nome como fato_vendas.csv ou escolha a tabela.`), { status: 400 });
  }
  const spec = TABELAS_DADOS[tabela];
  const colunas = cabecalho.filter((c) => c in spec.colunas);
  if (!colunas.includes(spec.pk)) {
    throw Object.assign(new Error(`O arquivo não tem a coluna chave "${spec.pk}" da tabela ${tabela}.`), { status: 400 });
  }

  const fluxo = Buffer.isBuffer(entrada) ? Readable.from([entrada]) : fs.createReadStream(entrada);
  const leitor = fluxo.pipe(
    parse({
      delimiter: delimitador,
      bom: true,
      columns: (h) => h.map(normalizarNome),
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    }),
  );

  // Converte tudo antes de abrir a transação: assim o banco nunca fica num estado intermediário.
  const linhas = [];
  for await (const reg of leitor) linhas.push(colunas.map((c) => converter(reg[c], spec.colunas[c], c)));

  const sql = `INSERT OR REPLACE INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`;
  transacao(() => {
    if (modo === 'substituir') db.exec(`DELETE FROM ${tabela}`);
    const st = db.prepare(sql);
    for (const l of linhas) st.run(...l);
    db.prepare('INSERT INTO importacao (tabela, arquivo, modo, linhas, criado_em) VALUES (?, ?, ?, ?, ?)').run(
      tabela, nomeArquivo, modo, linhas.length, agoraISO(),
    );
  });
  invalidarCache();
  return { tabela, arquivo: nomeArquivo, linhas: linhas.length, modo, colunas_ignoradas: cabecalho.filter((c) => !(c in spec.colunas)) };
}

/** Importa (substituindo) todos os CSVs reconhecidos da pasta de dados. */
export async function importarPasta(pasta = PASTA_DADOS) {
  if (!fs.existsSync(pasta)) throw new Error(`Pasta de dados não encontrada: ${pasta}`);
  const arquivos = fs.readdirSync(pasta).filter((f) => /\.(csv|txt)$/i.test(f));
  const resultado = [];
  const ignorados = [];
  // dimensões primeiro, fatos depois
  const ordenados = arquivos.sort((a, b) => (a.startsWith('fato') ? 1 : 0) - (b.startsWith('fato') ? 1 : 0) || a.localeCompare(b));
  for (const arq of ordenados) {
    const caminho = path.join(pasta, arq);
    const tabela = detectarTabela(arq, primeiraLinha(caminho).split(/[;,\t|]/).map(normalizarNome));
    if (!tabela) {
      ignorados.push(arq);
      continue;
    }
    resultado.push(await importarArquivo(caminho, { tabela, modo: 'substituir' }));
  }
  return { importados: resultado, ignorados };
}

// CLI: npm run importar
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inicio = Date.now();
  importarPasta(process.argv[2])
    .then(({ importados, ignorados }) => {
      for (const r of importados) console.log(`✔ ${r.tabela.padEnd(14)} ${String(r.linhas).padStart(8)} linhas  (${r.arquivo})`);
      for (const a of ignorados) console.log(`· ignorado: ${a} (tabela não usada pelo apurador)`);
      console.log(`Concluído em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
    })
    .catch((e) => {
      console.error('Falha na importação:', e.message);
      process.exit(1);
    });
}
