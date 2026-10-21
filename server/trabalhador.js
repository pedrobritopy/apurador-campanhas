// Thread de trabalho para processamentos pesados (base de conhecimento, perfis, backtest).
// Tem conexão própria com o SQLite (WAL permite leitura simultânea pelo servidor).
import { parentPort, workerData } from 'node:worker_threads';

try {
  if (workerData?.tarefa === 'pipeline') {
    // pipeline de dados: roda as etapas afetadas pelos eventos (ver server/pipeline.js)
    const { executarEtapasAgora } = await import('./pipeline.js');
    const resumo = await executarEtapasAgora({
      eventos: workerData.eventos || ['manual'],
      detalhes: workerData.detalhes || [],
      forcar: Boolean(workerData.forcar),
      aoAndamento: (andamento) => parentPort.postMessage({ andamento }),
    });
    parentPort.postMessage({ resumo });
  } else if (workerData?.tarefa === 'conhecimento') {
    const { atualizarConhecimentoAgora } = await import('./conhecimento.js');
    const r = await atualizarConhecimentoAgora({ forcar: Boolean(workerData.forcar) });
    parentPort.postMessage(r);
  } else {
    parentPort.postMessage({ erro: `Tarefa desconhecida: ${workerData?.tarefa}` });
  }
} catch (e) {
  parentPort.postMessage({ erro: e.message });
}
