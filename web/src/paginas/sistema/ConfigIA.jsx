import { useEffect, useMemo, useState } from 'react';
import { Brain, KeyRound, Save, ShieldCheck } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { fmtDataCurta, fmtNumero, fmtUsd } from '../../lib/formato.js';
import { Alternador, Anel, Aviso, Botao, Campo, Cartao, Carregando, EntradaNumero, Segmentado, Selo } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { GraficoColunas } from '../../componentes/graficos.jsx';
import CampoGrupo from './CampoGrupo.jsx';

export default function ConfigIA({ config, status, aoSalvar }) {
  const { dados: stIa, erro, recarregar } = useApi('/ia/status');
  // Sem /api/ia/status, usa o resumo de /api/status (gasto do dia e limite) como alternativa.
  const st = stIa || (status?.ia ? { ...status.ia, chamadas_hoje: null, gasto_mes_usd: null, historico: [] } : null);
  const ia0 = () => ({ habilitada: true, modelo: 'claude-haiku-5-5', limite_diario_usd: 5, esforco: 'low', ...(config.ia || {}) });
  const [ia, setIa] = useState(ia0);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setIa(ia0()), [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const sujo = JSON.stringify(ia) !== JSON.stringify(ia0());
  const uso = st?.limite_diario_usd > 0 ? ((st.gasto_hoje_usd || 0) / st.limite_diario_usd) * 100 : 0;
  const historico = useMemo(() => (st?.historico || []).map((h) => ({ rotulo: h.dia, valor: h.custo_usd || 0 })), [st]);

  async function salvar() {
    setSalvando(true);
    try {
      await aoSalvar({ ia: { ...ia, limite_diario_usd: Math.max(0, Number(ia.limite_diario_usd) || 0) } });
      recarregar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="config-grade">
      <Cartao titulo="Consumo de IA" subtitulo="Claude Haiku 5.5, o modelo mais econômico da Anthropic" info={EXPLICA.configIa}
        acoes={st?.configurada ? <Selo cor="bom" icone={ShieldCheck}>Chave configurada</Selo> : <Selo cor="aviso" icone={KeyRound}>Sem chave</Selo>}>
        {erro && !st && <Aviso tipo="aviso" titulo="Status da IA indisponível">{erro.message}</Aviso>}
        {!st && !erro && <Carregando altura={160} />}
        {erro && st && !stIa && <div className="mini mudo" style={{ marginBottom: 10 }}>Detalhamento de uso indisponível no momento. Mostrando o resumo do dia.</div>}
        {st && (
          <div className="coluna" style={{ gap: 16 }}>
            <div className="ia-medidor">
              <Anel valor={uso} tamanho={116} rotulo="do limite" cor={uso > 90 ? 'var(--critico)' : uso > 70 ? 'var(--aviso)' : 'var(--bom)'} />
              <div className="coluna" style={{ gap: 6 }}>
                <div><span style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em' }}>{fmtUsd(st.gasto_hoje_usd || 0)}</span> <span className="mudo">de {fmtUsd(st.limite_diario_usd || 0)} hoje</span></div>
                {st.chamadas_hoje != null && (
                  <div className="pequeno sec">{fmtNumero(st.chamadas_hoje || 0)} chamada{st.chamadas_hoje === 1 ? '' : 's'} hoje · {fmtUsd(st.gasto_mes_usd || 0)} no mês</div>
                )}
                <div className="pequeno sec">Modelo: <span className="mono">{st.modelo || ia.modelo}</span></div>
                {st.chave_mascarada && <div><span className="chave-mascarada">{st.chave_mascarada}</span></div>}
              </div>
            </div>
            {historico.length > 0 ? (
              <div>
                <div className="campo-rotulo" style={{ marginBottom: 6 }}>Custo diário nos últimos 30 dias (US$)</div>
                <GraficoColunas itens={historico} formato="decimal" altura={150} formatarX={fmtDataCurta} />
              </div>
            ) : <div className="mini mudo">Nenhum uso registrado ainda.</div>}
          </div>
        )}
      </Cartao>

      <Cartao titulo="Limites e preferências" subtitulo="Proteções para não gastar além do previsto">
        <div className="config-form">
          <Alternador ligado={Boolean(ia.habilitada)} aoMudar={(v) => setIa({ ...ia, habilitada: v })} rotulo="IA habilitada" descricao="Desligada, a Central de Insights continua com os alertas automáticos (custo zero)." />
          <Campo rotulo="Limite diário de gasto" ajuda="Ao atingir o limite, novas análises são bloqueadas até o dia seguinte. A verificação considera o pior caso antes de cada chamada.">
            <div style={{ width: 180 }}>
              <EntradaNumero valor={ia.limite_diario_usd} aoMudar={(v) => setIa({ ...ia, limite_diario_usd: v ?? 0 })} sufixo="US$" min={0} style={{ paddingRight: 44 }} />
            </div>
          </Campo>
          <CampoGrupo rotulo="Profundidade de raciocínio" ajuda="Econômico pensa menos e custa menos; equilibrado aprofunda um pouco mais.">
            <Segmentado valor={ia.esforco || 'low'} aoMudar={(v) => setIa({ ...ia, esforco: v })} opcoes={[
              { valor: 'low', rotulo: 'Econômico', icone: Brain },
              { valor: 'medium', rotulo: 'Equilibrado' },
            ]} />
          </CampoGrupo>
          <div className="config-rodape">
            {sujo && <span className="sujo">● Não salvo</span>}
            <Botao variante="primario" icone={Save} disabled={!sujo} carregando={salvando} onClick={salvar}>Salvar</Botao>
          </div>
          <Aviso tipo="info" titulo="Como o custo fica baixo">
            O motor calcula tudo antes (fatos validados) e a IA só lê o resultado, sem fazer contas. Análises ficam guardadas e só são refeitas quando os dados mudam. Preço do Haiku 5.5: US$ 0,10 por milhão de tokens de entrada e US$ 0,50 por milhão de saída.
          </Aviso>
          <div className="mini mudo">A chave da API fica apenas no arquivo .env do servidor (ANTHROPIC_API_KEY) e nunca é enviada ao navegador.</div>
        </div>
      </Cartao>
    </div>
  );
}
