import { Brain, CalendarDays, Layers, Send, SlidersHorizontal } from 'lucide-react';
import { put, useApi } from '../lib/api.js';
import { invalidarRecurso } from '../lib/dados.js';
import { definirQuery } from '../lib/rotas.js';
import { Abas, Cabecalho, Carregando, ErroCarga, useToast } from '../componentes/ui.jsx';
import ConfigGeral from './sistema/ConfigGeral.jsx';
import ConfigFeriados from './sistema/ConfigFeriados.jsx';
import ConfigEnvio from './sistema/ConfigEnvio.jsx';
import ConfigIA from './sistema/ConfigIA.jsx';
import ConfigGrupos from './sistema/ConfigGrupos.jsx';
import './sistema/sistema.css';

const ABAS = [
  { id: 'geral', rotulo: 'Geral', icone: SlidersHorizontal },
  { id: 'feriados', rotulo: 'Feriados', icone: CalendarDays },
  { id: 'envio', rotulo: 'Envio', icone: Send },
  { id: 'ia', rotulo: 'Inteligência artificial', icone: Brain },
  { id: 'grupos', rotulo: 'Linhas de produtos', icone: Layers },
];

export default function Configuracoes({ query, status }) {
  const toast = useToast();
  const aba = ABAS.some((a) => a.id === query?.get('aba')) ? query.get('aba') : 'geral';
  const { dados: config, erro, recarregar } = useApi('/config');

  /** Salva parte da configuração. Devolve true/false (o erro já vira toast). */
  async function salvar(parcial) {
    try {
      await put('/config', parcial);
      toast.ok('Configurações salvas');
      await recarregar();
      invalidarRecurso('/catalogo');
      return true;
    } catch (e) {
      toast.erro(e.message);
      return false;
    }
  }

  return (
    <div>
      <Cabecalho titulo="Configurações" subtitulo="Calendário, feriados, canais de envio, limites da IA e linhas de produtos."
        info={{ texto: 'Ajustes que valem para todas as campanhas.', como: ['Geral: nome da empresa e calendário (dias úteis ou corridos).', 'Feriados: dias que não contam no ritmo.', 'Envio: e-mail, webhook e endereço dos links.', 'Inteligência artificial: limite de gasto diário.', 'Linhas de produtos: grupos de produtos para reaproveitar.'] }} />
      <Abas abas={ABAS} ativa={aba} aoMudar={(id) => definirQuery({ aba: id })} />
      {aba === 'grupos' ? (
        <div key={aba} className="pagina-entrada"><ConfigGrupos /></div>
      ) : erro && !config ? (
        <ErroCarga erro={erro} aoTentar={recarregar} />
      ) : !config ? (
        <Carregando />
      ) : (
        <div key={aba} className="pagina-entrada">
          {aba === 'geral' && <ConfigGeral config={config} status={status} aoSalvar={salvar} />}
          {aba === 'feriados' && <ConfigFeriados config={config} aoSalvar={salvar} />}
          {aba === 'envio' && <ConfigEnvio config={config} aoSalvar={salvar} />}
          {aba === 'ia' && <ConfigIA config={config} status={status} aoSalvar={salvar} />}
        </div>
      )}
    </div>
  );
}
