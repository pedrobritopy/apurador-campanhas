import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, Brain, Copy, History, Lightbulb, ListChecks, ShieldCheck, Sparkles, Store, TrendingUp, Zap } from 'lucide-react';
import { get, post, useApi } from '../../lib/api.js';
import { useDimensoes } from '../../lib/dados.js';
import { fmtDataHora, fmtNumero, fmtRelativo, fmtUsd } from '../../lib/formato.js';
import { Anel, Aviso, Botao, Cartao, Carregando, Explica, Segmentado, Seletor, Selo, Vazio, useToast } from '../../componentes/ui.jsx';
import { ChipFonte, EXPLICA_INSIGHTS, MarcaVerificado, MedidorIa, ModalFato, TextoComFontes } from './comum.jsx';

const SAUDE = {
  otima: { rotulo: 'Ótima', cor: 'bom', icone: ShieldCheck },
  boa: { rotulo: 'Boa', cor: 'acento', icone: TrendingUp },
  atencao: { rotulo: 'Atenção', cor: 'aviso', icone: AlertTriangle },
  critica: { rotulo: 'Crítica', cor: 'critico', icone: AlertTriangle },
};
const TIPO_DESTAQUE = { positivo: { cor: 'bom', rotulo: 'Positivo' }, alerta: { cor: 'aviso', rotulo: 'Alerta' }, risco: { cor: 'critico', rotulo: 'Risco' }, oportunidade: { cor: 'acento', rotulo: 'Oportunidade' } };
const IMPACTO = { alto: { cor: 'critico', rotulo: 'Impacto alto' }, medio: { cor: 'aviso', rotulo: 'Impacto médio' }, baixo: { cor: 'neutro', rotulo: 'Impacto baixo' } };

function Fontes({ fontes, validos, aoAbrir }) {
  if (!fontes?.length) return null;
  return (
    <div className="linha quebra g4" style={{ gap: 4, marginTop: 2 }}>
      <span className="mini mudo">Fontes:</span>
      {fontes.map((f) => <ChipFonte key={f} id={f} invalida={validos && !validos.has(f)} aoAbrir={aoAbrir} />)}
    </div>
  );
}

function Resultado({ analise, aoAbrir }) {
  const toast = useToast();
  const r = analise.resultado;
  const v = analise.verificacao || {};
  const validos = useMemo(() => new Set(analise.fatos_ids || (analise.fatos_usados || []).map((f) => f.id)), [analise]);
  const saude = SAUDE[r.saude] || SAUDE.atencao;
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <Cartao>
        <div className="linha-topo" style={{ gap: 20, flexWrap: 'wrap' }}>
          {r.probabilidade_meta != null && (
            <div className="coluna" style={{ alignItems: 'center', gap: 2 }}>
              <Anel valor={r.probabilidade_meta} tamanho={112} rotulo="chance da meta" cor={r.probabilidade_meta >= 70 ? 'var(--bom)' : r.probabilidade_meta >= 40 ? 'var(--aviso)' : 'var(--critico)'} />
              <Explica titulo="Chance da meta" {...EXPLICA_INSIGHTS.chanceMeta} />
            </div>
          )}
          <div className="cresce coluna" style={{ gap: 10, minWidth: 260 }}>
            <div className="linha quebra" style={{ gap: 8 }}>
              <Selo cor={saude.cor} icone={saude.icone}>Saúde: {saude.rotulo}</Selo>
              <Selo cor={v.aprovado ? 'bom' : 'serio'} icone={v.aprovado ? BadgeCheck : AlertTriangle}>{v.aprovado ? 'Resposta conferida' : 'Conferência com ressalvas'}</Selo>
              <Selo icone={ListChecks}>{fmtNumero(v.numeros_conferidos || 0)} números conferidos</Selo>
              {v.numeros_nao_encontrados > 0 && <Selo cor="serio">{fmtNumero(v.numeros_nao_encontrados)} sem fonte</Selo>}
              <Selo>{fmtNumero(v.citacoes_validas || 0)} citações válidas</Selo>
              {analise.simulada && <Selo cor="aviso">simulação</Selo>}
              <Explica titulo="Como a resposta é conferida" {...EXPLICA_INSIGHTS.conferencia} />
            </div>
            <p className="ig-resumo-ia"><TextoComFontes texto={r.resumo} aoAbrir={aoAbrir} validos={validos} /></p>
            <div className="mini mudo">
              {analise.referencia_nome} · {fmtDataHora(analise.criado_em)} · {analise.reaproveitada ? 'reaproveitada (custo zero)' : `custo ${fmtUsd(analise.custo_usd || 0)}`} · {fmtNumero(validos.size)} fatos usados
            </div>
          </div>
        </div>
      </Cartao>

      <div className="grade-2">
        <Cartao titulo="Destaques" subtitulo="O que os números dizem">
          <div className="coluna" style={{ gap: 10 }}>
            {r.destaques.map((d, i) => (
              <div key={i} className="ig-item">
                <div className="ig-item-titulo">
                  <span className="cresce">{d.titulo}</span>
                  <Selo cor={TIPO_DESTAQUE[d.tipo]?.cor}>{TIPO_DESTAQUE[d.tipo]?.rotulo || d.tipo}</Selo>
                </div>
                <div className="ig-item-texto"><TextoComFontes texto={d.detalhe} aoAbrir={aoAbrir} validos={validos} /></div>
                <div className="linha entre quebra"><Fontes fontes={d.fontes} validos={validos} aoAbrir={aoAbrir} /><MarcaVerificado verificado={d.verificado} detalhe={d.verificacao} /></div>
              </div>
            ))}
          </div>
        </Cartao>
        <Cartao titulo="Ações recomendadas" subtitulo="Em ordem de prioridade">
          <div className="coluna" style={{ gap: 10 }}>
            {r.acoes.map((a, i) => (
              <div key={i} className="ig-item">
                <div className="ig-item-titulo">
                  <span className="num mudo" style={{ fontWeight: 700 }}>{i + 1}</span>
                  <span className="cresce">{a.titulo}</span>
                  <Selo cor={IMPACTO[a.impacto]?.cor}>{IMPACTO[a.impacto]?.rotulo || a.impacto}</Selo>
                </div>
                <div className="ig-item-texto"><TextoComFontes texto={a.detalhe} aoAbrir={aoAbrir} validos={validos} /></div>
                <div className="linha entre quebra">
                  <span className="mini sec"><strong>{a.responsavel}</strong> · {a.prazo}</span>
                  <MarcaVerificado verificado={a.verificado} detalhe={a.verificacao} />
                </div>
                <Fontes fontes={a.fontes} validos={validos} aoAbrir={aoAbrir} />
              </div>
            ))}
          </div>
        </Cartao>
      </div>

      {r.oportunidades_clientes?.length > 0 && (
        <Cartao titulo="Clientes para atacar" subtitulo="Indicados pela IA a partir das oportunidades calculadas pelo motor">
          <div className="grade-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {r.oportunidades_clientes.map((o, i) => (
              <div key={i} className="ig-item">
                <div className="ig-item-titulo"><Store size={15} className="mudo" style={{ marginTop: 2 }} /><span className="cresce">{o.cliente}</span></div>
                <div className="mini sec">{o.participante}</div>
                <div className="ig-item-texto"><TextoComFontes texto={o.motivo} aoAbrir={aoAbrir} validos={validos} /></div>
                <div className="pequeno" style={{ color: 'var(--tinta)' }}><Lightbulb size={13} style={{ verticalAlign: -2, color: 'var(--acento)' }} /> {o.sugestao}</div>
                <div className="linha entre quebra"><Fontes fontes={o.fontes} validos={validos} aoAbrir={aoAbrir} /><MarcaVerificado verificado={o.verificado} detalhe={o.verificacao} /></div>
              </div>
            ))}
          </div>
        </Cartao>
      )}

      {r.mensagem_equipe && (
        <div className="ig-msg-equipe">
          <div className="linha entre" style={{ marginBottom: 6 }}>
            <span className="forte linha g4"><Sparkles size={15} style={{ color: 'var(--acento)' }} /> Mensagem para o time</span>
            <Botao tamanho="p" variante="fantasma" icone={Copy} onClick={() => { navigator.clipboard?.writeText(r.mensagem_equipe.replace(/\s*\[F-[^\]]+\]/g, '')); toast.ok('Mensagem copiada'); }}>Copiar</Botao>
          </div>
          <TextoComFontes texto={r.mensagem_equipe} aoAbrir={aoAbrir} validos={validos} />
        </div>
      )}
    </div>
  );
}

export default function AbaAnaliseIa({ query }) {
  const toast = useToast();
  const { dados: dim } = useDimensoes();
  const { dados: campanhas } = useApi('/campanhas');
  const { dados: status, recarregar: recarregarStatus } = useApi('/ia/status');
  const [tipo, setTipo] = useState(query?.get('tipo') || 'geral');
  const [ref, setRef] = useState(query?.get('referencia') || '');
  const [analise, setAnalise] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [estimativa, setEstimativa] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [carregandoUlt, setCarregandoUlt] = useState(false);
  const [fatoAberto, setFatoAberto] = useState(null);

  const opcoesCamp = useMemo(() => (campanhas || []).filter((c) => ['ativa', 'encerrada'].includes(c.status)).map((c) => ({ valor: String(c.id), rotulo: c.nome })), [campanhas]);
  const opcoesVend = useMemo(() => (dim?.vendedores || []).map((v) => ({ valor: String(v.id), rotulo: `${v.nome}${v.equipe ? ` · ${v.equipe}` : ''}` })), [dim]);
  const pronto = tipo === 'geral' || Boolean(ref);

  useEffect(() => {
    if (tipo === 'campanha' && !ref && opcoesCamp[0]) setRef(opcoesCamp[0].valor);
  }, [tipo, ref, opcoesCamp]);

  // última análise + histórico + estimativa do escopo
  useEffect(() => {
    if (!pronto) return;
    const r = tipo === 'geral' ? '' : ref;
    setCarregandoUlt(true);
    setEstimativa(null);
    get(`/ia/analises?tipo=${tipo}${r ? `&referencia=${encodeURIComponent(r)}` : ''}&limite=10`)
      .then(async (lista) => {
        setHistorico(lista);
        setAnalise(lista[0] ? await get(`/ia/analises/${lista[0].id}`) : null);
      })
      .catch(() => { setHistorico([]); setAnalise(null); })
      .finally(() => setCarregandoUlt(false));
    get(`/ia/estimativa?tipo=${tipo}${r ? `&referencia=${encodeURIComponent(r)}` : ''}`).then(setEstimativa).catch(() => setEstimativa(null));
  }, [tipo, ref, pronto]);

  const gerar = async (forcar = false) => {
    setGerando(true);
    try {
      const a = await post('/ia/analisar', { tipo, referencia: tipo === 'geral' ? undefined : ref, forcar });
      setAnalise(a);
      if (a.reaproveitada) toast.info('Os dados não mudaram: reaproveitei a última análise (custo zero).');
      else toast.ok(`Análise pronta · ${fmtUsd(a.custo_usd)}`);
      const lista = await get(`/ia/analises?tipo=${tipo}${tipo !== 'geral' && ref ? `&referencia=${encodeURIComponent(ref)}` : ''}&limite=10`);
      setHistorico(lista);
      recarregarStatus();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setGerando(false);
    }
  };

  const abrirHistorico = async (id) => {
    setCarregandoUlt(true);
    try {
      setAnalise(await get(`/ia/analises/${id}`));
    } finally {
      setCarregandoUlt(false);
    }
  };

  return (
    <div className="ig-grade-lateral">
      <div className="ig-pegajoso">
        <Cartao titulo="O que analisar" info={EXPLICA_INSIGHTS.analise}>
          <div className="coluna" style={{ gap: 12 }}>
            <Segmentado tamanho="p" valor={tipo} aoMudar={(t) => { setTipo(t); setRef(''); }} opcoes={[{ valor: 'geral', rotulo: 'Geral' }, { valor: 'campanha', rotulo: 'Campanha' }, { valor: 'vendedor', rotulo: 'Vendedor' }]} />
            {tipo === 'campanha' && <Seletor opcoes={opcoesCamp} valor={ref} aoMudar={setRef} vazio="Escolha a campanha" />}
            {tipo === 'vendedor' && <Seletor opcoes={opcoesVend} valor={ref} aoMudar={setRef} vazio="Escolha o vendedor" />}
            <Botao variante="primario" icone={Brain} carregando={gerando} disabled={!pronto || !status?.configurada && !status?.simulada} onClick={() => gerar(false)}>
              {estimativa?.reaproveitavel ? 'Ver análise (sem custo)' : 'Gerar análise'}
            </Botao>
            {estimativa && !estimativa.reaproveitavel && (
              <div className="mini mudo">
                Custo máximo estimado <strong>{fmtUsd(estimativa.custo_max_usd)}</strong> · {fmtNumero(estimativa.fatos)} fatos validados (~{fmtNumero(estimativa.tokens_fatos)} tokens)
              </div>
            )}
            {estimativa?.reaproveitavel && (
              <div className="mini mudo linha g4"><Zap size={12} /> Os dados não mudaram desde a última análise: ela será reaproveitada.</div>
            )}
            {analise && !gerando && <Botao tamanho="p" variante="fantasma" onClick={() => gerar(true)}>Forçar nova análise</Botao>}
            {status && !status.configurada && !status.simulada && <Aviso tipo="aviso">IA não configurada. Defina ANTHROPIC_API_KEY no arquivo .env.</Aviso>}
          </div>
        </Cartao>
        <Cartao><MedidorIa status={status} /></Cartao>
        {historico.length > 0 && (
          <Cartao titulo="Análises anteriores" acoes={<History size={15} className="mudo" />}>
            <div className="coluna" style={{ gap: 6 }}>
              {historico.map((h) => (
                <button key={h.id} type="button" className="menu-item" onClick={() => abrirHistorico(h.id)} style={analise?.id === h.id ? { background: 'var(--acento-lavagem)' } : undefined}>
                  {h.verificacao?.aprovado ? <BadgeCheck size={14} style={{ color: 'var(--bom)' }} /> : <AlertTriangle size={14} style={{ color: 'var(--serio)' }} />}
                  <span className="cresce truncar">{fmtRelativo(h.criado_em)}</span>
                  <span className="mini mudo num">{h.simulada ? 'simulação' : fmtUsd(h.custo_usd || 0)}</span>
                </button>
              ))}
            </div>
          </Cartao>
        )}
        <div className="mini mudo" style={{ lineHeight: 1.5, padding: '0 4px' }}>
          A IA lê apenas fatos pré-calculados e conferidos por dois caminhos. Ela não faz contas: cada número precisa citar a fonte, e o sistema confere tudo antes de exibir.
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {gerando ? (
          <Cartao className="ig-varredura">
            <div className="vazio" style={{ minHeight: 320 }}>
              <div className="ig-pensando"><span /><span /><span /></div>
              <div className="forte" style={{ color: 'var(--tinta)' }}>Analisando fatos validados…</div>
              <div className="pequeno">Monta-se o contexto, a IA responde e o sistema confere cada número com a fonte.</div>
            </div>
          </Cartao>
        ) : carregandoUlt && !analise ? (
          <Carregando />
        ) : analise ? (
          <Resultado analise={analise} aoAbrir={setFatoAberto} />
        ) : (
          <Cartao>
            <Vazio icone={Brain} titulo="Nenhuma análise ainda para este escopo" texto="Clique em “Gerar análise”. A IA só é chamada quando você pede, e a resposta fica guardada para consultas futuras." />
          </Cartao>
        )}
      </div>
      <ModalFato id={fatoAberto} fatoInicial={analise?.fatos_usados?.find((f) => f.id === fatoAberto)} aoFechar={() => setFatoAberto(null)} />
    </div>
  );
}
