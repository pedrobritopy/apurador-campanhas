import { Check, MapPin, Package } from 'lucide-react';
import { fmtMoeda, fmtPerc } from '../../lib/formato.js';
import { Explica, Progresso, Selo } from '../../componentes/ui.jsx';
import { EXPLICA_PLANO, TIPO_PLANO } from './comum.jsx';
import { useProdutos } from '../../lib/dados.js';
import { FotoProduto, LogoMarca } from '../../componentes/Imagens.jsx';

/** Produto ou marca sugerido, com foto/logo. */
function Sugestao({ p }) {
  const { dados: produtos } = useProdutos();
  const id = p.produto ? (produtos || []).find((x) => x.nome === p.produto)?.id : null;
  return (
    <span className="ig-sugestao" title={p.marca || p.produto}>
      {p.marca ? <LogoMarca nome={p.marca} tamanho={20} /> : id != null ? <FotoProduto id={id} nome={p.produto} tamanho={20} titulo={false} /> : null}
      <span className="truncar">{p.marca || p.produto}</span>
    </span>
  );
}

const COR_RFV = {
  'Campeões': 'bom', 'Leais': 'bom', 'Potenciais leais': 'acento', 'Novos': 'acento', 'Promissores': 'acento',
  'Precisam de atenção': 'aviso', 'Quase dormindo': 'aviso', 'Em risco': 'serio', 'Não pode perder': 'critico', 'Hibernando': 'serio', 'Perdidos': 'critico',
};

const EXPLICA_PERFIL = {
  titulo: 'Curva e perfil do cliente',
  texto: 'Dois jeitos rápidos de saber quem é o cliente antes de ligar.',
  como: [
    'Curva A, B ou C: A são os clientes que mais compram (juntos, 80% do faturamento dos últimos 90 dias); C são os que menos compram.',
    'Perfil: resume há quanto tempo ele comprou, com que frequência e quanto. "Campeões" e "Leais" compram muito e sempre; "Em risco" e "Hibernando" estão sumindo; "Perdidos" pararam.',
  ],
};

/** Cartão de um item do plano de ataque (cliente + motivo + o que oferecer + valor). */
export default function PlanoCartao({ item, selecionado, aoAlternar, maxScore }) {
  const t = TIPO_PLANO[item.tipo] || TIPO_PLANO.recompra;
  const provavel = item.valor_potencial * item.probabilidade;
  return (
    <article className={`ig-plano${selecionado ? ' sel' : ''}`} onClick={aoAlternar} role="checkbox" aria-checked={selecionado} tabIndex={0}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); aoAlternar(); } }}>
      <span className="ig-marcador">{selecionado && <Check size={12} strokeWidth={3} />}</span>
      <div className="coluna" style={{ gap: 6, minWidth: 0 }}>
        <div className="linha quebra" style={{ gap: 8 }}>
          <span className="ig-tipo-icone" style={{ color: t.cor, width: 24, height: 24 }}><t.icone size={14} /></span>
          <span className="forte" style={{ fontSize: 14.5 }}>{item.cliente}</span>
          <span className="mudo pequeno linha g4"><MapPin size={12} /> {item.cidade}/{item.estado}</span>
          {item.curva && <Selo>Curva {item.curva}</Selo>}
          {item.segmento_rfv && <Selo cor={COR_RFV[item.segmento_rfv]}>{item.segmento_rfv}</Selo>}
          {(item.curva || item.segmento_rfv) && <Explica {...EXPLICA_PERFIL} tamanho={13} />}
        </div>
        <div className="linha g4" style={{ gap: 6 }}>
          <Selo cor="contorno">{t.rotulo}</Selo>
          <Explica titulo={t.rotulo} {...t.explica} tamanho={13} />
          {item.campanha && <Selo cor="acento">{item.campanha.nome}</Selo>}
          {item.registrada && <Selo cor="bom" icone={Check} title="Já está num plano registrado, aguardando a compra">Registrada</Selo>}
        </div>
        <div style={{ fontWeight: 600 }}>{item.titulo}</div>
        <div className="pequeno sec" style={{ lineHeight: 1.55 }}>{item.motivo}</div>
        {item.evidencias?.length > 0 && (
          <ul className="ig-evidencias">
            {item.evidencias.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {item.produtos_sugeridos?.length > 0 && (
          <div className="linha quebra" style={{ gap: 6 }}>
            <span className="mini mudo linha g4"><Package size={12} /> Oferecer:</span>
            {item.produtos_sugeridos.map((p, i) => <Sugestao key={i} p={p} />)}
          </div>
        )}
      </div>
      <div className="ig-plano-valor">
        <span className="mini mudo linha g4">potencial <Explica titulo="Potencial desta ação" texto={t.explica.como.find((c) => c.includes('potencial')) || EXPLICA_PLANO.potencial.texto} tamanho={12} /></span>
        <span style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em' }} className="num">{fmtMoeda(item.valor_potencial)}</span>
        <span className="mini sec linha g4">
          {fmtPerc(item.probabilidade * 100)} de chance · ≈ {fmtMoeda(provavel)}
          <Explica titulo="Chance de dar certo" {...EXPLICA_PLANO.conversao} tamanho={12} />
        </span>
        <div style={{ width: 150 }}>
          <Progresso valor={maxScore ? (item.score / maxScore) * 100 : 0} cor="acento" espessura="p" titulo="Prioridade em relação à primeira da lista" />
        </div>
        <span className="mini mudo linha g4">prioridade <Explica titulo="Prioridade" {...EXPLICA_PLANO.prioridade} tamanho={12} /></span>
      </div>
    </article>
  );
}
