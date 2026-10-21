// Campanhas de exemplo (criadas na primeira execução ou com `npm run exemplos`).
// Cobrem os principais tipos: volume, positivação qualificada, venda casada, cesta, ranking,
// desafio de equipes, meta geral, mix, campanha para clientes, encerrada, agendada e rascunho.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, agoraISO, transacao } from './db.js';
import { addDias, ultimoDiaMes } from './calendario.js';
import { apurar, dataReferencia, normalizarCampanha } from './motor.js';

const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

function mesDe(iso) {
  const a = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return { inicio: `${iso.slice(0, 7)}-01`, fim: ultimoDiaMes(a, m) };
}

export function definicoesExemplo() {
  const ref = dataReferencia('data_pedido');
  const mes = mesDe(ref);
  const anterior = mesDe(addDias(mes.inicio, -1));
  const proximo = mesDe(addDias(mes.fim, 1));

  // fator da meta geral calibrado: vendas do mês anterior ÷ meta do mês atual (+4%) — as metas do fato_metas são de outra escala
  const metaMes = db.prepare("SELECT SUM(f.meta_valor) AS m FROM fato_metas f JOIN dm_vendedor v ON v.id_vendedor = f.id_vendedor WHERE lower(COALESCE(v.nivel, '')) NOT IN ('gerente', 'coordenador') AND f.ano = ? AND f.mes = ?").get(Number(mes.inicio.slice(0, 4)), Number(mes.inicio.slice(5, 7)))?.m || 0;
  const vendaAnt = db.prepare("SELECT SUM(valor_total) AS v FROM fato_vendas WHERE status = 'Faturado' AND data_pedido BETWEEN ? AND ?").get(anterior.inicio, anterior.fim)?.v || 0;
  const razao = metaMes > 0 && vendaAnt > 0 ? vendaAnt / metaMes : 1;
  const fatorMetaGeral = razao > 0.7 && razao < 1.4 ? 100 : Math.max(50, Math.round((razao * 100 * 1.04) / 10) * 10);

  // cobertura da carteira (3+ un Hypera) no mês anterior, para calibrar a meta de positivação
  const coberturaAnterior = Math.round(apurar({ nome: 'calibra', ...anterior, participantes: { nivel: 'vendedor' }, criterios: [{ metrica: 'cobertura_carteira', produtos: { fabricantes: ['Hypera Pharma'] }, regra_cliente: { min_qtd: 3 }, meta: { tipo: 'sem_meta' } }], premiacao: { tipo: 'nenhuma' } }).criterios[0].total.realizado || 60);
  const metaCobertura = Math.min(95, Math.round(coberturaAnterior * 1.03));

  const sobHist = (crescimento, piso = 1) => ({ tipo: 'historico', crescimento, piso });

  return [
    {
      status: 'ativa',
      definicao: {
        nome: 'Sensodyne em Dobro',
        fornecedor: 'Haleon',
        cor: CORES[0],
        descricao: 'Campanha de volume da linha Sensodyne (bonificações 5.910/6.910 não contam). Meta individual = vendas do mês anterior + 3%. Prêmio em faixas, com variável por unidade a partir de 100%.',
        ...mes,
        participantes: { nivel: 'vendedor' },
        filtros: { cfops_excluir: ['5.910', '6.910'] },
        criterios: [{ id: 'c1', nome: 'Unidades Sensodyne', produtos: { marcas: ['Sensodyne'] }, metrica: 'quantidade', meta: sobHist(3, 2), teto: 150 }],
        premiacao: {
          tipo: 'faixas',
          faixas: [
            { min: 90, fixo: 80, variavel: 0, rotulo: 'Bronze' },
            { min: 100, fixo: 150, variavel: 0.3, rotulo: 'Prata' },
            { min: 120, fixo: 250, variavel: 0.5, rotulo: 'Ouro' },
          ],
          orcamento: 30000,
        },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Positivação da Carteira Hypera',
        fornecedor: 'Hypera Pharma',
        cor: CORES[1],
        descricao: `Cobertura da carteira com positivação qualificada: ${metaCobertura}% dos clientes de cada vendedor precisam comprar pelo menos 3 unidades de produtos Hypera no mês (o mês anterior fechou em ${coberturaAnterior}%). Verba de R$ 8.000 rateada entre quem bater a meta.`,
        ...mes,
        participantes: { nivel: 'vendedor' },
        criterios: [{ id: 'c1', nome: 'Carteira positivada (3+ un)', produtos: { fabricantes: ['Hypera Pharma'] }, metrica: 'cobertura_carteira', regra_cliente: { min_qtd: 3 }, meta: { tipo: 'fixa', valor: metaCobertura }, teto: 120 }],
        premiacao: { tipo: 'rateio', rateio: { valor_total: 8000, minimo: 100, proporcional: 'realizado' } },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Kit Ressaca Engov + Epocler',
        fornecedor: 'Hypera Pharma',
        cor: CORES[2],
        descricao: 'Venda casada disputada por equipes: cada pedido com 2 Engov + 1 Epocler forma um kit. Meta = kits do mês anterior + 10%; prêmio fixo + R$ 5 por kit para o gerente.',
        ...mes,
        participantes: { nivel: 'equipe' },
        criterios: [{
          id: 'c1',
          nome: 'Kits vendidos',
          metrica: 'combo',
          combo: { itens: [{ nome: 'Engov', produtos: { marcas: ['Engov'] }, minimo: 2 }, { nome: 'Epocler', produtos: { marcas: ['Epocler'] }, minimo: 1 }], escopo: 'pedido', contar: 'kits' },
          meta: sobHist(10, 1),
        }],
        premiacao: { tipo: 'faixas', faixas: [{ min: 100, fixo: 400, variavel: 5, rotulo: 'Meta' }, { min: 120, fixo: 700, variavel: 6, rotulo: 'Super meta' }] },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Cesta Essenciais Kenvue',
        fornecedor: 'Kenvue',
        cor: CORES[3],
        descricao: 'Cesta com metas diferentes por produto (mês anterior + 3%): Tylenol, Listerine e Band-Aid. O prêmio só é liberado se as três metas forem batidas.',
        ...mes,
        participantes: { nivel: 'vendedor' },
        criterios: [
          { id: 'c1', nome: 'Tylenol (un)', produtos: { marcas: ['Tylenol'] }, metrica: 'quantidade', meta: sobHist(3, 2), gatilho: 100, teto: 130 },
          { id: 'c2', nome: 'Listerine (un)', produtos: { marcas: ['Listerine'] }, metrica: 'quantidade', meta: sobHist(3, 2), gatilho: 100, teto: 130 },
          { id: 'c3', nome: 'Band-Aid (un)', produtos: { marcas: ['Band-Aid'] }, metrica: 'quantidade', meta: sobHist(3, 2), gatilho: 100, teto: 130 },
        ],
        apuracao: { regra: 'todos' },
        premiacao: { tipo: 'faixas', faixas: [{ min: 100, fixo: 300, rotulo: 'Cesta completa' }, { min: 115, fixo: 450, rotulo: 'Cesta premium' }], orcamento: 25000 },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Campeonato Dorflex & Novalgina',
        fornecedor: 'Sanofi',
        cor: CORES[4],
        descricao: 'Ranking por faturamento das marcas Dorflex e Novalgina. Os 10 primeiros são premiados.',
        ...mes,
        participantes: { nivel: 'vendedor' },
        criterios: [{ id: 'c1', nome: 'Faturamento Dorflex + Novalgina', produtos: { marcas: ['Dorflex', 'Novalgina'] }, metrica: 'valor', meta: { tipo: 'sem_meta' } }],
        premiacao: {
          tipo: 'ranking',
          ranking: { por: 'realizado', posicoes: [{ de: 1, ate: 1, valor: 1500 }, { de: 2, ate: 2, valor: 1000 }, { de: 3, ate: 3, valor: 700 }, { de: 4, ate: 10, valor: 200 }] },
        },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Desafio de Equipes Bayer',
        fornecedor: 'Bayer',
        cor: CORES[6],
        descricao: 'Disputa entre equipes: crescer 8% o faturamento Bayer sobre o mês anterior. Prêmio para o gerente da equipe; desconto médio acima da meta reduz o prêmio pela metade.',
        ...mes,
        participantes: { nivel: 'equipe' },
        criterios: [
          { id: 'c1', nome: 'Faturamento Bayer', produtos: { fabricantes: ['Bayer'] }, metrica: 'valor', meta: sobHist(8, 1000), peso: 1 },
          { id: 'c2', nome: 'Desconto médio', produtos: { fabricantes: ['Bayer'] }, metrica: 'desconto_medio', meta: { tipo: 'fixa', valor: 5.5 }, peso: 0 },
        ],
        premiacao: {
          tipo: 'faixas',
          criterio_base: 'c1',
          faixas: [{ min: 100, fixo: 1000, rotulo: 'Meta' }, { min: 110, fixo: 1800, rotulo: 'Super meta' }],
          multiplicadores: [{ criterio: 'c2', min: 100, fator: 1, senao: 0.5 }],
        },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Meta Geral do Mês',
        fornecedor: '',
        cor: CORES[5],
        descricao: `Faturamento total contra a meta mensal de cada vendedor (fato_metas, ajustada para ${fatorMetaGeral}%). Margem mínima de 25% como gatilho.`,
        ...mes,
        participantes: { nivel: 'vendedor' },
        criterios: [
          { id: 'c1', nome: 'Faturamento total', metrica: 'valor', meta: { tipo: 'meta_geral', campo: 'meta_valor', fator: fatorMetaGeral }, peso: 3, teto: 140 },
          { id: 'c2', nome: 'Margem bruta', metrica: 'margem_perc', meta: { tipo: 'fixa', valor: 28 }, peso: 1, gatilho: 90, teto: 110 },
        ],
        premiacao: { tipo: 'faixas', criterio_base: 'c1', faixas: [{ min: 95, fixo: 300, rotulo: 'Quase lá' }, { min: 100, fixo: 600, rotulo: 'Meta' }, { min: 115, fixo: 1000, rotulo: 'Super meta' }] },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Mix Dermocosméticos',
        fornecedor: "L'Oréal",
        cor: CORES[7],
        descricao: 'Mix de SKUs CeraVe, La Roche-Posay e Vichy (peso 2) e positivação de SKU nos clientes (peso 1), com metas sobre o mês anterior.',
        ...mes,
        participantes: { nivel: 'vendedor' },
        criterios: [
          { id: 'c1', nome: 'Mix de SKUs dermo', produtos: { marcas: ['CeraVe', 'La Roche-Posay', 'Vichy'] }, metrica: 'mix', meta: { tipo: 'historico', crescimento: 8, piso: 0 }, peso: 2 },
          { id: 'c2', nome: 'Positivação de SKU', produtos: { marcas: ['CeraVe', 'La Roche-Posay', 'Vichy'] }, metrica: 'positivacao_sku', meta: sobHist(5, 1), peso: 1 },
        ],
        premiacao: { tipo: 'faixas', faixas: [{ min: 100, fixo: 200, rotulo: 'Meta' }, { min: 125, fixo: 350, rotulo: 'Super meta' }] },
      },
    },
    {
      status: 'encerrada',
      definicao: {
        nome: 'Centrum (mês anterior)',
        fornecedor: 'Haleon',
        cor: CORES[0],
        descricao: 'Campanha já encerrada (apuração congelada no fechamento): unidades Centrum, meta = mês anterior + 5%.',
        ...anterior,
        participantes: { nivel: 'vendedor' },
        criterios: [{ id: 'c1', nome: 'Unidades Centrum', produtos: { marcas: ['Centrum'] }, metrica: 'quantidade', meta: sobHist(5, 2) }],
        premiacao: { tipo: 'faixas', faixas: [{ min: 100, fixo: 120, variavel: 0.4, rotulo: 'Meta' }] },
      },
    },
    {
      status: 'ativa',
      definicao: {
        nome: 'Inverno sem Gripe Vick',
        fornecedor: 'Procter & Gamble',
        cor: CORES[1],
        descricao: 'Campanha agendada para o próximo mês: positivação de clientes com Vick e meta de unidades distribuída pelo histórico.',
        ...proximo,
        participantes: { nivel: 'vendedor' },
        criterios: [
          { id: 'c1', nome: 'Unidades Vick', produtos: { marcas: ['Vick'] }, metrica: 'quantidade', meta: { tipo: 'distribuida', valor: 5000, distribuir_por: 'historico' } },
          { id: 'c2', nome: 'Clientes positivados', produtos: { marcas: ['Vick'] }, metrica: 'positivacao', meta: sobHist(10, 2) },
        ],
        premiacao: { tipo: 'faixas', faixas: [{ min: 100, fixo: 200 }] },
      },
    },
    {
      status: 'rascunho',
      definicao: {
        nome: 'Lançamento Allegra (rascunho)',
        fornecedor: 'Sanofi',
        cor: CORES[2],
        descricao: 'Rascunho de campanha de lançamento: positivar clientes novos na linha Allegra.',
        ...proximo,
        participantes: { nivel: 'vendedor' },
        criterios: [{ id: 'c1', nome: 'Clientes novos em Allegra', produtos: { marcas: ['Allegra'] }, metrica: 'clientes_novos', novos: { dias: 60 }, meta: { tipo: 'fixa', valor: 3 } }],
        // orçamento do lançamento acima da verba livre da Sanofi: a ativação fica bloqueada pela conta corrente (demonstração)
        premiacao: { tipo: 'faixas', faixas: [{ min: 100, fixo: 150 }], orcamento: 25000 },
      },
    },
  ];
}

export function criarExemplos({ recriar = false } = {}) {
  const exemplos = definicoesExemplo();
  transacao(() => {
    if (recriar) {
      db.exec('DELETE FROM fotografia');
      db.exec('DELETE FROM campanha');
    }
    const ins = db.prepare('INSERT INTO campanha (nome, fornecedor, status, inicio, fim, definicao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const ex of exemplos) {
      const c = normalizarCampanha(ex.definicao);
      const agora = agoraISO();
      const r = ins.run(c.nome, c.fornecedor, ex.status, c.inicio, c.fim, JSON.stringify(c), agora, agora);
      if (ex.status === 'encerrada') {
        const res = apurar(c);
        db.prepare('INSERT INTO fotografia (id_campanha, tipo, observacao, data_referencia, resultado, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(
          Number(r.lastInsertRowid), 'fechamento', 'Fechamento da campanha', res.tempo.referencia, JSON.stringify(res), agora,
        );
      }
    }
  });
  return exemplos.length;
}

// CLI: npm run exemplos (recria)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = criarExemplos({ recriar: process.argv.includes('--recriar') });
  console.log(`${n} campanhas de exemplo criadas.`);
}
