import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, Lightbulb, Map as IconeMapa, MapPin, Plus, Trash2, Users, XCircle } from 'lucide-react';
import { del, get, post, useApi } from '../lib/api.js';
import { fmtMoeda, fmtNumero, fmtPerc } from '../lib/formato.js';
import {
  Aviso, Avatar, Botao, BotaoIcone, Cabecalho, Campo, Carregando, Cartao, ErroCarga, Explica, Gaveta, Kpi, Modal, Secao, Selo, Seletor, Tabela, useToast,
} from '../componentes/ui.jsx';

const INFO = {
  pagina: {
    texto: 'Carteira é a área de cada vendedor: estados, cidades, bairros ou territórios desenhados no mapa. Cada cliente e cada farmácia da Receita cai em uma só carteira (vale a regra mais específica). O sistema mostra se quem vende é o dono da área, quem está vendendo na área dos outros e onde há potencial sem dono.',
    como: ['Clique numa carteira para ver as áreas e os melhores prospects.', 'Inclua cidades ou bairros pela lista.', 'Use as sugestões para equilibrar as carteiras da equipe.'],
  },
  aderencia: { texto: 'Quanto da venda dos clientes da carteira foi feita pelo próprio dono. Abaixo de 80% indica área mal definida ou vendedores invadindo.', exemplo: 'Clientes da carteira compraram R$ 100 mil; o dono vendeu R$ 85 mil: aderência de 85%.' },
  invasao: { texto: 'Venda feita por outro vendedor para clientes que estão na carteira de alguém. Pode ser cobertura de férias, mas, se for constante, a área precisa ser revista.' },
  potencial: { texto: 'Farmácias independentes da carteira que ainda não são clientes, vezes o quanto um cliente típico da UF compra em 90 dias.' },
  equilibrio: { texto: 'Compara o tamanho de cada carteira com a média da equipe. 1,00 é a média; 1,40 é 40% maior.', como: 'Carteiras muito acima da média sobrecarregam o vendedor; muito abaixo deixam potencial parado.' },
  semDono: { texto: 'Clientes e farmácias que não caem em nenhuma regra de carteira. Venda feita ali não tem responsável definido.' },
};

const corDe = (c) => `var(--${c || 's1'})`;

export default function Carteiras() {
  const { dados, erro, carregando, recarregar } = useApi('/carteiras', { vivo: true });
  const [aberta, setAberta] = useState(null);
  const [nova, setNova] = useState(false);
  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (carregando && !dados) return <Carregando />;
  const d = dados;
  if (d.pendente) return <Aviso tipo="info">As carteiras estão sendo calculadas pela pipeline de dados. A tela atualiza sozinha.</Aviso>;
  const e = d.empresa;
  return (
    <div>
      <Cabecalho titulo="Carteiras de vendas" info={INFO.pagina} subtitulo={`Vendas de 90 dias até ${d.referencia.split('-').reverse().join('/')}${d.atualizando ? ' · atualizando' : ''}`}
        acoes={(
          <>
            <Botao icone={IconeMapa} onClick={() => { window.location.hash = '#/mapa?uf=ES&camadas=carteiras'; }}>Ver no mapa</Botao>
            <Botao variante="primario" icone={Plus} onClick={() => setNova(true)}>Nova carteira</Botao>
          </>
        )} />
      <div className="cart-kpis">
        <Kpi rotulo="Carteiras" valor={e.carteiras} icone={Briefcase} />
        <Kpi rotulo="Clientes nas carteiras" valor={e.clientes} rodape={`${fmtNumero(e.ativos)} ativos`} />
        <Kpi rotulo="Aderência" valor={e.aderencia ?? 0} formato="perc" dica={INFO.aderencia.texto} rodape="venda feita pelo dono" />
        <Kpi rotulo="Venda de outros na área" valor={e.venda_outros} formato="moeda" compacto dica={INFO.invasao.texto} />
        <Kpi rotulo="Farmácias livres" valor={e.farmacias_livres} rodape={`penetração ${fmtPerc(e.penetracao ?? 0)}`} />
        <Kpi rotulo="Potencial 90 dias" valor={e.potencial_90d} formato="moeda" compacto dica={INFO.potencial.texto} />
      </div>

      <Secao titulo="Hierarquia" info={{ texto: 'Região (coordenador) → equipe (gerente) → carteira (vendedor). Os números de cada nível são a soma do nível de baixo; a conferência no fim da página mostra que batem.' }}>
        {d.regioes.map((r) => (
          <Cartao key={r.id || 'sem'} titulo={r.nome} subtitulo={r.coordenador ? `Coordenação: ${r.coordenador.nome}` : null}
            acoes={<Selo>{fmtNumero(r.clientes)} clientes · {fmtMoeda(r.venda_90d, { compacto: true })} · aderência {fmtPerc(r.aderencia ?? 0)}</Selo>}>
            {d.equipes.filter((q) => r.equipes_ids.includes(q.id_gerente)).map((q) => (
              <div key={q.id_gerente || 'x'} className="cart-equipe">
                <div className="linha entre quebra">
                  <span className="linha g8">
                    {q.gerente && <Avatar nome={q.gerente.nome} foto={q.gerente.foto} tamanho="p" />}
                    <span className="forte">{q.nome}</span>
                    {q.gerente && <span className="mudo pequeno">gerente {q.gerente.nome}</span>}
                  </span>
                  <span className="mudo pequeno">
                    {q.carteiras} carteiras · equilíbrio {q.equilibrio_clientes != null ? `${fmtNumero(q.equilibrio_clientes)}% de variação` : '-'}
                    <Explica titulo="Equilíbrio da equipe" texto="Variação do número de clientes entre as carteiras da equipe (coeficiente de variação). Quanto menor, mais equilibrado." tamanho={12} />
                  </span>
                </div>
                <TabelaCarteiras linhas={d.carteiras.filter((c) => q.carteiras_ids.includes(c.id))} aoAbrir={setAberta} />
              </div>
            ))}
          </Cartao>
        ))}
      </Secao>

      <div className="grade-2">
        <Cartao titulo="Sugestões de ajuste" info={{ texto: 'Geradas a partir dos números: áreas a passar de uma carteira grande para a menor da equipe e clientes comprados quase só por outro vendedor.' }}>
          {d.sugestoes.length === 0 && <span className="mudo">Nenhuma sugestão agora.</span>}
          <div className="coluna" style={{ gap: 8 }}>
            {d.sugestoes.slice(0, 10).map((s, i) => (
              <div key={i} className="ficha-acao">
                {s.prioridade === 'alta' ? <AlertTriangle size={14} /> : <Lightbulb size={14} />}
                <div className="coluna" style={{ gap: 1 }}>
                  <span className="forte pequeno">{s.titulo}</span>
                  <span className="mudo pequeno">{s.texto}</span>
                </div>
              </div>
            ))}
          </div>
        </Cartao>
        <Cartao titulo="Sem dono" info={INFO.semDono}>
          <div className="linha quebra" style={{ gap: 18, marginBottom: 10 }}>
            <span><span className="forte">{fmtNumero(d.sem_dono.clientes)}</span> <span className="mudo">clientes</span></span>
            <span><span className="forte">{fmtMoeda(d.sem_dono.venda_90d, { compacto: true })}</span> <span className="mudo">vendidos em 90 dias</span></span>
            <span><span className="forte">{fmtNumero(d.sem_dono.farmacias)}</span> <span className="mudo">farmácias</span></span>
          </div>
          <div className="coluna" style={{ gap: 4 }}>
            {d.sem_dono.areas.slice(0, 8).map((a) => (
              <div key={a.ibge} className="linha g8 pequeno">
                <MapPin size={13} className="mudo" />
                <span className="cresce truncar">{a.cidade}/{a.uf}</span>
                <span className="mudo">{fmtNumero(a.clientes)} clientes · {fmtNumero(a.farmacias)} farmácias</span>
                <span className="num">{fmtMoeda(a.potencial_90d, { compacto: true })}</span>
              </div>
            ))}
          </div>
        </Cartao>
      </div>

      <Secao titulo="Conferência das somas" info={{ texto: 'Soma das carteiras, das equipes, das regiões e da empresa para cada número. Todas precisam bater. A última linha confere que venda com dono mais venda sem dono é igual ao total da base.' }}>
        <div className="linha quebra g8">
          {d.conferencia.map((c) => (
            <Selo key={c.campo} cor={c.ok ? 'bom' : 'critico'} icone={c.ok ? CheckCircle2 : XCircle}>{c.campo}</Selo>
          ))}
        </div>
      </Secao>

      <DetalheCarteira id={aberta} aoFechar={() => setAberta(null)} aoMudar={recarregar} />
      <NovaCarteira aberto={nova} aoFechar={() => setNova(false)} usadas={new Set(d.carteiras.map((c) => c.vendedor?.id))} aoCriar={(c) => { setNova(false); recarregar(); setAberta(c.id); }} />
    </div>
  );
}

function TabelaCarteiras({ linhas, aoAbrir }) {
  const colunas = [
    { chave: 'nome', titulo: 'Carteira', render: (l) => (
      <span className="linha g8">
        <span className="cart-cor" style={{ background: corDe(l.cor) }} />
        {l.vendedor && <Avatar nome={l.vendedor.nome} foto={l.vendedor.foto} tamanho="p" />}
        <span className="coluna" style={{ gap: 0 }}><span className="forte">{l.vendedor?.nome || 'Sem vendedor'}</span><span className="mudo pequeno">{l.nome}</span></span>
      </span>
    ) },
    { chave: 'area', titulo: 'Área', render: (l) => <span className="mudo pequeno">{[l.regras.cidades && `${l.regras.cidades} cidades`, l.regras.bairros && `${l.regras.bairros} bairros`, l.regras.territorios && `${l.regras.territorios} territórios`, l.regras.ufs && `${l.regras.ufs} UF`].filter(Boolean).join(', ') || 'vazia'}</span> },
    { chave: 'clientes', titulo: 'Clientes', alinhar: 'direita', ordenavel: true, render: (l) => <span className="num">{fmtNumero(l.clientes)} <span className="mudo">({fmtNumero(l.ativos)})</span></span> },
    { chave: 'venda_90d', titulo: 'Venda 90d', alinhar: 'direita', ordenavel: true, render: (l) => <span className="num">{fmtMoeda(l.venda_90d, { compacto: true })}</span> },
    { chave: 'aderencia', titulo: 'Aderência', alinhar: 'direita', ordenavel: true, render: (l) => (l.aderencia == null ? <span className="mudo">-</span> : <Selo cor={l.aderencia >= 80 ? 'bom' : l.aderencia >= 50 ? 'aviso' : 'critico'}>{fmtPerc(l.aderencia)}</Selo>) },
    { chave: 'invasores', titulo: 'Quem vende na área', render: (l) => (l.invasores.length ? <span className="mudo pequeno truncar">{l.invasores.slice(0, 2).map((x) => x.nome).join(', ')}{l.invasores.length > 2 ? ` e +${l.invasores.length - 2}` : ''}</span> : <span className="mudo">-</span>) },
    { chave: 'farmacias_livres', titulo: 'Farmácias livres', alinhar: 'direita', ordenavel: true, render: (l) => <span className="num">{fmtNumero(l.farmacias_livres)}</span> },
    { chave: 'potencial_90d', titulo: 'Potencial', alinhar: 'direita', ordenavel: true, render: (l) => <span className="num">{fmtMoeda(l.potencial_90d, { compacto: true })}</span> },
    { chave: 'indice_clientes', titulo: 'Tamanho', alinhar: 'direita', ordenavel: true, render: (l) => <span className={`num ${l.indice_clientes > 1.35 ? 'forte' : 'mudo'}`}>{l.indice_clientes != null ? fmtNumero(l.indice_clientes, 2) : '-'}</span> },
  ];
  return <Tabela colunas={colunas} linhas={linhas} aoClicarLinha={(l) => aoAbrir(l.id)} densa />;
}

function DetalheCarteira({ id, aoFechar, aoMudar }) {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [nivel, setNivel] = useState('cidade');
  const [uf, setUf] = useState('ES');
  const [cidades, setCidades] = useState([]);
  const [ibge, setIbge] = useState('');
  const [bairros, setBairros] = useState([]);
  const [bairro, setBairro] = useState('');
  const carregar = () => id && get(`/carteiras/${id}`).then(setC).catch(() => setC(null));
  useEffect(() => {
    setC(null);
    carregar();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (id) get(`/mapa/cidades?uf=${uf}`).then((l) => setCidades(l)).catch(() => setCidades([]));
  }, [uf, id]);
  useEffect(() => {
    setBairros([]);
    setBairro('');
    if (nivel === 'bairro' && ibge) get(`/mapa/bairros/${ibge}`).then((r) => setBairros((r.bairros || []).map((b) => ({ id: b.id, nome: b.nome })).sort((a, b) => a.nome.localeCompare(b.nome)))).catch(() => setBairros([]));
  }, [nivel, ibge]);
  const incluir = async (mover = false) => {
    const corpo = nivel === 'cidade' ? { nivel, ibge } : { nivel, ibge, bairro_id: bairro, nome: bairros.find((b) => b.id === bairro)?.nome };
    try {
      await post(`/carteiras/${id}/regras`, { ...corpo, mover });
      toast.ok('Área incluída. Os números se atualizam em instantes.');
      carregar();
      aoMudar();
    } catch (e) {
      if (e.status === 409 && !mover && window.confirm(e.message)) return incluir(true);
      if (e.status !== 409) toast.erro(e.message);
    }
  };
  const remover = async (r) => {
    await del(`/carteiras/regras/${r.id}`);
    carregar();
    aoMudar();
  };
  const ind = c?.indicadores;
  return (
    <Gaveta aberto={Boolean(id)} aoFechar={aoFechar} titulo={c?.vendedor?.nome || 'Carteira'} subtitulo={c?.nome} largura={760}>
      {!c ? <Carregando /> : (
        <div className="coluna" style={{ gap: 18 }}>
          {ind && (
            <div className="cart-kpis">
              <Kpi rotulo="Clientes" valor={ind.clientes} rodape={`${ind.ativos} ativos`} />
              <Kpi rotulo="Aderência" valor={ind.aderencia ?? 0} formato="perc" dica={INFO.aderencia.texto} />
              <Kpi rotulo="Vendeu fora da carteira" valor={ind.venda_fora} formato="moeda" compacto dica="Venda deste vendedor para clientes de outras carteiras ou sem dono." />
              <Kpi rotulo="Potencial" valor={ind.potencial_90d} formato="moeda" compacto dica={INFO.potencial.texto} />
            </div>
          )}
          {ind?.invasores?.length > 0 && (
            <Cartao titulo="Outros vendedores vendendo na área" info={INFO.invasao}>
              {ind.invasores.map((x) => (
                <div key={x.id_vendedor} className="linha g8 pequeno"><Avatar nome={x.nome} foto={x.foto} tamanho="p" /><span className="cresce">{x.nome}</span><span className="mudo">{x.clientes} clientes</span><span className="num">{fmtMoeda(x.valor, { compacto: true })}</span></div>
              ))}
            </Cartao>
          )}
          <Cartao titulo="Áreas da carteira" info={{ texto: 'Regras que definem a carteira. Bairro e território valem mais que cidade, que vale mais que UF.' }}
            acoes={<Botao tamanho="p" icone={IconeMapa} onClick={() => { window.location.hash = `#/mapa?uf=${c.indicadores?.uf || c.vendedor?.uf || 'ES'}&carteira=${c.id}`; }}>Montar no mapa</Botao>}>
            <div className="coluna" style={{ gap: 4, maxHeight: 220, overflow: 'auto' }}>
              {c.regras.map((r) => (
                <div key={r.id} className="linha g8 pequeno">
                  <Selo>{r.nivel === 'bairro' ? 'Bairro' : r.nivel === 'cidade' ? 'Cidade' : r.nivel === 'uf' ? 'UF' : 'Território'}</Selo>
                  <span className="cresce truncar">{r.nome}</span>
                  <BotaoIcone icone={Trash2} tamanho="p" rotulo="Tirar da carteira" onClick={() => remover(r)} />
                </div>
              ))}
            </div>
            <div className="linha quebra g8" style={{ marginTop: 12 }}>
              <div style={{ width: 120 }}><Seletor tamanho="p" valor={nivel} aoMudar={setNivel} opcoes={[{ valor: 'cidade', rotulo: 'Cidade' }, { valor: 'bairro', rotulo: 'Bairro' }]} /></div>
              <div style={{ width: 80 }}><Seletor tamanho="p" valor={uf} aoMudar={setUf} opcoes={['ES', 'GO', 'DF', 'MG', 'SP', 'RJ', 'BA', 'PR', 'SC', 'RS', 'CE', 'PE'].map((u) => ({ valor: u, rotulo: u }))} /></div>
              <div style={{ width: 220 }}><Seletor tamanho="p" valor={ibge} aoMudar={setIbge} opcoes={[{ valor: '', rotulo: 'Escolha a cidade' }, ...cidades.slice(0, 400).map((x) => ({ valor: x.ibge, rotulo: `${x.nome} (${x.farmacias})` }))]} /></div>
              {nivel === 'bairro' && <div style={{ width: 200 }}><Seletor tamanho="p" valor={bairro} aoMudar={setBairro} opcoes={[{ valor: '', rotulo: bairros.length ? 'Escolha o bairro' : 'Sem bairros' }, ...bairros.map((b) => ({ valor: b.id, rotulo: b.nome }))]} /></div>}
              <Botao tamanho="p" icone={Plus} disabled={!ibge || (nivel === 'bairro' && !bairro)} onClick={() => incluir(false)}>Incluir</Botao>
            </div>
          </Cartao>
          {c.prospects.length > 0 && (
            <Cartao titulo="Melhores farmácias para prospectar" info={{ texto: 'Farmácias da carteira que ainda não são clientes, pela nota de prospecção (independente, abertura recente, saúde cadastral, contato e proximidade de onde já vendemos).' }}>
              {c.prospects.map((p) => (
                <div key={p.cnpj} className="linha g8 pequeno"><span className="cresce truncar">{p.nome}</span><span className="mudo truncar">{p.bairro} · {p.cidade}</span><Selo>{Math.round(p.score)}</Selo></div>
              ))}
            </Cartao>
          )}
        </div>
      )}
    </Gaveta>
  );
}

function NovaCarteira({ aberto, aoFechar, usadas, aoCriar }) {
  const toast = useToast();
  const { dados: vendedores } = useApi(aberto ? '/carteiras/vendedores' : null);
  const [id, setId] = useState('');
  const opcoes = useMemo(() => (vendedores || []).filter((v) => !usadas.has(Number(v.id))).map((v) => ({ valor: v.id, rotulo: v.nome })), [vendedores, usadas]);
  const criar = async () => {
    try {
      aoCriar(await post('/carteiras', { id_vendedor: Number(id) }));
    } catch (e) {
      toast.erro(e.message);
    }
  };
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Nova carteira" largura={460}
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" icone={Users} disabled={!id} onClick={criar}>Criar</Botao></>}>
      <Campo rotulo="Vendedor" dica="Cada vendedor tem uma carteira. Depois de criar, inclua as cidades e os bairros dela.">
        <Seletor valor={id} aoMudar={setId} opcoes={[{ valor: '', rotulo: 'Escolha' }, ...opcoes]} />
      </Campo>
    </Modal>
  );
}
