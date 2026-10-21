// Etapas de apuração: o coração da pipeline. Tudo que as telas de campanha mostram sai daqui pronto.
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { addDias, hojeISO } from '../calendario.js';
import { apurarComCache, chaveApuracao, detalharParticipante, limparApuracoesVelhas } from '../motor.js';
import { boletins, movimentosEntre } from '../narrativa.js';
import { assinaturaBase, assinaturaCampanhas, hash, registrarEtapa } from '../pipeline.js';
import { PASTA_EXCEL, gravarDetalhes, limparDetalhes, refDetalhePadrao, temDetalhes } from '../prontos.js';

const campanhas = () =>
  db.prepare("SELECT id, nome, status, inicio, fim, definicao FROM campanha WHERE status IN ('ativa','encerrada') ORDER BY id").all()
    .map((c) => ({ ...c, definicao: JSON.parse(c.definicao) }));

const assinatura = () => hash(assinaturaBase(), hojeISO(), assinaturaCampanhas());

/** Referência de 7 dias antes (movimento no ranking), como em rotas/campanhas.js#movimentos. */
function refAnterior(r, dias = 7) {
  const ref = r.tempo.referencia;
  const antes = addDias(ref > r.tempo.fim ? r.tempo.fim : ref, -dias);
  return antes < r.tempo.inicio ? null : antes;
}

registrarEtapa({
  nome: 'apuracao',
  ordem: 10,
  descricao: 'Apura cada campanha ativa e encerrada (hoje e 7 dias atrás, para o movimento do ranking) e grava o resultado pronto, com o estoque.',
  gatilhos: ['importacao', 'dia', 'campanha', 'config'],
  assinatura,
  async executar(ctx) {
    let feitas = 0;
    const manter = [];
    for (const camp of campanhas()) {
      const refs = new Set([undefined, refDetalhePadrao(camp)]);
      for (const ref of refs) {
        const chave = chaveApuracao(camp.definicao, ref);
        manter.push(chave);
        const existe = db.prepare('SELECT 1 FROM apuracao_pronta WHERE chave = ?').get(chave);
        const r = existe && !ctx.forcar ? null : apurarComCache(camp.definicao, { referencia: ref, persistir: { id_campanha: camp.id } });
        if (r) feitas++;
        await ctx.pausa();
        // ponto de comparação (movimento em 7 dias)
        const base = r || apurarComCache(camp.definicao, { referencia: ref });
        const antes = camp.status === 'ativa' ? refAnterior(base) : null;
        if (antes) {
          const ch = chaveApuracao(camp.definicao, antes);
          manter.push(ch);
          if (ctx.forcar || !db.prepare('SELECT 1 FROM apuracao_pronta WHERE chave = ?').get(ch)) {
            apurarComCache(camp.definicao, { referencia: antes, persistir: { id_campanha: camp.id } });
            feitas++;
            await ctx.pausa();
          }
        }
      }
    }
    limparApuracoesVelhas(manter);
    return { linhas: feitas };
  },
});

registrarEtapa({
  nome: 'detalhes',
  ordem: 70, // a mais demorada: roda depois do que as telas principais precisam (painel, insights, planos)
  depende: ['apuracao'],
  descricao: 'Boletim e detalhe de cada participante e a planilha Excel de cada campanha, prontos para abrir na hora.',
  gatilhos: ['importacao', 'dia', 'campanha', 'config'],
  assinatura,
  async executar(ctx) {
    fs.mkdirSync(PASTA_EXCEL, { recursive: true });
    const { gerarExcelCampanha } = await import('../exportar.js');
    let feitas = 0;
    const atuais = [];
    for (const camp of campanhas()) {
      const ref = refDetalhePadrao(camp);
      const chave = chaveApuracao(camp.definicao, ref);
      atuais.push(chave);
      if (!ctx.forcar && temDetalhes(chave)) continue;
      const t = Date.now();
      const r = apurarComCache(camp.definicao, { referencia: ref });
      if (r.tempo.status === 'futura' && !r.participantes.length) continue;
      void r._interno; // garante as séries internas (detalhe e Excel precisam delas)
      const antes = camp.status === 'ativa' ? refAnterior(r) : null;
      let mov = new Map();
      if (antes) {
        try {
          mov = movimentosEntre(r, apurarComCache(camp.definicao, { referencia: antes }));
        } catch {
          mov = new Map();
        }
      }
      const itens = [];
      const lista = boletins(r, { filtro: 'todos', idCampanha: camp.id, movimentos: mov });
      await ctx.pausa();
      const porChave = new Map(lista.map((b, i) => [r.participantes[i].chave, b]));
      for (const [k, b] of porChave) itens.push({ tipo: 'boletim', item: k, conteudo: b });
      for (const l of r.participantes) {
        const det = detalharParticipante(r, l.chave);
        if (det) itens.push({ tipo: 'participante', item: l.chave, conteudo: { ...det, boletim: porChave.get(l.chave) } });
      }
      await ctx.pausa();
      try {
        const buf = await gerarExcelCampanha({ ...camp, definicao: camp.definicao }, r);
        fs.writeFileSync(path.join(PASTA_EXCEL, `${chave}.xlsx`), Buffer.from(buf));
      } catch (e) {
        ctx.log(`Excel da campanha ${camp.id}:`, e.message);
      }
      gravarDetalhes(chave, camp.id, itens);
      feitas++;
      ctx.log(`campanha ${camp.id}: ${itens.length} itens em ${Date.now() - t} ms`);
      await ctx.pausa();
    }
    limparDetalhes(atuais);
    return { linhas: feitas };
  },
});
