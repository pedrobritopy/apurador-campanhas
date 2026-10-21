import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Database, Layers, Loader2, Locate, Map as MapaIcone, Minus, Plus, Search, ZoomIn } from 'lucide-react';
import { del, get, post, qs, useApi } from '../lib/api.js';
import { navegar } from '../lib/rotas.js';
import { cor, useVersaoTema } from '../lib/tema.js';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc } from '../lib/formato.js';
import { Aviso, Botao, BotaoIcone, Explica, Numero, Segmentado, Seletor, useToast } from '../componentes/ui.jsx';
import { K_BAIRROS, K_LIMITES, K_MAXIMA, K_PONTOS, MotorMapa, lerPaleta } from './mapa/motorMapa.js';
import { PainelCidade, PainelPonto, Prioridade } from './mapa/Detalhes.jsx';
import {
  BarraFerramentas, InstrucaoFerramenta, PainelBairro, PainelListaTerritorios, PainelNovaArea, PainelTerritorio, corCss,
} from './mapa/Territorios.jsx';
import { ACOES, rotuloRede } from './mapa/util.js';
import './mapa/mapa.css';

// espaço ocupado pelos painéis flutuantes (a vista inicial enquadra o Brasil no espaço livre)
const margens = (w, detalhe = false) => ({ esquerda: w > 720 ? 376 : 16, direita: detalhe ? (w > 720 ? 436 : 16) : w > 1100 ? 368 : 16, topo: 64, base: 16 });

const contem = (a, b) => a && b && b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3];

/** Anéis codificados do servidor (inteiros 1e-5 grau em delta) -> [[lng, lat], ...]. */
const decodificar = (cods) => cods.map((cod) => {
  const anel = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < cod.length; i += 2) {
    x += cod[i];
    y += cod[i + 1];
    anel.push([x / 1e5, y / 1e5]);
  }
  return anel;
});

// explicações (o "i") dos números e camadas do cabeçalho
const INFO = {
  farmacias: { titulo: 'Farmácias', texto: 'Farmácias ativas na Receita Federal (drogarias, manipulação e homeopatia) na parte do mapa que está na tela.', como: 'Arraste ou dê zoom: o número acompanha a área visível.' },
  independentes: { titulo: 'Independentes', texto: 'Farmácias de loja única (sem rede) na área visível. São o público principal de um distribuidor.' },
  ativos: { titulo: 'Clientes ativos', texto: 'Nossos clientes na área visível que compraram nos últimos 90 dias.' },
  penetracao: { titulo: 'Penetração', texto: 'Clientes ativos divididos pelas farmácias da área visível. Mostra quanto do mercado já compra de nós.', exemplo: '2% = de cada 100 farmácias, 2 compram de nós.' },
  potencial: { titulo: 'Potencial em 90 dias', texto: 'Quanto as farmácias independentes que ainda não atendemos comprariam em 90 dias, se comprassem como um cliente típico da mesma UF.', exemplo: '100 independentes livres × R$ 5 mil = R$ 500 mil.' },
  semVenda: { titulo: 'Cidades sem venda', texto: 'Cidades da área visível que têm farmácias e nenhum cliente ativo nosso. São candidatas a expansão.' },
  novas: { titulo: 'Novas em 12 meses', texto: 'Farmácias abertas no último ano. Loja nova ainda está escolhendo fornecedor.' },
  positivados: { titulo: 'Positivados na campanha', texto: 'Clientes da área visível que compraram produtos da campanha escolhida no período dela.' },
};
const INFO_CAMADAS = {
  carteiras: 'Pinta cada cidade e bairro com a cor da carteira do vendedor dono da área. Bairros aparecem ao aproximar de uma cidade. Em Carteiras, use "Montar no mapa" para incluir ou tirar áreas com um clique.',
  estados: 'Pinta cada estado conforme a penetração: quanto mais escuro, mais farmácias do estado já compram de nós. Some aos poucos quando você aproxima.',
  cidades: 'Uma bolha por cidade. Tamanho = quantidade de farmácias; cor = prioridade de ataque (laranja forte = vale mais a pena). O miolo azul indica que já vendemos lá.',
  pontos: 'Ao aproximar bastante, cada farmácia vira um ponto: azul = cliente ativo, roxo = cliente parado, cinza = farmácia que ainda não é cliente.',
  limites: 'Linhas finas das divisas entre cidades (malha oficial do IBGE). Aparecem e ficam mais firmes conforme você aproxima.',
  bairros: 'Limites dos bairros, quando você chega perto de uma cidade. Fonte: IBGE (Censo 2022) e, onde o IBGE não publica, OpenStreetMap. Clique num bairro para ver os números dele.',
  territorios: 'Áreas desenhadas por vocês: territórios de vendedor (linha cheia) e anotações (linha tracejada).',
};

function Kpi({ rotulo, valor, formato = 'numero', compacto, info, icone: Icone }) {
  return (
    <div className="mapa-kpi">
      <span className="rot">{Icone && <Icone size={12} />}{rotulo}{info && <Explica {...info} tamanho={12} />}</span>
      <span className="val">{valor == null ? 'sem dado' : <Numero valor={valor} formato={formato} compacto={compacto} duracao={600} />}</span>
    </div>
  );
}

function ChipCamada({ ligada, aoMudar, rotulo, amostra, info, tracejado }) {
  return (
    <button type="button" className={`mapa-chip-camada${ligada ? ' ligada' : ''}`} onClick={() => aoMudar(!ligada)} aria-pressed={ligada}>
      <span className={`amostra${tracejado ? ' linha-amostra' : ''}`} style={{ background: tracejado ? undefined : amostra, borderColor: amostra, opacity: ligada ? 1 : 0.35 }} />
      {rotulo}
      {info && <Explica titulo={rotulo} texto={info} tamanho={12} />}
    </button>
  );
}

function LinhaCidade({ d, campanha }) {
  const a = ACOES[d.acao_tipo];
  if (d.farmacias == null) return <div className="linha-dado"><span>Sem farmácias nem clientes na base</span></div>;
  return (
    <>
      <div className="linha-dado"><span>Farmácias</span><b>{fmtNumero(d.farmacias)}</b></div>
      <div className="linha-dado"><span>Independentes</span><b>{fmtNumero(d.independentes)}</b></div>
      <div className="linha-dado"><span>Clientes ativos</span><b>{fmtNumero(d.clientes_ativos)}{d.clientes > d.clientes_ativos ? ` de ${fmtNumero(d.clientes)}` : ''}</b></div>
      <div className="linha-dado"><span>Penetração</span><b>{d.penetracao == null ? 'sem dado' : fmtPerc(d.penetracao, 1)}</b></div>
      <div className="linha-dado"><span>Potencial 90d</span><b>{fmtMoeda(d.potencial, { compacto: true })}</b></div>
      {campanha && d.campanha && <div className="linha-dado"><span>Positivados na campanha</span><b>{fmtNumero(d.campanha.positivados)}</b></div>}
      <div className="linha-dado" style={{ marginTop: 4 }}><span>{a ? `${a.rotulo} · prioridade` : 'Prioridade'}</span><b>{d.prioridade}</b></div>
    </>
  );
}

function ConteudoDica({ item, campanha }) {
  if (!item) return null;
  const d = item.dados;
  if (item.tipo === 'cidade' || item.tipo === 'municipio') {
    return (
      <>
        <div className="titulo">{d.nome} · {d.uf}</div>
        <LinhaCidade d={d} campanha={campanha} />
        <div className="mudo mini" style={{ marginTop: 4 }}>Clique para ver a cidade</div>
      </>
    );
  }
  if (item.tipo === 'bairro') {
    return (
      <>
        <div className="titulo">{d.nome}<span className="mudo" style={{ fontWeight: 500 }}> · {d.cidade}</span></div>
        <div className="linha-dado"><span>Farmácias</span><b>{fmtNumero(d.farmacias)}</b></div>
        <div className="linha-dado"><span>Ainda não clientes</span><b>{fmtNumero(d.nao_clientes)}</b></div>
        <div className="linha-dado"><span>Clientes ativos</span><b>{fmtNumero(d.clientes_ativos)}{d.clientes > d.clientes_ativos ? ` de ${fmtNumero(d.clientes)}` : ''}</b></div>
        {d.valor_90d > 0 && <div className="linha-dado"><span>Venda 90d</span><b>{fmtMoeda(d.valor_90d, { compacto: true })}</b></div>}
        <div className="mudo mini" style={{ marginTop: 4 }}>Clique para ver o bairro</div>
      </>
    );
  }
  if (item.tipo === 'territorio') {
    const n = d.numeros;
    return (
      <>
        <div className="titulo linha g4"><span className="mapa-cor-ponto" style={{ background: corCss(d.cor) }} />{d.nome}</div>
        <div className="linha-dado"><span>{d.tipo === 'anotacao' ? 'Anotação' : 'Território de'}</span><b>{d.tipo === 'anotacao' ? '' : d.vendedor?.nome}</b></div>
        {n && (
          <>
            <div className="linha-dado"><span>Farmácias</span><b>{fmtNumero(n.farmacias)}</b></div>
            <div className="linha-dado"><span>Clientes ativos</span><b>{fmtNumero(n.clientes_ativos)} de {fmtNumero(n.clientes)}</b></div>
            <div className="linha-dado"><span>Venda 90d</span><b>{fmtMoeda(n.valor_90d, { compacto: true })}</b></div>
            {n.conflitos > 0 && <div className="linha-dado"><span>Com outro vendedor</span><b>{fmtNumero(n.conflitos)}</b></div>}
          </>
        )}
        <div className="mudo mini" style={{ marginTop: 4 }}>Clique para realçar e ver tudo</div>
      </>
    );
  }
  if (item.tipo === 'ponto') {
    const cliente = d.tipo !== 'prospect';
    return (
      <>
        <div className="titulo">{d.nome || 'Farmácia'}</div>
        {cliente ? (
          <div className="linha-dado"><span>{d.tipo === 'cliente_ativo' ? 'Cliente ativo' : 'Cliente sem compra há 90 dias'}</span></div>
        ) : (
          <>
            <div className="linha-dado"><span>{rotuloRede(d.rede)}</span></div>
            <div className="linha-dado"><span>Score de prospecção</span><b>{d.score}/100</b></div>
          </>
        )}
        <div className="mudo mini" style={{ marginTop: 4 }}>Clique para ver detalhes</div>
      </>
    );
  }
  return (
    <>
      <div className="titulo">{d.nome || d.uf}</div>
      {d.farmacias != null ? (
        <>
          <div className="linha-dado"><span>Farmácias</span><b>{fmtNumero(d.farmacias)}</b></div>
          <div className="linha-dado"><span>Clientes ativos</span><b>{fmtNumero(d.clientes_ativos)}</b></div>
          <div className="linha-dado"><span>Penetração</span><b>{d.penetracao == null ? 'sem dado' : fmtPerc(d.penetracao, 2)}</b></div>
          <div className="linha-dado"><span>Cidades com venda</span><b>{fmtNumero(d.cidades_com_venda)} de {fmtNumero(d.cidades)}</b></div>
        </>
      ) : (
        <div className="linha-dado"><span>Sem dados</span></div>
      )}
      <div className="mudo mini" style={{ marginTop: 4 }}>Clique para focar o estado</div>
    </>
  );
}

export default function Mapa({ query, status }) {
  const toast = useToast();
  const caixa = useRef(null);
  const canvas = useRef(null);
  const motor = useRef(null);
  const dica = useRef(null);
  const posDica = useRef({ x: 0, y: 0 });
  const carregado = useRef(null);
  const primeiraCarga = useRef(true);
  const pedidos = useRef(new Set()); // malhas e bairros já pedidos
  const versaoTema = useVersaoTema();

  const [filtros, setFiltros] = useState(() => ({
    uf: query.get('uf') || '',
    independentes: query.get('independentes') === '1',
    novas: false,
    campanha: query.get('campanha') || '',
  }));
  const montando = Number(query.get('carteira')) || null;
  const [camadas, setCamadas] = useState({ estados: true, cidades: true, pontos: true, limites: true, bairros: true, territorios: true, carteiras: Boolean(montando) || (query.get('camadas') || '').includes('carteiras') });
  const [camadaCart, setCamadaCart] = useState(null);
  const recarregarCarteiras = useCallback(() => get('/carteiras/mapa').then(setCamadaCart).catch(() => {}), []);
  useEffect(() => {
    if (camadas.carteiras || montando) recarregarCarteiras();
  }, [camadas.carteiras, montando, recarregarCarteiras]);
  useEffect(() => {
    motor.current?.definirCarteiras(camadas.carteiras ? camadaCart : null);
  }, [camadaCart, camadas.carteiras]);
  const cartMontando = montando ? camadaCart?.carteiras?.find((c) => c.id === montando) : null;
  // "Montar carteira": clicar numa cidade ou bairro inclui a área na carteira; clicar de novo tira
  const alternarArea = async (item) => {
    const bairro = item.tipo === 'bairro';
    const unidade = bairro ? { nivel: 'bairro', ibge: item.dados.ibge, bairro_id: item.dados.id, nome: item.dados.nome } : { nivel: 'cidade', ibge: item.dados.ibge, nome: item.dados.nome };
    try {
      const dono = await get(`/carteiras/unidade${qs(unidade)}`);
      if (dono?.id_carteira === montando) {
        await del(`/carteiras/regras/${dono.id_regra}`);
        toast.ok(`${unidade.nome} saiu da carteira.`);
      } else {
        if (dono && !window.confirm(`${unidade.nome} é da carteira de ${dono.vendedor || dono.carteira}. Passar para ${cartMontando?.vendedor || 'esta carteira'}?`)) return;
        await post(`/carteiras/${montando}/regras`, { ...unidade, mover: true });
        toast.ok(`${unidade.nome} entrou na carteira${dono ? ` (saiu de ${dono.vendedor})` : ''}.`);
      }
      recarregarCarteiras();
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const [hover, setHover] = useState(null);
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState(null);
  const [pontos, setPontos] = useState({ carregando: false, ativo: false, total: 0, n: 0, truncado: false });
  const [aba, setAba] = useState('prioridade');
  const [rf, setRf] = useState(null);
  const [ferramenta, setFerramenta] = useState(null);
  const [pendente, setPendente] = useState(null); // { geometria, forma, nome?, origem? }
  const [edicao, setEdicao] = useState(null); // { id, geometria }
  const [lista, setLista] = useState(false);
  const [filtroVend, setFiltroVend] = useState('');
  const [estadoBairros, setEstadoBairros] = useState({}); // ibge -> { nome, carregando, fonte, total, erro }

  const { dados: base, erro: erroBase } = useApi('/mapa/base');
  const { dados: resumo, erro: erroResumo, recarregar: recarregarResumo } = useApi(`/mapa/resumo${qs({ campanha: filtros.campanha })}`);
  const { dados: campanhas } = useApi('/campanhas');
  const { dados: ter, recarregar: recarregarTer } = useApi('/territorios');
  const territorios = ter?.territorios || [];
  const vendedores = ter?.vendedores || [];

  // ------------------------------------------------------------------ tooltip (posição sem re-render)
  const posicionarDica = useCallback((x, y) => {
    posDica.current = { x, y };
    const el = dica.current;
    const cx = caixa.current;
    if (!el || !cx) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let l = x + 16;
    let t = y + 16;
    if (l + w > cx.clientWidth - 8) l = x - w - 16;
    if (t + h > cx.clientHeight - 8) t = y - h - 16;
    el.style.transform = `translate(${Math.max(8, l)}px, ${Math.max(8, t)}px)`;
  }, []);
  useLayoutEffect(() => {
    if (hover) posicionarDica(posDica.current.x, posDica.current.y);
  }, [hover, posicionarDica]);

  // ------------------------------------------------------------------ ações (ref para o motor sempre ver a versão atual)
  const acoes = useRef({});
  const limparSelecao = useCallback(() => {
    setSel(null);
    motor.current?.definirDestaque(null);
    motor.current?.selecionarTerritorio(null);
  }, []);
  const abrirPonto = useCallback((id, info) => {
    setSel({ tipo: 'ponto', id });
    motor.current?.selecionarTerritorio(null);
    if (caixa.current) motor.current?.definirMargens(margens(caixa.current.clientWidth, true));
    if (info?.lat != null) {
      motor.current?.definirDestaque({ tipo: 'ponto', dados: { id, lat: info.lat, lng: info.lng, tipo: info.tipo || 'prospect' } });
      if (info.voar !== false) motor.current?.voarPara(info.lng, info.lat, Math.max(motor.current.vista.k, 160));
    }
  }, []);
  const abrirCidade = useCallback((ibge, { voar = true } = {}) => {
    const c = resumo?.cidades.find((x) => x.ibge === String(ibge));
    if (!c) {
      toast.info('Esta cidade não tem farmácias ativas na Receita nem clientes nossos.');
      return;
    }
    setSel({ tipo: 'cidade', ibge: String(ibge) });
    motor.current?.selecionarTerritorio(null);
    if (caixa.current) motor.current?.definirMargens(margens(caixa.current.clientWidth, true));
    motor.current?.definirDestaque({ tipo: 'cidade', dados: c });
    if (voar) motor.current?.voarPara(c.lng, c.lat, Math.max(Math.min(motor.current.vista.k, 60), 14));
  }, [resumo, toast]);
  const abrirTerritorio = useCallback((id, { enquadrar = false } = {}) => {
    const t = territorios.find((x) => x.id === id);
    setSel({ tipo: 'territorio', id });
    motor.current?.definirDestaque(null);
    motor.current?.selecionarTerritorio(id);
    if (caixa.current) motor.current?.definirMargens(margens(caixa.current.clientWidth, true));
    if (enquadrar && t) motor.current?.enquadrarGeometria(t.geometria);
  }, [territorios]);

  acoes.current.clicar = (item) => {
    if (edicao) return;
    if (montando && item && (item.tipo === 'municipio' || item.tipo === 'cidade' || item.tipo === 'bairro')) {
      alternarArea(item);
      return;
    }
    if (!item) {
      limparSelecao();
      return;
    }
    if (item.tipo === 'cidade' || item.tipo === 'municipio') abrirCidade(item.dados.ibge, { voar: motor.current.vista.k < 6 });
    else if (item.tipo === 'ponto') {
      setSel({ tipo: 'ponto', id: item.dados.id });
      motor.current?.selecionarTerritorio(null);
      motor.current?.definirDestaque(item);
    } else if (item.tipo === 'territorio') abrirTerritorio(item.dados.id);
    else if (item.tipo === 'bairro') {
      setSel({ tipo: 'bairro', bairro: item.dados });
      motor.current?.selecionarTerritorio(null);
      motor.current?.definirDestaque(item);
    } else if (item.tipo === 'uf') {
      setFiltros((f) => ({ ...f, uf: item.dados.uf }));
      motor.current?.enquadrarUf(item.dados.uf);
    }
  };
  acoes.current.desenho = ({ forma, geometria }) => {
    setFerramenta(null);
    setPendente({ forma, geometria });
    setSel(null);
    motor.current?.definirDestaque(null);
    motor.current?.selecionarTerritorio(null);
  };
  acoes.current.teclado = (e) => {
    const m = motor.current;
    if (!m) return;
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      if (m.cancelarRascunho()) return;
      if (ferramenta) return setFerramenta(null);
      if (edicao) return setEdicao(null);
      if (pendente) return setPendente(null);
      limparSelecao();
      return;
    }
    if (digitando) return;
    if (e.key === 'Backspace' && ferramenta === 'poligono' && m.desfazerPonto()) e.preventDefault();
    if (e.key === 'Enter' && ferramenta) m.concluirRascunho();
  };

  // ------------------------------------------------------------------ motor
  useEffect(() => {
    const m = new MotorMapa(canvas.current, {
      aoHover: (item) => setHover(item),
      aoMover: (x, y) => posicionarDica(x, y),
      aoClique: (item) => acoes.current.clicar?.(item),
      aoVistaParada: (v) => setVista(v),
      aoDesenho: (d) => acoes.current.desenho?.(d),
      aoEdicao: (g) => setEdicao((e) => (e ? { ...e, geometria: g } : e)),
    });
    motor.current = m;
    const r = caixa.current.getBoundingClientRect();
    m.definirMargens(margens(r.width));
    m.redimensionar(r.width, r.height);
    const ro = new ResizeObserver(([e]) => {
      m.definirMargens(margens(e.contentRect.width));
      m.redimensionar(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(caixa.current);
    const tecla = (e) => acoes.current.teclado?.(e);
    window.addEventListener('keydown', tecla);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', tecla);
      m.destruir();
    };
  }, [posicionarDica]);

  useEffect(() => {
    motor.current?.definirPaleta(lerPaleta(cor));
  }, [versaoTema]);
  const painelDireito = Boolean(sel || pendente || lista);
  useEffect(() => {
    if (caixa.current) motor.current?.definirMargens(margens(caixa.current.clientWidth, painelDireito));
  }, [painelDireito]);
  useEffect(() => {
    if (base) motor.current?.definirBase(base.ufs);
  }, [base]);
  useEffect(() => {
    if (!resumo || !base) return;
    motor.current?.definirCidades(resumo.cidades, resumo.ufs, primeiraCarga.current);
    if (primeiraCarga.current && filtros.uf) motor.current?.enquadrarUf(filtros.uf);
    primeiraCarga.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumo, base]);
  useEffect(() => {
    motor.current?.definirCamadas(camadas);
  }, [camadas]);
  // link com ?uf= também reenquadra com o mapa já aberto
  const ufQuery = query.get('uf') || '';
  const ufAplicada = useRef(ufQuery);
  useEffect(() => {
    if (!base || ufQuery === ufAplicada.current) return;
    ufAplicada.current = ufQuery;
    setFiltros((f) => ({ ...f, uf: ufQuery }));
    if (ufQuery) motor.current?.enquadrarUf(ufQuery);
    else motor.current?.reiniciar();
  }, [ufQuery, base]);
  useEffect(() => {
    motor.current?.definirOpcoes({ metricaTamanho: filtros.independentes ? 'independentes' : 'farmacias', ufSelecionada: filtros.uf || null });
  }, [filtros.independentes, filtros.uf]);
  useEffect(() => {
    if (!base) return;
    motor.current?.definirTerritorios(territorios.filter((t) => !filtroVend || t.id_vendedor === filtroVend || t.tipo === 'anotacao'));
  }, [ter, filtroVend, base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    motor.current?.definirFerramenta(ferramenta);
  }, [ferramenta]);
  useEffect(() => {
    motor.current?.definirPendente(pendente?.geometria || null, pendente?.cor || null);
  }, [pendente]);
  useEffect(() => {
    if (!edicao) motor.current?.editar(null);
  }, [edicao]);

  // links profundos: ?cnpj= (farmácia ou cli-123), ?cidade= (código IBGE) e ?territorio= (id)
  const alvoQuery = `${query.get('cnpj') || ''}|${query.get('cidade') || ''}|${query.get('territorio') || ''}`;
  const linkAplicado = useRef('');
  useEffect(() => {
    if (!base || linkAplicado.current === alvoQuery) return;
    const cnpj = query.get('cnpj');
    const cidade = query.get('cidade');
    const idTer = Number(query.get('territorio'));
    if ((cidade && !resumo) || (idTer && !territorios.length)) return;
    linkAplicado.current = alvoQuery;
    if (cnpj) {
      get(`/mapa/farmacia/${encodeURIComponent(cnpj)}`)
        .then((d) => abrirPonto(cnpj, { lat: d.lat, lng: d.lng, tipo: d.tipo === 'cliente' ? 'cliente_ativo' : 'prospect' }))
        .catch(() => toast.erro('Farmácia não encontrada na base da Receita.'));
    } else if (cidade) abrirCidade(cidade);
    else if (idTer) abrirTerritorio(idTer, { enquadrar: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvoQuery, base, Boolean(resumo), territorios.length > 0]);

  // ------------------------------------------------------------------ pontos sob demanda
  useEffect(() => {
    if (!vista || !camadas.pontos) return undefined;
    if (vista.k < K_PONTOS) {
      setPontos((p) => (p.ativo ? { ...p, ativo: false } : p));
      return undefined;
    }
    const chave = `${filtros.independentes}|${filtros.novas}|${resumo?.referencia || ''}`;
    if (carregado.current && carregado.current.chave === chave && contem(carregado.current.bbox, vista.bbox)) {
      setPontos((p) => (p.ativo ? p : { ...p, ativo: true }));
      return undefined;
    }
    const [o, s, l, n] = vista.bbox;
    const mx = (l - o) * 0.25;
    const my = (n - s) * 0.25;
    const bb = [o - mx, s - my, l + mx, n + my];
    const ctrl = new AbortController();
    setPontos((p) => ({ ...p, carregando: true, ativo: true }));
    get(`/mapa/pontos${qs({ bbox: bb.map((x) => x.toFixed(4)).join(','), limite: 20000, independentes: filtros.independentes ? 1 : '', abertas_meses: filtros.novas ? 12 : '' })}`, { signal: ctrl.signal })
      .then((r) => {
        const lista2 = r.linhas.map((x) => ({ id: x[0], lat: x[1], lng: x[2], tipo: x[3], rede: x[4], score: x[5], nome: x[6] }));
        motor.current?.definirPontos(lista2);
        carregado.current = { bbox: r.truncado ? vista.bbox : bb, chave };
        setPontos({ carregando: false, ativo: true, total: r.total_farmacias, n: lista2.filter((p) => p.tipo === 'prospect').length, truncado: r.truncado });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setPontos((p) => ({ ...p, carregando: false }));
      });
    return () => ctrl.abort();
  }, [vista, camadas.pontos, filtros.independentes, filtros.novas, resumo?.referencia]);

  // ------------------------------------------------------------------ malhas sob demanda (detalhe progressivo)
  useEffect(() => {
    const m = motor.current;
    if (!vista || !m || !base) return;
    const pedir = (chave, url, aplicar, aoErro) => {
      if (pedidos.current.has(chave)) return;
      pedidos.current.add(chave);
      get(url).then(aplicar).catch((e) => {
        pedidos.current.delete(chave);
        aoErro?.(e);
      });
    };
    const k = vista.k;
    if (k >= K_LIMITES * 0.75) {
      pedir('uf:maxima', '/mapa/contorno-ufs?qualidade=maxima', (d) => m.definirContornoUfs('maxima', d));
      for (const uf of m.ufsNaVista()) pedir(`mun:${uf}:intermediaria`, `/mapa/municipios/${uf}`, (d) => m.definirMunicipios(uf, 'intermediaria', d));
    }
    if (k >= K_MAXIMA * 0.85) {
      for (const uf of m.ufsNaVista()) pedir(`mun:${uf}:maxima`, `/mapa/municipios/${uf}?qualidade=maxima`, (d) => m.definirMunicipios(uf, 'maxima', d));
    }
    if (k >= K_BAIRROS * 0.8 && camadas.bairros) {
      for (const c of m.municipiosNaVista(4)) {
        const chave = `bairros:${c.ibge}`;
        if (pedidos.current.has(chave)) continue;
        setEstadoBairros((s) => ({ ...s, [c.ibge]: { nome: c.nome, carregando: true } }));
        pedir(chave, `/mapa/bairros/${c.ibge}`, (d) => {
          m.definirBairros(c.ibge, d);
          setEstadoBairros((s) => ({ ...s, [c.ibge]: { nome: d.nome, fonte: d.fonte, total: d.bairros.length, erro: d.aviso || null } }));
          if (d.aviso) setTimeout(() => pedidos.current.delete(chave), 60000);
          // clientes podem ter sido reposicionados pelo bairro: recarrega os pontos na próxima parada
          carregado.current = null;
        }, (e) => setEstadoBairros((s) => ({ ...s, [c.ibge]: { nome: c.nome, erro: e.message } })));
      }
    }
  }, [vista, base, camadas.bairros]);

  const bairrosNaTela = useMemo(() => {
    if (!vista || vista.k < K_BAIRROS || !camadas.bairros || !motor.current) return [];
    return motor.current.municipiosNaVista(3).map((c) => ({ ibge: c.ibge, ...(estadoBairros[c.ibge] || { nome: c.nome, carregando: true }) }));
  }, [vista, estadoBairros, camadas.bairros]);

  // ------------------------------------------------------------------ números da área visível
  const kpis = useMemo(() => {
    if (!resumo) return null;
    const bb = vista?.bbox;
    const dentro = (c) => !bb || (c.lng >= bb[0] && c.lng <= bb[2] && c.lat >= bb[1] && c.lat <= bb[3]);
    let lista2 = resumo.cidades.filter((c) => dentro(c) && (!filtros.uf || c.uf === filtros.uf));
    let foco = null;
    // zoom de bairro: o centro da cidade pode estar fora da tela; os números passam a ser da cidade em foco
    if (!lista2.length && vista && motor.current) {
      const m = motor.current.municipiosNaVista(1)[0];
      const c = m && resumo.cidades.find((x) => x.ibge === m.ibge);
      if (c) {
        lista2 = [c];
        foco = c;
      }
    }
    const s = { farmacias: 0, independentes: 0, novas: 0, ativos: 0, potencial: 0, semVenda: 0, positivados: 0, valor: 0, foco };
    for (const c of lista2) {
      s.farmacias += c.farmacias;
      s.independentes += c.independentes;
      s.novas += c.abertas_12m;
      s.ativos += c.clientes_ativos;
      s.potencial += c.potencial;
      s.valor += c.valor_90d;
      if (c.farmacias > 0 && !c.clientes_ativos) s.semVenda++;
      s.positivados += c.campanha?.positivados || 0;
    }
    s.penetracao = s.farmacias ? (s.ativos / s.farmacias) * 100 : null;
    s.cidades = lista2.length;
    return s;
  }, [resumo, vista, filtros.uf]);

  const [ranking, rankingTotal] = useMemo(() => {
    if (!resumo) return [[], 0];
    let l = resumo.cidades.filter((c) => !filtros.uf || c.uf === filtros.uf);
    if (aba === 'campanha') l = l.filter((c) => c.clientes > 0).sort((a, b) => (a.campanha?.positivacao ?? 0) - (b.campanha?.positivacao ?? 0) || b.clientes - a.clientes);
    else if (aba !== 'prioridade') l = l.filter((c) => c.acao_tipo === aba);
    return [l.slice(0, 40), l.length];
  }, [resumo, filtros.uf, aba]);

  // ------------------------------------------------------------------ territórios: criar a partir de bairro/cidade, editar
  const criarDeForma = async (url, forma, nome, origem) => {
    try {
      const d = await get(url);
      setSel(null);
      motor.current?.definirDestaque(null);
      setPendente({ forma, geometria: d.geometria, nome, origem });
      motor.current?.enquadrarGeometria(d.geometria);
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const aoSalvoArea = (t) => {
    setPendente(null);
    recarregarTer();
    setSel({ tipo: 'territorio', id: t.id });
    motor.current?.selecionarTerritorio(t.id);
  };
  const aoCorPendente = useCallback((c) => motor.current?.definirCorPendente(c), []);
  const iniciarEdicao = (t) => {
    setEdicao({ id: t.id, geometria: t.geometria });
    motor.current?.editar(t.geometria, t.cor);
  };

  // ------------------------------------------------------------------ importação da Receita
  const receita = rf || status?.receita;
  const semFarmacias = resumo && resumo.totais.farmacias === 0;
  const importar = async () => {
    try {
      const r = await post('/receita/importar?assincrono=1');
      setRf(r);
      const tick = async () => {
        const s = await get('/receita/status');
        setRf(s);
        if (s.importando) setTimeout(tick, 1200);
        else if (s.erro) toast.erro(s.erro);
        else {
          toast.ok(`${fmtNumero(s.farmacias)} farmácias ativas importadas da Receita Federal.`);
          carregado.current = null;
          recarregarResumo();
        }
      };
      setTimeout(tick, 800);
    } catch (e) {
      toast.erro(e.message);
    }
  };

  const ufs = resumo?.ufs || [];
  const campanhaSel = resumo?.campanha;
  const listaCampanhas = Array.isArray(campanhas) ? campanhas.filter((c) => c.status === 'ativa' || c.status === 'encerrada') : [];
  const zoomBaixo = vista && vista.k < K_PONTOS;
  const terVisiveis = territorios.filter((t) => !filtroVend || t.id_vendedor === filtroVend);

  return (
    <div className="mapa" ref={caixa}>
      <canvas ref={canvas} aria-label="Mapa comercial: farmácias, clientes, territórios e potencial por cidade" role="img" tabIndex={0} />
      {montando && (
        <div className="mapa-montando" role="status">
          <span className="cart-cor" style={{ background: `var(--${cartMontando?.cor || 's1'})` }} />
          <span>
            Montando a carteira de <b>{cartMontando?.vendedor || '...'}</b>: clique numa cidade ou, mais perto, num bairro para incluir. Clique de novo para tirar.
          </span>
          <Explica titulo="Montar carteira no mapa" texto="Cada clique grava na hora. Se a área for de outro vendedor, o sistema pergunta antes de passar. Os números da tela Carteiras se atualizam em segundos." tamanho={13} />
          <Botao tamanho="p" variante="primario" onClick={() => navegar('/carteiras')}>Concluir</Botao>
        </div>
      )}

      {/* ---------------------------------------------------- cabeçalho + KPIs + filtros */}
      <motion.section className="mapa-painel mapa-cabeca" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div>
          <div className="linha entre">
            <h1 className="linha g4" style={{ gap: 8 }}>
              <MapaIcone size={17} />Mapa comercial
              <Explica
                titulo="Mapa comercial"
                texto="Junta as farmácias ativas da Receita Federal com a nossa carteira para mostrar onde vendemos, onde há mercado sem atendimento e onde atacar primeiro."
                como={[
                  'Arraste para mover e use a rodinha para aproximar. Duplo clique aproxima rápido.',
                  'Ao aproximar, surgem as divisas das cidades, depois os bairros e cada farmácia.',
                  'Clique numa cidade, bairro, farmácia ou território para ver os números.',
                  'Use as ferramentas do topo para desenhar áreas e definir territórios de vendedores.',
                ]}
              />
            </h1>
            <BotaoIcone icone={Search} rotulo="Prospecção (lista)" tamanho="p" onClick={() => navegar(`/prospeccao${qs({ uf: filtros.uf })}`)} />
          </div>
          <div className="mapa-sub">
            {receita?.farmacias ? `Farmácias ativas da Receita${receita.competencia ? ` (${receita.competencia})` : ''} × nossa carteira` : 'Nossa carteira por cidade'}
            {resumo?.referencia ? ` · vendas até ${fmtData(resumo.referencia)}` : ''}
          </div>
        </div>
        {kpis?.foco && <div className="mapa-sub" style={{ marginTop: -6 }}>Números da cidade em foco: <b>{kpis.foco.nome}/{kpis.foco.uf}</b></div>}
        {kpis && (
          <div className="mapa-kpis">
            <Kpi rotulo={filtros.independentes ? 'Independentes' : 'Farmácias'} valor={filtros.independentes ? kpis.independentes : kpis.farmacias} info={filtros.independentes ? INFO.independentes : INFO.farmacias} />
            <Kpi rotulo="Clientes ativos" valor={kpis.ativos} info={INFO.ativos} />
            <Kpi rotulo="Penetração" valor={kpis.penetracao} formato="perc" info={INFO.penetracao} />
            <Kpi rotulo="Potencial 90d" valor={kpis.potencial} formato="moeda" compacto info={INFO.potencial} />
            <Kpi rotulo="Cidades sem venda" valor={kpis.semVenda} info={INFO.semVenda} />
            {campanhaSel ? <Kpi rotulo="Positivados na campanha" valor={kpis.positivados} info={INFO.positivados} /> : <Kpi rotulo="Novas em 12 meses" valor={kpis.novas} info={INFO.novas} />}
          </div>
        )}
        <div className="coluna" style={{ gap: 8 }}>
          <span className="mapa-secao-rotulo linha g4">Filtros<Explica titulo="Filtros" texto="Estado: foca o mapa e o ranking numa UF. Campanha: mostra quantos clientes compraram os produtos da campanha em cada cidade." tamanho={12} /></span>
          <div className="mapa-filtros">
            <Seletor tamanho="p" valor={filtros.uf} vazio="Brasil inteiro" style={{ width: 150 }}
              opcoes={ufs.map((u) => ({ valor: u.uf, rotulo: `${u.uf} · ${u.nome}` }))}
              aoMudar={(v) => {
                setFiltros((f) => ({ ...f, uf: v }));
                if (v) motor.current?.enquadrarUf(v);
                else motor.current?.reiniciar();
              }} />
            <Seletor tamanho="p" valor={filtros.campanha} vazio="Sem campanha" style={{ width: 160 }}
              opcoes={listaCampanhas.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              aoMudar={(v) => setFiltros((f) => ({ ...f, campanha: v }))} />
          </div>
          <div className="mapa-alternador-camadas">
            <ChipCamada ligada={filtros.independentes} aoMudar={(v) => setFiltros((f) => ({ ...f, independentes: v }))} rotulo="Só independentes" amostra="var(--acento)" info="Bolhas e pontos passam a contar só farmácias de loja única (sem rede)." />
            <ChipCamada ligada={filtros.novas} aoMudar={(v) => setFiltros((f) => ({ ...f, novas: v }))} rotulo="Abertas há até 12 meses" amostra="var(--acento)" info="Mostra só farmácias novas, um gatilho clássico de prospecção: a loja ainda está escolhendo fornecedor." />
          </div>
        </div>
        <div className="coluna" style={{ gap: 8 }}>
          <span className="mapa-secao-rotulo linha g4"><Layers size={11} />Camadas</span>
          <div className="mapa-alternador-camadas">
            <ChipCamada ligada={camadas.estados} aoMudar={(v) => setCamadas((c) => ({ ...c, estados: v }))} rotulo="Penetração por UF" amostra="var(--mapa-uf-4)" info={INFO_CAMADAS.estados} />
            <ChipCamada ligada={camadas.cidades} aoMudar={(v) => setCamadas((c) => ({ ...c, cidades: v }))} rotulo="Cidades" amostra="var(--mapa-p4)" info={INFO_CAMADAS.cidades} />
            <ChipCamada ligada={camadas.pontos} aoMudar={(v) => setCamadas((c) => ({ ...c, pontos: v }))} rotulo="Farmácias e clientes" amostra="var(--s1)" info={INFO_CAMADAS.pontos} />
            <ChipCamada ligada={camadas.limites} aoMudar={(v) => setCamadas((c) => ({ ...c, limites: v }))} rotulo="Divisas das cidades" amostra="var(--mapa-limite)" tracejado info={INFO_CAMADAS.limites} />
            <ChipCamada ligada={camadas.bairros} aoMudar={(v) => setCamadas((c) => ({ ...c, bairros: v }))} rotulo="Bairros" amostra="var(--mapa-limite)" tracejado info={INFO_CAMADAS.bairros} />
            <ChipCamada ligada={camadas.territorios} aoMudar={(v) => setCamadas((c) => ({ ...c, territorios: v }))} rotulo="Territórios e desenhos" amostra="var(--s3)" info={INFO_CAMADAS.territorios} />
            <ChipCamada ligada={camadas.carteiras} aoMudar={(v) => setCamadas((c) => ({ ...c, carteiras: v }))} rotulo="Carteiras" amostra="var(--s5)" info={INFO_CAMADAS.carteiras} />
          </div>
        </div>
      </motion.section>

      {/* ---------------------------------------------------- ferramentas de desenho */}
      <BarraFerramentas ferramenta={ferramenta} aoMudar={(f) => { setFerramenta(f); if (f) { setEdicao(null); } }} listaAberta={lista} total={terVisiveis.length}
        aoLista={() => { setLista((l) => !l); setSel(null); motor.current?.selecionarTerritorio(null); }} />
      <AnimatePresence>{ferramenta && <InstrucaoFerramenta ferramenta={ferramenta} />}</AnimatePresence>

      {/* ---------------------------------------------------- painel da direita */}
      <AnimatePresence mode="wait">
        {pendente && (
          <PainelNovaArea key={`nova-${pendente.geometria.length}-${pendente.geometria[0].length}`} pendente={pendente} vendedores={vendedores}
            aoCancelar={() => setPendente(null)} aoSalvo={aoSalvoArea}
            aoMudarCor={aoCorPendente} />
        )}
        {!pendente && sel?.tipo === 'territorio' && (
          <PainelTerritorio key={`t-${sel.id}`} id={sel.id} vendedores={vendedores} edicao={edicao?.id === sel.id ? edicao : null}
            aoFechar={() => { setEdicao(null); limparSelecao(); }}
            aoAtualizado={() => recarregarTer()}
            aoExcluido={() => { setEdicao(null); limparSelecao(); recarregarTer(); }}
            aoVoar={(g) => motor.current?.enquadrarGeometria(g)}
            aoAbrirPonto={(id, info) => abrirPonto(id, info)}
            aoAbrirTerritorio={(id) => abrirTerritorio(id, { enquadrar: true })}
            aoEditar={iniciarEdicao}
            aoSalvarForma={() => { setEdicao(null); recarregarTer(); }}
            aoCancelarForma={() => setEdicao(null)} />
        )}
        {!pendente && sel?.tipo === 'bairro' && (
          <PainelBairro key={`b-${sel.bairro.ibge}-${sel.bairro.id}`} bairro={sel.bairro} aoFechar={limparSelecao}
            aoVoar={() => motor.current?.enquadrarGeometria(decodificar(sel.bairro.a))}
            aoCriarTerritorio={() => criarDeForma(`/territorios/forma/bairro/${sel.bairro.ibge}/${encodeURIComponent(sel.bairro.id)}`, 'bairro', sel.bairro.nome, { tipo: 'bairro', ibge: sel.bairro.ibge, id: sel.bairro.id })} />
        )}
        {!pendente && sel?.tipo === 'cidade' && (
          <PainelCidade key={`c-${sel.ibge}`} ibge={sel.ibge} campanha={campanhaSel}
            aoFechar={limparSelecao}
            aoVoar={(lng, lat, k) => motor.current?.voarPara(lng, lat, k)}
            aoAbrirPonto={(id, info) => abrirPonto(id, info)}
            aoCriarTerritorio={(c) => criarDeForma(`/territorios/forma/cidade/${c.ibge}`, 'cidade', c.nome, { tipo: 'cidade', ibge: c.ibge })} />
        )}
        {!pendente && sel?.tipo === 'ponto' && (
          <PainelPonto key={`p-${sel.id}`} id={sel.id}
            aoFechar={limparSelecao}
            aoVoar={(lng, lat, k) => motor.current?.voarPara(lng, lat, k)}
            aoAbrirCidade={(ibge) => abrirCidade(ibge)} />
        )}
        {!pendente && !sel && lista && (
          <PainelListaTerritorios key="lista" territorios={territorios} vendedores={vendedores} filtro={filtroVend} aoFiltro={setFiltroVend}
            aoFechar={() => setLista(false)}
            aoAbrir={(t) => abrirTerritorio(t.id, { enquadrar: true })}
            aoHover={(t) => motor.current?.selecionarTerritorio(t ? t.id : null)} />
        )}
        {!pendente && !sel && !lista && resumo && !semFarmacias && (
          <motion.aside key="ranking" className="mapa-painel mapa-ranking" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25 }}>
            <div className="mapa-ranking-topo">
              <div className="linha entre">
                <h2 style={{ fontSize: 14 }} className="linha g4">Onde atacar{filtros.uf ? ` · ${filtros.uf}` : ''}
                  <Explica titulo="Onde atacar" texto="Cidades ordenadas pela prioridade de ataque (0 a 100), que soma potencial de venda, distância de onde já vendemos, farmácias novas e espaço para crescer."
                    como={['Prioridade: as melhores cidades no geral.', 'Expandir: cidades com farmácias e nenhum cliente nosso.', 'Aprofundar: já vendemos, mas com pouca penetração.', 'Reativar: muitos clientes parados há 90 dias.']} />
                </h2>
                <span className="mudo mini">{fmtNumero(rankingTotal)} cidades</span>
              </div>
              <div className="mapa-abas-rolagem">
                <Segmentado tamanho="p" valor={aba} aoMudar={setAba}
                  opcoes={[
                    { valor: 'prioridade', rotulo: 'Prioridade' },
                    { valor: 'expandir', rotulo: 'Expandir' },
                    { valor: 'aprofundar', rotulo: 'Aprofundar' },
                    { valor: 'reativar', rotulo: 'Reativar' },
                    ...(campanhaSel ? [{ valor: 'campanha', rotulo: 'Campanha' }] : []),
                  ]} />
              </div>
            </div>
            <div className="mapa-ranking-lista">
              {!ranking.length && <div className="vazio pequeno">Nenhuma cidade nesta visão.</div>}
              {ranking.map((c) => (
                <button key={c.ibge} type="button" className="mapa-cidade-item" onClick={() => abrirCidade(c.ibge)}
                  onMouseEnter={() => motor.current?.definirDestaque({ tipo: 'cidade', dados: c })} onMouseLeave={() => motor.current?.definirDestaque(null)}>
                  <Prioridade valor={c.prioridade} />
                  <div style={{ minWidth: 0 }}>
                    <div className="linha entre">
                      <span className="forte truncar">{c.nome}<span className="mudo" style={{ fontWeight: 500 }}> · {c.uf}</span></span>
                      <span className="num mini mudo">{fmtMoeda(c.potencial, { compacto: true })}</span>
                    </div>
                    <div className="mapa-acao-texto">
                      {aba === 'campanha' && c.campanha
                        ? `${fmtNumero(c.campanha.positivados)} de ${fmtNumero(c.clientes)} clientes positivados (${fmtPerc(c.campanha.positivacao ?? 0, 0)})`
                        : c.acao}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- legenda */}
      <div className="mapa-painel mapa-legenda">
        {camadas.cidades && (
          <div className="mapa-legenda-linha">
            <span className="mapa-bolha" style={{ width: 7, height: 7 }} />
            <span className="mapa-bolha" style={{ width: 12, height: 12 }} />
            <span>Cidade: tamanho = {filtros.independentes ? 'independentes' : 'farmácias'}; cor = prioridade</span>
            <span className="mapa-rampa" title="Prioridade baixa → alta">
              {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ background: `var(--mapa-p${i})` }} />)}
            </span>
          </div>
        )}
        {camadas.cidades && (
          <div className="mapa-legenda-linha">
            <span className="mapa-ponto" style={{ background: 'var(--s1)' }} />
            <span>Miolo azul = onde já vendemos (clientes ativos)</span>
          </div>
        )}
        {camadas.estados && (
          <div className="mapa-legenda-linha">
            <span className="mapa-rampa">
              <span style={{ background: 'var(--mapa-uf)' }} />
              {[1, 2, 3, 4].map((i) => <span key={i} style={{ background: `var(--mapa-uf-${i})` }} />)}
            </span>
            <span>Penetração por UF (sem cliente até a maior)</span>
          </div>
        )}
        {pontos.ativo && camadas.pontos && (
          <div className="mapa-legenda-linha">
            <span className="mapa-ponto" style={{ background: 'var(--s1)' }} /> Cliente ativo
            <span className="mapa-ponto" style={{ background: 'var(--s2)', marginLeft: 6 }} /> Cliente parado
            <span className="mapa-ponto" style={{ background: 'var(--mapa-prospect)', marginLeft: 6, boxShadow: 'none' }} /> Farmácia não cliente
          </div>
        )}
        {camadas.territorios && territorios.length > 0 && (
          <div className="mapa-legenda-linha">
            <span className="mapa-amostra-area" /> Território (cor do vendedor)
            <span className="mapa-amostra-area tracejada" style={{ marginLeft: 6 }} /> Anotação
          </div>
        )}
        <div className="mapa-fonte">Fontes: Receita Federal (CNPJ), IBGE (malhas e bairros), OpenStreetMap (bairros onde o IBGE não tem) · arraste, role para zoom, duplo clique aproxima</div>
      </div>

      {/* ---------------------------------------------------- controles */}
      <div className="mapa-painel mapa-controles">
        <BotaoIcone icone={Plus} rotulo="Aproximar" onClick={() => motor.current?.zoomEm(1.8)} />
        <BotaoIcone icone={Minus} rotulo="Afastar" onClick={() => motor.current?.zoomEm(1 / 1.8)} />
        <BotaoIcone icone={Locate} rotulo="Ver o Brasil inteiro" onClick={() => { setFiltros((f) => ({ ...f, uf: '' })); motor.current?.reiniciar(); }} />
      </div>

      {/* ---------------------------------------------------- estado dos pontos e bairros */}
      <AnimatePresence>
        {camadas.pontos && pontos.ativo && (pontos.carregando || pontos.truncado) && (
          <motion.div key="pontos" className="mapa-painel mapa-carregando-pontos embaixo" initial={{ opacity: 0, y: -6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }}>
            {pontos.carregando ? <><Loader2 size={14} className="girando" /> Carregando farmácias da área…</> : <><ZoomIn size={14} /> Mostrando as {fmtNumero(pontos.n)} melhores de {fmtNumero(pontos.total)} farmácias. Aproxime para ver todas.</>}
          </motion.div>
        )}
        {camadas.pontos && zoomBaixo && vista.k > 3.2 && !sel && !pendente && (
          <motion.div key="dica-zoom" className="mapa-painel mapa-carregando-pontos embaixo" initial={{ opacity: 0, y: -6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }}>
            <ZoomIn size={14} /> Aproxime mais para ver cada farmácia e cliente
          </motion.div>
        )}
        {bairrosNaTela.length > 0 && !(camadas.pontos && pontos.ativo && (pontos.carregando || pontos.truncado)) && (
          <motion.div key="bairros" className="mapa-painel mapa-carregando-pontos embaixo mapa-status-bairros" initial={{ opacity: 0, y: -6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }}>
            {['ibge-2022', 'osm'].map((fonte) => {
              const l = bairrosNaTela.filter((b) => b.total && b.fonte === fonte);
              return l.length ? (
                <span key={fonte}>
                  <span className="mudo">Bairros ({fonte === 'osm' ? 'OpenStreetMap' : 'IBGE 2022'}): </span>
                  {l.map((b, i) => <span key={b.ibge}>{i ? ', ' : ''}<b>{b.nome}</b> {fmtNumero(b.total)}</span>)}
                </span>
              ) : null;
            })}
            {bairrosNaTela.some((b) => b.carregando) && (
              <span className="linha g4">
                <Loader2 size={13} className="girando" />
                <span>Buscando bairros de <b>{bairrosNaTela.filter((b) => b.carregando).map((b) => b.nome).join(', ')}</b><span className="mudo">. Na primeira vez pode levar até 1 minuto.</span></span>
              </span>
            )}
            {bairrosNaTela.filter((b) => !b.carregando && !b.total).map((b) => (
              <span key={b.ibge}>
                <b>{b.nome}</b>
                <span className="mudo">{b.erro ? `: bairros indisponíveis agora (${b.erro})` : ': sem bairros publicados no IBGE nem no OpenStreetMap'}</span>
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- tooltip */}
      <div ref={dica} className="mapa-dica" style={{ opacity: hover && !ferramenta ? 1 : 0 }} aria-hidden>
        <ConteudoDica item={hover} campanha={campanhaSel} />
      </div>

      {/* ---------------------------------------------------- base da Receita ainda não importada */}
      {(semFarmacias || receita?.importando) && (
        <div className="mapa-painel mapa-carga">
          <div className="linha g12">
            <div className="vazio-icone" style={{ margin: 0 }}><Database size={20} /></div>
            <div>
              <h2>Farmácias da Receita Federal</h2>
              <div className="mudo pequeno">Para mostrar potencial e prospects, importe as farmácias ativas (CNAE 4771-7/01, 02, 03) do Postgres local.</div>
            </div>
          </div>
          {receita?.importando ? (
            <div className="coluna" style={{ gap: 6 }}>
              <div className="linha entre pequeno"><span>Importando {receita.progresso?.uf ? `(${receita.progresso.uf})` : ''}…</span><span className="num">{receita.progresso?.percentual ?? 0}%</span></div>
              <div className="progresso"><div className="progresso-barra" style={{ width: `${receita.progresso?.percentual ?? 0}%` }} /></div>
            </div>
          ) : receita?.configurada ? (
            <Botao variante="primario" icone={Database} onClick={importar}>Importar farmácias agora</Botao>
          ) : (
            <Aviso tipo="aviso">Configure POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER e POSTGRES_PASSWORD no arquivo .env.</Aviso>
          )}
        </div>
      )}
      {(erroBase || erroResumo) && (
        <div className="mapa-painel mapa-carga"><Aviso tipo="erro" titulo="Não foi possível carregar o mapa">{(erroBase || erroResumo).message}</Aviso></div>
      )}
    </div>
  );
}
