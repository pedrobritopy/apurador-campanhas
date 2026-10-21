import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CornerDownLeft, Info, Sparkles, Undo2, XCircle } from 'lucide-react';
import { AreaTexto, Aviso, Botao, Chip, Selo, useToast } from '../../componentes/ui.jsx';
import { post } from '../../lib/api.js';
import { fmtUsd } from '../../lib/formato.js';

const EXEMPLOS = [
  'Quanto do faturamento vem dos canais digitais',
  'Share da Neosaldina dentro dos analgésicos',
  'Clientes curva A que compraram produtos Hypera',
  'Crescimento de unidades de Vick contra o mês passado',
  '1 ponto a cada R$ 100 vendidos e 10 pontos por cliente novo',
];

const FORMATO = { numero: 'número', moeda: 'R$', perc: '%', decimal: 'decimal' };

/**
 * Assistente que escreve a fórmula a partir de uma descrição em português (Claude Haiku, custo ~US$ 0,001).
 * aoAplicar(resultado) recebe { expressao, nome, descricao, formato, totalizar, sentido, pedido }.
 */
export default function AssistenteFormula({ expressaoAtual, aoAplicar, compacto = false }) {
  const toast = useToast();
  const [pedido, setPedido] = useState('');
  const [gerando, setGerando] = useState(false);
  const [resposta, setResposta] = useState(null);
  const [erro, setErro] = useState(null);
  const [anterior, setAnterior] = useState(null);

  const gerar = async (texto = pedido) => {
    if (!texto.trim() || gerando) return;
    setGerando(true);
    setErro(null);
    try {
      const r = await post('/ia/formula', { pedido: texto, expressao_atual: expressaoAtual || undefined });
      setResposta({ ...r, pedido: texto });
      if (r.valida) {
        setAnterior(expressaoAtual ?? null);
        aoAplicar({ ...r.resultado, pedido: texto });
        toast.ok('Fórmula gerada e aplicada no editor.');
      }
    } catch (e) {
      setErro(e);
    } finally {
      setGerando(false);
    }
  };

  const r = resposta?.resultado;
  return (
    <div className="ia-formula">
      <div className="ia-formula-cab">
        <span className="ia-formula-icone"><Sparkles size={15} /></span>
        <div className="cresce">
          <div className="forte pequeno">Descreva o que quer medir</div>
          {!compacto && <div className="mini mudo">A IA escreve a fórmula com as variáveis e os valores reais da sua base. O sistema confere antes de aplicar.</div>}
        </div>
      </div>
      <div className="ia-formula-entrada">
        <AreaTexto rows={compacto ? 2 : 2} value={pedido} placeholder="Ex.: participação das vendas para hospitais no total de Sanofi de cada vendedor"
          onChange={(e) => setPedido(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gerar(); } }} />
        <Botao variante="primario" icone={Sparkles} carregando={gerando} disabled={!pedido.trim()} onClick={() => gerar()} title="Enter para gerar">
          Gerar fórmula
        </Botao>
      </div>
      {!compacto && !resposta && (
        <div className="linha quebra" style={{ gap: 6 }}>
          {EXEMPLOS.map((ex) => (
            <Chip key={ex} onClick={() => { setPedido(ex); gerar(ex); }}>{ex}</Chip>
          ))}
        </div>
      )}
      {erro && <Aviso tipo={erro.status === 429 ? 'aviso' : 'erro'}>{erro.message}</Aviso>}
      <AnimatePresence>
        {r && (
          <motion.div className="ia-formula-res" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="linha entre" style={{ alignItems: 'flex-start' }}>
              <div className="coluna" style={{ gap: 2 }}>
                <span className="forte">{r.nome}</span>
                <span className="mini mudo">{r.descricao}</span>
              </div>
              {resposta.valida
                ? <Selo cor="bom" icone={CheckCircle2}>Validada</Selo>
                : <Selo cor="critico" icone={XCircle}>Não compila</Selo>}
            </div>
            <code className="cat-formula" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{r.expressao}</code>
            <div className="pequeno sec">{r.explicacao}</div>
            {r.suposicoes?.length > 0 && (
              <div className="ia-formula-sup">
                <Info size={13} />
                <div className="coluna" style={{ gap: 2 }}>
                  {r.suposicoes.map((s, i) => <span key={i} className="mini">{s}</span>)}
                </div>
              </div>
            )}
            {!resposta.valida && <Aviso tipo="aviso">{resposta.erro_validacao}. Ajuste o pedido ou edite a fórmula manualmente.</Aviso>}
            <div className="linha entre quebra" style={{ gap: 8 }}>
              <span className="mini mudo">
                {FORMATO[r.formato]} · {r.totalizar === 'media' ? 'totaliza pela média' : 'totaliza pela soma'} · {r.sentido === 'menor' ? 'menor é melhor' : 'maior é melhor'}
                {' · '}custo {fmtUsd(resposta.custo_usd)}{resposta.status ? ` · hoje ${fmtUsd(resposta.status.gasto_hoje_usd)} de ${fmtUsd(resposta.status.limite_diario_usd)}` : ''}
              </span>
              <div className="linha" style={{ gap: 6 }}>
                {!resposta.valida && <Botao tamanho="p" icone={CornerDownLeft} onClick={() => aoAplicar({ ...r, pedido: resposta.pedido })}>Aplicar mesmo assim</Botao>}
                {resposta.valida && anterior != null && anterior !== r.expressao && (
                  <Botao tamanho="p" variante="fantasma" icone={Undo2} onClick={() => { aoAplicar({ expressao: anterior, desfazer: true }); setAnterior(null); }}>Desfazer</Botao>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
