import { useState } from 'react';
import { CalendarClock, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { del, post, put, useApi } from '../../lib/api.js';
import { fmtDataHora, fmtNumero, fmtRelativo } from '../../lib/formato.js';
import {
  Alternador, AreaTexto, Aviso, Botao, BotaoIcone, Campo, Cartao, Carregando, Chip, Entrada, ErroCarga, Explica, Menu, Modal, Selo, Seletor, Vazio, cx, useToast,
} from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { CANAIS, CANAL, DIAS_SEMANA, FILTROS, ROTULO_DESTINO, ROTULO_FILTRO, descreverDias, diasComoLista, opcoesCampanhas } from '../sistema/comum.js';
import { useConfirmar } from '../sistema/Confirmar.jsx';
import CampoGrupo from '../sistema/CampoGrupo.jsx';

const CANAIS_AUTOMATICOS = CANAIS.filter((c) => c.valor !== 'whatsapp');
const VAZIO = { nome: 'Acompanhamento diário', id_campanha: '', id_modelo: '', canal: 'email', filtro: 'todos', lista: '', dias_semana: [1, 2, 3, 4, 5], hora: '08:00', ativo: true };

function paraEnvio(a) {
  return {
    nome: a.nome,
    id_campanha: a.id_campanha === '' || a.id_campanha == null ? null : Number(a.id_campanha),
    id_modelo: a.id_modelo === '' || a.id_modelo == null ? null : Number(a.id_modelo),
    canal: a.canal,
    filtro: a.filtro,
    lista: a.lista || '',
    dias_semana: diasComoLista(a.dias_semana),
    hora: a.hora,
    ativo: Boolean(a.ativo),
  };
}

function Editor({ inicial, modelos, campanhas, aoFechar, aoSalvar }) {
  const [a, setA] = useState(() => ({ ...VAZIO, ...inicial, dias_semana: diasComoLista(inicial?.dias_semana ?? VAZIO.dias_semana), id_campanha: inicial?.id_campanha == null ? '' : String(inicial.id_campanha), id_modelo: inicial?.id_modelo == null ? '' : String(inicial.id_modelo) }));
  const [salvando, setSalvando] = useState(false);
  const modelo = modelos.find((m) => String(m.id) === String(a.id_modelo));
  const dias = new Set(a.dias_semana);
  const alternarDia = (d) => setA((x) => ({ ...x, dias_semana: dias.has(d) ? x.dias_semana.filter((y) => y !== d) : [...x.dias_semana, d] }));
  const valido = a.nome.trim() && a.id_modelo && a.dias_semana.length && /^\d{2}:\d{2}$/.test(a.hora);
  async function salvar() {
    setSalvando(true);
    try {
      await aoSalvar(paraEnvio(a));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal aberto aoFechar={aoFechar} titulo={inicial?.id ? 'Editar agendamento' : 'Novo agendamento'} subtitulo="O sistema apura e envia sozinho nos dias e horário escolhidos." largura={640}
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" carregando={salvando} disabled={!valido} onClick={salvar}>Salvar</Botao></>}>
      <div className="coluna" style={{ gap: 14 }}>
        <Campo rotulo="Nome"><Entrada value={a.nome} onChange={(e) => setA({ ...a, nome: e.target.value })} /></Campo>
        <div className="grade-2" style={{ gap: 12 }}>
          <Campo rotulo="Campanha" ajuda="Em branco = todas as campanhas ativas no dia do envio.">
            <Seletor opcoes={opcoesCampanhas(campanhas, { incluirTodas: 'Todas as campanhas ativas' })} valor={a.id_campanha} aoMudar={(v) => setA({ ...a, id_campanha: v })} />
          </Campo>
          <Campo rotulo="Modelo de mensagem" ajuda={modelo ? `Destino: ${ROTULO_DESTINO[modelo.destino] || modelo.destino}` : 'Escolha o texto que será enviado.'}>
            <Seletor opcoes={modelos.map((m) => ({ valor: String(m.id), rotulo: `${m.nome} · ${ROTULO_DESTINO[m.destino] || m.destino}` }))} valor={a.id_modelo} vazio="Selecione…" aoMudar={(v) => setA({ ...a, id_modelo: v })} />
          </Campo>
        </div>
        <CampoGrupo rotulo="Canal" ajuda="WhatsApp por link precisa de um clique humano; para envio automático use e-mail ou webhook (ex.: API do WhatsApp Business).">
          <div className="linha quebra g4">
            {CANAIS_AUTOMATICOS.map((c) => <Chip key={c.valor} icone={c.icone} ativo={a.canal === c.valor} aria-pressed={a.canal === c.valor} aoClicar={() => setA({ ...a, canal: c.valor })}>{c.rotulo}</Chip>)}
          </div>
        </CampoGrupo>
        {modelo?.destino !== 'geral' && (
          <CampoGrupo rotulo="Quem recebe">
            <div className="linha quebra g4">
              {FILTROS.map((f) => <Chip key={f.valor} ativo={a.filtro === f.valor} aria-pressed={a.filtro === f.valor} aoClicar={() => setA({ ...a, filtro: f.valor })}>{f.rotulo}</Chip>)}
            </div>
          </CampoGrupo>
        )}
        <div className="grade-2" style={{ gap: 12, gridTemplateColumns: 'minmax(0, 1fr) 140px' }}>
          <CampoGrupo rotulo="Dias da semana">
            <div className="dias-chips">
              {DIAS_SEMANA.map((d) => (
                <button key={d.valor} type="button" className={cx('dia-chip', dias.has(d.valor) && 'ativo')} onClick={() => alternarDia(d.valor)} aria-pressed={dias.has(d.valor)} title={d.longo}>{d.curto}</button>
              ))}
            </div>
          </CampoGrupo>
          <Campo rotulo="Horário"><Entrada type="time" value={a.hora} onChange={(e) => setA({ ...a, hora: e.target.value })} /></Campo>
        </div>
        <Campo rotulo="Destinatários extras (opcional)" ajuda="E-mails separados por vírgula. Recebem cópia do resumo geral.">
          <AreaTexto rows={2} style={{ minHeight: 56 }} value={a.lista || ''} onChange={(e) => setA({ ...a, lista: e.target.value })} placeholder="diretoria@empresa.com, trade@empresa.com" />
        </Campo>
        <Alternador ligado={a.ativo} aoMudar={(v) => setA({ ...a, ativo: v })} rotulo="Ativo" descricao="Desligue para pausar sem perder a configuração." />
      </div>
    </Modal>
  );
}

export default function Agendamentos() {
  const toast = useToast();
  const [confirmar, dialogo] = useConfirmar();
  const { dados: ags, erro, recarregar } = useApi('/agendamentos');
  const { dados: modelos } = useApi('/modelos-mensagem');
  const { dados: campanhas } = useApi('/campanhas');
  const [editando, setEditando] = useState(null);
  const [executando, setExecutando] = useState(null);

  async function salvar(dados) {
    try {
      if (editando?.id) await put(`/agendamentos/${editando.id}`, dados);
      else await post('/agendamentos', dados);
      toast.ok('Agendamento salvo');
      setEditando(null);
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    }
  }

  async function alternarAtivo(a) {
    try {
      await put(`/agendamentos/${a.id}`, paraEnvio({ ...a, ativo: !a.ativo }));
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    }
  }

  async function executar(a) {
    setExecutando(a.id);
    try {
      const r = await post(`/agendamentos/${a.id}/executar`);
      toast.ok(`"${a.nome}" executado: ${fmtNumero(r?.enviados ?? 0)} enviadas · ${fmtNumero(r?.simulados ?? 0)} simuladas · ${fmtNumero(r?.erros ?? 0)} erros`);
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setExecutando(null);
    }
  }

  async function excluir(a) {
    if (!(await confirmar({ titulo: 'Excluir agendamento?', texto: `"${a.nome}" deixará de enviar mensagens automaticamente.`, rotulo: 'Excluir', perigo: true }))) return;
    try {
      await del(`/agendamentos/${a.id}`);
      toast.ok('Agendamento excluído');
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    }
  }

  if (erro && !ags) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (!ags) return <Carregando />;

  return (
    <div className="coluna" style={{ gap: 14 }}>
      {dialogo}
      <div className="linha" style={{ gap: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <Aviso tipo="info">
            Os agendamentos rodam com o servidor ligado: na hora marcada o sistema <strong>recalcula a apuração</strong> e envia a cada pessoa a posição, a projeção e o que falta, sem ninguém montar planilha. <Explica titulo="Envio automático" {...EXPLICA.agendamentos} tamanho={13} />
          </Aviso>
        </div>
        <Botao variante="primario" icone={Plus} onClick={() => setEditando({})} disabled={!modelos?.length}>Novo agendamento</Botao>
      </div>

      {!ags.length ? (
        <Cartao>
          <Vazio icone={CalendarClock} titulo="Nenhum envio automático" texto="Programe, por exemplo, um boletim todo dia útil às 8h para os vendedores em risco e um resumo semanal para a diretoria."
            acao={<Botao variante="primario" icone={Plus} onClick={() => setEditando({})} disabled={!modelos?.length}>Criar o primeiro</Botao>} />
        </Cartao>
      ) : (
        <div className="coluna escalonado" style={{ gap: 10 }}>
          {ags.map((a) => {
            const canal = CANAL[a.canal];
            return (
              <div key={a.id} className={cx('cartao agenda-cartao', !a.ativo && 'inativo')}>
                <div className="agenda-relogio">
                  <span className="h">{a.hora}</span>
                  <span className="d">{a.ativo ? 'ativo' : 'pausado'}</span>
                </div>
                <div style={{ minWidth: 0 }} className="coluna g4">
                  <div className="linha" style={{ gap: 8 }}>
                    <span className="forte truncar">{a.nome}</span>
                    {canal && <Selo icone={canal.icone}>{canal.rotulo}</Selo>}
                  </div>
                  <div className="pequeno sec truncar">
                    {descreverDias(a.dias_semana)} · {a.campanha || 'Todas as campanhas ativas'} · modelo “{a.modelo || '-'}” · {ROTULO_FILTRO[a.filtro] || a.filtro}
                  </div>
                  <div className="mini mudo">
                    {a.ativo && a.proxima_execucao ? <>Próximo envio: <strong style={{ color: 'var(--tinta-2)' }}>{fmtDataHora(a.proxima_execucao)}</strong></> : 'Sem próximo envio'}
                    {a.ultima_execucao && <> · último {fmtRelativo(a.ultima_execucao)}</>}
                  </div>
                </div>
                <div className="linha" style={{ gap: 6 }}>
                  <Alternador ligado={Boolean(a.ativo)} aoMudar={() => alternarAtivo(a)} />
                  <Botao tamanho="p" icone={Play} carregando={executando === a.id} onClick={() => executar(a)}>Executar agora</Botao>
                  <Menu gatilho={<BotaoIcone icone={MoreHorizontal} rotulo="Mais ações" tamanho="p" />} itens={[
                    { rotulo: 'Editar', icone: Pencil, aoClicar: () => setEditando(a) },
                    '-',
                    { rotulo: 'Excluir', icone: Trash2, perigo: true, aoClicar: () => excluir(a) },
                  ]} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editando && (
        <Editor inicial={editando} modelos={modelos || []} campanhas={campanhas || []} aoFechar={() => setEditando(null)} aoSalvar={salvar} />
      )}
    </div>
  );
}
