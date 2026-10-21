import fs from 'node:fs';
import { db, contarLinhas, salvarConfig, PASTA_DADOS } from './db.js';
import { importarPasta } from './importador.js';

async function etapa(nome, fn) {
  try {
    await fn();
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return; // módulo opcional ainda não existe
    console.error(`[inicializacao] ${nome}:`, e.message);
  }
}

/** Executado uma vez ao subir o servidor. Idempotente. */
export async function inicializar() {
  // 1) primeira execução: carrega os CSVs da pasta dados/
  if (contarLinhas('fato_vendas') === 0 && fs.existsSync(PASTA_DADOS)) {
    console.log(`Primeira execução: importando CSVs de ${PASTA_DADOS} ...`);
    const { importados } = await importarPasta();
    for (const r of importados) console.log(`  ✔ ${r.tabela}: ${r.linhas} linhas`);
  }

  // 2) calendário padrão: se há venda relevante no fim de semana, projeta por dias corridos
  if (!db.prepare("SELECT 1 FROM config WHERE chave = 'calendario'").get() && contarLinhas('fato_vendas') > 0) {
    const r = db.prepare("SELECT SUM(strftime('%w', data_pedido) IN ('0','6')) * 1.0 / COUNT(*) AS fds FROM fato_vendas").get();
    salvarConfig({ calendario: r?.fds > 0.15 ? 'corridos' : 'uteis' });
  }

  // 3) modelos de mensagem e campanhas de exemplo
  await etapa('modelos de mensagem', async () => {
    if (contarLinhas('modelo_mensagem') === 0) (await import('./mensagens.js')).criarModelosMensagem();
  });
  await etapa('campanhas de exemplo', async () => {
    if (contarLinhas('campanha') === 0) (await import('./exemplos.js')).criarExemplos();
  });

  // 4) envio automático de acompanhamentos
  await etapa('agendador', async () => (await import('./disparos.js')).iniciarAgendador());
}
