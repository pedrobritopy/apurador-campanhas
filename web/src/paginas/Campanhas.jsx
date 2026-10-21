import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LayoutGrid, List, MoreHorizontal, Plus, Search, Trophy } from 'lucide-react';
import { useApi } from '../lib/api.js';
import { navegar } from '../lib/rotas.js';
import { fmtMoeda, fmtNumero, fmtPerc, fmtPeriodo } from '../lib/formato.js';
import {
  Botao, BotaoIcone, Cabecalho, Chip, Entrada, ErroCarga, Esqueleto, Explica, Menu, Progresso, SeloCampanha, Segmentado, Seletor, Tabela, Vazio,
} from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import CartaoCampanha from './campanha/CartaoCampanha.jsx';
import { situacao, useAcoesCampanha } from './campanha/acoes.jsx';
import { corDaCampanha, textoTempoResumo } from './campanha/util.js';
import './campanha/campanha.css';

const FILTROS = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'andamento', rotulo: 'Em andamento' },
  { id: 'agendada', rotulo: 'Agendadas' },
  { id: 'aguardando', rotulo: 'Aguardando fechamento' },
  { id: 'rascunho', rotulo: 'Rascunhos' },
  { id: 'encerrada', rotulo: 'Encerradas' },
  { id: 'arquivada', rotulo: 'Arquivadas' },
];

const ORDENS = [
  { valor: 'recentes', rotulo: 'Editadas recentemente' },
  { valor: 'fim', rotulo: 'Terminam primeiro' },
  { valor: 'projecao', rotulo: 'Maior projeção' },
  { valor: 'risco', rotulo: 'Mais participantes em risco' },
  { valor: 'nome', rotulo: 'Nome (A a Z)' },
];

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function lerModo() {
  try {
    return localStorage.getItem('campanhas-modo') || 'cartoes';
  } catch {
    return 'cartoes';
  }
}

export default function Campanhas({ query }) {
  const { dados, erro, carregando, recarregar } = useApi('/campanhas', { vivo: true });
  const [filtro, setFiltro] = useState(query?.get('filtro') || 'todas');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('recentes');
  const [modo, setModo] = useState(lerModo);
  const { itensMenu, dialogo } = useAcoesCampanha({ aoMudar: recarregar });

  useEffect(() => {
    try {
      localStorage.setItem('campanhas-modo', modo);
    } catch {
      /* preferência só nesta sessão */
    }
  }, [modo]);

  const lista = Array.isArray(dados) ? dados : [];
  const contagem = useMemo(() => {
    const c = { todas: 0 };
    for (const camp of lista) {
      const s = situacao(camp);
      c[s] = (c[s] || 0) + 1;
      if (s !== 'arquivada') c.todas++;
    }
    return c;
  }, [lista]);

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    let l = lista.filter((c) => {
      const s = situacao(c);
      if (filtro === 'todas' ? s === 'arquivada' : s !== filtro) return false;
      return !q || normalizar(`${c.nome} ${c.fornecedor || ''}`).includes(q);
    });
    const cmp = {
      recentes: (a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)),
      fim: (a, b) => String(a.fim).localeCompare(String(b.fim)),
      projecao: (a, b) => (b.resumo?.atingimento_geral_proj ?? -1) - (a.resumo?.atingimento_geral_proj ?? -1),
      risco: (a, b) => (b.resumo?.risco ?? -1) - (a.resumo?.risco ?? -1),
      nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    }[ordem];
    l = [...l].sort(cmp);
    return l;
  }, [lista, filtro, busca, ordem]);

  const colunas = [
    {
      chave: 'nome', titulo: 'Campanha', ordenavel: true, valor: (c) => c.nome,
      render: (c, i) => (
        <div className="linha" style={{ gap: 10 }}>
          <span className="cmp-ponto-cor" style={{ background: corDaCampanha(c, i) }} />
          <div style={{ minWidth: 0 }}>
            <div className="forte truncar" style={{ maxWidth: 320 }}>{c.nome}</div>
            <div className="mudo pequeno">{c.fornecedor || 'Sem fornecedor'}</div>
          </div>
        </div>
      ),
    },
    { chave: 'situacao', titulo: 'Situação', render: (c) => <SeloCampanha status={c.status} tempo={c.resumo?.tempo_status} /> },
    { chave: 'periodo', titulo: 'Período', ordenavel: true, valor: (c) => c.inicio, render: (c) => <span className="num">{fmtPeriodo(c.inicio, c.fim)}</span> },
    { chave: 'tempo', titulo: 'Tempo', render: (c) => <span className="sec pequeno">{c.resumo ? textoTempoResumo(c.resumo, c.inicio, c.fim) : '-'}</span> },
    {
      chave: 'ating', titulo: 'Atingimento', ordenavel: true, largura: 190, valor: (c) => c.resumo?.atingimento_geral,
      render: (c) =>
        c.resumo?.atingimento_geral != null ? (
          <div className="linha" style={{ gap: 10 }}>
            <div style={{ width: 100 }}><Progresso valor={c.resumo.atingimento_geral} projecao={c.resumo.atingimento_geral_proj} espessura="p" /></div>
            <span className="num forte">{fmtPerc(c.resumo.atingimento_geral)}</span>
          </div>
        ) : <span className="mudo">-</span>,
    },
    { chave: 'proj', titulo: 'Projeção', alinhar: 'direita', ordenavel: true, valor: (c) => c.resumo?.atingimento_geral_proj, render: (c) => <span className="num">{fmtPerc(c.resumo?.atingimento_geral_proj)}</span> },
    {
      chave: 'bateram', titulo: 'Bateram', alinhar: 'direita', ordenavel: true, valor: (c) => c.resumo?.atingiram,
      render: (c) => (c.resumo ? <span className="num">{fmtNumero(c.resumo.atingiram)}<span className="mudo"> / {fmtNumero(c.resumo.participantes)}</span></span> : '-'),
    },
    { chave: 'risco', titulo: 'Em risco', alinhar: 'direita', ordenavel: true, valor: (c) => c.resumo?.risco, render: (c) => <span className="num">{c.resumo ? fmtNumero(c.resumo.risco) : '-'}</span> },
    { chave: 'premio', titulo: 'Prêmio proj.', alinhar: 'direita', ordenavel: true, valor: (c) => c.resumo?.premio_proj_total, render: (c) => <span className="num">{c.resumo ? fmtMoeda(c.resumo.premio_proj_total, { compacto: true }) : '-'}</span> },
    {
      chave: 'acoes', titulo: '', largura: 44,
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu gatilho={<BotaoIcone icone={MoreHorizontal} rotulo="Ações" tamanho="p" />} itens={itensMenu(c)} />
        </span>
      ),
    },
  ];

  return (
    <div>
      <Cabecalho
        titulo="Campanhas"
        info={EXPLICA.listaCampanhas}
        subtitulo="Todas as competições de venda, com apuração automática e projeção diária."
        acoes={<Botao variante="primario" icone={Plus} onClick={() => navegar('/campanhas/nova')}>Nova campanha</Botao>}
      />

      <div className="cmp-filtros">
        {FILTROS.filter((f) => f.id === 'todas' || f.id === 'andamento' || contagem[f.id]).map((f) => (
          <Chip key={f.id} ativo={filtro === f.id} aoClicar={() => setFiltro(f.id)}>
            {f.rotulo}
            <span className="num mudo" style={{ fontWeight: 600 }}>{contagem[f.id] || 0}</span>
          </Chip>
        ))}
        <Explica titulo="Situação da campanha" {...EXPLICA.situacaoCampanha} />
        <div className="cresce" />
        <Entrada icone={Search} placeholder="Buscar por nome ou fornecedor" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Seletor opcoes={ORDENS} valor={ordem} aoMudar={setOrdem} style={{ width: 210 }} />
        <Segmentado
          valor={modo}
          aoMudar={setModo}
          opcoes={[
            { valor: 'cartoes', rotulo: '', icone: LayoutGrid, dica: 'Cartões' },
            { valor: 'tabela', rotulo: '', icone: List, dica: 'Tabela' },
          ]}
        />
      </div>

      {erro && !dados ? (
        <ErroCarga erro={erro} aoTentar={recarregar} />
      ) : carregando && !dados ? (
        <div className="cmp-grade">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="cartao" style={{ padding: 18 }}>
              <Esqueleto altura={14} largura="60%" />
              <Esqueleto altura={20} style={{ marginTop: 10 }} />
              <Esqueleto altura={86} style={{ marginTop: 16 }} />
            </div>
          ))}
        </div>
      ) : !lista.length ? (
        <div className="cartao">
          <Vazio
            icone={Trophy}
            titulo="Nenhuma campanha ainda"
            texto="Crie sua primeira campanha a partir de um modelo pronto (positivação, mix, venda casada, crescimento) e veja a apuração ao vivo enquanto configura."
            acao={<Botao variante="primario" icone={Plus} onClick={() => navegar('/campanhas/nova')}>Criar a primeira campanha</Botao>}
          />
        </div>
      ) : !visiveis.length ? (
        <div className="cartao">
          <Vazio icone={Search} titulo="Nada por aqui" texto={busca ? `Nenhuma campanha corresponde a "${busca}" neste filtro.` : 'Não há campanhas nesta situação.'}
            acao={<Botao tamanho="p" onClick={() => { setBusca(''); setFiltro('todas'); }}>Limpar filtros</Botao>} />
        </div>
      ) : modo === 'tabela' ? (
        <div className="cartao">
          <Tabela colunas={colunas} linhas={visiveis} chaveLinha={(c) => c.id} aoClicarLinha={(c) => navegar(c.status === 'rascunho' ? `/campanhas/${c.id}/editar` : `/campanhas/${c.id}`)} />
        </div>
      ) : (
        <motion.div layout className="cmp-grade">
          <AnimatePresence initial={false}>
            {visiveis.map((c, i) => (
              <motion.div key={c.id} layout style={{ height: '100%' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 380, damping: 34, delay: Math.min(i, 8) * 0.03 }}>
                <CartaoCampanha c={c} indice={i} itensMenu={itensMenu} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {dialogo}
    </div>
  );
}
