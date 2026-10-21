import fs from 'node:fs';
import path from 'node:path';
import { db, RAIZ } from '../db.js';
import { UFS, geolocalizarClientes, recalcularScores, vincularClientes } from '../receita.js';
import { registrarEtapa } from '../pipeline.js';
import { assinaturaMapa, gravarResumoMapa } from '../geo.js';
import {
  assinaturaCorrecao, assinaturaPosicoes, contornoUfs, garantirMalhaUf, malhaComprimida, manutencaoGeo, preCarregarBairrosIbge, recalcularBairrosEmCache,
} from '../malhas.js';
import { assinaturaTerritorios, recalcularTerritorios } from '../territorios.js';

// =====================================================================
// Etapas do pipeline para o mapa comercial. Cada uma grava o resultado em tabela (ou arquivo de malha)
// e as rotas só leem o pronto: abrir o mapa ou reiniciar o servidor não recalcula nada pesado.
//   mapa-malhas      malhas do IBGE das UFs com farmácias ou clientes (+ bairros do IBGE onde temos clientes)
//   mapa-posicoes    farmácias e clientes sempre em terra, dentro da própria cidade (cliente_geo, rf_correcao_geo)
//   mapa-resumo      agregados por cidade e UF, potencial, prioridade e plano de ação (mapa_resumo)
//   mapa-bairros     números de cada bairro das cidades já baixadas (bairro_numeros)
//   mapa-territorios números de cada território e desenho (territorio_numeros)
// =====================================================================

const PASTA_GEO = path.join(RAIZ, 'dados', 'geo');
const contarArquivos = (p, re) => (fs.existsSync(p) ? fs.readdirSync(p).filter((f) => re.test(f)).length : 0);
// Carteira ou base da Receita nova: reposiciona os clientes e recalcula o score dos prospects (dependem de onde vendemos).
const assinaturaCarteira = () => {
  const imp = db.prepare('SELECT MAX(id) AS m FROM importacao').get()?.m ?? 0;
  const cli = db.prepare('SELECT COUNT(*) AS n FROM dm_cliente').get().n;
  const geo = db.prepare('SELECT COUNT(*) AS n FROM cliente_geo').get().n;
  const rf = db.prepare('SELECT MAX(rowid) AS m, COUNT(*) AS n FROM rf_farmacia').get();
  return `${imp}|${cli}|${geo}|${rf.m}|${rf.n}`;
};

const ufsDaBase = () =>
  db
    .prepare('SELECT DISTINCT uf FROM rf_farmacia WHERE uf IS NOT NULL UNION SELECT DISTINCT c.estado FROM dm_cliente c WHERE c.estado IS NOT NULL')
    .all()
    .map((r) => r.uf)
    .filter((uf) => Object.values(UFS).some(([s]) => s === uf))
    .sort();

export const etapas = [
  {
    nome: 'mapa-malhas',
    descricao: 'Baixa (uma vez) as malhas de municípios e UFs do IBGE e os bairros do IBGE das UFs onde temos clientes.',
    depende: [],
    gatilhos: ['receita', 'importacao'],
    assinatura: () => `${ufsDaBase().join(',')}|${contarArquivos(path.join(PASTA_GEO, 'municipios'), /\.geojson$/)}|${contarArquivos(path.join(PASTA_GEO, 'municipios', 'maxima'), /\.json$/)}|${contarArquivos(path.join(PASTA_GEO, 'bairros', '_ufs'), /\.json$/)}`,
    executar: async () => {
      let linhas = 0;
      for (const q of ['intermediaria', 'maxima']) await contornoUfs(q);
      for (const uf of ufsDaBase()) {
        for (const q of ['intermediaria', 'maxima']) {
          await garantirMalhaUf(uf, q);
          await malhaComprimida(uf, q);
          linhas++;
        }
      }
      await preCarregarBairrosIbge();
      return { linhas };
    },
  },
  {
    nome: 'mapa-posicoes',
    descricao: 'Confere farmácias e clientes contra o polígono do próprio município e reposiciona quem caiu fora (mar, rio, divisa).',
    depende: ['mapa-malhas'],
    gatilhos: ['importacao', 'receita'],
    assinatura: () => `${assinaturaCarteira()}|${assinaturaCorrecao()}|${assinaturaPosicoes()}`,
    executar: async (ctx) => {
      const antes = db.prepare("SELECT valor FROM geo_manutencao WHERE chave = 'carteira'").get()?.valor;
      if (ctx?.forcar || antes !== assinaturaCarteira()) {
        // clientes que são farmácias da Receita (mesmo CNPJ) ficam no ponto exato da farmácia
        vincularClientes();
        geolocalizarClientes();
        if (db.prepare('SELECT COUNT(*) AS n FROM rf_farmacia').get().n) recalcularScores();
        db.prepare("INSERT OR REPLACE INTO geo_manutencao (chave, valor) VALUES ('carteira', ?)").run(assinaturaCarteira());
      }
      const r = await manutencaoGeo({ assincrono: false, forcar: Boolean(ctx?.forcar) });
      return { linhas: (r.farmacias ? r.farmacias.ajustadas_borda + r.farmacias.reposicionadas : 0) + (r.clientes.movidos || 0), detalhes: r };
    },
  },
  {
    nome: 'mapa-resumo',
    descricao: 'Agregados do mapa por cidade e UF: farmácias, clientes, penetração, potencial, prioridade e plano de ação.',
    depende: ['mapa-posicoes'],
    gatilhos: ['importacao', 'receita', 'dia'],
    assinatura: () => assinaturaMapa(),
    executar: async () => gravarResumoMapa(),
  },
  {
    nome: 'mapa-bairros',
    descricao: 'Números de cada bairro (farmácias, clientes, vendas) das cidades com bairros já baixados.',
    depende: ['mapa-resumo'],
    gatilhos: ['importacao', 'receita', 'dia'],
    assinatura: () => `${assinaturaMapa()}|${contarArquivos(path.join(PASTA_GEO, 'bairros'), /^\d{7}\.json$/)}`,
    executar: async () => recalcularBairrosEmCache(),
  },
  {
    nome: 'mapa-territorios',
    descricao: 'Números de cada território e desenho: farmácias, clientes, conflitos de vendedor, sobreposição e potencial.',
    depende: ['mapa-resumo'],
    gatilhos: ['importacao', 'receita', 'dia', 'territorio'],
    assinatura: () => assinaturaTerritorios(),
    executar: async () => recalcularTerritorios(),
  },
];

etapas.forEach((e, i) => registrarEtapa({ ...e, ordem: 60 + i }));
