# Fotos dos vendedores

Rostos **sintéticos, gerados por IA** (não são pessoas reais), do conjunto
[Synthetic Faces High Quality (SFHQ)](https://github.com/SelfishGene/SFHQ-dataset), parte 3 (StyleGAN2),
de David Beniaguev — licença MIT. Amostra obtida do espelho `bitmind/SyntheticFacesHQ` no Hugging Face.

- Arquivos `vendedores/vendedor_{id}.jpg` (256×256), no padrão da coluna `imagem` de `dm_vendedor`.
- Foto masculina para nomes masculinos e feminina para nomes femininos; rostos de crianças, de óculos escuros
  ou ambíguos foram descartados na curadoria.
- Correspondência vendedor → imagem original: `origem.csv`.

## Produtos (`produtos/produto_{id}.webp`, miniatura em `produtos/mini/`)

Registro por imagem em `produtos/origem.csv` (tipo, fonte, confiança, EAN usado, URL, licença).

- **Foto real**: Open Beauty Facts / Open Food Facts / Open Products Facts, licença CC BY-SA 3.0 (imagem) e ODbL (dados), crédito "Colaboradores do Open ... Facts". Só entra com mesma marca e produto equivalente (EAN real ou nome).
- **Ilustração**: embalagem desenhada pelo próprio sistema (`scripts/imagens/ilustrar.mjs`), com cor da marca, nome, apresentação, tarja vermelha/preta e faixa amarela de genérico. Não é foto real (metadado EXIF "ilustracao"); a etapa `imagens` da pipeline gera automaticamente para produto novo sem foto.
- Logos de fabricante/marca (`fabricantes/`, `marcas/`): ainda não baixados; as telas mostram monograma.

Reexecutar (incremental): `node scripts/imagens/coletar-candidatos.mjs <cache>/candidatos`, `node scripts/imagens/buscar-ean.mjs <cache>/ean.json`, `node scripts/imagens/montar-imagens.mjs --cache <cache> --brutas <pasta-downloads>`.
- Em 21/10/2026 a força de vendas passou de 180 para 306 pessoas (fictícias). As 126 fotos novas vêm da mesma
  amostra SFHQ, com a mesma curadoria manual por gênero aparente (lista em `scripts/fotos-classificadas.json`);
  a correspondência de cada pessoa com o arquivo original está em `origem.csv`.
