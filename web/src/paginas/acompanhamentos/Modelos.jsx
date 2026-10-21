import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileText, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { del, post, put, useApi } from '../../lib/api.js';
import { useAtrasado } from '../../lib/anim.js';
import { definirQuery } from '../../lib/rotas.js';
import {
  AreaTexto, Aviso, Botao, Campo, Cartao, Carregando, Entrada, ErroCarga, Explica, Seletor, Selo, Vazio, cx, useToast,
} from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import TextoMensagem, { InfosMensagem } from './TextoMensagem.jsx';
import { DESTINOS, ROTULO_DESTINO, opcoesCampanhas, ordenarCampanhas } from '../sistema/comum.js';
import { useConfirmar } from '../sistema/Confirmar.jsx';

const NOVO = 'novo';
const MODELO_NOVO = {
  nome: 'Novo modelo',
  destino: 'participantes',
  assunto: '{campanha}',
  corpo: 'Olá, {nome}!\n\n',
};

const limpo = (m) => ({ nome: m?.nome || '', destino: m?.destino || 'participantes', assunto: m?.assunto || '', corpo: m?.corpo || '' });

function inserir(ref, texto, trecho, aoMudar) {
  const el = ref.current;
  const ini = el?.selectionStart ?? texto.length;
  const fim = el?.selectionEnd ?? texto.length;
  aoMudar(texto.slice(0, ini) + trecho + texto.slice(fim));
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(ini + trecho.length, ini + trecho.length);
  });
}

export default function Modelos({ modeloInicial, campanhaInicial }) {
  const toast = useToast();
  const [confirmar, dialogo] = useConfirmar();
  const { dados: modelos, erro, recarregar } = useApi('/modelos-mensagem');
  const { dados: variaveis } = useApi('/variaveis-mensagem');
  const { dados: campanhas } = useApi('/campanhas');

  const [sel, setSel] = useState(modeloInicial ? String(modeloInicial) : null);
  const [rascunho, setRascunho] = useState(null);
  const [original, setOriginal] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [idCampanha, setIdCampanha] = useState(campanhaInicial ? String(campanhaInicial) : '');
  const [destinatarios, setDestinatarios] = useState([]);
  const [chave, setChave] = useState('');
  const [previa, setPrevia] = useState(null);
  const [erroPrevia, setErroPrevia] = useState(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const refCorpo = useRef(null);
  const refAssunto = useRef(null);
  const [focoEm, setFocoEm] = useState('corpo');
  const contador = useRef(0);

  // seleção inicial
  useEffect(() => {
    if (!modelos) return;
    if (sel === NOVO) return;
    const m = modelos.find((x) => String(x.id) === String(sel)) || modelos[0];
    if (m && String(m.id) !== String(sel)) setSel(String(m.id));
    if (m && (!rascunho || String(m.id) !== String(sel))) {
      setRascunho(limpo(m));
      setOriginal(limpo(m));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelos, sel]);

  useEffect(() => {
    if (!idCampanha && campanhas?.length) setIdCampanha(String(ordenarCampanhas(campanhas)[0].id));
  }, [campanhas, idCampanha]);

  const sujo = rascunho && original && JSON.stringify(rascunho) !== JSON.stringify(original);
  const destino = rascunho?.destino || 'participantes';

  // lista de destinatários reais da campanha (para escolher quem aparece na prévia)
  useEffect(() => {
    if (!idCampanha) return;
    let vivo = true;
    post(`/campanhas/${idCampanha}/mensagens/previa`, { destino, filtro: 'todos', corpo: '.', assunto: '' })
      .then((r) => {
        if (!vivo) return;
        const lista = (Array.isArray(r) ? r : r?.itens || []).map((x) => ({ chave: x.chave, destinatario: x.destinatario }));
        setDestinatarios(lista);
        setChave((k) => (lista.some((x) => x.chave === k) ? k : lista[0]?.chave || ''));
      })
      .catch(() => vivo && setDestinatarios([]));
    return () => {
      vivo = false;
    };
  }, [idCampanha, destino]);

  // prévia ao vivo (com atraso para não chamar a cada tecla)
  const alvoPrevia = useMemo(
    () => (rascunho && chave ? { corpo: rascunho.corpo, assunto: rascunho.assunto, destino, chave } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rascunho?.corpo, rascunho?.assunto, destino, chave],
  );
  const pedido = useAtrasado(alvoPrevia, 500);
  useEffect(() => {
    if (!pedido || !idCampanha || !pedido.corpo.trim()) return;
    const id = ++contador.current;
    setCarregandoPrevia(true);
    post(`/campanhas/${idCampanha}/mensagens/previa`, { destino: pedido.destino, filtro: 'todos', corpo: pedido.corpo, assunto: pedido.assunto, chaves: [pedido.chave] })
      .then((r) => {
        if (id !== contador.current) return;
        const lista = Array.isArray(r) ? r : r?.itens || [];
        setPrevia(lista.find((x) => x.chave === pedido.chave) || lista[0] || null);
        setErroPrevia(null);
      })
      .catch((e) => id === contador.current && setErroPrevia(e))
      .finally(() => id === contador.current && setCarregandoPrevia(false));
  }, [pedido, idCampanha]);

  const variaveisDestino = useMemo(() => (variaveis || []).filter((v) => !v.destino || v.destino === 'todos' || v.destino === destino), [variaveis, destino]);
  const conhecidas = useMemo(() => new Set((variaveis || []).map((v) => String(v.chave).toLowerCase())), [variaveis]);
  const desconhecidas = useMemo(() => {
    if (!rascunho || !variaveis) return [];
    const usadas = `${rascunho.assunto} ${rascunho.corpo}`.match(/\{[a-z0-9_]+\}/gi) || [];
    return [...new Set(usadas.filter((u) => !conhecidas.has(u.toLowerCase())))];
  }, [rascunho, variaveis, conhecidas]);

  async function trocar(id) {
    if (sujo && !(await confirmar({ titulo: 'Descartar alterações?', texto: 'Há mudanças não salvas neste modelo.', rotulo: 'Descartar', perigo: true }))) return;
    if (id === NOVO) {
      setSel(NOVO);
      setRascunho({ ...MODELO_NOVO });
      setOriginal(null);
      return;
    }
    const m = modelos.find((x) => String(x.id) === String(id));
    setSel(String(id));
    setRascunho(limpo(m));
    setOriginal(limpo(m));
    definirQuery({ modelo: id });
  }

  async function salvar() {
    if (!rascunho.nome.trim()) return toast.erro('Dê um nome ao modelo.');
    if (!rascunho.corpo.trim()) return toast.erro('O corpo da mensagem está vazio.');
    setSalvando(true);
    try {
      if (sel === NOVO) {
        const r = await post('/modelos-mensagem', rascunho);
        await recarregar();
        setSel(String(r?.id));
        definirQuery({ modelo: r?.id });
      } else {
        await put(`/modelos-mensagem/${sel}`, rascunho);
        await recarregar();
      }
      setOriginal({ ...rascunho });
      toast.ok('Modelo salvo');
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (sel === NOVO) {
      setSel(null);
      setRascunho(null);
      return;
    }
    if (!(await confirmar({ titulo: 'Excluir modelo?', texto: `"${rascunho.nome}" deixará de existir. Agendamentos que usam este modelo param de funcionar.`, rotulo: 'Excluir', perigo: true }))) return;
    try {
      await del(`/modelos-mensagem/${sel}`);
      toast.ok('Modelo excluído');
      setSel(null);
      setRascunho(null);
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    }
  }

  function duplicar() {
    setSel(NOVO);
    setRascunho({ ...rascunho, nome: `${rascunho.nome} (cópia)` });
    setOriginal(null);
  }

  if (erro && !modelos) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (!modelos) return <Carregando />;

  const porDestino = DESTINOS.map((d) => ({ ...d, itens: modelos.filter((m) => (m.destino || 'participantes') === d.valor) }));
  const campo = (k) => (e) => setRascunho((r) => ({ ...r, [k]: e.target.value }));

  return (
    <div className="modelos-grade">
      {dialogo}
      <Cartao titulo="Modelos" info={EXPLICA.modelos} acoes={<Botao tamanho="p" variante="sutil" icone={Plus} onClick={() => trocar(NOVO)}>Novo</Botao>}>
        <div className="coluna" style={{ gap: 12 }}>
          {porDestino.map((g) => (
            <div key={g.valor}>
              <div className="mini mudo" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '2px 4px 4px' }}>{g.rotulo}</div>
              {!g.itens.length && <div className="mini mudo" style={{ padding: '4px 10px' }}>Nenhum modelo</div>}
              {g.itens.map((m) => (
                <button key={m.id} type="button" className={cx('modelo-item', String(sel) === String(m.id) && 'ativo')} onClick={() => trocar(m.id)}>
                  <FileText size={14} className="mudo" />
                  <span className="cresce truncar pequeno">{m.nome}</span>
                  {String(sel) === String(m.id) && sujo && <span className="ponto" style={{ background: 'var(--aviso)' }} title="Não salvo" />}
                </button>
              ))}
            </div>
          ))}
          {sel === NOVO && (
            <div className={cx('modelo-item', 'ativo')}><Plus size={14} /> <span className="pequeno">{rascunho?.nome}</span></div>
          )}
        </div>
      </Cartao>

      {rascunho ? (
        <Cartao
          titulo={sel === NOVO ? 'Novo modelo' : 'Editar modelo'}
          subtitulo={sujo ? <span className="sujo">● Alterações não salvas</span> : 'Use variáveis: cada pessoa recebe os próprios números.'}
          rodape={
            <>
              {sel !== NOVO && <Botao tamanho="p" variante="fantasma" icone={Copy} onClick={duplicar}>Duplicar</Botao>}
              <Botao tamanho="p" variante="perigo" icone={Trash2} onClick={excluir}>{sel === NOVO ? 'Descartar' : 'Excluir'}</Botao>
              <div className="cresce" />
              <Botao variante="primario" icone={Save} carregando={salvando} disabled={!sujo && sel !== NOVO} onClick={salvar}>Salvar modelo</Botao>
            </>
          }
        >
          <div className="coluna" style={{ gap: 12 }}>
            <div className="grade-2" style={{ gap: 12 }}>
              <Campo rotulo="Nome do modelo"><Entrada value={rascunho.nome} onChange={campo('nome')} /></Campo>
              <Campo rotulo="Destino" ajuda={DESTINOS.find((d) => d.valor === rascunho.destino)?.dica}>
                <Seletor opcoes={DESTINOS.map((d) => ({ valor: d.valor, rotulo: d.rotulo }))} valor={rascunho.destino} aoMudar={(v) => setRascunho((r) => ({ ...r, destino: v }))} />
              </Campo>
            </div>
            <Campo rotulo="Assunto (e-mail)">
              <Entrada ref={refAssunto} value={rascunho.assunto} onChange={campo('assunto')} onFocus={() => setFocoEm('assunto')} />
            </Campo>
            <Campo rotulo="Mensagem" ajuda="Formatação do WhatsApp: *negrito*, _itálico_. Clique numa variável para inserir onde está o cursor.">
              <AreaTexto ref={refCorpo} className="editor-corpo" value={rascunho.corpo} onChange={campo('corpo')} onFocus={() => setFocoEm('corpo')} />
            </Campo>
            {desconhecidas.length > 0 && (
              <Aviso tipo="aviso" titulo="Variáveis desconhecidas">
                {desconhecidas.join(', ')} não existem e ficariam sem valor. Confira a grafia na lista abaixo.
              </Aviso>
            )}
            <div>
              <div className="campo-rotulo" style={{ marginBottom: 6 }}>Variáveis disponíveis para {ROTULO_DESTINO[destino]?.toLowerCase()}<Explica titulo="Variáveis" {...EXPLICA.variaveis} tamanho={13} /></div>
              <div className="var-chips">
                {variaveisDestino.map((v) => (
                  <button key={v.chave} type="button" className="var-chip" title={`${v.descricao}${v.exemplo ? ` (ex.: ${v.exemplo})` : ''}`}
                    onClick={() => (focoEm === 'assunto'
                      ? inserir(refAssunto, rascunho.assunto, v.chave, (assunto) => setRascunho((r) => ({ ...r, assunto })))
                      : inserir(refCorpo, rascunho.corpo, v.chave, (corpo) => setRascunho((r) => ({ ...r, corpo }))))}>
                    {v.chave}
                  </button>
                ))}
                {!variaveisDestino.length && <span className="mini mudo">Carregando variáveis…</span>}
              </div>
            </div>
            <details>
              <summary className="pequeno sec" style={{ cursor: 'pointer' }}>Ver o modelo com as variáveis destacadas</summary>
              <div className="hist-msg" style={{ marginTop: 8 }}>
                <TextoMensagem texto={rascunho.corpo} modo="modelo" variaveisConhecidas={conhecidas} />
              </div>
            </details>
          </div>
        </Cartao>
      ) : (
        <Cartao><Vazio icone={FileText} titulo="Selecione ou crie um modelo" acao={<Botao variante="primario" icone={Plus} onClick={() => trocar(NOVO)}>Novo modelo</Botao>} /></Cartao>
      )}

      {rascunho && (
        <Cartao className="modelos-previa" titulo="Pré-visualização ao vivo" subtitulo="Com os números reais de um participante" info={{ texto: 'Mostra como a mensagem chega para uma pessoa de verdade, com os números de hoje.', como: 'Troque a campanha ou o destinatário de exemplo para conferir outros casos (alguém em risco, alguém que já bateu).' }}>
          <div className="coluna" style={{ gap: 12 }}>
            <Campo rotulo="Campanha">
              <Seletor tamanho="p" opcoes={opcoesCampanhas(campanhas || [])} valor={idCampanha} aoMudar={setIdCampanha} />
            </Campo>
            <Campo rotulo="Destinatário de exemplo">
              <Seletor tamanho="p" opcoes={destinatarios.map((d) => ({ valor: d.chave, rotulo: d.destinatario }))} valor={chave} aoMudar={setChave} vazio={destinatarios.length ? undefined : 'Nenhum destinatário'} />
            </Campo>
            {erroPrevia && <ErroCarga erro={erroPrevia} />}
            {previa ? (
              <div className={cx('coluna', carregandoPrevia && 'previa-carregando')} style={{ gap: 10 }}>
                <InfosMensagem texto={previa.texto} />
                {previa.assunto && <div className="pequeno"><span className="mudo">Assunto:</span> <strong>{previa.assunto}</strong></div>}
                <div className="whats-fundo">
                  <div className="whats-bolha"><TextoMensagem texto={previa.texto} /><span className="hora">agora</span></div>
                </div>
              </div>
            ) : (
              !erroPrevia && <div className="mudo pequeno linha g4"><Sparkles size={13} /> A prévia aparece quando houver texto e um destinatário.</div>
            )}
            {sel !== NOVO && !sujo && <Selo cor="bom">Salvo</Selo>}
          </div>
        </Cartao>
      )}
    </div>
  );
}
