# Dados de referência: catálogo e demanda reais

## produtos_reais.csv (5.540 itens, separador `;`, UTF-8)
- **5.037 medicamentos** da lista de preços da **CMED/ANVISA** (arquivo `lista_pmc` de 09/10/2026), com EAN, registro, laboratório, substância, apresentação, tarja, classe terapêutica, preço fábrica (PF) e PMC na alíquota de 18% de ICMS. Filtros: comercializado em 2025, sem restrição hospitalar, sem radiofármacos e sem terapia avançada. Sem EAN duplicado; PMC ≥ PF em todos.
- **503 não-medicamentos** de marcas reais de farmácia (higiene, dermocosméticos, infantil, primeiros socorros, equipamentos, suplementos). Nome e apresentação de produtos que existem; **preço estimado** de mercado e **EAN vazio** (sem fonte aberta confiável por item).
- `fabricante` = grupo comercial (ex.: Cosmed, Brainfarma e Mantecorp viram Hypera Pharma; genéricos Brainfarma viram Neo Química; Opella vira Sanofi; PF Consumer vira Haleon). `laboratorio_cmed` guarda o detentor do registro.
- `tipo`: mip (sem tarja), generico, similar, referencia, nao_medicamento.
- `curva_sugerida`: ABC pela demanda em valor (80% / 15% / 5%): 941 A, 1.849 B, 2.750 C.
- `demanda_mes_brasil`: caixas por mês no Brasil. `fonte_demanda` = `SNGPC/ANVISA` (dado real, 868 itens) ou `estimado` (prior por classe terapêutica, marca famosa, isento de prescrição, preço e forma farmacêutica).
- `sazonalidade_sugerida`: inverno, primavera, verão ou vazio.

## demanda_real.csv
Por EAN: `demanda_mes_brasil` e índice mensal de sazonalidade (`indice_mes_1..12`, média 1). Para substâncias do SNGPC, o índice vem da participação real da substância em cada mês (jan a set/2026 e out a dez/2020), suavizado pela metade em direção a 1.

## demanda_uf.csv e demanda_municipio.csv
Participação de cada UF e município no volume vendido do SNGPC (jan a set/2026). Use como peso regional da demanda.

## Fontes e licença
- CMED/ANVISA, Listas de preços de medicamentos: https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos (dados públicos).
- SNGPC/ANVISA, Venda de medicamentos industrializados (controlados e antimicrobianos), arquivos `EDA_Industrializados_AAAAMM.csv` em https://dados.anvisa.gov.br/dados/SNGPC/Industrializados/ (Dados Abertos, licença CC BY). Meses usados: 2020-10 a 2020-12 e 2026-01 a 2026-09. Processados em fluxo; só os agregados foram guardados.
- Gerado em 21/10/2026.

## Limitações
- O SNGPC só cobre controlados e antimicrobianos; o resto da demanda é estimado.
- Não foi gerado o mapeamento dos ~999 produtos atuais (`mapa_produtos_atuais.csv`): a base atual tem 134 produtos únicos repetidos com sufixos " 2" a " 8". Sugestão para o gerador: o original vira o equivalente real (por marca e apresentação) e as cópias viram outros itens reais do mesmo fabricante e subcategoria deste arquivo.
