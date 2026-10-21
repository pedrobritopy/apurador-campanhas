import { useMemo, useState } from 'react';
import { AlertTriangle, FileText, Landmark, Lock, Plus, Search, Wallet } from 'lucide-react';
import { useApi } from '../lib/api.js';
import { navegar } from '../lib/rotas.js';
import { fmtData, fmtMoeda, plural } from '../lib/formato.js';
import {
  Botao, Cabecalho, Cartao, Entrada, ErroCarga, Esqueleto, Explica, Kpi, Segmentado, Selo, Tabela, Vazio,
} from '../componentes/ui.jsx';
import { Sparkline } from '../componentes/graficos.jsx';
import DetalheConta from './contacorrente/DetalheConta.jsx';
import { LogoFabricante } from '../componentes/Imagens.jsx';
import ModalConta from './contacorrente/ModalConta.jsx';
import { EXPLICA, SITUACAO_CONTA, TIPO_ALERTA } from './contacorrente/util.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Rótulo de KPI/coluna com o "i" ao lado. */
const ComInfo = ({ rotulo, info }) => (
  <span className="com-explica" style={{ display: 'inline-flex' }}>{rotulo}<Explica titulo={rotulo} {...info} tamanho={12} /></span>
);

export default function ContaCorrente({ params }) {
  if (params?.id) return <DetalheConta key={params.id} id={params.id} />;
  return <VisaoGeral />;
}

function VisaoGeral() {
  const { dados, erro, recarregar } = useApi('/conta-corrente', { vivo: true });
  const [filtro, setFiltro] = useState('todas');
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);
  const [todosAlertas, setTodosAlertas] = useState(false);

  const contas = useMemo(() => {
    const q = norm(busca.trim());
    return (dados?.contas || []).filter((c) => {
      if (filtro === 'alerta' && !c.n_alertas) return false;
      if (filtro === 'campanha' && !c.reservas.length) return false;
      if (filtro === 'bloqueio' && !['estourada', 'bloqueada'].includes(c.situacao)) return false;
      return !q || norm(`${c.conta.nome} ${c.conta.responsavel || ''}`).includes(q);
    });
  }, [dados, filtro, busca]);

  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  const t = dados?.totais;

  const colunas = [
    {
      chave: 'nome', titulo: 'Fornecedor', ordenavel: true, dirInicial: 'asc', valor: (c) => c.conta.nome, render: (c) => (
        <div className="linha" style={{ gap: 10, minWidth: 0 }}>
          <LogoFabricante nome={c.conta.fabricante === '__propria__' ? c.conta.nome : c.conta.fabricante} tamanho={32} />
          <div className="coluna" style={{ gap: 1, minWidth: 0 }}>
            <span className="forte truncar" style={{ color: 'var(--tinta)' }}>{c.conta.nome}</span>
            <span className="mini mudo truncar">{c.conta.responsavel || (c.conta.perc_acordo ? `Acordo de ${String(c.conta.perc_acordo).replace('.', ',')}%` : 'Sem acordo cadastrado')}</span>
          </div>
        </div>
      ),
    },
    {
      chave: 'situacao', titulo: 'Situação', largura: 150, ordenavel: true, valor: (c) => ['bloqueada', 'estourada', 'no_limite', 'atencao', 'ok'].indexOf(c.situacao), dirInicial: 'asc',
      render: (c) => { const s = SITUACAO_CONTA[c.situacao]; return <Selo cor={s.cor} icone={s.icone}>{s.rotulo}</Selo>; },
    },
    {
      chave: 'disponivel', titulo: <ComInfo rotulo="Disponível" info={EXPLICA.disponivel} />, alinhar: 'direita', ordenavel: true, valor: (c) => c.saldos.disponivel,
      render: (c) => <span className={`num forte ${c.saldos.disponivel < 0 ? 'ccr-negativo' : ''}`}>{fmtMoeda(c.saldos.disponivel)}</span>,
    },
    {
      chave: 'reservado', titulo: <ComInfo rotulo="Reservado" info={EXPLICA.reservado} />, alinhar: 'direita', ordenavel: true, valor: (c) => c.saldos.reservado,
      render: (c) => (
        <div className="coluna" style={{ gap: 0, alignItems: 'flex-end' }}>
          <span className="num">{fmtMoeda(c.saldos.reservado)}</span>
          {c.reservas.length > 0 && <span className="mini mudo">{plural(c.reservas.length, 'campanha', 'campanhas')}</span>}
        </div>
      ),
    },
    {
      chave: 'a_receber', titulo: <ComInfo rotulo="NDs a receber" info={EXPLICA.a_receber} />, alinhar: 'direita', ordenavel: true, valor: (c) => c.saldos.a_receber,
      render: (c) => (
        <div className="coluna" style={{ gap: 0, alignItems: 'flex-end' }}>
          <span className="num">{fmtMoeda(c.saldos.a_receber)}</span>
          {c.saldos.nd_atrasada > 0 && <span className="mini ccr-atraso">{fmtMoeda(c.saldos.nd_atrasada)} vencidos</span>}
        </div>
      ),
    },
    {
      chave: 'previsto', titulo: <ComInfo rotulo="Previsto" info={EXPLICA.previsto} />, alinhar: 'direita', ordenavel: true, valor: (c) => c.saldos.previsto,
      render: (c) => <span className="num mudo">{fmtMoeda(c.saldos.previsto)}</span>,
    },
    {
      chave: 'serie', titulo: 'Últimos 12 meses', largura: 120,
      render: (c) => <Sparkline valores={c.serie} largura={104} altura={26} />,
    },
  ];

  const alertas = dados?.alertas || [];
  const alertasVisiveis = todosAlertas ? alertas : alertas.slice(0, 5);

  return (
    <div className="coluna pagina-entrada" style={{ gap: 18 }}>
      <Cabecalho sobre="Fornecedores" titulo="Conta corrente" info={EXPLICA.pagina}
        subtitulo="Verba de cada indústria: quanto entrou, quanto está reservado para campanhas e quanto ainda dá para usar."
        acoes={<Botao icone={Plus} onClick={() => setCriando(true)}>Nova conta</Botao>} />

      {!dados ? (
        <div className="grade-4">{[0, 1, 2, 3].map((i) => <Esqueleto key={i} altura={108} raio={14} />)}</div>
      ) : (
        <div className="grade-4">
          <Kpi rotulo={<ComInfo rotulo="Disponível para campanhas" info={EXPLICA.disponivel} />} valor={t.disponivel} formato="moeda" compacto icone={Wallet}
            rodape={<span className="mudo pequeno">em {plural(t.contas, 'conta', 'contas')}</span>} />
          <Kpi rotulo={<ComInfo rotulo="Reservado em campanhas" info={EXPLICA.reservado} />} valor={t.reservado} formato="moeda" compacto icone={Lock}
            rodape={<span className="mudo pequeno">{plural(t.campanhas_reservadas, 'campanha ativa', 'campanhas ativas')}</span>} />
          <Kpi rotulo={<ComInfo rotulo="NDs a receber" info={EXPLICA.a_receber} />} valor={t.a_receber} formato="moeda" compacto icone={FileText}
            rodape={t.nd_atrasada > 0 ? <span className="pequeno ccr-atraso">{fmtMoeda(t.nd_atrasada)} vencidos</span> : <span className="mudo pequeno">nenhuma vencida</span>} />
          <Kpi rotulo={<ComInfo rotulo="Contas bloqueando campanhas" info={{ texto: 'Contas negativas além do limite ou bloqueadas. Campanha nova desses fornecedores só entra com exceção autorizada.' }} />}
            valor={t.bloqueadas} icone={AlertTriangle}
            rodape={<span className="mudo pequeno">{t.vencendo > 0 ? `${fmtMoeda(t.vencendo)} de verba vencendo` : 'nenhuma verba vencendo'}</span>} />
        </div>
      )}

      {alertas.length > 0 && (
        <Cartao titulo="O que pede ação" info={EXPLICA.alertas} subtitulo={`${plural(alertas.length, 'ponto', 'pontos')} em ${plural(new Set(alertas.map((a) => a.id_conta)).size, 'conta', 'contas')}`}
          acoes={alertas.length > 5 && <Botao tamanho="p" variante="fantasma" onClick={() => setTodosAlertas((v) => !v)}>{todosAlertas ? 'Ver menos' : `Ver todos (${alertas.length})`}</Botao>}>
          <div className="coluna" style={{ gap: 6 }}>
            {alertasVisiveis.map((a, i) => {
              const tp = TIPO_ALERTA[a.tipo] || TIPO_ALERTA.info;
              return (
                <button key={i} type="button" className="ccr-alerta clicavel" onClick={() => navegar(`/conta-corrente/${a.id_conta}`)}>
                  <Selo cor={tp.cor} icone={tp.icone}>{tp.rotulo}</Selo>
                  <span className="cresce">{a.texto}</span>
                </button>
              );
            })}
          </div>
        </Cartao>
      )}

      <Cartao titulo="Contas por fornecedor" semMargem
        subtitulo={dados ? `Atualizado em ${fmtData(dados.hoje)}. Clique numa conta para ver o extrato.` : ' '}
        acoes={(
          <div className="linha quebra" style={{ gap: 8 }}>
            <Segmentado tamanho="p" valor={filtro} aoMudar={setFiltro}
              opcoes={[
                { valor: 'todas', rotulo: 'Todas' },
                { valor: 'alerta', rotulo: 'Com alerta' },
                { valor: 'campanha', rotulo: 'Com campanha' },
                { valor: 'bloqueio', rotulo: 'Bloqueando' },
              ]} />
            <div style={{ width: 200 }}><Entrada tamanho="p" icone={Search} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar fornecedor" /></div>
          </div>
        )}>
        {!dados ? <div style={{ padding: 16 }}><Esqueleto altura={20} linhas={8} /></div> : (
          <Tabela colunas={colunas} linhas={contas} chaveLinha={(c) => c.conta.id} aoClicarLinha={(c) => navegar(`/conta-corrente/${c.conta.id}`)}
            vazio={<Vazio icone={Landmark} titulo="Nenhuma conta neste filtro" texto="Mude o filtro ou crie a conta do fornecedor." />} />
        )}
      </Cartao>

      <ModalConta aberto={criando} conta={null} aoFechar={() => setCriando(false)} aoSalvar={(c) => { recarregar(); if (c?.id) navegar(`/conta-corrente/${c.id}`); }} />
    </div>
  );
}
