import { servirPronto } from '../pipeline.js';
import { assinaturaImagens, indiceImagens } from '../imagens.js';

export default function (app) {
  // Índice das imagens: quais produtos têm foto real (r) ou ilustração (i), e quais fabricantes/marcas têm logo.
  app.get('/api/imagens/indice', (req, res) => {
    const r = servirPronto('imagens_indice', { assinatura: assinaturaImagens(), calcular: indiceImagens, evento: 'importacao' });
    res.set('Cache-Control', 'private, max-age=60');
    res.json(r.conteudo);
  });
}
