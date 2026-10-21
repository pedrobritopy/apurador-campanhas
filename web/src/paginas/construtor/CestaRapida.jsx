import { useMemo, useState } from 'react';
import { Lightbulb, ShoppingBasket } from 'lucide-react';
import MultiSelecao from '../../componentes/MultiSelecao.jsx';
import { Alternador, Aviso, Botao, Campo, Modal, Segmentado, useToast } from '../../componentes/ui.jsx';
import { EntradaNumero } from './campos.jsx';
import { post } from '../../lib/api.js';
import { useDimensoes, useProdutos } from '../../lib/dados.js';
import { fmtMoeda } from '../../lib/formato.js';
import { FotoProduto, LogoMarca } from '../../componentes/Imagens.jsx';

/**
 * Cria rapidamente 1 critério por marca/produto, cada um com a própria meta
 * ("cesta": vários produtos ao mesmo tempo com unidades diferentes).
 */
export default function CestaRapida({ aberto, aoFechar, aoCriar, defBase }) {
  const toast = useToast();
  const { dados: dim } = useDimensoes();
  const { dados: produtos } = useProdutos();
  const [modo, setModo] = useState('marcas');
  const [sel, setSel] = useState([]);
  const [metrica, setMetrica] = useState('quantidade');
  const [metas, setMetas] = useState({});
  const [todos, setTodos] = useState(true);
  const [sugerindo, setSugerindo] = useState(false);

  // o fornecedor da campanha vem primeiro na lista
  const fab = defBase?.fabricante;
  const primeiroDoFornecedor = (lista) => (fab ? [...lista.filter((o) => o.fab === fab).map((o) => ({ ...o, grupo: `Do fornecedor (${fab})` })), ...lista.filter((o) => o.fab !== fab).map((o) => ({ ...o, grupo: 'Outros' }))] : lista);
  const opcoes = useMemo(
    () =>
      modo === 'marcas'
        ? primeiroDoFornecedor((dim?.marcas || []).map((m) => ({ valor: m.nome, rotulo: m.nome, icone: <LogoMarca nome={m.nome} tamanho={20} />, detalhe: `${m.fabricante} · ${m.produtos}`, fab: m.fabricante })))
        : primeiroDoFornecedor((produtos || []).map((p) => ({ valor: p.id, rotulo: p.nome, icone: <FotoProduto id={p.id} nome={p.nome} tamanho={22} titulo={false} />, detalhe: `${p.marca} · ${fmtMoeda(p.preco)}`, fab: p.fabricante }))),
    [modo, dim, produtos, fab],
  );
  const rotulo = (v) => opcoes.find((o) => o.valor === v)?.rotulo || String(v);
  const sufixo = metrica === 'valor' ? 'R$' : 'un';

  const criterioDe = (v, meta) => ({
    nome: rotulo(v),
    metrica,
    produtos: modo === 'marcas' ? { marcas: [v] } : { ids: [v] },
    meta,
    gatilho: todos ? 100 : 0,
    teto: 150,
  });

  const sugerir = async () => {
    if (!sel.length) return;
    setSugerindo(true);
    try {
      const definicao = {
        ...defBase,
        nome: 'Sugestão de cesta',
        criterios: sel.map((v, i) => ({ id: `c${i + 1}`, ...criterioDe(v, { tipo: 'sem_meta' }) })),
        premiacao: { tipo: 'nenhuma' },
      };
      const r = await post('/apuracao/previa', { definicao });
      const n = r.resumo.participantes || 1;
      const novas = {};
      r.criterios.forEach((c, i) => {
        const porPart = (c.total.base || 0) / n;
        novas[sel[i]] = metrica === 'valor' ? Math.round(porPart * 1.1) : Math.max(1, Math.ceil(porPart * 1.1));
      });
      setMetas(novas);
      toast.ok('Metas sugeridas: média por participante no período anterior + 10%.');
    } catch (e) {
      toast.erro(`Não foi possível sugerir: ${e.message}`);
    } finally {
      setSugerindo(false);
    }
  };

  const criar = () => {
    const criterios = sel.map((v) => criterioDe(v, { tipo: 'fixa', valor: metas[v] ?? 0 }));
    aoCriar(criterios, { regraTodos: todos });
    setSel([]);
    setMetas({});
    aoFechar();
  };

  const faltandoMeta = sel.filter((v) => !(metas[v] > 0)).length;
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} largura={760} titulo="Cesta rápida"
      subtitulo="Um critério por item, cada um com a própria meta. Ex.: Tylenol 50 un + Listerine 35 un + Band-Aid 35 un."
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="primario" icone={ShoppingBasket} disabled={!sel.length} onClick={criar}>Criar {sel.length || ''} critério{sel.length === 1 ? '' : 's'}</Botao>
        </>
      }>
      <div className="coluna cons-modal" style={{ gap: 14 }}>
        <div className="cons-linha">
          <Campo rotulo="Um critério por">
            <Segmentado valor={modo} aoMudar={(v) => { setModo(v); setSel([]); setMetas({}); }} opcoes={[{ valor: 'marcas', rotulo: 'Marca' }, { valor: 'produtos', rotulo: 'Produto (SKU)' }]} />
          </Campo>
          <Campo rotulo="Medir">
            <Segmentado valor={metrica} aoMudar={(v) => { setMetrica(v); setMetas({}); }} opcoes={[{ valor: 'quantidade', rotulo: 'Unidades' }, { valor: 'valor', rotulo: 'Faturamento' }]} />
          </Campo>
        </div>
        <Campo rotulo={modo === 'marcas' ? 'Marcas da cesta' : 'Produtos da cesta'}>
          <MultiSelecao opcoes={opcoes} valores={sel} aoMudar={setSel} placeholder={modo === 'marcas' ? 'Ex.: Tylenol, Listerine, Band-Aid…' : 'Busque pelo nome do produto…'} />
        </Campo>
        {sel.length > 0 && (
          <>
            <div className="linha entre">
              <span className="cons-subcampo-titulo">Meta de cada item (por participante)</span>
              <Botao tamanho="p" variante="sutil" icone={Lightbulb} carregando={sugerindo} onClick={sugerir}>Sugerir pelo mês anterior</Botao>
            </div>
            <table className="cons-tabela">
              <tbody>
                {sel.map((v) => (
                  <tr key={String(v)}>
                    <td><span className="truncar" style={{ display: 'block', maxWidth: 420 }}>{rotulo(v)}</span></td>
                    <td style={{ width: 170 }}>
                      <EntradaNumero tamanho="p" valor={metas[v] ?? null} aoMudar={(x) => setMetas((m) => ({ ...m, [v]: x }))} sufixo={sufixo} placeholder="meta" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <Alternador ligado={todos} aoMudar={setTodos} rotulo="Exigir todas as metas da cesta"
          descricao="Regra 'todos': só é premiado quem atingir 100% em cada item. Desligado, vale a média ponderada." />
        {sel.length > 0 && faltandoMeta > 0 && <Aviso tipo="aviso">{faltandoMeta} ite{faltandoMeta === 1 ? 'm está' : 'ns estão'} sem meta. Preencha ou use a sugestão.</Aviso>}
      </div>
    </Modal>
  );
}
