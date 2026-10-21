import { useCallback, useState } from 'react';
import { Botao, Modal } from '../../componentes/ui.jsx';

/**
 * Diálogo de confirmação baseado em Promise.
 *   const [confirmar, dialogo] = useConfirmar();
 *   if (await confirmar({ titulo, texto, rotulo: 'Excluir', perigo: true })) ...
 *   ... e renderize {dialogo} em algum lugar da página.
 */
export function useConfirmar() {
  const [estado, setEstado] = useState(null);
  const confirmar = useCallback((opcoes) => new Promise((resolver) => setEstado({ ...opcoes, resolver })), []);
  const fechar = (ok) => {
    estado?.resolver(ok);
    setEstado(null);
  };
  const dialogo = (
    <Modal
      aberto={Boolean(estado)}
      aoFechar={() => fechar(false)}
      titulo={estado?.titulo || 'Confirmar'}
      largura={480}
      rodape={
        <>
          <Botao variante="fantasma" onClick={() => fechar(false)}>Cancelar</Botao>
          <Botao variante={estado?.perigo ? 'perigo' : 'primario'} onClick={() => fechar(true)} autoFocus>
            {estado?.rotulo || 'Confirmar'}
          </Botao>
        </>
      }
    >
      <div className="sec" style={{ whiteSpace: 'pre-line' }}>{estado?.texto}</div>
    </Modal>
  );
  return [confirmar, dialogo];
}
