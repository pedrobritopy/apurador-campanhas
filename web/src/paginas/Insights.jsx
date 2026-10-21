import { lazy, Suspense } from 'react';
import { BellRing, Brain, Database, MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react';
import { useApi } from '../lib/api.js';
import { definirQuery } from '../lib/rotas.js';
import { fmtNumero } from '../lib/formato.js';
import { Abas, Cabecalho, Carregando, Selo } from '../componentes/ui.jsx';
import { EXPLICA_INSIGHTS } from './inteligencia/comum.jsx';
import './inteligencia/inteligencia.css';

const AbaAlertas = lazy(() => import('./inteligencia/AbaAlertas.jsx'));
const AbaAnaliseIa = lazy(() => import('./inteligencia/AbaAnaliseIa.jsx'));
const AbaPergunte = lazy(() => import('./inteligencia/AbaPergunte.jsx'));
const AbaConhecimento = lazy(() => import('./inteligencia/AbaConhecimento.jsx'));
const AbaQualidade = lazy(() => import('./inteligencia/AbaQualidade.jsx'));

export default function Insights({ query }) {
  const aba = query?.get('aba') || 'alertas';
  const { dados: resumo } = useApi('/insights/resumo', { intervalo: 120000 });
  const { dados: conhecimento } = useApi('/conhecimento/resumo', { intervalo: 60000 });
  const criticos = (resumo?.por_severidade?.critica || 0) + (resumo?.por_severidade?.alta || 0);

  const abas = [
    { id: 'alertas', rotulo: 'Alertas', icone: BellRing, contador: resumo ? resumo.total : undefined },
    { id: 'ia', rotulo: 'Análise da IA', icone: Brain },
    { id: 'pergunte', rotulo: 'Pergunte à IA', icone: MessageSquareText },
    { id: 'conhecimento', rotulo: 'Base de conhecimento', icone: Database, contador: conhecimento ? fmtNumero(conhecimento.fatos) : undefined },
    { id: 'qualidade', rotulo: 'Qualidade dos dados', icone: ShieldCheck, contador: conhecimento?.invalidos ? conhecimento.invalidos : undefined },
  ];

  return (
    <div>
      <Cabecalho
        sobre={<><Sparkles size={13} /> Inteligência comercial</>}
        titulo="Central de insights"
        subtitulo="Alertas automáticos sobre todas as campanhas e uma IA que lê só números conferidos, sempre citando a fonte."
        info={EXPLICA_INSIGHTS.pagina}
        acoes={criticos > 0 ? <Selo cor="critico">{fmtNumero(criticos)} alerta(s) crítico(s) ou alto(s)</Selo> : resumo ? <Selo cor="bom">Sem alertas críticos</Selo> : null}
      />
      <Abas abas={abas} ativa={aba} aoMudar={(id) => definirQuery({ aba: id === 'alertas' ? null : id })} />
      <Suspense fallback={<Carregando />}>
        {aba === 'alertas' && <AbaAlertas />}
        {aba === 'ia' && <AbaAnaliseIa query={query} />}
        {aba === 'pergunte' && <AbaPergunte />}
        {aba === 'conhecimento' && <AbaConhecimento />}
        {aba === 'qualidade' && <AbaQualidade />}
      </Suspense>
    </div>
  );
}
