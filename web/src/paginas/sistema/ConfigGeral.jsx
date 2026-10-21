import { useEffect, useState } from 'react';
import { CalendarDays, Save } from 'lucide-react';
import { fmtData } from '../../lib/formato.js';
import { Botao, Campo, Cartao, Entrada, EntradaNumero, Segmentado } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import CampoGrupo from './CampoGrupo.jsx';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function ConfigGeral({ config, status, aoSalvar }) {
  const inicial = () => ({
    nome_empresa: config.nome_empresa || '',
    calendario: config.calendario || 'uteis',
    data_referencia: config.data_referencia || 'auto',
    janela_recente: config.janela_recente ?? 7,
  });
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setF(inicial()), [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixa = DATA_RE.test(f.data_referencia);
  const sujo = JSON.stringify(f) !== JSON.stringify(inicial());
  const valido = f.janela_recente >= 3 && (!fixa || DATA_RE.test(f.data_referencia));

  async function salvar() {
    setSalvando(true);
    try {
      await aoSalvar({ ...f, janela_recente: Math.round(f.janela_recente) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="config-grade">
      <Cartao titulo="Empresa e calendário" subtitulo="Afeta como o ritmo e as projeções são calculados em todas as campanhas" info={{ ...EXPLICA.configGeral, como: EXPLICA.calendario.texto, exemplo: EXPLICA.calendario.exemplo }}>
        <div className="config-form">
          <Campo rotulo="Nome da empresa" ajuda="Aparece no menu e nas mensagens.">
            <Entrada value={f.nome_empresa} onChange={(e) => setF({ ...f, nome_empresa: e.target.value })} />
          </Campo>
          <CampoGrupo rotulo="Dias que contam para o ritmo" ajuda={f.calendario === 'uteis'
            ? 'Segunda a sexta, sem feriados. “Faltam 9 dias” significa 9 dias úteis; o ritmo necessário é por dia útil.'
            : 'Todos os dias do calendário. Indicado quando há venda relevante em fins de semana.'}>
            <div>
              <Segmentado valor={f.calendario} aoMudar={(v) => setF({ ...f, calendario: v })} opcoes={[
                { valor: 'uteis', rotulo: 'Dias úteis', icone: CalendarDays },
                { valor: 'corridos', rotulo: 'Dias corridos' },
              ]} />
            </div>
          </CampoGrupo>
          <CampoGrupo rotulo="Data de referência (“hoje” das apurações)"
            ajuda={fixa ? 'Útil para reapurar como se fosse outra data (ex.: fechamento retroativo).' : `Automática: último dia com vendas carregadas${status?.dados?.vendas?.max ? ` (hoje: ${fmtData(status.dados.vendas.max)})` : ''}.`}>
            <div className="linha" style={{ gap: 10 }}>
              <Segmentado valor={fixa ? 'fixa' : 'auto'} aoMudar={(v) => setF({ ...f, data_referencia: v === 'auto' ? 'auto' : status?.dados?.vendas?.max || new Date().toISOString().slice(0, 10) })} opcoes={[
                { valor: 'auto', rotulo: 'Automática' },
                { valor: 'fixa', rotulo: 'Data fixa' },
              ]} />
              {fixa && <Entrada type="date" aria-label="Data de referência fixa" value={f.data_referencia} onChange={(e) => setF({ ...f, data_referencia: e.target.value || 'auto' })} style={{ width: 170 }} />}
            </div>
          </CampoGrupo>
          <Campo rotulo="Janela do ritmo recente" ajuda="Quantos dias recentes pesam na projeção (além da média do período). Mínimo 3.">
            <div style={{ width: 160 }}>
              <EntradaNumero valor={f.janela_recente} aoMudar={(v) => setF({ ...f, janela_recente: v ?? 7 })} sufixo="dias" min={3} style={{ paddingRight: 44 }} />
            </div>
          </Campo>
          <div className="config-rodape">
            {sujo && <span className="sujo">● Alterações não salvas</span>}
            <Botao variante="primario" icone={Save} carregando={salvando} disabled={!sujo || !valido} onClick={salvar}>Salvar</Botao>
          </div>
        </div>
      </Cartao>
      <Cartao titulo="Como a projeção funciona" subtitulo="Transparência para a equipe confiar nos números">
        <div className="coluna sec pequeno" style={{ gap: 10, lineHeight: 1.55 }}>
          <p><strong style={{ color: 'var(--tinta)' }}>Ritmo médio</strong> = realizado ÷ dias decorridos (no calendário escolhido).</p>
          <p><strong style={{ color: 'var(--tinta)' }}>Ritmo recente</strong> = vendas dos últimos {f.janela_recente} dias ÷ {f.janela_recente}.</p>
          <p><strong style={{ color: 'var(--tinta)' }}>Projeção</strong> = realizado + ritmo combinado × dias restantes. Para contagens que saturam (clientes positivados, SKUs) o ritmo recente pesa mais.</p>
          <p><strong style={{ color: 'var(--tinta)' }}>Ritmo necessário</strong> = quanto falta para a meta ÷ dias restantes. É o número que cada vendedor recebe no acompanhamento.</p>
        </div>
      </Cartao>
    </div>
  );
}
