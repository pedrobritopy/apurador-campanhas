import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle, Check, Crosshair, Download, Hand, Lasso, Layers, ListChecks, MapPinned, Pencil, PenLine, Search, Spline, Square,
  StickyNote, Trash2, UserRound, Users, X,
} from 'lucide-react';
import { baixar, del, post, put, useApi } from '../../lib/api.js';
import { fmtMoeda, fmtNumero, fmtPerc, plural, primeiroNome } from '../../lib/formato.js';
import { AreaTexto, Aviso, Avatar, Botao, BotaoIcone, Campo, Carregando, Entrada, ErroCarga, Explica, Segmentado, Selo, useToast } from '../../componentes/ui.jsx';
import { Titulo, Topo } from './Detalhes.jsx';

// =====================================================================
// Territórios de vendedores e desenhos livres no mapa: barra de ferramentas,
// formulário da área nova, painel da área selecionada, lista com filtro e painel de bairro.
// =====================================================================

export const CORES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
export const corCss = (c) => (!c ? 'var(--acento)' : c.startsWith('#') ? c : `var(--${c})`);

// explicações dos números (o "i" ao lado de cada um)
const EXPLICA = {
  farmacias: { titulo: 'Farmácias', texto: 'Farmácias ativas na Receita Federal (drogarias, manipulação e homeopatia) com endereço dentro desta área.', exemplo: '120 farmácias = 120 CNPJs ativos com loja aberta aqui dentro.' },
  independentes: { titulo: 'Independentes livres', texto: 'Farmácias de loja única que ainda não são nossas clientes. É o público mais fácil de conquistar.', exemplo: '35 livres = 35 portas para visitar.' },
  clientes: { titulo: 'Clientes ativos', texto: 'Nossos clientes desta área que compraram nos últimos 90 dias, do total de clientes cadastrados aqui.', exemplo: '18 de 25 = 7 clientes estão parados há mais de 90 dias.' },
  penetracao: { titulo: 'Penetração', texto: 'Quantas farmácias da área já compram de nós: clientes ativos dividido pelo total de farmácias.', exemplo: '12% = de cada 100 farmácias, 12 compram de nós.' },
  valor: { titulo: 'Venda em 90 dias', texto: 'Quanto vendemos (faturado) para os clientes desta área nos últimos 90 dias, até a última venda carregada.' },
  potencial: { titulo: 'Potencial em 90 dias', texto: 'Quanto as farmácias independentes ainda não atendidas comprariam em 90 dias se comprassem como um cliente típico da mesma cidade (mediana).', exemplo: '20 livres × R$ 4 mil = R$ 80 mil de potencial.' },
  area: { titulo: 'Área', texto: 'Tamanho aproximado da área desenhada, em quilômetros quadrados.' },
  conflitos: { titulo: 'Clientes com outro vendedor', texto: 'Clientes que estão dentro deste território, mas quem mais vendeu para eles nos últimos 90 dias foi outro vendedor (ou, sem venda, o cadastro aponta outro).', como: 'Use a lista para decidir: passar o cliente para o dono do território ou ajustar o desenho.' },
};

function Num({ rotulo, valor, info, destaque }) {
  return (
    <div className={`mapa-kpi${destaque ? ' destaque' : ''}`}>
      <span className="rot">{rotulo}{info && <Explica {...info} tamanho={12} />}</span>
      <span className="val">{valor}</span>
    </div>
  );
}

/** Grade com os números de uma área (território, desenho ou bairro). */
export function NumerosArea({ n, carregando }) {
  if (!n) return carregando ? <Carregando altura={110} texto="Contando o que tem dentro da área…" /> : null;
  return (
    <div className="mapa-grade">
      <Num rotulo="Farmácias" valor={fmtNumero(n.farmacias)} info={EXPLICA.farmacias} />
      <Num rotulo="Indep. livres" valor={fmtNumero(n.independentes_livres ?? n.nao_clientes ?? 0)} info={EXPLICA.independentes} />
      <Num rotulo="Clientes ativos" valor={`${fmtNumero(n.clientes_ativos)}/${fmtNumero(n.clientes)}`} info={EXPLICA.clientes} />
      <Num rotulo="Penetração" valor={n.penetracao == null ? 'sem dado' : fmtPerc(n.penetracao, 1)} info={EXPLICA.penetracao} />
      <Num rotulo="Venda 90d" valor={fmtMoeda(n.valor_90d, { compacto: true })} info={EXPLICA.valor} />
      {n.potencial_90d != null && <Num rotulo="Potencial 90d" valor={fmtMoeda(n.potencial_90d, { compacto: true })} info={EXPLICA.potencial} />}
    </div>
  );
}

// ------------------------------------------------------------------ barra de ferramentas
const FERRAMENTAS = [
  { valor: null, rotulo: 'Navegar', icone: Hand, dica: 'Arrastar e dar zoom no mapa (Esc volta para cá).' },
  { valor: 'poligono', rotulo: 'Polígono', icone: Spline, dica: 'Clique ponto a ponto; feche no primeiro ponto ou com duplo clique.' },
  { valor: 'laco', rotulo: 'Laço livre', icone: Lasso, dica: 'Segure o botão e contorne a área à mão livre.' },
  { valor: 'retangulo', rotulo: 'Retângulo', icone: Square, dica: 'Segure e arraste de um canto ao outro.' },
];

export function BarraFerramentas({ ferramenta, aoMudar, listaAberta, aoLista, total }) {
  return (
    <motion.div className="mapa-painel mapa-ferramentas" initial={{ opacity: 0, y: -8, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} transition={{ duration: 0.3, delay: 0.1 }} role="toolbar" aria-label="Ferramentas de desenho">
      {FERRAMENTAS.map((f) => (
        <button key={f.rotulo} type="button" className={`mapa-ferr${ferramenta === f.valor ? ' ativa' : ''}`} onClick={() => aoMudar(f.valor)} title={f.dica} aria-pressed={ferramenta === f.valor}>
          <f.icone size={15} />
          <span>{f.rotulo}</span>
        </button>
      ))}
      <span className="mapa-ferr-sep" />
      <button type="button" className={`mapa-ferr${listaAberta ? ' ativa' : ''}`} onClick={aoLista} title="Lista de territórios e desenhos" aria-pressed={listaAberta}>
        <ListChecks size={15} />
        <span>Territórios{total ? ` (${total})` : ''}</span>
      </button>
      <Explica
        titulo="Desenhar no mapa"
        texto="Desenhe uma área para ver tudo o que tem dentro dela (farmácias, clientes, vendas e potencial) e, se quiser, transforme em território de um vendedor."
        como={[
          'Escolha Polígono, Laço livre ou Retângulo e desenhe.',
          'No painel que abre, diga se é território de vendedor ou só uma anotação, dê um nome e salve.',
          'Clique numa área salva para ver os números, editar os pontos, trocar o vendedor ou apagar.',
          'Atalho: clique num bairro ou numa cidade e use "Criar território" para aproveitar o contorno oficial.',
        ]}
        exemplo="Contorne os bairros que a Ana atende, salve como território dela e veja quantos clientes dali estão com outro vendedor."
      />
    </motion.div>
  );
}

const INSTRUCOES = {
  poligono: 'Clique para marcar cada ponto. Feche clicando no primeiro ponto, com duplo clique ou Enter. Backspace desfaz o último ponto, Esc cancela.',
  laco: 'Segure o botão do mouse e contorne a área. Ao soltar, a área fecha sozinha. Esc cancela.',
  retangulo: 'Segure o botão e arraste de um canto ao outro. Esc cancela.',
};

export function InstrucaoFerramenta({ ferramenta }) {
  if (!ferramenta) return null;
  return (
    <motion.div key={ferramenta} className="mapa-painel mapa-instrucao" initial={{ opacity: 0, y: -6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, x: '-50%' }}>
      <PenLine size={14} />
      {INSTRUCOES[ferramenta]}
    </motion.div>
  );
}

// ------------------------------------------------------------------ seletor de vendedor (com foto e busca)
export function SeletorVendedor({ vendedores, valor, aoMudar, vazio = 'Escolha o vendedor' }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef(null);
  const atual = vendedores.find((v) => v.id === String(valor));
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => !ref.current?.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (t ? vendedores.filter((v) => v.nome.toLowerCase().includes(t) || (v.equipe || '').toLowerCase().includes(t)) : vendedores).slice(0, 80);
  }, [vendedores, busca]);
  return (
    <div className="sel-vendedor" ref={ref}>
      <button type="button" className="seletor sel-vendedor-botao" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        {atual ? <><Avatar nome={atual.nome} foto={atual.foto} tamanho="p" /><span className="truncar">{atual.nome}</span></> : <span className="mudo">{vazio}</span>}
      </button>
      {aberto && (
        <div className="sel-vendedor-lista">
          <div style={{ padding: 6 }}>
            <Entrada tamanho="p" icone={Search} placeholder="Buscar vendedor ou equipe" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
          </div>
          <div className="sel-vendedor-itens">
            {lista.map((v) => (
              <button key={v.id} type="button" className={`menu-item${v.id === String(valor) ? ' sel' : ''}`} onClick={() => { aoMudar(v); setAberto(false); setBusca(''); }}>
                <Avatar nome={v.nome} foto={v.foto} tamanho="p" />
                <span className="cresce truncar" style={{ textAlign: 'left' }}>{v.nome}{v.equipe && <span className="mudo mini"> · {v.equipe}</span>}</span>
                {v.territorios > 0 && <span className="mudo mini">{plural(v.territorios, 'área', 'áreas')}</span>}
              </button>
            ))}
            {!lista.length && <div className="mudo pequeno" style={{ padding: 10 }}>Nenhum vendedor encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Cores({ valor, aoMudar }) {
  return (
    <div className="linha g4" role="radiogroup" aria-label="Cor">
      {CORES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={valor === c} className={`mapa-cor${valor === c ? ' sel' : ''}`} style={{ background: corCss(c) }} onClick={() => aoMudar(c)} title={`Cor ${c.slice(1)}`}>
          {valor === c && <Check size={12} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** Mede a área (POST /territorios/medir) com atraso curto, enquanto a pessoa edita. */
export function useMedida(geometria, idVendedor, id = null) {
  const [estado, setEstado] = useState({ dados: null, carregando: false, erro: null });
  const chave = geometria ? `${JSON.stringify(geometria).length}:${JSON.stringify(geometria).slice(0, 200)}:${idVendedor || ''}` : null;
  useEffect(() => {
    if (!geometria) {
      setEstado({ dados: null, carregando: false, erro: null });
      return undefined;
    }
    let vivo = true;
    setEstado((e) => ({ ...e, carregando: true }));
    const t = setTimeout(() => {
      post('/territorios/medir', { geometria, id_vendedor: idVendedor || null, id })
        .then((d) => vivo && setEstado({ dados: d, carregando: false, erro: null }))
        .catch((e) => vivo && setEstado({ dados: null, carregando: false, erro: e }));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return estado;
}

// ------------------------------------------------------------------ área nova (depois de desenhar)
const ROTULO_FORMA = { poligono: 'Polígono desenhado', laco: 'Laço livre', retangulo: 'Retângulo', bairro: 'Contorno oficial do bairro', cidade: 'Contorno oficial da cidade' };

export function PainelNovaArea({ pendente, vendedores, aoSalvo, aoCancelar, aoMudarCor }) {
  const toast = useToast();
  const [tipo, setTipo] = useState('territorio');
  const [nome, setNome] = useState(pendente.nome || '');
  const [vendedor, setVendedor] = useState(null);
  const [cor, setCor] = useState(null);
  const [nota, setNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const medida = useMedida(pendente.geometria, tipo === 'territorio' ? vendedor?.id : null);
  const corFinal = cor || (tipo === 'territorio' ? vendedor?.cor : 's3') || 's3';
  useEffect(() => aoMudarCor?.(corFinal), [corFinal, aoMudarCor]);

  const salvar = async () => {
    if (!nome.trim()) return toast.erro('Dê um nome para a área.');
    if (tipo === 'territorio' && !vendedor) return toast.erro('Escolha o vendedor dono do território, ou salve como anotação.');
    setSalvando(true);
    try {
      const t = await post('/territorios', { tipo, nome: nome.trim(), id_vendedor: tipo === 'territorio' ? vendedor.id : null, cor: corFinal, nota, forma: pendente.forma, origem: pendente.origem || null, geometria: pendente.geometria });
      toast.ok(tipo === 'territorio' ? `Território "${t.nome}" salvo para ${t.vendedor?.nome}.` : `Anotação "${t.nome}" salva.`);
      aoSalvo(t);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const n = medida.dados;
  return (
    <motion.aside className="mapa-painel mapa-detalhe" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
      <Topo titulo="Nova área" sub={`${ROTULO_FORMA[pendente.forma] || 'Área desenhada'}${n ? ` · ${fmtNumero(n.area_km2, n.area_km2 < 10 ? 1 : 0)} km²` : ''}`} aoFechar={aoCancelar} />
      <div className="mapa-detalhe-corpo">
        <Campo rotulo="O que é esta área" info={{ texto: 'Território é a área de responsabilidade de um vendedor: o mapa mostra conflitos com outros vendedores e clientes fora da área. Anotação é um desenho livre para marcar qualquer coisa (rota, região de campanha, área de risco).' }}>
          <Segmentado valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'territorio', rotulo: 'Território de vendedor', icone: UserRound }, { valor: 'anotacao', rotulo: 'Anotação livre', icone: StickyNote }]} />
        </Campo>
        {tipo === 'territorio' && (
          <Campo rotulo="Vendedor dono" info={{ texto: 'Quem é responsável por atender esta área. A cor do território segue o vendedor (dá para trocar abaixo).' }}>
            <SeletorVendedor vendedores={vendedores} valor={vendedor?.id} aoMudar={(v) => { setVendedor(v); if (!nome.trim()) setNome(`Área de ${primeiroNome(v.nome)}`); }} />
          </Campo>
        )}
        <Campo rotulo="Nome">
          <Entrada value={nome} onChange={(e) => setNome(e.target.value)} placeholder={tipo === 'territorio' ? 'Ex.: Zona Norte da Ana' : 'Ex.: Rota de terça-feira'} maxLength={80} />
        </Campo>
        <Campo rotulo="Cor">
          <Cores valor={corFinal} aoMudar={setCor} />
        </Campo>
        <Campo rotulo="Nota (opcional)">
          <AreaTexto rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: visitar às terças; foco em independentes abertas há menos de 1 ano" />
        </Campo>
        <div>
          <Titulo extra={<Explica titulo="O que tem dentro" texto="Contagem feita agora, com os pontos que caem dentro do desenho. Muda sozinha se você redesenhar ou trocar o vendedor." />}>O que tem dentro</Titulo>
          {medida.erro ? <Aviso tipo="erro">{medida.erro.message}</Aviso> : <NumerosArea n={n} carregando={medida.carregando} />}
          {n && tipo === 'territorio' && vendedor && n.conflitos > 0 && (
            <Aviso tipo="aviso" titulo={`${plural(n.conflitos, 'cliente daqui é atendido', 'clientes daqui são atendidos')} por outro vendedor`}>
              {fmtMoeda(n.conflitos_valor, { compacto: true })} em 90 dias. Depois de salvar, a lista completa aparece no painel do território.
            </Aviso>
          )}
        </div>
        <div className="linha g8">
          <Botao onClick={aoCancelar}>Descartar</Botao>
          <Botao variante="primario" icone={Check} carregando={salvando} onClick={salvar}>Salvar {tipo === 'territorio' ? 'território' : 'anotação'}</Botao>
        </div>
      </div>
    </motion.aside>
  );
}

// ------------------------------------------------------------------ área salva (selecionada)
export function PainelTerritorio({ id, vendedores, aoFechar, aoAtualizado, aoExcluido, aoVoar, aoAbrirPonto, aoAbrirTerritorio, edicao, aoEditar, aoSalvarForma, aoCancelarForma }) {
  const toast = useToast();
  const { dados: t, erro, carregando, recarregar } = useApi(`/territorios/${id}`);
  const [renomear, setRenomear] = useState(null);
  const [nota, setNota] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const medidaEdicao = useMedida(edicao?.geometria || null, t?.tipo === 'territorio' ? t?.id_vendedor : null, id);

  const salvar = async (campos, msg) => {
    try {
      const novo = await put(`/territorios/${id}`, campos);
      toast.ok(msg || 'Área atualizada.');
      recarregar();
      aoAtualizado?.(novo);
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const excluir = async () => {
    try {
      await del(`/territorios/${id}`);
      toast.ok(`"${t.nome}" apagado.`);
      aoExcluido?.(id);
    } catch (e) {
      toast.erro(e.message);
    }
  };

  const n = edicao ? medidaEdicao.dados : t?.numeros;
  const terr = t?.tipo === 'territorio';
  return (
    <motion.aside className="mapa-painel mapa-detalhe" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
      <Topo
        titulo={t ? (
          renomear != null ? (
            <form className="linha g4" onSubmit={(e) => { e.preventDefault(); salvar({ nome: renomear }, 'Nome atualizado.'); setRenomear(null); }}>
              <Entrada tamanho="p" value={renomear} onChange={(e) => setRenomear(e.target.value)} autoFocus maxLength={80} />
              <BotaoIcone icone={Check} rotulo="Salvar nome" tamanho="p" type="submit" onClick={(e) => e.currentTarget.form?.requestSubmit()} />
            </form>
          ) : (
            <span className="linha g8"><span className="mapa-cor-ponto" style={{ background: corCss(t.cor) }} />{t.nome}<BotaoIcone icone={Pencil} rotulo="Renomear" tamanho="p" onClick={() => setRenomear(t.nome)} /></span>
          )
        ) : 'Área'}
        sub={t ? `${terr ? 'Território de vendedor' : 'Anotação'}${t.numeros ? ` · ${fmtNumero(t.numeros.area_km2, t.numeros.area_km2 < 10 ? 1 : 0)} km²` : ''}` : null}
        aoFechar={aoFechar}
      />
      {erro && <div style={{ padding: 16 }}><ErroCarga erro={erro} aoTentar={recarregar} /></div>}
      {carregando && !t && <Carregando altura={240} />}
      {t && (
        <div className="mapa-detalhe-corpo">
          {edicao && (
            <div className="mapa-plano">
              <Spline size={16} />
              <div>
                <div className="forte" style={{ marginBottom: 2 }}>Editando a forma</div>
                Arraste os pontos para ajustar. Clique numa bolinha do meio de um lado para criar um ponto novo. Duplo clique num ponto apaga.
                <div className="linha g8" style={{ marginTop: 8 }}>
                  <Botao tamanho="p" onClick={aoCancelarForma}>Cancelar</Botao>
                  <Botao tamanho="p" variante="primario" icone={Check} onClick={async () => { await salvar({ geometria: edicao.geometria }, 'Forma atualizada.'); aoSalvarForma?.(); }}>Salvar forma</Botao>
                </div>
              </div>
            </div>
          )}
          {terr && (
            <Campo rotulo="Vendedor dono" info={{ texto: 'Quem responde por esta área. Trocar aqui atualiza a cor (se ela seguia o vendedor) e recalcula os conflitos.' }}>
              <SeletorVendedor vendedores={vendedores} valor={t.id_vendedor} aoMudar={(v) => salvar({ id_vendedor: v.id, ...(CORES.includes(t.cor) && t.cor === vendedores.find((x) => x.id === t.id_vendedor)?.cor ? { cor: v.cor } : {}) }, `Território passou para ${v.nome}.`)} />
            </Campo>
          )}
          <div>
            <Titulo extra={<Explica titulo="Números da área" texto="Tudo o que está dentro do desenho: farmácias da Receita, nossos clientes e as vendas dos últimos 90 dias." como="Passe o mouse no i de cada número para ver a explicação." />}>
              {edicao ? 'Números com a forma nova' : 'O que tem dentro'}
            </Titulo>
            <NumerosArea n={n} carregando={edicao ? medidaEdicao.carregando : false} />
            {n?.clientes_aproximados > 0 && (
              <div className="mudo mini" style={{ marginTop: 8 }}>
                {plural(n.clientes_aproximados, 'cliente está com localização aproximada', 'clientes estão com localização aproximada')} (pelo bairro do cadastro). Confira os endereços no ERP para o mapa ficar exato.
              </div>
            )}
          </div>

          {!edicao && terr && t.numeros.conflitos > 0 && (
            <div>
              <Titulo extra={<Explica {...EXPLICA.conflitos} />}>Clientes daqui com outro vendedor</Titulo>
              <Aviso tipo="aviso">{plural(t.numeros.conflitos, 'cliente', 'clientes')} · {fmtMoeda(t.numeros.conflitos_valor, { compacto: true })} em 90 dias.</Aviso>
              <div className="mapa-lista" style={{ marginTop: 6 }}>
                {t.numeros.lista_conflitos.map((c) => (
                  <div key={c.id} className="mapa-lista-item clicavel" onClick={() => aoAbrirPonto?.(`cli-${c.id}`)}>
                    <AlertTriangle size={14} style={{ color: 'var(--aviso)' }} />
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="truncar forte">{c.nome}</div>
                      <div className="truncar mudo mini">{c.por === 'venda' ? 'Comprou de' : 'Cadastrado com'} {c.vendedor.nome}{c.bairro ? ` · ${c.bairro}` : ''}</div>
                    </div>
                    <span className="num pequeno">{c.valor_90d > 0 ? fmtMoeda(c.valor_90d, { compacto: true }) : 'sem compra'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!edicao && terr && t.numeros.fora && (
            <div>
              <Titulo extra={<Explica titulo="Clientes do vendedor fora da área" texto="Clientes que compraram deste vendedor nos últimos 90 dias, mas ficam fora do desenho do território. Pode ser um cliente antigo de outra região ou um sinal de que o desenho precisa crescer." />}>
                Clientes de {primeiroNome(t.vendedor?.nome || '')} fora da área
              </Titulo>
              <div className="pequeno" style={{ marginBottom: 6 }}>
                Atende {plural(t.numeros.fora.clientes_do_vendedor, 'cliente', 'clientes')}: {fmtNumero(t.numeros.fora.dentro)} dentro e <b>{fmtNumero(t.numeros.fora.fora)} fora</b>
                {t.numeros.fora.valor_fora > 0 ? ` (${fmtMoeda(t.numeros.fora.valor_fora, { compacto: true })} em 90 dias)` : ''}.
              </div>
              {t.numeros.fora.lista.length > 0 && (
                <div className="mapa-lista">
                  {t.numeros.fora.lista.map((c) => (
                    <div key={c.id} className="mapa-lista-item clicavel" onClick={() => aoAbrirPonto?.(`cli-${c.id}`)}>
                      <span className="mapa-ponto" style={{ background: 'var(--s1)' }} />
                      <div className="cresce truncar">{c.nome}<span className="mudo mini"> · {c.cidade}/{c.uf}</span></div>
                      <span className="num pequeno">{fmtMoeda(c.valor_90d, { compacto: true })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!edicao && t.numeros.quem_atende?.length > 0 && (
            <div>
              <Titulo extra={<Explica titulo="Quem atende os clientes daqui" texto="Para cada cliente da área, conta o vendedor que mais vendeu para ele nos últimos 90 dias. O valor é tudo o que cada vendedor vendeu para clientes desta área." />}>Quem atende os clientes daqui</Titulo>
              <div className="mapa-lista">
                {t.numeros.quem_atende.slice(0, 6).map((v) => (
                  <div key={v.id} className="mapa-lista-item">
                    <Avatar nome={v.nome} foto={v.foto} tamanho="p" />
                    <div className="cresce truncar">{v.nome}{v.dono && <Selo cor="bom" style={{ marginLeft: 6 }}>dono</Selo>}<div className="mudo mini">{plural(v.clientes, 'cliente', 'clientes')}</div></div>
                    <span className="num pequeno">{fmtMoeda(v.valor, { compacto: true })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!edicao && t.numeros.sobreposicoes?.length > 0 && (
            <div>
              <Titulo extra={<Explica titulo="Sobreposição" texto="Outros territórios que dividem pedaços com este. Farmácias e clientes nessas partes contam para os dois donos." />}>Divide área com</Titulo>
              <div className="mapa-lista">
                {t.numeros.sobreposicoes.map((s) => (
                  <div key={s.id} className="mapa-lista-item clicavel" onClick={() => aoAbrirTerritorio?.(s.id)}>
                    <span className="mapa-cor-ponto" style={{ background: corCss(s.cor) }} />
                    <div className="cresce truncar">{s.nome}{s.vendedor ? <span className="mudo mini"> · {s.vendedor}</span> : null}</div>
                    <span className="mudo mini">{plural(s.farmacias, 'farmácia', 'farmácias')}{s.clientes ? `, ${plural(s.clientes, 'cliente', 'clientes')}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!edicao && t.numeros.prospects?.length > 0 && (
            <div>
              <Titulo extra={<Botao tamanho="p" variante="fantasma" icone={Download} onClick={() => baixar(`/territorios/${id}/excel`)}>Planilha</Botao>}>
                Melhores farmácias para prospectar
              </Titulo>
              <div className="mapa-lista">
                {t.numeros.prospects.map((p) => (
                  <div key={p.cnpj} className="mapa-lista-item clicavel" onClick={() => aoAbrirPonto?.(p.cnpj, { lat: p.lat, lng: p.lng, tipo: 'prospect' })}>
                    <span className="num forte" style={{ width: 24, textAlign: 'right' }}>{p.score}</span>
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="truncar forte">{p.nome}</div>
                      <div className="truncar mudo mini">{[p.bairro, p.cidade, p.rede <= 1 ? 'Independente' : `Rede · ${p.rede} lojas`].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!edicao && t.numeros.cidades?.length > 1 && (
            <div>
              <Titulo>Cidades na área</Titulo>
              <div className="linha quebra g4">
                {t.numeros.cidades.map((c) => <Selo key={c.ibge}>{c.nome}/{c.uf} · {fmtNumero(c.farmacias)}</Selo>)}
              </div>
            </div>
          )}

          {!edicao && (
            <Campo rotulo="Nota">
              <AreaTexto rows={2} value={nota ?? t.nota} onChange={(e) => setNota(e.target.value)} onBlur={() => { if (nota != null && nota !== t.nota) salvar({ nota }, 'Nota salva.'); }} placeholder="Escreva algo sobre esta área" />
            </Campo>
          )}

          {!edicao && (
            <Campo rotulo="Cor">
              <Cores valor={t.cor} aoMudar={(c) => salvar({ cor: c }, 'Cor atualizada.')} />
            </Campo>
          )}

          {!edicao && (
            <div className="linha quebra g8">
              <Botao icone={Crosshair} onClick={() => aoVoar?.(t.geometria)}>Enquadrar</Botao>
              <Botao icone={Spline} onClick={() => aoEditar?.(t)} disabled={t.geometria.every((a) => a.length > 600)} title={t.geometria.every((a) => a.length > 600) ? 'Forma detalhada demais para editar ponto a ponto' : undefined}>Editar forma</Botao>
              {!terr && <Botao icone={Users} onClick={() => salvar({ tipo: 'territorio', id_vendedor: vendedores[0]?.id }, 'Virou território. Escolha o vendedor dono.')}>Virar território</Botao>}
              {confirmar ? (
                <span className="linha g4">
                  <Botao variante="perigo" icone={Trash2} onClick={excluir}>Confirmar</Botao>
                  <Botao variante="fantasma" onClick={() => setConfirmar(false)}>Não</Botao>
                </span>
              ) : (
                <Botao variante="fantasma" icone={Trash2} onClick={() => setConfirmar(true)}>Apagar</Botao>
              )}
            </div>
          )}
        </div>
      )}
    </motion.aside>
  );
}

// ------------------------------------------------------------------ lista de territórios
export function PainelListaTerritorios({ territorios, vendedores, filtro, aoFiltro, aoAbrir, aoHover, aoFechar }) {
  const comArea = vendedores.filter((v) => territorios.some((t) => t.id_vendedor === v.id));
  const lista = territorios.filter((t) => !filtro || t.id_vendedor === filtro);
  const somaConf = lista.reduce((a, t) => a + (t.numeros?.conflitos || 0), 0);
  return (
    <motion.aside className="mapa-painel mapa-ranking" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25 }}>
      <div className="mapa-ranking-topo">
        <div className="linha entre">
          <h2 style={{ fontSize: 14 }} className="linha g4">Territórios e desenhos
            <Explica titulo="Territórios e desenhos" texto="Áreas que vocês desenharam no mapa. Territórios têm um vendedor dono; anotações são marcações livres." como={['Clique num item para abrir os números e as ações.', 'Filtre por vendedor para ver só as áreas dele no mapa.', 'Para criar, use as ferramentas de desenho no topo do mapa.']} />
          </h2>
          <BotaoIcone icone={X} rotulo="Fechar lista" tamanho="p" onClick={aoFechar} />
        </div>
        <div className="linha g8">
          <div className="cresce">
            <SeletorVendedor vendedores={comArea} valor={filtro} aoMudar={(v) => aoFiltro(v.id)} vazio="Todos os vendedores" />
          </div>
          {filtro && <BotaoIcone icone={X} rotulo="Limpar filtro" tamanho="p" onClick={() => aoFiltro('')} />}
        </div>
        {somaConf > 0 && <div className="mudo mini">{plural(somaConf, 'cliente atendido por outro vendedor', 'clientes atendidos por outro vendedor')} nas áreas listadas.</div>}
      </div>
      <div className="mapa-ranking-lista">
        {!lista.length && (
          <div className="vazio pequeno" style={{ padding: 16, textAlign: 'center' }}>
            <MapPinned size={22} className="mudo" style={{ marginBottom: 6 }} />
            <div>Nenhuma área ainda.</div>
            <div className="mudo mini" style={{ marginTop: 4 }}>Use Polígono, Laço livre ou Retângulo no topo do mapa, ou clique num bairro e escolha "Criar território".</div>
          </div>
        )}
        {lista.map((t) => (
          <button key={t.id} type="button" className="mapa-cidade-item" onClick={() => aoAbrir(t)} onMouseEnter={() => aoHover?.(t)} onMouseLeave={() => aoHover?.(null)}>
            <span className="mapa-ter-icone" style={{ background: `color-mix(in srgb, ${corCss(t.cor)} 22%, var(--superficie-elevada))`, boxShadow: `inset 0 0 0 2px ${corCss(t.cor)}` }}>
              {t.vendedor?.foto ? <img src={t.vendedor.foto} alt="" /> : t.tipo === 'anotacao' ? <StickyNote size={14} /> : <Layers size={14} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="linha entre">
                <span className="forte truncar">{t.nome}</span>
                <span className="num mini mudo">{t.numeros ? fmtMoeda(t.numeros.valor_90d, { compacto: true }) : ''}</span>
              </div>
              <div className="mapa-acao-texto">
                {t.tipo === 'anotacao' ? 'Anotação' : t.vendedor?.nome}
                {t.numeros ? ` · ${fmtNumero(t.numeros.farmacias)} farmácias · ${fmtNumero(t.numeros.clientes_ativos)} clientes ativos` : ''}
                {t.numeros?.conflitos ? <span style={{ color: 'var(--aviso-texto)' }}> · {fmtNumero(t.numeros.conflitos)} com outro vendedor</span> : null}
              </div>
            </div>
          </button>
        ))}
      </div>
    </motion.aside>
  );
}

// ------------------------------------------------------------------ bairro
const FONTE_CURTA = { 'ibge-2022': 'IBGE, Censo 2022', osm: 'OpenStreetMap' };

export function PainelBairro({ bairro: b, aoFechar, aoCriarTerritorio, aoVoar }) {
  return (
    <motion.aside className="mapa-painel mapa-detalhe" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
      <Topo titulo={b.nome} sub={`Bairro de ${b.cidade}/${b.uf} · limites: ${FONTE_CURTA[b.fonte] || 'fonte oficial'}`} aoFechar={aoFechar} />
      <div className="mapa-detalhe-corpo">
        <div>
          <Titulo extra={<Explica titulo="Números do bairro" texto="Farmácias e clientes cujo ponto no mapa cai dentro do limite deste bairro. Vendas dos últimos 90 dias." />}>O que tem no bairro</Titulo>
          <div className="mapa-grade">
            <Num rotulo="Farmácias" valor={fmtNumero(b.farmacias)} info={EXPLICA.farmacias} />
            <Num rotulo="Não clientes" valor={fmtNumero(b.nao_clientes)} info={{ titulo: 'Não clientes', texto: 'Farmácias do bairro que ainda não compram de nós (independentes e de rede).' }} />
            <Num rotulo="Novas 12m" valor={fmtNumero(b.novas_12m)} info={{ titulo: 'Novas em 12 meses', texto: 'Farmácias abertas no último ano. Loja nova ainda está escolhendo fornecedor: é a hora de chegar primeiro.' }} />
            <Num rotulo="Clientes ativos" valor={`${fmtNumero(b.clientes_ativos)}/${fmtNumero(b.clientes)}`} info={EXPLICA.clientes} />
            <Num rotulo="Penetração" valor={b.penetracao == null ? 'sem dado' : fmtPerc(b.penetracao, 1)} info={EXPLICA.penetracao} />
            <Num rotulo="Venda 90d" valor={fmtMoeda(b.valor_90d, { compacto: true })} info={EXPLICA.valor} />
          </div>
        </div>
        {b.farmacias > 0 && b.clientes_ativos === 0 && (
          <div className="mapa-plano"><MapPinned size={16} /><div><div className="forte" style={{ marginBottom: 2 }}>Bairro sem cliente ativo</div>{plural(b.nao_clientes, 'farmácia para conquistar', 'farmácias para conquistar')}{b.novas_12m ? `, ${plural(b.novas_12m, 'aberta', 'abertas')} no último ano` : ''}.</div></div>
        )}
        <div className="linha quebra g8">
          <Botao icone={Crosshair} onClick={aoVoar}>Enquadrar</Botao>
          <Botao variante="primario" icone={Users} onClick={aoCriarTerritorio}>Criar território com este bairro</Botao>
        </div>
        <div className="mapa-fonte">Limites do bairro: {b.fonte === 'osm' ? '© colaboradores do OpenStreetMap (ODbL)' : 'IBGE, malha de bairros do Censo 2022'}.</div>
      </div>
    </motion.aside>
  );
}
