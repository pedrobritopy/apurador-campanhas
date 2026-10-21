import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Database, Layers, RefreshCw, Search, ShieldAlert, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { get, post, useApi } from '../../lib/api.js';
import { useAtrasado } from '../../lib/anim.js';
import { fmtDataHora, fmtNumero, fmtRelativo } from '../../lib/formato.js';
import { Botao, Cartao, Carregando, Chip, Entrada, Explica, Kpi, ListaAnimada, Selo, Vazio, useToast } from '../../componentes/ui.jsx';
import { DetalheValidacao, ESCOPO_FATO, EXPLICA_INSIGHTS } from './comum.jsx';

function Fato({ f }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className={`ig-fato${f.validado ? '' : ' fora'}`}>
      <div className="linha entre quebra">
        <div className="linha g4" style={{ gap: 6, minWidth: 0 }}>
          <Selo>{ESCOPO_FATO[f.escopo] || f.escopo}</Selo>
          <span className="forte truncar">{f.titulo}</span>
        </div>
        <div className="linha g4">
          {f.validacao?.ok === false ? <Selo cor="critico" icone={ShieldAlert}>fora da IA</Selo> : f.validacao && f.validacao.aplicavel !== false ? <Selo cor="bom" icone={BadgeCheck}>dupla validação</Selo> : null}
          <span className="mono mudo" style={{ fontSize: 11 }}>{f.id}</span>
        </div>
      </div>
      <div className="ig-fato-texto">{f.texto}</div>
      {f.validacao && (
        <button type="button" className="botao fantasma p" style={{ alignSelf: 'flex-start' }} onClick={() => setAberto((a) => !a)}>
          {aberto ? 'Ocultar conferência' : 'Ver conferência'}
        </button>
      )}
      {aberto && <DetalheValidacao validacao={f.validacao} />}
    </div>
  );
}

export default function AbaConhecimento() {
  const toast = useToast();
  const { dados: resumo, recarregar } = useApi('/conhecimento/resumo', { intervalo: 15000 });
  const [escopo, setEscopo] = useState('');
  const [busca, setBusca] = useState('');
  const [soDivergentes, setSoDivergentes] = useState(false);
  const [fatos, setFatos] = useState(null);
  const [atualizando, setAtualizando] = useState(false);
  const q = useAtrasado(busca, 350);

  useEffect(() => {
    const p = new URLSearchParams({ limite: '80' });
    if (escopo) p.set('escopo', escopo);
    if (q.trim()) p.set('q', q.trim());
    if (soDivergentes) p.set('validados', '0');
    get(`/conhecimento/fatos?${p}`).then(setFatos).catch(() => setFatos([]));
  }, [escopo, q, soDivergentes, resumo?.atualizado_em]);

  const escopos = useMemo(() => Object.entries(resumo?.por_escopo || {}).sort((a, b) => b[1] - a[1]), [resumo]);

  const atualizar = async () => {
    setAtualizando(true);
    try {
      await post('/conhecimento/atualizar', {});
      toast.info('Atualização pedida. A base é refeita em segundo plano e esta tela acompanha sozinha.');
      setTimeout(recarregar, 1500);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setAtualizando(false);
    }
  };

  if (!resumo) return <Carregando />;
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade-4">
        <Kpi rotulo={<span className="linha g4" style={{ display: 'inline-flex' }}>Fatos na base <Explica titulo="Fatos" {...EXPLICA_INSIGHTS.fatos} tamanho={13} /></span>} valor={resumo.fatos} icone={Database} />
        <Kpi rotulo="Liberados para a IA" valor={resumo.validados} icone={ShieldCheck} rodape={<span className="mudo pequeno">conferidos</span>} />
        <Kpi rotulo={<span className="linha g4" style={{ display: 'inline-flex' }}>Retidos por divergência <Explica titulo="Retidos" texto="Fatos cujo número não bateu nos dois cálculos. Ficam fora da IA até a próxima importação e aparecem como alerta." tamanho={13} /></span>} valor={resumo.invalidos} icone={ShieldAlert} />
        <div className="cartao kpi">
          <div className="kpi-rotulo"><RefreshCw size={15} /> Atualização</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{resumo.em_atualizacao || atualizando ? 'Atualizando agora…' : resumo.atualizado_em ? fmtRelativo(resumo.atualizado_em) : 'nunca'}</div>
          <div className="kpi-rodape">
            <span className="mudo pequeno">{resumo.atualizado_em ? `${fmtDataHora(resumo.atualizado_em)} · ${fmtNumero((resumo.duracao_ms || 0) / 1000, 1)} s` : ''}</span>
            <Botao tamanho="p" icone={RefreshCw} carregando={atualizando || resumo.em_atualizacao} onClick={atualizar}>Atualizar</Botao>
          </div>
        </div>
      </div>

      <Cartao titulo="Como a base funciona" acoes={<Workflow size={15} className="mudo" />}>
        <div className="grade-3" style={{ gap: 18 }}>
          <div className="coluna g4"><span className="forte linha g4"><Layers size={15} style={{ color: 'var(--s1)' }} /> 1. Pré-cálculo</span><span className="pequeno sec">O motor transforma vendas, campanhas, carteira, marcas, estoque e histórico de compra em fatos curtos com os números prontos. A IA nunca faz conta.</span></div>
          <div className="coluna g4"><span className="forte linha g4"><ShieldCheck size={15} style={{ color: 'var(--bom)' }} /> 2. Dupla validação</span><span className="pequeno sec">Cada número-chave é recalculado por um caminho independente (motor × SQL direto, vendas × estoque, soma × parcelas). Divergiu, o fato fica fora da IA e vira alerta.</span></div>
          <div className="coluna g4"><span className="forte linha g4"><Sparkles size={15} style={{ color: 'var(--s7)' }} /> 3. Retroalimentação</span><span className="pequeno sec">Sugestões dos planos de ataque são acompanhadas até virar compra. As taxas reais (e um backtest no histórico) calibram as prioridades e voltam como fatos.</span></div>
        </div>
      </Cartao>

      <div className="linha quebra" style={{ gap: 8 }}>
        <div style={{ width: 300 }}><Entrada icone={Search} placeholder="Buscar (ex.: Dorflex, Goiânia, Giovana)" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <Chip ativo={!escopo} onClick={() => setEscopo('')}>Todos</Chip>
        {escopos.map(([e, n]) => <Chip key={e} ativo={escopo === e} onClick={() => setEscopo(escopo === e ? '' : e)}>{ESCOPO_FATO[e] || e} <span className="mudo num">{fmtNumero(n)}</span></Chip>)}
        <Chip ativo={soDivergentes} icone={ShieldAlert} onClick={() => setSoDivergentes((s) => !s)}>Só retidos</Chip>
      </div>

      {!fatos ? <Carregando /> : !fatos.length ? (
        <Vazio icone={Database} titulo="Nenhum fato encontrado" texto={soDivergentes ? 'Nenhum fato retido: todos os números conferiram nos dois caminhos.' : 'Tente outro termo ou escopo.'} />
      ) : (
        <ListaAnimada itens={fatos} chave={(f) => f.id} gap={8} render={(f) => <Fato f={f} />} />
      )}
    </div>
  );
}
