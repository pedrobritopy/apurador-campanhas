import { BadgeCheck, Copy, MessageCircle } from 'lucide-react';
import { fmtUsd } from '../../lib/formato.js';
import { Botao, Carregando, Modal, Selo, useToast } from '../../componentes/ui.jsx';
import { MarcaVerificado } from './comum.jsx';

const limpar = (s) => String(s || '').replace(/\s*\[F-[^\]]+\]/g, '');

export function textoRoteiro(r) {
  if (!r) return '';
  return [
    limpar(r.abertura),
    '',
    ...r.roteiro.flatMap((c, i) => [`${i + 1}. ${c.cliente}`, `   Abordagem: ${limpar(c.abordagem)}`, ...c.argumentos.map((a) => `   • ${limpar(a)}`), `   Oferta: ${limpar(c.oferta)}`, '']),
    limpar(r.fechamento),
  ].join('\n');
}

/** Roteiro de abordagem gerado pela IA para os clientes escolhidos. */
export default function ModalRoteiro({ aberto, aoFechar, carregando, dados, telefone, vendedor }) {
  const toast = useToast();
  const r = dados?.resultado;
  const texto = textoRoteiro(r);
  const wa = telefone ? `https://wa.me/55${String(telefone).replace(/\D/g, '')}?text=${encodeURIComponent(`Roteiro de visitas de ${vendedor}\n\n${texto}`)}` : null;
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Roteiro de abordagem" subtitulo={dados ? `${dados.simulada ? 'simulação' : `custo ${fmtUsd(dados.custo_usd)}`} · baseado nos fatos do plano` : 'Gerando com IA…'} largura={760}
      rodape={r && (
        <>
          <Botao icone={Copy} onClick={() => { navigator.clipboard?.writeText(texto); toast.ok('Roteiro copiado'); }}>Copiar</Botao>
          {wa && <Botao variante="primario" icone={MessageCircle} onClick={() => window.open(wa, '_blank', 'noopener')}>Enviar no WhatsApp</Botao>}
        </>
      )}>
      {carregando || !r ? (
        <Carregando texto="Montando o roteiro a partir do plano…" />
      ) : (
        <div className="coluna" style={{ gap: 12 }}>
          {dados.verificacao && (
            <div className="linha g4">
              <Selo cor={dados.verificacao.aprovado ? 'bom' : 'serio'} icone={BadgeCheck}>{dados.verificacao.aprovado ? 'Conferido com os fatos do plano' : 'Conferência com ressalvas'}</Selo>
            </div>
          )}
          <p style={{ lineHeight: 1.6 }}>{limpar(r.abertura)}</p>
          {r.roteiro.map((c, i) => (
            <div key={i} className="ig-roteiro-cliente">
              <div className="linha entre">
                <span className="forte">{i + 1}. {c.cliente}</span>
                <MarcaVerificado verificado={c.verificado} detalhe={c.verificacao} />
              </div>
              <div className="pequeno"><span className="mudo">Abordagem:</span> {limpar(c.abordagem)}</div>
              <ul className="ig-evidencias" style={{ color: 'var(--tinta-2)' }}>{c.argumentos.map((a, k) => <li key={k}>{limpar(a)}</li>)}</ul>
              <div className="pequeno"><span className="mudo">Oferta:</span> <strong>{limpar(c.oferta)}</strong></div>
            </div>
          ))}
          <p className="sec pequeno" style={{ lineHeight: 1.6 }}>{limpar(r.fechamento)}</p>
        </div>
      )}
    </Modal>
  );
}
