import { AlertTriangle, CheckCircle2, Clock, FileText, Gauge, Info, Lock, Undo2, XCircle } from 'lucide-react';

// Rótulos, cores (sempre com ícone + texto) e explicações da conta corrente.

export const SITUACAO_CONTA = {
  ok: { rotulo: 'Saudável', cor: 'bom', icone: CheckCircle2 },
  atencao: { rotulo: 'Atenção', cor: 'aviso', icone: AlertTriangle },
  no_limite: { rotulo: 'Usando o limite', cor: 'serio', icone: Gauge },
  estourada: { rotulo: 'Negativa', cor: 'critico', icone: XCircle },
  bloqueada: { rotulo: 'Bloqueada', cor: 'critico', icone: Lock },
};

export const SITUACAO_LANC = {
  previsto: { rotulo: 'Previsto', cor: 'neutro', icone: Clock },
  a_receber: { rotulo: 'ND a receber', cor: 'acento', icone: FileText },
  realizado: { rotulo: 'Realizado', cor: 'bom', icone: CheckCircle2 },
  reservado: { rotulo: 'Reservado', cor: 'aviso', icone: Lock },
  consumido: { rotulo: 'Usado', cor: 'neutro', icone: CheckCircle2 },
  liberado: { rotulo: 'Liberado', cor: 'neutro', icone: Undo2 },
  cancelado: { rotulo: 'Cancelado', cor: 'neutro', icone: XCircle },
};

export const TIPO_ALERTA = {
  critico: { rotulo: 'Crítico', cor: 'critico', icone: XCircle },
  aviso: { rotulo: 'Atenção', cor: 'aviso', icone: AlertTriangle },
  info: { rotulo: 'Aviso', cor: 'acento', icone: Info },
};

export const ORIGENS = {
  acordo: { rotulo: 'Acordo comercial', natureza: 'credito', texto: 'Percentual sobre as compras do mês, combinado no contrato anual com a indústria. Vira provisão no mês e ND no fechamento.' },
  nd: { rotulo: 'Verba negociada (ND)', natureza: 'credito', texto: 'Verba pontual (aniversário, lançamento, ação de sazonalidade) cobrada da indústria por nota de débito.' },
  vpc: { rotulo: 'Propaganda cooperada (VPC)', natureza: 'credito', texto: 'Verba para dividir custos de divulgação: encarte, tabloide, mídia. Precisa de comprovação.' },
  bonificacao: { rotulo: 'Bonificação em mercadoria', natureza: 'credito', texto: 'Produto enviado sem custo pela indústria. Entra na conta pelo valor de custo.' },
  rebaixa: { rotulo: 'Rebaixa de preço', natureza: 'credito', texto: 'Ressarcimento da perda no estoque quando a indústria baixa o preço (proteção de preço).' },
  orcamento: { rotulo: 'Orçamento interno', natureza: 'credito', texto: 'Verba própria da distribuidora para campanhas sem patrocínio de indústria.' },
  campanha: { rotulo: 'Campanha de incentivo', natureza: 'debito', texto: 'Prêmio pago à equipe numa campanha. Reserva ao ativar, débito ao encerrar.' },
  acao_trade: { rotulo: 'Ação comercial', natureza: 'debito', texto: 'Tabloide, ponto extra, ação em rede de farmácias. Precisa de comprovação para a indústria.' },
  repasse: { rotulo: 'Desconto repassado', natureza: 'debito', texto: 'Parte da verba usada como desconto ou bonificação a clientes.' },
  expiracao: { rotulo: 'Baixa de verba vencida', natureza: 'debito', texto: 'Verba que passou da validade sem uso e saiu do saldo.' },
  ajuste: { rotulo: 'Ajuste', natureza: null, texto: 'Correção manual, com descrição. Use para conciliar com o extrato da indústria.' },
  estorno: { rotulo: 'Estorno', natureza: null, texto: 'Lançamento inverso que anula outro. Nada é apagado: o histórico fica completo.' },
};

export const POLITICAS = {
  realizado: { rotulo: 'Só o recebido', texto: 'Só conta a verba que já entrou (ND abatida ou paga).' },
  confirmado: { rotulo: 'Recebido + NDs emitidas', texto: 'Conta também as NDs já emitidas e aceitas, mesmo antes de abater. É o padrão do mercado.' },
  previsto: { rotulo: 'Inclui provisões', texto: 'Conta até a verba prevista que ainda não virou ND. Mais arriscado.' },
};

export const FORMAS = {
  abatimento_duplicata: 'Abatimento em duplicata',
  deposito: 'Depósito',
  mercadoria: 'Mercadoria',
};

export const COMPROVACAO = {
  pendente: { rotulo: 'Comprovação pendente', cor: 'aviso', icone: Clock },
  enviada: { rotulo: 'Comprovação enviada', cor: 'acento', icone: FileText },
  aprovada: { rotulo: 'Comprovação aprovada', cor: 'bom', icone: CheckCircle2 },
};

/** Textos do "i". Linguagem de quem trabalha no comercial, com exemplo. */
export const EXPLICA = {
  pagina: {
    texto: 'É o extrato da verba que cada indústria dá para a distribuidora usar em campanhas e ações. Funciona como uma conta de banco por fornecedor.',
    como: [
      'Entram créditos: acordo comercial, NDs, VPC, bonificação, rebaixa.',
      'Saem débitos: prêmios de campanha, ações comerciais, descontos repassados.',
      'Ao ativar uma campanha, o sistema reserva a verba. Sem saldo, a campanha não é ativada.',
    ],
    exemplo: 'A Haleon dá 1,8% das compras do mês. Comprando R$ 700 mil, entram R$ 12,6 mil para usar em campanhas Haleon.',
  },
  disponivel: {
    texto: 'Quanto ainda dá para comprometer em campanhas novas. É o saldo recebido mais as NDs a receber, menos o que já está reservado e o que venceu.',
    exemplo: 'Recebido R$ 40 mil + NDs R$ 15 mil − reservas R$ 30 mil = R$ 25 mil disponíveis.',
  },
  reservado: {
    texto: 'Verba separada para campanhas ativas ou agendadas. Ainda não saiu da conta, mas não pode ser usada em outra coisa.',
    como: 'Ao encerrar a campanha, o prêmio apurado vira débito e a sobra volta para o disponível.',
    exemplo: 'Reserva de R$ 30 mil, prêmio apurado de R$ 22 mil: debita R$ 22 mil e devolve R$ 8 mil.',
  },
  a_receber: {
    texto: 'Notas de débito (ND) já emitidas contra a indústria e que ainda não foram abatidas nas duplicatas nem pagas.',
    como: 'Quando o financeiro abater a ND, marque como liquidada. ND vencida aparece em alerta.',
  },
  previsto: {
    texto: 'Provisão: verba combinada que ainda não virou ND. Normalmente o acordo do mês corrente, calculado sobre as compras até hoje.',
    como: 'No fechamento do mês, emita a ND. Pela política padrão a provisão ainda não conta no disponível.',
  },
  vencendo: {
    texto: 'Verba com validade perto do fim (45 dias) e que ainda não foi usada. O sistema considera que o uso consome primeiro a verba que vence antes.',
    como: 'Programe uma campanha ou ação antes da data, ou negocie a prorrogação com a indústria.',
  },
  limite: {
    texto: 'Quanto a conta pode ficar negativa com autorização (adiantamento de verba). Passou disso, a conta fica negativa e bloqueia campanhas novas.',
    exemplo: 'Limite de R$ 10 mil: com disponível de R$ 2 mil, ainda dá para reservar até R$ 12 mil.',
  },
  politica: {
    texto: 'Define o que conta como dinheiro na mão para calcular o disponível.',
    como: ['Só o recebido: mais conservador.', 'Recebido + NDs emitidas: padrão do mercado.', 'Inclui provisões: mais arriscado.'],
  },
  reservas: {
    texto: 'Campanhas que estão segurando verba desta conta. Compare a reserva com o prêmio projetado.',
    como: 'Se o projetado passar da reserva, defina um orçamento maior na campanha ou ajuste as faixas antes que falte verba.',
  },
  extrato: {
    texto: 'Todos os lançamentos, do mais novo para o mais antigo. O saldo recebido acumulado só muda com lançamentos realizados.',
    como: ['Clique numa linha para ver o detalhe.', 'Use o menu da linha para emitir ND, liquidar, registrar comprovação ou estornar.'],
  },
  evolucao: {
    texto: 'Saldo no fim de cada mês. A linha de NDs soma o que já foi cobrado e ainda não entrou.',
  },
  composicao: {
    texto: 'De onde veio e para onde foi a verba nos últimos 12 meses, só com lançamentos realizados.',
  },
  alertas: {
    texto: 'Pontos que pedem ação: conta negativa, ND vencida sem abatimento, verba perto de vencer, comprovação pendente e reserva menor que o prêmio projetado.',
  },
  excecao: {
    texto: 'Ativar sem saldo só com autorização registrada. A justificativa fica gravada na reserva e aparece na auditoria da conta.',
    exemplo: 'Diretoria aprovou: a ND da rebaixa de abril está em negociação e cobre a diferença.',
  },
  comprovacao: {
    texto: 'Prova de que a verba foi usada como combinado: apuração da campanha, fotos da ação, notas. Sem comprovação a indústria pode recusar (glosar) o valor.',
  },
};

export const situacaoLanc = (s) => SITUACAO_LANC[s] || { rotulo: s, cor: 'neutro', icone: Info };
