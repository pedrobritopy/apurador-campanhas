import { db } from '../db.js';
import { apurarComCache, dataReferencia } from '../motor.js';
import { hojeISO } from '../calendario.js';
import { frasesCampanha } from '../narrativa.js';
import { chamarOpcional } from '../opcional.js';

export default function (app) {
  app.get('/api/painel', async (req, res) => {
    const ativas = db.prepare("SELECT * FROM campanha WHERE status = 'ativa' ORDER BY fim").all().map((r) => ({ ...r, definicao: JSON.parse(r.definicao) }));
    const campanhas = [];
    const ranking = new Map();
    const kpis = { campanhas_ativas: 0, participantes: 0, atingiram: 0, em_risco: 0, premio_total: 0, premio_proj_total: 0, orcamento_total: 0, premio_proj_orcado: 0, faturamento_campanhas: 0, alertas_criticos: 0 };

    for (const camp of ativas) {
      let r;
      try {
        r = apurarComCache(camp.definicao);
      } catch (e) {
        campanhas.push({ id: camp.id, nome: camp.nome, erro: e.message });
        continue;
      }
      const emAndamento = r.tempo.status === 'andamento';
      if (emAndamento) {
        kpis.campanhas_ativas++;
        kpis.participantes += r.resumo.participantes;
        kpis.atingiram += r.resumo.atingiram;
        kpis.em_risco += r.resumo.risco + r.resumo.atencao;
        kpis.premio_total += r.resumo.premio_total;
        kpis.premio_proj_total += r.resumo.premio_proj_total;
        kpis.orcamento_total += r.resumo.orcamento || 0;
        if (r.resumo.orcamento) kpis.premio_proj_orcado += r.resumo.premio_proj_total; // uso do orçamento só onde há orçamento
        kpis.faturamento_campanhas += r.criterios.reduce((a, c) => a + (c.total.valor || 0), 0);
      }
      const c0 = r.criterios[0];
      campanhas.push({
        id: camp.id,
        nome: r.campanha.nome,
        fornecedor: r.campanha.fornecedor,
        cor: r.campanha.cor,
        status: camp.status,
        nivel: r.campanha.participantes.nivel,
        nivel_rotulo: r.campanha.nivel_rotulo,
        premiacao: r.campanha.premiacao.tipo,
        tempo: { status: r.tempo.status, progresso: r.tempo.progresso, restantes: r.tempo.restantes, total: r.tempo.total, decorridos: r.tempo.decorridos, calendario: r.tempo.calendario, inicio: r.tempo.inicio, fim: r.tempo.fim, referencia: r.tempo.referencia, dias_para_inicio: r.tempo.dias_para_inicio },
        criterios: r.criterios.map((c) => ({ id: c.id, nome: c.nome, formato: c.formato, unidade: c.unidade, realizado: c.total.realizado, meta: c.total.meta, atingimento: c.total.atingimento, projecao: c.total.projecao, atingimento_proj: c.total.atingimento_proj, variacao_proj: c.total.variacao_proj })),
        resumo: r.resumo,
        frases: frasesCampanha(r),
        serie: c0 ? { dias: r.tempo.dias, realizado: c0.serie.realizado, meta: c0.serie.meta, projecao: c0.serie.projecao, formato: c0.formato, nome: c0.nome } : null,
        lideres: r.participantes.slice(0, 3).map((l) => ({ chave: l.chave, nome: l.nome, foto: l.foto || null, score: l.score, realizado: l.criterios[0]?.realizado, premio_proj: l.premio_proj, status: l.status })),
      });
      if (emAndamento && r.campanha.participantes.nivel === 'vendedor') {
        for (const l of r.participantes) {
          if (l.score == null) continue;
          const g = ranking.get(l.chave) || { chave: l.chave, nome: l.nome, foto: l.foto || null, equipe: l.grupo, campanhas: 0, soma_score: 0, premio_proj: 0, atingiu: 0 };
          g.campanhas++;
          g.soma_score += Math.min(l.score, 200);
          g.premio_proj += l.premio_proj || 0;
          if (l.status === 'atingiu') g.atingiu++;
          ranking.set(l.chave, g);
        }
      }
    }

    const insights = (await chamarOpcional('./insights.js', 'gerarInsights', [{}], [])) || [];
    const alertas = insights.filter((i) => ['critica', 'alta', 'media', 'positiva'].includes(i.severidade)).slice(0, 10);
    kpis.alertas_criticos = insights.filter((i) => ['critica', 'alta'].includes(i.severidade)).length;
    for (const c of campanhas) c.alertas = insights.filter((i) => Number(i.campanha_id) === c.id && i.severidade !== 'positiva').length;

    const atividade = [
      ...db.prepare("SELECT 'disparo' AS tipo, d.canal, d.status, d.destinatario, c.nome AS campanha, d.criado_em FROM disparo d LEFT JOIN campanha c ON c.id = d.id_campanha ORDER BY d.id DESC LIMIT 8").all()
        .map((d) => ({ tipo: 'disparo', texto: `Acompanhamento ${d.canal === 'whatsapp' ? 'por WhatsApp' : d.canal === 'email' ? 'por e-mail' : d.canal === 'webhook' ? 'por webhook' : 'registrado'} para ${d.destinatario}${d.campanha ? ` · ${d.campanha}` : ''}`, criado_em: d.criado_em, status: d.status })),
      ...db.prepare('SELECT tabela, arquivo, linhas, criado_em FROM importacao ORDER BY id DESC LIMIT 3').all()
        .map((i) => ({ tipo: 'importacao', texto: `Importação de ${i.tabela}: ${Number(i.linhas).toLocaleString('pt-BR')} linhas`, criado_em: i.criado_em })),
      ...db.prepare('SELECT nome, status, atualizado_em FROM campanha ORDER BY atualizado_em DESC LIMIT 4').all()
        .map((c) => ({ tipo: 'campanha', texto: `Campanha "${c.nome}" atualizada (${c.status})`, criado_em: c.atualizado_em })),
    ].sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))).slice(0, 12);

    res.json({
      hoje: hojeISO(),
      referencia: dataReferencia('data_pedido'),
      kpis,
      campanhas,
      encerrando: campanhas.filter((c) => c.tempo?.status === 'andamento' && c.tempo.restantes <= 5).map((c) => ({ id: c.id, nome: c.nome, restantes: c.tempo.restantes, atingimento_proj: c.resumo.atingimento_geral_proj })),
      alertas,
      ranking_geral: [...ranking.values()]
        .map((g) => ({ chave: g.chave, nome: g.nome, foto: g.foto, equipe: g.equipe, campanhas: g.campanhas, media_score: g.soma_score / g.campanhas, premio_proj: g.premio_proj, atingiu: g.atingiu }))
        .sort((a, b) => b.media_score - a.media_score)
        .slice(0, 15),
      atividade,
    });
  });
}
