import { useEffect, useMemo, useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, post, put, useApi } from '../../lib/api.js';
import { useAtrasado } from '../../lib/anim.js';
import { invalidarRecurso, useDimensoes, useProdutos } from '../../lib/dados.js';
import { fmtNumero } from '../../lib/formato.js';
import {
  AreaTexto, Aviso, Botao, BotaoIcone, Campo, Cartao, Carregando, Entrada, ErroCarga, Modal, Selo, Vazio, useToast,
} from '../../componentes/ui.jsx';
import MultiSelecao from '../../componentes/MultiSelecao.jsx';
import { useConfirmar } from './Confirmar.jsx';
import CampoGrupo from './CampoGrupo.jsx';

const SELETOR_VAZIO = { fabricantes: [], marcas: [], subcategorias: [], grupos: [], ids: [], excluir: [] };
const normSel = (s) => ({ ...SELETOR_VAZIO, ...(s || {}) });

function resumoSeletor(s, produtosPorId) {
  const sel = normSel(s);
  const partes = [];
  if (sel.fabricantes.length) partes.push(...sel.fabricantes.map((x) => ({ t: x, tipo: 'Fabricante' })));
  if (sel.marcas.length) partes.push(...sel.marcas.map((x) => ({ t: x, tipo: 'Marca' })));
  if (sel.subcategorias.length) partes.push(...sel.subcategorias.map((x) => ({ t: x, tipo: 'Subcategoria' })));
  if (sel.ids.length) partes.push(...sel.ids.slice(0, 4).map((id) => ({ t: produtosPorId.get(Number(id))?.nome || `#${id}`, tipo: 'Produto' })));
  if (sel.ids.length > 4) partes.push({ t: `+${sel.ids.length - 4} produtos`, tipo: '' });
  if (sel.excluir.length) partes.push({ t: `exceto ${sel.excluir.length}`, tipo: '' });
  return partes;
}

function EditorGrupo({ inicial, aoFechar, aoSalvar }) {
  const { dados: dim } = useDimensoes();
  const { dados: produtos } = useProdutos();
  const [g, setG] = useState(() => ({ nome: inicial?.nome || '', descricao: inicial?.descricao || '', seletor: normSel(inicial?.seletor) }));
  const [contagem, setContagem] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const selAtrasado = useAtrasado(g.seletor, 400);

  useEffect(() => {
    let vivo = true;
    post('/produtos/resolver', { seletor: selAtrasado })
      .then((r) => vivo && setContagem(r))
      .catch(() => vivo && setContagem(null));
    return () => { vivo = false; };
  }, [selAtrasado]);

  const ops = useMemo(() => ({
    fabricantes: (dim?.fabricantes || []).map((f) => ({ valor: f.nome, rotulo: f.nome, detalhe: `${f.produtos} produtos` })),
    marcas: (dim?.marcas || []).map((m) => ({ valor: m.nome, rotulo: m.nome, detalhe: m.fabricante })),
    subcategorias: (dim?.subcategorias || []).map((s) => ({ valor: s.nome, rotulo: s.nome, detalhe: `${s.produtos} produtos` })),
    produtos: (produtos || []).map((p) => ({ valor: p.id, rotulo: p.nome, detalhe: p.marca })),
  }), [dim, produtos]);

  const setSel = (k) => (v) => setG((x) => ({ ...x, seletor: { ...x.seletor, [k]: v } }));
  const vazio = !g.seletor.fabricantes.length && !g.seletor.marcas.length && !g.seletor.subcategorias.length && !g.seletor.ids.length;

  async function salvar() {
    setSalvando(true);
    try {
      await aoSalvar({ nome: g.nome.trim(), descricao: g.descricao.trim(), seletor: g.seletor });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto aoFechar={aoFechar} largura={720} titulo={inicial?.id ? 'Editar linha de produtos' : 'Nova linha de produtos'}
      subtitulo="Grupos reutilizáveis nas campanhas (ex.: “Linha Dor” = Dorflex + Novalgina + Neosaldina)."
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" carregando={salvando} disabled={!g.nome.trim() || vazio} onClick={salvar}>Salvar</Botao></>}>
      {!dim ? <Carregando altura={200} /> : (
        <div className="coluna" style={{ gap: 14 }}>
          <div className="config-linha-2">
            <Campo rotulo="Nome"><Entrada value={g.nome} placeholder="Linha Dor" onChange={(e) => setG({ ...g, nome: e.target.value })} /></Campo>
            <Campo rotulo="Descrição (opcional)"><Entrada value={g.descricao} onChange={(e) => setG({ ...g, descricao: e.target.value })} /></Campo>
          </div>
          <Aviso tipo="info">Filtros se combinam com <strong>E</strong> (ex.: fabricante Sanofi E subcategoria Analgésicos). Produtos avulsos são <strong>somados</strong> ao resultado.</Aviso>
          <CampoGrupo rotulo="Fabricantes"><MultiSelecao opcoes={ops.fabricantes} valores={g.seletor.fabricantes} aoMudar={setSel('fabricantes')} placeholder="Todos" /></CampoGrupo>
          <CampoGrupo rotulo="Marcas"><MultiSelecao opcoes={ops.marcas} valores={g.seletor.marcas} aoMudar={setSel('marcas')} placeholder="Todas" /></CampoGrupo>
          <CampoGrupo rotulo="Subcategorias"><MultiSelecao opcoes={ops.subcategorias} valores={g.seletor.subcategorias} aoMudar={setSel('subcategorias')} placeholder="Todas" /></CampoGrupo>
          <CampoGrupo rotulo="Produtos avulsos (somados)"><MultiSelecao opcoes={ops.produtos} valores={g.seletor.ids} aoMudar={setSel('ids')} placeholder="Buscar produto…" /></CampoGrupo>
          <CampoGrupo rotulo="Excluir produtos"><MultiSelecao opcoes={ops.produtos} valores={g.seletor.excluir} aoMudar={setSel('excluir')} placeholder="Nenhum" /></CampoGrupo>
          <div className="linha quebra g4">
            {vazio ? <span className="mini mudo">Escolha ao menos um filtro ou produto.</span> : contagem ? (
              <>
                <Selo cor="acento">{fmtNumero(contagem.total)} produtos</Selo>
                {(contagem.produtos || []).slice(0, 6).map((p) => <Selo key={p.id} cor="contorno">{p.nome}</Selo>)}
                {contagem.total > 6 && <span className="mini mudo">…</span>}
              </>
            ) : <span className="mini mudo">Contando produtos…</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ConfigGrupos() {
  const toast = useToast();
  const [confirmar, dialogo] = useConfirmar();
  const { dados: grupos, erro, recarregar } = useApi('/grupos');
  const { dados: produtos } = useProdutos();
  const [editando, setEditando] = useState(null);
  const porId = useMemo(() => new Map((produtos || []).map((p) => [Number(p.id), p])), [produtos]);

  const aposMudar = () => {
    recarregar();
    invalidarRecurso('/dimensoes');
  };

  async function salvar(dados) {
    try {
      if (editando?.id) await put(`/grupos/${editando.id}`, dados);
      else await post('/grupos', dados);
      toast.ok('Linha de produtos salva');
      setEditando(null);
      aposMudar();
    } catch (e) {
      toast.erro(e.message);
    }
  }

  async function excluir(g) {
    if (!(await confirmar({ titulo: `Excluir “${g.nome}”?`, texto: 'Campanhas que usam esta linha passam a não encontrar os produtos dela.', rotulo: 'Excluir', perigo: true }))) return;
    try {
      await del(`/grupos/${g.id}`);
      toast.ok('Linha excluída');
      aposMudar();
    } catch (e) {
      toast.erro(e.message);
    }
  }

  if (erro && !grupos) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (!grupos) return <Carregando />;

  return (
    <div className="coluna" style={{ gap: 14 }}>
      {dialogo}
      <div className="linha entre quebra">
        <div className="sec pequeno" style={{ maxWidth: 720 }}>
          Monte linhas de produtos uma vez e use em qualquer campanha ou fórmula (<span className="mono">qtd{'{'}grupo: "Linha Dor"{'}'}</span>). Venda da mesma linha em quantidade ou valor vira um clique.
        </div>
        <Botao variante="primario" icone={Plus} onClick={() => setEditando({})}>Nova linha</Botao>
      </div>
      {!grupos.length ? (
        <Cartao><Vazio icone={Layers} titulo="Nenhuma linha de produtos" texto="Crie, por exemplo, “Linha Dor”, “Vitaminas foco” ou “Lançamentos do trimestre”." acao={<Botao variante="primario" icone={Plus} onClick={() => setEditando({})}>Criar linha</Botao>} /></Cartao>
      ) : (
        <div className="grade-auto escalonado">
          {grupos.map((g) => {
            const sel = typeof g.seletor === 'string' ? (() => { try { return JSON.parse(g.seletor); } catch { return {}; } })() : g.seletor;
            return (
              <div key={g.id} className="cartao grupo-cartao">
                <div className="linha entre" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="forte truncar">{g.nome}</div>
                    {g.descricao && <div className="mini mudo truncar">{g.descricao}</div>}
                  </div>
                  <div className="linha g4">
                    <BotaoIcone icone={Pencil} rotulo="Editar" tamanho="p" onClick={() => setEditando({ ...g, seletor: sel })} />
                    <BotaoIcone icone={Trash2} rotulo="Excluir" tamanho="p" onClick={() => excluir(g)} />
                  </div>
                </div>
                <div><Selo cor="acento">{fmtNumero(g.n_produtos ?? 0)} produtos</Selo></div>
                <div className="tags">
                  {resumoSeletor(sel, porId).map((p, i) => <Selo key={i} cor="contorno" title={p.tipo}>{p.t}</Selo>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editando && <EditorGrupo inicial={editando} aoFechar={() => setEditando(null)} aoSalvar={salvar} />}
    </div>
  );
}
