import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Tag, UserCheck, X } from 'lucide-react';
import { get, post, put } from '../../lib/api.js';
import { useClientes, useDimensoes } from '../../lib/dados.js';
import { fmtDataHora, fmtMoeda, fmtPerc } from '../../lib/formato.js';
import { Botao, Carregando, Entrada, Modal, Progresso, Segmentado, Seletor, SeloStatus, Aviso, useToast } from '../../componentes/ui.jsx';
import MultiSelecao from '../../componentes/MultiSelecao.jsx';
import { AvatarContato, RotuloCanal, SeloVinculo } from './comum.jsx';
import { PRIORIDADES, nomeContato } from './util.js';

/** Vincula um contato a um vendedor ou cliente do cadastro (identificação manual). */
export function ModalVinculo({ aberto, aoFechar, contato, aoSalvar }) {
  const toast = useToast();
  const { dados: dims } = useDimensoes();
  const { dados: clientes } = useClientes();
  const [tipo, setTipo] = useState('vendedor');
  const [vendedor, setVendedor] = useState([]);
  const [cliente, setCliente] = useState([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!aberto || !contato) return;
    setTipo(contato.id_cliente ? 'cliente' : contato.id_vendedor ? 'vendedor' : 'vendedor');
    setVendedor(contato.id_vendedor ? [String(contato.id_vendedor)] : []);
    setCliente(contato.id_cliente ? [String(contato.id_cliente)] : []);
  }, [aberto, contato]);
  const opVend = useMemo(() => (dims?.vendedores || []).map((v) => ({ valor: v.id, rotulo: v.nome, detalhe: v.equipe ? `Equipe ${v.equipe}` : '' })).concat((dims?.equipes || []).map((e) => ({ valor: e.id, rotulo: e.gerente, detalhe: 'Gerente' }))), [dims]);
  const opCli = useMemo(() => (clientes || []).map((c) => ({ valor: String(c.id), rotulo: c.nome, detalhe: [c.cidade, c.estado].filter(Boolean).join('/') })), [clientes]);
  const salvar = async () => {
    setSalvando(true);
    try {
      const corpo = tipo === 'nenhum' ? { id_vendedor: null, id_cliente: null, verificado: false }
        : tipo === 'vendedor' ? { id_vendedor: vendedor[0] || null, id_cliente: null, verificado: true }
          : { id_cliente: cliente[0] || null, id_vendedor: null, verificado: true };
      await put(`/atendimento/contatos/${contato.id}`, corpo);
      toast.ok('Vínculo atualizado');
      aoSalvar?.();
      aoFechar();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Quem é este contato?" subtitulo="O vínculo libera os comandos /boletim, /ranking e /plano e mostra a situação nas campanhas." largura={560}
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" icone={UserCheck} carregando={salvando} onClick={salvar}>Salvar vínculo</Botao></>}>
      <div className="coluna g12">
        <Segmentado valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'vendedor', rotulo: 'Vendedor / gerente' }, { valor: 'cliente', rotulo: 'Cliente' }, { valor: 'nenhum', rotulo: 'Sem vínculo' }]} />
        {tipo === 'vendedor' && <MultiSelecao unico opcoes={opVend} valores={vendedor} aoMudar={setVendedor} placeholder="Buscar vendedor ou gerente…" />}
        {tipo === 'cliente' && <MultiSelecao unico opcoes={opCli} valores={cliente} aoMudar={setCliente} placeholder="Buscar cliente…" />}
        {contato && <div className="mudo pequeno">Contato: {contato.nome || contato.identificador} {contato.username ? `(${contato.username})` : ''} {contato.telefone ? `· ${contato.telefone}` : ''}</div>}
      </div>
    </Modal>
  );
}

function Dado({ rotulo, valor }) {
  if (valor == null || valor === '') return null;
  return <div className="dado"><span>{rotulo}</span><span className="truncar" style={{ textAlign: 'right' }}>{valor}</span></div>;
}

export default function PainelContato({ conversa, aplicarConversa, responsaveis = [] }) {
  const toast = useToast();
  const [ctx, setCtx] = useState(null);
  const [vinculando, setVinculando] = useState(false);
  const [resp, setResp] = useState(conversa?.responsavel || '');
  const [novaEtiqueta, setNovaEtiqueta] = useState('');
  const idContato = conversa?.contato?.id;
  const chaveVinculo = `${conversa?.contato?.id_vendedor}|${conversa?.contato?.id_cliente}`;

  const carregar = () => {
    if (!idContato) return;
    setCtx(null);
    get(`/atendimento/contatos/${idContato}/contexto`).then(setCtx).catch((e) => setCtx({ erro: e.message }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [idContato, chaveVinculo]);
  useEffect(() => setResp(conversa?.responsavel || ''), [conversa?.id, conversa?.responsavel]);

  if (!conversa) return <aside className="atd-painel" />;
  const acao = async (caminho, corpo) => {
    try {
      aplicarConversa(await post(`/atendimento/conversas/${conversa.id}/${caminho}`, corpo));
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const nome = nomeContato(conversa);
  const v = ctx?.vinculo?.vendedor;
  const cl = ctx?.vinculo?.cliente;
  const etiquetas = conversa.etiquetas || [];

  return (
    <aside className="atd-painel" aria-label="Contato">
      <div className="coluna" style={{ alignItems: 'center', textAlign: 'center', gap: 6 }}>
        <AvatarContato nome={nome} canal={conversa.canal} foto={conversa.vinculo?.foto} tamanho="g" />
        <strong style={{ fontSize: 15 }}>{nome}</strong>
        <span className="mudo pequeno">{conversa.contato.username || conversa.contato.email || conversa.contato.identificador}</span>
        <div className="linha g4" style={{ justifyContent: 'center' }}>
          <RotuloCanal canal={conversa.canal} />
          <SeloVinculo tipo={conversa.vinculo?.tipo} />
        </div>
        <Botao tamanho="p" variante="sutil" icone={Link2} onClick={() => setVinculando(true)}>{conversa.vinculo?.tipo ? 'Alterar vínculo' : 'Identificar contato'}</Botao>
      </div>

      {!ctx && <Carregando altura={90} texto="Buscando quem é…" />}
      {ctx?.erro && <Aviso tipo="erro">{ctx.erro}</Aviso>}
      {v && (
        <section>
          <h4>{v.nivel === 'gerente' ? 'Gerente' : 'Vendedor'}</h4>
          <Dado rotulo="Nome" valor={v.nome} />
          <Dado rotulo="Equipe" valor={v.gerente ? `Equipe ${v.gerente}` : v.nivel === 'gerente' ? 'Gerente da equipe' : null} />
          <Dado rotulo="Cidade" valor={[v.cidade, v.estado].filter(Boolean).join('/')} />
          <Dado rotulo="Telefone" valor={v.telefone} />
          <Dado rotulo="E-mail" valor={v.email} />
          <Dado rotulo="Identificação" valor={ctx.contato.verificado ? 'Confirmada' : 'Não confirmada'} />
        </section>
      )}
      {cl && (
        <section>
          <h4>Cliente</h4>
          <Dado rotulo="Nome" valor={cl.nome} />
          <Dado rotulo="Cidade" valor={[cl.cidade, cl.estado].filter(Boolean).join('/')} />
          <Dado rotulo="Segmento" valor={[cl.segmento, cl.porte].filter(Boolean).join(' · ')} />
          <Dado rotulo="Vendedor" valor={cl.vendedor} />
        </section>
      )}
      {ctx && !v && !cl && !ctx.erro && (
        <Aviso tipo="info">Contato não identificado. No Telegram, ele se identifica ao tocar em “Compartilhar meu telefone”; aqui você pode vincular manualmente.</Aviso>
      )}

      {ctx?.campanhas?.length > 0 && (
        <section>
          <h4>Campanhas agora</h4>
          <div className="coluna" style={{ gap: 8 }}>
            {ctx.campanhas.map((c) => (
              <a key={c.id} href={`#/campanhas/${c.id}?participante=${v?.id ?? ''}`} className="atd-campanha-mini" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="linha entre g4">
                  <span className="truncar pequeno forte">{c.nome}</span>
                  <SeloStatus status={c.status} compacto />
                </div>
                {c.score != null ? (
                  <>
                    <Progresso valor={c.score} projecao={c.score_proj} espessura="p" />
                    <div className="linha entre mini mudo">
                      <span>{c.posicao}º de {c.total}{c.escopo !== 'você' ? ` (${c.escopo})` : ''}</span>
                      <span>{fmtPerc(c.score)} · proj. {fmtPerc(c.score_proj)}</span>
                    </div>
                  </>
                ) : (
                  <span className="mini mudo">{c.tempo_status === 'futura' ? 'Ainda não começou' : `${c.posicao}º de ${c.total}`}</span>
                )}
                {c.premio_proj > 0 && <span className="mini" style={{ color: 'var(--bom-texto)' }}>Prêmio projetado {fmtMoeda(c.premio_proj)}</span>}
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h4>Atendimento</h4>
        <div className="coluna" style={{ gap: 8 }}>
          <label className="campo">
            <span className="campo-rotulo">Responsável</span>
            <Entrada list="atd-responsaveis" placeholder="Quem está cuidando" value={resp} onChange={(e) => setResp(e.target.value)}
              onBlur={() => resp !== (conversa.responsavel || '') && acao('responsavel', { responsavel: resp })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Prioridade</span>
            <Seletor valor={conversa.prioridade} aoMudar={(p) => acao('prioridade', { prioridade: p })} opcoes={PRIORIDADES} />
          </label>
          <div className="campo">
            <span className="campo-rotulo"><Tag size={12} /> Etiquetas</span>
            <div className="atd-etiquetas">
              {etiquetas.map((e) => (
                <span key={e} className="ms-chip">{e}
                  <button type="button" aria-label={`Remover ${e}`} onClick={() => acao('etiquetas', { etiquetas: etiquetas.filter((x) => x !== e) })}><X size={11} /></button>
                </span>
              ))}
            </div>
            <form className="linha" onSubmit={(ev) => {
              ev.preventDefault();
              if (!novaEtiqueta.trim()) return;
              acao('etiquetas', { etiquetas: [...etiquetas, novaEtiqueta.trim()] });
              setNovaEtiqueta('');
            }}>
              <Entrada tamanho="p" placeholder="Nova etiqueta" value={novaEtiqueta} onChange={(e) => setNovaEtiqueta(e.target.value)} />
              <Botao tamanho="p" icone={Plus} type="submit" aria-label="Adicionar etiqueta" />
            </form>
          </div>
          <div className="dado mini"><span>Aberta em</span><span>{fmtDataHora(conversa.criado_em)}</span></div>
          {ctx?.conversas > 1 && <div className="dado mini"><span>Conversas deste contato</span><span>{ctx.conversas}</span></div>}
        </div>
      </section>
      <ModalVinculo aberto={vinculando} aoFechar={() => setVinculando(false)} contato={ctx?.contato || conversa.contato} aoSalvar={carregar} />
      <datalist id="atd-responsaveis">{responsaveis.map((r) => <option key={r} value={r} />)}</datalist>
    </aside>
  );
}
