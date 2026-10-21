import { useId } from 'react';

/**
 * Rótulo para GRUPOS de controles (segmentado, chips, multisseleção).
 * O `Campo` do kit é um <label>: envolvendo vários botões, o clique no rótulo acionaria o primeiro botão
 * (na multisseleção, removeria o primeiro item). Aqui o rótulo nomeia um role="group".
 */
export default function CampoGrupo({ rotulo, ajuda, children, style }) {
  const id = useId();
  return (
    <div className="campo" role="group" aria-labelledby={id} style={style}>
      <span className="campo-rotulo" id={id}>{rotulo}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
      {ajuda && <span className="campo-ajuda">{ajuda}</span>}
    </div>
  );
}
