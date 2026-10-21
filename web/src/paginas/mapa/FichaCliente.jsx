import { AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, Clock, Lightbulb, Target, Users } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc } from '../../lib/formato.js';
import { Avatar, Esqueleto, Explica, Selo } from '../../componentes/ui.jsx';
import { GraficoColunas } from '../../componentes/graficos.jsx';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotMes = (m) => MES[Number(m.slice(5, 7)) - 1];

function Bloco({ titulo, info, children }) {
  return (
    <div className="ficha-bloco">
      <div className="mapa-secao-rotulo linha g4">{titulo}{info && <Explica titulo={titulo} {...info} tamanho={12} />}</div>
      {children}
    </div>
  );
}
function Num({ rotulo, valor, sub }) {
  return (
    <div className="mapa-kpi">
      <span className="rot">{rotulo}</span>
      <span className="val">{valor}</span>
      {sub && <span className="mudo pequeno">{sub}</span>}
    </div>
  );
}
const Variacao = ({ v }) => (v == null ? null : (
  <span className={v >= 0 ? 'texto-bom' : 'texto-critico'} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
    {v >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{fmtPerc(Math.abs(v))}
  </span>
));

/** Ficha completa do cliente (pré-calculada pela pipeline). Usada no painel do mapa. */
export default function FichaCliente({ id }) {
  const { dados: f, carregando } = useApi(`/clientes/${id}/ficha`);
  if (carregando && !f) return <Esqueleto altura={14} linhas={6} />;
  if (!f) return null;
  const r = f.resumo;
  return (
    <div className="ficha-cliente">
      <Bloco titulo="Compras nos últimos 12 meses" info={{ texto: 'Valor faturado por mês. Passe o mouse em cada coluna. A comparação é com os mesmos 12 meses do ano anterior.' }}>
        <GraficoColunas itens={f.serie.map((s) => ({ rotulo: s.mes, valor: s.valor }))} formato="moeda" altura={120} formatarX={rotMes} />
        <div className="mapa-grade">
          <Num rotulo="12 meses" valor={fmtMoeda(r.valor_12m, { compacto: true })} sub={<>ano anterior {fmtMoeda(r.valor_12m_anterior, { compacto: true })} <Variacao v={r.variacao_12m} /></>} />
          <Num rotulo="Último trimestre" valor={<Variacao v={r.tendencia_trimestre} />} sub="contra o trimestre anterior" />
          <Num rotulo="Ticket médio" valor={fmtMoeda(r.ticket_medio, { compacto: true })} sub={`${fmtNumero(r.pedidos_12m)} pedidos em 12 meses`} />
        </div>
      </Bloco>

      <Bloco titulo="Frequência" info={{ texto: 'De quantos em quantos dias o cliente costuma comprar. Recompra atrasada: está sem comprar há mais de 1,6 vez o intervalo normal dele.', exemplo: 'Compra a cada 10 dias e está há 18 sem pedido: recompra atrasada.' }}>
        <div className="linha quebra g4">
          <Selo icone={Clock}>{r.intervalo_medio_dias != null ? `Compra a cada ${fmtNumero(r.intervalo_medio_dias)} dias` : 'Sem histórico de frequência'}</Selo>
          {r.ultima_compra && <Selo>Última compra {fmtData(r.ultima_compra)} ({r.dias_sem_comprar} dias)</Selo>}
          {r.recompra_atrasada && <Selo cor="aviso" icone={AlertTriangle}>Recompra atrasada</Selo>}
          {r.devolucoes_12m > 0 && <Selo cor="aviso">{r.devolucoes_12m} devoluções em 12 meses</Selo>}
        </div>
      </Bloco>

      <Bloco titulo="Carteira e quem vende" info={{ texto: 'Dono da carteira é o vendedor responsável pela área (cidade ou bairro) onde o cliente está. Ao lado, quem de fato tirou os pedidos nos últimos 90 dias.', como: 'Se outro vendedor faz a maior parte das vendas, alinhe quem atende ou reveja a área na tela Carteiras.' }}>
        {f.carteira ? (
          <div className="linha g8">
            <Avatar nome={f.carteira.dono.nome} foto={f.carteira.dono.foto} />
            <div className="coluna" style={{ gap: 0 }}>
              <span className="forte">{f.carteira.dono.nome}</span>
              <span className="mudo pequeno"><Briefcase size={12} /> {f.carteira.nome}</span>
            </div>
            <span className="cresce" />
            {f.dono_vende_pct != null && <Selo cor={f.dono_vende_pct >= 70 ? 'bom' : 'aviso'}>Dono fez {fmtPerc(f.dono_vende_pct)} das vendas</Selo>}
          </div>
        ) : <span className="mudo pequeno">Fora de qualquer carteira (área sem dono).</span>}
        {f.quem_vende.length > 0 && (
          <div className="coluna" style={{ gap: 4 }}>
            {f.quem_vende.slice(0, 4).map((v) => (
              <div key={v.id} className="linha g8 pequeno">
                <Avatar nome={v.nome} foto={v.foto} tamanho="p" />
                <span className="cresce truncar">{v.nome}{v.dono ? ' (dono)' : ''}</span>
                <span className="num">{fmtMoeda(v.valor, { compacto: true })}</span>
                <span className="mudo num" style={{ width: 44, textAlign: 'right' }}>{fmtPerc(v.pct)}</span>
              </div>
            ))}
          </div>
        )}
      </Bloco>

      {f.acoes.length > 0 && (
        <Bloco titulo="Plano de ataque para este cliente" info={{ texto: 'Ações sugeridas pelo plano de ataque do vendedor, com o valor provável se a ação der certo.' }}>
          {f.acoes.slice(0, 4).map((a, i) => (
            <div key={i} className="ficha-acao">
              <Target size={14} />
              <div className="coluna cresce" style={{ gap: 1 }}>
                <span className="forte pequeno">{a.tipo_rotulo}: {a.titulo}</span>
                <span className="mudo pequeno">{a.motivo}</span>
              </div>
              <span className="num pequeno">{fmtMoeda(a.valor_potencial * (a.probabilidade || 1), { compacto: true })}</span>
            </div>
          ))}
        </Bloco>
      )}

      {f.oportunidades.length > 0 && (
        <Bloco titulo="Clientes parecidos compram e ele não" info={{ texto: `Produtos comprados por boa parte dos clientes do mesmo tipo e porte (${f.participacao.base}) que este cliente não comprou nos últimos 6 meses. O valor é a média por trimestre de quem compra.` }}>
          {f.oportunidades.map((o) => (
            <div key={o.id} className="linha g8 pequeno">
              <Lightbulb size={13} className="mudo" />
              <span className="cresce truncar">{o.nome}</span>
              <span className="mudo">{fmtPerc(o.penetracao)} compram</span>
              <span className="num">{fmtMoeda(o.valor_trimestre, { compacto: true })}</span>
            </div>
          ))}
        </Bloco>
      )}

      <Bloco titulo="Mix" info={{ texto: 'O que mais comprou nos últimos 90 dias e o que comprava antes (de 3 a 9 meses atrás) e parou.' }}>
        <div className="coluna" style={{ gap: 3 }}>
          {f.mix.compra.slice(0, 5).map((p) => (
            <div key={p.id} className="linha g8 pequeno"><span className="cresce truncar">{p.nome}</span><span className="mudo">{fmtNumero(p.unidades)} un</span><span className="num">{fmtMoeda(p.valor, { compacto: true })}</span></div>
          ))}
          {f.mix.deixou_de_comprar.length > 0 && <span className="mapa-secao-rotulo" style={{ marginTop: 6 }}>Deixou de comprar</span>}
          {f.mix.deixou_de_comprar.map((p) => (
            <div key={p.id} className="linha g8 pequeno"><span className="cresce truncar">{p.nome}</span><span className="mudo">há {p.dias_sem} dias</span><span className="num">{fmtMoeda(p.valor_antes, { compacto: true })}</span></div>
          ))}
        </div>
      </Bloco>

      {f.campanhas.length > 0 && (
        <Bloco titulo="Campanhas em que ele conta" info={{ texto: 'Campanhas ativas cujos produtos o cliente comprou no período. "Do vendedor" é quanto das unidades do vendedor na campanha vieram deste cliente.' }}>
          {f.campanhas.map((c) => (
            <a key={c.id} href={`#/campanhas/${c.id}`} className="linha g8 pequeno ficha-link">
              <span className="cresce truncar">{c.nome}</span>
              <span className="mudo">{fmtNumero(c.unidades)} un</span>
              {c.pct_do_vendedor != null && <Selo>{fmtPerc(c.pct_do_vendedor)} do vendedor</Selo>}
            </a>
          ))}
        </Bloco>
      )}

      <Bloco titulo="Comparação e participação" info={{ texto: 'Posição do cliente pelo valor comprado em 90 dias entre os vizinhos. Participação estimada: quanto ele compra de nós frente ao que compram os melhores clientes parecidos (o potencial).', exemplo: 'Compra R$ 26 mil e o potencial é R$ 56 mil: participação de 47%, há espaço para crescer.' }}>
        <div className="mapa-grade">
          {f.vizinhos.bairro && <Num rotulo={`No bairro ${f.cliente.bairro}`} valor={`${f.vizinhos.bairro.posicao}º de ${f.vizinhos.bairro.de}`} sub={`mediana ${fmtMoeda(f.vizinhos.bairro.mediana, { compacto: true })}`} />}
          {f.vizinhos.cidade && <Num rotulo="Na cidade" valor={`${f.vizinhos.cidade.posicao}º de ${f.vizinhos.cidade.de}`} sub={`mediana ${fmtMoeda(f.vizinhos.cidade.mediana, { compacto: true })}`} />}
          <Num rotulo="Participação" valor={f.participacao.pct != null ? fmtPerc(f.participacao.pct) : '-'} sub={`potencial ${fmtMoeda(f.participacao.potencial_90d, { compacto: true })} em 90 dias`} />
        </div>
      </Bloco>

      <Bloco titulo="Últimos pedidos" info={{ texto: 'Pedidos dos últimos 12 meses, do mais recente. Mostra quem tirou cada pedido.' }}>
        <div className="coluna" style={{ gap: 3 }}>
          {f.ultimos_pedidos.slice(0, 6).map((p) => (
            <div key={p.pedido} className="linha g8 pequeno">
              <span className="num mudo" style={{ width: 64 }}>{fmtData(p.data)}</span>
              <span className="cresce truncar">{p.vendedor} · {p.itens} itens{p.status !== 'Faturado' ? ` · ${p.status}` : ''}</span>
              <span className="num">{fmtMoeda(p.valor, { compacto: true })}</span>
            </div>
          ))}
        </div>
      </Bloco>
      {f.cliente.contato && <span className="mudo pequeno"><Users size={12} /> Contato: {f.cliente.contato}</span>}
    </div>
  );
}
