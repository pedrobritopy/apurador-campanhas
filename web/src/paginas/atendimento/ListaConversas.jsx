import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, Inbox, Search } from 'lucide-react';
import { Entrada, Segmentado, Seletor, Vazio } from '../../componentes/ui.jsx';
import { AvatarContato } from './comum.jsx';
import { CANAIS_ATD, espera, horaCurta, nomeContato } from './util.js';

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Item({ c, ativa, aoEscolher }) {
  const anterior = useRef(c.nao_lidas);
  const [pulso, setPulso] = useState(false);
  useEffect(() => {
    if (c.nao_lidas > anterior.current) {
      setPulso(true);
      const t = setTimeout(() => setPulso(false), 900);
      anterior.current = c.nao_lidas;
      return () => clearTimeout(t);
    }
    anterior.current = c.nao_lidas;
    return undefined;
  }, [c.nao_lidas]);
  const e = espera(c);
  const quem = c.ultima_direcao === 'saida' ? 'Você: ' : c.ultima_direcao === 'bot' ? 'Bot: ' : '';
  const nome = nomeContato(c);
  return (
    <div className={`atd-item${ativa ? ' ativo' : ''}${c.nao_lidas ? ' nao-lida' : ''}`} onClick={() => aoEscolher(c.id)} role="button" tabIndex={0}
      onKeyDown={(ev) => ev.key === 'Enter' && aoEscolher(c.id)}>
      <AvatarContato nome={nome} canal={c.canal} foto={c.vinculo?.foto} />
      <div className="coluna" style={{ gap: 2, minWidth: 0 }}>
        <div className="linha g4" style={{ minWidth: 0 }}>
          <span className="nome truncar">{nome}</span>
          {c.vinculo?.tipo && <span className="mudo mini truncar">· {c.vinculo.tipo === 'cliente' ? 'cliente' : c.vinculo.equipe ? `eq. ${c.vinculo.equipe.split(' ')[0]}` : c.vinculo.tipo}</span>}
        </div>
        <span className="previa truncar">
          <span className="quem">{quem}</span>
          {c.ultima_previa || (c.assunto ? c.assunto : '-')}
        </span>
      </div>
      <div className="lado">
        <span className="hora">{horaCurta(c.ultima_mensagem_em)}</span>
        <div className="linha g4">
          {e && e.nivel !== 'ok' && <span className={`atd-espera ${e.nivel}`} title="Esperando resposta">{e.texto}</span>}
          {c.nao_lidas > 0 && <span className={`atd-badge${pulso ? ' pulsa' : ''}`}>{c.nao_lidas}</span>}
        </div>
      </div>
    </div>
  );
}

export default function ListaConversas({ conversas, ativa, aoEscolher, responsaveis = [] }) {
  const [modo, setModo] = useState('abertas');
  const [canal, setCanal] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [busca, setBusca] = useState('');

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return (conversas || []).filter((c) => {
      if (modo === 'abertas' && c.status === 'resolvido') return false;
      if (modo === 'resolvidas' && c.status !== 'resolvido') return false;
      if (modo === 'nao_lidas' && !c.nao_lidas) return false;
      if (canal && c.canal !== canal) return false;
      if (responsavel === '_sem' && c.responsavel) return false;
      if (responsavel && responsavel !== '_sem' && c.responsavel !== responsavel) return false;
      if (q && !normalizar([nomeContato(c), c.contato?.username, c.contato?.email, c.contato?.telefone, c.ultima_previa, c.assunto, c.responsavel, ...(c.etiquetas || [])].join(' ')).includes(q)) return false;
      return true;
    });
  }, [conversas, modo, canal, responsavel, busca]);

  const naoLidas = (conversas || []).filter((c) => c.nao_lidas > 0).length;

  return (
    <aside className="atd-lista" aria-label="Conversas">
      <div className="atd-lista-topo">
        <Entrada icone={Search} placeholder="Buscar nome, telefone, mensagem…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Segmentado tamanho="p" valor={modo} aoMudar={setModo} opcoes={[
          { valor: 'abertas', rotulo: 'Abertas' },
          { valor: 'nao_lidas', rotulo: `Não lidas${naoLidas ? ` (${naoLidas})` : ''}` },
          { valor: 'resolvidas', rotulo: 'Resolvidas' },
          { valor: 'todas', rotulo: 'Todas' },
        ]} />
        <div className="linha">
          <Seletor tamanho="p" valor={canal} aoMudar={setCanal} vazio="Todos os canais" opcoes={Object.entries(CANAIS_ATD).map(([k, v]) => ({ valor: k, rotulo: v.rotulo }))} />
          <Seletor tamanho="p" valor={responsavel} aoMudar={setResponsavel} vazio="Qualquer responsável" opcoes={[{ valor: '_sem', rotulo: 'Sem responsável' }, ...responsaveis.map((r) => ({ valor: r, rotulo: r }))]} />
        </div>
      </div>
      <div className="atd-itens">
        {conversas && !lista.length && (
          <Vazio icone={modo === 'abertas' ? Bot : Inbox} titulo={modo === 'abertas' ? 'Nenhuma conversa aberta' : 'Nada por aqui'}
            texto={modo === 'abertas' ? 'Tudo respondido. As interações resolvidas pelo bot ficam em "Resolvidas".' : 'Ajuste os filtros ou a busca.'} />
        )}
        <AnimatePresence initial={false}>
          {lista.map((c) => (
            <motion.div key={c.id} layout="position" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38, opacity: { duration: 0.15 } }}>
              <Item c={c} ativa={c.id === ativa} aoEscolher={aoEscolher} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </aside>
  );
}
