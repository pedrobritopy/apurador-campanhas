import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Package, SlidersHorizontal } from 'lucide-react';
import MultiSelecao from '../../componentes/MultiSelecao.jsx';
import { Botao, Campo } from '../../componentes/ui.jsx';
import { useDimensoes, useProdutos } from '../../lib/dados.js';
import { fmtMoeda, fmtNumero } from '../../lib/formato.js';
import { resolverSeletorLocal, seletorVazio } from './util.js';
import { FotoProduto, LogoFabricante, LogoMarca } from '../../componentes/Imagens.jsx';

/**
 * Seletor de produtos de um critério.
 * Filtros (fabricante, marca, subcategoria) combinam com E; linhas salvas e avulsos somam; exceções removem.
 * A contagem é resolvida localmente (mesma regra do servidor), então responde na hora.
 */
export default function SeletorProdutos({ valor, aoMudar, rotuloTodos = 'Todos os produtos', compacto = false, fabricante = null }) {
  const { dados: dim } = useDimensoes();
  const { dados: produtos } = useProdutos();
  const [ajuste, setAjuste] = useState(Boolean(valor.ids?.length || valor.excluir?.length));
  const [verLista, setVerLista] = useState(false);
  const set = (k, v) => aoMudar({ ...valor, [k]: v });
  const grupos = dim?.grupos || [];

  // o fornecedor da campanha (e o que é dele) aparece primeiro em cada lista
  const opFab = useMemo(() => {
    const lista = (dim?.fabricantes || []).map((f) => ({ valor: f.nome, rotulo: f.nome, icone: <LogoFabricante nome={f.nome} tamanho={20} />, detalhe: `${f.produtos} prod.`, grupo: fabricante ? (f.nome === fabricante ? 'Fornecedor da campanha' : 'Outros fabricantes') : undefined }));
    return fabricante ? [...lista.filter((o) => o.valor === fabricante), ...lista.filter((o) => o.valor !== fabricante)] : lista;
  }, [dim, fabricante]);
  const opMarca = useMemo(() => {
    const fabs = new Set(valor.fabricantes);
    const primeiro = !fabs.size && fabricante;
    return (dim?.marcas || [])
      .filter((m) => !fabs.size || fabs.has(m.fabricante))
      .sort((a, b) => (primeiro ? (b.fabricante === fabricante) - (a.fabricante === fabricante) : 0) || (fabs.size > 1 ? a.fabricante.localeCompare(b.fabricante) : 0) || a.nome.localeCompare(b.nome))
      .map((m) => ({
        valor: m.nome,
        rotulo: m.nome,
        icone: <LogoMarca nome={m.nome} tamanho={20} />,
        detalhe: `${fabs.size === 1 ? '' : `${m.fabricante} · `}${m.produtos}`,
        grupo: fabs.size > 1 ? m.fabricante : primeiro ? (m.fabricante === fabricante ? `Marcas ${fabricante}` : 'Outras marcas') : undefined,
      }));
  }, [dim, valor.fabricantes, fabricante]);
  const opSub = useMemo(() => {
    // subcategorias em que o(s) fabricante(s) escolhido(s) têm produto vêm primeiro, com a contagem deles
    const fabs = valor.fabricantes.length ? new Set(valor.fabricantes) : fabricante ? new Set([fabricante]) : null;
    const lista = (dim?.subcategorias || []).map((s) => {
      const nDoFab = fabs ? (produtos || []).filter((p) => p.subcategoria === s.nome && fabs.has(p.fabricante)).length : 0;
      return { valor: s.nome, rotulo: s.nome, detalhe: fabs ? `${nDoFab} de ${s.produtos}` : `${s.produtos}`, grupo: fabs ? (nDoFab ? 'Onde o fornecedor tem produtos' : 'Outras subcategorias') : undefined, n: nDoFab };
    });
    return fabs ? [...lista.filter((o) => o.n), ...lista.filter((o) => !o.n)] : lista;
  }, [dim, produtos, valor.fabricantes, fabricante]);
  const opGrupos = useMemo(() => grupos.map((g) => ({ valor: g.id, rotulo: g.nome, detalhe: `${g.n_produtos} prod.` })), [grupos]);
  const opProdutos = useMemo(() => (produtos || []).map((p) => ({ valor: p.id, rotulo: p.nome, icone: <FotoProduto id={p.id} nome={p.nome} tamanho={22} titulo={false} />, detalhe: `${p.marca} · ${fmtMoeda(p.preco)}` })), [produtos]);

  const ids = useMemo(() => resolverSeletorLocal(valor, produtos || [], grupos), [valor, produtos, grupos]);
  const escopoSemExcecao = useMemo(() => new Set(resolverSeletorLocal({ ...valor, excluir: [] }, produtos || [], grupos)), [valor, produtos, grupos]);
  const opExcluir = useMemo(() => opProdutos.filter((o) => escopoSemExcecao.has(o.valor) || valor.excluir.includes(o.valor)), [opProdutos, escopoSemExcecao, valor.excluir]);
  const porId = useMemo(() => new Map((produtos || []).map((p) => [p.id, p])), [produtos]);
  const vazio = seletorVazio(valor);
  const amostra = ids.slice(0, 3).map((id) => porId.get(id)?.nome).filter(Boolean);

  return (
    <div className="cons-produtos">
      <div className="cons-produtos-grade" style={compacto ? { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' } : undefined}>
        <Campo rotulo="Fabricantes" dica="Conta todos os produtos destes fabricantes. Vazio = qualquer fabricante.">
          <MultiSelecao opcoes={opFab} valores={valor.fabricantes} aoMudar={(v) => set('fabricantes', v)} placeholder="Todos" />
        </Campo>
        <Campo rotulo="Marcas" dica="Refina para marcas específicas (ex.: só Sensodyne dentro da Haleon). Vazio = todas as marcas.">
          <MultiSelecao opcoes={opMarca} valores={valor.marcas} aoMudar={(v) => set('marcas', v)} placeholder="Todas" />
        </Campo>
        <Campo rotulo="Subcategorias" dica="Refina por tipo de produto (ex.: Analgésicos e Antitérmicos). Vazio = todas.">
          <MultiSelecao opcoes={opSub} valores={valor.subcategorias} aoMudar={(v) => set('subcategorias', v)} placeholder="Todas" />
        </Campo>
        {opGrupos.length > 0 && (
          <Campo rotulo="Linhas salvas" dica="Grupos de produtos cadastrados (ex.: Linha Dor). Somam-se aos filtros.">
            <MultiSelecao opcoes={opGrupos} valores={valor.grupos} aoMudar={(v) => set('grupos', v)} placeholder="Nenhuma" />
          </Campo>
        )}
      </div>

      {ajuste && (
        <div className="cons-produtos-grade">
          <Campo rotulo="Incluir produtos avulsos" ajuda="Somam-se ao que os filtros acima selecionam.">
            <MultiSelecao opcoes={opProdutos} valores={valor.ids} aoMudar={(v) => set('ids', v)} placeholder="Buscar produto ou código…" />
          </Campo>
          <Campo rotulo="Excluir produtos" ajuda="Retira produtos específicos do escopo.">
            <MultiSelecao opcoes={opExcluir} valores={valor.excluir} aoMudar={(v) => set('excluir', v)} placeholder="Nenhuma exceção" />
          </Campo>
        </div>
      )}

      <div className="cons-produtos-resumo">
        <span className="cons-contagem" title="Produtos que entram neste critério">
          <Package size={12} />
          {vazio ? rotuloTodos : `${fmtNumero(ids.length)} produto${ids.length === 1 ? '' : 's'}`}
        </span>
        {!vazio && amostra.length > 0 && (
          <span className="mudo truncar" style={{ maxWidth: 420 }}>
            {amostra.join(' · ')}
            {ids.length > 3 ? ' …' : ''}
          </span>
        )}
        {!vazio && ids.length === 0 && <span style={{ color: 'var(--critico-texto)' }}>Nenhum produto atende a esses filtros juntos.</span>}
        <span className="cresce" />
        <Botao variante="fantasma" tamanho="p" icone={SlidersHorizontal} onClick={() => setAjuste((a) => !a)}>
          {ajuste ? 'Ocultar ajuste fino' : 'Avulsos e exceções'}
        </Botao>
        {!vazio && ids.length > 0 && (
          <Botao variante="fantasma" tamanho="p" iconeDireita={verLista ? ChevronUp : ChevronDown} onClick={() => setVerLista((v) => !v)}>
            Ver lista
          </Botao>
        )}
      </div>

      {verLista && (
        <div className="cons-produtos-lista">
          {ids.slice(0, 300).map((id) => {
            const p = porId.get(id);
            return (
              <div key={id}>
                <FotoProduto id={id} nome={p?.nome} tamanho={28} />
                <span className="truncar cresce">{p?.nome || `#${id}`}</span>
                <span className="mudo" style={{ flex: 'none' }}>
                  {p?.marca} · {fmtMoeda(p?.preco)}
                </span>
              </div>
            );
          })}
          {ids.length > 300 && <div className="mudo">… e mais {fmtNumero(ids.length - 300)}</div>}
        </div>
      )}
    </div>
  );
}
