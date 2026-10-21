import { db } from '../db.js';
import {
  atualizarLancamento, baixarVencidas, coberturaDe, contaPorId, criarLancamento, detalheConta, estornarLancamento, extrato, listarFabricantes,
  ORIGENS, POLITICAS, salvarConta, simularCampanha, SITUACAO_CONTA, verbaDaCampanha, visaoGeral,
} from '../contacorrente.js';

export default function (app) {
  app.get('/api/conta-corrente', (req, res) => {
    res.json({ ...visaoGeral(), origens: ORIGENS, politicas: POLITICAS, situacoes: SITUACAO_CONTA });
  });

  app.get('/api/conta-corrente/fabricantes', (req, res) => res.json(listarFabricantes()));

  app.get('/api/conta-corrente/saldo', (req, res) => {
    const fabricante = String(req.query.fabricante || '').trim();
    if (!fabricante) return res.status(400).json({ erro: 'Informe o fabricante.' });
    res.json(coberturaDe(fabricante, Math.max(0, Number(req.query.valor) || 0)));
  });

  app.post('/api/conta-corrente/simular', (req, res) => {
    res.json(simularCampanha(req.body?.definicao || {}, req.body?.id_campanha ? Number(req.body.id_campanha) : null));
  });

  app.get('/api/conta-corrente/campanhas/:id', (req, res) => res.json(verbaDaCampanha(req.params.id)));

  app.get('/api/conta-corrente/contas/:id', (req, res) => res.json(detalheConta(req.params.id)));

  app.get('/api/conta-corrente/contas/:id/extrato', (req, res) => res.json(extrato(req.params.id, req.query)));

  app.post('/api/conta-corrente/contas', (req, res) => res.json(salvarConta(null, req.body || {})));

  app.put('/api/conta-corrente/contas/:id', (req, res) => res.json(salvarConta(Number(req.params.id), req.body || {})));

  app.post('/api/conta-corrente/contas/:id/lancamentos', (req, res) => {
    res.json({ id: criarLancamento(Number(req.params.id), req.body || {}) });
  });

  app.post('/api/conta-corrente/contas/:id/baixar-vencidas', (req, res) => {
    contaPorId(req.params.id);
    res.json({ id: baixarVencidas(Number(req.params.id)) });
  });

  app.put('/api/conta-corrente/lancamentos/:id', (req, res) => res.json(atualizarLancamento(Number(req.params.id), req.body || {})));

  app.post('/api/conta-corrente/lancamentos/:id/estornar', (req, res) => {
    res.json({ id: estornarLancamento(Number(req.params.id), req.body?.motivo) });
  });
}

/** Primeira execução: cria as contas de exemplo (acordos, NDs, uso histórico e reservas das campanhas). */
export function iniciar() {
  if (db.prepare('SELECT 1 FROM cc_conta LIMIT 1').get()) return;
  setTimeout(async () => {
    try {
      const { recriarContaCorrenteExemplo } = await import('../contacorrente-exemplo.js');
      recriarContaCorrenteExemplo({ log: (m) => console.log(`[conta corrente] ${m}`) });
    } catch (e) {
      console.error('[conta corrente] falha ao criar dados iniciais:', e);
    }
  }, 4000);
}
