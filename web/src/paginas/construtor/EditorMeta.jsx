import { useMemo, useState } from 'react';
import { ClipboardCopy, ClipboardPaste, Database, Equal, Eraser, Lightbulb, Percent, PieChart, Search, Table2, TrendingUp, Trophy } from 'lucide-react';
import { AreaTexto, Aviso, Botao, Campo, Entrada, Explica, Modal, Segmentado, Selo, Tabela, useToast } from '../../componentes/ui.jsx';
import { EntradaNumero } from './campos.jsx';
import { fmtNumero, fmtPeriodo } from '../../lib/formato.js';
import { fmtMetrica, infoMetrica, nivelPlural, nivelSingular, normalizarTexto, numeroBR } from './util.js';

// os cinco jeitos de definir a meta, com nome simples e exemplo
const TIPOS = [
  { valor: 'fixa', rotulo: 'Mesma meta para todos', exemplo: 'Todo mundo precisa vender 100 unidades.', icone: Equal },
  { valor: 'distribuida', rotulo: 'Uma meta total dividida', exemplo: 'O fornecedor pediu 24.000 un; o sistema reparte.', icone: PieChart },
  { valor: 'historico', rotulo: 'Crescer sobre o que cada um vendeu', exemplo: 'Vendeu 200 no mês passado? A meta é 220 (+10%).', icone: TrendingUp },
  { valor: 'meta_geral', rotulo: 'Meta que já vem do ERP', exemplo: 'Usa a meta mensal cadastrada de cada vendedor.', icone: Database },
  { valor: 'sem_meta', rotulo: 'Sem meta, só ranking', exemplo: 'Ninguém tem meta; ganha quem fizer mais.', icone: Trophy },
];

const arred = (v, info) => (info.formato === 'numero' ? Math.ceil(v - 1e-9) : Math.round(v * 100) / 100);

/** Interpreta colagem do Excel: 2 colunas (código ou nome + meta), separadas por tab ou ponto e vírgula. */
export function interpretarColagem(texto, participantes) {
  const porChave = new Map(participantes.map((p) => [String(p.chave), p]));
  const porNome = new Map();
  for (const p of participantes) {
    porNome.set(normalizarTexto(p.nome), p);
    porNome.set(normalizarTexto(p.nome.replace(/\s*\(#\d+\)\s*$/, '')), p);
  }
  const aplicados = [];
  const naoEncontrados = [];
  const invalidos = [];
  const linhas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  linhas.forEach((l, i) => {
    let cols = l.split(/\t|;/).map((c) => c.trim()).filter((c) => c !== '');
    if (cols.length < 2) {
      const m = l.match(/^(.*\S)\s+([\d.,]+%?)$/);
      cols = m ? [m[1], m[2]] : cols;
    }
    if (cols.length < 2) return invalidos.push(l);
    const ident = cols[0];
    const valor = numeroBR(cols[cols.length - 1]);
    if (valor == null) {
      if (i === 0) return; // cabeçalho
      return invalidos.push(l);
    }
    let p = porChave.get(ident) || porNome.get(normalizarTexto(ident));
    if (!p) {
      const q = normalizarTexto(ident);
      const cands = participantes.filter((x) => normalizarTexto(x.nome).startsWith(q));
      if (cands.length === 1) [p] = cands;
    }
    if (!p) return naoEncontrados.push(ident);
    aplicados.push({ chave: p.chave, nome: p.nome, valor });
  });
  return { aplicados, naoEncontrados, invalidos };
}

function GradeMetas({ aberto, aoFechar, crit, indice, info, previa, aoMudarValores }) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [colagem, setColagem] = useState('');
  const [modoColar, setModoColar] = useState(false);
  const [perc, setPerc] = useState(10);
  const valores = crit.meta.valores || {};
  const participantes = useMemo(
    () =>
      (previa?.participantes || []).map((p) => ({
        chave: p.chave,
        nome: p.nome,
        grupo: p.grupo,
        meta: p.criterios?.[indice]?.meta ?? null,
        realizado: p.criterios?.[indice]?.realizado ?? null,
        projecao: p.criterios?.[indice]?.projecao ?? null,
      })),
    [previa, indice],
  );
  const filtrados = useMemo(() => {
    const q = normalizarTexto(busca);
    return q ? participantes.filter((p) => normalizarTexto(`${p.nome} ${p.grupo || ''} ${p.chave}`).includes(q)) : participantes;
  }, [participantes, busca]);
  const analise = useMemo(() => (modoColar && colagem.trim() ? interpretarColagem(colagem, participantes) : null), [modoColar, colagem, participantes]);
  const nManuais = Object.keys(valores).length;

  const setUm = (chave, v) => {
    const novo = { ...valores };
    if (v == null) delete novo[chave];
    else novo[chave] = v;
    aoMudarValores(novo);
  };
  const copiar = async () => {
    const tsv = ['codigo\tparticipante\tmeta', ...participantes.map((p) => `${p.chave}\t${p.nome}\t${p.meta == null ? '' : String(p.meta).replace('.', ',')}`)].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      toast.ok('Metas copiadas. Agora é só colar no Excel.');
    } catch {
      toast.erro('Não foi possível copiar para a área de transferência.');
    }
  };
  const aplicarPerc = () => {
    const novo = { ...valores };
    for (const p of participantes) if (p.meta != null) novo[p.chave] = arred(p.meta * (1 + perc / 100), info);
    aoMudarValores(novo);
    toast.ok(`Metas ajustadas em ${perc > 0 ? '+' : ''}${fmtNumero(perc)}%.`);
  };
  const aplicarColagem = () => {
    if (!analise?.aplicados.length) return;
    const novo = { ...valores };
    for (const a of analise.aplicados) novo[a.chave] = a.valor;
    aoMudarValores(novo);
    toast.ok(`${analise.aplicados.length} metas aplicadas a partir da planilha.`);
    setColagem('');
    setModoColar(false);
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} largura={860} titulo={`Metas individuais · ${crit.nome || info.nome}`}
      subtitulo={`${participantes.length} participantes · ${nManuais} ajuste${nManuais === 1 ? '' : 's'} manual${nManuais === 1 ? '' : 'is'}. Valores em branco seguem a regra automática.`}
      rodape={<Botao variante="primario" onClick={aoFechar}>Concluir</Botao>}>
      {!previa ? (
        <Aviso tipo="info">Aguarde a prévia calcular as metas automáticas para editar participante a participante.</Aviso>
      ) : (
        <div className="coluna cons-modal" style={{ gap: 12 }}>
          <div className="cons-ajuda">
            "Meta em vigor" é a meta que a regra calculou para cada um. Para trocar a de alguém, digite em "Ajuste manual". Deixe em branco para seguir a regra.
            Dá também para colar a coluna de metas do Excel ou ajustar todas de uma vez por um percentual.
          </div>
          <div className="linha quebra" style={{ gap: 8 }}>
            <div style={{ width: 240 }}>
              <Entrada icone={Search} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar participante…" />
            </div>
            <span className="cresce" />
            <div className="linha g4">
              <div style={{ width: 92 }}><EntradaNumero valor={perc} aoMudar={(v) => setPerc(v ?? 0)} sufixo="%" tamanho="p" /></div>
              <Botao tamanho="p" icone={Percent} onClick={aplicarPerc} title="Aplica o percentual sobre a meta atual de todos (ex.: 10 sobe todas as metas em 10%)">Ajustar todas</Botao>
            </div>
            <Botao tamanho="p" icone={ClipboardPaste} variante={modoColar ? 'sutil' : 'padrao'} onClick={() => setModoColar((m) => !m)}>Colar do Excel</Botao>
            <Botao tamanho="p" icone={ClipboardCopy} onClick={copiar}>Copiar para o Excel</Botao>
            {nManuais > 0 && <Botao tamanho="p" variante="perigo" icone={Eraser} onClick={() => aoMudarValores({})}>Limpar ajustes</Botao>}
          </div>

          {modoColar && (
            <div className="cons-subcampo">
              <div className="cons-ajuda">
                Cole duas colunas do Excel: <b>código ou nome</b> do participante e a <b>meta</b>. Aceita 1.234,56 ou 1234.56; cabeçalho é ignorado.
              </div>
              <AreaTexto rows={5} value={colagem} onChange={(e) => setColagem(e.target.value)} placeholder={'19\t120\nRenato Gomes\t95\n...'} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />
              {analise && (
                <div className="linha quebra" style={{ gap: 8 }}>
                  <Selo cor="bom">{analise.aplicados.length} reconhecidas</Selo>
                  {analise.naoEncontrados.length > 0 && <Selo cor="aviso" title={analise.naoEncontrados.join(', ')}>{analise.naoEncontrados.length} não encontradas</Selo>}
                  {analise.invalidos.length > 0 && <Selo cor="critico" title={analise.invalidos.join(' | ')}>{analise.invalidos.length} inválidas</Selo>}
                  <span className="cresce" />
                  <Botao tamanho="p" variante="primario" disabled={!analise.aplicados.length} onClick={aplicarColagem}>Aplicar {analise.aplicados.length} metas</Botao>
                </div>
              )}
            </div>
          )}

          <Tabela className="cons-grade-metas" densa chaveLinha={(p) => p.chave} linhas={filtrados} maxAltura="48vh"
            colunas={[
              { chave: 'nome', titulo: 'Participante', ordenavel: true, dirInicial: 'asc', render: (p) => (
                <div className="coluna" style={{ gap: 0 }}>
                  <span className="truncar" style={{ maxWidth: 280 }}>{p.nome}</span>
                  <span className="mini mudo">#{p.chave}{p.grupo ? ` · ${p.grupo}` : ''}</span>
                </div>
              ) },
              { chave: 'realizado', titulo: 'Realizado', alinhar: 'direita', ordenavel: true, render: (p) => <span className="num">{fmtMetrica(p.realizado, info)}</span> },
              { chave: 'projecao', titulo: 'Projeção', alinhar: 'direita', ordenavel: true, render: (p) => <span className="num mudo">{fmtMetrica(p.projecao, info)}</span> },
              { chave: 'meta', titulo: 'Meta em vigor', alinhar: 'direita', ordenavel: true, render: (p) => (
                <span className={`num${valores[p.chave] != null ? ' cons-manual' : ''}`}>{fmtMetrica(valores[p.chave] ?? p.meta, info)}</span>
              ) },
              { chave: 'ajuste', titulo: 'Ajuste manual', alinhar: 'direita', valor: (p) => valores[p.chave] ?? null, ordenavel: true, render: (p) => (
                <div className="linha g4" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ width: 120 }}><EntradaNumero tamanho="p" valor={valores[p.chave] ?? null} aoMudar={(v) => setUm(p.chave, v)} placeholder="auto" /></div>
                </div>
              ) },
            ]} />
        </div>
      )}
    </Modal>
  );
}

/** Editor da meta de um critério: cinco jeitos em cartões, campos em frases, resumo das metas e grade individual. */
export default function EditorMeta({ crit, indice, catalogo, nivel, previa, aoMudar }) {
  const [grade, setGrade] = useState(false);
  const m = crit.meta;
  const info = infoMetrica(crit, catalogo);
  const set = (k, v) => aoMudar({ ...m, [k]: v });
  const res = previa?.criterios?.[indice];
  const nPart = previa?.resumo?.participantes || 0;
  const nManuais = Object.keys(m.valores || {}).length;
  const sufixo = info.formato === 'moeda' ? 'R$' : info.formato === 'perc' ? '%' : info.unidade || '';
  const quem = nivelSingular(nivel);
  const quemPlural = nivelPlural(nivel);
  const fmt = (v) => fmtMetrica(v, info);

  const metas = useMemo(() => (previa?.participantes || []).map((p) => p.criterios?.[indice]?.meta).filter((x) => x != null).sort((a, b) => a - b), [previa, indice]);
  const estat = metas.length ? { min: metas[0], med: metas[Math.floor(metas.length / 2)], max: metas[metas.length - 1], zeradas: metas.filter((x) => !(x > 0)).length } : null;

  // sugestão a partir do período anterior
  let sugestao = null;
  if (res?.total?.base != null && res.total.base > 0 && nPart) {
    const fator = info.sentido === 'menor' ? 0.95 : 1.1;
    if (m.tipo === 'distribuida') sugestao = { valor: arred(res.total.base * fator, info), texto: 'de meta total' };
    else if (m.tipo === 'fixa') {
      const porPart = info.totalizar === 'soma' ? res.total.base / nPart : res.total.base;
      sugestao = { valor: arred(porPart * fator, info), texto: `por ${nivel === 'equipe' ? 'equipe' : quem}` };
    }
  }
  const metaGeralOk = ['vendedor', 'equipe', 'empresa'].includes(nivel);

  return (
    <div className="coluna" style={{ gap: 12 }}>
      <div className="cons-tipos-meta" role="radiogroup" aria-label="Como definir a meta">
        {TIPOS.map((t) => {
          const desab = t.valor === 'meta_geral' && !metaGeralOk;
          return (
            <button key={t.valor} type="button" role="radio" aria-checked={m.tipo === t.valor} disabled={desab}
              className={`cons-tipo-meta${m.tipo === t.valor ? ' sel' : ''}`} onClick={() => set('tipo', t.valor)}
              title={desab ? `A meta do ERP só existe para vendedores, equipes ou empresa.` : undefined}>
              <span className="cons-tipo-meta-icone"><t.icone size={15} /></span>
              <span className="cons-tipo-meta-nome">{t.rotulo}</span>
              <span className="cons-tipo-meta-ex">{desab ? 'Só para vendedores, equipes ou empresa.' : t.exemplo}</span>
            </button>
          );
        })}
      </div>

      {m.tipo === 'fixa' && (
        <div className="cons-frase-campo">
          <span>Cada {nivel === 'empresa' ? 'empresa' : quem} precisa fazer</span>
          <div style={{ width: 150 }}><EntradaNumero valor={m.valor} aoMudar={(v) => set('valor', v ?? 0)} sufixo={sufixo} /></div>
          <Explica titulo="Mesma meta para todos" texto={`Todos os ${quemPlural} recebem exatamente a mesma meta.`}
            como="Bom quando as carteiras são parecidas. Se forem muito diferentes, prefira dividir uma meta total pelo histórico." exemplo="Meta de 100 un: quem vendeu 80 atingiu 80%." />
        </div>
      )}
      {m.tipo === 'distribuida' && (
        <div className="coluna" style={{ gap: 10 }}>
          <div className="cons-frase-campo">
            <span>O fornecedor pediu, no total,</span>
            <div style={{ width: 160 }}><EntradaNumero valor={m.valor} aoMudar={(v) => set('valor', v ?? 0)} sufixo={sufixo} /></div>
            <Explica titulo="Uma meta total dividida" texto={`Você informa o total que o fornecedor quer e o sistema calcula a meta de cada um dos ${quemPlural}.`}
              como={['Pelo que cada um vendeu antes: quem vende mais recebe uma parte maior (o mais justo).', 'Em partes iguais: todos recebem o mesmo pedaço.', 'Proporcional à meta do ERP: segue a meta mensal cadastrada de cada um.']}
              exemplo="Total de 1.000 un. Ana vendeu 60% do total no mês passado e Bruno 40%: Ana recebe 600 e Bruno 400." />
          </div>
          <Campo rotulo="Como dividir entre a equipe">
            <Segmentado valor={m.distribuir_por} aoMudar={(v) => set('distribuir_por', v)}
              opcoes={[
                { valor: 'historico', rotulo: 'Pelo que cada um vendeu antes' },
                { valor: 'igual', rotulo: 'Em partes iguais' },
                ...(metaGeralOk ? [{ valor: 'meta_geral', rotulo: 'Proporcional à meta do ERP' }] : []),
              ]} />
          </Campo>
          {m.distribuir_por === 'meta_geral' && (
            <Campo rotulo="Qual meta do ERP usar na proporção">
              <Segmentado valor={m.campo} aoMudar={(v) => set('campo', v)} opcoes={[{ valor: 'meta_valor', rotulo: 'Faturamento' }, { valor: 'meta_quantidade', rotulo: 'Quantidade' }]} />
            </Campo>
          )}
        </div>
      )}
      {m.tipo === 'historico' && (
        <div className="cons-frase-campo">
          <span>Cada um precisa {info.sentido === 'menor' ? 'mudar' : 'crescer'}</span>
          <div style={{ width: 110 }}><EntradaNumero valor={m.crescimento} aoMudar={(v) => set('crescimento', v ?? 0)} sufixo="%" /></div>
          <span>sobre o que fez {res?.periodo_base && !m.base_inicio ? `de ${fmtPeriodo(res.periodo_base.inicio, res.periodo_base.fim)}` : 'no período-base'}</span>
          <Explica titulo="Crescer sobre o que cada um vendeu" texto="Cada participante tem a própria meta: o que ele fez no período anterior mais o percentual."
            como={['Use 0% para repetir o resultado anterior.', 'Use número negativo para reduzir (ex.: -10% de desconto médio).', 'Quem não vendeu nada antes fica com meta zero: defina uma meta mínima em "Ajustes avançados".']}
            exemplo="Crescimento de 10%: quem vendeu 200 un em setembro precisa de 220 un em outubro." />
        </div>
      )}
      {m.tipo === 'meta_geral' && (
        <div className="coluna" style={{ gap: 10 }}>
          <div className="cons-frase-campo">
            <span>Usar</span>
            <div style={{ width: 110 }}><EntradaNumero valor={m.fator} aoMudar={(v) => set('fator', v ?? 100)} sufixo="%" /></div>
            <span>da meta mensal de</span>
            <Segmentado tamanho="p" valor={m.campo} aoMudar={(v) => set('campo', v)} opcoes={[{ valor: 'meta_valor', rotulo: 'Faturamento' }, { valor: 'meta_quantidade', rotulo: 'Quantidade' }]} />
            <Explica titulo="Meta que já vem do ERP" texto="Usa a meta mensal que já está cadastrada no sistema da empresa para cada vendedor, sem digitar nada."
              como={['100% = a própria meta do mês.', 'Se a campanha durar menos que um mês, a meta é proporcional aos dias.']}
              exemplo="Meta do vendedor no ERP: R$ 50 mil. Com 100%, a meta da campanha é R$ 50 mil; com 110%, R$ 55 mil." />
          </div>
          {!metaGeralOk && <Aviso tipo="aviso">A meta do ERP só existe para vendedores, equipes ou empresa.</Aviso>}
        </div>
      )}
      {m.tipo === 'sem_meta' && (
        <div className="cons-ajuda">
          Ninguém tem meta, então não existe "% da meta". O prêmio deve ser por ranking (classificado pelo realizado) ou por bloco (a cada X unidades, R$ Y).
        </div>
      )}

      {sugestao && (
        <div className="cons-sugestao-meta">
          <Lightbulb size={14} style={{ color: 'var(--acento)' }} />
          <span>
            No período anterior ({fmtPeriodo(res.periodo_base?.inicio, res.periodo_base?.fim)}) {nivel === 'empresa' ? 'a empresa' : `os ${quemPlural}`} fizeram <b>{fmt(res.total.base)}</b>.
            {' '}Sugestão com {info.sentido === 'menor' ? '5% a menos' : '10% a mais'}: <b>{fmt(sugestao.valor)}</b> {sugestao.texto}.
          </span>
          <span className="cresce" />
          <Botao tamanho="p" variante="sutil" onClick={() => set('valor', sugestao.valor)}>Usar sugestão</Botao>
        </div>
      )}

      {m.tipo !== 'sem_meta' && (
        <div className="cons-resumo-metas">
          <div className="cresce" style={{ minWidth: 0 }}>
            {estat ? (
              <span className="pequeno">
                {metas.length === 1 ? (
                  <>A meta ficou em <b>{fmt(estat.min)}</b>.</>
                ) : estat.min === estat.max ? (
                  <>Todos os {fmtNumero(metas.length)} {quemPlural} ficaram com meta de <b>{fmt(estat.min)}</b>.</>
                ) : (
                  <>
                    As metas dos {fmtNumero(metas.length)} {quemPlural} vão de <b>{fmt(estat.min)}</b> a <b>{fmt(estat.max)}</b>; metade fica abaixo de <b>{fmt(estat.med)}</b>.
                  </>
                )}
                {res?.total?.meta != null && info.totalizar === 'soma' && metas.length > 1 && <> Somadas: <b>{fmt(res.total.meta)}</b>.</>}
                {nManuais > 0 && <> {nManuais} ajustada{nManuais > 1 ? 's' : ''} à mão.</>}
              </span>
            ) : (
              <span className="pequeno mudo">A prévia calcula a meta de cada um assim que os dados chegarem.</span>
            )}
            {estat?.zeradas > 0 && m.tipo === 'historico' && (
              <div className="pequeno" style={{ color: 'var(--aviso-texto)', marginTop: 4 }}>
                {fmtNumero(estat.zeradas)} {estat.zeradas > 1 ? `${quemPlural} ficaram` : `${quem} ficou`} com meta zero porque não {estat.zeradas > 1 ? 'venderam' : 'vendeu'} nada no período-base. Defina uma meta mínima em "Ajustes avançados".
              </div>
            )}
          </div>
          <Botao tamanho="p" icone={Table2} onClick={() => setGrade(true)}>Ver e ajustar a meta de cada {nivel === 'empresa' ? 'um' : quem}</Botao>
        </div>
      )}
      <GradeMetas aberto={grade} aoFechar={() => setGrade(false)} crit={crit} indice={indice} info={info} previa={previa}
        aoMudarValores={(valores) => aoMudar({ ...m, valores })} />
    </div>
  );
}
