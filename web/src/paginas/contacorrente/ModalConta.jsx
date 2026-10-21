import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { get, post, put } from '../../lib/api.js';
import { Alternador, AreaTexto, Botao, Campo, Entrada, EntradaNumero, Modal, Seletor, useToast } from '../../componentes/ui.jsx';
import { EXPLICA, POLITICAS } from './util.js';

/** Cria ou ajusta a conta de um fabricante: política de saldo, limite, acordo, prazos e bloqueio. */
export default function ModalConta({ aberto, conta, aoFechar, aoSalvar }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [fabricantes, setFabricantes] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const nova = !conta;

  useEffect(() => {
    if (!aberto) return;
    setF(conta ? { ...conta } : { fabricante: '', politica: 'confirmado', limite: 0, perc_acordo: 1, validade_meses: 12, prazo_nd_dias: 30, margem_reserva: 20 });
    if (!conta) get('/conta-corrente/fabricantes').then((l) => setFabricantes(l.filter((x) => !x.id_conta))).catch(() => setFabricantes([]));
  }, [aberto, conta]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = nova ? await post('/conta-corrente/contas', f) : await put(`/conta-corrente/contas/${conta.id}`, f);
      toast.ok(nova ? 'Conta criada.' : 'Conta atualizada.');
      aoSalvar?.(r);
      aoFechar();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={nova ? 'Nova conta corrente' : 'Ajustar conta'} subtitulo={conta?.nome} largura={640}
      rodape={(
        <>
          <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="primario" icone={Save} carregando={salvando} disabled={nova && !f.fabricante} onClick={salvar}>Salvar</Botao>
        </>
      )}>
      <div className="coluna" style={{ gap: 14 }}>
        {nova && (
          <Campo rotulo="Fabricante" ajuda="Só aparecem fabricantes da base de produtos que ainda não têm conta.">
            <Seletor valor={f.fabricante} aoMudar={(v) => set('fabricante', v)} vazio="Escolha o fabricante" opcoes={fabricantes.map((x) => ({ valor: x.fabricante, rotulo: x.nome }))} />
          </Campo>
        )}
        <Campo rotulo="O que conta como saldo" info={EXPLICA.politica}>
          <Seletor valor={f.politica} aoMudar={(v) => set('politica', v)} opcoes={Object.entries(POLITICAS).map(([valor, p]) => ({ valor, rotulo: `${p.rotulo}: ${p.texto}` }))} />
        </Campo>
        <div className="grade-2">
          <Campo rotulo="Limite negativo autorizado" info={EXPLICA.limite}>
            <EntradaNumero valor={f.limite} aoMudar={(v) => set('limite', v ?? 0)} sufixo="R$" />
          </Campo>
          <Campo rotulo="Acordo sobre compras" dica="Percentual do contrato anual. Serve de referência para as provisões do mês.">
            <EntradaNumero valor={f.perc_acordo} aoMudar={(v) => set('perc_acordo', v)} sufixo="%" placeholder="sem acordo" />
          </Campo>
          <Campo rotulo="Validade da verba" dica="Por quantos meses um crédito pode ser usado antes de vencer.">
            <EntradaNumero valor={f.validade_meses} aoMudar={(v) => set('validade_meses', v ?? 12)} sufixo="meses" />
          </Campo>
          <Campo rotulo="Prazo da ND" dica="Dias entre a emissão da nota de débito e o abatimento esperado.">
            <EntradaNumero valor={f.prazo_nd_dias} aoMudar={(v) => set('prazo_nd_dias', v ?? 30)} sufixo="dias" />
          </Campo>
          <Campo rotulo="Folga na reserva" dica="Campanha sem orçamento reserva o prêmio projetado mais esta folga.">
            <EntradaNumero valor={f.margem_reserva} aoMudar={(v) => set('margem_reserva', v ?? 20)} sufixo="%" />
          </Campo>
          <Campo rotulo="Gerente de contas">
            <Entrada value={f.responsavel || ''} onChange={(e) => set('responsavel', e.target.value)} placeholder="Quem negocia com a indústria" />
          </Campo>
        </div>
        <Alternador ligado={Boolean(f.bloqueada)} aoMudar={(v) => set('bloqueada', v)} rotulo="Bloquear a conta"
          descricao="Nenhuma campanha nova usa esta verba até desbloquear (ex.: contrato em renegociação)." />
        {f.bloqueada && (
          <Campo rotulo="Motivo do bloqueio">
            <Entrada value={f.motivo_bloqueio || ''} onChange={(e) => set('motivo_bloqueio', e.target.value)} />
          </Campo>
        )}
        <Campo rotulo="Observação">
          <AreaTexto rows={2} value={f.observacao || ''} onChange={(e) => set('observacao', e.target.value)} />
        </Campo>
      </div>
    </Modal>
  );
}
