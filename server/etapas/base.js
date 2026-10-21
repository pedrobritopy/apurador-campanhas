// Etapa base: números da própria base que várias telas pedem (contagens, datas, listas de filtros).
import { assinaturaBase, gravarPronto, registrarEtapa } from '../pipeline.js';
import { montarDimensoesBase, montarStatusDados } from '../rotas/base.js';

registrarEtapa({
  nome: 'base',
  ordem: 5,
  descricao: 'Contagens da base, período das vendas e listas de filtros (fabricantes, marcas, cidades, CFOPs...).',
  gatilhos: ['importacao', 'config'],
  assinatura: () => assinaturaBase(),
  async executar(ctx) {
    const sig = assinaturaBase();
    let t = Date.now();
    gravarPronto('status_dados', sig, montarStatusDados(), Date.now() - t);
    await ctx.pausa();
    t = Date.now();
    const dim = montarDimensoesBase();
    gravarPronto('dimensoes', sig, dim, Date.now() - t);
    return { linhas: dim.fabricantes.length + dim.marcas.length + dim.cidades.length };
  },
});
