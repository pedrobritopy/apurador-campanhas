import { useState } from 'react';
import { CheckCheck, FileText, MoreHorizontal, Search, Undo2, XCircle } from 'lucide-react';
import { post, put, qs, useApi } from '../../lib/api.js';
import { fmtData, fmtMoeda } from '../../lib/formato.js';
import {
  BotaoIcone, Cartao, Entrada, ErroCarga, Esqueleto, Gaveta, Menu, Segmentado, Selo, Seletor, Tabela, Vazio, useToast,
} from '../../componentes/ui.jsx';
import { COMPROVACAO, EXPLICA, FORMAS, situacaoLanc } from './util.js';

const PERIODOS = [
  { valor: '90', rotulo: 'Últimos 90 dias' },
  { valor: '180', rotulo: 'Últimos 6 meses' },
  { valor: '365', rotulo: 'Últimos 12 meses' },
  { valor: '', rotulo: 'Tudo' },
];
const SITUACOES = [
  { valor: '', rotulo: 'Todas as situações' },
  { valor: 'previsto', rotulo: 'Previstos' },
  { valor: 'a_receber', rotulo: 'NDs a receber' },
  { valor: 'realizado', rotulo: 'Realizados' },
  { valor: 'reservado', rotulo: 'Reservas ativas' },
  { valor: 'consumido,liberado,cancelado', rotulo: 'Encerrados (usados, liberados, cancelados)' },
];

const desde = (dias) => {
  if (!dias) return '';
  const d = new Date();
  d.setDate(d.getDate() - Number(dias));
  return d.toISOString().slice(0, 10);
};

export default function Extrato({ idConta, aoMudar }) {
  const toast = useToast();
  const [periodo, setPeriodo] = useState('180');
  const [natureza, setNatureza] = useState('');
  const [situacao, setSituacao] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null);
  const caminho = `/conta-corrente/contas/${idConta}/extrato${qs({ de: desde(periodo), natureza, situacao, busca: busca.trim() })}`;
  const { dados, erro, carregando, recarregar } = useApi(caminho);

  const agir = async (l, corpo, msg) => {
    try {
      await put(`/conta-corrente/lancamentos/${l.id}`, corpo);
      toast.ok(msg);
      recarregar();
      aoMudar?.();
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const estornar = async (l) => {
    try {
      await post(`/conta-corrente/lancamentos/${l.id}/estornar`, { motivo: 'Estorno manual' });
      toast.ok('Estorno lançado. O original continua no extrato.');
      recarregar();
      aoMudar?.();
    } catch (e) {
      toast.erro(e.message);
    }
  };

  const itensMenu = (l) => [
    l.natureza === 'credito' && l.situacao === 'previsto' && { rotulo: 'Emitir ND', icone: FileText, aoClicar: () => agir(l, { acao: 'emitir_nd' }, 'ND emitida. Agora ela conta como a receber.') },
    l.natureza === 'credito' && ['previsto', 'a_receber'].includes(l.situacao) && { rotulo: 'Marcar como recebida (abatida)', icone: CheckCheck, aoClicar: () => agir(l, { acao: 'liquidar', forma_liquidacao: 'abatimento_duplicata' }, 'Verba recebida.') },
    l.natureza === 'debito' && l.comprovacao && l.comprovacao !== 'enviada' && { rotulo: 'Comprovação enviada', icone: FileText, aoClicar: () => agir(l, { acao: 'comprovacao', comprovacao: 'enviada' }, 'Comprovação marcada como enviada.') },
    l.natureza === 'debito' && l.comprovacao && l.comprovacao !== 'aprovada' && { rotulo: 'Comprovação aprovada', icone: CheckCheck, aoClicar: () => agir(l, { acao: 'comprovacao', comprovacao: 'aprovada' }, 'Comprovação aprovada pela indústria.') },
    l.situacao === 'realizado' && l.origem !== 'estorno' && { rotulo: 'Estornar', icone: Undo2, perigo: true, aoClicar: () => estornar(l) },
    ['previsto', 'a_receber'].includes(l.situacao) && { rotulo: 'Cancelar', icone: XCircle, perigo: true, aoClicar: () => agir(l, { acao: 'cancelar', motivo: 'Cancelado manualmente' }, 'Lançamento cancelado.') },
    l.situacao === 'reservado' && { rotulo: 'Liberar reserva', icone: Undo2, perigo: true, aoClicar: () => agir(l, { acao: 'cancelar', motivo: 'Reserva liberada manualmente' }, 'Reserva liberada.') },
  ].filter(Boolean);

  const colunas = [
    { chave: 'data', titulo: 'Data', largura: 96, render: (l) => <span className="num">{fmtData(l.data)}</span> },
    {
      chave: 'descricao', titulo: 'Lançamento', render: (l) => (
        <div className="coluna" style={{ gap: 2, minWidth: 0 }}>
          <span className="truncar" style={{ color: 'var(--tinta)' }}>{l.descricao}</span>
          <span className="mudo mini truncar">
            {l.rotulo_origem}{l.documento ? ` · ${l.documento}` : ''}{l.excecao ? ' · exceção autorizada' : ''}
            {l.situacao === 'a_receber' && l.vencimento ? ` · vence ${fmtData(l.vencimento)}` : ''}
          </span>
        </div>
      ),
    },
    {
      chave: 'situacao', titulo: 'Situação', largura: 150, render: (l) => {
        const s = situacaoLanc(l.situacao);
        const atrasada = l.situacao === 'a_receber' && l.vencimento && l.vencimento < new Date().toISOString().slice(0, 10);
        return <Selo cor={atrasada ? 'aviso' : s.cor} icone={s.icone}>{atrasada ? 'ND vencida' : s.rotulo}</Selo>;
      },
    },
    {
      chave: 'valor', titulo: 'Valor', alinhar: 'direita', largura: 130, render: (l) => (
        <span className={`num forte ${['liberado', 'cancelado', 'consumido'].includes(l.situacao) ? 'mudo' : ''}`}>
          {l.natureza === 'credito' ? '+' : '-'} {fmtMoeda(l.valor)}
        </span>
      ),
    },
    { chave: 'saldo', titulo: 'Saldo recebido', alinhar: 'direita', largura: 130, render: (l) => <span className="num mudo">{fmtMoeda(l.saldo_realizado)}</span> },
    {
      chave: 'acoes', titulo: '', largura: 40, render: (l) => {
        const itens = itensMenu(l);
        return itens.length ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu gatilho={<BotaoIcone icone={MoreHorizontal} tamanho="p" rotulo="Ações do lançamento" />} itens={itens} />
          </span>
        ) : null;
      },
    },
  ];

  return (
    <Cartao titulo="Extrato" info={EXPLICA.extrato} subtitulo={dados ? `${dados.total} lançamentos no filtro` : ' '} semMargem
      acoes={(
        <div className="linha quebra" style={{ gap: 8 }}>
          <Segmentado tamanho="p" valor={natureza} aoMudar={setNatureza} opcoes={[{ valor: '', rotulo: 'Tudo' }, { valor: 'credito', rotulo: 'Entradas' }, { valor: 'debito', rotulo: 'Saídas' }]} />
          <div style={{ width: 170 }}><Seletor tamanho="p" valor={periodo} aoMudar={setPeriodo} opcoes={PERIODOS} /></div>
          <div style={{ width: 190 }}><Seletor tamanho="p" valor={situacao} aoMudar={setSituacao} opcoes={SITUACOES} /></div>
          <div style={{ width: 190 }}><Entrada tamanho="p" icone={Search} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Descrição ou ND" /></div>
        </div>
      )}>
      {erro ? <ErroCarga erro={erro} aoTentar={recarregar} />
        : !dados && carregando ? <div style={{ padding: 16 }}><Esqueleto altura={18} linhas={8} /></div>
          : (
            <Tabela colunas={colunas} linhas={dados?.linhas || []} densa maxAltura={560} aoClicarLinha={setAberto}
              vazio={<Vazio titulo="Nenhum lançamento" texto="Mude o período ou os filtros." />} />
          )}
      <DetalheLancamento lanc={aberto} aoFechar={() => setAberto(null)} />
    </Cartao>
  );
}

function DetalheLancamento({ lanc, aoFechar }) {
  const l = lanc;
  const s = l ? situacaoLanc(l.situacao) : null;
  const linhas = l ? [
    ['Tipo', l.rotulo_origem],
    ['Natureza', l.natureza === 'credito' ? 'Entrada de verba (crédito)' : 'Uso de verba (débito)'],
    ['Valor', fmtMoeda(l.valor)],
    l.valor_utilizado != null && ['Usado da reserva', fmtMoeda(l.valor_utilizado)],
    ['Competência', fmtData(l.data)],
    l.documento && ['Documento', l.documento],
    l.emitido_em && ['ND emitida em', fmtData(l.emitido_em)],
    l.vencimento && ['Vencimento da ND', fmtData(l.vencimento)],
    l.liquidado_em && [l.natureza === 'credito' ? 'Recebido em' : 'Realizado em', fmtData(l.liquidado_em)],
    l.forma_liquidacao && ['Forma', FORMAS[l.forma_liquidacao] || l.forma_liquidacao],
    l.validade && ['Validade da verba', fmtData(l.validade)],
    l.comprovacao && ['Comprovação', COMPROVACAO[l.comprovacao]?.rotulo || l.comprovacao],
    l.excecao && ['Exceção', `${l.justificativa || 'sem justificativa'}${l.autorizado_por ? ` (autorizado por ${l.autorizado_por})` : ''}`],
    l.observacao && ['Observação', l.observacao],
    ['Registrado em', fmtData(l.criado_em?.slice(0, 10))],
  ].filter(Boolean) : [];
  return (
    <Gaveta aberto={Boolean(l)} aoFechar={aoFechar} titulo={l?.descricao} subtitulo={l ? `Lançamento nº ${l.id}` : ''} largura={520}>
      {l && (
        <div className="coluna" style={{ gap: 14 }}>
          <div className="linha" style={{ gap: 8 }}>
            <Selo cor={s.cor} icone={s.icone}>{s.rotulo}</Selo>
            <span className="num forte" style={{ fontSize: 20 }}>{l.natureza === 'credito' ? '+' : '-'} {fmtMoeda(l.valor)}</span>
          </div>
          <dl className="ccr-ficha">
            {linhas.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {l.id_campanha && <a href={`#/campanhas/${l.id_campanha}`}>Abrir a campanha</a>}
        </div>
      )}
    </Gaveta>
  );
}
