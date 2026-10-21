import { dispararPipeline } from '../pipeline.js';
import { gerarInsights, contarInsights } from '../insights.js';
import {
  conhecimentoDesatualizado, listarFatos, listarVerificacoes, recuperarFatos, resumoConhecimento,
} from '../conhecimento.js';
import { analisar, estimarAnalise, listarAnalises, obterAnalise, perguntar, roteiro, statusIaDetalhado } from '../ia.js';
import { lerEquipe, lerGeral, lerPlano, listarRecomendacoes, registrarPlano, resumoRecomendacoes, TIPOS_PLANO } from '../planos.js';
import { SEGMENTOS_RFV } from '../perfil.js';

// Central de insights, base de conhecimento, IA e planos de ataque.

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

export default function registrar(app) {
  // ---------------- insights e qualidade
  app.get('/api/insights', (req, res) => {
    res.json(gerarInsights({ campanhaId: req.query.campanha || undefined, severidades: req.query.severidade }));
  });
  app.get('/api/insights/resumo', (req, res) => res.json(contarInsights()));
  app.get('/api/qualidade-dados', (req, res) => res.json(listarVerificacoes()));

  // ---------------- base de conhecimento
  app.get('/api/conhecimento/resumo', (req, res) => {
    if (conhecimentoDesatualizado()) dispararPipeline('dia', { origem: 'conhecimento' });
    res.json(resumoConhecimento());
  });
  app.get('/api/conhecimento/fatos', (req, res) => {
    const validados = req.query.validados === '1' ? true : req.query.validados === '0' ? false : undefined;
    res.json(listarFatos({ escopo: req.query.escopo || undefined, chave: req.query.chave || undefined, q: req.query.q || undefined, id: req.query.id || undefined, limite: Number(req.query.limite) || 50, validados }));
  });
  app.get('/api/conhecimento/recuperar', (req, res) => {
    res.json(recuperarFatos({ pergunta: String(req.query.q || ''), contexto: { campanha: req.query.campanha, vendedor: req.query.vendedor }, limite: Number(req.query.limite) || 30 }));
  });
  app.post('/api/conhecimento/atualizar', async (req, res) => {
    // não bloqueia: a pipeline atualiza em segundo plano (a tela acompanha pelo resumo)
    dispararPipeline('manual', { origem: 'conhecimento' }, { forcar: Boolean(req.body?.forcar), atraso: 200 });
    res.json({ disparado: true });
  });

  // ---------------- IA
  app.get('/api/ia/status', (req, res) => res.json(statusIaDetalhado()));
  app.get('/api/ia/estimativa', async (req, res) => {
    res.json(await estimarAnalise({ tipo: req.query.tipo || 'geral', referencia: req.query.referencia || undefined }));
  });
  app.post('/api/ia/analisar', async (req, res) => {
    const { tipo = 'geral', referencia, forcar = false } = req.body || {};
    res.json(await analisar({ tipo, referencia: referencia ?? undefined, forcar: Boolean(forcar) }));
  });
  app.get('/api/ia/analises', (req, res) => {
    res.json(listarAnalises({ tipo: req.query.tipo || undefined, referencia: req.query.referencia ?? undefined, limite: Number(req.query.limite) || 20 }));
  });
  app.get('/api/ia/analises/:id', (req, res) => res.json(obterAnalise(req.params.id)));
  app.post('/api/ia/perguntar', (req, res) => perguntar(req.body || {}, res));
  app.post('/api/ia/roteiro', async (req, res) => {
    const { vendedor, itens = [], campanha } = req.body || {};
    if (!vendedor) throw erro('Informe o vendedor.');
    res.json(await roteiro({ vendedor, itens, campanha }));
  });

  // ---------------- planos de ataque e retroalimentação
  app.get('/api/planos/tipos', (req, res) => res.json({ tipos: TIPOS_PLANO, segmentos_rfv: SEGMENTOS_RFV }));
  app.get('/api/planos/geral', (req, res) => res.json(lerGeral()));
  app.get('/api/planos/equipe', (req, res) => {
    if (!req.query.equipe) throw erro('Informe a equipe.');
    res.json(lerEquipe(req.query.equipe));
  });
  app.get('/api/planos', (req, res) => {
    if (!req.query.vendedor) throw erro('Informe o vendedor.');
    res.json(lerPlano({ vendedor: req.query.vendedor, campanha: req.query.campanha || undefined, limite: Number(req.query.limite) || 60 }));
  });
  app.post('/api/planos/registrar', (req, res) => {
    const { vendedor, campanha, itens = [] } = req.body || {};
    if (!vendedor) throw erro('Informe o vendedor.');
    if (!Array.isArray(itens) || !itens.length) throw erro('Selecione ao menos um item do plano.');
    res.json(registrarPlano({ vendedor, campanha, itens }));
  });
  app.get('/api/recomendacoes', (req, res) => res.json(listarRecomendacoes({ status: req.query.status || undefined, vendedor: req.query.vendedor || undefined })));
  app.get('/api/recomendacoes/resumo', (req, res) => res.json(resumoRecomendacoes()));
}

// Base de conhecimento, alertas e planos são calculados pela pipeline (server/etapas/inteligencia.js).
