import { Explica } from '../componentes/ui.jsx';

/* =====================================================================
   Textos do "i" de explicação, num lugar só para que a mesma ideia seja
   explicada do mesmo jeito em todas as telas. Linguagem simples, de quem
   vende, com exemplo numérico quando ajuda.
   ===================================================================== */

/** Rótulo com o "i" ao lado. Use onde o componente recebe só texto (KPIs, títulos de bloco). */
export function ComInfo({ children, titulo, tamanho = 13, ...info }) {
  return (
    <span className="com-explica" style={{ display: 'inline-flex', minWidth: 0 }}>
      <span className="truncar">{children}</span>
      <Explica titulo={titulo ?? (typeof children === 'string' ? children : undefined)} tamanho={tamanho} {...info} />
    </span>
  );
}

const SITUACOES = 'Atingiu: já passou de 100% da meta. No ritmo: ainda não bateu, mas a projeção passa de 100%. Atenção: projeção entre 85% e 99%. Em risco: projeção abaixo de 85%. Não atingiu: a campanha acabou abaixo da meta. Sem meta: participante sem meta definida (campanha de ranking, por exemplo).';

export const EXPLICA = {
  // ---------------------------------------------------------------- conceitos gerais
  atingimento: {
    texto: 'Quanto da meta já foi alcançado, em porcentagem. 100% é a meta batida.',
    exemplo: 'Meta de 200 unidades e 150 vendidas: atingimento de 75%.',
  },
  projecao: {
    texto: 'Onde o número deve terminar no último dia se o ritmo continuar. O sistema olha o que já foi vendido, a média dos últimos dias e como o mês anterior se comportou (o fim de mês costuma vender mais).',
    exemplo: 'Vendeu 60 un em 10 dos 20 dias úteis: a projeção fica perto de 120 un.',
  },
  pontuacao: {
    texto: 'A nota do participante na campanha, em % da meta. Com vários critérios, junta todos conforme a regra da campanha (média com pesos, cumprir todos ou o melhor).',
    exemplo: 'Critério A com 120% e peso 2, critério B com 90% e peso 1: pontuação de 110%.',
  },
  situacao: {
    texto: SITUACOES,
    como: 'Clique numa cor ou num filtro de situação para ver só aquelas pessoas.',
  },
  periodoAnterior: {
    texto: 'O mesmo critério medido no período anterior de mesma duração (ou no período-base escolhido na campanha). Serve de comparação e, em metas de crescimento, de base para a meta.',
  },
  ritmo: {
    texto: 'A barra colorida é o atingimento. O traço escuro marca quanto do período já passou. O tracinho tracejado é a projeção e a linha fina no fim é a meta (100%).',
    como: 'Se a barra passa do traço do tempo, a campanha está à frente do ritmo. Se fica antes, está atrasada.',
    exemplo: 'Metade do mês passou (50%) e a campanha está com 60%: está 10 pontos à frente.',
  },
  graficoRealizado: {
    texto: 'Linha cheia: o que já foi vendido, acumulado dia a dia. Tracejado cinza: o ritmo ideal para chegar exatamente na meta. Tracejado colorido: a projeção até o último dia.',
    como: 'Passe o mouse sobre o gráfico para ver os números de cada dia.',
  },

  // ---------------------------------------------------------------- painel
  painelCampanhasAtivas: {
    texto: 'Campanhas com situação "ativa". Embaixo, quanto já foi vendido dos produtos que entram nelas.',
    como: 'Clique para abrir a lista de campanhas.',
  },
  painelParticipantes: {
    texto: 'Soma das pessoas (ou equipes, clientes) que participam de cada campanha ativa. Quem está em 3 campanhas conta 3 vezes.',
  },
  painelAtingiram: {
    texto: 'Participantes que já chegaram a 100% da meta, somando todas as campanhas ativas.',
  },
  painelRisco: {
    texto: 'Participantes cuja projeção para o fim da campanha fica abaixo de 85% da meta. São os que mais precisam de atenção agora.',
    exemplo: 'Meta de 100 un e projeção de 70 un: está em risco.',
  },
  painelPremios: {
    texto: 'Quanto deve ser pago em prêmios se cada participante mantiver o ritmo até o fim. A barra compara com o orçamento informado nas campanhas.',
    exemplo: 'R$ 9 mil projetados para um orçamento de R$ 10 mil: 90% do orçamento.',
  },
  painelAlertas: {
    texto: 'Problemas graves encontrados sozinhos nas apurações: campanha que não vai bater, prêmio passando do orçamento, estoque acabando, vendedor parado.',
    como: 'Clique para ver todos na Central de insights.',
  },
  painelCampanhas: {
    texto: 'Um cartão por campanha. O número grande é o atingimento geral: quanto a campanha inteira já fez da meta somada de todos. A seta embaixo dele é a projeção para o último dia.',
    como: [
      'No gráfico, linha cheia é o vendido até hoje, tracejado cinza é o ritmo ideal e tracejado colorido é a projeção.',
      'A régua compara o atingimento (barra) com o tempo que já passou (traço). "À frente" quer dizer que vende mais rápido do que o necessário.',
      'A barra colorida embaixo mostra quantos participantes estão em cada situação.',
      'Clique no cartão para abrir a apuração completa.',
    ],
    exemplo: 'Metade do mês passou (50%) e a campanha está com 60%: à frente 10 p.p.',
  },
  painelRanking: {
    texto: 'Os vendedores com melhor média de pontuação em todas as campanhas ativas de que participam. "Prêmio proj." soma o que cada um deve ganhar se mantiver o ritmo.',
    exemplo: 'Ana está em duas campanhas, com 120% e 80%: a média dela é 100%.',
  },
  painelListaAlertas: {
    texto: 'Os avisos mais importantes do momento, do mais grave para o mais leve. São gerados automaticamente a cada atualização dos dados, sem custo de IA.',
    como: 'Clique num alerta para ir direto ao ponto (campanha, vendedor ou central de insights).',
  },
  painelEncerrando: {
    texto: 'Campanhas que terminam nos próximos 7 dias e as que já terminaram mas ainda não foram encerradas.',
    como: [
      '"Vai bater": projeção de 100% ou mais. "No limite": entre 85% e 99%. "Não bate": abaixo de 85%.',
      'Campanha que terminou precisa ser encerrada: isso congela a apuração para pagar os prêmios.',
    ],
  },
  painelAtividade: {
    texto: 'O que aconteceu por último no sistema: disparos de acompanhamento, importação de dados, campanhas criadas e análises da IA.',
  },

  // ---------------------------------------------------------------- lista de campanhas
  listaCampanhas: {
    texto: 'Todas as campanhas cadastradas. Cada uma é apurada sozinha, todo dia, com os dados mais recentes.',
    como: [
      'Use os filtros de situação para ver ativas, agendadas, rascunhos ou encerradas.',
      'Clique numa campanha para ver a apuração. O menu "..." duplica, edita ou encerra.',
    ],
  },
  situacaoCampanha: {
    texto: 'Ativa: valendo agora. Agendada: ativa, mas o período ainda não começou. Aguardando fechamento: o período acabou e falta encerrar. Rascunho: ainda em montagem, não aparece para a equipe. Encerrada: resultado congelado.',
  },

  // ---------------------------------------------------------------- apuração da campanha
  heroiAtingimento: {
    texto: 'Quanto a campanha inteira já alcançou da meta total, somando todos os participantes. O anel mostra o mesmo número.',
    como: 'Ao lado aparece a projeção: se ela passa de 100%, a campanha deve bater a meta.',
    exemplo: 'Meta somada de 1.000 un e 620 vendidas: 62%.',
  },
  heroiSituacao: {
    texto: SITUACOES,
    como: 'Passe o mouse sobre cada cor para ver quantas pessoas estão em cada situação.',
  },
  bateram: {
    texto: 'Quantos participantes já chegaram a 100% ou mais (e cumprem as demais regras, como mínimo em cada critério).',
  },
  devemBater: {
    texto: 'Quantos participantes chegam a 100% no último dia se mantiverem o ritmo de hoje. "Precisam acelerar" soma os que estão em atenção e em risco.',
  },
  naoAtingiram: {
    texto: 'Participantes que terminaram a campanha abaixo da meta.',
  },
  premiacaoApurada: {
    texto: 'Quanto seria pago se a campanha terminasse hoje, pelas regras de prêmio da campanha. "Proj." é o valor esperado no fim, no ritmo atual. A barra compara com o orçamento.',
  },
  faturamentoEscopo: {
    texto: 'Valor vendido (R$) dos produtos do critério principal, somando todos os participantes. Ajuda a ver o tamanho do negócio que a campanha movimenta.',
  },
  comVenda: {
    texto: 'Quantos participantes já venderam pelo menos uma vez os produtos da campanha.',
  },
  lider: {
    texto: 'Quem está em primeiro agora e com quanta vantagem sobre o segundo.',
  },
  metaTotal: {
    texto: 'Soma das metas de todos os participantes no critério principal.',
  },
  exigencia: {
    texto: 'Quanto a meta total pede a mais (ou a menos) do que foi vendido no período anterior.',
    exemplo: 'Período anterior de 1.000 un e meta de 1.100 un: exigência de +10%.',
  },
  orcamento: {
    texto: 'Valor máximo previsto para pagar prêmios nesta campanha. O sistema avisa quando a projeção passa dele.',
  },
  criterio: {
    texto: 'Um critério é uma das coisas medidas na campanha (unidades, faturamento, clientes positivados...). O cartão mostra o total de todos os participantes.',
    como: [
      'Realizado: o que já foi feito. Meta: o objetivo somado. Atingimento: realizado ÷ meta.',
      'Projeção: onde deve terminar no ritmo atual. Período anterior: a mesma conta no período passado.',
      'No gráfico, passe o mouse para ver cada dia.',
    ],
  },
  posicaoEm: {
    texto: 'Volta no tempo: mostra a campanha como estava na data escolhida (ranking, atingimento e projeção daquele dia).',
    como: 'Escolha a data. Para voltar ao dia de hoje, clique em "Hoje".',
    exemplo: 'Quer saber quem liderava na reunião de segunda? Escolha a data da segunda.',
  },
  abasCampanha: {
    texto: 'Ranking: a classificação de todos. Equipes: a média de cada grupo. Produtos e estoque: se o estoque aguenta até o fim. Fotografias: apurações congeladas em datas passadas. Avisos: pontos de atenção da configuração.',
  },
  ranking: {
    texto: 'Classificação dos participantes. A barra mostra o atingimento, o selo mostra a situação e a seta mostra quantas posições subiu ou caiu na última semana.',
    como: [
      '"Posição atual" ordena pelo resultado de hoje. "Projeção final" mostra como o ranking deve terminar.',
      'Clique em alguém para abrir o detalhe com clientes para atacar.',
      'Os filtros de situação mostram só quem está em risco, no ritmo etc.',
    ],
  },
  equipes: {
    texto: 'Média de pontuação de cada grupo (equipe, gerente, região). A linha vertical marca 100%.',
    como: 'Clique num grupo para ver o ranking só com as pessoas dele.',
  },
  estoque: {
    texto: 'Para cada produto da campanha: estoque atual, mínimo e por quantos dias o estoque dura no ritmo de venda dos últimos 30 dias (cobertura).',
    como: 'Se a cobertura é menor que os dias que faltam de campanha, o produto pode faltar. Avise compras antes.',
    exemplo: '300 un em estoque vendendo 20 por dia: cobertura de 15 dias.',
  },
  fotografias: {
    texto: 'Uma fotografia guarda a apuração exatamente como estava num momento. Mesmo que os dados mudem depois, ela não muda.',
    como: [
      'Use "Fotografar agora" antes de reuniões ou fechamentos parciais.',
      'Ao encerrar a campanha, o sistema tira a fotografia de fechamento sozinho. É ela que vale para o pagamento.',
    ],
  },
  gavetaPremio: {
    texto: 'Prêmio atual: quanto ganharia se a campanha terminasse hoje. Prêmio projetado: quanto deve ganhar no fim, no ritmo atual.',
  },
  gavetaOportunidades: {
    texto: 'Clientes que costumam comprar com este vendedor (ou são da carteira dele) e ainda não compraram os produtos deste critério na campanha. Os primeiros são os que mais compravam antes.',
    como: 'Use a lista para montar a rota ou a ligação do dia.',
  },
  gavetaDestaques: {
    texto: 'Frases montadas a partir dos números deste participante: o que falta, ritmo necessário, movimentos no ranking e alertas. Nada é inventado, tudo vem da apuração.',
  },

  // ---------------------------------------------------------------- boletim
  boletim: {
    texto: 'O boletim é a página que o participante recebe: posição, quanto falta, quanto rende e quais clientes atacar.',
    como: 'Use "Copiar texto" ou "WhatsApp" para enviar, ou imprima com Ctrl+P.',
  },
  boletimPosicaoRelativa: {
    texto: 'Quantos por cento dos participantes estão atrás desta pessoa.',
    exemplo: '80% quer dizer que ela está à frente de 8 em cada 10 participantes.',
  },

  // ---------------------------------------------------------------- acompanhamentos
  acompanhamentos: {
    texto: 'Aqui você manda para cada pessoa a situação dela na campanha, com os números já calculados.',
    como: [
      'Disparar: escolha campanha, público e modelo; confira a prévia e envie.',
      'Modelos de mensagem: textos com variáveis que viram os números de cada pessoa.',
      'Envio automático: mensagens que saem sozinhas em dias e horários fixos.',
      'Caixa de saída: tudo o que foi enviado e a situação de cada envio.',
    ],
  },
  disparoPublico: {
    texto: 'Participantes: cada pessoa recebe a própria situação. Gerentes: cada gerente recebe o resumo da equipe dele. Geral: um resumo da campanha para diretoria, trade ou fornecedor.',
  },
  disparoCanal: {
    texto: 'WhatsApp: o sistema monta as mensagens e você clica para abrir cada conversa já com o texto. E-mail: envia direto pelo e-mail configurado (sem configuração, fica só simulado). Webhook: entrega para outro sistema. Só registrar: guarda na caixa de saída sem enviar.',
  },
  variaveis: {
    texto: 'Palavras entre chaves, como {nome} ou {falta}, que o sistema troca pelos números de cada pessoa na hora de enviar.',
    como: 'Clique numa variável para inserir no texto onde está o cursor.',
    exemplo: '"Oi {nome}, faltam {falta}" vira "Oi Ana, faltam 23 un".',
  },
  agendamentos: {
    texto: 'Envio automático: na hora marcada o sistema recalcula a apuração e manda a mensagem para o público escolhido.',
    como: 'Funciona enquanto o servidor estiver ligado. Use "Executar agora" para testar.',
  },
  historico: {
    texto: 'Tudo o que foi enviado. "Pendente" no WhatsApp quer dizer que o link foi gerado mas ainda não foi marcado como enviado.',
  },
  modelos: {
    texto: 'Textos prontos para os acompanhamentos. Cada modelo tem um público (participante, gerente ou geral) e usa variáveis que viram números.',
    como: 'Edite um modelo e veja a prévia com os dados de uma pessoa real.',
  },

  // ---------------------------------------------------------------- atendimento
  atendimento: {
    texto: 'Central das conversas com os vendedores pelo Telegram e por e-mail. O bot responde sozinho comandos como /boletim e /ranking; o resto chega aqui para alguém da equipe responder.',
    como: [
      'Conversas: a lista e o chat, como no WhatsApp.',
      'Kanban: as conversas em colunas (novos, em atendimento, aguardando, resolvidos). Arraste para mudar.',
      'Canais: configuração do bot do Telegram e da caixa de e-mail.',
      'Contatos: quem já falou com a central e a qual vendedor ou cliente está ligado.',
    ],
  },
  atendimentoKanban: {
    texto: 'Cada cartão é uma conversa. As colunas mostram em que pé está o atendimento.',
    como: 'Arraste o cartão para outra coluna ou abra a conversa para responder.',
  },
  atendimentoContatos: {
    texto: 'Pessoas que já mandaram mensagem. Quando o telefone ou e-mail bate com o cadastro de um vendedor, o sistema liga os dois e o bot passa a responder com os números dele.',
    como: 'Se não ligou sozinho, use o botão de vínculo para dizer quem é a pessoa.',
  },
  atendimentoCanais: {
    texto: 'Telegram: crie um bot no @BotFather, cole o token aqui e ligue o recebimento. E-mail: dados da caixa de entrada (IMAP) para ler as mensagens; o envio usa o SMTP de Configurações.',
  },
  identificacao: {
    texto: 'Os comandos só funcionam para quem está identificado. O vendedor se identifica compartilhando o telefone com o bot; se o número estiver no cadastro, a conversa fica ligada a ele.',
    exemplo: 'O vendedor manda /boletim e recebe na hora a posição, quanto falta e os clientes para atacar.',
  },

  // ---------------------------------------------------------------- catálogo
  catalogo: {
    texto: 'Todas as métricas, variáveis e regras que o sistema sabe apurar, com um espaço de teste (playground) para montar fórmulas com os dados reais.',
    como: [
      'Métricas: o que dá para medir num critério.',
      'Playground: escreva uma fórmula (ou peça para a IA escrever) e veja o resultado por vendedor.',
      'Minhas fórmulas: as fórmulas salvas para usar em campanhas.',
    ],
  },
  metricas: {
    texto: 'Cada métrica é uma forma pronta de medir: unidades, faturamento, clientes que compraram, mix de produtos, venda casada, crescimento...',
    como: 'Clique numa métrica para ver o que ela conta e um exemplo.',
  },
  variaveisFormula: {
    texto: 'Os números que podem ser usados numa fórmula. Cada um é calculado por participante, dentro dos produtos e do período da campanha.',
    exemplo: 'valor / clientes = ticket médio por cliente.',
  },
  recortes: {
    texto: 'Um recorte limita a variável a uma parte das vendas, escrito entre chaves.',
    exemplo: 'qtd{marca: "Dorflex"} conta só as unidades de Dorflex.',
  },
  playground: {
    texto: 'Espaço para testar uma fórmula com os dados reais sem criar campanha.',
    como: [
      'Escreva a fórmula ou descreva em português para a IA montar.',
      'Escolha produtos e período e veja o resultado por participante.',
      'Gostou? Salve a fórmula ou use direto numa campanha.',
    ],
  },

  // ---------------------------------------------------------------- dados e configurações
  dados: {
    texto: 'De onde vêm os números: vendas, clientes, produtos, vendedores, estoque e metas, importados de arquivos CSV do seu sistema.',
    como: [
      'Arraste um CSV para atualizar uma tabela, ou use "Reimportar pasta" para ler todos da pasta dados/.',
      'Depois da importação, todas as campanhas são recalculadas sozinhas.',
    ],
  },
  dadosTabelas: {
    texto: 'Cada tabela do seu sistema de vendas e quantas linhas tem hoje. "Vendas" é a base de toda apuração.',
  },
  dadosReceita: {
    texto: 'Farmácias ativas no cadastro da Receita Federal, usadas no mapa para mostrar onde há clientes que ainda não compram de nós.',
  },
  dadosImportacoes: {
    texto: 'Cada importação feita, com quantas linhas entraram e quanto tempo levou.',
  },
  configGeral: {
    texto: 'Nome da empresa, calendário (dias úteis ou corridos) e a data de referência das apurações.',
  },
  calendario: {
    texto: 'Dias úteis: só segunda a sexta, sem feriados, contam para o ritmo. Corridos: todos os dias contam. Use corridos se a empresa vende no fim de semana.',
    exemplo: 'Faltam 40 un e 8 dias úteis: ritmo necessário de 5 un por dia.',
  },
  feriados: {
    texto: 'Os feriados nacionais já vêm calculados. Acrescente os estaduais e municipais que param as vendas.',
  },
  configEnvio: {
    texto: 'Dados para o sistema enviar e-mails (SMTP) e para entregar mensagens a outros sistemas (webhook).',
    como: 'Preencha, salve e use "Testar" para conferir antes de disparar.',
  },
  enderecoPublico: {
    texto: 'Endereço que os vendedores usam para abrir o boletim fora deste computador. Vazio usa localhost, que só funciona aqui.',
  },
  webhook: {
    texto: 'Um endereço de outro sistema (gateway de WhatsApp, Teams, Slack) que recebe cada mensagem pronta para entregar.',
  },
  configIa: {
    texto: 'A IA (Claude Haiku) só é chamada quando alguém pede uma análise, uma resposta ou uma fórmula. Ela recebe os números já calculados e conferidos, nunca os dados brutos.',
    como: 'Defina o limite diário em dólares. Ao chegar nele, a IA para até o dia seguinte.',
  },
  linhasProdutos: {
    texto: 'Linhas (grupos) de produtos que você salva para reaproveitar nas campanhas.',
    exemplo: '"Linha Gripe" com Benegrip, Vick e Cimegripe.',
  },
};
