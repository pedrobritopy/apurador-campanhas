import { registrarEtapa } from '../pipeline.js';
import { assinaturaIndicadores, etapaCarteiras } from '../carteiras.js';
import { assinaturaFichas, gerarFichas } from '../ficha.js';

// Carteiras de vendas (classificação de clientes e farmácias + indicadores em todos os níveis)
// e ficha de cada cliente. As rotas só leem o pronto.
registrarEtapa({
  nome: 'carteiras',
  descricao: 'Coloca cada cliente e farmácia na carteira certa (UF, cidade, bairro, território) e calcula aderência, invasões, potencial e equilíbrio por vendedor, equipe e região.',
  depende: ['mapa-posicoes'],
  gatilhos: ['importacao', 'receita', 'territorio', 'carteira', 'dia'],
  versao: 2,
  ordem: 66,
  assinatura: () => assinaturaIndicadores(),
  executar: async () => etapaCarteiras(),
});

registrarEtapa({
  nome: 'clientes-ficha',
  descricao: 'Ficha de cada cliente: histórico, frequência, mix, oportunidades, campanhas, carteira e comparação com o bairro.',
  depende: ['carteiras'],
  gatilhos: ['importacao', 'carteira', 'campanha', 'dia'],
  versao: 2,
  ordem: 67,
  assinatura: () => assinaturaFichas(),
  executar: async () => gerarFichas(),
});
