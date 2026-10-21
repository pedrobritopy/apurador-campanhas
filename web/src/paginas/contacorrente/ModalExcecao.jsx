import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { fmtMoeda } from '../../lib/formato.js';
import { AreaTexto, Aviso, Botao, Campo, Entrada, Modal } from '../../componentes/ui.jsx';
import { EXPLICA } from './util.js';

/** Detalhes do bloqueio quando o servidor recusa por falta de saldo (erro 409), ou null. */
export function bloqueioContaCorrente(e) {
  const d = e?.corpo?.detalhes;
  return e?.status === 409 && d?.codigo === 'saldo_insuficiente' ? { mensagem: e.message, ...d.conta_corrente } : null;
}

/**
 * Pede justificativa para ativar uma campanha (ou lançar um débito) sem saldo.
 * aoConfirmar({ justificativa, autorizado_por }) deve repetir a chamada com `excecao_conta_corrente`.
 */
export default function ModalExcecao({ bloqueio, aoFechar, aoConfirmar }) {
  const [justificativa, setJustificativa] = useState('');
  const [autorizado, setAutorizado] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (bloqueio) { setJustificativa(''); setAutorizado(''); }
  }, [bloqueio]);
  const ok = justificativa.trim().length >= 10;

  return (
    <Modal aberto={Boolean(bloqueio)} aoFechar={aoFechar} titulo="Saldo insuficiente na conta corrente" subtitulo={bloqueio?.nome} largura={560}
      rodape={(
        <>
          <Botao variante="fantasma" onClick={aoFechar}>Voltar</Botao>
          <Botao variante="perigo" icone={ShieldAlert} disabled={!ok} carregando={enviando}
            onClick={async () => {
              setEnviando(true);
              try { await aoConfirmar({ justificativa: justificativa.trim(), autorizado_por: autorizado.trim() || null }); } finally { setEnviando(false); }
            }}>
            Ativar com exceção
          </Botao>
        </>
      )}>
      {bloqueio && (
        <div className="coluna" style={{ gap: 14 }}>
          <Aviso tipo="erro">{bloqueio.mensagem}</Aviso>
          <div className="ccr-saldo-numeros">
            <div><span className="r">Disponível (com limite)</span><span className="v num">{fmtMoeda(bloqueio.capacidade)}</span></div>
            <div><span className="r">Precisa reservar</span><span className="v num">{fmtMoeda(bloqueio.necessario)}</span></div>
            <div><span className="r">Falta</span><span className="v num">{fmtMoeda(bloqueio.falta)}</span></div>
          </div>
          {bloqueio.texto && <div className="mudo pequeno">{bloqueio.texto}</div>}
          <Campo rotulo="Justificativa da exceção" info={EXPLICA.excecao} ajuda="Mínimo de 10 caracteres. Fica registrada na reserva.">
            <AreaTexto rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: diretoria aprovou; a ND da rebaixa de abril cobre a diferença." />
          </Campo>
          <Campo rotulo="Autorizado por">
            <Entrada value={autorizado} onChange={(e) => setAutorizado(e.target.value)} placeholder="Nome ou cargo de quem aprovou" />
          </Campo>
        </div>
      )}
    </Modal>
  );
}
