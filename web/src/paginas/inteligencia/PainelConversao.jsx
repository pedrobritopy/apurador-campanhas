import { FlaskConical, Repeat } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc, fmtRelativo } from '../../lib/formato.js';
import { Cartao, Esqueleto, Explica, Selo } from '../../componentes/ui.jsx';
import { EXPLICA_PLANO, TIPO_PLANO } from './comum.jsx';

const STATUS_REC = { aberta: { cor: 'acento', rotulo: 'Em aberto' }, convertida: { cor: 'bom', rotulo: 'Convertida' }, expirada: { cor: 'neutro', rotulo: 'Expirada' } };

/** De onde veio a taxa, em palavras. */
function origemTaxa(l) {
  const partes = [];
  if (l.backtest?.total) partes.push(`teste no histórico: ${fmtNumero(l.backtest.convertidas)} de ${fmtNumero(l.backtest.total)} compraram`);
  else partes.push('referência de mercado (ainda sem histórico suficiente)');
  if (l.registros.total) partes.push(`planos registrados: ${fmtNumero(l.registros.convertidas)} de ${fmtNumero(l.registros.total)}`);
  if (l.registros.abertas) partes.push(`${fmtNumero(l.registros.abertas)} em aberto`);
  return partes.join(' · ');
}

/** Retroalimentação: quanto cada tipo de sugestão de fato converte (backtest + registros). */
export default function PainelConversao({ vendedor, versao }) {
  const { dados: resumo } = useApi(`/recomendacoes/resumo${versao ? `?v=${versao}` : ''}`);
  const { dados: recentes } = useApi(vendedor ? `/recomendacoes?vendedor=${vendedor}${versao ? `&v=${versao}` : ''}` : null);
  if (!resumo) {
    return <div className="cartao" style={{ padding: 16 }}><Esqueleto altura={14} largura="50%" /><Esqueleto altura={36} linhas={5} style={{ marginTop: 14 }} /></div>;
  }
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <Cartao titulo="Chance de cada ação dar certo" subtitulo="De cada 100 ações do tipo, quantas viraram compra em até 30 dias" acoes={<Repeat size={15} className="mudo" />}
        info={EXPLICA_PLANO.conversao}>
        <div>
          {resumo.por_tipo.map((l) => {
            const t = TIPO_PLANO[l.tipo];
            return (
              <div key={l.tipo} className="ig-conv-linha">
                <span className="ig-tipo-icone" style={{ color: t.cor, width: 24, height: 24 }}><t.icone size={13} /></span>
                <span className="pequeno forte linha g4" style={{ minWidth: 0 }}>
                  <span className="truncar">{l.rotulo}</span>
                  <Explica titulo={l.rotulo} {...t.explica} tamanho={12} />
                </span>
                <span className="ig-conv-taxa">{fmtPerc(l.taxa * 100, 1)}</span>
                <span />
                <span className="mini mudo" style={{ gridColumn: '2 / 4' }}>{origemTaxa(l)}</span>
              </div>
            );
          })}
        </div>
        <div className="mini mudo" style={{ paddingTop: 10, lineHeight: 1.5 }}>
          <FlaskConical size={12} style={{ verticalAlign: -2 }} /> O teste no histórico aplica a regra {resumo.backtest?.referencia ? `como se fosse ${fmtData(resumo.backtest.referencia)}` : 'como se fosse 30 dias atrás'} e confere quem comprou nos 30 dias seguintes.
          {resumo.atualizado_em ? ` Conferido ${fmtRelativo(resumo.atualizado_em)}.` : ''}
        </div>
      </Cartao>
      <Cartao titulo="Planos registrados" subtitulo={`${fmtNumero(resumo.total)} ações registradas · ${fmtNumero(resumo.convertidas)} viraram compra · ${fmtMoeda(resumo.valor_convertido)}`}
        info={EXPLICA_PLANO.statusRec}>
        {!vendedor ? (
          <div className="mudo pequeno">Escolha um vendedor para ver as ações registradas para ele.</div>
        ) : !recentes?.length ? (
          <div className="mudo pequeno">Nenhuma ação registrada para este vendedor ainda. Marque os clientes e clique em "Registrar plano" para acompanhar o resultado.</div>
        ) : (
          <div className="coluna" style={{ gap: 8, maxHeight: 340, overflowY: 'auto' }}>
            {recentes.slice(0, 30).map((r) => (
              <div key={r.id} className="linha entre" style={{ gap: 8 }}>
                <div className="coluna" style={{ gap: 0, minWidth: 0 }}>
                  <span className="truncar pequeno forte">{r.cliente}</span>
                  <span className="mini mudo">{r.tipo_rotulo} · {fmtData(r.data_base)}</span>
                </div>
                <Selo cor={STATUS_REC[r.status]?.cor}>{STATUS_REC[r.status]?.rotulo || r.status}{r.status === 'convertida' && r.valor_convertido ? ` · ${fmtMoeda(r.valor_convertido)}` : ''}</Selo>
              </div>
            ))}
          </div>
        )}
      </Cartao>
    </div>
  );
}
