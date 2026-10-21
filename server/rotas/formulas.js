import { listarFormulas, criarFormula, atualizarFormula, excluirFormula, registrarUsoFormula } from '../formulas.js';
import { gerarFormula } from '../ia.js';

// Biblioteca de fórmulas (prontas + do usuário) e geração de fórmula por IA a partir de linguagem natural.
//   GET    /api/formulas                 → [{ id, nome, descricao, expressao, formato, totalizar, sentido, categoria, origem, usos, ... }]
//   POST   /api/formulas                 { nome, descricao, expressao, formato, totalizar, sentido, categoria, origem?, pedido_ia? } → { id }
//   PUT    /api/formulas/:id             (não altera as prontas)
//   DELETE /api/formulas/:id
//   POST   /api/formulas/:id/uso         conta um uso (ao aplicar num critério)
//   POST   /api/ia/formula               { pedido, expressao_atual? } → { resultado: { expressao, nome, descricao, formato, totalizar, sentido, explicacao, suposicoes }, valida, erro_validacao, custo_usd }
export default function (app) {
  app.get('/api/formulas', (req, res) => res.json(listarFormulas()));
  app.post('/api/formulas', (req, res) => res.json(criarFormula(req.body || {})));
  app.put('/api/formulas/:id', (req, res) => res.json(atualizarFormula(req.params.id, req.body || {})));
  app.delete('/api/formulas/:id', (req, res) => res.json(excluirFormula(req.params.id)));
  app.post('/api/formulas/:id/uso', (req, res) => {
    registrarUsoFormula(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/ia/formula', async (req, res) => {
    res.json(await gerarFormula({ pedido: req.body?.pedido, expressaoAtual: req.body?.expressao_atual }));
  });
}
