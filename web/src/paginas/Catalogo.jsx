import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Calculator, FlaskConical, Layers, Library, ListTree, Play, Rocket, Save, Search, Sigma, Trophy } from 'lucide-react';
import AssistenteFormula from './construtor/AssistenteFormula.jsx';
import BibliotecaFormulas, { ModalSalvarFormula } from './construtor/BibliotecaFormulas.jsx';
import './construtor/construtor.css';
import { GraficoBarras } from '../componentes/graficos.jsx';
import {
  Abas, Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Chip, Entrada, ErroCarga, Explica, Numero, Segmentado, Selo, Tabela,
} from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import { post } from '../lib/api.js';
import { useAtrasado } from '../lib/anim.js';
import { useCatalogo, useDimensoes, useProdutos } from '../lib/dados.js';
import { fmtCompacto, fmtNumero, fmtValor } from '../lib/formato.js';
import { definirQuery, navegar } from '../lib/rotas.js';
import EditorFormula from './construtor/EditorFormula.jsx';
import { EXEMPLOS_FORMULA, GUIA_METRICAS } from './construtor/guia.js';
import { ORDEM_GRUPOS, iconeDoGrupo } from './construtor/SeletorMetrica.jsx';
import SeletorProdutos from './construtor/SeletorProdutos.jsx';
import { SELETOR_VAZIO, hojeISO, normalizarTexto, resolverMarcadorData } from './construtor/util.js';

const ABAS = [
  { id: 'metricas', rotulo: 'Métricas', icone: BookOpen },
  { id: 'variaveis', rotulo: 'Variáveis', icone: ListTree },
  { id: 'dimensoes', rotulo: 'Dimensões', icone: Layers },
  { id: 'formulas', rotulo: 'Fórmulas', icone: Sigma },
  { id: 'biblioteca', rotulo: 'Minhas fórmulas', icone: Library },
  { id: 'regras', rotulo: 'Metas e prêmios', icone: Trophy },
  { id: 'playground', rotulo: 'Playground', icone: FlaskConical },
];

const FORMATO = { numero: 'Número', moeda: 'R$', perc: '%', decimal: 'Decimal' };

function contagemDimensao(chave, dim, produtos) {
  if (!dim) return 0;
  const m = {
    fabricante: dim.fabricantes?.length, marca: dim.marcas?.length, subcategoria: dim.subcategorias?.length, grupo: dim.grupos?.length,
    produto: produtos?.length, canal: dim.canais?.length, segmento: dim.segmentos?.length, porte: dim.portes?.length, estado: dim.estados?.length,
    cidade: dim.cidades?.length, curva: (dim.curvas || ['A', 'B', 'C']).length, cfop: dim.cfops?.length, status: dim.status_venda?.length, periodo: 1,
  };
  return m[chave] || 0;
}

function exemploDimensao(chave, dim, produtos) {
  if (!dim) return '';
  const p = {
    fabricante: dim.fabricantes?.[0]?.nome, marca: dim.marcas?.find((m) => m.nome === 'Dorflex')?.nome || dim.marcas?.[0]?.nome,
    subcategoria: dim.subcategorias?.[0]?.nome, grupo: dim.grupos?.[0]?.nome || 'Linha Dor', produto: String(produtos?.[0]?.id ?? 1),
    canal: dim.canais?.find((c) => c.nome === 'App Mobile')?.nome || dim.canais?.[0]?.nome, segmento: dim.segmentos?.[0], porte: dim.portes?.[0],
    estado: dim.estados?.[0], cidade: dim.cidades?.[0]?.cidade, curva: 'A', cfop: dim.cfops?.[0]?.cfop, status: 'Devolvido', periodo: 'anterior',
  }[chave];
  return p ? `${chave}: "${p}"` : '';
}

// ------------------------------------------------------------------ abas
function AbaMetricas({ catalogo }) {
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState(null);
  const lista = useMemo(() => {
    const q = normalizarTexto(busca);
    return Object.entries(catalogo.metricas)
      .map(([chave, m]) => ({ chave, ...m, guia: GUIA_METRICAS[chave] }))
      .filter((m) => (!grupo || m.grupo === grupo) && (!q || normalizarTexto(`${m.nome} ${m.descricao} ${m.chave} ${m.expr || ''} ${m.guia?.join(' ') || ''}`).includes(q)))
      .sort((a, b) => ORDEM_GRUPOS.indexOf(a.grupo) - ORDEM_GRUPOS.indexOf(b.grupo));
  }, [catalogo, busca, grupo]);
  const grupos = ORDEM_GRUPOS.filter((g) => Object.values(catalogo.metricas).some((m) => m.grupo === g));
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="linha quebra" style={{ gap: 8 }}>
        <div style={{ width: 280 }}><Entrada icone={Search} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar métrica…" /></div>
        <Explica titulo="Métricas" {...EXPLICA.metricas} como="Use a busca ou os grupos para achar a métrica. Cada cartão diz quando usar e dá um exemplo. No construtor de campanha, é só escolher a métrica pelo nome." />
        <Chip ativo={!grupo} aoClicar={() => setGrupo(null)}>Todas <span className="mudo">{Object.keys(catalogo.metricas).length}</span></Chip>
        {grupos.map((g) => (
          <Chip key={g} ativo={grupo === g} aoClicar={() => setGrupo(grupo === g ? null : g)}>{g}</Chip>
        ))}
      </div>
      <div className="cat-metricas escalonado">
        {lista.map((m) => {
          const Ic = iconeDoGrupo(m.grupo);
          return (
            <div key={m.chave} className="cat-metrica">
              <div className="cat-metrica-topo">
                <div className="linha" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <span className="cons-metrica-icone"><Ic size={15} /></span>
                  <div className="coluna" style={{ gap: 0 }}>
                    <span className="forte">{m.nome}</span>
                    <span className="mini mudo mono">{m.chave}</span>
                  </div>
                </div>
                <div className="linha g4">
                  <Selo>{FORMATO[m.formato] || m.formato}</Selo>
                  {m.sentido === 'menor' && <Selo cor="aviso">menor é melhor</Selo>}
                </div>
              </div>
              <div className="pequeno sec">{m.descricao}</div>
              {m.expr && <div className="cat-formula">{m.expr}</div>}
              {m.guia && (
                <>
                  <div className="coluna" style={{ gap: 2 }}><span className="cat-rot">Quando usar</span><span className="pequeno">{m.guia[0]}</span></div>
                  <div className="coluna" style={{ gap: 2 }}><span className="cat-rot">Exemplo</span><span className="pequeno sec">{m.guia[1]}</span></div>
                </>
              )}
              <div className="linha g4 mini mudo">
                {m.totalizar && <span>Total da campanha: {m.totalizar === 'media' ? 'média ponderada' : 'soma'}</span>}
                {m.unidade && <span>· unidade: {m.unidade}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AbaVariaveis({ catalogo }) {
  const linhas = Object.entries(catalogo.variaveis).map(([chave, v]) => ({
    chave,
    ...v,
    usadaEm: Object.values(catalogo.metricas).filter((m) => new RegExp(`\\b${chave}\\b`).test(m.expr || '')).map((m) => m.nome),
  }));
  return (
    <Cartao semMargem titulo={`${linhas.length} variáveis medidas por participante`} subtitulo="Use-as em fórmulas personalizadas. Todas são calculadas dia a dia, então também têm projeção." info={{ titulo: 'Variáveis', ...EXPLICA.variaveisFormula }}>
      <Tabela densa chaveLinha={(l) => l.chave} linhas={linhas} ordenacaoInicial={null}
        colunas={[
          { chave: 'chave', titulo: 'Variável', ordenavel: true, dirInicial: 'asc', render: (l) => <code className="mono forte">{l.chave}</code> },
          { chave: 'nome', titulo: 'O que mede', ordenavel: true, dirInicial: 'asc' },
          { chave: 'grupo', titulo: 'Grupo', ordenavel: true, dirInicial: 'asc', render: (l) => <Selo>{l.grupo}</Selo> },
          { chave: 'usadaEm', titulo: 'Usada nas métricas', render: (l) => <span className="mini mudo">{l.usadaEm.slice(0, 4).join(', ')}{l.usadaEm.length > 4 ? ` +${l.usadaEm.length - 4}` : ''}</span> },
        ]} />
    </Cartao>
  );
}

function AbaDimensoes({ catalogo, dim, produtos }) {
  const medidas = Object.keys(catalogo.variaveis).length;
  const linhas = catalogo.dimensoes_variavel.map((d) => ({ ...d, n: contagemDimensao(d.chave, dim, produtos), exemplo: exemploDimensao(d.chave, dim, produtos) }));
  const somaValores = linhas.reduce((a, l) => a + l.n, 0);
  const umRecorte = medidas * somaValores;
  let pares = 0;
  for (let i = 0; i < linhas.length; i++) for (let j = i + 1; j < linhas.length; j++) pares += linhas[i].n * linhas[j].n;
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="cat-heroi">
        <div className="coluna" style={{ gap: 4 }}>
          <span className="cat-rot linha g4">Variáveis disponíveis com um recorte<Explica titulo="Recortes" {...EXPLICA.recortes} como="Escreva a variável e, entre chaves, a dimensão e o valor. Vários valores entre colchetes valem como “ou”." tamanho={13} /></span>
          <span className="cat-heroi-num"><Numero valor={umRecorte} /></span>
          <span className="pequeno sec">{medidas} medidas × {fmtNumero(somaValores)} valores de {linhas.length} dimensões</span>
        </div>
        <div className="coluna" style={{ gap: 4 }}>
          <span className="cat-rot">Combinando duas dimensões</span>
          <span className="cat-heroi-num" style={{ fontSize: 34 }}>{fmtCompacto(pares * medidas)}</span>
          <span className="pequeno sec">ex.: faturamento de uma marca em um canal</span>
        </div>
        <div className="cresce" />
        <div className="cons-codigo" style={{ maxWidth: 420 }}>
          valor{'{'}marca: "Dorflex", canal: "App Mobile"{'}'}<br />
          clientes{'{'}curva: "A", estado: ["GO", "DF"]{'}'}<br />
          qtd{'{'}periodo: "anterior"{'}'}
        </div>
      </div>
      <Aviso tipo="info">
        Filtros de produto (fabricante, marca, subcategoria, grupo, produto) <b>substituem</b> os produtos do critério; os demais <b>se somam</b> aos filtros da campanha. Vários valores entre colchetes valem como "ou".
      </Aviso>
      <Cartao semMargem>
        <Tabela densa chaveLinha={(l) => l.chave} linhas={linhas}
          colunas={[
            { chave: 'chave', titulo: 'Dimensão', render: (l) => <code className="mono forte">{l.chave}</code> },
            { chave: 'rotulo', titulo: 'Significado' },
            { chave: 'n', titulo: 'Valores possíveis', alinhar: 'direita', ordenavel: true, render: (l) => <span className="num forte">{fmtNumero(l.n)}</span> },
            { chave: 'exemplo', titulo: 'Exemplo', render: (l) => <code className="mono mudo">{l.exemplo}</code> },
          ]} />
      </Cartao>
    </div>
  );
}

function AbaFormulas({ catalogo, aoTestar }) {
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade-2">
        <Cartao titulo="Operadores e regras" info={{ texto: 'Uma fórmula é uma conta com as variáveis, como numa calculadora. O resultado vira um critério de campanha.', exemplo: 'valor / clientes dá o ticket médio por cliente; qtd{marca: "Dorflex"} / qtd * 100 dá a participação de Dorflex nas unidades.' }}>
          <div className="coluna" style={{ gap: 8 }}>
            <div className="pequeno"><code className="mono">+ − * / ^</code> aritmética · <code className="mono">( )</code> agrupamento</div>
            <div className="pequeno"><code className="mono">{'> < >= <= == !='}</code> comparações (resultam 1 ou 0); use com <code className="mono">se()</code></div>
            <div className="pequeno">Decimal com ponto: <code className="mono">1.5</code>. Divisão por zero vira "sem valor" (não quebra a apuração).</div>
            <div className="pequeno">Toda fórmula é calculada por participante, dia a dia, então ganha projeção, ranking e meta como qualquer métrica pronta.</div>
          </div>
        </Cartao>
        <Cartao titulo="Funções">
          <div className="coluna" style={{ gap: 6 }}>
            {catalogo.funcoes.map((f) => (
              <div key={f.nome} className="linha" style={{ gap: 10, alignItems: 'baseline' }}>
                <code className="mono forte" style={{ minWidth: 190 }}>{f.assinatura}</code>
                <span className="pequeno sec">{f.descricao}</span>
              </div>
            ))}
          </div>
        </Cartao>
      </div>
      <h2>Exemplos prontos</h2>
      <div className="grade-auto escalonado">
        {EXEMPLOS_FORMULA.map((ex) => (
          <div key={ex.expr} className="cat-exemplo">
            <span className="forte pequeno">{ex.titulo}</span>
            <code className="cat-formula">{ex.expr}</code>
            <div><Botao tamanho="p" variante="sutil" icone={Play} onClick={() => aoTestar(ex)}>Testar no playground</Botao></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AbaRegras({ catalogo }) {
  const blocos = [
    { titulo: 'Tipos de meta', itens: Object.entries(catalogo.tipos_meta).map(([k, v]) => ({ t: v, d: {
      fixa: 'Mesmo valor para todos os participantes (ex.: 5 clientes cada).',
      distribuida: 'O fornecedor passa um total e o sistema divide pelo histórico, igualmente ou pela meta do ERP. Arredonda sem perder unidades.',
      historico: 'Cada um com a própria meta: o realizado no período anterior + X% (com piso para quem não tem histórico).',
      meta_geral: 'Percentual da meta mensal de cada vendedor cadastrada no ERP, proporcional aos dias da campanha.',
      sem_meta: 'Ninguém tem meta: vale a classificação (ranking) pelo realizado.',
    }[k] })) },
    { titulo: 'Como os critérios se combinam', itens: [
      { t: 'Média ponderada', d: 'Pontuação = média dos atingimentos pelos pesos. Critério abaixo do gatilho conta zero.' },
      { t: 'Cumprir todos', d: 'A pontuação é a média, mas só é elegível ao prêmio quem bater o gatilho de cada critério (cesta).' },
      { t: 'Melhor critério', d: 'Vale o maior atingimento entre os critérios.' },
      { t: 'Peso, gatilho e teto', d: 'Peso dá importância; gatilho é o mínimo para pontuar; teto limita o quanto um critério pode compensar os outros (ex.: 150%).' },
    ] },
    { titulo: 'Premiação', itens: [
      { t: 'Faixas', d: 'A pontuação define a faixa. Cada faixa paga um fixo e/ou um variável por unidade (ou por R$) do critério-base, sobre o total ou só sobre o que passar da meta.' },
      { t: 'A cada N vendas', d: 'Paga um valor por bloco completo vendido. Ex.: a cada 15 un, R$ 10; quem vende 47 un fecha 3 blocos e ganha R$ 30. Pode exigir um mínimo (de unidades ou da meta) para começar a ganhar, contar só o que passar da meta e limitar os blocos por pessoa. Com bloco de 1, vira "R$ por unidade".' },
      { t: 'Ranking', d: 'Prêmio por posição (1º, 2º, do 4º ao 10º…), por pontuação ou por quem vendeu mais. Dá para deixar concorrer só quem bateu a meta.' },
      { t: 'Prêmio para quem bater a meta', d: 'Valor fixo extra para todo mundo que atingir a meta (ou outro % escolhido). Soma com ranking, blocos ou rateio. Ex.: 1º lugar R$ 500 + R$ 50 por bater a meta = R$ 550.' },
      { t: 'Rateio de verba', d: 'Um valor fixo dividido entre quem atingir o mínimo: em partes iguais, pela pontuação ou pelo realizado.' },
      { t: 'Aceleradores e redutores', d: 'Multiplicam o prêmio conforme outro critério. Ex.: devolução acima de 10% → prêmio × 0,5.' },
      { t: 'Teto e orçamento', d: 'Teto limita o prêmio de cada pessoa; orçamento gera alerta quando a premiação projetada passa do valor.' },
    ] },
    { titulo: 'Status e projeção', itens: [
      { t: 'Projeção', d: 'Volume: metade pela curva do período anterior (quanto do total já tinha acontecido neste mesmo ponto, o que capta o empurrão de fim de mês e os dias da semana) e metade pelo ritmo (média do período + ritmo recente). Contagens que saturam (clientes, SKUs, cidades) usam a curva de maturação do período anterior.' },
      { t: 'Atingiu', d: 'Pontuação ≥ 100% e elegível.' },
      { t: 'No ritmo', d: 'Ainda não atingiu, mas a projeção chega a 100%.' },
      { t: 'Atenção', d: 'Projeção entre 85% e 100%.' },
      { t: 'Em risco', d: 'Projeção abaixo de 85%.' },
    ] },
  ];
  return (
    <div className="grade-2">
      {blocos.map((b) => (
        <Cartao key={b.titulo} titulo={b.titulo}>
          <div className="coluna" style={{ gap: 10 }}>
            {b.itens.map((it) => (
              <div key={it.t} className="coluna" style={{ gap: 2 }}>
                <span className="forte pequeno">{it.t}</span>
                <span className="pequeno sec">{it.d}</span>
              </div>
            ))}
          </div>
        </Cartao>
      ))}
    </div>
  );
}

function AbaPlayground({ catalogo, semente }) {
  const [expr, setExpr] = useState(semente?.expr || 'valor{canal: "App Mobile"} / valor * 100');
  const [formato, setFormato] = useState(semente?.formato || 'perc');
  const [totalizar, setTotalizar] = useState(semente?.totalizar || 'media');
  const [sentido, setSentido] = useState(semente?.sentido || 'maior');
  const [info, setInfo] = useState({ nome: semente?.nome || '', descricao: semente?.descricao || '', pedido: semente?.pedido || '' });
  const [salvar, setSalvar] = useState(false);
  const [nivel, setNivel] = useState('vendedor');
  const [periodo, setPeriodo] = useState('atual');
  const [produtos, setProdutos] = useState(SELETOR_VAZIO());
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: false });

  useEffect(() => {
    if (semente) {
      setExpr(semente.expr);
      setFormato(semente.formato);
      if (semente.totalizar) setTotalizar(semente.totalizar);
      if (semente.sentido) setSentido(semente.sentido);
      setInfo({ nome: semente.nome || '', descricao: semente.descricao || '', pedido: semente.pedido || '' });
    }
  }, [semente]);

  const aplicarDaIa = (r) => {
    setExpr(r.expressao);
    if (r.desfazer) return;
    if (r.formato) setFormato(r.formato);
    if (r.totalizar) setTotalizar(r.totalizar);
    if (r.sentido) setSentido(r.sentido);
    setInfo({ nome: r.nome || '', descricao: r.descricao || '', pedido: r.pedido || '' });
  };

  const hoje = hojeISO();
  const datas = periodo === 'atual'
    ? { inicio: resolverMarcadorData('@mes_atual_inicio', hoje), fim: resolverMarcadorData('@mes_atual_fim', hoje) }
    : { inicio: resolverMarcadorData('@mes_anterior_inicio', hoje), fim: resolverMarcadorData('@mes_anterior_fim', hoje) };
  const definicao = useMemo(() => ({
    nome: 'Playground de fórmula',
    ...datas,
    participantes: { nivel, ids: [], equipes: [] },
    criterios: [{ id: 'c1', nome: 'Fórmula', metrica: 'personalizada', expressao: expr, formato, totalizar, sentido, produtos, meta: { tipo: 'sem_meta' } }],
    premiacao: { tipo: 'nenhuma' },
  }), [expr, formato, totalizar, sentido, nivel, produtos, datas.inicio, datas.fim]); // eslint-disable-line react-hooks/exhaustive-deps
  const atrasada = useAtrasado(JSON.stringify(definicao), 700);

  useEffect(() => {
    const def = JSON.parse(atrasada);
    if (!def.criterios[0].expressao.trim()) return undefined;
    const controle = new AbortController();
    setEstado((e) => ({ ...e, carregando: true }));
    post('/apuracao/previa', { definicao: def }, { signal: controle.signal })
      .then((dados) => setEstado({ dados, erro: null, carregando: false }))
      .catch((erro) => erro.name !== 'AbortError' && setEstado((e) => ({ ...e, erro, carregando: false })));
    return () => controle.abort();
  }, [atrasada]);

  const r = estado.dados;
  const crit = r?.criterios?.[0];
  const top = (r?.participantes || [])
    .map((p) => ({ rotulo: p.nome, valor: p.criterios[0]?.realizado, sub: p.grupo }))
    .filter((p) => p.valor != null)
    .sort((a, b) => b.valor - a.valor);
  const criarCampanha = () => {
    sessionStorage.setItem('construtor:semente', JSON.stringify({
      ...definicao,
      nome: '',
      criterios: [{ ...definicao.criterios[0], nome: info.nome || 'Fórmula personalizada', meta: { tipo: 'historico', crescimento: 10 } }],
      premiacao: undefined,
    }));
    navegar('/campanhas/nova/editor?semente=1');
  };

  return (
    <div className="grade-2" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', alignItems: 'start' }}>
      <Cartao titulo="Fórmula" subtitulo="Escreva (ou peça para a IA), valide e veja o resultado com os dados reais, sem criar campanha." info={{ titulo: 'Playground', ...EXPLICA.playground }}>
        <div className="coluna" style={{ gap: 14 }}>
          <AssistenteFormula expressaoAtual={expr} aoAplicar={aplicarDaIa} />
          {info.nome && <div className="linha" style={{ gap: 8 }}><span className="forte">{info.nome}</span>{info.descricao && <span className="mini mudo truncar">{info.descricao}</span>}</div>}
          <EditorFormula valor={expr} aoMudar={setExpr} catalogo={catalogo} linhas={3} />
          <div className="cons-linha">
            <Campo rotulo="Formato" dica="Como o resultado aparece: número inteiro, decimal, dinheiro (R$) ou porcentagem.">
              <Segmentado tamanho="p" valor={formato} aoMudar={setFormato} opcoes={[{ valor: 'numero', rotulo: 'Nº' }, { valor: 'decimal', rotulo: 'Dec.' }, { valor: 'moeda', rotulo: 'R$' }, { valor: 'perc', rotulo: '%' }]} />
            </Campo>
            <Campo rotulo="Período" dica="Mês usado no teste. O mês anterior ajuda a conferir a fórmula com um mês completo.">
              <Segmentado tamanho="p" valor={periodo} aoMudar={setPeriodo} opcoes={[{ valor: 'atual', rotulo: 'Mês atual' }, { valor: 'anterior', rotulo: 'Mês anterior' }]} />
            </Campo>
          </div>
          <div className="cons-linha">
            <Campo rotulo="Total da campanha" info={{ texto: 'Como juntar o resultado de todos num número só.', como: ['Soma: para volumes (unidades, R$, clientes). O total é a soma de todos.', 'Média: para razões e percentuais (ticket, participação %). O total é a média.'] }}>
              <Segmentado tamanho="p" valor={totalizar} aoMudar={setTotalizar} opcoes={[{ valor: 'soma', rotulo: 'Soma' }, { valor: 'media', rotulo: 'Média' }]} />
            </Campo>
            <Campo rotulo="Melhor quando" dica="Maior: quanto mais, melhor (vendas). Menor: quanto menos, melhor (devolução, desconto). Muda a ordem do ranking e o cálculo do atingimento.">
              <Segmentado tamanho="p" valor={sentido} aoMudar={setSentido} opcoes={[{ valor: 'maior', rotulo: 'Maior' }, { valor: 'menor', rotulo: 'Menor' }]} />
            </Campo>
          </div>
          <Campo rotulo="Calcular por" dica="Para quem o resultado é calculado: cada vendedor, cada equipe, canal, UF ou segmento de cliente.">
            <Segmentado tamanho="p" valor={nivel} aoMudar={setNivel}
              opcoes={[{ valor: 'vendedor', rotulo: 'Vendedor' }, { valor: 'equipe', rotulo: 'Equipe' }, { valor: 'canal', rotulo: 'Canal' }, { valor: 'estado', rotulo: 'UF' }, { valor: 'segmento', rotulo: 'Segmento' }]} />
          </Campo>
          <Campo rotulo="Produtos do critério (escopo das variáveis sem recorte)" dica="Limita as variáveis aos produtos escolhidos. Sem escolha, vale o catálogo inteiro. Recortes como {marca: ...} dentro da fórmula substituem esta escolha.">
            <SeletorProdutos valor={produtos} aoMudar={setProdutos} compacto />
          </Campo>
          <div className="linha" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Botao icone={Save} onClick={() => setSalvar(true)} disabled={!expr.trim()}>Salvar fórmula</Botao>
            <Botao variante="primario" icone={Rocket} onClick={criarCampanha} disabled={!expr.trim()}>Criar campanha com esta fórmula</Botao>
          </div>
        </div>
        <ModalSalvarFormula aberto={salvar} aoFechar={() => setSalvar(false)}
          formula={{ expressao: expr, formato, totalizar, sentido, nome: info.nome, descricao: info.descricao, pedido: info.pedido }} />
      </Cartao>
      <div className="coluna" style={{ gap: 14, position: 'sticky', top: 76 }}>
        <Cartao titulo="Resultado" info={{ texto: 'A fórmula aplicada aos dados reais do período escolhido. Total: soma (ou média) de todos. Projeção: onde termina no ritmo atual. Período anterior: a mesma conta no período passado.', como: 'O Top 10 mostra quem teve o maior resultado. Se aparecer um aviso, a fórmula pode estar usando algo sem dados.' }} acoes={estado.carregando ? <span className="mini mudo">calculando…</span> : r ? <span className="mini mudo">{fmtNumero(r.duracao_ms)} ms</span> : null}>
          {estado.erro && <ErroCarga erro={estado.erro} />}
          {!r && !estado.erro && <Carregando altura={140} texto="Calculando…" />}
          {crit && (
            <div className="coluna" style={{ gap: 12, opacity: estado.carregando ? 0.6 : 1, transition: 'opacity 200ms' }}>
              <div className="linha quebra" style={{ gap: 22 }}>
                <div className="coluna" style={{ gap: 2 }}>
                  <span className="cat-rot">Total ({r.campanha.nivel_rotulo.toLowerCase()})</span>
                  <span className="cat-heroi-num" style={{ fontSize: 34 }}><Numero valor={crit.total.realizado} formato={formato} /></span>
                </div>
                <div className="coluna" style={{ gap: 2 }}>
                  <span className="cat-rot">Projeção</span>
                  <span className="forte">{fmtValor(crit.total.projecao, formato)}</span>
                </div>
                <div className="coluna" style={{ gap: 2 }}>
                  <span className="cat-rot">Período anterior</span>
                  <span className="forte">{fmtValor(crit.total.base, formato)}</span>
                </div>
              </div>
              {r.avisos?.map((a, i) => <Aviso key={i} tipo="aviso">{a}</Aviso>)}
              {top.length > 0 && (
                <>
                  <span className="cat-rot">Top 10</span>
                  <GraficoBarras itens={top.slice(0, 10)} formato={formato} largRotulo={170} />
                </>
              )}
            </div>
          )}
        </Cartao>
      </div>
    </div>
  );
}

export default function Catalogo({ query }) {
  const { dados: catalogo, erro, carregando } = useCatalogo();
  const { dados: dim } = useDimensoes();
  const { dados: produtos } = useProdutos();
  const [aba, setAba] = useState(query?.get('aba') || 'metricas');
  const [semente, setSemente] = useState(null);
  const mudarAba = (a) => {
    setAba(a);
    definirQuery({ aba: a });
  };
  const abaQuery = query?.get('aba');
  useEffect(() => {
    if (abaQuery && ABAS.some((x) => x.id === abaQuery)) setAba(abaQuery);
  }, [abaQuery]);

  return (
    <div>
      <Cabecalho
        titulo="Catálogo de métricas"
        info={EXPLICA.catalogo}
        subtitulo={catalogo ? `${Object.keys(catalogo.metricas).length} métricas prontas, ${Object.keys(catalogo.variaveis).length} variáveis e ${catalogo.dimensoes_variavel.length} dimensões de recorte, tudo combinável em fórmulas.` : 'Tudo o que o motor de apuração sabe medir.'}
        acoes={<Botao variante="primario" icone={Calculator} onClick={() => mudarAba('playground')}>Abrir playground</Botao>}
      />
      {erro && <ErroCarga erro={erro} />}
      {carregando && <Carregando altura={300} />}
      {catalogo && (
        <>
          <Abas abas={ABAS} ativa={aba} aoMudar={mudarAba} />
          {aba === 'metricas' && <AbaMetricas catalogo={catalogo} />}
          {aba === 'variaveis' && <AbaVariaveis catalogo={catalogo} />}
          {aba === 'dimensoes' && <AbaDimensoes catalogo={catalogo} dim={dim} produtos={produtos} />}
          {aba === 'formulas' && <AbaFormulas catalogo={catalogo} aoTestar={(ex) => { setSemente({ ...ex }); mudarAba('playground'); }} />}
          {aba === 'biblioteca' && (
            <BibliotecaFormulas
              aoAbrir={(f) => { setSemente({ expr: f.expressao, formato: f.formato, totalizar: f.totalizar, sentido: f.sentido, nome: f.nome, descricao: f.descricao, t: Date.now() }); mudarAba('playground'); }}
              aoUsarEmCampanha={(f) => {
                sessionStorage.setItem('construtor:semente', JSON.stringify({
                  nome: '',
                  criterios: [{ id: 'c1', nome: f.nome, metrica: 'personalizada', expressao: f.expressao, formato: f.formato, totalizar: f.totalizar, sentido: f.sentido, meta: { tipo: 'historico', crescimento: 10 } }],
                }));
                post(`/formulas/${f.id}/uso`, {}).catch(() => {});
                navegar('/campanhas/nova/editor?semente=1');
              }}
            />
          )}
          {aba === 'regras' && <AbaRegras catalogo={catalogo} />}
          {aba === 'playground' && <AbaPlayground catalogo={catalogo} semente={semente} />}
        </>
      )}
    </div>
  );
}
