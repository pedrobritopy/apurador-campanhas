# Apurador de Campanhas

Sistema para **criar, apurar, acompanhar e premiar campanhas de incentivo de vendas** (metas de fornecedor,
positivação, mix, venda casada, cestas, crescimento, rankings…). Substitui planilhas com fórmulas e tabelas
dinâmicas por uma apuração automática, com projeções, boletins em linguagem natural e disparo de acompanhamentos.

## Como rodar

Pré-requisito: **Node.js 22.13+** (testado no 24).

```bash
npm install
npm run dev        # desenvolvimento (recarrega sozinho) → http://localhost:3210
npm start          # produção: compila o front e sobe o servidor → http://localhost:3210
```

Na primeira execução o sistema importa os CSVs de `dados/`, cria campanhas de exemplo, modelos de mensagem e
liga o agendador. A porta muda com `PORT=xxxx` no `.env`.

## Telas

| Tela | Para quê |
|---|---|
| **Painel** | Pulso de todas as campanhas: KPIs, ritmo × tempo, alertas, ranking geral, atividade. |
| **Campanhas** | Lista com situação (ativa, agendada, aguardando fechamento, rascunho, encerrada). |
| **Nova campanha / Construtor** | 18 modelos prontos ou do zero; critérios, metas, prêmios; **prévia ao vivo** com dados reais; regulamento em linguagem natural. |
| **Apuração** (campanha) | Herói com projeção, ranking animado (pódio, movimento em 7 dias), critérios com gráfico realizado × meta × projeção, equipes, estoque, fotografias, "posição em" qualquer data, Excel. |
| **Boletim** | Página imprimível por participante: posição, ritmo necessário, próxima faixa e quanto rende, clientes a atacar. |
| **Acompanhamentos** | Disparo por WhatsApp (links), e-mail, webhook; modelos com variáveis; agendamentos; caixa de saída. |
| **Atendimento** | Multiatendimento: bot do Telegram + e-mail (IMAP/SMTP), kanban de conversas, chat estilo WhatsApp. |
| **Central de insights** | Alertas automáticos (custo zero), análise da IA com fontes verificadas, chat, base de conhecimento, qualidade dos dados. |
| **Planos de ataque** | Por vendedor: recompra atrasada, venda cruzada, queda, campanha, inativos, com taxa de conversão real (retroalimentação). |
| **Mapa comercial / Prospecção** | 120 mil farmácias ativas da Receita × nossa carteira: onde vendemos, potencial não atendido, onde atacar. |
| **Catálogo de métricas** | 43 métricas, 38 variáveis, 14 dimensões de recorte; playground com **IA que escreve a fórmula**; biblioteca de fórmulas salvas. |
| **Dados / Configurações** | Importação de CSV, Receita Federal, calendário e feriados, envio, IA (limite diário), linhas de produtos. |

Em todas as telas, o ícone **"i"** ao lado de títulos, indicadores e campos explica o que é aquilo, como usar e dá um
exemplo com números (textos em `web/src/lib/explicacoes.jsx`, componente `Explica` em `web/src/componentes/ui.jsx`).

## Como a apuração funciona

Uma **campanha** tem período, participantes (vendedor, equipe, cliente, canal, UF, segmento ou empresa), filtros de
vendas (canal, segmento, porte, UF, cidade, curva ABC, CFOP; ex.: desconsiderar bonificação 5.910/6.910) e um ou
mais **critérios**. Cada critério tem:

- **Produtos** (fabricante/marca/subcategoria/linhas salvas/produtos avulsos/exceções);
- **Métrica** pronta (unidades, faturamento, margem, positivação qualificada, cobertura de carteira, distribuição
  numérica e ponderada, mix, venda casada/kit, share, crescimento, ticket, devolução…) ou **fórmula** própria,
  inclusive com recortes como `valor{marca: "Dorflex", canal: "App Mobile"} / valor * 100`;
- **Meta**: fixa, total distribuída (igual, pelo histórico ou pela meta do ERP), crescimento sobre o período anterior,
  % da meta geral do mês (`fato_metas`) ou sem meta (ranking), com ajuste individual e colar do Excel;
- **Peso, gatilho e teto** para combinar critérios (média ponderada, "cumprir todos" ou "melhor critério").

**Premiação**: faixas (fixo + variável por unidade, sobre o total ou só o excedente), ranking por posição, rateio de
verba, aceleradores/redutores, teto por pessoa e orçamento.

**Projeção**: volume = metade pela curva do período anterior (capta fim de mês e dias da semana) + metade pelo
ritmo (média + últimos dias); contagens que saturam (clientes, SKUs) usam a curva de maturação do período anterior.
Calendário em dias úteis (feriados nacionais calculados) ou corridos.

## Dados

- `dados/imagens/produtos/`: imagem de cada produto (foto real de base aberta Open Facts quando há correspondência segura; senão embalagem ilustrada pelo sistema, com tarja e faixa de genérico). Fontes e licenças em `dados/imagens/LEIAME.md`; scripts em `scripts/imagens/`. A etapa `imagens` da pipeline cria a ilustração de todo produto novo após importar.

- `dados/*.csv`: tabelas do DW (`dm_canal`, `dm_cliente`, `dm_produto`, `dm_vendedor`, `dm_tempo`, `fato_vendas`,
  `fato_estoque`, `fato_metas`). Importação: `npm run importar`, ou **Dados → Reimportar** / arrastar CSV.
- `dados/originais/`: CSVs originais recebidos (preservados).
- `npm run gerar-dados`: **gerador realista** (jan/2025 até ontem) que mantém todas as regras do DW
  (preço × desconto, ICMS 12% / PIS 1,65% / COFINS 7,6%, margem, um cliente/vendedor/canal/NF por pedido, estoque
  encadeado = vendas faturadas) e acrescenta sazonalidade por categoria, ciclo de vida de clientes (novos, pausas,
  perda), fidelidade e sortimento, compras casadas, desempenho e férias de vendedores, fim de mês, reajustes de preço
  (CMED em abril), CFOP pela UF, ruptura real de estoque e metas mensais calibradas. Depois de gerar, reimporte.
- `dados/imagens/vendedores/`: fotos dos vendedores (rostos **sintéticos gerados por IA**, conjunto SFHQ, licença MIT;
  ver `dados/imagens/LEIAME.md`).
- `dados/geo/`: malha das UFs (IBGE) e municípios.
- O banco do sistema fica em `var/apurador.db` (SQLite nativo do Node; não versionado).

A **Central de insights → Qualidade dos dados** confere a base a cada importação (valor = qtd × unitário, margem,
impostos, órfãos, datas, estoque × vendas, motor × SQL independente).

## Pipeline de dados

Os números não são calculados quando alguém abre uma tela. Uma **pipeline** roda em segundo plano (numa thread separada)
sempre que algo muda (importação, campanha criada ou alterada, plano registrado, lançamento na conta corrente, território
desenhado, virada do dia) e grava tudo pronto no banco: apuração de cada campanha, boletins, detalhes, Excel, alertas,
planos de ataque, base da IA e números do mapa. Cada etapa só refaz o que mudou, e reiniciar o servidor não recalcula nada.
As telas abrem em menos de 0,2 s; enquanto algo processa aparece "Atualizando dados..." no topo e as telas se atualizam
sozinhas no fim. Acompanhe e force o processamento em **Dados → Pipeline de dados**. Detalhes em `docs/API.md` (seção 12).

## Integrações (arquivo `.env`, fora do git)

```ini
ANTHROPIC_API_KEY=...            # IA (Claude Haiku 5.5): análises, chat, roteiros e fórmulas
POSTGRES_HOST=localhost          # base da Receita Federal (farmácias ativas, CNAE 4771-7/01/02/03)
POSTGRES_PORT=5432
POSTGRES_DB=rfb
POSTGRES_USER=postgres
POSTGRES_PASSWORD="..."          # entre aspas se tiver # ou espaços
PORT=3210                        # opcional
```

- **IA**: só é chamada quando alguém pede; resultados são reaproveitados enquanto os dados não mudam; recebe apenas
  fatos pré-calculados e **validados duas vezes** (nunca dados brutos); a resposta é conferida (citações e números).
  **Limite diário** em Configurações → IA (padrão US$ 5). Uma fórmula gerada custa ~US$ 0,001.
- **Telegram**: crie o bot no @BotFather e cole o token em **Atendimento → Canais** (ou já configurado). Vendedores
  se identificam compartilhando o telefone; comandos `/boletim`, `/ranking`, `/plano`, `/ajuda`.
- **E-mail**: SMTP em Configurações → Envio; leitura (IMAP) em Atendimento → Canais.
- **Webhook**: para integrar com gateways de WhatsApp, Teams, Slack etc. (Configurações → Envio).

Tokens e senhas aparecem mascarados nas telas.

## Estrutura

```
server/
  index.js            servidor (Express 5 + Vite em dev); carrega toda rota de server/rotas
  db.js, esquema.js   SQLite (node:sqlite), tabelas do DW e do sistema, configuração
  importador.js       CSV → SQLite em lotes, troca atômica, ANALYZE
  motor.js            ⭐ apuração: SQL por critério, séries diárias, metas, projeção, pontuação, premiação
  expressao.js        linguagem de fórmulas (segura, sem eval) com variáveis recortadas
  narrativa.js        ⭐ boletins: transforma números em frases de informação
  mensagens.js, disparos.js   modelos, renderização, WhatsApp/e-mail/webhook, agendador
  exportar.js         Excel (resumo, apuração, por produto, vendas consideradas)
  perfil.js, conhecimento.js, insights.js, planos.js, ia.js   inteligência comercial
  formulas.js         biblioteca de fórmulas
  receita.js, geo.js  Receita Federal e mapa
  atendimento/        Telegram, e-mail, conversas, bot
  pipeline.js         pipeline de dados: etapas em segundo plano, resultados prontos no banco
  etapas/             etapas da pipeline (apuração, detalhes, base, inteligência, mapa)
  prontos.js          leitura dos detalhes prontos (boletins, participantes, Excel)
  trabalhador.js      thread para processamentos pesados (não trava o servidor)
  rotas/              endpoints (contrato em docs/API.md)
scripts/gerar-dados.js
web/src/              React (Vite): App.jsx, componentes/ (kit de UI e gráficos), paginas/, lib/
docs/API.md           contrato da API
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor + front com recarga automática |
| `npm start` | compila o front e sobe em modo produção |
| `npm run importar` | reimporta os CSVs da pasta `dados/` |
| `npm run gerar-dados` | gera a base realista (veja opções no topo de `scripts/gerar-dados.js`) |
| `npm run exemplos` | recria as campanhas de exemplo |

## Carteiras de vendas e ficha do cliente

- **Carteiras** (menu Inteligência comercial): cada vendedor tem uma carteira feita de regras geográficas
  (UF, cidade, bairro da malha IBGE/OSM ou território desenhado no mapa). Cada cliente e cada farmácia da Receita
  cai em uma só carteira (vale a regra mais específica); o resto fica "sem dono". A tela mostra, por vendedor,
  equipe, região e empresa: clientes, venda 90 dias, **aderência** (venda feita pelo dono), quem vende na área
  dos outros, farmácias livres, potencial, equilíbrio e sugestões de ajuste, com a conferência das somas entre níveis.
  Na base atual vem semeada uma **demonstração no ES** (Grande Vitória por bairros, interior por regiões de cidades).
- **Ficha do cliente** (clique num cliente no mapa): compras de 12 meses contra o ano anterior, frequência e
  recompra atrasada, carteira e quem vende, ações do plano de ataque, produtos que clientes parecidos compram e
  ele não, mix e o que deixou de comprar, campanhas em que ele conta, comparação com bairro e cidade,
  participação estimada e últimos pedidos.
- Tudo é pré-calculado pelas etapas `carteiras` e `clientes-ficha` da pipeline (evento `carteira` a cada edição).

### Base com farmácias reais (como foi gerada)

A base atual é gerada em quatro passos, todos reproduzíveis (semente 2026):

```bash
node scripts/preparar-base.js --fotos=<pasta das candidatas SFHQ>  # clientes reais, força de vendas, praças e carteiras
node scripts/preparar-catalogo.js                                  # catálogo real (CMED/ANVISA) com ids estáveis
npm run gerar-dados && npm run importar                            # vendas, estoque, metas e tempo
node scripts/recalibrar-campanhas.js                               # campanhas de exemplo e conta corrente
node scripts/verificar-base.js                                     # 15 regras do DW, aderência e demanda real
```

- **Clientes**: farmácias reais e ativas da Receita Federal (CNPJ, razão social, endereço, CNAE, porte, abertura),
  só LTDA e S.A., sem MEI nem empresário individual, sem razão social com nome de pessoa e sem as grandes redes
  nacionais. Concentração em GO e vizinhos e no Sudeste (com o ES de demonstração). Os ids 1 a 1000 do cadastro
  antigo viraram farmácias reais da mesma cidade.
- **Força de vendas**: pessoas fictícias (nomes plausíveis e rostos sintéticos SFHQ, ver `dados/imagens/LEIAME.md`),
  coordenador regional → gerente → vendedor, cada um morando na praça que atende. Carteiras por cidade e bairro
  (`dados/pracas.json`); ~7% dos pedidos tirados por um colega da equipe e ~1% de clientes de divisa atendidos
  pela UF vizinha.
- **Produtos**: catálogo real CMED/ANVISA e não-medicamentos de marcas reais (`dados/referencia/`). Popularidade
  pela venda real do SNGPC (estimativas comprimidas para a mesma escala), sazonalidade mensal real e intensidade
  regional pela participação de cada UF e município no SNGPC.

### Backup e restauração da base anterior

Antes da regeneração de 21/10/2026 a base foi guardada em `dados/backup-2026-10-21/` (CSVs + `var/apurador.db`).
Para voltar a ela: pare o servidor, copie `dados/backup-2026-10-21/*.csv` para `dados/`,
`dados/backup-2026-10-21/var/apurador.db*` para `var/` e `dados/backup-2026-10-21/origem.csv` para
`dados/imagens/origem.csv`, e suba o servidor de novo.
