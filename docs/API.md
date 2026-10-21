# Contrato da API — Apurador de Campanhas

Base: `/api`. Tudo em JSON (UTF-8). Datas `AAAA-MM-DD`. Valores monetários em R$ (número).
Erros: HTTP 4xx/5xx com corpo `{ "erro": "mensagem amigável" }`.
Chaves de participante são sempre **string** (`"78"`, `"GO"`, `"empresa"`).

> Este arquivo é a fonte da verdade entre backend (`server/`) e frontend (`web/src/`).
> Formatos marcados com `Apuracao`, `Boletim`, `Insight`, `Fato` etc. estão definidos na seção **Tipos**.

---

## 1. Status, dimensões e catálogo

### `GET /api/status`
```json
{
  "empresa": "Minha Distribuidora",
  "hoje": "2026-10-21",
  "referencia": { "pedido": "2026-10-19", "faturamento": "2026-10-21" },
  "dados": {
    "tabelas": [{ "tabela": "fato_vendas", "linhas": 91400 }],
    "vendas": { "min": "2026-08-01", "max": "2026-10-19" },
    "ultima_importacao": { "tabela": "fato_vendas", "arquivo": "...", "linhas": 91400, "criado_em": "ISO" }
  },
  "ia": { "configurada": true, "modelo": "claude-haiku-5-5", "gasto_hoje_usd": 0.01, "limite_diario_usd": 5 },
  "receita": { "configurada": true, "farmacias": 120513, "importado_em": "ISO|null" },
  "conhecimento": { "fatos": 2300, "atualizado_em": "ISO|null" },
  "versao": 7
}
```

### `GET /api/dimensoes`
```json
{
  "fabricantes": [{ "nome": "Sanofi", "produtos": 66, "marcas": ["Dorflex", "Novalgina"] }],
  "marcas": [{ "nome": "Dorflex", "fabricante": "Sanofi", "produtos": 7 }],
  "subcategorias": [{ "nome": "Analgésicos e Antitérmicos", "produtos": 101 }],
  "canais": [{ "id": 1, "nome": "Presencial", "tipo": "Físico" }],
  "segmentos": ["Atacado"], "portes": ["Grande"], "estados": ["GO"],
  "cidades": [{ "cidade": "Goiânia", "estado": "GO", "clientes": 51 }],
  "status_venda": ["Cancelado", "Devolvido", "Faturado"],
  "cfops": [{ "cfop": "5.910", "linhas": 11542, "descricao": "Bonificação" }],
  "curvas": ["A", "B", "C"],
  "segmentos_rfv": ["Campeões", "Leais", "Em risco", "..."],
  "equipes": [{ "id": "1", "nome": "Equipe Gabriel Barbosa", "gerente": "Gabriel Barbosa", "membros": 9 }],
  "vendedores": [{ "id": "19", "nome": "Ulisses Nascimento", "id_equipe": "1", "equipe": "Gabriel Barbosa" }],
  "grupos": [{ "id": 1, "nome": "Linha Dor", "descricao": "", "seletor": { }, "n_produtos": 22 }],
  "niveis": { "vendedor": "Vendedores", "equipe": "Equipes", "cliente": "Clientes", "canal": "Canais de venda", "estado": "Estados (UF)", "segmento": "Segmentos de cliente", "empresa": "Empresa (total)" }
}
```

### `GET /api/produtos` → `[{ id, nome, fabricante, marca, categoria, subcategoria, ean, preco, ativo }]`
### `GET /api/clientes` → `[{ id, nome, cidade, estado, segmento, porte, id_vendedor, vendedor, curva, segmento_rfv }]`
### `POST /api/produtos/resolver` body `{ seletor: Seletor }` → `{ total, produtos: [{ id, nome, marca, fabricante, subcategoria, preco }] }` (até 300)

### Grupos de produtos (linhas)
- `GET /api/grupos` → `[{ id, nome, descricao, seletor, n_produtos }]`
- `POST /api/grupos` `{ nome, descricao, seletor }` → `{ id }`
- `PUT /api/grupos/:id` · `DELETE /api/grupos/:id`

### `GET /api/catalogo`
```json
{
  "metricas": { "positivacao": { "grupo": "Clientes e cobertura", "nome": "Positivação de clientes", "descricao": "...", "expr": "clientes", "formato": "numero", "totalizar": "soma", "unidade": "clientes", "sentido": "maior", "ref": false } },
  "variaveis": { "qtd": { "nome": "Unidades vendidas", "grupo": "Volume" } },
  "dimensoes_variavel": [{ "chave": "marca", "rotulo": "Marca", "fonte": "marcas" }],
  "funcoes": [{ "nome": "min", "assinatura": "min(a, b, ...)", "descricao": "Menor valor" }],
  "tipos_meta": { "fixa": "Mesma meta para todos" },
  "niveis": { "vendedor": "Vendedores" },
  "status_participante": { "atingiu": "Atingiu" },
  "modelos": [ModeloCampanha]
}
```
`ModeloCampanha = { chave, nome, descricao, icone, categoria, definicao }` — modelos prontos (positivação, mix, venda casada, cesta, crescimento, ranking, meta geral, share, lançamento, recuperação de inativos, cobertura de carteira...).

### `POST /api/catalogo/validar-formula` `{ expressao }` → `{ ok: true, variaveis: ["qtd", "valor{marca=Dorflex}"] }` ou `{ ok: false, erro }`

**Variáveis parametrizadas** (milhares de combinações): `medida{dimensao: "valor", outra: ["a", "b"]}`.
Ex.: `valor{marca: "Dorflex", canal: "App Mobile"} / valor * 100`, `clientes{curva: "A"}`, `qtd{periodo: "anterior"}`.
Dimensões: `fabricante, marca, subcategoria, grupo, produto, canal, segmento, porte, estado, cidade, curva, cfop, status, periodo`.
Filtros de produto (fabricante/marca/subcategoria/grupo/produto) **substituem** o escopo de produtos do critério; os demais **somam-se** aos filtros da campanha.

---

## 2. Campanhas e apuração

### `GET /api/campanhas?status=ativa`
```json
[{ "id": 1, "nome": "...", "fornecedor": "Haleon", "status": "ativa", "inicio": "...", "fim": "...", "cor": "#2a78d6",
   "nivel": "vendedor", "n_criterios": 2, "criado_em": "ISO", "atualizado_em": "ISO",
   "resumo": { "tempo_status": "andamento", "progresso": 0.57, "restantes": 9, "atingimento_geral": 72.1, "atingimento_geral_proj": 104.2,
               "participantes": 162, "atingiram": 40, "risco": 60, "premio_total": 1200, "premio_proj_total": 3400 } }]
```
`resumo` só para campanhas `ativa`/`encerrada` (null em rascunho).

- `GET /api/campanhas/:id` → `{ id, status, definicao: DefinicaoCampanha, criado_em, atualizado_em }`
- `POST /api/campanhas` `{ definicao, status? }` → `{ id }` (400 `{ erro, erros: [] }` se inválida)
- `PUT /api/campanhas/:id` `{ definicao, status? }` → `{ ok: true }`
- `DELETE /api/campanhas/:id` → `{ ok: true }`
- `POST /api/campanhas/:id/duplicar` → `{ id }`
- `POST /api/campanhas/:id/status` `{ status: "rascunho"|"ativa"|"encerrada"|"arquivada" }`
- `POST /api/campanhas/:id/encerrar` → `{ ok, id_fotografia }` (congela a apuração)

### `GET /api/campanhas/:id/apuracao?referencia=AAAA-MM-DD&recalcular=1&comparar=7`
Retorna `Apuracao` + `{ "congelada": false, "fotografia": null, "id_campanha": 1, "status_campanha": "ativa" }`.
Com `comparar=N`, cada participante ganha `posicao_anterior` e `movimento` (posições ganhas vs N dias antes; positivo = subiu).
Campanha encerrada devolve a fotografia de fechamento (`congelada: true`) a menos que `recalcular=1`.

### `POST /api/apuracao/previa` `{ definicao, referencia? }` → `Apuracao` (sem salvar; usada pelo construtor ao vivo)

### `GET /api/campanhas/:id/participantes/:chave?criterio=c1`
```json
{ "participante": LinhaParticipante, "criterio": CriterioApurado, "indice": 0,
  "serie": { "realizado": [..], "meta": [..], "projecao": [..] }, "dias": ["2026-10-01", ".."],
  "produtos": [{ "id", "nome", "marca", "qtd", "valor", "clientes" }],
  "clientes": [{ "id", "nome", "cidade", "estado", "qtd", "valor", "pedidos", "ultima" }],
  "vendedores": [{ "id", "nome", "qtd", "valor", "clientes" }],
  "oportunidades": [{ "id", "nome", "cidade", "estado", "segmento", "porte", "valor_hist", "qtd_hist", "ultima", "pedidos_hist", "valor_geral", "ultima_compra" }],
  "boletim": Boletim }
```

- `GET /api/campanhas/:id/estoque` → `[{ id, nome, marca, estoque, estoque_minimo, media_dia, cobertura_dias, dias_campanha_restantes, risco: "ok"|"ruptura"|"abaixo_minimo", data }]`
- `GET /api/campanhas/:id/excel` → arquivo `.xlsx` (Resumo, Apuração, Por produto, Vendas consideradas)
- `GET /api/campanhas/:id/fotografias` → `[{ id, tipo: "manual"|"fechamento", observacao, data_referencia, criado_em }]`
- `POST /api/campanhas/:id/fotografias` `{ observacao }` → `{ id }`
- `GET /api/fotografias/:id` → `Apuracao`

---

## 3. Boletins (informação, não dados) e acompanhamentos

### `GET /api/campanhas/:id/boletins?filtro=todos|risco|nao_atingiu|atingiu|perto_faixa`
→ `[Boletim]` (um por participante, já com destaques em linguagem natural)

### `GET /api/campanhas/:id/boletins/:chave` → `Boletim`

### Modelos de mensagem
- `GET /api/modelos-mensagem` → `[{ id, nome, destino: "participantes"|"gerentes"|"geral", assunto, corpo, criado_em }]`
- `POST /api/modelos-mensagem` · `PUT /api/modelos-mensagem/:id` · `DELETE /api/modelos-mensagem/:id`
- `GET /api/variaveis-mensagem` → `[{ chave: "{nome}", descricao, exemplo, destino: "participantes"|"gerentes"|"geral"|"todos" }]`

### `POST /api/campanhas/:id/mensagens/previa`
Body `{ id_modelo?, corpo?, assunto?, destino: "participantes"|"gerentes"|"geral", filtro: "todos"|"risco"|"nao_atingiu"|"atingiu"|"perto_faixa", chaves?: [] }`
→ `[{ chave, destinatario, contato: { telefone, email }, assunto, texto, html, whatsapp_url }]`

### `POST /api/campanhas/:id/disparos`
Body = prévia + `canal: "whatsapp"|"email"|"webhook"|"registro"`
→ `{ total, enviados, simulados, erros, itens: [{ chave, destinatario, status, erro, whatsapp_url }] }`
(WhatsApp gera links `wa.me` e registra como `pendente`; e-mail sem SMTP configurado vira `simulado`.)

- `GET /api/disparos?campanha=&limite=200` → `[{ id, id_campanha, campanha, canal, destinatario, contato, assunto, mensagem, status, erro, criado_em }]`
- `POST /api/disparos/:id/marcar` `{ status: "enviado" }`

### Agendamentos (envio automático)
- `GET /api/agendamentos` → `[{ id, nome, id_campanha (null = todas ativas), campanha, id_modelo, modelo, canal, filtro, lista, dias_semana: [1,2,3,4,5], hora: "08:00", ativo, ultima_execucao, proxima_execucao }]`
- `POST /api/agendamentos` · `PUT /api/agendamentos/:id` · `DELETE /api/agendamentos/:id`
- `POST /api/agendamentos/:id/executar` → resultado do disparo

---

## 4. Painel, insights e qualidade de dados

### `GET /api/painel`
```json
{
  "hoje": "...", "referencia": "...",
  "kpis": { "campanhas_ativas": 6, "participantes": 900, "atingiram": 210, "em_risco": 300, "premio_total": 0, "premio_proj_total": 0,
            "orcamento_total": 0, "faturamento_campanhas": 0, "alertas_criticos": 3 },
  "campanhas": [{ "id", "nome", "fornecedor", "cor", "status", "nivel_rotulo",
                  "tempo": { "status", "progresso", "restantes", "total", "calendario", "inicio", "fim", "referencia" },
                  "criterios": [{ "nome", "formato", "unidade", "realizado", "meta", "atingimento", "projecao", "atingimento_proj" }],
                  "resumo": ResumoApuracao, "serie": { "dias": [], "realizado": [], "meta": [], "projecao": [] },
                  "lideres": [{ "chave", "nome", "score", "premio_proj" }], "alertas": 2 }],
  "alertas": [Insight],
  "ranking_geral": [{ "chave", "nome", "equipe", "campanhas", "media_score", "premio_proj", "atingiu" }],
  "atividade": [{ "tipo": "disparo"|"importacao"|"campanha", "texto", "criado_em" }]
}
```

### `GET /api/insights?campanha=&severidade=` → `[Insight]` (regras automáticas, custo zero)
### `GET /api/qualidade-dados` → `[{ regra, descricao, valor_a, valor_b, divergencias, ok, detalhe, criado_em }]`

---

## 5. Base de conhecimento e IA (Claude Haiku 5.5, com teto diário)

- `GET /api/ia/status` → `{ configurada, modelo, chave_mascarada, gasto_hoje_usd, limite_diario_usd, chamadas_hoje, gasto_mes_usd, historico: [{ dia, custo_usd, chamadas }] }`
- `GET /api/conhecimento/resumo` → `{ fatos, validados, invalidos, por_escopo: { campanha: 40 }, atualizado_em, duracao_ms }`
- `GET /api/conhecimento/fatos?escopo=&chave=&q=&limite=50` → `[Fato]`
- `POST /api/conhecimento/atualizar` → `{ fatos, validados, invalidos, duracao_ms }`
- `POST /api/ia/analisar` `{ tipo: "campanha"|"geral"|"vendedor", referencia?, forcar?: false }` → `AnaliseIA`
  (reaproveita a última análise se os dados não mudaram — `reaproveitada: true`, custo 0)
- `GET /api/ia/analises?tipo=&referencia=` → `[AnaliseIA]` (sem `fatos_usados`)
- `POST /api/ia/perguntar` `{ pergunta, historico: [{ papel: "usuario"|"ia", texto }], contexto?: { campanha?, vendedor? } }`
  → **SSE** (`text/event-stream`): `event: fatos` (`[Fato]`), `event: texto` (`{ "delta": "..." }`), `event: fim` (`{ custo_usd, verificacao }`), `event: erro` (`{ erro }`)
- `POST /api/ia/roteiro` `{ vendedor, itens: [indices do plano] }` → `{ resultado: { abertura, roteiro: [{ cliente, abordagem, argumentos: [], oferta }], fechamento }, custo_usd }`

---

## 6. Planos de ataque e retroalimentação

### `GET /api/planos?vendedor=ID&campanha=ID?`
```json
{ "vendedor": { "id", "nome", "equipe" }, "gerado_em": "ISO",
  "resumo": { "clientes": 25, "potencial_total": 18400, "por_tipo": { "recompra": 8 } },
  "itens": [{ "id_cliente", "cliente", "cidade", "estado", "segmento", "porte", "curva", "segmento_rfv",
              "tipo": "recompra"|"cross_sell"|"queda"|"campanha"|"inativo",
              "titulo", "motivo", "produtos_sugeridos": [{ "marca", "produto"?, "id_produto"? }],
              "valor_potencial", "score", "evidencias": ["..."], "taxa_conversao_tipo": 0.32 }] }
```
- `GET /api/planos/equipe?equipe=ID` → `[{ vendedor, id, clientes, potencial_total, por_tipo }]`
- `POST /api/planos/registrar` `{ vendedor, campanha?, itens: [ItemPlano] }` → `{ registradas }`
- `GET /api/recomendacoes?status=&vendedor=` → `[{ id, tipo, cliente, vendedor, motivo, valor_potencial, status, convertida_em, valor_convertido, criado_em }]`
- `GET /api/recomendacoes/resumo` → `{ total, convertidas, taxa, valor_convertido, por_tipo: [{ tipo, total, convertidas, taxa, valor_convertido }] }`

---

## 7. Mapa e prospecção (Receita Federal)

- `GET /api/mapa/base` → `{ ufs: GeoJSON FeatureCollection (properties: { uf, nome }) }`
- `GET /api/mapa/resumo?campanha=` →
```json
{ "ufs": [{ "uf", "farmacias", "independentes", "clientes", "clientes_ativos", "penetracao", "valor_90d", "potencial" }],
  "cidades": [{ "ibge", "nome", "uf", "lat", "lng", "farmacias", "independentes", "abertas_12m", "clientes", "clientes_ativos",
                "valor_90d", "penetracao", "potencial", "prioridade": 0..100, "acao": "texto curto" }],
  "totais": { "farmacias", "independentes", "clientes", "clientes_ativos", "cidades_com_venda", "cidades_sem_venda" } }
```
- `GET /api/mapa/pontos?bbox=oeste,sul,leste,norte&limite=20000` →
  `{ "campos": ["cnpj","lat","lng","tipo","rede","score"], "linhas": [[...]], "truncado": false }`
  (`tipo`: `"cliente_ativo"|"cliente_inativo"|"prospect"`)
- `GET /api/mapa/farmacia/:cnpj` → detalhe completo (endereço, telefone, e-mail, rede, porte, abertura, sócio, nota, cliente vinculado e compras)
- `GET /api/prospeccao?uf=&cidade=&bairro=&independentes=1&abertas_meses=&ordenar=score|abertura|nome&pagina=1&por_pagina=50`
  → `{ total, itens: [{ cnpj, nome, razao_social, endereco, bairro, cidade, uf, cep, telefone, email, porte, rede, abertura, nota, score, lat, lng, cliente }] }`
- `GET /api/prospeccao/excel?...` → `.xlsx`
- `POST /api/receita/importar` → `{ farmacias, com_coordenadas, duracao_ms }`

---

## 8. Dados e configurações

- `POST /api/importar/pasta` → `{ importados: [{ tabela, arquivo, linhas, modo }], ignorados: [] }`
- `POST /api/importar/arquivo?nome=arquivo.csv&tabela=&modo=substituir|mesclar` (corpo: o CSV bruto) → `{ tabela, arquivo, linhas, modo, colunas_ignoradas }`
- `GET /api/importacoes` → `[{ id, tabela, arquivo, modo, linhas, criado_em }]`
- `GET /api/config` → configuração (senhas mascaradas) + `feriados_efetivos: [{ data, nome }]`
- `PUT /api/config` (parcial) → `{ ok }`
- `POST /api/config/testar-email` `{ para }` · `POST /api/config/testar-webhook`

---

## Tipos

### DefinicaoCampanha
```js
{
  nome, fornecedor, descricao, cor: "#rrggbb"|null,
  inicio, fim, data_base: "pedido"|"faturamento", status_venda: ["Faturado"], calendario: "uteis"|"corridos"|null,
  participantes: { nivel: "vendedor"|"equipe"|"cliente"|"canal"|"estado"|"segmento"|"empresa", ids: [], equipes: [] },
  filtros: { canais: [], segmentos: [], portes: [], estados: [], cidades: [], curvas: [], clientes: [], cfops: [], cfops_excluir: [] },
  criterios: [Criterio],
  apuracao: { regra: "ponderada"|"todos"|"qualquer" },
  premiacao: {
    tipo: "faixas"|"ranking"|"rateio"|"nenhuma",
    faixas: [{ min: 100, fixo: 200, variavel: 0.5, rotulo: "Ouro" }],
    variavel_sobre: "total"|"excedente", criterio_base: "c1",
    ranking: { por: "score"|"realizado", minimo: 0, posicoes: [{ de: 1, ate: 1, valor: 1000 }] },
    rateio: { valor_total: 5000, minimo: 100, proporcional: "igual"|"realizado"|"score" },
    multiplicadores: [{ criterio: "c2", min: 100, fator: 1.2, senao: 0.5 }],
    teto_participante: null, orcamento: null
  }
}
```

### Criterio
```js
{
  id: "c1", nome,
  produtos: Seletor, produtos_ref: Seletor,          // produtos_ref = denominador de share (padrão: mesma subcategoria)
  metrica: "<chave do catálogo>", expressao: "",      // expressao só para metrica = "personalizada"
  formato: "numero"|"moeda"|"perc"|"decimal", totalizar: "soma"|"media", sentido: "maior"|"menor",
  combo: { itens: [{ nome, produtos: Seletor, minimo: 2 }], escopo: "pedido"|"cliente", contar: "ocorrencias"|"kits" },
  regra_cliente: { min_qtd: 0, min_valor: 0, min_skus: 0, min_marcas: 0, min_pedidos: 0 },  // positivação qualificada
  regra_pedido: { min_qtd: 0, min_valor: 0 },
  regra_sku: { min_clientes: 0 },                                                         // SKU positivado em ≥ N clientes
  novos: { dias: 90 },
  meta: { tipo: "fixa"|"distribuida"|"historico"|"meta_geral"|"sem_meta", valor, distribuir_por: "igual"|"historico"|"meta_geral",
          crescimento: 10, piso: 0, base_inicio, base_fim, campo: "meta_valor"|"meta_quantidade", fator: 100, arredondar, valores: { "<chave>": 123 } },
  peso: 1, gatilho: 0, teto: null
}
```

### Seletor
`{ fabricantes: [], marcas: [], subcategorias: [], grupos: [ids], ids: [ids de produto], excluir: [ids] }` — filtros combinam com **E**; `ids` e `grupos` **adicionam**; vazio = todos.

### Apuracao (resultado do motor)
```js
{
  gerado_em, duracao_ms,
  campanha: DefinicaoCampanha normalizada + { nivel_rotulo, nivel_singular },
  tempo: { status: "futura"|"andamento"|"encerrada", inicio, fim, referencia, total, decorridos, restantes, progresso, calendario: "úteis"|"corridos", dias: [], contaveis: [bool], idx_ref, dias_para_inicio },
  criterios: [CriterioApurado],
  participantes: [LinhaParticipante],
  resumo: ResumoApuracao,
  avisos: ["..."]
}
CriterioApurado = { id, nome, metrica, metrica_nome, formato, unidade, sentido, totalizar, peso, gatilho, teto, meta_tipo,
  produtos_descricao, n_produtos, produtos_amostra: [], periodo_base: { inicio, fim },
  total: { realizado, meta, atingimento, projecao, atingimento_proj, base, variacao_proj, qtd, valor },
  serie: { realizado: [], meta: [], projecao: [] } }
LinhaParticipante = { chave, nome, grupo, id_grupo, contato: { telefone, email }, responsavel: { chave, nome, telefone, email }|null,
  criterios: [{ realizado, meta, atingimento, projecao, atingimento_proj, falta, ritmo_necessario, qtd, valor }],
  score, elegivel, score_proj, elegivel_proj, vendeu, premio, premio_proj, faixa, faixa_proj, multiplicador,
  proxima_faixa: { indice, min, falta_pontos, falta_unidades, premio }|null,
  status: "atingiu"|"no_ritmo"|"atencao"|"risco"|"nao_atingiu"|"sem_meta"|"aguardando",
  posicao, posicao_proj, posicao_anterior?, movimento? }
ResumoApuracao = { participantes, com_venda, atingiram, no_ritmo, atencao, risco, nao_atingiu, sem_meta, aguardando,
  premio_total, premio_proj_total, orcamento, uso_orcamento, uso_orcamento_proj, atingimento_geral, atingimento_geral_proj }
```

### Boletim
```js
{
  chave, nome, primeiro_nome, contato: { telefone, email }, responsavel,
  campanha: { id, nome, fornecedor, inicio, fim, dias_restantes, calendario, referencia },
  status, status_rotulo, posicao, total_participantes, movimento,
  score, score_proj, premio, premio_proj, proxima_faixa,
  criterios: [{ nome, unidade, formato, realizado, meta, atingimento, projecao, atingimento_proj, falta, ritmo_necessario,
                texto: "32 de 40 un (80%) — faltam 8 un, 1/dia" }],
  destaques: [{ tipo: "positivo"|"alerta"|"acao"|"info", texto }],   // frases geradas pelo motor (narrativa)
  comparativo: { media_score, lider_nome, lider_score, distancia_lider, percentil },
  oportunidades: [{ cliente, cidade, motivo, valor_hist, ultima }],  // top 5 clientes a atacar
  alertas_estoque: [{ produto, cobertura_dias }]
}
```

### Insight
`{ id, campanha_id, campanha, tipo, severidade: "critica"|"alta"|"media"|"info"|"positiva", titulo, descricao, valor?, participantes?: [chaves], acao?: { rotulo, rota }, gerado_em }`

### Fato (base de conhecimento)
`{ id: "F-cmp-3-tot", escopo: "campanha"|"vendedor"|"cliente"|"marca"|"associacao"|"geral"|"retroalimentacao"|"qualidade", chave, tipo, titulo, texto, dados: {}, relevancia, validado: true, validacao: { metodo, a, b, diferenca, ok }, gerado_em }`

### AnaliseIA
```js
{ id, tipo, referencia, criado_em, custo_usd, reaproveitada,
  resultado: { resumo, saude: "otima"|"boa"|"atencao"|"critica", probabilidade_meta,
    destaques: [{ titulo, detalhe, tipo: "positivo"|"alerta"|"risco"|"oportunidade", fontes: ["F-.."], verificado }],
    acoes: [{ titulo, detalhe, responsavel, impacto: "alto"|"medio"|"baixo", prazo, fontes, verificado }],
    oportunidades_clientes: [{ cliente, participante, motivo, sugestao, fontes, verificado }],
    mensagem_equipe },
  fatos_usados: [Fato],
  verificacao: { citacoes_validas, citacoes_invalidas, numeros_conferidos, numeros_nao_encontrados, aprovado } }
```
