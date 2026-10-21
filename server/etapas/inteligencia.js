import { hojeISO } from '../calendario.js';
import { assinaturaBase, hash, registrarEtapa } from '../pipeline.js';
import { assinaturaConhecimento, atualizarConhecimentoAgora } from '../conhecimento.js';
import { atualizarInsightsProntos } from '../insights.js';
import { assinaturaPlanos, atualizarPlanosProntos } from '../planos.js';
import { db } from '../db.js';

// =====================================================================
// Etapas da inteligência comercial. Cada uma grava o resultado em tabela e as rotas só leem o pronto.
//   insights      alertas por regra de cada campanha ativa (insight_pronto)
//   planos        plano de ataque por vendedor e resumo por equipe (plano_pronto), com insumos
//                 reaproveitáveis em plano_insumo (taxas, associações, ticket, penetração, oportunidades)
//   conhecimento  perfis de cliente, backtest, conversões e a base de fatos validados da IA; no fim
//                 atualiza os planos que dependem dos perfis novos (só os que mudaram)
// =====================================================================

const assinaturaInsights = () => {
  const camp = db.prepare("SELECT group_concat(id || '@' || atualizado_em, ',') AS s FROM (SELECT id, atualizado_em FROM campanha WHERE status = 'ativa' ORDER BY id)").get()?.s || '';
  const disparo = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM disparo').get().m;
  return `${assinaturaBase()}|${hojeISO()}|${hash(camp)}|${disparo}`;
};

registrarEtapa({
  nome: 'insights',
  descricao: 'Alertas automáticos das campanhas',
  depende: ['apuracao'],
  gatilhos: ['importacao', 'dia', 'campanha'],
  ordem: 30,
  assinatura: assinaturaInsights,
  executar: (ctx) => atualizarInsightsProntos({ forcar: ctx.forcar, pausa: ctx.pausa }),
});

registrarEtapa({
  nome: 'planos',
  descricao: 'Planos de ataque por vendedor e equipe',
  depende: ['apuracao'],
  gatilhos: ['importacao', 'dia', 'campanha', 'plano'],
  ordem: 40,
  assinatura: assinaturaPlanos,
  executar: (ctx) => atualizarPlanosProntos({ forcar: ctx.forcar, pausa: ctx.pausa, log: ctx.log }),
});

registrarEtapa({
  nome: 'conhecimento',
  descricao: 'Perfis de cliente, conversões e base de fatos da IA',
  depende: ['apuracao'],
  gatilhos: ['importacao', 'dia', 'campanha'],
  ordem: 60, // a mais demorada fica por último: planos e alertas não esperam por ela
  assinatura: assinaturaConhecimento,
  executar: async (ctx) => {
    const r = await atualizarConhecimentoAgora({ forcar: ctx.forcar });
    const p = await atualizarPlanosProntos({ pausa: ctx.pausa, log: ctx.log }); // perfis e taxas novos mudam a assinatura dos planos
    return { linhas: (r?.fatos || 0) + p.linhas };
  },
});
