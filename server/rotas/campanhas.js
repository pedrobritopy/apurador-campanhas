import fs from 'node:fs';
import { db, agoraISO } from '../db.js';
import { apurarComCache, detalharParticipante, estoqueDaCampanha, normalizarCampanha, validarCampanha } from '../motor.js';
import { addDias } from '../calendario.js';
import { boletimParticipante, boletins, filtrarLinhas, frasesCampanha, movimentosEntre } from '../narrativa.js';
import { arquivoExcel, chaveDetalhe, lerDetalhe, refDetalhePadrao } from '../prontos.js';
import { aoEncerrarCampanha, aoExcluirCampanha, aplicarVerba, planejarVerba } from '../contacorrente.js';

const erro = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

export function carregarCampanha(id) {
  const r = db.prepare('SELECT * FROM campanha WHERE id = ?').get(Number(id));
  if (!r) throw erro('Campanha não encontrada.', 404);
  return { ...r, definicao: JSON.parse(r.definicao) };
}

export function listarCampanhasAtivas() {
  return db.prepare("SELECT * FROM campanha WHERE status = 'ativa' ORDER BY inicio DESC").all().map((r) => ({ ...r, definicao: JSON.parse(r.definicao) }));
}

function fotografiaFechamento(id) {
  const f = db.prepare("SELECT id, resultado, criado_em FROM fotografia WHERE id_campanha = ? AND tipo = 'fechamento' ORDER BY id DESC LIMIT 1").get(Number(id));
  return f ? { id: f.id, criado_em: f.criado_em, resultado: JSON.parse(f.resultado) } : null;
}

/** Apuração "oficial" da campanha: congelada se encerrada (fechamento), senão ao vivo. */
export function apuracaoDaCampanha(camp, { referencia, recalcular = false } = {}) {
  if (camp.status === 'encerrada' && !recalcular && !referencia) {
    const f = fotografiaFechamento(camp.id);
    if (f) return { resultado: f.resultado, congelada: true, fotografia: { id: f.id, criado_em: f.criado_em } };
  }
  return { resultado: apurarComCache(camp.definicao, { referencia }), congelada: false, fotografia: null };
}

/** Movimento de posições em relação a N dias antes da referência. */
export function movimentos(camp, resultado, dias = 7) {
  const ref = resultado.tempo.referencia;
  const antes = addDias(ref > resultado.tempo.fim ? resultado.tempo.fim : ref, -dias);
  if (antes < resultado.tempo.inicio) return new Map();
  try {
    return movimentosEntre(resultado, apurarComCache(camp.definicao, { referencia: antes }));
  } catch {
    return new Map();
  }
}

export function resumoLista(camp) {
  if (!['ativa', 'encerrada'].includes(camp.status)) return null;
  try {
    const { resultado: r } = apuracaoDaCampanha(camp);
    return {
      tempo_status: r.tempo.status,
      progresso: r.tempo.progresso,
      restantes: r.tempo.restantes,
      total: r.tempo.total,
      referencia: r.tempo.referencia,
      calendario: r.tempo.calendario,
      atingimento_geral: r.resumo.atingimento_geral,
      atingimento_geral_proj: r.resumo.atingimento_geral_proj,
      participantes: r.resumo.participantes,
      atingiram: r.resumo.atingiram,
      no_ritmo: r.resumo.no_ritmo,
      atencao: r.resumo.atencao,
      risco: r.resumo.risco,
      nao_atingiu: r.resumo.nao_atingiu,
      premio_total: r.resumo.premio_total,
      premio_proj_total: r.resumo.premio_proj_total,
      orcamento: r.resumo.orcamento,
      frases: frasesCampanha(r),
    };
  } catch (e) {
    return { erro: e.message };
  }
}

function salvarDefinicao(definicao, statusDesejado) {
  const c = normalizarCampanha(definicao || {});
  const erros = validarCampanha(c);
  if (erros.length) throw erro(erros[0], 400, { erros });
  const status = ['rascunho', 'ativa', 'encerrada', 'arquivada'].includes(statusDesejado) ? statusDesejado : null;
  return { c, status };
}

export default function (app) {
  // ------------------------------------------------------------------ CRUD
  app.get('/api/campanhas', (req, res) => {
    const filtro = req.query.status ? String(req.query.status).split(',') : null;
    const linhas = db.prepare('SELECT * FROM campanha ORDER BY CASE status WHEN \'ativa\' THEN 0 WHEN \'rascunho\' THEN 1 WHEN \'encerrada\' THEN 2 ELSE 3 END, inicio DESC').all();
    res.json(
      linhas
        .filter((r) => !filtro || filtro.includes(r.status))
        .map((r) => {
          const definicao = JSON.parse(r.definicao);
          const camp = { ...r, definicao };
          return {
            id: r.id,
            nome: r.nome,
            fornecedor: r.fornecedor,
            status: r.status,
            inicio: r.inicio,
            fim: r.fim,
            cor: definicao.cor || null,
            descricao: definicao.descricao || '',
            nivel: definicao.participantes?.nivel || 'vendedor',
            n_criterios: definicao.criterios?.length || 0,
            premiacao: definicao.premiacao?.tipo || 'faixas',
            criado_em: r.criado_em,
            atualizado_em: r.atualizado_em,
            resumo: req.query.resumo === '0' ? null : resumoLista(camp),
          };
        }),
    );
  });

  app.get('/api/campanhas/:id', (req, res) => {
    const c = carregarCampanha(req.params.id);
    res.json({ id: c.id, status: c.status, definicao: c.definicao, criado_em: c.criado_em, atualizado_em: c.atualizado_em });
  });

  app.post('/api/campanhas', (req, res) => {
    const { c, status } = salvarDefinicao(req.body?.definicao, req.body?.status);
    // conta corrente: sem saldo para a reserva, a campanha não é ativada (erro 409, salvo exceção justificada)
    const verba = planejarVerba(c, { status: status || 'rascunho', excecao: req.body?.excecao_conta_corrente });
    const agora = agoraISO();
    const r = db
      .prepare('INSERT INTO campanha (nome, fornecedor, status, inicio, fim, definicao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.nome, c.fornecedor, status || 'rascunho', c.inicio, c.fim, JSON.stringify(c), agora, agora);
    res.json({ id: Number(r.lastInsertRowid), conta_corrente: aplicarVerba(Number(r.lastInsertRowid), c, verba) });
  });

  app.put('/api/campanhas/:id', (req, res) => {
    const atual = carregarCampanha(req.params.id);
    const { c, status } = salvarDefinicao(req.body?.definicao, req.body?.status);
    const verba = planejarVerba(c, { status: status || atual.status, idCampanha: atual.id, statusAnterior: atual.status, excecao: req.body?.excecao_conta_corrente });
    db.prepare('UPDATE campanha SET nome = ?, fornecedor = ?, status = ?, inicio = ?, fim = ?, definicao = ?, atualizado_em = ? WHERE id = ?').run(
      c.nome, c.fornecedor, status || atual.status, c.inicio, c.fim, JSON.stringify(c), agoraISO(), atual.id,
    );
    res.json({ ok: true, conta_corrente: aplicarVerba(atual.id, c, verba) });
  });

  app.delete('/api/campanhas/:id', (req, res) => {
    const c = carregarCampanha(req.params.id);
    aoExcluirCampanha(c.id);
    db.prepare('DELETE FROM fotografia WHERE id_campanha = ?').run(c.id);
    db.prepare('DELETE FROM campanha WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  app.post('/api/campanhas/:id/duplicar', (req, res) => {
    const c = carregarCampanha(req.params.id);
    const def = { ...c.definicao, nome: `${c.definicao.nome} (cópia)` };
    const agora = agoraISO();
    const r = db
      .prepare('INSERT INTO campanha (nome, fornecedor, status, inicio, fim, definicao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(def.nome, c.fornecedor, 'rascunho', c.inicio, c.fim, JSON.stringify(def), agora, agora);
    res.json({ id: Number(r.lastInsertRowid) });
  });

  app.post('/api/campanhas/:id/status', (req, res) => {
    const c = carregarCampanha(req.params.id);
    const status = String(req.body?.status || '');
    if (!['rascunho', 'ativa', 'encerrada', 'arquivada'].includes(status)) throw erro('Situação inválida.');
    const verba = planejarVerba(c.definicao, { status, idCampanha: c.id, statusAnterior: c.status, excecao: req.body?.excecao_conta_corrente });
    db.prepare('UPDATE campanha SET status = ?, atualizado_em = ? WHERE id = ?').run(status, agoraISO(), c.id);
    res.json({ ok: true, conta_corrente: aplicarVerba(c.id, c.definicao, verba) });
  });

  app.post('/api/campanhas/:id/encerrar', (req, res) => {
    const c = carregarCampanha(req.params.id);
    const r = apurarComCache(c.definicao);
    const f = db
      .prepare('INSERT INTO fotografia (id_campanha, tipo, observacao, data_referencia, resultado, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, 'fechamento', String(req.body?.observacao || 'Fechamento da campanha'), r.tempo.referencia, JSON.stringify(r), agoraISO());
    db.prepare("UPDATE campanha SET status = 'encerrada', atualizado_em = ? WHERE id = ?").run(agoraISO(), c.id);
    const verba = aoEncerrarCampanha(c.id, c.definicao, r, Number(f.lastInsertRowid));
    res.json({ ok: true, id_fotografia: Number(f.lastInsertRowid), conta_corrente: verba });
  });

  // ------------------------------------------------------------------ apuração
  app.get('/api/campanhas/:id/apuracao', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    const referencia = /^\d{4}-\d{2}-\d{2}$/.test(req.query.referencia || '') ? req.query.referencia : undefined;
    const { resultado, congelada, fotografia } = apuracaoDaCampanha(camp, { referencia, recalcular: req.query.recalcular === '1' });
    let participantes = resultado.participantes;
    const dias = Number(req.query.comparar || 0);
    if (dias > 0 && !congelada) {
      const mov = movimentos(camp, resultado, dias);
      participantes = participantes.map((l) => (mov.has(l.chave) ? { ...l, posicao_anterior: l.posicao + mov.get(l.chave), movimento: mov.get(l.chave) } : { ...l }));
    }
    res.json({ ...resultado, participantes, frases: frasesCampanha(resultado), congelada, fotografia, id_campanha: camp.id, status_campanha: camp.status });
  });

  app.post('/api/apuracao/previa', (req, res) => {
    const referencia = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.referencia || '') ? req.body.referencia : undefined;
    const r = apurarComCache(req.body?.definicao || {}, { referencia, efemero: true }); // edição: sempre ao vivo, não grava
    res.json({ ...r, frases: frasesCampanha(r) });
  });

  // Data de referência das rotas de detalhe: a pedida pelo front ("ver posição em"),
  // ou o fim do período para campanhas encerradas (equivale à apuração congelada).
  const refDetalhe = (req, camp) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.referencia || '')) return req.query.referencia;
    return camp.status === 'encerrada' ? camp.fim : undefined;
  };

  // Detalhe, boletim e Excel: lidos prontos da pipeline (server/etapas/apuracao.js); calcula na hora só se ainda não houver.
  const padrao = (req) => !req.query.referencia;

  app.get('/api/campanhas/:id/participantes/:chave', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    if (padrao(req) && !req.query.criterio) {
      const pronto = lerDetalhe(camp, 'participante', req.params.chave);
      if (pronto) return res.json(pronto);
    }
    const r = apurarComCache(camp.definicao, { referencia: refDetalhe(req, camp) });
    const det = detalharParticipante(r, req.params.chave, req.query.criterio);
    if (!det) throw erro('Participante não encontrado nesta campanha.', 404);
    const mov = movimentos(camp, r, 7);
    const linha = r.participantes.find((l) => l.chave === String(req.params.chave));
    res.json({ ...det, boletim: boletimParticipante(r, linha, { idCampanha: camp.id, movimentos: mov }) });
  });

  app.get('/api/campanhas/:id/estoque', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    res.json(estoqueDaCampanha(apurarComCache(camp.definicao)));
  });

  app.get('/api/campanhas/:id/excel', async (req, res) => {
    const camp = carregarCampanha(req.params.id);
    const { gerarExcelCampanha } = await import('../exportar.js');
    const pronto = arquivoExcel(chaveDetalhe(camp, refDetalhePadrao(camp)));
    // apuração com o detalhe interno (necessário para exportar as linhas de venda consideradas)
    const buf = pronto ? fs.readFileSync(pronto) : await gerarExcelCampanha(camp, apurarComCache(camp.definicao, { referencia: refDetalhePadrao(camp) }));
    const nome = `${camp.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(Buffer.from(buf));
  });

  // ------------------------------------------------------------------ fotografias
  app.get('/api/campanhas/:id/fotografias', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    res.json(db.prepare('SELECT id, tipo, observacao, data_referencia, criado_em FROM fotografia WHERE id_campanha = ? ORDER BY id DESC').all(camp.id));
  });

  app.post('/api/campanhas/:id/fotografias', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    const referencia = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.referencia || req.query.referencia || '') ? req.body?.referencia || req.query.referencia : undefined;
    const r = apurarComCache(camp.definicao, { referencia });
    const f = db
      .prepare('INSERT INTO fotografia (id_campanha, tipo, observacao, data_referencia, resultado, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .run(camp.id, 'manual', String(req.body?.observacao || ''), r.tempo.referencia, JSON.stringify(r), agoraISO());
    res.json({ id: Number(f.lastInsertRowid) });
  });

  app.get('/api/fotografias/:id', (req, res) => {
    const f = db.prepare('SELECT * FROM fotografia WHERE id = ?').get(Number(req.params.id));
    if (!f) throw erro('Fotografia não encontrada.', 404);
    res.json({ ...JSON.parse(f.resultado), congelada: true, fotografia: { id: f.id, tipo: f.tipo, observacao: f.observacao, criado_em: f.criado_em }, id_campanha: f.id_campanha });
  });

  // ------------------------------------------------------------------ boletins (informação por participante)
  app.get('/api/campanhas/:id/boletins', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    const r = apurarComCache(camp.definicao, { referencia: refDetalhe(req, camp) });
    if (padrao(req)) {
      const prontos = filtrarLinhas(r.participantes, String(req.query.filtro || 'todos')).map((l) => lerDetalhe(camp, 'boletim', l.chave));
      if (prontos.every(Boolean)) return res.json(prontos);
    }
    res.json(boletins(r, { filtro: String(req.query.filtro || 'todos'), idCampanha: camp.id, movimentos: movimentos(camp, r, 7) }));
  });

  app.get('/api/campanhas/:id/boletins/:chave', (req, res) => {
    const camp = carregarCampanha(req.params.id);
    if (padrao(req)) {
      const pronto = lerDetalhe(camp, 'boletim', req.params.chave);
      if (pronto) return res.json(pronto);
    }
    const r = apurarComCache(camp.definicao, { referencia: refDetalhe(req, camp) });
    const linha = r.participantes.find((l) => l.chave === String(req.params.chave));
    if (!linha) throw erro('Participante não encontrado nesta campanha.', 404);
    res.json(boletimParticipante(r, linha, { idCampanha: camp.id, movimentos: movimentos(camp, r, 7) }));
  });
}
