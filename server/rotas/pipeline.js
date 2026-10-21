import { dispararPipeline, iniciarPipeline, resumoPipeline, statusPipeline } from '../pipeline.js';

export default function (app) {
  app.get('/api/pipeline', (req, res) => res.json(statusPipeline()));
  // leve, para o indicador do topo (consultado a cada poucos segundos)
  app.get('/api/pipeline/resumo', (req, res) => res.json(resumoPipeline()));

  // Processar agora: { forcar?: true } refaz tudo mesmo com assinatura igual
  app.post('/api/pipeline/executar', (req, res) => {
    dispararPipeline('manual', null, { forcar: Boolean(req.body?.forcar), atraso: 100 });
    res.json({ ok: true, ...statusPipeline() });
  });
}

export async function iniciar() {
  if (process.env.PIPELINE_DESLIGADA === '1') return;
  await iniciarPipeline();
}
