import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, Building2, CalendarRange, Check, CopyPlus, Globe2, History, Layers, MapPin, Plus,
  Rocket, Save, ShoppingBasket, Store, Tags, UserRound, Users,
} from 'lucide-react';
import './construtor/construtor.css';
import MultiSelecao from '../componentes/MultiSelecao.jsx';
import {
  Alternador, AreaTexto, Aviso, Botao, Cabecalho, Campo, Carregando, Chip, Entrada, ErroCarga, Explica, Segmentado, SeloCampanha, useToast,
} from '../componentes/ui.jsx';
import { get, post, put } from '../lib/api.js';
import { useAtalho } from '../lib/anim.js';
import { useCatalogo, useClientes, useDimensoes, useProdutos } from '../lib/dados.js';
import { fmtDataHora, fmtNumero, fmtPeriodo } from '../lib/formato.js';
import { navegar } from '../lib/rotas.js';
import CestaRapida from './construtor/CestaRapida.jsx';
import EditorCriterio from './construtor/EditorCriterio.jsx';
import EditorPremiacao from './construtor/EditorPremiacao.jsx';
import ModalExcecao, { bloqueioContaCorrente } from './contacorrente/ModalExcecao.jsx';
import PreviaAoVivo from './construtor/PreviaAoVivo.jsx';
import Revisao from './construtor/Revisao.jsx';
import SeletorFornecedor from './construtor/SeletorFornecedor.jsx';
import { usePrevia } from './construtor/usePrevia.js';
import {
  CORES_CAMPANHA, VARIOS_FORNECEDORES, adaptarAoFabricante, atalhosPeriodo, completar, completarCriterio, definir, inferirFabricante, nivelPlural,
  novoIdCriterio, pendencias, resolverModelo, seletorDoFabricante, seletorVazio,
} from './construtor/util.js';

const SECOES = [
  {
    id: 'identificacao', titulo: 'Identificação', curto: 'Identificação', desc: 'Nome, fornecedor, período e descrição',
    info: {
      texto: 'Os dados básicos da campanha: como ela se chama, de qual fornecedor é, quando começa e termina.',
      como: ['Escolha o fornecedor primeiro: os critérios passam a usar os produtos dele.', 'Use os atalhos de período (Este mês, Próximo mês...) para não digitar datas.'],
    },
  },
  {
    id: 'participantes', titulo: 'Participantes', curto: 'Participantes', desc: 'Quem disputa a campanha',
    info: {
      texto: 'Quem compete e recebe meta e prêmio: vendedores, equipes, clientes, canais, UFs, segmentos ou a empresa inteira.',
      como: ['Escolha o tipo de participante.', 'Deixe a lista vazia para todos participarem, ou escolha só alguns nomes.'],
      exemplo: 'Desafio entre equipes: escolha "Equipes". Cada equipe soma as vendas dos seus vendedores.',
    },
  },
  {
    id: 'vendas', titulo: 'Vendas que contam', curto: 'Vendas', desc: 'Que vendas entram na conta: data, situação, canal, cliente e CFOP',
    info: {
      texto: 'Filtros que valem para a campanha inteira. Uma venda só entra na apuração se passar por todos eles.',
      como: ['Em branco quer dizer "todos".', 'Desconsidere bonificações para não premiar brinde.'],
      exemplo: 'Campanha só do televendas em GO: escolha o canal Televendas e a UF GO.',
    },
  },
  {
    id: 'criterios', titulo: 'Critérios e metas', curto: 'Critérios e metas', desc: 'O que medir, em quais produtos e qual é a meta',
    info: {
      texto: 'Cada critério é uma regra da campanha: o que se mede (unidades, faturamento, clientes...), em quais produtos e qual é a meta de cada participante.',
      como: ['Leia a frase azul no topo de cada critério: ela resume a regra em português.', 'Uma campanha pode ter vários critérios (ex.: vender Sensodyne e positivar clientes).', 'Use "Cesta rápida" para criar um critério por produto de uma vez.'],
      exemplo: 'Critério 1: vender 10% mais unidades Haleon do que no mês passado.',
    },
  },
  {
    id: 'premios', titulo: 'Apuração e prêmios', curto: 'Prêmios', desc: 'Como pontuar e como premiar',
    info: {
      texto: 'Define como o resultado vira pontuação (% da meta) e quanto cada um ganha.',
      como: ['Com mais de um critério, escolha como eles se combinam.', 'Depois escolha o tipo de prêmio e confira a simulação no fim da seção.'],
    },
  },
  {
    id: 'revisao', titulo: 'Revisão', curto: 'Revisão', desc: 'Regulamento em linguagem natural e pendências',
    info: {
      texto: 'O regulamento escrito automaticamente a partir das regras, pronto para mandar para a equipe, e a lista do que falta resolver.',
      como: ['Clique numa pendência para ir direto ao campo.', '"Copiar texto" copia o regulamento para colar no WhatsApp ou e-mail.'],
    },
  },
];

const NIVEIS = [
  { valor: 'vendedor', rotulo: 'Vendedores', icone: UserRound },
  { valor: 'equipe', rotulo: 'Equipes', icone: Users },
  { valor: 'cliente', rotulo: 'Clientes', icone: Store },
  { valor: 'canal', rotulo: 'Canais', icone: Layers },
  { valor: 'estado', rotulo: 'UFs', icone: MapPin },
  { valor: 'segmento', rotulo: 'Segmentos', icone: Tags },
  { valor: 'empresa', rotulo: 'Empresa', icone: Building2 },
];

const BONIFICACAO = ['5.910', '6.910'];

// rascunho local (sobrevive a recarregar a página ou fechar a aba)
const lerRascunho = (k) => {
  try {
    const r = JSON.parse(localStorage.getItem(k) || 'null');
    return r && Date.now() - r.em < 7 * 864e5 ? r : null;
  } catch {
    return null;
  }
};
const gravarRascunho = (k, json) => {
  try {
    localStorage.setItem(k, JSON.stringify({ json, em: Date.now() }));
  } catch {
    /* armazenamento indisponível */
  }
};
const apagarRascunho = (k) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* armazenamento indisponível */
  }
};

function Secao({ id, numero, titulo, desc, info, children, acoes }) {
  return (
    <section id={`sec-${id}`} className="cartao cons-secao" data-secao={id}>
      <div className="cons-secao-topo">
        <span className="cons-secao-num">{numero}</span>
        <div className="cresce">
          <div className="cons-secao-titulo com-explica">{titulo}{info && <Explica titulo={titulo} {...info} />}</div>
          <div className="cons-secao-desc">{desc}</div>
        </div>
        {acoes}
      </div>
      <div className="cons-secao-corpo">{children}</div>
    </section>
  );
}

export default function Construtor({ params = {}, query }) {
  const id = params.id ? Number(params.id) : null;
  const modelo = query?.get('modelo') || null;
  const semente = query?.get('semente') || null;
  const fabricanteInicial = query?.get('fabricante') || null;
  const toast = useToast();
  const { dados: catalogo, erro: erroCatalogo } = useCatalogo();
  const { dados: dim } = useDimensoes();
  const { dados: produtos } = useProdutos();
  const nivelAtual = useRef('vendedor');
  const [adaptacao, setAdaptacao] = useState(null);
  const [ofertaDispensada, setOfertaDispensada] = useState(null);

  const [def, setDef] = useState(null);
  const [original, setOriginal] = useState(null);
  const [statusCampanha, setStatusCampanha] = useState('rascunho');
  const [erroCarga, setErroCarga] = useState(null);
  const [errosSalvar, setErrosSalvar] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [rascunho, setRascunho] = useState(null);
  const [cesta, setCesta] = useState(false);
  const [ativa, setAtiva] = useState('identificacao');
  const iniciado = useRef(null);
  const chaveRascunho = `construtor:${id || 'nova'}:${modelo || semente || 'zero'}`;

  // ---------------------------------------------------------------- carga inicial
  useEffect(() => {
    // a mesma tela pode ser reaproveitada ao trocar de campanha/modelo: recarrega quando a origem muda
    const chaveCarga = `${id || ''}|${modelo || ''}|${semente || ''}|${fabricanteInicial || ''}`;
    if (iniciado.current === chaveCarga) return;
    if (iniciado.current !== null && def) {
      setDef(null);
      setAdaptacao(null);
      setErrosSalvar([]);
      setRascunho(null);
    }
    if (modelo && !id && !catalogo) return; // espera o catálogo para achar o modelo
    if (!dim || !produtos) return; // fornecedor e produtos são resolvidos antes de montar a definição
    let vivo = true;
    (async () => {
      try {
        let inicial;
        let nomeModelo;
        if (id) {
          const r = await get(`/campanhas/${id}`);
          inicial = completar(r.definicao);
          if (vivo) setStatusCampanha(r.status);
        } else if (semente) {
          let s = {};
          try {
            s = JSON.parse(sessionStorage.getItem('construtor:semente') || '{}');
          } catch {
            s = {};
          }
          inicial = completar(s);
        } else if (modelo) {
          const m = catalogo.modelos?.find((x) => x.chave === modelo);
          if (!m) toast.erro('Modelo não encontrado. Começando do zero.');
          nomeModelo = m?.nome;
          inicial = completar(m ? resolverModelo(m.definicao) : {});
        } else {
          inicial = completar({});
        }
        inicial = inferirFabricante(inicial, dim);
        if (fabricanteInicial && !id) {
          const r = adaptarAoFabricante(inicial, fabricanteInicial, { marcas: dim.marcas, produtos, grupos: dim.grupos }, { nomeModelo });
          inicial = r.def;
          if (modelo && (r.mudou.length || r.kits.length)) setAdaptacao({ fab: fabricanteInicial, ...r });
        }
        if (!vivo) return;
        iniciado.current = chaveCarga;
        nivelAtual.current = inicial.participantes.nivel;
        const json = JSON.stringify(inicial);
        setDef(inicial);
        setOriginal(json);
        const r = lerRascunho(chaveRascunho);
        if (r && r.json !== json) setRascunho(r);
      } catch (e) {
        if (vivo) setErroCarga(e);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [id, modelo, semente, catalogo, dim, produtos, fabricanteInicial, chaveRascunho, toast]);

  const atual = useMemo(() => (def ? JSON.stringify(def) : null), [def]);
  const sujo = Boolean(def && original && atual !== original);

  // rascunho automático
  useEffect(() => {
    if (!def || !original) return undefined;
    const t = setTimeout(() => (sujo ? gravarRascunho(chaveRascunho, atual) : apagarRascunho(chaveRascunho)), 700);
    return () => clearTimeout(t);
  }, [atual, sujo, def, original, chaveRascunho]);

  // aviso ao fechar a aba com alterações
  useEffect(() => {
    if (!sujo) return undefined;
    const f = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [sujo]);

  // seção ativa conforme a rolagem: a última seção cujo topo já passou da linha de leitura
  useEffect(() => {
    if (!def) return undefined;
    let quadro;
    const calcular = () => {
      const secoes = [...document.querySelectorAll('[data-secao]')];
      if (!secoes.length) return;
      let atualSecao = secoes[0].dataset.secao;
      for (const el of secoes) if (el.getBoundingClientRect().top <= 150) atualSecao = el.dataset.secao;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) atualSecao = secoes[secoes.length - 1].dataset.secao;
      setAtiva(atualSecao);
    };
    const aoRolar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(calcular);
    };
    window.addEventListener('scroll', aoRolar, { passive: true });
    calcular();
    return () => {
      window.removeEventListener('scroll', aoRolar);
      cancelAnimationFrame(quadro);
    };
  }, [def ? 'pronto' : 'carregando']); // eslint-disable-line react-hooks/exhaustive-deps

  const previa = usePrevia(def, { ativo: Boolean(def) });
  const pend = useMemo(() => (def ? pendencias(def, catalogo) : { erros: [], alertas: [] }), [def, catalogo]);

  // ---------------------------------------------------------------- edição
  const mudar = useCallback((caminho, valor) => setDef((d) => definir(d, caminho, valor)), []);
  const mudarCriterio = (i, novo) => setDef((d) => definir(d, ['criterios', i], novo));
  const irPara = (secao) => document.getElementById(`sec-${secao}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const adicionarCriterio = (base = {}) =>
    setDef((d) => {
      const idNovo = novoIdCriterio(d.criterios);
      const produtos = d.fabricante ? { fabricantes: [d.fabricante] } : {};
      return { ...d, criterios: [...d.criterios, completarCriterio({ nome: '', metrica: 'quantidade', meta: { tipo: 'historico', crescimento: 10 }, produtos, ...base, id: idNovo })] };
    });

  // ---------------------------------------------------------------- fornecedor
  const ctxProdutos = useMemo(() => ({ marcas: dim?.marcas || [], produtos: produtos || [], grupos: dim?.grupos || [] }), [dim, produtos]);
  const escolherFabricante = (fab) => {
    setAdaptacao(null);
    setOfertaDispensada(null);
    setDef((d) => {
      if (fab === VARIOS_FORNECEDORES) return { ...d, fabricante: null, varios_fornecedores: true, fornecedor: 'Vários fornecedores' };
      if (!fab) return { ...d, fabricante: null, varios_fornecedores: false, fornecedor: '' };
      const novo = { ...d, fabricante: fab, varios_fornecedores: false, fornecedor: fab };
      // campanha do zero: critérios que ainda não têm produtos nascem com os produtos do fornecedor
      if (!id && !modelo && !semente && d.criterios.every((c) => c.metrica !== 'combo' && seletorVazio(c.produtos))) {
        novo.criterios = d.criterios.map((c) => ({ ...c, produtos: { ...c.produtos, fabricantes: [fab] } }));
      }
      return novo;
    });
  };
  // critérios que contam produtos de fora do fornecedor (ou todos os produtos): oferta de aplicar o fornecedor
  const foraDoFornecedor = useMemo(() => {
    if (!def?.fabricante || !produtos) return [];
    return def.criterios
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.metrica !== 'combo' && JSON.stringify(seletorDoFabricante(c.produtos, def.fabricante, ctxProdutos)) !== JSON.stringify(c.produtos))
      .map(({ i }) => i);
  }, [def?.fabricante, def?.criterios, produtos, ctxProdutos]); // eslint-disable-line react-hooks/exhaustive-deps
  const mostrarOferta = foraDoFornecedor.length > 0 && ofertaDispensada !== def?.fabricante;
  const aplicarFornecedor = (indices) =>
    setDef((d) => ({
      ...d,
      criterios: d.criterios.map((c, i) => (indices.includes(i) ? { ...c, produtos: seletorDoFabricante(c.produtos, d.fabricante, ctxProdutos) } : c)),
    }));
  const duplicarCriterio = (i) =>
    setDef((d) => {
      const copia = structuredClone(d.criterios[i]);
      copia.id = novoIdCriterio(d.criterios);
      copia.nome = copia.nome ? `${copia.nome} (cópia)` : '';
      const lista = [...d.criterios];
      lista.splice(i + 1, 0, copia);
      return { ...d, criterios: lista };
    });
  const removerCriterio = (i) =>
    setDef((d) => {
      const removido = d.criterios[i].id;
      const lista = d.criterios.filter((_, j) => j !== i);
      const pr = { ...d.premiacao, multiplicadores: d.premiacao.multiplicadores.filter((m) => m.criterio !== removido) };
      if (pr.criterio_base === removido) pr.criterio_base = lista[0].id;
      return { ...d, criterios: lista, premiacao: pr };
    });
  const moverCriterio = (i, delta) =>
    setDef((d) => {
      const lista = [...d.criterios];
      const j = i + delta;
      if (j < 0 || j >= lista.length) return d;
      [lista[i], lista[j]] = [lista[j], lista[i]];
      return { ...d, criterios: lista };
    });
  const criarCesta = (novos, { regraTodos }) =>
    setDef((d) => {
      const intocado = d.criterios.length === 1 && !d.criterios[0].nome && !d.criterios[0].produtos.marcas.length && !d.criterios[0].produtos.fabricantes.length && !d.criterios[0].produtos.ids.length;
      let lista = intocado ? [] : [...d.criterios];
      for (const n of novos) lista = [...lista, completarCriterio({ ...n, id: novoIdCriterio(lista) })];
      return {
        ...d,
        criterios: lista,
        apuracao: regraTodos ? { regra: 'todos' } : d.apuracao,
        premiacao: { ...d.premiacao, criterio_base: lista.some((c) => c.id === d.premiacao.criterio_base) ? d.premiacao.criterio_base : lista[0].id },
      };
    });

  const mudarNivel = (nivel) => {
    nivelAtual.current = nivel;
    setDef((d) => ({
      ...d,
      participantes: { nivel, ids: [], equipes: [] },
      // metas ajustadas à mão referem-se aos participantes do nível anterior
      criterios: d.criterios.map((c) => ({ ...c, meta: { ...c.meta, valores: {} } })),
    }));
  };

  // ---------------------------------------------------------------- salvar
  const [bloqueioVerba, setBloqueioVerba] = useState(null);
  const salvar = async (ativar = false, excecao = undefined) => {
    if (!def || (salvando && !excecao)) return;
    if (pend.erros.length) {
      setErrosSalvar(pend.erros.map((e) => e.texto));
      toast.erro(pend.erros[0].texto);
      irPara(pend.erros[0].secao);
      return;
    }
    setSalvando(true);
    setErrosSalvar([]);
    const status = ativar ? 'ativa' : statusCampanha;
    try {
      let novoId = id;
      const corpo = { definicao: def, status, excecao_conta_corrente: excecao };
      if (id) await put(`/campanhas/${id}`, corpo);
      else novoId = (await post('/campanhas', corpo)).id;
      setBloqueioVerba(null);
      apagarRascunho(chaveRascunho);
      setOriginal(atual);
      toast.ok(ativar ? 'Campanha ativada. A apuração já está rodando.' : id ? 'Alterações salvas.' : 'Rascunho salvo.');
      navegar(`/campanhas/${novoId}`);
    } catch (e) {
      const b = bloqueioContaCorrente(e);
      if (b) {
        setBloqueioVerba({ ...b, ativar });
        return;
      }
      setErrosSalvar(e.corpo?.erros?.length ? e.corpo.erros : [e.message]);
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };
  useAtalho('mod+s', useCallback(() => salvar(false), [def, salvando, statusCampanha, pend, atual])); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- opções de seleção
  const { dados: clientes } = useClientes();
  const opCanais = useMemo(() => (dim?.canais || []).map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: c.tipo })), [dim]);
  const opClientes = useMemo(() => (clientes || []).map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: `${c.cidade || ''}/${c.estado || ''}` })), [clientes]);
  const opCfops = useMemo(() => (dim?.cfops || []).map((c) => ({ valor: c.cfop, rotulo: c.cfop, detalhe: c.descricao })), [dim]);
  const opParticipantes = useMemo(() => {
    if (!dim || !def) return [];
    switch (def.participantes.nivel) {
      case 'vendedor':
        return dim.vendedores.map((v) => ({ valor: String(v.id), rotulo: v.nome, detalhe: v.equipe ? `Equipe ${v.equipe}` : '' }));
      case 'equipe':
        return dim.equipes.map((e) => ({ valor: String(e.id), rotulo: e.nome, detalhe: `${e.membros} vendedores` }));
      case 'cliente':
        return opClientes.map((o) => ({ ...o, valor: String(o.valor) }));
      case 'canal':
        return dim.canais.map((c) => ({ valor: String(c.id), rotulo: c.nome, detalhe: c.tipo }));
      case 'estado':
        return dim.estados.map((uf) => ({ valor: uf, rotulo: uf }));
      case 'segmento':
        return dim.segmentos.map((s) => ({ valor: s, rotulo: s }));
      default:
        return [];
    }
  }, [dim, def?.participantes.nivel, opClientes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- render
  if (erroCarga) return <ErroCarga erro={erroCarga} aoTentar={() => window.location.reload()} />;
  if (erroCatalogo) return <ErroCarga erro={erroCatalogo} aoTentar={() => window.location.reload()} />;
  if (!def || !catalogo || !dim) return <Carregando texto="Preparando o construtor…" altura={420} />;

  const f = def.filtros;
  const semBonificacao = BONIFICACAO.every((c) => f.cfops_excluir.includes(c));
  const estadoSecao = (sid) => {
    if (pend.erros.some((e) => e.secao === sid)) return <AlertCircle size={14} style={{ color: 'var(--critico)' }} />;
    if (pend.alertas.some((e) => e.secao === sid)) return <AlertTriangle size={14} style={{ color: 'var(--aviso-texto)' }} />;
    return <Check size={14} style={{ color: 'var(--bom)' }} />;
  };
  const voltar = id ? `/campanhas/${id}` : '/campanhas/nova';
  const nPart = previa.dados?.resumo?.participantes;

  return (
    <div>
      <Cabecalho
        sobre={
          <>
            <a href={`#${voltar}`} className="linha g4" style={{ display: 'inline-flex' }}><ArrowLeft size={13} /> {id ? 'Voltar à apuração' : 'Modelos'}</a>
            <span>·</span>
            <span>{id ? 'Editando campanha' : modelo ? `Modelo: ${catalogo.modelos?.find((m) => m.chave === modelo)?.nome || modelo}` : 'Nova campanha'}</span>
          </>
        }
        titulo={
          <span className="linha" style={{ gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: def.cor, flex: 'none' }} />
            <span className="truncar">{def.nome || 'Nova campanha'}</span>
          </span>
        }
        subtitulo={
          <span className="linha quebra" style={{ gap: 8 }}>
            {def.fornecedor && <span className="forte">{def.fornecedor}</span>}
            <span>{fmtPeriodo(def.inicio, def.fim)}</span>
            {id && <SeloCampanha status={statusCampanha} />}
            {sujo && <span className="selo aviso">Alterações não salvas</span>}
          </span>
        }
        acoes={
          <>
            <Botao variante="fantasma" onClick={() => navegar(voltar)}>Cancelar</Botao>
            {id && statusCampanha === 'ativa' ? (
              <Botao variante="primario" icone={Save} carregando={salvando} onClick={() => salvar(false)} title="Ctrl+S">Salvar alterações</Botao>
            ) : (
              <>
                <Botao icone={Save} carregando={salvando} onClick={() => salvar(false)} title="Ctrl+S">Salvar rascunho</Botao>
                <Botao variante="primario" icone={Rocket} carregando={salvando} onClick={() => salvar(true)}>Salvar e ativar</Botao>
              </>
            )}
          </>
        }
      />

      <AnimatePresence>
        {rascunho && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} style={{ marginBottom: 16 }}>
            <Aviso tipo="info" titulo="Você tem alterações não salvas desta campanha"
              acao={
                <div className="linha g4">
                  <Botao tamanho="p" variante="primario" icone={History} onClick={() => { setDef(completar(JSON.parse(rascunho.json))); setRascunho(null); }}>Restaurar</Botao>
                  <Botao tamanho="p" variante="fantasma" onClick={() => { apagarRascunho(chaveRascunho); setRascunho(null); }}>Descartar</Botao>
                </div>
              }>
              Rascunho automático de {fmtDataHora(new Date(rascunho.em).toISOString())}.
            </Aviso>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="cons-layout">
        <nav className="cons-nav" aria-label="Seções do construtor">
          {SECOES.map((s, i) => (
            <button key={s.id} type="button" className={`cons-nav-item${ativa === s.id ? ' ativo' : ''}`} onClick={() => irPara(s.id)}>
              <span className="cons-nav-num">{i + 1}</span>
              <span className="truncar" title={s.titulo}>{s.curto}</span>
              <span className="cons-nav-estado">{estadoSecao(s.id)}</span>
            </button>
          ))}
          <div className="cons-nav-dica">
            Preencha de cima para baixo. A prévia ao lado mostra, a cada alteração, como a campanha estaria hoje com as vendas reais. <b>Ctrl+S</b> salva.
          </div>
        </nav>

        <div className="cons-form">
          {errosSalvar.length > 0 && (
            <div className="cons-erros">
              <Aviso tipo="erro" titulo="Não foi possível salvar">
                {errosSalvar.map((e, i) => <div key={i}>• {e}</div>)}
              </Aviso>
            </div>
          )}

          {/* 1. Identificação */}
          <Secao id="identificacao" numero={1} titulo={SECOES[0].titulo} desc={SECOES[0].desc} info={SECOES[0].info}>
            <input className="cons-titulo-nome" value={def.nome} placeholder="Nome da campanha (ex.: Sensodyne outubro)" onChange={(e) => mudar(['nome'], e.target.value)} autoFocus={!id} />
            {adaptacao && (
              <Aviso tipo="info" titulo={`Modelo adaptado para ${adaptacao.fab}`}
                acao={<Botao tamanho="p" variante="fantasma" onClick={() => setAdaptacao(null)}>Entendi</Botao>}>
                {adaptacao.mudou.length > 0 && <div>{adaptacao.mudou.length > 1 ? 'Os critérios' : 'O critério'} {adaptacao.mudou.map((m) => `"${m}"`).join(', ')} agora {adaptacao.mudou.length > 1 ? 'contam' : 'conta'} os produtos {adaptacao.fab}. Refine por marca se a campanha for de uma linha específica.</div>}
                {adaptacao.kits.length > 0 && <div>No kit {adaptacao.kits.map((m) => `"${m}"`).join(', ')}, escolha a marca de cada item.</div>}
                <div>Confira as metas: os números vieram do modelo e foram pensados para outro fornecedor.</div>
              </Aviso>
            )}
            <div className="cons-linha dupla">
              <SeletorFornecedor def={def} dim={dim} aoEscolher={escolherFabricante} />
              <Campo rotulo="Cor" dica="Só para identificar a campanha nas listas, gráficos e no painel.">
                <div className="cons-cores">
                  {CORES_CAMPANHA.map((c) => (
                    <button key={c} type="button" className={`cons-cor${def.cor === c ? ' sel' : ''}`} style={{ background: c, color: c }} onClick={() => mudar(['cor'], c)} aria-label={`Cor ${c}`} />
                  ))}
                </div>
              </Campo>
            </div>
            {mostrarOferta && (
              <Aviso tipo="aviso" titulo={`${foraDoFornecedor.length === 1 ? 'Um critério conta' : `${foraDoFornecedor.length} critérios contam`} produtos de fora da ${def.fabricante}`}
                acao={
                  <div className="linha g4">
                    <Botao tamanho="p" variante="primario" onClick={() => aplicarFornecedor(foraDoFornecedor)}>Usar só {def.fabricante}</Botao>
                    <Botao tamanho="p" variante="fantasma" onClick={() => setOfertaDispensada(def.fabricante)}>Manter assim</Botao>
                  </div>
                }>
                {foraDoFornecedor.map((i) => def.criterios[i].nome || `Critério ${i + 1}`).join(', ')}: hoje {foraDoFornecedor.length === 1 ? 'ele soma' : 'eles somam'} vendas de outros fabricantes (ou de todos os produtos).
              </Aviso>
            )}
            <div className="cons-linha">
              <Campo rotulo="Início" dica="Primeiro dia em que as vendas contam."><Entrada type="date" value={def.inicio} onChange={(e) => mudar(['inicio'], e.target.value)} icone={CalendarRange} /></Campo>
              <Campo rotulo="Fim" dica="Último dia em que as vendas contam. A projeção estima o resultado até esta data."><Entrada type="date" value={def.fim} onChange={(e) => mudar(['fim'], e.target.value)} icone={CalendarRange} /></Campo>
            </div>
            <div className="cons-atalhos">
              {atalhosPeriodo().map((a) => (
                <Chip key={a.rotulo} ativo={def.inicio === a.inicio && def.fim === a.fim} aoClicar={() => setDef((d) => ({ ...d, inicio: a.inicio, fim: a.fim }))}>{a.rotulo}</Chip>
              ))}
            </div>
            <Campo rotulo="Descrição e regras para a equipe" ajuda="Aparece nos boletins e no regulamento."
              dica="Texto livre para a equipe ler: o objetivo da campanha e combinados que não cabem nas regras (ex.: prazo de faturamento).">
              <AreaTexto rows={3} value={def.descricao} onChange={(e) => mudar(['descricao'], e.target.value)} placeholder="Ex.: Campanha de lançamento. Vale pedido faturado até o último dia do mês." />
            </Campo>
          </Secao>

          {/* 2. Participantes */}
          <Secao id="participantes" numero={2} titulo={SECOES[1].titulo} desc={SECOES[1].desc} info={SECOES[1].info}
            acoes={nPart != null ? <span className="selo acento">{fmtNumero(nPart)} {nivelPlural(def.participantes.nivel)}</span> : null}>
            <Segmentado valor={def.participantes.nivel} aoMudar={mudarNivel} opcoes={NIVEIS} />
            {def.participantes.nivel !== 'empresa' ? (
              <div className="cons-linha">
                <Campo rotulo={`Somente estes ${nivelPlural(def.participantes.nivel)}`} ajuda="Vazio = todos participam."
                  dica={`Escolha nomes só se a campanha for para um grupo. Sem escolha, todos os ${nivelPlural(def.participantes.nivel)} com venda no período participam.`}>
                  <MultiSelecao opcoes={opParticipantes} valores={def.participantes.ids} aoMudar={(v) => mudar(['participantes', 'ids'], v.map(String))} placeholder="Todos" />
                </Campo>
                {def.participantes.nivel === 'vendedor' && (
                  <Campo rotulo="Somente das equipes" ajuda="Restringe os vendedores às equipes escolhidas." dica="Ex.: só a equipe Centro-Oeste disputa. Vazio = vendedores de todas as equipes.">
                    <MultiSelecao opcoes={(dim?.equipes || []).map((e) => ({ valor: String(e.id), rotulo: e.nome, detalhe: `${e.membros}` }))}
                      valores={def.participantes.equipes} aoMudar={(v) => mudar(['participantes', 'equipes'], v.map(String))} placeholder="Todas" />
                  </Campo>
                )}
              </div>
            ) : (
              <div className="cons-ajuda"><Globe2 size={13} style={{ verticalAlign: -2 }} /> A empresa inteira é apurada como um único participante. Ideal para metas do fornecedor com a distribuidora.</div>
            )}
          </Secao>

          {/* 3. Vendas que contam */}
          <Secao id="vendas" numero={3} titulo={SECOES[2].titulo} desc={SECOES[2].desc} info={SECOES[2].info}>
            <div className="cons-linha">
              <Campo rotulo="Data que vale" info={{
                texto: 'Qual data decide se a venda caiu dentro do período da campanha.',
                como: ['Data do pedido: vale quando o pedido foi tirado (mais usado em campanha de vendedor).', 'Data do faturamento: vale quando a nota fiscal saiu (mais usado com o fornecedor).'],
                exemplo: 'Pedido tirado em 30/09 e faturado em 01/10: pela data do pedido conta em setembro; pelo faturamento, em outubro.',
              }}>
                <Segmentado valor={def.data_base} aoMudar={(v) => mudar(['data_base'], v)} opcoes={[{ valor: 'pedido', rotulo: 'Data do pedido' }, { valor: 'faturamento', rotulo: 'Data do faturamento' }]} />
              </Campo>
              <Campo rotulo="Calendário da projeção" info={{
                texto: 'Como o sistema conta os dias para estimar o fechamento.',
                como: ['Dias úteis: segunda a sexta, sem feriados (para quem não vende no fim de semana).', 'Corridos: todos os dias.', 'Padrão: o que está nas Configurações.'],
              }}>
                <Segmentado valor={def.calendario || 'padrao'} aoMudar={(v) => mudar(['calendario'], v === 'padrao' ? null : v)}
                  opcoes={[{ valor: 'padrao', rotulo: 'Padrão' }, { valor: 'uteis', rotulo: 'Dias úteis' }, { valor: 'corridos', rotulo: 'Corridos' }]} />
              </Campo>
            </div>
            <Campo rotulo="Situações da venda que contam" dica="Normalmente só Faturado. Inclua outras situações se a campanha aceitar pedido ainda não faturado.">
              <div className="cons-atalhos">
                {(dim?.status_venda || ['Faturado']).map((s) => {
                  const on = def.status_venda.includes(s);
                  return (
                    <Chip key={s} ativo={on} aoClicar={() => mudar(['status_venda'], on ? def.status_venda.filter((x) => x !== s) : [...def.status_venda, s])}>
                      {on && <Check size={12} />} {s}
                    </Chip>
                  );
                })}
              </div>
            </Campo>
            <div className="cons-linha">
              <Campo rotulo="Canais"><MultiSelecao opcoes={opCanais} valores={f.canais} aoMudar={(v) => mudar(['filtros', 'canais'], v)} placeholder="Todos" /></Campo>
              <Campo rotulo="Segmentos de cliente"><MultiSelecao opcoes={(dim?.segmentos || []).map((s) => ({ valor: s, rotulo: s }))} valores={f.segmentos} aoMudar={(v) => mudar(['filtros', 'segmentos'], v)} placeholder="Todos" /></Campo>
              <Campo rotulo="Porte do cliente"><MultiSelecao opcoes={(dim?.portes || []).map((s) => ({ valor: s, rotulo: s }))} valores={f.portes} aoMudar={(v) => mudar(['filtros', 'portes'], v)} placeholder="Todos" /></Campo>
            </div>
            <div className="cons-linha">
              <Campo rotulo="UFs"><MultiSelecao opcoes={(dim?.estados || []).map((s) => ({ valor: s, rotulo: s }))} valores={f.estados} aoMudar={(v) => mudar(['filtros', 'estados'], v)} placeholder="Todas" /></Campo>
              <Campo rotulo="Cidades"><MultiSelecao opcoes={(dim?.cidades || []).map((c) => ({ valor: c.cidade, rotulo: `${c.cidade}/${c.estado}`, detalhe: `${c.clientes}` }))} valores={f.cidades} aoMudar={(v) => mudar(['filtros', 'cidades'], v)} placeholder="Todas" /></Campo>
              <Campo rotulo="Curva ABC do cliente" dica="Classificação pelo faturamento dos últimos 90 dias: A são os clientes que mais compram, C os que menos compram. Vazio = todos.">
                <div className="cons-atalhos">
                  {['A', 'B', 'C'].map((c) => {
                    const on = f.curvas.includes(c);
                    return <Chip key={c} ativo={on} aoClicar={() => mudar(['filtros', 'curvas'], on ? f.curvas.filter((x) => x !== c) : [...f.curvas, c].sort())}>Curva {c}</Chip>;
                  })}
                </div>
              </Campo>
            </div>
            <Campo rotulo="Clientes específicos" ajuda="Para campanhas de key accounts ou redes." dica="Só as vendas para estes clientes contam. Vazio = todos os clientes.">
              <MultiSelecao opcoes={opClientes} valores={f.clientes} aoMudar={(v) => mudar(['filtros', 'clientes'], v)} placeholder="Todos os clientes" />
            </Campo>
            <div className="cons-linha">
              <Campo rotulo="Somente CFOP" dica="CFOP é o código fiscal da operação na nota. Escolha aqui só se a campanha vale para um tipo de operação. Vazio = todos.">
                <MultiSelecao opcoes={opCfops} valores={f.cfops} aoMudar={(v) => mudar(['filtros', 'cfops'], v)} placeholder="Todos" />
              </Campo>
              <Campo rotulo="Desconsiderar CFOP" dica="Operações que não contam como venda (ex.: 5.910 e 6.910 são bonificação).">
                <MultiSelecao opcoes={opCfops} valores={f.cfops_excluir} aoMudar={(v) => mudar(['filtros', 'cfops_excluir'], v)} placeholder="Nenhum" />
              </Campo>
            </div>
            <Alternador ligado={semBonificacao} rotulo="Desconsiderar bonificações (CFOP 5.910 / 6.910)"
              descricao="Brindes e bonificações não contam como venda na apuração."
              aoMudar={(on) => mudar(['filtros', 'cfops_excluir'], on ? [...new Set([...f.cfops_excluir, ...BONIFICACAO])] : f.cfops_excluir.filter((c) => !BONIFICACAO.includes(c)))} />
          </Secao>

          {/* 4. Critérios e metas */}
          <Secao id="criterios" numero={4} titulo={SECOES[3].titulo} desc={SECOES[3].desc} info={SECOES[3].info}
            acoes={<span className="selo">{def.criterios.length} critério{def.criterios.length > 1 ? 's' : ''}</span>}>
            <div className="coluna" style={{ gap: 14 }}>
              <AnimatePresence initial={false}>
                {def.criterios.map((cr, i) => (
                  <motion.div key={cr.id} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
                    <EditorCriterio crit={cr} indice={i} total={def.criterios.length} catalogo={catalogo} nivel={def.participantes.nivel} previa={previa.dados}
                      premiacao={def.premiacao} fabricante={def.fabricante} grupos={dim?.grupos} foraDoFornecedor={foraDoFornecedor.includes(i)} aoUsarFornecedor={() => aplicarFornecedor([i])}
                      aoMudar={(novo) => mudarCriterio(i, novo)} aoRemover={() => removerCriterio(i)} aoDuplicar={() => duplicarCriterio(i)} aoMover={(d) => moverCriterio(i, d)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <div className="linha quebra" style={{ gap: 8 }}>
              <Botao icone={Plus} onClick={() => adicionarCriterio()}>Critério</Botao>
              <Botao icone={ShoppingBasket} onClick={() => setCesta(true)}>Cesta rápida</Botao>
              <Botao variante="fantasma" icone={CopyPlus} onClick={() => duplicarCriterio(def.criterios.length - 1)}>Duplicar último</Botao>
              <Explica titulo="Critério, cesta ou duplicar?" texto="Três jeitos de acrescentar regras à campanha."
                como={['Critério: uma regra nova em branco (já com os produtos do fornecedor).', 'Cesta rápida: escolha vários produtos e cada um vira um critério com a própria meta.', 'Duplicar último: copia o último critério para você mudar só o que precisa.']}
                exemplo="Cesta Kenvue: Tylenol 50 un + Listerine 35 un + Band-Aid 35 un, em três critérios." />
            </div>
          </Secao>

          {/* 5. Apuração e prêmios */}
          <Secao id="premios" numero={5} titulo={SECOES[4].titulo} desc={SECOES[4].desc} info={SECOES[4].info}>
            {def.criterios.length > 1 ? (
              <Campo rotulo="Como combinar os critérios" info={{
                texto: 'Cada critério tem o seu atingimento (% da meta). Aqui você decide como juntar tudo numa pontuação só.',
                como: [
                  'Média ponderada: soma os atingimentos pelos pesos. Quem vai mal num critério pode compensar no outro.',
                  'Cumprir todos: só ganha quem atingir o mínimo (gatilho) em todos os critérios.',
                  'Melhor critério: vale o melhor atingimento entre eles.',
                ],
                exemplo: 'Critério A com 120% e B com 80%, pesos iguais: média ponderada = 100%. Em "cumprir todos" com gatilho de 100%, não ganha.',
              }}>
                <Segmentado valor={def.apuracao.regra} aoMudar={(v) => mudar(['apuracao', 'regra'], v)}
                  opcoes={[
                    { valor: 'ponderada', rotulo: 'Média ponderada', dica: 'Pontuação = média dos atingimentos pelos pesos.' },
                    { valor: 'todos', rotulo: 'Cumprir todos', dica: 'Só é elegível quem bater o gatilho de cada critério.' },
                    { valor: 'qualquer', rotulo: 'Melhor critério', dica: 'Vale o maior atingimento.' },
                  ]} />
                <span className="campo-ajuda">
                  {def.apuracao.regra === 'todos'
                    ? 'Defina o mínimo para pontuar (ex.: 100%) em "Ajustes avançados" de cada critério: abaixo dele o participante não é premiado.'
                    : def.apuracao.regra === 'qualquer'
                      ? 'A pontuação é o melhor atingimento entre os critérios.'
                      : 'Critério abaixo do mínimo conta zero. Use os pesos (em "Ajustes avançados") para dar mais importância a um critério.'}
                </span>
              </Campo>
            ) : (
              <div className="cons-ajuda">Com um critério só, a pontuação é o próprio atingimento da meta: quem vendeu 90% da meta tem 90 pontos.</div>
            )}
            <EditorPremiacao def={def} catalogo={catalogo} previa={previa.dados} idCampanha={id} aoMudar={(pr) => mudar(['premiacao'], pr)} />
          </Secao>

          {/* 6. Revisão */}
          <Secao id="revisao" numero={6} titulo={SECOES[5].titulo} desc={SECOES[5].desc} info={SECOES[5].info}>
            <Revisao def={def} catalogo={catalogo} dimensoes={dim} pend={pend} aoIrPara={irPara} />
            <div className="linha" style={{ justifyContent: 'flex-end', gap: 8 }}>
              {id && statusCampanha === 'ativa' ? (
                <Botao variante="primario" icone={Save} carregando={salvando} onClick={() => salvar(false)}>Salvar alterações</Botao>
              ) : (
                <>
                  <Botao icone={Save} carregando={salvando} onClick={() => salvar(false)}>Salvar rascunho</Botao>
                  <Botao variante="primario" tamanho="g" icone={Rocket} carregando={salvando} onClick={() => salvar(true)}>Salvar e ativar</Botao>
                </>
              )}
            </div>
          </Secao>
        </div>

        <PreviaAoVivo def={def} previa={previa} catalogo={catalogo} />
      </div>

      <CestaRapida aberto={cesta} aoFechar={() => setCesta(false)} aoCriar={criarCesta}
        defBase={{ inicio: def.inicio, fim: def.fim, data_base: def.data_base, status_venda: def.status_venda, calendario: def.calendario, participantes: def.participantes, filtros: def.filtros, fabricante: def.fabricante }} />
      <ModalExcecao bloqueio={bloqueioVerba} aoFechar={() => setBloqueioVerba(null)} aoConfirmar={(excecao) => salvar(bloqueioVerba.ativar, excecao)} />
    </div>
  );
}
