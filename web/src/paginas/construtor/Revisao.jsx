import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardCopy, FileText, XCircle } from 'lucide-react';
import { Botao, useToast } from '../../componentes/ui.jsx';
import { regulamento, regulamentoTexto } from './util.js';

/** Regulamento legível + pendências + definição técnica. */
export default function Revisao({ def, catalogo, dimensoes, pend, aoIrPara }) {
  const toast = useToast();
  const [json, setJson] = useState(false);
  const secoes = useMemo(() => regulamento(def, { catalogo, dimensoes }), [def, catalogo, dimensoes]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(regulamentoTexto(def, { catalogo, dimensoes }));
      toast.ok('Regulamento copiado. É só colar no WhatsApp ou no e-mail.');
    } catch {
      toast.erro('Não foi possível copiar.');
    }
  };

  return (
    <div className="coluna" style={{ gap: 14 }}>
      {pend.erros.length === 0 && pend.alertas.length === 0 ? (
        <div className="aviso-caixa ok"><CheckCircle2 size={16} /><div>Tudo pronto. Revise o regulamento abaixo e salve.</div></div>
      ) : (
        <div className="coluna" style={{ gap: 6 }}>
          {pend.erros.map((e, i) => (
            <button key={`e${i}`} type="button" className="aviso-caixa erro" style={{ border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => aoIrPara(e.secao)}>
              <XCircle size={16} /><div>{e.texto}</div>
            </button>
          ))}
          {pend.alertas.map((e, i) => (
            <button key={`a${i}`} type="button" className="aviso-caixa aviso" style={{ border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => aoIrPara(e.secao)}>
              <AlertTriangle size={16} /><div>{e.texto}</div>
            </button>
          ))}
        </div>
      )}

      <div className="cons-subcampo" style={{ background: 'var(--superficie)', boxShadow: 'inset 0 0 0 1px var(--borda)' }}>
        <div className="linha entre">
          <span className="cons-subcampo-titulo"><FileText size={13} /> Regulamento</span>
          <Botao tamanho="p" icone={ClipboardCopy} onClick={copiar}>Copiar texto</Botao>
        </div>
        {secoes.map((s) => (
          <div key={s.titulo} className="coluna" style={{ gap: 4 }}>
            <span className="cat-rot">{s.titulo}</span>
            {s.itens.map((t, i) => (
              <p key={i} className="pequeno" style={{ lineHeight: 1.55, color: 'var(--tinta)' }}>{/^\d+\./.test(t) ? t : `• ${t}`}</p>
            ))}
          </div>
        ))}
      </div>

      <div>
        <Botao tamanho="p" variante="fantasma" iconeDireita={json ? ChevronUp : ChevronDown} onClick={() => setJson((j) => !j)}>Definição técnica (JSON)</Botao>
        {json && (
          <pre className="cons-codigo" style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>{JSON.stringify(def, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
