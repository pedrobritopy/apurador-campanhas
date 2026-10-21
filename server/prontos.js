// Resultados prontos por campanha (gravados pela pipeline, lidos pelas rotas de detalhe).
// Tudo é indexado pela chave da apuração (base + dia + referência + definição): se qualquer coisa muda,
// a chave muda e a rota não acha o pronto (calcula na hora uma vez e a pipeline repõe em seguida).
import fs from 'node:fs';
import path from 'node:path';
import { db, RAIZ } from './db.js';
import { chaveApuracao } from './motor.js';

db.exec(`
CREATE TABLE IF NOT EXISTS detalhe_pronto (
  chave_apuracao TEXT NOT NULL,
  id_campanha INTEGER,
  tipo TEXT NOT NULL,
  item TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  PRIMARY KEY (chave_apuracao, tipo, item)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_detalhe_pronto_campanha ON detalhe_pronto (id_campanha);
`);

export const PASTA_EXCEL = path.join(RAIZ, 'var', 'prontos', 'excel');

/** Referência usada nas telas de detalhe: hoje para ativas; o fim do período para encerradas. */
export const refDetalhePadrao = (camp) => (camp.status === 'encerrada' ? camp.fim : undefined);

export function chaveDetalhe(camp, referencia) {
  return chaveApuracao(camp.definicao, referencia);
}

export function lerDetalhe(camp, tipo, item = '', referencia = refDetalhePadrao(camp)) {
  const r = db.prepare('SELECT conteudo FROM detalhe_pronto WHERE chave_apuracao = ? AND tipo = ? AND item = ?').get(chaveDetalhe(camp, referencia), tipo, String(item));
  return r ? JSON.parse(r.conteudo) : null;
}

export function temDetalhes(chave) {
  return Boolean(db.prepare("SELECT 1 FROM detalhe_pronto WHERE chave_apuracao = ? AND tipo = 'completo'").get(chave));
}

export function gravarDetalhes(chave, idCampanha, itens) {
  const st = db.prepare('INSERT OR REPLACE INTO detalhe_pronto (chave_apuracao, id_campanha, tipo, item, conteudo) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const it of itens) st.run(chave, idCampanha, it.tipo, String(it.item ?? ''), JSON.stringify(it.conteudo));
    st.run(chave, idCampanha, 'completo', '', JSON.stringify({ em: new Date().toISOString() }));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Remove detalhes de chaves que não são mais as atuais. */
export function limparDetalhes(chavesAtuais) {
  const manter = new Set(chavesAtuais);
  const velhas = db.prepare('SELECT DISTINCT chave_apuracao AS c FROM detalhe_pronto').all().map((l) => l.c).filter((c) => !manter.has(c));
  const del = db.prepare('DELETE FROM detalhe_pronto WHERE chave_apuracao = ?');
  for (const c of velhas) del.run(c);
  if (fs.existsSync(PASTA_EXCEL)) {
    for (const arq of fs.readdirSync(PASTA_EXCEL)) if (!manter.has(arq.replace(/\.xlsx$/, ''))) fs.rmSync(path.join(PASTA_EXCEL, arq), { force: true });
  }
  return velhas.length;
}

export function arquivoExcel(chave) {
  const p = path.join(PASTA_EXCEL, `${chave}.xlsx`);
  return fs.existsSync(p) ? p : null;
}
