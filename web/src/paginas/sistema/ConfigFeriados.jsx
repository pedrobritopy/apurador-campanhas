import { useMemo, useState } from 'react';
import { CalendarPlus, RotateCcw, Trash2 } from 'lucide-react';
import { fmtData, fmtDiaSemana } from '../../lib/formato.js';
import { Aviso, Botao, BotaoIcone, Campo, Cartao, Entrada, Selo, Vazio, cx } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { useConfirmar } from './Confirmar.jsx';

const normalizarLista = (l) => (l || []).map((f) => (typeof f === 'string' ? { data: f, nome: 'Feriado' } : { data: f.data, nome: f.nome || 'Feriado' }))
  .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.data))
  .sort((a, b) => a.data.localeCompare(b.data));

export default function ConfigFeriados({ config, aoSalvar }) {
  const [confirmar, dialogo] = useConfirmar();
  const [nova, setNova] = useState({ data: '', nome: '' });
  const [salvando, setSalvando] = useState(false);
  const automatico = !Array.isArray(config.feriados);
  const efetivos = useMemo(() => normalizarLista(config.feriados_efetivos || config.feriados), [config]);
  const hoje = new Date().toISOString().slice(0, 10);
  const porAno = useMemo(() => {
    const m = new Map();
    for (const f of efetivos) {
      const a = f.data.slice(0, 4);
      if (!m.has(a)) m.set(a, []);
      m.get(a).push(f);
    }
    return [...m.entries()];
  }, [efetivos]);

  async function gravar(lista) {
    setSalvando(true);
    try {
      await aoSalvar({ feriados: lista });
    } finally {
      setSalvando(false);
    }
  }

  const adicionar = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nova.data)) return;
    const lista = normalizarLista([...efetivos.filter((f) => f.data !== nova.data), { data: nova.data, nome: nova.nome.trim() || 'Feriado local' }]);
    gravar(lista);
    setNova({ data: '', nome: '' });
  };
  const remover = (f) => gravar(efetivos.filter((x) => x.data !== f.data));
  const restaurar = async () => {
    if (await confirmar({ titulo: 'Restaurar feriados nacionais?', texto: 'A lista volta a ser calculada automaticamente (nacionais + Carnaval e Corpus Christi). Feriados locais adicionados serão removidos.', rotulo: 'Restaurar' })) gravar(null);
  };

  return (
    <div className="config-grade">
      {dialogo}
      <Cartao titulo="Feriados considerados" subtitulo="Dias que não contam como úteis no ritmo e nas projeções" info={EXPLICA.feriados}
        acoes={!automatico && <Botao tamanho="p" variante="fantasma" icone={RotateCcw} onClick={restaurar} carregando={salvando}>Restaurar nacionais</Botao>}>
        {automatico && <Aviso tipo="info" className="" titulo="Lista automática">Feriados nacionais calculados para o ano anterior, o atual e o próximo. Adicionar ou remover um dia transforma a lista em personalizada.</Aviso>}
        {!efetivos.length ? <Vazio titulo="Nenhum feriado" /> : (
          <div style={{ marginTop: 6 }}>
            {porAno.map(([ano, itens]) => (
              <div key={ano}>
                <div className="feriado-ano">{ano}</div>
                {itens.map((f) => (
                  <div key={f.data} className={cx('feriado-linha', f.data < hoje && 'passado')}>
                    <span className="num pequeno forte">{fmtData(f.data)}</span>
                    <span className="mini mudo">{fmtDiaSemana(f.data)}</span>
                    <span className="pequeno truncar">{f.nome}</span>
                    <BotaoIcone icone={Trash2} rotulo={`Remover ${f.nome}`} tamanho="p" onClick={() => remover(f)} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Cartao>
      <Cartao titulo="Adicionar feriado" subtitulo="Municipais, estaduais ou paradas da empresa">
        <div className="config-form">
          <div className="config-linha-2" style={{ gridTemplateColumns: '170px minmax(0, 1fr)' }}>
            <Campo rotulo="Data"><Entrada type="date" value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} /></Campo>
            <Campo rotulo="Nome"><Entrada value={nova.nome} placeholder="Ex.: Aniversário da cidade" onChange={(e) => setNova({ ...nova, nome: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && adicionar()} /></Campo>
          </div>
          <div className="config-rodape">
            <Botao variante="primario" icone={CalendarPlus} disabled={!nova.data} carregando={salvando} onClick={adicionar}>Adicionar</Botao>
          </div>
          {!automatico && <Selo cor="acento">Lista personalizada · {efetivos.length} dias</Selo>}
        </div>
      </Cartao>
    </div>
  );
}
