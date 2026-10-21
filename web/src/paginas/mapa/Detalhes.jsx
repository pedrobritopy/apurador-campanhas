import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, Crosshair, ExternalLink, Lightbulb, Mail, MapPin, MessageCircle, Phone, Sparkles, Store, Users, X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useApi } from '../../lib/api.js';
import { navegar } from '../../lib/rotas.js';
import { fmtData, fmtMoeda, fmtNumero, fmtPerc, plural } from '../../lib/formato.js';
import { Aviso, Botao, BotaoIcone, Carregando, ErroCarga, Explica, Selo } from '../../componentes/ui.jsx';
import { GraficoBarras } from '../../componentes/graficos.jsx';
import FichaCliente from './FichaCliente.jsx';
import { ACOES, corPrioridade, fmtCnpj, fmtTelefone, linkMapas, linkWhatsapp, mesesDesde, rotuloRede, textoIdade } from './util.js';

export function Prioridade({ valor, tamanho = 34 }) {
  return (
    <span className="mapa-prioridade" title={`Prioridade ${valor} de 100`}
      style={{ width: tamanho, height: tamanho, background: `color-mix(in srgb, ${corPrioridade(valor)} 34%, var(--superficie-elevada))`, boxShadow: `inset 0 -3px 0 ${corPrioridade(valor)}`, color: 'var(--tinta)' }}>
      {valor}
    </span>
  );
}

export function SeloAcao({ tipo }) {
  const a = ACOES[tipo];
  if (!a) return null;
  return <Selo cor={a.cor} icone={a.icone} title={a.descricao}>{a.rotulo}</Selo>;
}

function Kpi({ rotulo, valor, dica }) {
  return (
    <div className="mapa-kpi">
      <span className="rot">{rotulo}{dica && <Explica titulo={rotulo} texto={dica} tamanho={12} />}</span>
      <span className="val">{valor}</span>
    </div>
  );
}

export function Titulo({ children, extra }) {
  return (
    <div className="linha entre" style={{ marginBottom: 4 }}>
      <span className="mapa-secao-rotulo">{children}</span>
      {extra}
    </div>
  );
}

export function Topo({ titulo, sub, aoFechar, direita }) {
  return (
    <div className="mapa-detalhe-topo">
      <div className="cresce" style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 16, lineHeight: 1.25 }}>{titulo}</h2>
        {sub && <div className="mudo pequeno truncar" style={{ marginTop: 3 }}>{sub}</div>}
      </div>
      {direita}
      {aoFechar && <BotaoIcone icone={X} rotulo="Fechar" onClick={aoFechar} />}
    </div>
  );
}

// ------------------------------------------------------------------ cidade
export function PainelCidade({ ibge, aoFechar, aoVoar, aoAbrirPonto, aoCriarTerritorio, campanha }) {
  const { dados, erro, carregando, recarregar } = useApi(ibge ? `/mapa/cidade/${ibge}` : null);
  const c = dados?.cidade;
  return (
    <motion.aside className="mapa-painel mapa-detalhe" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
      <Topo titulo={c ? `${c.nome} · ${c.uf}` : 'Cidade'} sub={c ? (c.capital ? 'Capital' : 'Município') + (c.distancia_km ? ` · a ${fmtNumero(c.distancia_km)} km de onde vendemos` : '') : null}
        aoFechar={aoFechar} direita={c && <Prioridade valor={c.prioridade} />} />
      {erro && <div style={{ padding: 16 }}><ErroCarga erro={erro} aoTentar={recarregar} /></div>}
      {carregando && !dados && <Carregando altura={240} />}
      {c && (
        <div className="mapa-detalhe-corpo">
          <div className="linha quebra g4">
            <SeloAcao tipo={c.acao_tipo} />
            {c.clientes_ativos > 0 && <Selo cor="acento" icone={Store}>{plural(c.clientes_ativos, 'cliente ativo', 'clientes ativos')}</Selo>}
          </div>
          <div className="mapa-grade">
            <Kpi rotulo="Farmácias" valor={fmtNumero(c.farmacias)} dica="Farmácias ativas na Receita Federal (CNAE 4771-7/01, 02, 03)" />
            <Kpi rotulo="Independentes" valor={fmtNumero(c.independentes)} dica="Empresas com uma única loja ativa" />
            <Kpi rotulo="Novas em 12 meses" valor={fmtNumero(c.abertas_12m)} />
            <Kpi rotulo="Clientes ativos" valor={`${fmtNumero(c.clientes_ativos)}/${fmtNumero(c.clientes)}`} dica="Compraram nos últimos 90 dias / cadastrados na cidade" />
            <Kpi rotulo="Penetração" valor={c.penetracao == null ? 'sem dado' : fmtPerc(c.penetracao, 1)} dica="Clientes ativos ÷ farmácias" />
            <Kpi rotulo="Potencial 90d" valor={fmtMoeda(c.potencial, { compacto: true })} dica={`Independentes não atendidas (${fmtNumero(c.nao_atendidas)}) × ticket esperado de ${fmtMoeda(c.ticket_esperado)}`} />
          </div>
          <div className="mapa-plano">
            <Lightbulb size={16} />
            <div>
              <div className="forte" style={{ marginBottom: 2 }}>Plano de ação</div>
              {c.acao}
            </div>
          </div>
          {campanha && c.campanha && (
            <Aviso tipo="info" titulo={`Campanha: ${campanha.nome}`}>
              {plural(c.campanha.positivados, 'cliente positivado', 'clientes positivados')}
              {c.campanha.positivacao != null && ` (${fmtPerc(c.campanha.positivacao, 0)} dos clientes da cidade)`}
              {c.campanha.valor > 0 && ` · ${fmtMoeda(c.campanha.valor, { compacto: true })}`}
            </Aviso>
          )}
          {dados.prospects.length > 0 && (
            <div>
              <Titulo extra={<Botao tamanho="p" variante="fantasma" iconeDireita={ArrowRight} onClick={() => navegar(`/prospeccao?cidade=${c.ibge}&uf=${c.uf}`)}>Todos</Botao>}>
                Melhores farmácias para prospectar
              </Titulo>
              <div className="mapa-lista">
                {dados.prospects.map((p) => (
                  <div key={p.cnpj} className="mapa-lista-item clicavel" onClick={() => aoAbrirPonto?.(p.cnpj, p)}>
                    <ScoreMini valor={p.score} />
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="truncar forte">{p.nome}</div>
                      <div className="truncar mudo mini">{[p.bairro, rotuloRede(p.rede), p.abertura && mesesDesde(p.abertura) < 12 ? textoIdade(p.abertura) : null].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dados.bairros.length > 0 && (
            <div>
              <Titulo>Farmácias por bairro</Titulo>
              <GraficoBarras itens={dados.bairros.slice(0, 8).map((b) => ({ rotulo: b.bairro, valor: b.farmacias, sub: `${b.independentes} independentes` }))} largRotulo={150} alturaBarra={12} corPadrao="var(--mapa-p3)" />
            </div>
          )}
          {dados.clientes.length > 0 && (
            <div>
              <Titulo>Nossos clientes na cidade</Titulo>
              <div className="mapa-lista">
                {dados.clientes.slice(0, 10).map((cl) => (
                  <div key={cl.id} className="mapa-lista-item clicavel" onClick={() => aoAbrirPonto?.(`cli-${cl.id}`)}>
                    <span className="mapa-ponto" style={{ background: cl.status === 'ativo' ? 'var(--s1)' : 'var(--s2)' }} />
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="truncar forte">{cl.nome}</div>
                      <div className="truncar mudo mini">{[cl.segmento, cl.vendedor].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className="num pequeno">{cl.valor_90d > 0 ? fmtMoeda(cl.valor_90d, { compacto: true }) : 'sem compra'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dados.vendedores.length > 0 && (
            <div>
              <Titulo>Quem vende aqui (90 dias)</Titulo>
              <GraficoBarras itens={dados.vendedores.map((v) => ({ rotulo: v.nome, valor: v.valor, sub: plural(v.clientes, 'cliente', 'clientes') }))} formato="moeda" largRotulo={140} alturaBarra={12} />
            </div>
          )}
          <div className="linha g8">
            <Botao icone={Crosshair} onClick={() => aoVoar?.(c.lng, c.lat, 55)}>Aproximar</Botao>
            <Botao variante="primario" icone={Sparkles} onClick={() => navegar(`/prospeccao?cidade=${c.ibge}&uf=${c.uf}&independentes=1`)}>Prospectar a cidade</Botao>
          </div>
          {aoCriarTerritorio && (
            <div className="linha g8">
              <Botao icone={Users} onClick={() => aoCriarTerritorio(c)}>Criar território com a cidade</Botao>
              <Explica titulo="Território com a cidade" texto="Usa o contorno oficial do município (IBGE) como área de um vendedor. Depois dá para ajustar os pontos ou juntar com outras áreas." />
            </div>
          )}
        </div>
      )}
    </motion.aside>
  );
}

export function ScoreMini({ valor }) {
  return (
    <span className="prosp-score" title={`Score de prospecção ${valor}/100`}>
      <span className="num forte" style={{ width: 22, textAlign: 'right', fontSize: 12.5 }}>{valor}</span>
      <span className="prosp-score-barra" style={{ width: 34 }}><span style={{ width: `${valor}%` }} /></span>
    </span>
  );
}

// ------------------------------------------------------------------ ponto (farmácia ou cliente)
export function PainelPonto({ id, aoFechar, aoVoar, aoAbrirCidade }) {
  const { dados, erro, carregando, recarregar } = useApi(id ? `/mapa/farmacia/${encodeURIComponent(id)}` : null);
  return (
    <motion.aside className="mapa-painel mapa-detalhe" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
      <Topo titulo={dados?.nome || 'Carregando…'} sub={dados ? (dados.tipo === 'cliente' ? 'Nosso cliente' : dados.razao_social) : null} aoFechar={aoFechar}
        direita={dados?.tipo === 'farmacia' && <ScoreAnel valor={dados.score} />} />
      {erro && <div style={{ padding: 16 }}><ErroCarga erro={erro} aoTentar={recarregar} /></div>}
      {carregando && !dados && <Carregando altura={240} />}
      {dados && <ConteudoPonto dados={dados} aoVoar={aoVoar} aoAbrirCidade={aoAbrirCidade} />}
    </motion.aside>
  );
}

function ScoreAnel({ valor }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 42, height: 42, flex: 'none' }} title={`Score de prospecção: ${valor}/100`}>
      <svg width={42} height={42} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={21} cy={21} r={r} fill="none" stroke="var(--superficie-3)" strokeWidth={4} />
        <circle cx={21} cy={21} r={r} fill="none" stroke="var(--acento)" strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - valor / 100)} style={{ transition: 'stroke-dashoffset 900ms var(--curva)' }} />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700 }}>{valor}</span>
    </div>
  );
}

/** Corpo do detalhe (usado no mapa e na gaveta da prospecção). */
export function ConteudoPonto({ dados: d, aoVoar, aoAbrirCidade, mostrarMapa = false }) {
  const mapa = linkMapas(d.lat, d.lng);
  if (d.tipo === 'cliente') {
    const cl = d.cliente;
    return (
      <div className="mapa-detalhe-corpo">
        <div className="linha quebra g4">
          {cl.status === 'ativo' ? <Selo cor="bom" icone={CheckCircle2}>Ativo</Selo> : <Selo cor="aviso" icone={AlertTriangle}>Sem compra há {cl.dias_sem_compra ?? '?'} dias</Selo>}
          {cl.segmento && <Selo>{cl.segmento}</Selo>}
          {cl.porte && <Selo>Porte {cl.porte}</Selo>}
        </div>
        <div className="mapa-grade">
          <Kpi rotulo="Comprou em 90d" valor={fmtMoeda(cl.valor_90d, { compacto: true })} />
          <Kpi rotulo="Pedidos" valor={fmtNumero(cl.pedidos_90d)} />
          <Kpi rotulo="SKUs" valor={fmtNumero(cl.skus_90d)} />
          <Kpi rotulo="Última compra" valor={cl.ultima_compra ? fmtData(cl.ultima_compra).slice(0, 5) : 'nunca'} />
          <Kpi rotulo="Vendedor" valor={<span className="truncar" style={{ fontSize: 13 }}>{cl.vendedor || 'sem vendedor'}</span>} />
        </div>
        {cl.top_marcas.length > 0 && (
          <div>
            <Titulo>O que mais compra (90 dias)</Titulo>
            <GraficoBarras itens={cl.top_marcas.map((m) => ({ rotulo: m.marca, valor: m.valor, sub: `${fmtNumero(m.qtd)} un` }))} formato="moeda" largRotulo={130} alturaBarra={12} />
          </div>
        )}
        <FichaCliente id={cl.id} />
        <div className="mapa-contato">
          <Titulo>Endereço</Titulo>
          <span><MapPin size={14} className="mudo" />{[cl.endereco, cl.bairro, `${cl.cidade}/${cl.uf}`, cl.cep].filter(Boolean).join(' · ')}</span>
          {cl.cnpj && <span className="mudo"><Building2 size={14} />CNPJ {cl.cnpj}</span>}
        </div>
        {d.aproximado && <Aviso tipo="info">Localização aproximada (centro da cidade): o CEP cadastrado não foi encontrado na base de CEPs.</Aviso>}
        {d.cidade_resumo && <ResumoCidadeLink c={d.cidade_resumo} aoAbrir={aoAbrirCidade} />}
      </div>
    );
  }
  const idade = mesesDesde(d.abertura);
  const wa = linkWhatsapp(d.telefone);
  return (
    <div className="mapa-detalhe-corpo">
      <div className="linha quebra g4">
        <Selo cor={d.rede <= 1 ? 'acento' : 'neutro'} icone={Store}>{rotuloRede(d.rede)}</Selo>
        {d.porte && <Selo>{d.porte}</Selo>}
        <Selo>{d.cnae_descricao}</Selo>
        {idade != null && idade < 12 && <Selo cor="acento" icone={Sparkles}>Nova · {textoIdade(d.abertura)}</Selo>}
        {d.cliente && <Selo cor="bom" icone={CheckCircle2}>Já é cliente</Selo>}
      </div>
      <div>
        <Titulo>Por que este score ({d.score}/100)</Titulo>
        {d.score_fatores.map((f) => (
          <div key={f.fator} className="mapa-fator">
            <span className="truncar">{f.fator}</span>
            <span className="mapa-fator-barra"><span style={{ width: `${(f.pontos / f.maximo) * 100}%` }} /></span>
            <span className="num mudo" style={{ textAlign: 'right' }}>+{f.pontos}</span>
          </div>
        ))}
      </div>
      <div className="mapa-contato">
        <Titulo>Contato</Titulo>
        {d.telefone && (
          <span>
            <Phone size={14} className="mudo" />
            <a href={`tel:+55${String(d.telefone).replace(/\D/g, '').replace(/^55/, '')}`}>{fmtTelefone(d.telefone)}</a>
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="mini" title="Abrir conversa no WhatsApp"><MessageCircle size={13} />WhatsApp</a>}
          </span>
        )}
        {d.telefone2 && <span><Phone size={14} className="mudo" />{fmtTelefone(d.telefone2)}</span>}
        {d.email && <span><Mail size={14} className="mudo" /><a href={`mailto:${d.email}`} className="truncar">{d.email}</a></span>}
        {!d.telefone && !d.email && <span className="mudo">Sem telefone ou e-mail na Receita.</span>}
        <span><MapPin size={14} className="mudo" />{[d.endereco, d.bairro, `${d.cidade}/${d.uf}`, d.cep && `CEP ${d.cep}`].filter(Boolean).join(' · ')}</span>
        {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Abrir no Google Maps</a>}
      </div>
      <div className="mapa-grade">
        <Kpi rotulo="Abertura" valor={<span style={{ fontSize: 14 }}>{fmtData(d.abertura)}</span>} />
        <Kpi rotulo="Nota cadastral" valor={d.nota != null ? `${d.nota}/99` : 'sem nota'} dica="Índice de saúde cadastral da base da Receita" />
        <Kpi rotulo="Capital social" valor={<span style={{ fontSize: 14 }}>{d.capital_social ? fmtMoeda(d.capital_social, { compacto: true }) : 'não informado'}</span>} />
      </div>
      <div className="mapa-contato">
        <Titulo>Empresa</Titulo>
        <span><Building2 size={14} className="mudo" />CNPJ {fmtCnpj(d.cnpj)} · {d.matriz ? 'Matriz' : 'Filial'}{d.regime ? ` · ${d.regime === 'SIMPLES' ? 'Simples Nacional' : 'Não optante do Simples'}` : ''}</span>
        {d.socio_principal && <span className="mudo">Sócio principal: {d.socio_principal}</span>}
        {d.outras_lojas_na_base > 0 && <span className="mudo">{plural(d.outras_lojas_na_base, 'outra farmácia', 'outras farmácias')} da mesma empresa na base</span>}
      </div>
      {d.cliente && (
        <div>
          <Titulo>Como cliente</Titulo>
          <div className="mapa-grade">
            <Kpi rotulo="Comprou em 90d" valor={fmtMoeda(d.cliente.valor_90d, { compacto: true })} />
            <Kpi rotulo="Pedidos" valor={fmtNumero(d.cliente.pedidos_90d)} />
            <Kpi rotulo="Vendedor" valor={<span style={{ fontSize: 13 }}>{d.cliente.vendedor || 'sem vendedor'}</span>} />
          </div>
        </div>
      )}
      {d.cidade_resumo && <ResumoCidadeLink c={d.cidade_resumo} aoAbrir={aoAbrirCidade} />}
      {mostrarMapa && (
        <div className="linha g8">
          <Botao icone={MapPin} onClick={() => navegar(`/mapa?cnpj=${d.cnpj}`)}>Ver no mapa comercial</Botao>
        </div>
      )}
      {aoVoar && d.lat != null && <Botao icone={Crosshair} onClick={() => aoVoar(d.lng, d.lat, 140)}>Aproximar</Botao>}
    </div>
  );
}

function ResumoCidadeLink({ c, aoAbrir }) {
  return (
    <div className="mapa-plano" style={{ cursor: aoAbrir ? 'pointer' : 'default' }} onClick={() => aoAbrir?.(c.ibge)}>
      <Lightbulb size={16} />
      <div>
        <div className="forte" style={{ marginBottom: 2 }}>{c.nome}/{c.uf} · prioridade {c.prioridade}</div>
        <div className="pequeno">{fmtNumero(c.farmacias)} farmácias · {fmtNumero(c.clientes_ativos)} clientes ativos · penetração {c.penetracao == null ? 'sem dado' : fmtPerc(c.penetracao, 1)}</div>
        <div className="pequeno sec" style={{ marginTop: 3 }}>{c.acao}</div>
      </div>
    </div>
  );
}
