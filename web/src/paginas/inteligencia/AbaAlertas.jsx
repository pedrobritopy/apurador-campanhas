import { useMemo, useState } from 'react';
import { ArrowRight, BellOff, Users } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { navegar } from '../../lib/rotas.js';
import { fmtNumero, fmtRelativo } from '../../lib/formato.js';
import { Botao, Carregando, ErroCarga, Explica, ListaAnimada, Numero, Seletor, Selo, Vazio } from '../../componentes/ui.jsx';
import { EXPLICA_INSIGHTS, ICONE_TIPO_INSIGHT, SEVERIDADE, SeloSeveridade } from './comum.jsx';

const ORDEM = ['critica', 'alta', 'media', 'info', 'positiva'];

function CartaoAlerta({ a }) {
  const s = SEVERIDADE[a.severidade] || SEVERIDADE.info;
  const Ic = ICONE_TIPO_INSIGHT[a.tipo] || s.icone;
  return (
    <article className="ig-alerta">
      <span className="cor-faixa" style={{ background: s.corBarra }} />
      <div className="ig-tipo-icone" style={{ color: s.corBarra }}><Ic size={16} /></div>
      <div className="cresce" style={{ minWidth: 0 }}>
        <div className="linha quebra g4" style={{ gap: 6, marginBottom: 2 }}>
          <SeloSeveridade severidade={a.severidade} />
          {a.participantes?.length > 0 && <Selo icone={Users}>{fmtNumero(a.participantes.length)} participante(s)</Selo>}
        </div>
        <div className="ig-alerta-titulo">{a.titulo}</div>
        <div className="ig-alerta-desc">{a.descricao}</div>
      </div>
      {a.acao && (
        <div style={{ alignSelf: 'center', flex: 'none' }}>
          <Botao tamanho="p" variante="sutil" iconeDireita={ArrowRight} onClick={() => navegar(a.acao.rota)}>{a.acao.rotulo}</Botao>
        </div>
      )}
    </article>
  );
}

export default function AbaAlertas() {
  const { dados, erro, carregando, recarregar } = useApi('/insights', { intervalo: 120000 });
  const [sev, setSev] = useState(null);
  const [camp, setCamp] = useState('');
  const lista = dados || [];
  const contagem = useMemo(() => Object.fromEntries(ORDEM.map((s) => [s, lista.filter((a) => a.severidade === s).length])), [lista]);
  const campanhas = useMemo(() => {
    const m = new Map();
    for (const a of lista) if (a.campanha_id) m.set(a.campanha_id, a.campanha);
    return [...m].map(([valor, rotulo]) => ({ valor: String(valor), rotulo }));
  }, [lista]);
  const filtrados = lista.filter((a) => (!sev || a.severidade === sev) && (!camp || String(a.campanha_id) === camp));
  const grupos = useMemo(() => {
    const g = new Map();
    for (const a of filtrados) {
      const k = a.campanha_id ? `c${a.campanha_id}` : 'dados';
      if (!g.has(k)) g.set(k, { titulo: a.campanha || 'Dados e sistema', itens: [] });
      g.get(k).itens.push(a);
    }
    return [...g.values()];
  }, [filtrados]);

  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (carregando && !dados) return <Carregando texto="Analisando campanhas…" />;

  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {ORDEM.map((s) => {
          const def = SEVERIDADE[s];
          return (
            <button key={s} type="button" className={`cartao kpi ig-sev-kpi${sev === s ? ' ativo' : ''}`} onClick={() => setSev(sev === s ? null : s)} title={`Filtrar: ${def.rotulo}`}>
              <div className="kpi-rotulo"><def.icone size={15} style={{ color: def.corBarra }} /> {def.rotulo}</div>
              <div className="kpi-valor"><Numero valor={contagem[s]} /></div>
            </button>
          );
        })}
      </div>
      <div className="linha entre quebra">
        <div className="linha">
          <Seletor opcoes={campanhas} valor={camp} aoMudar={setCamp} vazio="Todas as campanhas" tamanho="p" style={{ width: 280 }} />
          {(sev || camp) && <Botao tamanho="p" variante="fantasma" onClick={() => { setSev(null); setCamp(''); }}>Limpar filtros</Botao>}
          <Explica titulo="Níveis de urgência" {...EXPLICA_INSIGHTS.severidade} />
        </div>
        <span className="mudo pequeno linha g4">
          {fmtNumero(filtrados.length)} alerta(s) · regras automáticas, sem custo de IA{lista[0]?.gerado_em ? ` · ${fmtRelativo(lista[0].gerado_em)}` : ''}
          <Explica titulo="Como os alertas são gerados" {...EXPLICA_INSIGHTS.alertas} />
        </span>
      </div>
      {!filtrados.length ? (
        <Vazio icone={BellOff} titulo="Nenhum alerta com esses filtros" texto="As regras verificam meta, ritmo, estoque, orçamento, faixas de prêmio e acompanhamento em todas as campanhas ativas." />
      ) : (
        grupos.map((g) => (
          <section key={g.titulo}>
            <div className="ig-grupo-campanha">{g.titulo} · {g.itens.length}</div>
            <ListaAnimada itens={g.itens} chave={(a) => a.id} gap={8} render={(a) => <CartaoAlerta a={a} />} />
          </section>
        ))
      )}
    </div>
  );
}
