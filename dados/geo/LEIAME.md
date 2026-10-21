# Dados geográficos do mapa comercial

Tudo aqui é público e foi baixado das fontes oficiais. O sistema baixa o que faltar sozinho (sob demanda)
e guarda neste diretório; apagar um arquivo só faz ele ser baixado de novo.

| Arquivo / pasta | O que é | Fonte | Licença |
|---|---|---|---|
| `uf.geojson` | Contorno das UFs, malha mínima (visão do Brasil inteiro) | IBGE, API de malhas v3 | Dados públicos do IBGE, uso livre com citação da fonte |
| `uf-intermediaria.json`, `uf-maxima.json` | Contorno das UFs em mais detalhe (divisas entre estados ao aproximar) | IBGE, API de malhas v3 (`/malhas/paises/BR?intrarregiao=UF`) | Idem |
| `municipios/UF.geojson` | Limites dos municípios de cada UF, qualidade intermediária (visão de estado e região) | IBGE, API de malhas v3 (`/malhas/estados/{UF}?intrarregiao=municipio&qualidade=intermediaria`) | Idem |
| `municipios/maxima/UF.json` | Limites dos municípios em qualidade máxima (litoral e divisas precisos no zoom de cidade). Formato compacto: anéis em inteiros de 1e-5 grau com deltas, simplificados a ~2 m | IBGE, API de malhas v3 (`qualidade=maxima`) | Idem |
| `bairros/{código IBGE}.json` | Bairros de cada município já consultado (mesmo formato compacto) | IBGE, malha de bairros do Censo 2022 (`geoftp.ibge.gov.br/.../censo_2022/bairros/shp/UF/`); onde o IBGE não publica bairros da cidade, limites de bairro do OpenStreetMap (Overpass API, `admin_level` 9 e 10) | IBGE: uso livre com citação. OpenStreetMap: © colaboradores do OpenStreetMap, licença ODbL (atribuição obrigatória, já exibida no mapa) |
| `bairros/_ufs/UF.json` | Índice de quais municípios da UF têm bairros no IBGE (evita baixar a malha da UF de novo) | Gerado a partir da malha do IBGE | Idem |
| `municipios.csv` | Lista de municípios com centro (lat/lng), código SIAFI e DDD, usada para posicionar cidades e casar o código da Receita com o do IBGE | Formato do projeto aberto *kelvins/municipios-brasileiros* | Licença do projeto de origem |

## Como os pontos ficam sempre em terra

- **Farmácias da Receita**: a coordenada vem da geocodificação da base da Receita. Depois de cada importação,
  cada ponto é conferido contra o polígono (qualidade máxima) do próprio município. Se cair fora até 3 km
  (mar, rio, divisa), vai para o ponto de terra mais próximo dentro do município; se cair mais longe, é tratado
  como erro de geocodificação e vira um ponto aproximado dentro da cidade. Cada correção fica registrada na
  tabela `rf_correcao_geo` (posição original, nova e distância).
- **Nossos clientes sem endereço geocodificado**: ficam numa farmácia real (Receita) do bairro do cadastro,
  quando o bairro existe na malha; senão, numa farmácia do bairro com o mesmo nome na Receita; senão, numa
  farmácia real da cidade; em último caso, num ponto sorteado dentro do bairro ou do município. Continuam
  marcados como aproximados.

Conferência em 21/10/2026: 120.494 farmácias e 1.000 clientes, nenhum fora do próprio município
(a única cidade sem malha é Boa Esperança do Norte/MT, criada depois do Censo 2022).
