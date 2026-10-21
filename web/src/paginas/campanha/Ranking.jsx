import { useMemo, useState } from 'react';
import { Crosshair, List, Rows3, Search, Sparkles } from 'lucide-react';
import { fmtMoeda, fmtNumero, fmtPerc } from '../../lib/formato.js';
import {
  Avatar, Botao, Chip, Entrada, Explica, ListaAnimada, Movimento, Progresso, Segmentado, SeloStatus, Seletor, Tabela, Vazio, cx,
} from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { contarStatus, fmtCrit, textoProximaFaixa } from './util.js';

const MEDALHAS = ['ouro', 'prata', 'bronze'];
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Valor usado na barra e no destaque de cada linha (pontuação, ou realizado quando não há meta). */
function medida(l, ap, projetado, maxReal) {
  const score = projetado ? l.score_proj : l.score;
  if (score != null) return { texto: fmtPerc(score), barra: score, rotulo: projetado ? 'Projeção' : 'Pontuação', relativo: false };
  const idx = Math.max(0, ap.criterios.findIndex((c) => c.id === ap.campanha?.premiacao?.criterio_base));
  const crit = ap.criterios[idx];
  const v = projetado ? l.criterios[idx]?.projecao : l.criterios[idx]?.realizado;
  return { texto: fmtCrit(v, crit, { compacto: true }), barra: maxReal > 0 ? ((v || 0) / maxReal) * 100 : 0, rotulo: projetado ? 'Projeção' : crit?.nome || 'Realizado', relativo: true };
}

function LinhaRanking({ l, ap, projetado, selecionada, aoAbrir, maxReal, estado = {} }) {
  const pos = projetado ? l.posicao_proj : l.posicao;
  const med = medida(l, ap, projetado, maxReal);
  const dica = !projetado && !estado.futura && !estado.encerrada && l.status !== 'atingiu' ? textoProximaFaixa(l, ap) : null;
  const premio = projetado ? l.premio_proj : l.premio;
  const premioOutro = projetado ? l.premio : l.premio_proj;
  const mov = projetado ? (l.posicao ?? 0) - (l.posicao_proj ?? 0) : l.movimento;
  return (
    <div className={cx('cmp-rank-linha', selecionada && 'selecionada')} onClick={() => aoAbrir(l.chave)} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && aoAbrir(l.chave)}>
      <div className="cmp-rank-pos">
        {pos <= 3 && !estado.futura ? <span className={`medalha ${MEDALHAS[pos - 1]}`}>{pos}</span> : <span className="cmp-rank-num">{pos}</span>}
        <Movimento valor={mov ?? null} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="cmp-rank-nome">
          <Avatar nome={l.nome} foto={l.foto} tamanho="p" />
          <div style={{ minWidth: 0 }}>
            <div className="linha" style={{ gap: 8 }}>
              <span className="forte truncar">{l.nome}</span>
              {l.status !== 'sem_meta' && <SeloStatus status={l.status} />}
            </div>
            <div className="cmp-rank-crit">
              {l.grupo && <span>{l.grupo}</span>}
              {!(estado.semMeta && ap.criterios.length === 1) && ap.criterios.map((c, i) => {
                const lc = l.criterios[i] || {};
                return (
                  <span key={c.id} title={c.nome}>
                    {ap.criterios.length > 1 ? `${c.nome}: ` : ''}
                    <b>{fmtCrit(lc.realizado, c, { compacto: true })}</b>
                    {lc.meta != null ? ` / ${fmtCrit(lc.meta, c, { compacto: true })}` : ''}
                  </span>
                );
              })}
            </div>
            {dica && (
              <div className="cmp-rank-dica">
                <Crosshair size={12} />
                {dica}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="cmp-rank-score">
        <div className="topo-score">
          <span className="truncar">{med.rotulo}</span>
          <strong>{med.texto}</strong>
        </div>
        <Progresso valor={med.barra} cor={med.relativo ? 'orcamento-ok' : undefined} projecao={!projetado && !med.relativo && !estado.encerrada ? l.score_proj : undefined} espessura="p" />
      </div>
      <div className="cmp-rank-premio">
        <strong>{premio > 0 ? fmtMoeda(premio) : <span className="mudo" style={{ fontWeight: 500 }}>-</span>}</strong>
        {!estado.encerrada && !estado.futura && <span className="mini mudo">{projetado ? 'atual' : 'proj.'} {fmtMoeda(premioOutro || 0, { compacto: true })}</span>}
      </div>
    </div>
  );
}

function Podio({ linhas, ap, aoAbrir, maxReal }) {
  return (
    <div className="cmp-podio">
      {linhas.slice(0, 3).map((l, i) => {
        const med = medida(l, ap, false, maxReal);
        return (
          <div key={l.chave} className={cx('cartao cmp-podio-item interativo', i === 0 && 'primeiro')} onClick={() => aoAbrir(l.chave)}>
            <div className="linha" style={{ gap: 12 }}>
              <span className={`medalha ${MEDALHAS[i]}`}>{i + 1}</span>
              <Avatar nome={l.nome} foto={l.foto} />
              <div style={{ minWidth: 0 }}>
                <div className="forte truncar">{l.nome}</div>
                <div className="mudo pequeno truncar">{l.grupo || ap.campanha?.nivel_singular}</div>
              </div>
            </div>
            <div className="linha entre">
              <div className="cmp-estat">
                <span className="cmp-estat-rotulo">{med.rotulo}</span>
                <span className="cmp-estat-valor g">{med.texto}</span>
              </div>
              <div className="cmp-estat" style={{ alignItems: 'flex-end' }}>
                <span className="cmp-estat-rotulo">Prêmio</span>
                <span className="cmp-estat-valor">{l.premio > 0 ? fmtMoeda(l.premio) : '-'}</span>
              </div>
            </div>
            <Progresso valor={med.barra} cor={med.relativo ? 'orcamento-ok' : undefined} projecao={med.relativo ? undefined : l.score_proj} espessura="p" />
          </div>
        );
      })}
    </div>
  );
}

/** Ranking da campanha: pódio, lista animada (atual × projetado), filtros e tabela completa. */
export default function Ranking({ ap, selecionada, aoAbrir, grupo: grupoExterno, aoMudarGrupo }) {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('todos');
  const [grupoInterno, setGrupoInterno] = useState('');
  const grupo = grupoExterno ?? grupoInterno;
  const setGrupo = aoMudarGrupo ?? setGrupoInterno;
  const estado = useMemo(() => ({ futura: ap.tempo.status === 'futura', encerrada: ap.tempo.status === 'encerrada', semMeta: ap.participantes.every((x) => x.score == null) }), [ap]);
  const [modo, setModo] = useState(estado.futura ? 'tabela' : 'lista');
  const [visao, setVisao] = useState('atual');
  const [limite, setLimite] = useState(40);
  const projetado = visao === 'projetado';
  const andamento = ap.tempo.status === 'andamento';

  const idxBase = Math.max(0, ap.criterios.findIndex((c) => c.id === ap.campanha?.premiacao?.criterio_base));
  const maxReal = useMemo(() => Math.max(0, ...ap.participantes.map((l) => (projetado ? l.criterios[idxBase]?.projecao : l.criterios[idxBase]?.realizado) || 0)), [ap, idxBase, projetado]);
  const grupos = useMemo(() => [...new Set(ap.participantes.map((l) => l.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [ap]);
  const contagens = useMemo(() => contarStatus(ap.participantes), [ap]);

  const filtradas = useMemo(() => {
    const q = normalizar(busca.trim());
    const l = ap.participantes.filter(
      (x) => (status === 'todos' || x.status === status) && (!grupo || x.grupo === grupo) && (!q || normalizar(`${x.nome} ${x.grupo || ''}`).includes(q)),
    );
    return projetado ? [...l].sort((a, b) => (a.posicao_proj ?? 1e9) - (b.posicao_proj ?? 1e9)) : [...l].sort((a, b) => a.posicao - b.posicao);
  }, [ap, busca, status, grupo, projetado]);

  const semFiltro = !busca && status === 'todos' && !grupo;
  const mostrarPodio = modo === 'lista' && semFiltro && !projetado && !estado.futura && filtradas.length >= 3 && (filtradas[0].score != null || filtradas[0].criterios[idxBase]?.realizado > 0);

  const colunas = useMemo(() => {
    const base = [
      { chave: 'posicao', titulo: '#', ordenavel: true, dirInicial: 'asc', largura: 44, valor: (l) => l.posicao, render: (l) => <span className="num forte">{l.posicao}</span> },
      {
        chave: 'nome', titulo: ap.campanha?.nivel_singular || 'Participante', ordenavel: true, dirInicial: 'asc', valor: (l) => l.nome,
        render: (l) => (
          <div style={{ minWidth: 0 }}>
            <div className="forte truncar" style={{ maxWidth: 240 }}>{l.nome}</div>
            {l.grupo && <div className="mudo pequeno truncar" style={{ maxWidth: 240 }}>{l.grupo}</div>}
          </div>
        ),
      },
      { chave: 'status', titulo: 'Status', ordenavel: true, valor: (l) => l.status, render: (l) => <SeloStatus status={l.status} /> },
    ];
    const porCrit = ap.criterios.flatMap((c, i) => [
      {
        chave: `r${i}`, titulo: c.nome, alinhar: 'direita', ordenavel: true, valor: (l) => l.criterios[i]?.realizado,
        render: (l) => (
          <span className="num">
            {fmtCrit(l.criterios[i]?.realizado, c, { compacto: true })}
            {l.criterios[i]?.meta != null && <span className="mudo"> / {fmtCrit(l.criterios[i].meta, c, { compacto: true })}</span>}
          </span>
        ),
      },
      { chave: `a${i}`, titulo: '%', alinhar: 'direita', ordenavel: true, valor: (l) => l.criterios[i]?.atingimento, render: (l) => <span className="num">{fmtPerc(l.criterios[i]?.atingimento)}</span> },
      { chave: `p${i}`, titulo: 'Proj.', alinhar: 'direita', ordenavel: true, valor: (l) => l.criterios[i]?.projecao, render: (l) => <span className="num sec">{fmtCrit(l.criterios[i]?.projecao, c, { compacto: true })}</span> },
    ]);
    const fim = [
      { chave: 'score', titulo: 'Pontuação', alinhar: 'direita', ordenavel: true, valor: (l) => l.score, render: (l) => <span className="num forte">{fmtPerc(l.score)}</span> },
      { chave: 'score_proj', titulo: 'Projeção', alinhar: 'direita', ordenavel: true, valor: (l) => l.score_proj, render: (l) => <span className="num">{fmtPerc(l.score_proj)}</span> },
      { chave: 'movimento', titulo: '7 dias', alinhar: 'centro', ordenavel: true, valor: (l) => l.movimento, render: (l) => <Movimento valor={l.movimento ?? null} /> },
      { chave: 'premio', titulo: 'Prêmio', alinhar: 'direita', ordenavel: true, valor: (l) => l.premio, render: (l) => <span className="num">{l.premio > 0 ? fmtMoeda(l.premio) : '-'}</span> },
      { chave: 'premio_proj', titulo: 'Prêmio proj.', alinhar: 'direita', ordenavel: true, valor: (l) => l.premio_proj, render: (l) => <span className="num sec">{l.premio_proj > 0 ? fmtMoeda(l.premio_proj) : '-'}</span> },
    ];
    const semProjecao = new Set(['score_proj', 'movimento', 'premio_proj']);
    const porCritVisiveis = estado.futura ? porCrit.filter((c) => !c.chave.startsWith('p')) : porCrit;
    return [...base, ...porCritVisiveis, ...(estado.futura || estado.encerrada ? fim.filter((c) => !semProjecao.has(c.chave)) : fim)];
  }, [ap, estado]);

  const visiveis = filtradas.slice(mostrarPodio ? 3 : 0, (mostrarPodio ? 3 : 0) + limite);

  return (
    <div>
      <div className="cmp-controles">
        <Entrada icone={Search} placeholder={`Buscar ${(ap.campanha?.nivel_singular || 'participante').toLowerCase()}`} value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(40); }} />
        {grupos.length > 1 && (
          <Seletor opcoes={grupos} valor={grupo} aoMudar={(v) => { setGrupo(v); setLimite(40); }} vazio="Todos os grupos" style={{ width: 220 }} />
        )}
        <Explica titulo="Como ler o ranking" {...EXPLICA.ranking} />
        <div className="cresce" />
        {andamento && modo === 'lista' && (
          <Segmentado
            tamanho="p"
            valor={visao}
            aoMudar={setVisao}
            opcoes={[
              { valor: 'atual', rotulo: 'Posição atual' },
              { valor: 'projetado', rotulo: 'Projeção final', icone: Sparkles, dica: 'Como o ranking termina se o ritmo de cada um se mantiver' },
            ]}
          />
        )}
        <Segmentado
          tamanho="p"
          valor={modo}
          aoMudar={setModo}
          opcoes={[
            { valor: 'lista', rotulo: 'Ranking', icone: Rows3 },
            { valor: 'tabela', rotulo: 'Tabela', icone: List },
          ]}
        />
      </div>

      {contagens.length > 1 && <div className="linha quebra" style={{ gap: 6, marginBottom: 14 }}>
        <Chip ativo={status === 'todos'} aoClicar={() => setStatus('todos')}>
          Todos <span className="num mudo">{ap.participantes.length}</span>
        </Chip>
        {contagens.map((s) => (
          <Chip key={s.chave} ativo={status === s.chave} aoClicar={() => { setStatus(status === s.chave ? 'todos' : s.chave); setLimite(40); }}>
            <span className="cmp-ponto-cor" style={{ background: s.cor, borderRadius: 99, width: 8, height: 8 }} />
            {s.rotulo} <span className="num mudo">{s.valor}</span>
          </Chip>
        ))}
      </div>}

      {!filtradas.length ? (
        <div className="cartao"><Vazio icone={Search} titulo="Ninguém encontrado" texto="Ajuste a busca ou os filtros." /></div>
      ) : modo === 'tabela' ? (
        <div className="cartao">
          <Tabela colunas={colunas} linhas={filtradas} chaveLinha={(l) => l.chave} aoClicarLinha={(l) => aoAbrir(l.chave)} selecionada={selecionada} densa maxAltura="70vh"
            ordenacaoInicial={{ chave: 'posicao', dir: 'asc' }} />
        </div>
      ) : (
        <>
          {mostrarPodio && <Podio linhas={filtradas} ap={ap} aoAbrir={aoAbrir} maxReal={maxReal} />}
          <ListaAnimada
            itens={visiveis}
            chave={(l) => l.chave}
            render={(l) => <LinhaRanking l={l} ap={ap} projetado={projetado} selecionada={selecionada === l.chave} aoAbrir={aoAbrir} maxReal={maxReal} estado={estado} />}
          />
          {filtradas.length > visiveis.length + (mostrarPodio ? 3 : 0) && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <Botao onClick={() => setLimite((x) => x + 60)}>
                Mostrar mais ({fmtNumero(filtradas.length - visiveis.length - (mostrarPodio ? 3 : 0))} restantes)
              </Botao>
            </div>
          )}
        </>
      )}
    </div>
  );
}
