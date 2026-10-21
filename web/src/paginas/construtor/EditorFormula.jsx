import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Plus, Puzzle, Trash2, XCircle } from 'lucide-react';
import MultiSelecao from '../../componentes/MultiSelecao.jsx';
import { Botao, BotaoIcone, Campo, Seletor } from '../../componentes/ui.jsx';
import { post } from '../../lib/api.js';
import { useAtrasado } from '../../lib/anim.js';
import { useDimensoes, useProdutos } from '../../lib/dados.js';

const OPERADORES = ['+', '-', '*', '/', '(', ')', '>=', '<=', '=='];

/** Opções de valores de uma dimensão de variável parametrizada. */
export function opcoesDimensao(chave, dim, produtos) {
  if (!dim) return [];
  switch (chave) {
    case 'fabricante':
      return dim.fabricantes.map((f) => ({ valor: f.nome, rotulo: f.nome, detalhe: `${f.produtos} prod.` }));
    case 'marca':
      return dim.marcas.map((m) => ({ valor: m.nome, rotulo: m.nome, detalhe: m.fabricante }));
    case 'subcategoria':
      return dim.subcategorias.map((s) => ({ valor: s.nome, rotulo: s.nome }));
    case 'grupo':
      return (dim.grupos || []).map((g) => ({ valor: g.nome, rotulo: g.nome, detalhe: `${g.n_produtos} prod.` }));
    case 'produto':
      return (produtos || []).map((p) => ({ valor: String(p.id), rotulo: p.nome, detalhe: `#${p.id}` }));
    case 'canal':
      return dim.canais.map((c) => ({ valor: c.nome, rotulo: c.nome, detalhe: c.tipo }));
    case 'segmento':
      return dim.segmentos.map((s) => ({ valor: s, rotulo: s }));
    case 'porte':
      return dim.portes.map((s) => ({ valor: s, rotulo: s }));
    case 'estado':
      return dim.estados.map((s) => ({ valor: s, rotulo: s }));
    case 'cidade':
      return dim.cidades.map((c) => ({ valor: c.cidade, rotulo: `${c.cidade}/${c.estado}`, detalhe: `${c.clientes} clientes` }));
    case 'curva':
      return (dim.curvas || ['A', 'B', 'C']).map((c) => ({ valor: c, rotulo: `Curva ${c}` }));
    case 'cfop':
      return dim.cfops.map((c) => ({ valor: c.cfop, rotulo: c.cfop, detalhe: c.descricao }));
    case 'status':
      return dim.status_venda.map((s) => ({ valor: s, rotulo: s }));
    case 'periodo':
      return [{ valor: 'anterior', rotulo: 'Período anterior (mesmo ponto)' }];
    default:
      return [];
  }
}

const aspas = (v) => `"${String(v).replace(/"/g, '')}"`;
export function textoVariavel(medida, filtros) {
  const partes = filtros.filter((f) => f.valores.length).map((f) => `${f.dim}: ${f.valores.length === 1 ? aspas(f.valores[0]) : `[${f.valores.map(aspas).join(', ')}]`}`);
  return partes.length ? `${medida}{${partes.join(', ')}}` : medida;
}

/** Monta visualmente uma variável parametrizada: medida + filtros por dimensão. */
export function ConstrutorVariavel({ catalogo, aoInserir }) {
  const { dados: dim } = useDimensoes();
  const { dados: produtos } = useProdutos();
  const [medida, setMedida] = useState('valor');
  const [filtros, setFiltros] = useState([{ dim: 'marca', valores: [] }]);
  const variaveis = catalogo?.variaveis || {};
  const dimensoes = catalogo?.dimensoes_variavel || [];
  const texto = textoVariavel(medida, filtros);
  const pronto = filtros.some((f) => f.valores.length);
  const usadas = new Set(filtros.map((f) => f.dim));
  const mudar = (i, campo, v) => setFiltros((fs) => fs.map((f, k) => (k === i ? { ...f, [campo]: v, ...(campo === 'dim' ? { valores: [] } : {}) } : f)));

  return (
    <div className="cons-subcampo">
      <div className="cons-subcampo-titulo"><Puzzle size={13} /> Construtor de variável</div>
      <div className="cons-ajuda">Recorte qualquer medida por qualquer dimensão. Ex.: faturamento só da marca Dorflex no canal App Mobile. Filtros de produto substituem os produtos do critério; os demais se somam aos filtros da campanha.</div>
      <div className="cons-linha" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <Campo rotulo="Medida">
          <Seletor valor={medida} aoMudar={setMedida} opcoes={Object.entries(variaveis).map(([k, v]) => ({ valor: k, rotulo: `${k}: ${v.nome}` }))} />
        </Campo>
      </div>
      {filtros.map((f, i) => (
        <div key={i} className="linha-topo" style={{ gap: 8 }}>
          <div style={{ width: 190, flex: 'none' }}>
            <Seletor valor={f.dim} aoMudar={(v) => mudar(i, 'dim', v)}
              opcoes={dimensoes.map((d) => ({ valor: d.chave, rotulo: d.rotulo, desabilitado: d.chave !== f.dim && usadas.has(d.chave) }))} />
          </div>
          <div className="cresce">
            <MultiSelecao opcoes={opcoesDimensao(f.dim, dim, produtos)} valores={f.valores} aoMudar={(v) => mudar(i, 'valores', v)} placeholder="Escolha um ou mais valores…" />
          </div>
          {filtros.length > 1 && <BotaoIcone icone={Trash2} rotulo="Remover filtro" onClick={() => setFiltros((fs) => fs.filter((_, k) => k !== i))} />}
        </div>
      ))}
      <div className="linha quebra">
        <Botao tamanho="p" variante="fantasma" icone={Plus} disabled={filtros.length >= dimensoes.length}
          onClick={() => setFiltros((fs) => [...fs, { dim: dimensoes.find((d) => !usadas.has(d.chave))?.chave || 'canal', valores: [] }])}>
          Outra dimensão
        </Botao>
        <span className="cresce" />
        <code className="cons-codigo" style={{ maxWidth: '100%' }}>{texto}</code>
        <Botao tamanho="p" variante="primario" disabled={!pronto} onClick={() => aoInserir(texto)}>Inserir na fórmula</Botao>
      </div>
    </div>
  );
}

/**
 * Editor de fórmula: autocompletar de variáveis e funções, paleta clicável,
 * construtor de variável parametrizada e validação ao vivo no servidor.
 */
export default function EditorFormula({ valor = '', aoMudar, catalogo, linhas = 2, autoFoco = false }) {
  const ref = useRef(null);
  const [sug, setSug] = useState(null);
  const [validacao, setValidacao] = useState(null);
  const [validando, setValidando] = useState(false);
  const [paleta, setPaleta] = useState(false);
  const [construtor, setConstrutor] = useState(false);
  const atrasado = useAtrasado(valor, 450);

  const variaveis = catalogo?.variaveis || {};
  const funcoes = catalogo?.funcoes || [];
  const candidatos = useMemo(
    () => [
      ...Object.entries(variaveis).map(([nome, v]) => ({ tipo: 'var', nome, desc: v.nome })),
      ...funcoes.map((f) => ({ tipo: 'fn', nome: f.nome, desc: f.assinatura })),
    ],
    [variaveis, funcoes],
  );
  const porGrupo = useMemo(() => {
    const g = new Map();
    for (const [nome, v] of Object.entries(variaveis)) {
      if (!g.has(v.grupo)) g.set(v.grupo, []);
      g.get(v.grupo).push({ nome, desc: v.nome });
    }
    return [...g.entries()];
  }, [variaveis]);

  useEffect(() => {
    if (!atrasado.trim()) {
      setValidacao(null);
      return undefined;
    }
    let vivo = true;
    setValidando(true);
    post('/catalogo/validar-formula', { expressao: atrasado })
      .then((r) => vivo && setValidacao(r))
      .catch((e) => vivo && setValidacao({ indisponivel: true, erro: e.message }))
      .finally(() => vivo && setValidando(false));
    return () => {
      vivo = false;
    };
  }, [atrasado]);

  useEffect(() => {
    if (autoFoco) ref.current?.focus();
  }, [autoFoco]);

  const atualizarSugestoes = (texto, cursor) => {
    const antes = texto.slice(0, cursor);
    const abertas = (antes.match(/\{/g) || []).length - (antes.match(/\}/g) || []).length;
    if (abertas > 0) return setSug(null);
    const m = antes.match(/[a-z_][a-z0-9_]*$/i);
    if (!m) return setSug(null);
    const pref = m[0].toLowerCase();
    const comeca = candidatos.filter((c) => c.nome.startsWith(pref) && c.nome !== pref);
    const contem = candidatos.filter((c) => !c.nome.startsWith(pref) && c.nome.includes(pref));
    const itens = [...comeca, ...contem].slice(0, 9);
    setSug(itens.length ? { itens, ativo: 0, inicio: cursor - pref.length, fim: cursor } : null);
  };

  const inserir = (texto, faixa) => {
    const el = ref.current;
    const ini = faixa?.inicio ?? el?.selectionStart ?? valor.length;
    const fim = faixa?.fim ?? el?.selectionEnd ?? valor.length;
    const antes = valor.slice(0, ini);
    const espaco = !faixa && antes && !/[\s(]$/.test(antes) && !/^[\s)]/.test(texto) ? ' ' : '';
    const novo = antes + espaco + texto + valor.slice(fim);
    aoMudar(novo);
    setSug(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = (antes + espaco + texto).length - (texto.endsWith('()') ? 1 : 0);
      el.setSelectionRange(pos, pos);
    });
  };
  const aceitar = (c) => inserir(c.tipo === 'fn' ? `${c.nome}()` : c.nome, sug);

  const tecla = (e) => {
    if (!sug) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSug((s) => ({ ...s, ativo: Math.min(s.itens.length - 1, s.ativo + 1) }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSug((s) => ({ ...s, ativo: Math.max(0, s.ativo - 1) }));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      aceitar(sug.itens[sug.ativo]);
    } else if (e.key === 'Escape') setSug(null);
  };

  const erro = validacao && !validacao.ok && !validacao.indisponivel;
  return (
    <div className="coluna" style={{ gap: 10 }}>
      <div className={`cons-formula${erro ? ' erro' : ''}`}>
        <textarea ref={ref} rows={linhas} spellCheck={false} value={valor} placeholder='Ex.: valor{marca: "Dorflex"} / valor * 100'
          onChange={(e) => {
            aoMudar(e.target.value);
            atualizarSugestoes(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={tecla}
          onClick={(e) => atualizarSugestoes(e.target.value, e.target.selectionStart)}
          onBlur={() => setTimeout(() => setSug(null), 150)} />
        <AnimatePresence>
          {sug && (
            <motion.div className="cons-sugestoes" style={{ top: 'calc(100% + 4px)' }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
              {sug.itens.map((c, i) => (
                <div key={`${c.tipo}-${c.nome}`} className={`cons-sugestao${i === sug.ativo ? ' ativa' : ''}`} onMouseDown={(e) => { e.preventDefault(); aceitar(c); }}>
                  <code>{c.tipo === 'fn' ? `${c.nome}()` : c.nome}</code>
                  <span>{c.desc}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="linha quebra" style={{ gap: 6 }}>
        <div className={`cons-validacao${validacao?.ok ? ' ok' : erro ? ' erro' : ''}`}>
          {validando ? <Loader2 size={13} className="girando" /> : validacao?.ok ? <CheckCircle2 size={13} /> : erro ? <XCircle size={13} /> : null}
          {validando
            ? 'Validando…'
            : validacao?.ok
              ? `Fórmula válida · usa ${validacao.variaveis.length} variáve${validacao.variaveis.length === 1 ? 'l' : 'is'}`
              : erro
                ? String(validacao.erro).replace(/. Disponíveis:.*$/s, '.')
                : validacao?.indisponivel
                  ? 'Validação indisponível agora. Ela será feita ao salvar.'
                  : 'Digite a fórmula. Use Tab para completar.'}
        </div>
        <span className="cresce" />
        {OPERADORES.map((o) => (
          <button key={o} type="button" className="cons-var" onClick={() => inserir(o === '(' || o === ')' ? o : ` ${o} `)}>{o}</button>
        ))}
      </div>

      <div className="linha quebra" style={{ gap: 6 }}>
        <Botao tamanho="p" variante="fantasma" iconeDireita={paleta ? ChevronUp : ChevronDown} onClick={() => setPaleta((p) => !p)}>
          Variáveis ({Object.keys(variaveis).length}) e funções
        </Botao>
        <Botao tamanho="p" variante={construtor ? 'sutil' : 'fantasma'} icone={Puzzle} onClick={() => setConstrutor((c) => !c)}>
          Variável recortada por dimensão
        </Botao>
      </div>

      {paleta && (
        <div className="cons-subcampo">
          {porGrupo.map(([grupo, vs]) => (
            <div key={grupo} className="coluna" style={{ gap: 5 }}>
              <span className="cat-rot">{grupo}</span>
              <div className="cons-paleta-vars">
                {vs.map((v) => (
                  <button key={v.nome} type="button" className="cons-var" title={v.desc} onClick={() => inserir(v.nome)}>{v.nome}</button>
                ))}
              </div>
            </div>
          ))}
          <div className="coluna" style={{ gap: 5 }}>
            <span className="cat-rot">Funções</span>
            <div className="cons-paleta-vars">
              {funcoes.map((f) => (
                <button key={f.nome} type="button" className="cons-var fn" title={`${f.assinatura}: ${f.descricao}`} onClick={() => inserir(`${f.nome}()`)}>{f.nome}()</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {construtor && <ConstrutorVariavel catalogo={catalogo} aoInserir={(t) => inserir(t)} />}
    </div>
  );
}
