import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, Search, UserRound } from 'lucide-react';
import { post } from '../../lib/api.js';
import { Entrada, Explica, Seletor, useToast } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { AvatarContato } from './comum.jsx';
import { CANAIS_ATD, COLUNAS, espera, horaCurta, nomeContato } from './util.js';

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PESO_PRIO = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

function Cartao({ c, aoAbrir, arrastando, setArrastando }) {
  const e = espera(c);
  const nome = nomeContato(c);
  return (
    <motion.div layout layoutId={`k-${c.id}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
      <div className={`atd-cartao${arrastando === c.id ? ' arrastando' : ''}${e && e.nivel !== 'ok' ? ` ${e.nivel}` : ''}`} draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData('text/plain', String(c.id));
          ev.dataTransfer.effectAllowed = 'move';
          setArrastando(c.id);
        }}
        onDragEnd={() => setArrastando(null)}
        onClick={() => aoAbrir(c.id)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && aoAbrir(c.id)}>
        <div className="linha" style={{ gap: 9 }}>
          <AvatarContato nome={nome} canal={c.canal} foto={c.vinculo?.foto} tamanho="p" />
          <div className="coluna cresce" style={{ gap: 0, minWidth: 0 }}>
            <strong className="truncar" style={{ fontSize: 13 }}>{nome}</strong>
            <span className="mini mudo truncar">{c.vinculo?.tipo ? `${c.vinculo.tipo === 'cliente' ? 'Cliente' : c.vinculo.tipo === 'gerente' ? 'Gerente' : 'Vendedor'}${c.vinculo.equipe ? ` · eq. ${c.vinculo.equipe.split(' ')[0]}` : ''}` : 'Não identificado'} · {CANAIS_ATD[c.canal]?.rotulo}</span>
          </div>
          {c.nao_lidas > 0 && <span className="atd-badge">{c.nao_lidas}</span>}
        </div>
        {c.assunto && c.canal === 'email' && <span className="pequeno forte truncar">{c.assunto}</span>}
        <span className="previa">{c.ultima_direcao === 'saida' ? 'Você: ' : c.ultima_direcao === 'bot' ? 'Bot: ' : ''}{c.ultima_previa || '-'}</span>
        <div className="linha entre mini mudo">
          <span className="linha g4">
            {c.responsavel ? <><UserRound size={11} /> {c.responsavel}</> : <span>Sem responsável</span>}
            {['alta', 'urgente'].includes(c.prioridade) && <span className={`atd-prio ${c.prioridade}`}>· {c.prioridade}</span>}
          </span>
          <span className="linha g4">
            {e && e.nivel !== 'ok' ? <span className={`atd-espera ${e.nivel}`}><Clock size={10} style={{ verticalAlign: -1 }} /> {e.texto}</span> : horaCurta(c.ultima_mensagem_em)}
          </span>
        </div>
        {c.etiquetas?.length > 0 && (
          <div className="atd-etiquetas">{c.etiquetas.slice(0, 4).map((t) => <span key={t} className="selo">{t}</span>)}</div>
        )}
      </div>
    </motion.div>
  );
}

export default function Kanban({ conversas, aplicarConversa, aoAbrir, responsaveis = [] }) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [canal, setCanal] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [arrastando, setArrastando] = useState(null);
  const [sobre, setSobre] = useState(null);
  const [verResolvidos, setVerResolvidos] = useState(30);

  const porColuna = useMemo(() => {
    const q = normalizar(busca.trim());
    const out = Object.fromEntries(COLUNAS.map((c) => [c.id, []]));
    for (const c of conversas || []) {
      if (canal && c.canal !== canal) continue;
      if (responsavel === '_sem' && c.responsavel) continue;
      if (responsavel && responsavel !== '_sem' && c.responsavel !== responsavel) continue;
      if (q && !normalizar([nomeContato(c), c.ultima_previa, c.assunto, c.responsavel, ...(c.etiquetas || [])].join(' ')).includes(q)) continue;
      out[c.status]?.push(c);
    }
    for (const k of ['novo', 'em_atendimento', 'aguardando']) {
      out[k].sort((a, b) => (PESO_PRIO[a.prioridade] ?? 2) - (PESO_PRIO[b.prioridade] ?? 2) || String(a.ultima_entrada_em || a.ultima_mensagem_em).localeCompare(String(b.ultima_entrada_em || b.ultima_mensagem_em)));
    }
    return out;
  }, [conversas, busca, canal, responsavel]);

  const mover = async (id, status) => {
    const c = (conversas || []).find((x) => x.id === id);
    if (!c || c.status === status) return;
    aplicarConversa({ ...c, status });
    try {
      aplicarConversa(await post(`/atendimento/conversas/${id}/status`, { status }));
    } catch (e) {
      aplicarConversa(c);
      toast.erro(e.message);
    }
  };

  return (
    <div className="coluna" style={{ flex: 1, minHeight: 0, gap: 0 }}>
      <div className="atd-kanban-topo">
        <div style={{ width: 280 }}><Entrada icone={Search} placeholder="Filtrar cartões…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <div style={{ width: 170 }}><Seletor valor={canal} aoMudar={setCanal} vazio="Todos os canais" opcoes={Object.entries(CANAIS_ATD).map(([k, v]) => ({ valor: k, rotulo: v.rotulo }))} /></div>
        <div style={{ width: 200 }}><Seletor valor={responsavel} aoMudar={setResponsavel} vazio="Qualquer responsável" opcoes={[{ valor: '_sem', rotulo: 'Sem responsável' }, ...responsaveis.map((r) => ({ valor: r, rotulo: r }))]} /></div>
        <span className="mudo pequeno">Arraste os cartões entre as colunas. A borda amarela indica mais de 2 h sem resposta; a vermelha, mais de 24 h.</span>
        <Explica titulo="Kanban de conversas" {...EXPLICA.atendimentoKanban} tamanho={13} />
      </div>
      <div className="atd-kanban">
        {COLUNAS.map((col) => {
          const lista = col.id === 'resolvido' ? porColuna[col.id].slice(0, verResolvidos) : porColuna[col.id];
          return (
            <section key={col.id} className={`atd-coluna${sobre === col.id ? ' sobre' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (sobre !== col.id) setSobre(col.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setSobre(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setSobre(null);
                const id = Number(e.dataTransfer.getData('text/plain'));
                if (id) mover(id, col.id);
              }}>
              <div className="atd-coluna-topo" title={col.descricao}>
                <span className="cor" style={{ background: col.cor }} />
                {col.rotulo}
                <span className="aba-contador">{porColuna[col.id].length}</span>
              </div>
              <div className="atd-coluna-lista">
                <AnimatePresence initial={false}>
                  {lista.map((c) => <Cartao key={c.id} c={c} aoAbrir={aoAbrir} arrastando={arrastando} setArrastando={setArrastando} />)}
                </AnimatePresence>
                {!porColuna[col.id].length && <div className="mudo pequeno" style={{ textAlign: 'center', padding: '24px 8px' }}>Solte aqui</div>}
                {col.id === 'resolvido' && porColuna[col.id].length > verResolvidos && (
                  <button type="button" className="botao fantasma p" onClick={() => setVerResolvidos((n) => n + 30)}>Mostrar mais {Math.min(30, porColuna[col.id].length - verResolvidos)}</button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
