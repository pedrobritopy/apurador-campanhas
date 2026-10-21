import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Save } from 'lucide-react';
import { post } from '../../lib/api.js';
import { fmtMoeda } from '../../lib/formato.js';
import { AreaTexto, Aviso, Botao, Campo, Entrada, EntradaNumero, Modal, Segmentado, Seletor, useToast } from '../../componentes/ui.jsx';
import { bloqueioContaCorrente } from './ModalExcecao.jsx';
import { COMPROVACAO, EXPLICA, FORMAS, ORIGENS } from './util.js';

const hoje = () => new Date().toISOString().slice(0, 10);
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fimDoMesDepois = (iso, meses) => {
  const [a, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + meses + 1, 0)).toISOString().slice(0, 10);
};

/** Novo lançamento manual: aporte, ND, VPC, bonificação, rebaixa, ação comercial, desconto repassado ou ajuste. */
export default function ModalLancamento({ aberto, conta, aoFechar, aoSalvar }) {
  const toast = useToast();
  const [natureza, setNatureza] = useState('credito');
  const [f, setF] = useState({});
  const [bloqueio, setBloqueio] = useState(null);
  const [exc, setExc] = useState({ justificativa: '', autorizado_por: '' });
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const origens = useMemo(() => Object.entries(ORIGENS)
    .filter(([k, o]) => k !== 'estorno' && k !== 'expiracao' && (o.natureza === natureza || o.natureza === null))
    .filter(([k]) => k !== 'orcamento' || conta?.propria)
    .map(([valor, o]) => ({ valor, rotulo: valor === 'campanha' ? 'Campanha fora do sistema' : o.rotulo })), [natureza, conta]);

  useEffect(() => {
    if (!aberto) return;
    setNatureza('credito');
    setBloqueio(null);
    setExc({ justificativa: '', autorizado_por: '' });
    setF({ origem: conta?.propria ? 'orcamento' : 'nd', valor: null, data: hoje(), situacao: 'a_receber', descricao: '', documento: '', forma_liquidacao: 'abatimento_duplicata', comprovacao: 'pendente' });
  }, [aberto, conta]);

  useEffect(() => {
    if (!aberto) return;
    if (!origens.some((o) => o.valor === f.origem)) set('origem', origens[0]?.valor);
    set('situacao', natureza === 'credito' ? 'a_receber' : 'realizado');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natureza]);

  if (!conta) return null;
  const origem = ORIGENS[f.origem] || {};
  const credito = natureza === 'credito';
  const vencimentoPadrao = somarDias(f.data || hoje(), conta.prazo_nd_dias || 30);
  const validadePadrao = fimDoMesDepois(f.data || hoje(), conta.validade_meses || 12);

  const salvar = async (comExcecao) => {
    if (!(f.valor > 0)) { toast.erro('Informe o valor.'); return; }
    setSalvando(true);
    try {
      await post(`/conta-corrente/contas/${conta.id}/lancamentos`, {
        ...f, natureza, vencimento: f.vencimento || undefined, validade: f.validade || undefined,
        ...(comExcecao ? { excecao: exc } : {}),
      });
      toast.ok('Lançamento registrado.');
      aoSalvar?.();
      aoFechar();
    } catch (e) {
      const b = bloqueioContaCorrente(e);
      if (b) setBloqueio(b);
      else toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Novo lançamento" subtitulo={conta.nome} largura={640}
      rodape={(
        <>
          <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
          {bloqueio
            ? <Botao variante="perigo" disabled={exc.justificativa.trim().length < 10} carregando={salvando} onClick={() => salvar(true)}>Lançar com exceção</Botao>
            : <Botao variante="primario" icone={Save} carregando={salvando} onClick={() => salvar(false)}>Lançar</Botao>}
        </>
      )}>
      <div className="coluna" style={{ gap: 14 }}>
        <Segmentado valor={natureza} aoMudar={setNatureza}
          opcoes={[
            { valor: 'credito', rotulo: 'Entrada de verba', icone: ArrowDownLeft },
            { valor: 'debito', rotulo: 'Uso de verba', icone: ArrowUpRight },
          ]} />
        <div className="grade-2">
          <Campo rotulo="Tipo" info={{ texto: origem.texto || 'Escolha o tipo do lançamento.' }}>
            <Seletor valor={f.origem} aoMudar={(v) => set('origem', v)} opcoes={origens} />
          </Campo>
          <Campo rotulo="Valor">
            <EntradaNumero valor={f.valor} aoMudar={(v) => set('valor', v)} sufixo="R$" placeholder="0,00" />
          </Campo>
        </div>
        {origem.texto && <div className="mudo pequeno" style={{ marginTop: -6 }}>{origem.texto}</div>}
        <Campo rotulo="Descrição" ajuda="Como vai aparecer no extrato.">
          <Entrada value={f.descricao ?? ''} onChange={(e) => set('descricao', e.target.value)} placeholder={credito ? 'Ex.: Verba de aniversário da distribuidora' : 'Ex.: Tabloide de novembro nas redes associativistas'} />
        </Campo>
        <div className="grade-2">
          <Campo rotulo="Data (competência)" dica="Mês a que o lançamento pertence. Para acordo, o mês das compras.">
            <Entrada type="date" value={f.data || ''} onChange={(e) => set('data', e.target.value)} />
          </Campo>
          <Campo rotulo="Documento" dica="Número da ND, contrato, nota de bonificação ou protocolo.">
            <Entrada value={f.documento ?? ''} onChange={(e) => set('documento', e.target.value)} placeholder={credito ? 'ND 000123/2026' : 'Contrato ou protocolo'} />
          </Campo>
        </div>

        {credito ? (
          <>
            <Campo rotulo="Situação" info={{ texto: 'Em que pé está a verba.', como: ['Previsto: combinado, sem ND ainda.', 'ND a receber: ND emitida, aguardando abatimento ou pagamento.', 'Recebido: já abatido na duplicata, depositado ou entregue em mercadoria.'] }}>
              <Segmentado valor={f.situacao} aoMudar={(v) => set('situacao', v)}
                opcoes={[{ valor: 'previsto', rotulo: 'Previsto' }, { valor: 'a_receber', rotulo: 'ND a receber' }, { valor: 'realizado', rotulo: 'Recebido' }]} />
            </Campo>
            <div className="grade-2">
              {f.situacao === 'a_receber' && (
                <Campo rotulo="Vencimento da ND" ajuda={`Padrão da conta: ${conta.prazo_nd_dias} dias.`}>
                  <Entrada type="date" value={f.vencimento || vencimentoPadrao} onChange={(e) => set('vencimento', e.target.value)} />
                </Campo>
              )}
              {f.situacao === 'realizado' && (
                <Campo rotulo="Como entrou">
                  <Seletor valor={f.forma_liquidacao} aoMudar={(v) => set('forma_liquidacao', v)} opcoes={Object.entries(FORMAS).map(([valor, rotulo]) => ({ valor, rotulo }))} />
                </Campo>
              )}
              <Campo rotulo="Validade da verba" info={{ texto: EXPLICA.vencendo.texto }} ajuda={`Padrão: ${conta.validade_meses} meses.`}>
                <Entrada type="date" value={f.validade || validadePadrao} onChange={(e) => set('validade', e.target.value)} />
              </Campo>
            </div>
          </>
        ) : (
          <div className="grade-2">
            <Campo rotulo="Situação" info={{ texto: 'Realizado sai do saldo. Previsto fica comprometido (como uma reserva) até virar realizado.' }}>
              <Segmentado valor={f.situacao} aoMudar={(v) => set('situacao', v)} opcoes={[{ valor: 'realizado', rotulo: 'Realizado' }, { valor: 'previsto', rotulo: 'Comprometido' }]} />
            </Campo>
            {['campanha', 'acao_trade'].includes(f.origem) && (
              <Campo rotulo="Comprovação" info={EXPLICA.comprovacao}>
                <Seletor valor={f.comprovacao} aoMudar={(v) => set('comprovacao', v)} opcoes={Object.entries(COMPROVACAO).map(([valor, c]) => ({ valor, rotulo: c.rotulo }))} />
              </Campo>
            )}
          </div>
        )}
        <Campo rotulo="Observação">
          <AreaTexto rows={2} value={f.observacao || ''} onChange={(e) => set('observacao', e.target.value)} />
        </Campo>

        {bloqueio && (
          <div className="coluna" style={{ gap: 10 }}>
            <Aviso tipo="erro" titulo="Sem saldo para este débito">
              Disponível {fmtMoeda(bloqueio.capacidade)}, o lançamento precisa de {fmtMoeda(bloqueio.necessario)}. Para lançar mesmo assim, registre a exceção.
            </Aviso>
            <Campo rotulo="Justificativa da exceção" info={EXPLICA.excecao}>
              <AreaTexto rows={2} value={exc.justificativa} onChange={(e) => setExc((x) => ({ ...x, justificativa: e.target.value }))} />
            </Campo>
            <Campo rotulo="Autorizado por">
              <Entrada value={exc.autorizado_por} onChange={(e) => setExc((x) => ({ ...x, autorizado_por: e.target.value }))} />
            </Campo>
          </div>
        )}
      </div>
    </Modal>
  );
}
