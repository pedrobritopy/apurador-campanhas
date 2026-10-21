import { Link2, Plus, Trash2 } from 'lucide-react';
import { Botao, BotaoIcone, Campo, Entrada, Segmentado } from '../../componentes/ui.jsx';
import { EntradaNumero } from './campos.jsx';
import SeletorProdutos from './SeletorProdutos.jsx';
import { SELETOR_VAZIO } from './util.js';

/** Venda casada / kit: itens com quantidade mínima; escopo pedido ou cliente; conta ocorrências ou kits. */
export default function EditorCombo({ combo, aoMudar, fabricante }) {
  const set = (k, v) => aoMudar({ ...combo, [k]: v });
  const mudarItem = (i, k, v) => set('itens', combo.itens.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <div className="coluna" style={{ gap: 12 }}>
      <div className="cons-linha">
        <Campo rotulo="Onde os itens precisam aparecer juntos" dica="No mesmo pedido: o kit precisa sair numa nota só. No mesmo cliente: basta o cliente ter comprado todos os itens durante o período, em pedidos diferentes.">
          <Segmentado valor={combo.escopo} aoMudar={(v) => set('escopo', v)}
            opcoes={[{ valor: 'pedido', rotulo: 'No mesmo pedido' }, { valor: 'cliente', rotulo: 'No mesmo cliente (período)' }]} />
        </Campo>
        <Campo rotulo="O que contar" dica="Ocorrências: cada pedido/cliente com o kit completo vale 1. Kits: quantos kits completos cabem (ex.: 4 Engov + 2 Epocler = 2 kits de 2+1).">
          <Segmentado valor={combo.contar} aoMudar={(v) => set('contar', v)}
            opcoes={[{ valor: 'ocorrencias', rotulo: combo.escopo === 'cliente' ? 'Clientes com o kit' : 'Pedidos com o kit' }, { valor: 'kits', rotulo: 'Kits completos' }]} />
        </Campo>
      </div>
      {combo.itens.map((it, i) => (
        <div key={i} className="cons-subcampo">
          <div className="linha">
            <span className="cons-subcampo-titulo"><Link2 size={13} /> Item {i + 1}</span>
            <span className="cresce" />
            {combo.itens.length > 1 && <BotaoIcone icone={Trash2} rotulo="Remover item" tamanho="p" onClick={() => set('itens', combo.itens.filter((_, j) => j !== i))} />}
          </div>
          <div className="cons-linha dupla">
            <Campo rotulo="Nome do item">
              <Entrada value={it.nome} onChange={(e) => mudarItem(i, 'nome', e.target.value)} placeholder="Ex.: Engov" />
            </Campo>
            <Campo rotulo="Quantidade mínima" dica="Quantas unidades deste item precisam estar no pedido (ou no cliente) para o kit valer.">
              <EntradaNumero valor={it.minimo} aoMudar={(v) => mudarItem(i, 'minimo', Math.max(1, Math.round(v || 1)))} sufixo="un" />
            </Campo>
          </div>
          <SeletorProdutos valor={it.produtos} aoMudar={(v) => mudarItem(i, 'produtos', v)} fabricante={fabricante} compacto />
        </div>
      ))}
      <div>
        <Botao tamanho="p" icone={Plus} onClick={() => set('itens', [...combo.itens, { nome: `Item ${combo.itens.length + 1}`, minimo: 1, produtos: fabricante ? { ...SELETOR_VAZIO(), fabricantes: [fabricante] } : SELETOR_VAZIO() }])}>
          Adicionar item ao kit
        </Botao>
      </div>
    </div>
  );
}
