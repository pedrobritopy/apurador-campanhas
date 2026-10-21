import { useEffect, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, BadgeCheck, CircleAlert, CircleSlash, Info, Landmark, PackageX, RefreshCw, ShieldAlert, ShoppingCart, Sparkles,
  Target, TrendingDown, TrendingUp, UserX, Users,
} from 'lucide-react';
import { get } from '../../lib/api.js';
import { fmtDataHora, fmtNumero, fmtUsd, fmtValor } from '../../lib/formato.js';
import { Carregando, Modal, Progresso, Selo } from '../../componentes/ui.jsx';

// Peças compartilhadas pelas telas de inteligência.

export const SEVERIDADE = {
  critica: { rotulo: 'Crítico', cor: 'critico', corBarra: 'var(--critico)', icone: AlertOctagon },
  alta: { rotulo: 'Alto', cor: 'serio', corBarra: 'var(--serio)', icone: AlertTriangle },
  media: { rotulo: 'Médio', cor: 'aviso', corBarra: 'var(--aviso)', icone: CircleAlert },
  info: { rotulo: 'Informativo', cor: 'acento', corBarra: 'var(--acento)', icone: Info },
  positiva: { rotulo: 'Boa notícia', cor: 'bom', corBarra: 'var(--bom)', icone: TrendingUp },
};

export function SeloSeveridade({ severidade }) {
  const s = SEVERIDADE[severidade] || SEVERIDADE.info;
  return <Selo cor={s.cor} icone={s.icone}>{s.rotulo}</Selo>;
}

export const TIPO_PLANO = {
  recompra: {
    rotulo: 'Recompra atrasada', curto: 'Recompra', icone: RefreshCw, cor: 'var(--s1)',
    explica: {
      texto: 'O cliente compra uma marca com regularidade e já passou do prazo de sempre sem comprar de novo.',
      como: [
        'Medimos o intervalo médio entre as compras de cada marca pelo cliente.',
        'Entra aqui quando já passou 1,5 vez esse intervalo (e menos de 120 dias).',
        'O potencial é o valor médio de uma compra dessa marca.',
        'Na conversa: lembre da reposição antes que ele compre de outro fornecedor.',
      ],
      exemplo: 'Compra Dorflex a cada 20 dias e está há 35 sem comprar. Uma compra média de Dorflex dele é R$ 480: esse é o potencial.',
    },
  },
  campanha: {
    rotulo: 'Positivar na campanha', curto: 'Campanha', icone: Target, cor: 'var(--s2)',
    explica: {
      texto: 'Cliente que comprava os produtos de uma campanha ativa e ainda não comprou durante a campanha.',
      como: [
        'Só aparece enquanto o vendedor (ou a equipe) ainda não bateu a meta.',
        'Olhamos os 120 dias antes do início da campanha para achar quem já compra esses produtos.',
        'O potencial é o valor médio de um pedido desses produtos para o cliente.',
        'Nos últimos 7 dias da campanha a prioridade sobe.',
      ],
      exemplo: 'Comprou R$ 1.200 de Sensodyne em 3 pedidos antes da campanha e nada desde o início: potencial de R$ 400 (um pedido médio).',
    },
  },
  queda: {
    rotulo: 'Queda de compra', curto: 'Queda', icone: TrendingDown, cor: 'var(--s3)',
    explica: {
      texto: 'O cliente continua comprando, mas comprou bem menos nos últimos 30 dias do que nos 30 anteriores.',
      como: [
        'Entra quem comprava pelo menos R$ 300 e caiu 40% ou mais.',
        'O potencial é a diferença entre os dois períodos (o que deixou de comprar).',
        'O cartão mostra as marcas que mais caíram: comece por elas.',
      ],
      exemplo: 'Comprou R$ 2.000 no mês anterior e R$ 900 agora: potencial de R$ 1.100.',
    },
  },
  cross_sell: {
    rotulo: 'Venda cruzada', curto: 'Cruzada', icone: ShoppingCart, cor: 'var(--s4)',
    explica: {
      texto: 'Marca que clientes parecidos compram e este cliente nunca comprou.',
      como: [
        'Usamos dois sinais: marcas que costumam sair juntas (quem compra A também compra B) e marcas que pelo menos metade das farmácias do mesmo segmento e porte compram.',
        'O potencial é quanto um cliente compra dessa marca por mês, em média.',
        'Na conversa: apresente a marca como algo que os vizinhos já vendem.',
      ],
      exemplo: '62% dos clientes que compram Neosaldina também compram Dorflex, e este nunca comprou Dorflex.',
    },
  },
  inativo: {
    rotulo: 'Cliente inativo', curto: 'Inativo', icone: UserX, cor: 'var(--s5)',
    explica: {
      texto: 'Cliente da carteira que está há mais de 45 dias sem comprar.',
      como: [
        'O potencial é a média mensal que ele comprava nos últimos 90 dias (no mínimo R$ 300).',
        'Quanto mais tempo parado, maior a urgência.',
        'Na conversa: descubra o motivo (preço, ruptura, concorrente) antes de oferecer.',
      ],
      exemplo: 'Sem comprar há 60 dias; comprava cerca de R$ 1.500 por mês. Potencial de R$ 1.500.',
    },
  },
};

/** Explicações da Central de insights (usadas no "i"). */
export const EXPLICA_INSIGHTS = {
  pagina: {
    texto: 'O lugar para saber o que está pedindo atenção nas campanhas e o que fazer a respeito.',
    como: [
      'Alertas: regras automáticas que olham todas as campanhas o tempo todo. Não usam IA e não custam nada.',
      'Análise da IA: um diagnóstico escrito de uma campanha, de um vendedor ou geral. Só roda quando você pede.',
      'Pergunte à IA: tire dúvidas em português, como num chat.',
      'Base de conhecimento: os números prontos e conferidos que a IA pode ler.',
      'Qualidade dos dados: as conferências que garantem que esses números batem.',
    ],
  },
  severidade: {
    texto: 'A cor e o selo dizem a urgência de cada alerta.',
    como: [
      'Crítico: precisa de ação hoje (ex.: campanha projetando menos de 75% da meta).',
      'Alto: resolver nesta semana (ex.: produto da campanha com risco de faltar).',
      'Médio: acompanhar (ex.: vendas desacelerando).',
      'Informativo: só para saber (ex.: campanha começa em 3 dias).',
      'Boa notícia: algo que deu certo (ex.: meta já superada).',
    ],
    exemplo: 'Clique num quadro de severidade para ver só os alertas daquele nível.',
  },
  alertas: {
    texto: 'Os alertas são recalculados sozinhos a cada 2 minutos, a partir das apurações das campanhas.',
    como: [
      'As regras olham meta e ritmo, estoque dos produtos, orçamento de prêmios, quem está perto de mudar de faixa, quem não vendeu nada e quem está sem receber acompanhamento.',
      'O botão à direita de cada alerta leva direto para onde agir.',
    ],
  },
  analise: {
    texto: 'A IA lê os números já calculados e conferidos e escreve um diagnóstico: como está, o que preocupa e o que fazer primeiro.',
    como: [
      'Escolha o que analisar (geral, uma campanha ou um vendedor) e clique em "Gerar análise".',
      'Se os dados não mudaram desde a última vez, a análise antiga é reaproveitada sem custo.',
      'Cada número citado tem um selo de fonte (os códigos cinza). Clique nele para ver de onde veio.',
    ],
    exemplo: 'Cada análise custa frações de centavo de dólar. O custo máximo aparece antes de você clicar.',
  },
  conferencia: {
    texto: 'Depois que a IA responde, o sistema confere cada número com os fatos citados.',
    como: [
      '"Verificado": todos os números do trecho existem nas fontes citadas.',
      '"Não verificado": algum número não foi achado nas fontes. Leia com cuidado.',
      'Citações válidas são fontes que existem de verdade na base.',
    ],
  },
  chanceMeta: {
    texto: 'Leitura da IA sobre a chance de bater a meta, feita a partir da projeção calculada pelo sistema (ritmo atual até o fim do período).',
    exemplo: 'Projeção em 96% da meta com 10 dias pela frente costuma aparecer como chance média.',
  },
  pergunte: {
    texto: 'Faça perguntas em português sobre campanhas, vendedores, clientes ou marcas.',
    como: [
      'Para cada pergunta, o sistema separa só os fatos relacionados e envia à IA. Isso deixa a resposta precisa e barata.',
      'Use o contexto (campanha ou vendedor) para a IA focar no que interessa.',
      'Os códigos cinza na resposta são as fontes: clique para ver o fato completo.',
    ],
  },
  fatos: {
    texto: 'Frases curtas com números prontos, montadas pelo sistema a partir das vendas, campanhas, carteira e estoque. É tudo o que a IA pode ler.',
    como: 'Cada fato importante é calculado por dois caminhos diferentes. Se os dois não batem, o fato fica retido e não vai para a IA.',
    exemplo: '"Dorflex nos últimos 30 dias: R$ 48 mil, 12% acima dos 30 dias anteriores, 210 clientes compraram."',
  },
  qualidade: {
    texto: 'Conferências automáticas que garantem que os dados importados fazem sentido.',
    como: [
      'Caminho A e caminho B são dois cálculos independentes do mesmo número (ex.: soma das linhas de venda e total pelo motor de apuração).',
      'Divergências mostra quantas linhas não bateram.',
      'Rodam a cada importação de dados e a cada atualização da base.',
    ],
    exemplo: 'Valor total = quantidade × preço unitário: se alguma linha não bate, ela é contada como divergente.',
  },
};

/** Explicações das métricas dos planos de ataque (usadas no "i"). */
export const EXPLICA_PLANO = {
  pagina: {
    texto: 'Lista de clientes para ligar ou visitar, cada um com um motivo tirado do histórico real de compra e um valor em reais.',
    como: [
      'Escolha a equipe para comparar os vendedores.',
      'Clique em um vendedor para ver o plano dele, cliente por cliente.',
      'Marque os clientes que ele deve atacar primeiro.',
      'Envie pelo WhatsApp e clique em "Registrar plano" para acompanhar o resultado.',
    ],
  },
  vendaProvavel: {
    texto: 'Quanto se espera vender a mais se o plano for seguido. É o potencial de cada ação multiplicado pela chance real de ela dar certo.',
    como: 'A chance vem do histórico: de cada 100 ações daquele tipo, quantas viraram compra em até 30 dias.',
    exemplo: 'Ação com potencial de R$ 1.000 e chance de 35% conta R$ 350 de venda provável.',
  },
  potencial: {
    texto: 'Soma do valor de todas as ações do plano, como se todas dessem certo. Serve de teto; a conta realista é a venda provável.',
    exemplo: '6 ações de R$ 500 somam R$ 3.000 de potencial.',
  },
  clientes: {
    texto: 'Clientes da carteira do vendedor que têm pelo menos um motivo para contato agora.',
    como: 'A carteira inclui os clientes cadastrados para o vendedor e quem comprou com ele nos últimos 90 dias.',
    exemplo: '"6 de 8" quer dizer: 6 dos 8 clientes da carteira têm alguma ação sugerida.',
  },
  conversao: {
    texto: 'Chance de a ação virar compra em até 30 dias, por tipo de ação.',
    como: [
      'Começa com um teste no histórico (backtest): aplicamos a regra como se hoje fosse 30 dias atrás e conferimos quem comprou depois.',
      'Cada plano registrado aqui também conta. Com o tempo, a taxa passa a refletir a sua equipe.',
    ],
    exemplo: 'Recompra com 35%: de cada 100 recompras sugeridas, 35 viraram compra.',
  },
  prioridade: {
    texto: 'Ordem da lista. Junta valor, chance e urgência.',
    como: 'Prioridade = potencial × chance de conversão × urgência. A urgência sobe quanto mais atrasada a compra ou mais perto do fim da campanha.',
    exemplo: 'Uma recompra de R$ 500 muito atrasada pode ficar acima de uma venda cruzada de R$ 800.',
  },
  registrar: {
    texto: 'Guarda as ações escolhidas para acompanhar o resultado.',
    como: [
      'Cada ação registrada fica "em aberto" por 30 dias.',
      'Se o cliente comprar uma das marcas sugeridas nesse prazo, ela vira "convertida" sozinha, na próxima importação de vendas.',
      'Se não comprar, vira "expirada".',
      'Esses resultados ajustam as taxas de conversão e a prioridade dos próximos planos.',
    ],
  },
  roteiro: {
    texto: 'A IA escreve um roteiro de abordagem para os clientes escolhidos: como abrir a conversa, argumentos e oferta.',
    como: 'Ela usa só os números do plano (já conferidos) e cada argumento é checado antes de aparecer. Custa frações de centavo de dólar e respeita o limite diário.',
  },
  enviar: {
    texto: 'Abre o WhatsApp com a lista pronta para o vendedor: cliente, motivo e o que oferecer.',
    como: 'Sem nada marcado, vão as 8 primeiras ações da lista.',
  },
  statusRec: {
    texto: 'Situação de cada ação registrada.',
    como: [
      'Em aberto: dentro dos 30 dias, aguardando compra.',
      'Convertida: o cliente comprou o que foi sugerido (mostra o valor).',
      'Expirada: passaram 30 dias sem a compra.',
    ],
  },
};

export const ESCOPO_FATO = {
  geral: 'Geral', campanha: 'Campanha', participante: 'Participante', oportunidade: 'Oportunidade', vendedor: 'Vendedor', equipe: 'Equipe',
  cliente: 'Cliente', marca: 'Marca', associacao: 'Associação', retroalimentacao: 'Retroalimentação', qualidade: 'Qualidade', plano: 'Plano',
};

export const ICONE_TIPO_INSIGHT = {
  ruptura: PackageX, sem_venda: Users, risco_meta: Target, divergencia_dados: ShieldAlert, perto_faixa: Sparkles, meta_superada: BadgeCheck,
  sem_acompanhamento: CircleSlash, conta_corrente: Landmark,
};

/** Selo "verificado / não verificado" de um item da IA. */
export function MarcaVerificado({ verificado, detalhe }) {
  const dica = !verificado && detalhe
    ? [detalhe.fontes_invalidas?.length ? `Fontes inexistentes: ${detalhe.fontes_invalidas.join(', ')}` : '', detalhe.numeros_sem_fonte?.length ? `Números sem fonte: ${detalhe.numeros_sem_fonte.join(', ')}` : '', !detalhe.fontes_invalidas?.length && !detalhe.numeros_sem_fonte?.length ? 'Sem fonte citada' : ''].filter(Boolean).join(' · ')
    : 'Números conferidos nos fatos citados';
  return (
    <span className={`ig-marca-verificado ${verificado ? 'sim' : 'nao'}`} title={dica}>
      {verificado ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}
      {verificado ? 'verificado' : 'não verificado'}
    </span>
  );
}

/** Lê os detalhes de validação de um fato em linguagem humana. */
export function DetalheValidacao({ validacao }) {
  if (!validacao) return <div className="mudo pequeno">Fato descritivo (sem segundo cálculo a conferir).</div>;
  if (validacao.aplicavel === false) return <div className="mudo pequeno">Conferência não aplicável: {validacao.observacao}.</div>;
  const v = (x) => (x && typeof x === 'object' ? Object.entries(x).map(([k, n]) => `${k}: ${fmtValor(n, k === 'valor' ? 'moeda' : 'numero')}`).join(' · ') : typeof x === 'number' ? fmtNumero(x, x % 1 ? 2 : 0) : x ?? 'n/d');
  return (
    <dl className="ig-validacao">
      <dt>Método</dt>
      <dd>{validacao.metodo}</dd>
      {'a' in validacao && (<><dt>Cálculo A</dt><dd>{v(validacao.a)}</dd></>)}
      {'b' in validacao && (<><dt>Cálculo B</dt><dd>{v(validacao.b)}</dd></>)}
      <dt>Resultado</dt>
      <dd>{validacao.ok === false ? <Selo cor="critico" icone={AlertTriangle}>divergente, fora da IA</Selo> : <Selo cor="bom" icone={BadgeCheck}>conferido</Selo>}</dd>
    </dl>
  );
}

/** Modal que mostra um fato da base (pelo id) com a validação. */
export function ModalFato({ id, fatoInicial, aoFechar }) {
  const [fato, setFato] = useState(fatoInicial || null);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    if (!id || fatoInicial) return;
    setFato(null);
    get(`/conhecimento/fatos?id=${encodeURIComponent(id)}`).then((l) => (l[0] ? setFato(l[0]) : setErro('Fato não encontrado (a base pode ter sido atualizada).'))).catch((e) => setErro(e.message));
  }, [id, fatoInicial]);
  return (
    <Modal aberto={Boolean(id)} aoFechar={aoFechar} titulo={fato?.titulo || id} subtitulo={fato ? `${ESCOPO_FATO[fato.escopo] || fato.escopo} · ${id} · gerado em ${fmtDataHora(fato.gerado_em)}` : id} largura={640}>
      {!fato && !erro && <Carregando altura={120} />}
      {erro && <div className="mudo">{erro}</div>}
      {fato && (
        <div className="coluna g12">
          <p style={{ lineHeight: 1.65 }}>{fato.texto}</p>
          <DetalheValidacao validacao={fato.validacao} />
        </div>
      )}
    </Modal>
  );
}

/** Chip clicável com o id de um fato. */
export function ChipFonte({ id, invalida, aoAbrir }) {
  return (
    <button type="button" className={`ig-fonte${invalida ? ' invalida' : ''}`} onClick={(e) => { e.stopPropagation(); aoAbrir?.(id); }} title={invalida ? 'Citação inexistente na base' : 'Ver o fato'}>
      {id.replace(/^F-/, '')}
    </button>
  );
}

/** Texto com citações [F-...] transformadas em chips. */
export function TextoComFontes({ texto, aoAbrir, validos }) {
  const partes = String(texto || '').split(/(\[F-[A-Za-z0-9_-]+\])/g);
  return (
    <>
      {partes.map((p, i) => {
        const m = p.match(/^\[(F-[A-Za-z0-9_-]+)\]$/);
        return m ? <ChipFonte key={i} id={m[1]} invalida={validos && !validos.has(m[1])} aoAbrir={aoAbrir} /> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** Medidor de consumo da IA no dia. */
export function MedidorIa({ status, compacto }) {
  if (!status) return null;
  const pct = status.limite_diario_usd ? (status.gasto_hoje_usd / status.limite_diario_usd) * 100 : 0;
  return (
    <div className="ig-medidor">
      <div className="linha entre">
        <span className="pequeno sec">Consumo de IA hoje</span>
        <span className="pequeno num"><strong>{fmtUsd(status.gasto_hoje_usd)}</strong> <span className="mudo">de {fmtUsd(status.limite_diario_usd)}</span></span>
      </div>
      <Progresso valor={pct} cor={pct >= 90 ? 'critico' : pct >= 70 ? 'aviso' : 'bom'} espessura="p" titulo={`${fmtNumero(pct, 1)}% do limite diário`} />
      {!compacto && (
        <div className="linha entre mini mudo">
          <span>{status.modelo}{status.simulada ? ' · modo simulado' : ''}</span>
          <span>{fmtNumero(status.chamadas_hoje)} chamada(s) hoje</span>
        </div>
      )}
    </div>
  );
}
