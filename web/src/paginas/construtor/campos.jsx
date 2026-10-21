import { EntradaNumero as EntradaNumeroBase } from '../../componentes/ui.jsx';

/** EntradaNumero que reserva espaço à direita para o sufixo (R$, %, un, clientes…), evitando sobreposição. */
export function EntradaNumero({ sufixo, style, ...resto }) {
  const espaco = sufixo ? { paddingRight: 16 + String(sufixo).length * 7.4 } : null;
  return <EntradaNumeroBase sufixo={sufixo} style={{ ...espaco, ...style }} {...resto} />;
}
