import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3, Bell, Briefcase, BookOpen, Brain, ChevronsLeft, ChevronsRight, Crosshair, Database, Landmark, LayoutDashboard, Map, Megaphone,
  MessagesSquare, Monitor, Moon, Plus, Search, Settings, Sparkles, Sun, Trophy,
} from 'lucide-react';
import { casar, navegar, useRota } from './lib/rotas.js';
import { useTema } from './lib/tema.js';
import { useAtalho } from './lib/anim.js';
import { useApi, get } from './lib/api.js';
import { fmtData, fmtUsd } from './lib/formato.js';
import { Carregando, ProvedorToast, cx } from './componentes/ui.jsx';
import IndicadorPipeline from './componentes/IndicadorPipeline.jsx';

const Painel = lazy(() => import('./paginas/Painel.jsx'));
const Campanhas = lazy(() => import('./paginas/Campanhas.jsx'));
const NovaCampanha = lazy(() => import('./paginas/NovaCampanha.jsx'));
const Campanha = lazy(() => import('./paginas/Campanha.jsx'));
const Construtor = lazy(() => import('./paginas/Construtor.jsx'));
const Boletim = lazy(() => import('./paginas/Boletim.jsx'));
const Acompanhamentos = lazy(() => import('./paginas/Acompanhamentos.jsx'));
const Insights = lazy(() => import('./paginas/Insights.jsx'));
const Planos = lazy(() => import('./paginas/Planos.jsx'));
const Mapa = lazy(() => import('./paginas/Mapa.jsx'));
const Prospeccao = lazy(() => import('./paginas/Prospeccao.jsx'));
const Catalogo = lazy(() => import('./paginas/Catalogo.jsx'));
const Dados = lazy(() => import('./paginas/Dados.jsx'));
const Configuracoes = lazy(() => import('./paginas/Configuracoes.jsx'));
const Atendimento = lazy(() => import('./paginas/Atendimento.jsx'));
const ContaCorrente = lazy(() => import('./paginas/ContaCorrente.jsx'));
const Carteiras = lazy(() => import('./paginas/Carteiras.jsx'));

// Ordem importa: rotas mais específicas primeiro.
const ROTAS = [
  { padrao: '/', comp: Painel, titulo: 'Painel' },
  { padrao: '/campanhas', comp: Campanhas, titulo: 'Campanhas' },
  { padrao: '/campanhas/nova', comp: NovaCampanha, titulo: 'Nova campanha' },
  { padrao: '/campanhas/nova/editor', comp: Construtor, titulo: 'Construtor de campanha' },
  { padrao: '/campanhas/:id/editar', comp: Construtor, titulo: 'Construtor de campanha' },
  { padrao: '/campanhas/:id', comp: Campanha, titulo: 'Apuração' },
  { padrao: '/boletim/:id/:chave', comp: Boletim, titulo: 'Boletim', cheio: true },
  { padrao: '/acompanhamentos', comp: Acompanhamentos, titulo: 'Acompanhamentos' },
  { padrao: '/conta-corrente', comp: ContaCorrente, titulo: 'Conta corrente' },
  { padrao: '/conta-corrente/:id', comp: ContaCorrente, titulo: 'Conta corrente' },
  { padrao: '/insights', comp: Insights, titulo: 'Central de insights' },
  { padrao: '/planos', comp: Planos, titulo: 'Planos de ataque' },
  { padrao: '/mapa', comp: Mapa, titulo: 'Mapa comercial', cheio: true },
  { padrao: '/prospeccao', comp: Prospeccao, titulo: 'Prospecção' },
  { padrao: '/carteiras', comp: Carteiras, titulo: 'Carteiras' },
  { padrao: '/catalogo', comp: Catalogo, titulo: 'Catálogo de métricas' },
  { padrao: '/dados', comp: Dados, titulo: 'Dados' },
  { padrao: '/config', comp: Configuracoes, titulo: 'Configurações' },
  { padrao: '/atendimento', comp: Atendimento, titulo: 'Atendimento', cheio: true },
];

const NAV = [
  { grupo: 'Visão geral', itens: [
    { para: '/', rotulo: 'Painel', icone: LayoutDashboard },
    { para: '/insights', rotulo: 'Central de insights', icone: Sparkles, contador: 'alertas' },
  ] },
  { grupo: 'Campanhas', itens: [
    { para: '/campanhas', rotulo: 'Campanhas', icone: Trophy },
    { para: '/campanhas/nova', rotulo: 'Nova campanha', icone: Plus },
    { para: '/acompanhamentos', rotulo: 'Acompanhamentos', icone: Megaphone },
    { para: '/conta-corrente', rotulo: 'Conta corrente', icone: Landmark },
  ] },
  { grupo: 'Relacionamento', itens: [
    { para: '/atendimento', rotulo: 'Atendimento', icone: MessagesSquare, contador: 'atendimento' },
  ] },
  { grupo: 'Inteligência comercial', itens: [
    { para: '/planos', rotulo: 'Planos de ataque', icone: Crosshair },
    { para: '/mapa', rotulo: 'Mapa comercial', icone: Map },
    { para: '/carteiras', rotulo: 'Carteiras', icone: Briefcase },
    { para: '/prospeccao', rotulo: 'Prospecção', icone: Search },
  ] },
  { grupo: 'Sistema', itens: [
    { para: '/catalogo', rotulo: 'Catálogo de métricas', icone: BookOpen },
    { para: '/dados', rotulo: 'Dados', icone: Database },
    { para: '/config', rotulo: 'Configurações', icone: Settings },
  ] },
];

function resolver(caminho) {
  for (const r of ROTAS) {
    const params = casar(r.padrao, caminho);
    if (params) return { ...r, params };
  }
  return { ...ROTAS[0], params: {} };
}

function ativoNav(para, caminho) {
  if (para === '/') return caminho === '/';
  if (para === '/campanhas') return caminho === '/campanhas' || (/^\/campanhas\/\d+/.test(caminho));
  return caminho === para || caminho.startsWith(`${para}/`);
}

// ------------------------------------------------------------------ paleta de comandos (Ctrl+K)
function PaletaComandos({ aberta, aoFechar, alternarTema }) {
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const [campanhas, setCampanhas] = useState([]);
  const entrada = useRef(null);
  useEffect(() => {
    if (!aberta) return;
    setBusca('');
    setAtivo(0);
    setTimeout(() => entrada.current?.focus(), 30);
    get('/campanhas').then(setCampanhas).catch(() => setCampanhas([]));
  }, [aberta]);

  const itens = useMemo(() => {
    const acoes = [
      { grupo: 'Ações', rotulo: 'Criar nova campanha', icone: Plus, ir: () => navegar('/campanhas/nova') },
      { grupo: 'Ações', rotulo: 'Disparar acompanhamentos', icone: Megaphone, ir: () => navegar('/acompanhamentos') },
      { grupo: 'Ações', rotulo: 'Pedir análise da IA', icone: Brain, ir: () => navegar('/insights?aba=ia') },
      { grupo: 'Ações', rotulo: 'Alternar tema claro/escuro', icone: Moon, ir: alternarTema },
    ];
    const paginas = NAV.flatMap((g) => g.itens.map((i) => ({ grupo: 'Ir para', rotulo: i.rotulo, icone: i.icone, ir: () => navegar(i.para) })));
    const camp = campanhas.map((c) => ({ grupo: 'Campanhas', rotulo: c.nome, detalhe: c.fornecedor, icone: BarChart3, ir: () => navegar(`/campanhas/${c.id}`) }));
    const todos = [...acoes, ...camp, ...paginas];
    const q = busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return q ? todos.filter((i) => `${i.rotulo} ${i.detalhe || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)) : todos;
  }, [busca, campanhas, alternarTema]);

  const executar = (i) => {
    aoFechar();
    i?.ir();
  };
  let grupo = null;
  return (
    <AnimatePresence>
      {aberta && (
        <>
          <motion.div className="veu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={aoFechar} />
          <motion.div className="paleta" role="dialog" aria-label="Paleta de comandos" initial={{ opacity: 0, y: -10, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -6, x: '-50%' }} transition={{ duration: 0.16 }}>
            <div className="paleta-busca">
              <Search size={17} className="mudo" />
              <input ref={entrada} value={busca} placeholder="Buscar campanhas, telas e ações…" onChange={(e) => { setBusca(e.target.value); setAtivo(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(itens.length - 1, a + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(0, a - 1)); }
                  if (e.key === 'Enter') executar(itens[ativo]);
                  if (e.key === 'Escape') aoFechar();
                }} />
              <span className="tecla">esc</span>
            </div>
            <div className="paleta-lista">
              {!itens.length && <div className="paleta-item mudo">Nada encontrado</div>}
              {itens.slice(0, 60).map((it, i) => {
                const cab = it.grupo !== grupo ? <div className="paleta-grupo">{it.grupo}</div> : null;
                grupo = it.grupo;
                return (
                  <div key={`${it.grupo}-${it.rotulo}-${i}`}>
                    {cab}
                    <div className={cx('paleta-item', i === ativo && 'ativo')} onMouseEnter={() => setAtivo(i)} onClick={() => executar(it)}>
                      <it.icone size={16} />
                      <span className="cresce truncar">{it.rotulo}</span>
                      {it.detalhe && <span className="mudo pequeno">{it.detalhe}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ app
export default function App() {
  const rota = useRota();
  const atual = resolver(rota.caminho);
  const [tema, setTema] = useTema();
  const [recolhida, setRecolhida] = useState(() => {
    try { return localStorage.getItem('menu-recolhido') === '1'; } catch { return false; }
  });
  const [paleta, setPaleta] = useState(false);
  const { dados: status } = useApi('/status', { intervalo: 60000, vivo: true });
  const { dados: insights } = useApi('/insights?severidade=critica,alta', { intervalo: 120000 });

  useEffect(() => {
    try { localStorage.setItem('menu-recolhido', recolhida ? '1' : '0'); } catch { /* sem armazenamento */ }
  }, [recolhida]);
  useEffect(() => {
    document.title = `${atual.titulo} · Apurador de Campanhas`;
  }, [atual.titulo]);

  const alternarTema = useCallback(() => setTema((t) => (t === 'escuro' ? 'claro' : t === 'claro' ? 'auto' : 'escuro')), [setTema]);
  useAtalho('mod+k', useCallback(() => setPaleta(true), []));

  const IconeTema = tema === 'escuro' ? Moon : tema === 'claro' ? Sun : Monitor;
  const refVendas = status?.dados?.vendas?.max;
  const nAlertas = Array.isArray(insights) ? insights.length : 0;
  const { dados: atendimento } = useApi('/atendimento/resumo', { intervalo: 30000 });
  const nAtendimento = atendimento?.nao_lidas || 0;
  const Pagina = atual.comp;

  return (
    <ProvedorToast>
      <div className={cx('app', recolhida && 'recolhida')}>
        <aside className="lateral">
          <div className="marca">
            <div className="marca-logo"><BarChart3 size={17} strokeWidth={2.4} /></div>
            <div className="marca-texto" style={{ minWidth: 0 }}>
              <div className="marca-nome truncar">Apurador</div>
              <div className="marca-sub truncar">{status?.empresa || 'Campanhas de incentivo'}</div>
            </div>
          </div>
          {NAV.map((g) => (
            <nav key={g.grupo} aria-label={g.grupo}>
              <div className="nav-grupo">{g.grupo}</div>
              {g.itens.map((i) => (
                <a key={i.para} href={`#${i.para}`} className={cx('nav-item', ativoNav(i.para, rota.caminho) && 'ativo')} title={i.rotulo}>
                  <i.icone size={17} strokeWidth={1.9} />
                  <span className="nav-rotulo">{i.rotulo}</span>
                  {i.contador === 'alertas' && nAlertas > 0 && <span className="nav-contador">{nAlertas}</span>}
                  {i.contador === 'atendimento' && nAtendimento > 0 && <span className="nav-contador" style={{ background: 'var(--acento)', color: '#fff' }}>{nAtendimento}</span>}
                </a>
              ))}
            </nav>
          ))}
          <div className="lateral-rodape">
            <button type="button" className="nav-item" style={{ border: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => setRecolhida((r) => !r)} title={recolhida ? 'Expandir menu' : 'Recolher menu'}>
              {recolhida ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
              <span className="nav-rotulo">Recolher menu</span>
            </button>
          </div>
        </aside>

        <div className="principal">
          <header className="topo nao-imprimir">
            <div className="topo-busca" onClick={() => setPaleta(true)} role="button" aria-label="Abrir busca (Ctrl+K)">
              <Search size={15} />
              <span className="cresce pequeno">Buscar ou executar…</span>
              <span className="tecla">Ctrl K</span>
            </div>
            <div className="cresce" />
            <IndicadorPipeline />
            {refVendas && (
              <span className="pilula" title="Data da última venda carregada. As projeções usam esta data como referência.">
                <span className="ponto vivo" /> Dados até {fmtData(refVendas)}
              </span>
            )}
            {status?.ia?.configurada && (
              <a href="#/config?aba=ia" className="pilula" style={{ textDecoration: 'none' }} title="Consumo de IA hoje / limite diário">
                <Brain size={13} /> {fmtUsd(status.ia.gasto_hoje_usd)} / {fmtUsd(status.ia.limite_diario_usd)}
              </a>
            )}
            <a href="#/insights" className="botao fantasma icone" title="Alertas" style={{ position: 'relative' }}>
              <Bell size={16} />
              {nAlertas > 0 && <span style={{ position: 'absolute', top: 6, right: 7, width: 7, height: 7, borderRadius: 9, background: 'var(--critico)', boxShadow: '0 0 0 2px var(--plano)' }} />}
            </a>
            <button type="button" className="botao fantasma icone" onClick={alternarTema} title={`Tema: ${tema}`} aria-label="Alternar tema">
              <IconeTema size={16} />
            </button>
          </header>

          <main className={cx('conteudo', atual.cheio && 'cheio')}>
            <Suspense fallback={<Carregando altura={400} />}>
              <div key={atual.padrao + JSON.stringify(atual.params)} className="pagina-entrada">
                <Pagina params={atual.params} query={rota.query} status={status} />
              </div>
            </Suspense>
          </main>
        </div>
      </div>
      <PaletaComandos aberta={paleta} aoFechar={() => setPaleta(false)} alternarTema={alternarTema} />
    </ProvedorToast>
  );
}
