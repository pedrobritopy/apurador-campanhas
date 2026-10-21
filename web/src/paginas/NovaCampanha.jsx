import { useMemo, useState } from 'react';
import {
  ArrowRight, BadgeCheck, BadgePercent, Coins, Copy, DollarSign, Gift, LayoutGrid, Link2, Package, PieChart, Plus, Rocket,
  RotateCcw, Search, ShoppingBasket, Target, TrendingUp, Trophy, UserCheck, Users,
} from 'lucide-react';
import './construtor/construtor.css';
import MultiSelecao from '../componentes/MultiSelecao.jsx';
import { Botao, Cabecalho, Carregando, Chip, Entrada, ErroCarga, Explica, Modal, Selo, SeloCampanha, Vazio, useToast } from '../componentes/ui.jsx';
import { post, useApi } from '../lib/api.js';
import { useCatalogo, useDimensoes } from '../lib/dados.js';
import { fmtPeriodo } from '../lib/formato.js';
import { navegar } from '../lib/rotas.js';
import { VARIOS_FORNECEDORES, normalizarTexto } from './construtor/util.js';

const ICONES = { Package, DollarSign, Target, UserCheck, BadgeCheck, PieChart, LayoutGrid, ShoppingBasket, Link2, Gift, TrendingUp, Trophy, Coins, Users, BadgePercent, RotateCcw, Rocket };

const CATEGORIAS = [
  { chave: 'Simples', descricao: 'Uma regra só: a cada X unidades, R$ Y; R$ por unidade; ranking com prêmio para quem bater a meta.' },
  { chave: 'Volume', descricao: 'Unidades e faturamento: o "sell-in" clássico do fornecedor.' },
  { chave: 'Cobertura e positivação', descricao: 'Quantos clientes compraram. A métrica nº 1 das distribuidoras.' },
  { chave: 'Mix', descricao: 'Amplitude do portfólio vendido: SKUs, cestas e mix mínimo.' },
  { chave: 'Venda casada', descricao: 'Kits e combos: itens levados juntos no mesmo pedido ou cliente.' },
  { chave: 'Crescimento', descricao: 'Evolução contra o período anterior e participação na categoria.' },
  { chave: 'Competição', descricao: 'Campeonatos, rankings, rateio de verba e desafios de equipe.' },
  { chave: 'Rentabilidade', descricao: 'Margem, desconto e devolução: vender bem, não só vender.' },
  { chave: 'Recuperação', descricao: 'Reativar clientes parados e lançar produtos na carteira.' },
];

const NIVEL = { vendedor: 'Vendedores', equipe: 'Equipes', cliente: 'Clientes', canal: 'Canais', estado: 'UFs', segmento: 'Segmentos', empresa: 'Empresa' };
const PREMIO = { faixas: 'Faixas', ranking: 'Ranking', rateio: 'Rateio de verba', bloco: 'A cada X unidades', nenhuma: 'Sem prêmio' };

// leva o fornecedor escolhido para o construtor
const comFornecedor = (url, fab) => (fab ? `${url}${url.includes('?') ? '&' : '?'}fabricante=${encodeURIComponent(fab)}` : url);

function CartaoModelo({ m, fab }) {
  const Icone = ICONES[m.icone] || Target;
  const d = m.definicao || {};
  return (
    <button type="button" className="modelo-card" onClick={() => navegar(comFornecedor(`/campanhas/nova/editor?modelo=${encodeURIComponent(m.chave)}`, fab))}>
      <ArrowRight size={16} className="modelo-seta" />
      <div className="linha" style={{ gap: 12 }}>
        <span className="modelo-icone" style={{ background: d.cor || 'var(--acento)' }}><Icone size={19} strokeWidth={2.1} /></span>
        <div className="coluna" style={{ gap: 2, minWidth: 0 }}>
          <span className="modelo-nome">{m.nome}</span>
          {fab && fab !== VARIOS_FORNECEDORES ? <span className="mini truncar" style={{ color: 'var(--acento-texto)' }}>para {fab}</span> : <span className="mini mudo truncar">ex.: {d.nome}</span>}
        </div>
      </div>
      <p className="modelo-desc">{m.descricao}</p>
      {m.mede && <div className="modelo-mede"><Target size={12} style={{ flex: 'none', marginTop: 2 }} /> {m.mede}</div>}
      <div className="modelo-rodape">
        <Selo>{NIVEL[d.participantes?.nivel] || 'Vendedores'}</Selo>
        <Selo>{d.criterios?.length || 1} critério{(d.criterios?.length || 1) > 1 ? 's' : ''}</Selo>
        <Selo cor="acento">{PREMIO[d.premiacao?.tipo] || 'Faixas'}</Selo>
      </div>
    </button>
  );
}

function ModalDuplicar({ aberto, aoFechar }) {
  const toast = useToast();
  const { dados, erro, carregando } = useApi(aberto ? '/campanhas' : null);
  const [busca, setBusca] = useState('');
  const [duplicando, setDuplicando] = useState(null);
  const lista = useMemo(() => {
    const q = normalizarTexto(busca);
    return (dados || []).filter((c) => !q || normalizarTexto(`${c.nome} ${c.fornecedor || ''}`).includes(q));
  }, [dados, busca]);
  const duplicar = async (c) => {
    setDuplicando(c.id);
    try {
      const r = await post(`/campanhas/${c.id}/duplicar`);
      toast.ok(`"${c.nome}" duplicada. Ajuste o período e salve.`);
      navegar(`/campanhas/${r.id}/editar`);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setDuplicando(null);
    }
  };
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Duplicar uma campanha existente" subtitulo="Copia todas as regras, metas e prêmios. Ideal para repetir a campanha do mês passado.">
      <div className="coluna" style={{ gap: 12 }}>
        <Entrada icone={Search} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha…" autoFocus />
        {carregando && !dados && <Carregando altura={120} />}
        {erro && <ErroCarga erro={erro} />}
        {dados && !lista.length && <Vazio titulo="Nenhuma campanha" texto="Ainda não há campanhas para duplicar." />}
        <div className="coluna" style={{ gap: 6 }}>
          {lista.map((c) => (
            <div key={c.id} className="linha" style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--superficie-2)', gap: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: c.cor || 'var(--acento)', flex: 'none' }} />
              <div className="cresce coluna" style={{ gap: 0 }}>
                <span className="forte truncar">{c.nome}</span>
                <span className="mini mudo">{[c.fornecedor, fmtPeriodo(c.inicio, c.fim)].filter(Boolean).join(' · ')}</span>
              </div>
              <SeloCampanha status={c.status} />
              <Botao tamanho="p" icone={Copy} carregando={duplicando === c.id} onClick={() => duplicar(c)}>Duplicar</Botao>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const lerFab = () => {
  try {
    return sessionStorage.getItem('nova:fabricante') || null;
  } catch {
    return null;
  }
};

/** Passo 1: para qual fornecedor é a campanha (os modelos já nascem com os produtos dele). */
function EscolhaFornecedor({ fab, aoMudar }) {
  const { dados: dim } = useDimensoes();
  const opcoes = useMemo(
    () => (dim?.fabricantes || []).map((f) => ({ valor: f.nome, rotulo: f.nome, detalhe: `${f.produtos} produtos · ${f.marcas.slice(0, 3).join(', ')}${f.marcas.length > 3 ? '…' : ''}` })),
    [dim],
  );
  const varios = fab === VARIOS_FORNECEDORES;
  return (
    <div className="nova-fornecedor">
      <span className="cons-passo-num" style={{ width: 26, height: 26, fontSize: 12.5 }}>1</span>
      <div className="coluna cresce" style={{ gap: 8, minWidth: 0 }}>
        <div className="com-explica" style={{ fontWeight: 650 }}>
          Para qual fornecedor é a campanha?
          <Explica titulo="Fornecedor da campanha" texto="Escolha o fabricante que patrocina a campanha. Os modelos abaixo já abrem com os produtos dele, e você só ajusta o resto."
            como={['Busque pelo nome (ex.: Haleon, Hypera, EMS).', 'Se a campanha vale para vários fabricantes (meta geral do mês, por exemplo), clique em "Vários fornecedores".', 'Pode pular: o construtor pede o fornecedor de novo antes de salvar.']} />
        </div>
        <div className="linha quebra" style={{ gap: 8 }}>
          <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
            {varios ? (
              <div className="cons-fornecedor-card"><span className="forte">Vários fornecedores</span></div>
            ) : (
              <MultiSelecao unico opcoes={opcoes} valores={fab ? [fab] : []} aoMudar={(v) => aoMudar(v[0] || null)} placeholder="Busque o fabricante (ex.: Haleon, Hypera, EMS)" />
            )}
          </div>
          <Chip ativo={varios} aoClicar={() => aoMudar(varios ? null : VARIOS_FORNECEDORES)}>Vários fornecedores</Chip>
        </div>
        <span className="mini mudo">
          {fab && !varios ? `Os modelos abaixo vão abrir com os produtos ${fab}.` : varios ? 'Cada critério vai escolher os próprios produtos.' : 'Depois escolha um modelo (passo 2) ou comece do zero.'}
        </span>
      </div>
    </div>
  );
}

export default function NovaCampanha() {
  const { dados: catalogo, erro, carregando } = useCatalogo();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState(null);
  const [duplicar, setDuplicar] = useState(false);
  const [fab, setFabEstado] = useState(lerFab);
  const setFab = (v) => {
    setFabEstado(v);
    try {
      if (v) sessionStorage.setItem('nova:fabricante', v);
      else sessionStorage.removeItem('nova:fabricante');
    } catch {
      /* armazenamento indisponível */
    }
  };
  const modelos = catalogo?.modelos || [];

  const filtrados = useMemo(() => {
    const q = normalizarTexto(busca);
    return modelos.filter(
      (m) => (!categoria || m.categoria === categoria) && (!q || normalizarTexto(`${m.nome} ${m.descricao} ${m.mede || ''} ${m.categoria} ${m.definicao?.fornecedor || ''}`).includes(q)),
    );
  }, [modelos, busca, categoria]);
  const porCategoria = CATEGORIAS.map((c) => ({ ...c, itens: filtrados.filter((m) => m.categoria === c.chave) })).filter((c) => c.itens.length);
  const outros = filtrados.filter((m) => !CATEGORIAS.some((c) => c.chave === m.categoria));

  return (
    <div>
      <Cabecalho
        sobre={<a href="#/campanhas">Campanhas</a>}
        titulo="Nova campanha"
        subtitulo="Escolha o fornecedor, depois um modelo pronto (tudo é editável). Antes de ativar você vê o resultado com as vendas reais."
        acoes={
          <>
            <Botao icone={Copy} onClick={() => setDuplicar(true)}>Duplicar existente</Botao>
            <Botao variante="primario" icone={Plus} onClick={() => navegar(comFornecedor('/campanhas/nova/editor', fab))}>Começar do zero</Botao>
          </>
        }
      />

      <EscolhaFornecedor fab={fab} aoMudar={setFab} />

      <div className="linha" style={{ gap: 10, margin: '4px 0 12px' }}>
        <span className="cons-passo-num" style={{ width: 26, height: 26, fontSize: 12.5 }}>2</span>
        <span style={{ fontWeight: 650 }}>Escolha um modelo ou comece do zero</span>
      </div>

      <div className="modelos-filtros">
        <div style={{ width: 300 }}>
          <Entrada icone={Search} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo (positivação, kit, ranking…)" />
        </div>
        <Chip ativo={!categoria} aoClicar={() => setCategoria(null)}>Todos <span className="mudo">{modelos.length}</span></Chip>
        {CATEGORIAS.map((c) => {
          const n = modelos.filter((m) => m.categoria === c.chave).length;
          return n ? (
            <Chip key={c.chave} ativo={categoria === c.chave} aoClicar={() => setCategoria(categoria === c.chave ? null : c.chave)}>
              {c.chave} <span className="mudo">{n}</span>
            </Chip>
          ) : null;
        })}
      </div>

      {erro && <ErroCarga erro={erro} />}
      {carregando && <Carregando altura={300} texto="Carregando modelos…" />}

      {!carregando && !busca && !categoria && (
        <div className="modelos-grade escalonado" style={{ marginBottom: 26 }}>
          <button type="button" className="modelo-card especial" onClick={() => navegar(comFornecedor('/campanhas/nova/editor', fab))}>
            <ArrowRight size={16} className="modelo-seta" />
            <span className="modelo-icone" style={{ background: 'var(--acento)' }}><Plus size={20} /></span>
            <span className="modelo-nome">Começar do zero</span>
            <p className="modelo-desc">Monte qualquer apuração: mais de 40 métricas, fórmulas próprias, variáveis recortadas por marca, canal, região ou curva ABC.</p>
          </button>
          <button type="button" className="modelo-card" onClick={() => setDuplicar(true)}>
            <ArrowRight size={16} className="modelo-seta" />
            <span className="modelo-icone" style={{ background: 'var(--tinta-2)' }}><Copy size={18} /></span>
            <span className="modelo-nome">Repetir uma campanha</span>
            <p className="modelo-desc">Duplica regras, metas e prêmios de uma campanha anterior. É só ajustar o período e ativar.</p>
          </button>
        </div>
      )}

      {porCategoria.map((c) => (
        <section key={c.chave} className="modelos-categoria">
          <div className="modelos-categoria-topo">
            <h2>{c.chave}</h2>
            <span className="mudo pequeno">{c.descricao}</span>
          </div>
          <div className="modelos-grade escalonado">
            {c.itens.map((m) => <CartaoModelo key={m.chave} m={m} fab={fab} />)}
          </div>
        </section>
      ))}
      {outros.length > 0 && (
        <section className="modelos-categoria">
          <div className="modelos-categoria-topo"><h2>Outros</h2></div>
          <div className="modelos-grade">{outros.map((m) => <CartaoModelo key={m.chave} m={m} fab={fab} />)}</div>
        </section>
      )}
      {!carregando && catalogo && !filtrados.length && (
        <Vazio icone={Search} titulo="Nenhum modelo encontrado" texto="Tente outra palavra ou comece do zero." acao={<Botao onClick={() => { setBusca(''); setCategoria(null); }}>Limpar busca</Botao>} />
      )}

      <ModalDuplicar aberto={duplicar} aoFechar={() => setDuplicar(false)} />
    </div>
  );
}
