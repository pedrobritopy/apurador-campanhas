// Etapa imagens: todo produto do cadastro tem imagem (foto real aberta ou embalagem ilustrada) e o índice fica pronto.
import { gravarPronto, registrarEtapa } from '../pipeline.js';
import { assinaturaImagens, garantirImagensProdutos, indiceImagens } from '../imagens.js';

registrarEtapa({
  nome: 'imagens',
  ordem: 8,
  descricao: 'Imagens dos produtos e logos: produto novo sem foto ganha a embalagem ilustrada; índice para as telas.',
  gatilhos: ['importacao'],
  assinatura: () => assinaturaImagens(),
  async executar(ctx) {
    const r = await garantirImagensProdutos({ pausa: ctx.pausa });
    if (r.geradas) ctx.log?.(`${r.geradas} ilustrações geradas`);
    const indice = indiceImagens();
    gravarPronto('imagens_indice', assinaturaImagens(), indice);
    return { linhas: Object.keys(indice.produtos).length };
  },
});
