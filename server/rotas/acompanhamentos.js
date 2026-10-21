import { db, agoraISO } from '../db.js';
import { apurarComCache } from '../motor.js';
import { gerarMensagens, listarModelos, obterModelo, VARIAVEIS_MENSAGEM, baseUrlPublica } from '../mensagens.js';
import { enviarMensagens, executarAgendamento, proximaExecucao } from '../disparos.js';
import { carregarCampanha, movimentos } from './campanhas.js';

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const DESTINOS = ['participantes', 'gerentes', 'geral'];
const CANAIS = ['whatsapp', 'email', 'webhook', 'registro'];
const FILTROS = ['todos', 'risco', 'nao_atingiu', 'atingiu', 'perto_faixa'];

function montarMensagens(req) {
  const camp = carregarCampanha(req.params.id);
  const b = req.body || {};
  const modelo = b.id_modelo ? obterModelo(b.id_modelo) : null;
  if (b.id_modelo && !modelo) throw erro('Modelo de mensagem não encontrado.', 404);
  const corpo = b.corpo ?? modelo?.corpo;
  if (!String(corpo || '').trim()) throw erro('Escolha um modelo ou escreva a mensagem.');
  const destino = DESTINOS.includes(b.destino) ? b.destino : modelo?.destino || 'participantes';
  const r = apurarComCache(camp.definicao);
  const itens = gerarMensagens(camp, r, {
    destino,
    filtro: FILTROS.includes(b.filtro) ? b.filtro : 'todos',
    chaves: Array.isArray(b.chaves) && b.chaves.length ? b.chaves : undefined,
    corpo,
    assunto: b.assunto ?? modelo?.assunto,
    baseUrl: baseUrlPublica(req),
    movimentos: destino === 'participantes' ? movimentos(camp, r, 7) : undefined,
    lista: b.lista,
  });
  return { camp, itens };
}

function linhaAgendamento(a) {
  const camp = a.id_campanha ? db.prepare('SELECT nome FROM campanha WHERE id = ?').get(a.id_campanha) : null;
  const modelo = db.prepare('SELECT nome FROM modelo_mensagem WHERE id = ?').get(a.id_modelo);
  return {
    ...a,
    ativo: Boolean(a.ativo),
    dias_semana: String(a.dias_semana || '').split(',').filter(Boolean).map(Number),
    campanha: camp?.nome || (a.id_campanha ? '(campanha excluída)' : 'Todas as campanhas ativas'),
    modelo: modelo?.nome || '(modelo excluído)',
    proxima_execucao: proximaExecucao(a),
  };
}

function lerAgendamento(b = {}) {
  if (!String(b.nome || '').trim()) throw erro('Dê um nome para o agendamento.');
  if (!b.id_modelo || !obterModelo(b.id_modelo)) throw erro('Escolha um modelo de mensagem.');
  const dias = (Array.isArray(b.dias_semana) ? b.dias_semana : String(b.dias_semana || '').split(',')).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!dias.length) throw erro('Escolha pelo menos um dia da semana.');
  if (!/^\d{2}:\d{2}$/.test(String(b.hora || ''))) throw erro('Hora inválida (use HH:MM).');
  return {
    nome: String(b.nome).trim(),
    id_campanha: b.id_campanha ? Number(b.id_campanha) : null,
    id_modelo: Number(b.id_modelo),
    canal: CANAIS.includes(b.canal) ? b.canal : 'registro',
    filtro: FILTROS.includes(b.filtro) ? b.filtro : 'todos',
    lista: b.lista ? String(b.lista) : null,
    dias_semana: [...new Set(dias)].sort().join(','),
    hora: b.hora,
    ativo: b.ativo === false ? 0 : 1,
  };
}

export default function (app) {
  // ------------------------------------------------------------------ modelos
  app.get('/api/modelos-mensagem', (req, res) => res.json(listarModelos()));
  app.post('/api/modelos-mensagem', (req, res) => {
    const { nome, destino = 'participantes', assunto = '', corpo } = req.body || {};
    if (!String(nome || '').trim() || !String(corpo || '').trim()) throw erro('Informe nome e texto do modelo.');
    const r = db.prepare('INSERT INTO modelo_mensagem (nome, destino, assunto, corpo, criado_em) VALUES (?, ?, ?, ?, ?)').run(String(nome).trim(), DESTINOS.includes(destino) ? destino : 'participantes', assunto, corpo, agoraISO());
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/modelos-mensagem/:id', (req, res) => {
    const { nome, destino = 'participantes', assunto = '', corpo } = req.body || {};
    if (!obterModelo(req.params.id)) throw erro('Modelo não encontrado.', 404);
    db.prepare('UPDATE modelo_mensagem SET nome = ?, destino = ?, assunto = ?, corpo = ? WHERE id = ?').run(String(nome).trim(), DESTINOS.includes(destino) ? destino : 'participantes', assunto, corpo, Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/modelos-mensagem/:id', (req, res) => {
    db.prepare('DELETE FROM modelo_mensagem WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/variaveis-mensagem', (req, res) => res.json(VARIAVEIS_MENSAGEM));

  // ------------------------------------------------------------------ prévia e disparo
  app.post('/api/campanhas/:id/mensagens/previa', (req, res) => {
    res.json(montarMensagens(req).itens);
  });

  app.post('/api/campanhas/:id/disparos', async (req, res) => {
    const { camp, itens } = montarMensagens(req);
    const canal = CANAIS.includes(req.body?.canal) ? req.body.canal : 'registro';
    res.json(await enviarMensagens(itens, { canal, idCampanha: camp.id, campanhaNome: camp.nome }));
  });

  app.get('/api/disparos', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.campanha) {
      where.push('d.id_campanha = ?');
      params.push(Number(req.query.campanha));
    }
    if (req.query.canal) {
      where.push('d.canal = ?');
      params.push(String(req.query.canal));
    }
    if (req.query.status) {
      where.push('d.status = ?');
      params.push(String(req.query.status));
    }
    const limite = Math.min(2000, Number(req.query.limite) || 200);
    res.json(
      db
        .prepare(
          `SELECT d.*, c.nome AS campanha FROM disparo d LEFT JOIN campanha c ON c.id = d.id_campanha
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.id DESC LIMIT ${limite}`,
        )
        .all(...params),
    );
  });

  app.post('/api/disparos/:id/marcar', (req, res) => {
    const status = ['enviado', 'pendente', 'erro'].includes(req.body?.status) ? req.body.status : 'enviado';
    db.prepare('UPDATE disparo SET status = ? WHERE id = ?').run(status, Number(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ agendamentos
  app.get('/api/agendamentos', (req, res) => res.json(db.prepare('SELECT * FROM agendamento ORDER BY id').all().map(linhaAgendamento)));
  app.post('/api/agendamentos', (req, res) => {
    const a = lerAgendamento(req.body);
    const r = db
      .prepare('INSERT INTO agendamento (nome, id_campanha, id_modelo, canal, filtro, lista, dias_semana, hora, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.nome, a.id_campanha, a.id_modelo, a.canal, a.filtro, a.lista, a.dias_semana, a.hora, a.ativo, agoraISO());
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/agendamentos/:id', (req, res) => {
    const a = lerAgendamento(req.body);
    db.prepare('UPDATE agendamento SET nome = ?, id_campanha = ?, id_modelo = ?, canal = ?, filtro = ?, lista = ?, dias_semana = ?, hora = ?, ativo = ? WHERE id = ?').run(
      a.nome, a.id_campanha, a.id_modelo, a.canal, a.filtro, a.lista, a.dias_semana, a.hora, a.ativo, Number(req.params.id),
    );
    res.json({ ok: true });
  });
  app.delete('/api/agendamentos/:id', (req, res) => {
    db.prepare('DELETE FROM agendamento WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/agendamentos/:id/executar', async (req, res) => {
    res.json(await executarAgendamento(req.params.id));
  });
}
