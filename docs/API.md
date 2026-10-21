# Contrato da API do Apurador de Campanhas

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
`ModeloCampanha = { chave, nome, descricao, icone, categoria, definicao }`: modelos prontos (positivação, mix, venda casada, cesta, crescimento, ranking, meta geral, share, lançamento, recuperação de inativos, cobertura de carteira...).

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
  (reaproveita a última análise se os dados não mudaram: `reaproveitada: true`, custo 0)
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
    tipo: "faixas"|"ranking"|"rateio"|"bloco"|"nenhuma",
    faixas: [{ min: 100, fixo: 200, variavel: 0.5, rotulo: "Ouro" }],
    variavel_sobre: "total"|"excedente", criterio_base: "c1",
    ranking: { por: "score"|"realizado", minimo: 0, posicoes: [{ de: 1, ate: 1, valor: 1000 }] },   // minimo 100 = só quem bateu a meta concorre
    rateio: { valor_total: 5000, minimo: 100, proporcional: "igual"|"realizado"|"score" },
    // "a cada 15 un, R$ 10": prêmio = floor(realizado do critério-base / tamanho) × valor
    bloco: { tamanho: 15, valor: 10, sobre: "total"|"excedente", exigencia: "nenhuma"|"quantidade"|"meta", minimo: 0, max_blocos: null },
    // prêmio fixo para quem atingir `min`% da meta; soma com ranking, rateio ou bloco (ignorado em faixas)
    bonus: { ativo: false, min: 100, valor: 50 },
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
`{ fabricantes: [], marcas: [], subcategorias: [], grupos: [ids], ids: [ids de produto], excluir: [ids] }`: filtros combinam com **E**; `ids` e `grupos` **adicionam**; vazio = todos.

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
  premio_partes: [{ tipo: "faixa"|"posicao"|"rateio"|"bloco"|"bonus", rotulo, valor, blocos?, posicao? }], premio_partes_proj: [...],
                                     // componentes antes de multiplicadores e teto; premio = soma × multiplicador, limitado ao teto
  proxima_faixa: { tipo: "faixa"|"bloco"|"gatilho"|"bonus", indice?, min?, rotulo?, falta_pontos?, falta_unidades, premio,
                   exigencia?, blocos?, tamanho?, valor_bloco?, valor? }|null,   // premio = prêmio total ao chegar lá
  proximo_bonus: { tipo: "bonus", min, valor, falta_pontos, falta_unidades, premio }|null,
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
                texto: "32 de 40 un (80%). Faltam 8 un (1/dia)" }],
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

---

## 9. Adições posteriores ao contrato inicial

### Fórmulas (biblioteca) e IA de fórmulas (`server/rotas/formulas.js`)
- `GET /api/formulas` → `[{ id, nome, descricao, expressao, formato, totalizar, sentido, categoria, origem: "sistema"|"usuario"|"ia", pedido_ia, usos }]`
- `POST /api/formulas` · `PUT /api/formulas/:id` (prontas não mudam) · `DELETE /api/formulas/:id` · `POST /api/formulas/:id/uso`
- `POST /api/ia/formula` `{ pedido, expressao_atual? }` → `{ resultado: { expressao, nome, descricao, formato, totalizar, sentido, explicacao, suposicoes }, valida, erro_validacao, custo_usd, tentativas }`

### Inteligência: extras (`server/rotas/inteligencia.js`)
- `GET /api/insights/resumo`, `GET /api/ia/estimativa`, `GET /api/ia/analises/:id`, `GET /api/conhecimento/recuperar`, `GET /api/planos/tipos`
- `/api/conhecimento/fatos` aceita `id` e `validados`; o evento `fim` do chat traz `truncada` e `status`.

### Mapa: extras (`server/rotas/mapa.js`)
- `GET /api/receita/status`, `GET /api/mapa/cidade/:ibge`, `GET /api/mapa/cidades?uf=`
- `/api/prospeccao` devolve também `resumo`; `POST /api/receita/importar?assincrono=1` dispara e responde 202.
- Pontos: `campos = [id, lat, lng, tipo, rede, score, nome]`; clientes vêm como `cli-<id>`.

### Atendimento (`server/rotas/atendimento.js`, detalhes no topo do arquivo)
- `GET /api/atendimento/resumo`, `GET /api/atendimento/conversas`, `GET /api/atendimento/conversas/:id`
- `POST /api/atendimento/conversas/:id/mensagens | status | responsavel | etiquetas | prioridade | lida`
- `GET /api/atendimento/contatos`, `PUT /api/atendimento/contatos/:id`, `GET /api/atendimento/contatos/:id/contexto`
- `GET /api/atendimento/boletim?vendedor=&campanha=`, `GET /api/atendimento/respostas-rapidas`, `GET /api/atendimento/responsaveis`
- `GET /api/atendimento/canais`, `POST /api/atendimento/canais/telegram/testar | email/testar | email/ler`
- `POST /api/atendimento/simular`, `DELETE /api/atendimento/simulados`, `GET /api/atendimento/eventos` (SSE)

### Outros
- Imagens: `GET /imagens/vendedores/vendedor_{id}.jpg`; participantes de nível vendedor/equipe trazem `foto`.
- Painel: `kpis.premio_proj_orcado` (prêmio projetado só das campanhas com orçamento).
- Configuração: `telegram { token, ativo, nome_bot }`, `imap { host, porta, seguro, usuario, senha, pasta, ativo }`, `url_publica` (senhas/token mascarados no GET).

## 10. Conta corrente de fabricantes (`server/contacorrente.js`, `server/rotas/contacorrente.js`)

Verba de cada indústria (acordo comercial em % sobre compras, ND de verba negociada, VPC, bonificação em mercadoria,
rebaixa de preço, orçamento interno) e o uso dela (campanhas, ações comerciais, descontos repassados, baixa de verba
vencida). Tabelas `cc_conta` e `cc_lancamento`, criadas pelo módulo. Dados iniciais: `server/contacorrente-exemplo.js`
(roda sozinho na primeira inicialização, quando `cc_conta` está vazia).

**Lançamento**: `natureza` (`credito`|`debito`), `origem` (`acordo`, `nd`, `vpc`, `bonificacao`, `rebaixa`, `orcamento`,
`campanha`, `acao_trade`, `repasse`, `expiracao`, `ajuste`, `estorno`), `situacao` (`previsto` = provisão,
`a_receber` = ND emitida, `realizado`, `reservado`, `consumido` = reserva que virou débito, `liberado`, `cancelado`),
`documento`, `emitido_em`, `vencimento` (da ND), `validade` (da verba), `liquidado_em`, `forma_liquidacao`
(`abatimento_duplicata`|`deposito`|`mercadoria`), `comprovacao` (`pendente`|`enviada`|`aprovada`), `id_campanha`,
`id_origem` (estornos e sobras), `excecao`, `justificativa`, `autorizado_por`. Nada é apagado: realizado se estorna.

**Saldos** (`calcularSaldos`): `realizado` = créditos recebidos − débitos realizados; `a_receber`; `previsto`;
`reservado` (reservas + débitos previstos); `vencido`/`vencendo` (consumo usa primeiro a verba que vence antes; janela
de 45 dias); `disponivel` = base da política − reservado − vencido, onde a base é `realizado` (política `realizado`),
`+ a_receber` (`confirmado`, padrão) ou `+ previsto` (`previsto`); `capacidade` = disponível + `limite`.
Situação da conta: `ok`, `atencao` (ND vencida, verba vencendo ou vencida, saldo baixo), `no_limite`, `estourada`, `bloqueada`.

**Campanhas** (ganchos em `server/rotas/campanhas.js`):
- De qual conta sai a verba: `definicao.fabricante`; `varios_fornecedores` ou campanha geral → conta "Verba própria"
  (`__propria__`); sem fabricante, pelo texto de `fornecedor` ou pelos produtos dos critérios.
- Quanto reserva: `premiacao.orcamento`; senão ranking = soma das posições, rateio = verba total; senão prêmio projetado
  + folga da conta (20%); campanha futura usa o último período completo; sem histórico, o prêmio se todos baterem a meta.
- Ativar (POST/PUT com `status: 'ativa'`, ou `POST /api/campanhas/:id/status`) reserva. Sem capacidade: **409**
  `{ erro, detalhes: { codigo: 'saldo_insuficiente', conta_corrente: { nome, disponivel, limite, capacidade, necessario,
  falta, texto, ... } } }`. Para ativar mesmo assim, reenviar com `excecao_conta_corrente: { justificativa (≥ 10 letras),
  autorizado_por }`. Editar sem mudar regras de prêmio/período/participantes/fornecedor não mexe na reserva.
- Encerrar debita o prêmio apurado (comprovação pendente), consome a reserva e devolve a sobra (linha `liberado`).
  Encerrar de novo estorna o débito anterior. Reabrir (encerrada → ativa) estorna o débito e reserva de novo.
  Rascunho, arquivada ou exclusão liberam a reserva.
- As respostas de POST/PUT/status/encerrar trazem `conta_corrente` (o que foi feito com a verba).

**Endpoints**
- `GET /api/conta-corrente` → `{ hoje, totais, contas: [{ conta, saldos, situacao, rotulo_situacao, reservas, serie, n_alertas }], alertas, origens, politicas, situacoes }`
- `GET /api/conta-corrente/fabricantes` → fabricantes da base (+ verba própria) com `id_conta` quando existe
- `GET /api/conta-corrente/saldo?fabricante=&valor=` → cobertura (`disponivel`, `capacidade`, `cobre`, `falta`, `situacao`)
- `POST /api/conta-corrente/simular { definicao, id_campanha? }` → `{ fabricante, como, necessidade { valor, base, texto, aviso }, ja_reservado, delta, cobertura }`
- `GET /api/conta-corrente/campanhas/:id` → verba da campanha (reservado, prêmio projetado, lançamentos)
- `GET /api/conta-corrente/contas/:id` → conta, saldos, reservas, alertas, série mensal, `composicao_12m`
- `GET /api/conta-corrente/contas/:id/extrato?de&ate&natureza&origem&situacao&busca&limite` → linhas com `saldo_realizado` acumulado
- `POST /api/conta-corrente/contas { fabricante, ... }`, `PUT /api/conta-corrente/contas/:id { politica, limite, perc_acordo, validade_meses, prazo_nd_dias, margem_reserva, bloqueada, motivo_bloqueio, responsavel, contato, observacao }`
- `POST /api/conta-corrente/contas/:id/lancamentos { origem, natureza?, valor, data, situacao, descricao, documento, vencimento, validade, forma_liquidacao, comprovacao, observacao, excecao? }` (débito sem saldo → 409, igual às campanhas)
- `PUT /api/conta-corrente/lancamentos/:id { acao: 'emitir_nd' | 'liquidar' | 'cancelar' | 'comprovacao' | 'editar', ... }`
- `POST /api/conta-corrente/lancamentos/:id/estornar { motivo }`, `POST /api/conta-corrente/contas/:id/baixar-vencidas`

**Front**: `#/conta-corrente` e `#/conta-corrente/:id`. Componentes reutilizáveis em `web/src/paginas/contacorrente/`:
`SaldoContaCorrente({ fabricante, valorNecessario })` ou `({ definicao, idCampanha })`, `ModalExcecao` e
`bloqueioContaCorrente(erroApi)` (lê os detalhes do 409).

## 11. Mapa: malhas, bairros e territórios (`server/malhas.js`, `server/territorios.js`, `server/rotas/territorios.js`)

**Malhas** (IBGE, baixadas sob demanda para `dados/geo/`, ver `dados/geo/LEIAME.md`). Anéis vão como inteiros de
1e-5 grau com deltas: `[x0, y0, dx1, dy1, ...]` (o primeiro par é absoluto).
- `GET /api/mapa/contorno-ufs?qualidade=intermediaria|maxima` → `{ qualidade, fonte, ufs: [{ uf, a: [anel] }] }`
- `GET /api/mapa/municipios/:uf?qualidade=intermediaria|maxima` → `{ uf, qualidade, fonte, municipios: [{ ibge, nome, a }] }` (gzip)
- `GET /api/mapa/bairros/:ibge?atualizar=1` → `{ ibge, nome, uf, fonte: 'ibge-2022'|'osm'|null, fonte_info, aviso, clientes_sem_bairro,
  bairros: [{ id, nome, a, farmacias, independentes, nao_clientes, novas_12m, clientes, clientes_ativos, valor_90d, penetracao }] }`.
  Ordem das fontes: IBGE (Censo 2022) > OpenStreetMap (Overpass, uma consulta por vez) > nenhuma (cache negativo).
  OpenStreetMap fora do ar → **503** `{ erro, temporario: true }`; IBGE fora do ar sem resultado no OSM → `aviso` e nada fica em cache.
- `GET /api/mapa/malhas/status` → quantas UFs e cidades já estão em cache.
- Manutenção automática (início do servidor e depois de cada geolocalização): `manutencaoGeo()` corrige farmácias fora do
  próprio município (registro em `rf_correcao_geo`) e reposiciona clientes aproximados numa farmácia real do bairro/cidade.

**Territórios e desenhos** (tabela `territorio`: `tipo` `territorio`|`anotacao`, `nome`, `id_vendedor`, `cor` `s1`..`s8` ou `#rrggbb`,
`nota`, `forma` `poligono`|`laco`|`retangulo`|`bairro`|`cidade`|`misto`, `origem`, `geometria` = lista de anéis `[[lng, lat], ...]`, regra par-ímpar).
- `GET /api/territorios?tipo=&vendedor=` → `{ territorios: [{ ...território, vendedor { id, nome, foto }, numeros (resumo) }], vendedores: [{ id, nome, foto, equipe, cor, territorios }] }`
- `GET /api/territorios/:id` → território com `numeros` completos: `area_km2, farmacias, independentes, independentes_livres, nao_clientes,
  novas_12m, clientes, clientes_ativos, clientes_aproximados, valor_90d, potencial_90d, penetracao, conflitos, conflitos_valor,
  quem_atende [{ id, nome, foto, clientes, valor, dono }], lista_conflitos [{ id, nome, bairro, cidade, uf, valor_90d, vendedor, por: 'venda'|'cadastro' }],
  fora { clientes_do_vendedor, dentro, fora, valor_fora, lista }, sobreposicoes [{ id, nome, cor, vendedor, farmacias, clientes }], cidades, prospects`
- `POST /api/territorios/medir { geometria, id_vendedor?, id? }` → os mesmos números para uma área ainda não salva
- `POST /api/territorios { tipo, nome, id_vendedor (obrigatório para território), cor, nota, forma, origem, geometria }` → 201 + território
- `PUT /api/territorios/:id { campos parciais }`, `DELETE /api/territorios/:id`
- `GET /api/territorios/forma/cidade/:ibge` e `GET /api/territorios/forma/bairro/:ibge/:id` → `{ geometria }` (contorno oficial para virar território)
- `GET /api/territorios/:id/excel` → farmácias não clientes de dentro da área

**Front** (`#/mapa`, `?territorio=:id` abre e enquadra um território): detalhe progressivo pelo zoom (UFs → divisas municipais a partir de
k≈1,8 → malha máxima a partir de k≈20 → bairros a partir de k≈15), ferramentas Polígono, Laço livre e Retângulo, edição de vértices
(arrastar, clicar no meio de um lado cria ponto, duplo clique apaga), lista com filtro por vendedor. Motor em `web/src/paginas/mapa/motorMapa.js`,
painéis em `web/src/paginas/mapa/Territorios.jsx`.

## 12. Pipeline de dados (`server/pipeline.js`, `server/etapas/*.js`, `server/rotas/pipeline.js`)

Todo cálculo pesado roda em segundo plano, numa thread separada (`server/trabalhador.js`, tarefa `pipeline`), e é gravado
no SQLite. As rotas leem o pronto; nada pesado acontece quando alguém abre uma tela, nem depois de reiniciar o servidor.

**Etapas** (cada arquivo em `server/etapas/` chama `registrarEtapa`):

| Etapa | Depende de | Gatilhos | Grava em |
|---|---|---|---|
| `base` | | importacao, config | `dado_pronto` (`status_dados`, `dimensoes`) |
| `apuracao` | | importacao, dia, campanha, config | `apuracao_pronta` (resultado + estoque; hoje e 7 dias atrás) |
| `insights`, `planos`, `conhecimento` | apuracao | importacao, dia, campanha, plano | `insight_pronto`, `plano_pronto`, `plano_insumo`, `fato_ia` (`etapas/inteligencia.js`) |
| `mapa-*` | | receita, importacao, territorio | malhas, `mapa_resumo`, `bairro_numeros`, `territorio_numeros` (`etapas/mapa.js`) |
| `detalhes` | apuracao | importacao, dia, campanha, config | `detalhe_pronto` (boletim e detalhe por participante), `var/prontos/excel/*.xlsx` |

```js
registrarEtapa({ nome, descricao, depende: [], gatilhos: [], ordem: 50,
  assinatura: () => string,              // barata; igual à última execução bem-sucedida = etapa pulada
  executar: async (ctx) => ({ linhas }), // ctx: { eventos, detalhes, escopo, forcar, pausa(), log() }
  escopo: (detalheDoEvento) => any })    // opcional: recorte incremental
dispararPipeline(evento, detalhe?, { forcar?, atraso? })   // agrupa eventos por 1,5 s; nunca bloqueia
servirPronto(chave, { assinatura, calcular })               // { conteudo, atualizando }: pronto, ou o último + reprocessa
lerPronto(chave) / gravarPronto(chave, assinatura, conteudo)
assinaturaBase()        // persistente: última importação + MAX(rowid) das fatos + config que muda números
```

- Eventos: `importacao` (fim de importação ou mudança de config), `dia` (virada, conferida a cada minuto), `campanha`,
  `plano`, `conta_corrente`, `config`, `receita`, `territorio`, `inicio` (ao subir: só roda o que tiver assinatura nova),
  `manual`. As gravações são detectadas por um middleware (`server/rotas/_eventos.js`), sem mexer em cada rota.
- Ordem: topológica pelas dependências; entre independentes, pelo campo `ordem` (as mais demoradas por último).
- Vigia: etapa sem sinal por 20 min (`PIPELINE_LIMITE_ETAPA_MS`) é interrompida e marcada com erro; a fila segue.
  `ctx.pausa()` também serve de sinal de vida.
- `apurarComCache(definicao, { referencia, efemero, persistir })`: memória → `apuracao_pronta` → cálculo.
  Lida do banco, a apuração não traz `_interno`; ele é recalculado sob demanda só por quem precisa (detalhe, oportunidades).
  `efemero: true` (prévia do construtor) nunca consulta nem grava.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/pipeline` | `{ rodando, etapa_atual, pendente, ultima_execucao, etapas: [{ nome, descricao, depende, gatilhos, status, inicio, fim, duracao_ms, linhas, erro, execucoes }] }` |
| GET | `/api/pipeline/resumo` | `{ rodando, etapa_atual, descricao, pendente, erros }` (indicador do topo) |
| POST | `/api/pipeline/executar` | `{ forcar?: true }` processa agora (forçar refaz mesmo o que está em dia) |

Status das etapas: `ok` (em dia), `rodando`, `pendente`, `aguardando` (dependência falhou), `erro`.
Front: `useApi(caminho, { vivo: true })` refaz a busca em silêncio quando a pipeline termina (evento `dados-atualizados`).
`APURADOR_SEM_TAREFAS=1` sobe uma instância só de leitura (sem agendador, bots e pipeline), útil para medições.

## 13. Carteiras de vendas e ficha do cliente (`server/rotas/carteiras.js`)

- `GET /api/carteiras` → resumo pronto: `{ referencia, empresa, sem_dono{..., areas[]}, regioes[], equipes[], carteiras[], sugestoes[], conferencia[], atualizando }`.
  Cada carteira: `{ id, nome, cor, vendedor, gerente, coordenador, regras{cidades,bairros,...}, clientes, ativos, venda_90d, venda_dono, venda_outros, venda_fora, aderencia, farmacias, farmacias_livres, potencial_90d, penetracao, invasores[], clientes_invadidos[], indice_clientes, indice_potencial }`.
- `GET /api/carteiras/:id` → carteira com `regras[]`, `indicadores` e `prospects[]`.
- `POST /api/carteiras {id_vendedor, nome?, cor?}`, `PUT /api/carteiras/:id`, `DELETE /api/carteiras/:id`.
- `POST /api/carteiras/:id/regras {nivel: uf|cidade|bairro|territorio, uf?, ibge?, bairro_id?, nome?, id_territorio?, mover?}` (409 `regra_de_outra` se a área for de outra carteira e `mover` não vier).
- `DELETE /api/carteiras/regras/:idRegra`, `GET /api/carteiras/unidade?nivel=&ibge=&bairro_id=` (dono da área), `GET /api/carteiras/mapa` (dono de cada UF/cidade/bairro/território, para a camada do mapa).
- `GET /api/clientes/:id/ficha` → ficha pronta + `acoes` do plano de ataque.
- Pipeline: etapas `carteiras` (classificação + indicadores; tabelas `carteira`, `carteira_regra`, `carteira_cliente`, `carteira_farmacia`, `equipe_info`, `regiao_info`) e `clientes-ficha` (`dado_pronto` chave `ficha:<id>`); evento `carteira`.
