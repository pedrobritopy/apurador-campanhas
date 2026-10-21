// Avisa a pipeline de dados quando algo que muda os números é gravado (não precisa mexer em cada rota).
// O nome começa com "_" para este middleware ser registrado antes das outras rotas.
import { dispararPipeline } from '../pipeline.js';

const REGRAS = [
  { re: /^\/api\/campanhas(\/(\d+))?(\/(status|encerrar|duplicar))?$/, evento: 'campanha', extra: ['conta_corrente'] },
  { re: /^\/api\/conta-corrente\/(?!simular)/, evento: 'conta_corrente' },
  { re: /^\/api\/config$/, evento: 'config' },
  { re: /^\/api\/(planos|plano|recomendacoes)(\/|$)/, evento: 'plano' },
  // /api/territorios/medir só mede um desenho, não grava nada (as rotas de território já avisam a pipeline)
  { re: /^\/api\/territorios(\/(?!medir)|$)/, evento: 'territorio' },
  { re: /^\/api\/receita(\/|$)/, evento: 'receita' },
  { re: /^\/api\/carteiras(\/|$)/, evento: 'carteira' },
  { re: /^\/api\/importar(\/|$)/, evento: 'importacao' },
];

export default function (app) {
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    const caminho = `/api${req.path}`;
    const regra = REGRAS.find((r) => r.re.test(caminho));
    if (regra) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        const id = regra.evento === 'campanha' ? Number(caminho.match(/\/api\/campanhas\/(\d+)/)?.[1]) || null : null;
        dispararPipeline(regra.evento, id ? { id } : null);
        for (const e of regra.extra || []) dispararPipeline(e);
      });
    }
    next();
  });
}
