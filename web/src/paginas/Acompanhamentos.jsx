import { CalendarClock, FileText, Inbox, Send } from 'lucide-react';
import { definirQuery } from '../lib/rotas.js';
import { Abas, Cabecalho } from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import Disparar from './acompanhamentos/Disparar.jsx';
import Modelos from './acompanhamentos/Modelos.jsx';
import Agendamentos from './acompanhamentos/Agendamentos.jsx';
import Historico from './acompanhamentos/Historico.jsx';
import './acompanhamentos/acompanhamentos.css';

const ABAS = [
  { id: 'disparar', rotulo: 'Disparar', icone: Send },
  { id: 'modelos', rotulo: 'Modelos de mensagem', icone: FileText },
  { id: 'agendamentos', rotulo: 'Envio automático', icone: CalendarClock },
  { id: 'historico', rotulo: 'Caixa de saída', icone: Inbox },
];

export default function Acompanhamentos({ query }) {
  const aba = ABAS.some((a) => a.id === query?.get('aba')) ? query.get('aba') : 'disparar';
  const campanha = query?.get('campanha') || '';
  const modelo = query?.get('modelo') || '';

  return (
    <div>
      <Cabecalho
        titulo="Acompanhamentos"
        info={EXPLICA.acompanhamentos}
        subtitulo="Cada pessoa recebe a própria situação: posição, projeção, quanto precisa vender por dia, quanto vale a próxima faixa e quais clientes atacar."
      />
      <Abas abas={ABAS} ativa={aba} aoMudar={(id) => definirQuery({ aba: id })} />
      <div key={aba} className="pagina-entrada">
        {aba === 'disparar' && <Disparar campanhaInicial={campanha} />}
        {aba === 'modelos' && <Modelos modeloInicial={modelo} campanhaInicial={campanha} />}
        {aba === 'agendamentos' && <Agendamentos />}
        {aba === 'historico' && <Historico campanhaInicial={campanha} />}
      </div>
    </div>
  );
}
