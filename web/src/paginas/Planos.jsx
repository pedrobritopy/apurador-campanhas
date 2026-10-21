import { useEffect, useMemo, useState } from 'react';
import { Brain, CheckCheck, ChevronRight, ClipboardList, Crosshair, HelpCircle, MessageCircle, RefreshCw, Target, Users, Wallet, X } from 'lucide-react';
import { post, useApi } from '../lib/api.js';
import { useDimensoes } from '../lib/dados.js';
import { definirQuery } from '../lib/rotas.js';
import { fmtData, fmtMoeda, fmtNumero, primeiroNome } from '../lib/formato.js';
import {
  Avatar, BarraEmpilhada, Botao, Cabecalho, Cartao, Chip, ErroCarga, Esqueleto, Explica, Kpi, ListaAnimada, Seletor, Tabela, Vazio, useToast,
} from '../componentes/ui.jsx';
import { EXPLICA_PLANO, TIPO_PLANO } from './inteligencia/comum.jsx';
import PlanoCartao from './inteligencia/PlanoCartao.jsx';
import PainelConversao from './inteligencia/PainelConversao.jsx';
import ModalRoteiro from './inteligencia/ModalRoteiro.jsx';
import './inteligencia/inteligencia.css';

const ORDEM_TIPOS = ['campanha', 'recompra', 'queda', 'cross_sell', 'inativo'];

/** Enquanto o servidor avisa que está atualizando o pronto, relê a cada 3 s (sem tela de espera). */
function useRelerEnquanto(ativo, recarregar) {
  useEffect(() => {
    if (!ativo) return undefined;
    const t = setTimeout(recarregar, 3000);
    return () => clearTimeout(t);
  }, [ativo, recarregar]);
}

function SeloAtualizando({ ativo }) {
  if (!ativo) return null;
  return <span className="mini mudo linha g4" style={{ display: 'inline-flex' }}><RefreshCw size={11} className="girando" /> atualizando com os dados mais novos</span>;
}

function textoWhatsApp(plano, itens) {
  const linhas = [`*Plano de ataque de ${primeiroNome(plano.vendedor.nome)}* (vendas até ${fmtData(plano.referencia)})`, ''];
  itens.forEach((it, i) => {
    linhas.push(`*${i + 1}. ${it.cliente}* (${it.cidade}/${it.estado}): ${it.tipo_rotulo.toLowerCase()}`);
    linhas.push(it.motivo);
    if (it.produtos_sugeridos?.length) linhas.push(`Oferecer: ${it.produtos_sugeridos.map((p) => p.marca || p.produto).join(', ')}`);
    linhas.push('');
  });
  linhas.push(`Potencial somado: ${fmtMoeda(itens.reduce((s, i) => s + i.valor_potencial, 0))}. Bora pra cima!`);
  return linhas.join('\n');
}

/** Rótulo de KPI com o "i" de explicação. */
function Rotulo({ texto, info }) {
  return <span className="linha g4" style={{ display: 'inline-flex' }}>{texto}<Explica titulo={texto} {...info} tamanho={13} /></span>;
}

/** Os três passos da tela, recolhíveis (a escolha fica salva no navegador). */
function ComoFunciona() {
  const [aberto, setAberto] = useState(() => {
    try {
      return localStorage.getItem('planos.como') !== 'fechado';
    } catch {
      return true;
    }
  });
  const alternar = () => setAberto((a) => {
    try {
      localStorage.setItem('planos.como', a ? 'fechado' : 'aberto');
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
    return !a;
  });
  if (!aberto) {
    return (
      <button type="button" className="ig-como-fechado" onClick={alternar}>
        <HelpCircle size={14} /> Como funciona o plano de ataque
      </button>
    );
  }
  return (
    <section className="ig-como" aria-label="Como funciona o plano de ataque">
      <div className="linha entre">
        <span className="forte linha g4"><HelpCircle size={15} style={{ color: 'var(--acento)' }} /> Como ler esta tela</span>
        <Botao tamanho="p" variante="fantasma" onClick={alternar}>Entendi, esconder</Botao>
      </div>
      <ol className="ig-como-passos">
        <li>
          <span className="ig-como-n">1</span>
          <div><strong>Achamos motivos para falar com cada cliente.</strong> O sistema lê o histórico de compra da carteira e encontra cinco tipos de ação: recompra atrasada, queda de compra, venda cruzada, cliente inativo e campanha ativa.</div>
        </li>
        <li>
          <span className="ig-como-n">2</span>
          <div><strong>Cada ação vale um valor.</strong> O <em>potencial</em> é quanto o cliente costuma comprar daquilo. Multiplicado pela chance real de dar certo, vira a <em>venda provável</em>.</div>
        </li>
        <li>
          <span className="ig-como-n">3</span>
          <div><strong>Você escolhe e acompanha.</strong> Abra o vendedor, marque os clientes, mande pelo WhatsApp e registre o plano. Em até 30 dias o sistema confere sozinho quem comprou.</div>
        </li>
      </ol>
    </section>
  );
}

function EsqueletoKpis() {
  return (
    <div className="grade-4 ig-kpis">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="cartao kpi"><Esqueleto altura={12} largura="60%" /><Esqueleto altura={26} largura="70%" style={{ marginTop: 10 }} /></div>
      ))}
    </div>
  );
}

function EsqueletoLista({ linhas = 6, altura = 58 }) {
  return (
    <div className="cartao" style={{ padding: 16 }}>
      <Esqueleto altura={14} largura="40%" />
      <div className="coluna" style={{ gap: 12, marginTop: 16 }}>
        {Array.from({ length: linhas }, (_, i) => <Esqueleto key={i} altura={altura} raio={12} />)}
      </div>
    </div>
  );
}

/** Todas as equipes: total da empresa e uma linha por equipe (tudo pronto no servidor). */
function VisaoGeral({ fotos, aoEscolherEquipe }) {
  const { dados, erro, carregando, recarregar } = useApi('/planos/geral');
  useRelerEnquanto(dados?.atualizando, recarregar);
  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if ((carregando && !dados) || dados?.pendente) {
    return <div className="coluna" style={{ gap: 16 }}><EsqueletoKpis /><EsqueletoLista /></div>;
  }
  const lista = dados?.equipes || [];
  const tot = dados?.total || { valor_esperado: 0, potencial_total: 0, clientes: 0, carteira: 0, acoes: 0, vendedores: 0, equipes: 0 };
  const max = Math.max(1, ...lista.map((e) => e.valor_esperado));
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade-4 ig-kpis">
        <Kpi rotulo={<Rotulo texto="Venda provável" info={EXPLICA_PLANO.vendaProvavel} />} valor={tot.valor_esperado} formato="moeda" compacto icone={Target} rodape={<span className="mudo pequeno">soma de todas as equipes</span>} />
        <Kpi rotulo={<Rotulo texto="Potencial" info={EXPLICA_PLANO.potencial} />} valor={tot.potencial_total} formato="moeda" compacto icone={Wallet} rodape={<span className="mudo pequeno">se todas dessem certo</span>} />
        <Kpi rotulo={<Rotulo texto="Clientes" info={EXPLICA_PLANO.clientes} />} valor={tot.clientes} icone={Users} rodape={<span className="mudo pequeno">com ação, de {fmtNumero(tot.carteira)} na carteira</span>} />
        <Kpi rotulo="Ações" valor={tot.acoes} icone={ClipboardList} rodape={<span className="mudo pequeno">{fmtNumero(tot.vendedores)} vendedores em {fmtNumero(tot.equipes)} equipes</span>} />
      </div>
      <Cartao
        titulo="Venda provável por equipe"
        acoes={<SeloAtualizando ativo={dados?.atualizando} />}
        subtitulo="Quanto cada equipe deve vender a mais se seguir os planos. Clique na equipe para ver os vendedores dela."
        info={{ ...EXPLICA_PLANO.vendaProvavel, como: ['Cada linha soma os planos de todos os vendedores da equipe.', 'O total do topo conta cada vendedor uma vez só, mesmo que ele apareça sob um coordenador e um gerente.'] }}
      >
        {!lista.length ? <Vazio icone={Crosshair} titulo="Nenhuma equipe com plano" /> : (
          <div className="ig-equipe-lista" role="list">
            {lista.map((e) => (
              <button key={e.id} type="button" role="listitem" className="ig-equipe-linha" onClick={() => aoEscolherEquipe(e.id)} aria-label={`Abrir a equipe de ${e.gerente}`}>
                <Avatar nome={e.gerente} foto={fotos.get(String(e.id))} />
                <div className="coluna cresce" style={{ gap: 3, minWidth: 0 }}>
                  <span className="forte truncar">Equipe {e.gerente}</span>
                  <span className="mini sec">{fmtNumero(e.vendedores)} vendedores · {fmtNumero(e.acoes)} ações em {fmtNumero(e.clientes)} clientes · carteira de {fmtNumero(e.carteira)}</span>
                  <span className="ig-equipe-barra" aria-hidden><span style={{ width: `${(e.valor_esperado / max) * 100}%` }} /></span>
                </div>
                <div className="ig-equipe-valor">
                  <span className="num">{fmtMoeda(e.valor_esperado, { compacto: true })}</span>
                  <span className="mini mudo">de {fmtMoeda(e.potencial_total, { compacto: true })} possíveis</span>
                </div>
                <ChevronRight size={16} className="mudo" />
              </button>
            ))}
          </div>
        )}
      </Cartao>
    </div>
  );
}

function VisaoEquipe({ equipe, fotos, aoEscolher }) {
  const { dados, erro, carregando, recarregar } = useApi(equipe ? `/planos/equipe?equipe=${equipe}` : null);
  useRelerEnquanto(dados?.atualizando, recarregar);
  if (!equipe) return <Vazio icone={Users} titulo="Escolha uma equipe" texto="Ou escolha direto um vendedor para ver o plano dele." />;
  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if ((carregando && !dados) || dados?.pendente) {
    return <div className="coluna" style={{ gap: 16 }}><EsqueletoKpis /><EsqueletoLista /></div>;
  }
  const lista = dados?.vendedores || [];
  const tot = dados?.total || { valor_esperado: 0, potencial_total: 0, clientes: 0, carteira: 0, acoes: 0, vendedores: 0 };
  const max = Math.max(1, ...lista.map((v) => v.valor_esperado));

  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="grade-4 ig-kpis">
        <Kpi rotulo={<Rotulo texto="Venda provável" info={EXPLICA_PLANO.vendaProvavel} />} valor={tot.valor_esperado} formato="moeda" compacto icone={Target} rodape={<span className="mudo pequeno">soma da equipe</span>} />
        <Kpi rotulo={<Rotulo texto="Potencial" info={EXPLICA_PLANO.potencial} />} valor={tot.potencial_total} formato="moeda" compacto icone={Wallet} rodape={<span className="mudo pequeno">se todas dessem certo</span>} />
        <Kpi rotulo={<Rotulo texto="Clientes" info={EXPLICA_PLANO.clientes} />} valor={tot.clientes} icone={Users} rodape={<span className="mudo pequeno">com ação, de {fmtNumero(tot.carteira)} na carteira</span>} />
        <Kpi rotulo="Ações" valor={tot.acoes} icone={ClipboardList} rodape={<span className="mudo pequeno">{fmtNumero(tot.vendedores)} vendedores</span>} />
      </div>

      <Cartao
        titulo="Venda provável por vendedor"
        acoes={<SeloAtualizando ativo={dados?.atualizando} />}
        subtitulo="Quanto cada um deve vender a mais se seguir o plano. Clique no vendedor para abrir o plano dele."
        info={{
          ...EXPLICA_PLANO.vendaProvavel,
          como: [
            'O número grande é a venda provável: o potencial de cada ação vezes a chance real de ela dar certo.',
            'Embaixo vem o potencial total, que é o teto se todos os clientes comprassem.',
            'A barra compara os vendedores da equipe. Quem tem mais a ganhar aparece primeiro.',
          ],
          exemplo: '"R$ 12,2 mil de R$ 30 mil possíveis" quer dizer: as ações somam R$ 30 mil e, pela taxa de conversão de cada tipo, o esperado é vender R$ 12,2 mil.',
        }}
      >
        {!lista.length ? (
          <Vazio icone={Crosshair} titulo="Nenhum vendedor nesta equipe" />
        ) : (
          <div className="ig-equipe-lista" role="list">
            {lista.map((v) => (
              <button key={v.id} type="button" role="listitem" className="ig-equipe-linha" onClick={() => aoEscolher(v.id)} aria-label={`Abrir o plano de ${v.vendedor}`}>
                <Avatar nome={v.vendedor} foto={fotos.get(v.id)} />
                <div className="coluna cresce" style={{ gap: 3, minWidth: 0 }}>
                  <span className="forte truncar">{v.vendedor}</span>
                  <span className="mini sec">
                    {fmtNumero(v.acoes)} ações em {fmtNumero(v.clientes)} {v.clientes === 1 ? 'cliente' : 'clientes'} · carteira de {fmtNumero(v.carteira)}
                  </span>
                  <span className="ig-equipe-barra" aria-hidden><span style={{ width: `${(v.valor_esperado / max) * 100}%` }} /></span>
                </div>
                <div className="ig-equipe-valor">
                  <span className="num">{fmtMoeda(v.valor_esperado, { compacto: true })}</span>
                  <span className="mini mudo">de {fmtMoeda(v.potencial_total, { compacto: true })} possíveis</span>
                </div>
                <ChevronRight size={16} className="mudo" />
              </button>
            ))}
          </div>
        )}
      </Cartao>

      <Cartao
        titulo="Ações por tipo"
        subtitulo="Quantas ações de cada tipo cada vendedor tem. Passe o mouse no i de cada coluna para entender o tipo."
        semMargem
        info={{ texto: 'Mostra onde está o trabalho de cada vendedor: lembrar reposição, recuperar quem caiu, apresentar marca nova, reativar parado ou positivar campanha.', como: 'Clique no título de uma coluna para ordenar; clique na linha para abrir o plano do vendedor.' }}
      >
        <Tabela
          densa
          linhas={lista}
          chaveLinha={(l) => l.id}
          aoClicarLinha={(l) => aoEscolher(l.id)}
          colunas={[
            { chave: 'vendedor', titulo: 'Vendedor', ordenavel: true, valor: (l) => l.vendedor, render: (l) => <span className="truncar" style={{ display: 'block', maxWidth: 180 }}>{l.vendedor}</span> },
            ...ORDEM_TIPOS.map((t) => ({
              chave: t,
              titulo: <span className="linha g4" style={{ display: 'inline-flex' }}>{TIPO_PLANO[t].curto}<Explica titulo={TIPO_PLANO[t].rotulo} {...TIPO_PLANO[t].explica} tamanho={12} /></span>,
              alinhar: 'direita',
              ordenavel: true,
              valor: (l) => l.por_tipo?.[t] || 0,
              render: (l) => <span className="num">{fmtNumero(l.por_tipo?.[t] || 0)}</span>,
            })),
            { chave: 'valor_esperado', titulo: 'Venda provável', alinhar: 'direita', ordenavel: true, render: (l) => <span className="num forte">{fmtMoeda(l.valor_esperado, { compacto: true })}</span> },
          ]}
        />
      </Cartao>
    </div>
  );
}

export default function Planos({ query }) {
  const toast = useToast();
  const { dados: dim } = useDimensoes();
  const { dados: campanhas } = useApi('/campanhas?status=ativa');
  const equipe = query?.get('equipe') || '';
  const vendedor = query?.get('vendedor') || '';
  const campanha = query?.get('campanha') || '';
  const [tipo, setTipo] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [registrando, setRegistrando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [roteiro, setRoteiro] = useState({ aberto: false, carregando: false, dados: null });

  const equipes = dim?.equipes || [];
  const vendedores = useMemo(() => (dim?.vendedores || []).filter((v) => !equipe || v.id_equipe === equipe), [dim, equipe]);
  const fotos = useMemo(() => new Map([...(dim?.equipes || []), ...(dim?.vendedores || [])].map((v) => [String(v.id), v.foto])), [dim]);
  useEffect(() => {
    setSel(new Set());
    setTipo('');
  }, [vendedor, campanha]);

  const { dados: resposta, erro, carregando, recarregar } = useApi(vendedor ? `/planos?vendedor=${vendedor}${campanha ? `&campanha=${campanha}` : ''}` : null);
  useRelerEnquanto(resposta?.atualizando, recarregar);
  const plano = resposta?.pendente ? null : resposta;
  const itens = useMemo(() => (plano?.itens || []).filter((i) => !tipo || i.tipo === tipo), [plano, tipo]);
  const maxScore = useMemo(() => Math.max(1e-9, ...(plano?.itens || []).map((i) => i.score)), [plano]);
  const selecionados = (plano?.itens || []).filter((i) => sel.has(i.chave));
  const alvo = selecionados.length ? selecionados : itens.slice(0, 8);

  const alternar = (k) => setSel((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const registrar = async () => {
    setRegistrando(true);
    try {
      const r = await post('/planos/registrar', { vendedor, campanha: campanha || undefined, itens: alvo });
      toast.ok(`${fmtNumero(r.registradas)} ação(ões) registradas. O sistema confere as compras até ${fmtData(r.expira_em)}${r.ignoradas ? ` (${r.ignoradas} já estavam em aberto)` : ''}.`);
      setSel(new Set());
      setVersao((v) => v + 1);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setRegistrando(false);
    }
  };

  const enviarWhats = () => {
    const tel = plano?.vendedor?.telefone;
    if (!tel) return toast.erro('Vendedor sem telefone cadastrado.');
    window.open(`https://wa.me/55${String(tel).replace(/\D/g, '')}?text=${encodeURIComponent(textoWhatsApp(plano, alvo))}`, '_blank', 'noopener');
  };

  const gerarRoteiro = async () => {
    setRoteiro({ aberto: true, carregando: true, dados: null });
    try {
      const d = await post('/ia/roteiro', { vendedor, campanha: campanha || undefined, itens: alvo.map((i) => i.chave) });
      setRoteiro({ aberto: true, carregando: false, dados: d });
    } catch (e) {
      toast.erro(e.message);
      setRoteiro({ aberto: false, carregando: false, dados: null });
    }
  };

  const contagem = plano?.resumo?.por_tipo || {};
  const nomeVendedor = plano?.vendedor?.nome || vendedores.find((v) => String(v.id) === vendedor)?.nome;

  return (
    <div>
      <Cabecalho
        sobre={<><Crosshair size={13} /> Inteligência comercial</>}
        titulo="Planos de ataque"
        subtitulo="Para cada vendedor, quais clientes procurar, por que e o que oferecer. Tudo tirado do histórico real de compra."
        info={EXPLICA_PLANO.pagina}
      />
      <div className="linha quebra" style={{ gap: 8, marginBottom: 14 }}>
        <Seletor opcoes={equipes.map((e) => ({ valor: e.id, rotulo: e.nome }))} valor={equipe} aoMudar={(v) => definirQuery({ equipe: v || null, vendedor: null })} vazio="Todas as equipes" style={{ width: 240 }} />
        <Seletor opcoes={vendedores.map((v) => ({ valor: v.id, rotulo: v.nome }))} valor={vendedor} aoMudar={(v) => definirQuery({ vendedor: v || null })} vazio={equipe ? 'Visão da equipe' : 'Escolha o vendedor'} style={{ width: 240 }} />
        <Seletor opcoes={(campanhas || []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))} valor={campanha} aoMudar={(v) => definirQuery({ campanha: v || null })} vazio="Todos os motivos" style={{ width: 280 }} />
        <Explica
          titulo="Filtro de campanha"
          texto="Com uma campanha escolhida, o plano mostra só os clientes que podem ajudar a bater aquela campanha."
          como='Em "Todos os motivos" entram também recompra, queda, venda cruzada e inativos.'
        />
        {vendedor && <Botao variante="fantasma" icone={Users} onClick={() => definirQuery({ vendedor: null })}>Voltar à equipe</Botao>}
        {!vendedor && equipe && <Botao variante="fantasma" icone={Users} onClick={() => definirQuery({ equipe: null })}>Todas as equipes</Botao>}
      </div>
      <ComoFunciona />

      <div className="ig-grade-lateral" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
        <div style={{ minWidth: 0 }}>
          {!vendedor && !equipe && <VisaoGeral fotos={fotos} aoEscolherEquipe={(id) => definirQuery({ equipe: id })} />}
          {!vendedor && equipe && <VisaoEquipe equipe={equipe} fotos={fotos} aoEscolher={(id) => definirQuery({ vendedor: id })} />}
          {vendedor && erro && <ErroCarga erro={erro} aoTentar={recarregar} />}
          {vendedor && (carregando || resposta?.pendente) && !plano && <div className="coluna" style={{ gap: 16 }}><EsqueletoKpis /><EsqueletoLista linhas={4} altura={120} /></div>}
          {vendedor && plano && (
            <div className="coluna" style={{ gap: 16 }}>
              <div className="linha" style={{ gap: 10 }}>
                <Avatar nome={nomeVendedor} foto={fotos.get(String(vendedor))} tamanho="g" />
                <div className="coluna" style={{ gap: 0 }}>
                  <span className="forte" style={{ fontSize: 16 }}>{nomeVendedor}</span>
                  <span className="pequeno sec">{plano.vendedor.equipe ? `Equipe ${plano.vendedor.equipe} · ` : ''}vendas até {fmtData(plano.referencia)}</span>
                  <SeloAtualizando ativo={plano.atualizando} />
                </div>
              </div>
              <div className="grade-4 ig-kpis">
                <Kpi rotulo={<Rotulo texto="Clientes" info={EXPLICA_PLANO.clientes} />} valor={plano.resumo.clientes} icone={Users} rodape={<span className="mudo pequeno">com ação, de {fmtNumero(plano.resumo.carteira)} na carteira</span>} />
                <Kpi rotulo={<Rotulo texto="Potencial" info={EXPLICA_PLANO.potencial} />} valor={plano.resumo.potencial_total} formato="moeda" compacto icone={Wallet} rodape={<span className="mudo pequeno">se todas dessem certo</span>} />
                <Kpi rotulo={<Rotulo texto="Venda provável" info={EXPLICA_PLANO.vendaProvavel} />} valor={plano.resumo.valor_esperado} formato="moeda" compacto icone={Target} rodape={<span className="mudo pequeno">pela chance de cada ação</span>} />
                <div className="cartao kpi">
                  <div className="kpi-rotulo"><ClipboardList size={15} /> Ações por tipo</div>
                  <BarraEmpilhada altura={8} mostrarLegenda={false} partes={ORDEM_TIPOS.map((t) => ({ rotulo: TIPO_PLANO[t].rotulo, valor: contagem[t] || 0, cor: TIPO_PLANO[t].cor }))} />
                  <div className="mini mudo">
                    {plano.resumo.total_encontrado > plano.itens.length
                      ? `${fmtNumero(plano.itens.length)} mais importantes de ${fmtNumero(plano.resumo.total_encontrado)} encontradas`
                      : `${fmtNumero(plano.itens.length)} ações encontradas`}
                  </div>
                </div>
              </div>

              <div className="linha quebra" style={{ gap: 8 }}>
                <span className="pequeno sec linha g4">
                  Tipo de ação
                  <Explica
                    titulo="Tipos de ação"
                    texto="Cada cartão abaixo é um motivo para procurar o cliente. Clique num tipo para ver só ele."
                    como={ORDEM_TIPOS.map((t) => `${TIPO_PLANO[t].rotulo}: ${TIPO_PLANO[t].explica.texto}`)}
                    largura={380}
                  />
                </span>
                <Chip ativo={!tipo} onClick={() => setTipo('')}>Todas <span className="mudo num">{fmtNumero(plano.itens.length)}</span></Chip>
                {ORDEM_TIPOS.filter((t) => contagem[t]).map((t) => {
                  const T = TIPO_PLANO[t];
                  return <Chip key={t} ativo={tipo === t} icone={T.icone} onClick={() => setTipo(tipo === t ? '' : t)}>{T.rotulo} <span className="mudo num">{fmtNumero(contagem[t])}</span></Chip>;
                })}
              </div>

              {!itens.length ? (
                <Vazio icone={Crosshair} titulo="Nenhuma ação para este filtro" texto="Sem recompras atrasadas, quedas, inativos ou oportunidades de campanha na carteira deste vendedor agora." />
              ) : (
                <>
                  <div className="mini sec" style={{ marginBottom: -6 }}>Clique nos cartões para marcar os clientes que o vendedor deve procurar primeiro. A lista já vem na ordem de prioridade.</div>
                  <ListaAnimada itens={itens} chave={(i) => i.chave} gap={10} render={(i) => <PlanoCartao item={i} selecionado={sel.has(i.chave)} aoAlternar={() => alternar(i.chave)} maxScore={maxScore} />} />
                </>
              )}

              {itens.length > 0 && (
                <div className="ig-barra-acoes">
                  <span className="pequeno">
                    {selecionados.length ? <><strong>{fmtNumero(selecionados.length)}</strong> marcada(s) · {fmtMoeda(selecionados.reduce((s, i) => s + i.valor_potencial, 0))} de potencial</> : <span className="sec">Nada marcado: vale para as {fmtNumero(alvo.length)} primeiras</span>}
                  </span>
                  {selecionados.length > 0 && <Botao tamanho="p" variante="fantasma" icone={X} onClick={() => setSel(new Set())}>Limpar</Botao>}
                  <div className="cresce" />
                  <Explica
                    titulo="O que fazer com o plano"
                    como={[
                      `Roteiro com IA: ${EXPLICA_PLANO.roteiro.texto}`,
                      `Enviar ao vendedor: ${EXPLICA_PLANO.enviar.texto} ${EXPLICA_PLANO.enviar.como}`,
                      `Registrar plano: ${EXPLICA_PLANO.registrar.texto} Se o cliente comprar em até 30 dias, a ação vira "convertida" sozinha.`,
                    ]}
                    largura={380}
                  />
                  <Botao tamanho="p" icone={Brain} onClick={gerarRoteiro} title="Custa frações de centavo de dólar">Roteiro com IA</Botao>
                  <Botao tamanho="p" icone={MessageCircle} onClick={enviarWhats}>Enviar ao vendedor</Botao>
                  <Botao tamanho="p" variante="primario" icone={CheckCheck} carregando={registrando} onClick={registrar}>Registrar plano</Botao>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="ig-pegajoso">
          <PainelConversao vendedor={vendedor} versao={versao} />
        </div>
      </div>
      <ModalRoteiro aberto={roteiro.aberto} carregando={roteiro.carregando} dados={roteiro.dados} telefone={plano?.vendedor?.telefone} vendedor={plano?.vendedor?.nome}
        aoFechar={() => setRoteiro({ aberto: false, carregando: false, dados: null })} />
    </div>
  );
}
