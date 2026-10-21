import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { get } from '../lib/api.js';

/**
 * Pílula discreta no topo: aparece só enquanto a pipeline de dados processa (ou se uma etapa falhou).
 * Quando o processamento termina, avisa as telas (evento "dados-atualizados") para buscarem o resultado novo.
 */
export default function IndicadorPipeline() {
  const [estado, setEstado] = useState(null);
  const anterior = useRef(false);

  useEffect(() => {
    let vivo = true;
    let timer = null;
    const consultar = async () => {
      try {
        const r = await get('/pipeline/resumo');
        if (!vivo) return;
        const ocupado = r.rodando || r.pendente;
        if (anterior.current && !ocupado) window.dispatchEvent(new Event('dados-atualizados'));
        anterior.current = ocupado;
        setEstado(r);
        timer = setTimeout(consultar, ocupado ? 2500 : 8000);
      } catch {
        if (vivo) timer = setTimeout(consultar, 15000);
      }
    };
    consultar();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, []);

  if (!estado) return null;
  if (estado.rodando || estado.pendente) {
    return (
      <a href="#/dados" className="pilula" style={{ textDecoration: 'none' }}
        title={estado.descricao ? `Processando: ${estado.descricao} As telas mostram o último resultado pronto até terminar.` : 'Processando os dados em segundo plano. As telas mostram o último resultado pronto até terminar.'}>
        <RefreshCw size={13} className="girando" /> Atualizando dados...
      </a>
    );
  }
  if (estado.erros > 0) {
    return (
      <a href="#/dados" className="pilula" style={{ textDecoration: 'none', color: 'var(--aviso-texto)' }} title="Uma etapa do processamento de dados falhou. Veja em Dados.">
        <AlertTriangle size={13} /> Processamento com erro
      </a>
    );
  }
  return null;
}
