import { useMemo, useState } from 'react';
import { BookMarked, Library, Play, Rocket, Save, Search, Sparkles, Trash2, User } from 'lucide-react';
import {
  Aviso, AreaTexto, Botao, Campo, Carregando, Chip, Entrada, ErroCarga, Menu, Modal, Segmentado, Selo, Vazio, useToast,
} from '../../componentes/ui.jsx';
import { del, post, useApi } from '../../lib/api.js';

const FORMATO = { numero: 'Número', moeda: 'R$', perc: '%', decimal: 'Decimal' };
const ORIGEM = {
  sistema: { rotulo: 'Pronta', cor: 'neutro', icone: BookMarked },
  usuario: { rotulo: 'Minha', cor: 'acento', icone: User },
  ia: { rotulo: 'Criada com IA', cor: 'acento', icone: Sparkles },
};

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function useFormulas() {
  return useApi('/formulas');
}

/** Aba "Minhas fórmulas": prontas + do usuário, com busca, categorias e ações. */
export default function BibliotecaFormulas({ aoAbrir, aoUsarEmCampanha }) {
  const toast = useToast();
  const { dados, erro, carregando, recarregar } = useFormulas();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [categoria, setCategoria] = useState(null);
  const lista = dados || [];
  const categorias = useMemo(() => [...new Set(lista.map((f) => f.categoria).filter(Boolean))].sort(), [lista]);
  const visiveis = lista.filter((f) =>
    (filtro === 'todas' || (filtro === 'minhas' ? f.origem !== 'sistema' : f.origem === 'sistema'))
    && (!categoria || f.categoria === categoria)
    && (!busca.trim() || sem(`${f.nome} ${f.descricao} ${f.expressao} ${f.categoria}`).includes(sem(busca))));
  const minhas = lista.filter((f) => f.origem !== 'sistema').length;

  const excluir = async (f) => {
    if (!window.confirm(`Excluir a fórmula "${f.nome}"?`)) return;
    try {
      await del(`/formulas/${f.id}`);
      toast.ok('Fórmula excluída.');
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    }
  };

  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (carregando && !dados) return <Carregando altura={240} />;
  return (
    <div className="coluna" style={{ gap: 14 }}>
      <div className="linha entre quebra" style={{ gap: 10 }}>
        <div className="linha quebra" style={{ gap: 10 }}>
          <Segmentado tamanho="p" valor={filtro} aoMudar={setFiltro}
            opcoes={[{ valor: 'todas', rotulo: `Todas (${lista.length})` }, { valor: 'minhas', rotulo: `Minhas (${minhas})` }, { valor: 'prontas', rotulo: `Prontas (${lista.length - minhas})` }]} />
          <div style={{ width: 280 }}><Entrada icone={Search} tamanho="p" placeholder="Buscar fórmula…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        </div>
        <span className="mini mudo">Fórmulas salvas aparecem no construtor de campanhas (métrica "Fórmula personalizada" → Fórmulas salvas).</span>
      </div>
      <div className="linha quebra" style={{ gap: 6 }}>
        <Chip ativo={!categoria} onClick={() => setCategoria(null)}>Todas as categorias</Chip>
        {categorias.map((c) => <Chip key={c} ativo={categoria === c} onClick={() => setCategoria(categoria === c ? null : c)}>{c}</Chip>)}
      </div>
      {!visiveis.length ? (
        <Vazio icone={Library} titulo={filtro === 'minhas' ? 'Você ainda não salvou fórmulas' : 'Nada encontrado'}
          texto="No playground, escreva ou peça para a IA montar uma fórmula e clique em “Salvar fórmula”." />
      ) : (
        <div className="grade-auto escalonado">
          {visiveis.map((f) => {
            const o = ORIGEM[f.origem] || ORIGEM.usuario;
            return (
              <div key={f.id} className="cat-exemplo bib-formula">
                <div className="linha entre" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <span className="forte pequeno">{f.nome}</span>
                  <Selo cor={o.cor} icone={o.icone}>{o.rotulo}</Selo>
                </div>
                {f.descricao && <span className="mini sec">{f.descricao}</span>}
                <code className="cat-formula">{f.expressao}</code>
                <div className="linha entre" style={{ gap: 6 }}>
                  <span className="mini mudo">{f.categoria} · {FORMATO[f.formato]}{f.sentido === 'menor' ? ' · menor é melhor' : ''}{f.usos ? ` · usada ${f.usos}×` : ''}</span>
                  <div className="linha" style={{ gap: 4 }}>
                    <Botao tamanho="p" variante="sutil" icone={Play} onClick={() => aoAbrir(f)}>Testar</Botao>
                    <Menu gatilho={<Botao tamanho="p" variante="fantasma">Mais</Botao>} itens={[
                      { rotulo: 'Nova campanha com esta fórmula', icone: Rocket, aoClicar: () => aoUsarEmCampanha(f) },
                      f.origem !== 'sistema' && { rotulo: 'Excluir', icone: Trash2, perigo: true, aoClicar: () => excluir(f) },
                    ]} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Seletor compacto de fórmula salva (usado no construtor de campanhas). */
export function SeletorFormulaSalva({ aoEscolher }) {
  const { dados } = useFormulas();
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const lista = (dados || []).filter((f) => !busca.trim() || sem(`${f.nome} ${f.expressao} ${f.categoria}`).includes(sem(busca)));
  return (
    <>
      <Botao tamanho="p" variante="sutil" icone={Library} onClick={() => setAberto(true)}>Fórmulas salvas</Botao>
      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Usar uma fórmula salva" subtitulo="Prontas e as que você criou (manualmente ou com IA)." largura={720}>
        <div className="coluna" style={{ gap: 10 }}>
          <Entrada icone={Search} placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
          <div className="coluna" style={{ gap: 6, maxHeight: '55vh', overflow: 'auto' }}>
            {lista.map((f) => (
              <button key={f.id} type="button" className="bib-item" onClick={() => {
                aoEscolher(f);
                post(`/formulas/${f.id}/uso`, {}).catch(() => {});
                setAberto(false);
              }}>
                <div className="linha entre" style={{ gap: 8 }}>
                  <span className="forte pequeno">{f.nome}</span>
                  <span className="mini mudo">{f.categoria} · {FORMATO[f.formato]}</span>
                </div>
                <code className="cat-formula">{f.expressao}</code>
              </button>
            ))}
            {!lista.length && <Vazio icone={Library} titulo="Nenhuma fórmula encontrada" />}
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Modal para salvar a fórmula atual na biblioteca. formula: { expressao, formato, totalizar, sentido, nome?, descricao?, pedido? } */
export function ModalSalvarFormula({ aberto, aoFechar, formula, aoSalvo }) {
  const toast = useToast();
  const { dados } = useFormulas();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('Minhas fórmulas');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const categorias = [...new Set((dados || []).map((f) => f.categoria).filter(Boolean))];

  const [chave, setChave] = useState(null);
  const id = aberto ? formula?.expressao : null;
  if (aberto && chave !== id) {
    setChave(id);
    setNome(formula?.nome || '');
    setDescricao(formula?.descricao || '');
    setErro(null);
  }

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await post('/formulas', {
        nome, descricao, categoria, expressao: formula.expressao, formato: formula.formato, totalizar: formula.totalizar, sentido: formula.sentido,
        origem: formula.pedido ? 'ia' : 'usuario', pedido_ia: formula.pedido || undefined,
      });
      toast.ok('Fórmula salva na biblioteca.');
      aoSalvo?.();
      aoFechar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Salvar fórmula" subtitulo="Fica disponível para qualquer campanha futura. Não precisa criar uma campanha agora."
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" icone={Save} carregando={salvando} disabled={!nome.trim()} onClick={salvar}>Salvar</Botao></>}>
      <div className="coluna" style={{ gap: 12 }}>
        <code className="cat-formula" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{formula?.expressao}</code>
        <Campo rotulo="Nome"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Share Sanofi em hospitais" autoFocus /></Campo>
        <Campo rotulo="Descrição (opcional)"><AreaTexto rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Para que serve, quando usar…" /></Campo>
        <Campo rotulo="Categoria" ajuda="Escolha uma existente ou digite uma nova.">
          <Entrada list="categorias-formula" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
          <datalist id="categorias-formula">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
        <div className="mini mudo">{FORMATO[formula?.formato]} · {formula?.totalizar === 'media' ? 'totaliza pela média' : 'totaliza pela soma'} · {formula?.sentido === 'menor' ? 'menor é melhor' : 'maior é melhor'}</div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
