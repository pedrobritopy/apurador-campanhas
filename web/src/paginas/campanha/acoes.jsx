import { useCallback, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Copy, ExternalLink, Lock, Pencil, PlayCircle, RotateCcw, Trash2 } from 'lucide-react';
import { del, post } from '../../lib/api.js';
import { navegar } from '../../lib/rotas.js';
import { Botao, Modal, useToast } from '../../componentes/ui.jsx';
import ModalExcecao, { bloqueioContaCorrente } from '../contacorrente/ModalExcecao.jsx';

/** Situação "de exibição" de uma campanha (combina status salvo + tempo). */
export function situacao(c) {
  const tempo = c?.resumo?.tempo_status ?? c?.tempo_status;
  if (c?.status === 'ativa') {
    if (tempo === 'futura') return 'agendada';
    if (tempo === 'encerrada') return 'aguardando';
    return 'andamento';
  }
  return c?.status || 'rascunho';
}

/**
 * Diálogo de confirmação reutilizável.
 * const [dialogo, confirmar] = useConfirmacao();  await confirmar({ titulo, texto, rotulo, perigo })
 */
export function useConfirmacao() {
  const [estado, setEstado] = useState(null);
  const resolver = useRef(null);
  const confirmar = useCallback(
    (opcoes) =>
      new Promise((res) => {
        resolver.current = res;
        setEstado(opcoes);
      }),
    [],
  );
  const fechar = (v) => {
    resolver.current?.(v);
    resolver.current = null;
    setEstado(null);
  };
  const dialogo = (
    <Modal
      aberto={Boolean(estado)}
      aoFechar={() => fechar(false)}
      titulo={estado?.titulo || 'Confirmar'}
      largura={480}
      rodape={
        <>
          <Botao onClick={() => fechar(false)}>Cancelar</Botao>
          <Botao variante={estado?.perigo ? 'perigo' : 'primario'} icone={estado?.icone} onClick={() => fechar(true)}>
            {estado?.rotulo || 'Confirmar'}
          </Botao>
        </>
      }
    >
      <div className="sec" style={{ lineHeight: 1.55 }}>{estado?.texto}</div>
    </Modal>
  );
  return [dialogo, confirmar];
}

/**
 * Ações de campanha com confirmação e feedback.
 * @param {{ aoMudar?: () => void }} op chamado depois de uma ação que altera dados
 */
export function useAcoesCampanha({ aoMudar } = {}) {
  const toast = useToast();
  const [dialogoConfirmar, confirmar] = useConfirmacao();
  // bloqueio por falta de verba na conta corrente: guarda a chamada para repetir com a exceção autorizada
  const [bloqueio, setBloqueio] = useState(null);

  const executar = async (fn, sucesso) => {
    try {
      const r = await fn();
      if (sucesso) toast.ok(sucesso);
      aoMudar?.();
      return r;
    } catch (e) {
      const b = bloqueioContaCorrente(e);
      if (b) setBloqueio({ ...b, repetir: fn, sucesso });
      else toast.erro(e.message);
      return null;
    }
  };
  const confirmarExcecao = async (excecao) => {
    try {
      await bloqueio.repetir(excecao);
      if (bloqueio.sucesso) toast.ok(`${bloqueio.sucesso} Exceção registrada na conta corrente.`);
      setBloqueio(null);
      aoMudar?.();
    } catch (e) {
      toast.erro(e.message);
    }
  };
  const dialogo = (
    <>
      {dialogoConfirmar}
      <ModalExcecao bloqueio={bloqueio} aoFechar={() => setBloqueio(null)} aoConfirmar={confirmarExcecao} />
    </>
  );

  const acoes = {
    abrir: (c) => navegar(`/campanhas/${c.id}`),
    editar: (c) => navegar(`/campanhas/${c.id}/editar`),
    duplicar: async (c) => {
      const r = await executar(() => post(`/campanhas/${c.id}/duplicar`), 'Campanha duplicada. Ajuste e salve a cópia.');
      if (r?.id) navegar(`/campanhas/${r.id}/editar`);
    },
    ativar: (c) => executar((excecao) => post(`/campanhas/${c.id}/status`, { status: 'ativa', excecao_conta_corrente: excecao }), 'Campanha ativada.'),
    reabrir: async (c) => {
      const ok = await confirmar({ titulo: 'Reabrir campanha?', texto: 'A campanha volta a ser apurada com os dados atuais. As fotografias salvas continuam disponíveis.', rotulo: 'Reabrir', icone: RotateCcw });
      if (ok) await executar((excecao) => post(`/campanhas/${c.id}/status`, { status: 'ativa', excecao_conta_corrente: excecao }), 'Campanha reaberta.');
    },
    encerrar: async (c) => {
      const ok = await confirmar({
        titulo: 'Encerrar e congelar a apuração?',
        texto: 'A apuração atual será salva como fotografia de fechamento e passará a ser a apuração oficial da campanha, mesmo que os dados mudem depois. Você ainda poderá recalcular com os dados atuais.',
        rotulo: 'Encerrar e congelar',
        icone: Lock,
      });
      if (ok) await executar((excecao) => post(`/campanhas/${c.id}/encerrar`, { excecao_conta_corrente: excecao }), 'Campanha encerrada e apuração congelada.');
    },
    arquivar: (c) => executar(() => post(`/campanhas/${c.id}/status`, { status: 'arquivada' }), 'Campanha arquivada.'),
    desarquivar: (c) => executar(() => post(`/campanhas/${c.id}/status`, { status: 'rascunho' }), 'Campanha restaurada como rascunho.'),
    excluir: async (c, depois) => {
      const ok = await confirmar({
        titulo: 'Excluir campanha?',
        texto: `"${c.nome}" e todas as fotografias dela serão excluídas definitivamente. Esta ação não pode ser desfeita.`,
        rotulo: 'Excluir definitivamente',
        perigo: true,
        icone: Trash2,
      });
      if (ok) {
        const r = await executar(() => del(`/campanhas/${c.id}`), 'Campanha excluída.');
        if (r) depois?.();
      }
    },
  };

  /** Itens do <Menu> conforme a situação da campanha. */
  const itensMenu = (c, { semAbrir = false, depoisExcluir } = {}) => {
    const sit = situacao(c);
    return [
      !semAbrir && c.status !== 'rascunho' && { rotulo: 'Abrir apuração', icone: ExternalLink, aoClicar: () => acoes.abrir(c) },
      { rotulo: 'Editar', icone: Pencil, aoClicar: () => acoes.editar(c) },
      { rotulo: 'Duplicar', icone: Copy, aoClicar: () => acoes.duplicar(c) },
      '-',
      c.status === 'rascunho' && { rotulo: 'Ativar', icone: PlayCircle, aoClicar: () => acoes.ativar(c) },
      c.status === 'ativa' && { rotulo: sit === 'aguardando' ? 'Encerrar e congelar' : 'Encerrar agora', icone: Lock, aoClicar: () => acoes.encerrar(c) },
      c.status === 'encerrada' && { rotulo: 'Reabrir', icone: RotateCcw, aoClicar: () => acoes.reabrir(c) },
      c.status !== 'arquivada'
        ? { rotulo: 'Arquivar', icone: Archive, aoClicar: () => acoes.arquivar(c) }
        : { rotulo: 'Desarquivar', icone: ArchiveRestore, aoClicar: () => acoes.desarquivar(c) },
      { rotulo: 'Excluir', icone: Trash2, perigo: true, aoClicar: () => acoes.excluir(c, depoisExcluir) },
    ].filter(Boolean);
  };

  return { acoes, itensMenu, dialogo };
}
